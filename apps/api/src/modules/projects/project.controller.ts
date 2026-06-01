/**
 * Project controller — Hono request handlers.
 *
 * Every handler:
 *   1. Extracts user from context (set by authMiddleware)
 *   2. Delegates to project.service
 *   3. Returns consistent JSON
 */

import type { Context } from "hono";
import { streamSSE } from "../../lib/sse";
import { getUserId, param } from "../../lib/controller-helpers";
import * as projectService from "./project.service";
import { AppError } from "@repo/core";
import type {
  TCreateProjectBody,
  TCreateProjectEnvironmentBody,
  TUpdateProjectBody,
  TSetEnvVarsBody,
  TUpdateResourcesBody,
} from "./project.schema";
import { stat } from "node:fs/promises";
import { repos, type Domain, type Project } from "@repo/db";
import { deployLuaScripts } from "@repo/adapters";
import { getOpenRestyPaths } from "@/lib/openresty-paths";
import * as domainService from "../domains/domain.service";
import * as prepareService from "../deployments/prepare.service";
import { sshManager } from "../../lib/ssh-manager";
import { env, internalApiUrl, runtimeTarget } from "../../config";
import { resolveProjectTrafficSource, fetchMgmt, mgmtStream } from "../../lib/project-analytics";
import { refreshProjectFaviconIfStale } from "../../lib/favicon-detector";
import { getAdminOblienClient } from "../../lib/oblien-user-client";
import { cloudAnalyticsProxy } from "../../lib/cloud-client";
import {
  registerWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhookStrategy,
  resolveWebhookStrategy,
  getAvailableStrategies,
  getRecentCommits,
  getRepository,
  listBranches as listGitHubBranches,
} from "../github/github.service";
import { getInstallationId, getInstallUrl } from "../github/github.auth";
import { platform } from "../../lib/controller-helpers";
import { listProjectRouteRows, resolveProjectRouteState } from "../domains/project-route.service";

// Track which servers have had Lua scripts deployed this session
const luaDeployedServers = new Set<string>();

function logEnsureProjectError(
  userId: string,
  body: TCreateProjectBody & { projectId?: string },
  err: unknown,
) {
  console.error("[PROJECT] Failed to ensure project", {
    userId,
    projectId: body.projectId,
    name: body.name,
    slug: body.slug,
    gitBranch: body.gitBranch,
    port: body.port,
    publicEndpoints: body.publicEndpoints?.map((endpoint) => ({
      port: endpoint.port,
      targetPath: endpoint.targetPath,
      domain: endpoint.domain,
      customDomain: endpoint.customDomain,
      domainType: endpoint.domainType,
    })),
  });
  console.error(err);

  if (err instanceof Error && err.cause) {
    console.error("[PROJECT] Ensure project cause:", err.cause);
  }
}

// ─── Ensure project ──────────────────────────────────────────────────────────

export async function ensure(c: Context) {
  const userId = getUserId(c);
  const body = await c.req.json<TCreateProjectBody & { projectId?: string }>();

  if (!body.name) {
    return c.json({ success: false, error: "name is required" }, 400);
  }

  try {
    const result = await projectService.ensureProject(userId, body);
    return c.json(result);
  } catch (err) {
    logEnsureProjectError(userId, body, err);

    if (err instanceof AppError) {
      return c.json(
        { success: false, error: err.message, code: err.code },
        err.statusCode as 400 | 401 | 403 | 404 | 409 | 500,
      );
    }

    return c.json({ success: false, error: "Failed to ensure project" }, 500);
  }
}

// ─── Projects CRUD ───────────────────────────────────────────────────────────

export async function getHome(c: Context) {
  const userId = getUserId(c);
  try {
    const result = await projectService.listProjects(userId, { page: 1, perPage: 100 });

    // Enrich each project with computed fields + latest deployment info
    const projects = await Promise.all(
      result.rows.map(async (p) => {
        const [enriched, latest, primary, services] = await Promise.all([
          projectService.enrichProject(p),
          repos.deployment.findLatestByProject(p.id),
          repos.domain.getPrimaryByProject(p.id),
          repos.service.listByProject(p.id),
        ]);

        refreshProjectFaviconIfStale(p, {
          hostname: primary?.verified ? primary.hostname : null,
        });

        return {
          ...enriched,
          latestDeploymentId: latest?.id ?? null,
          latestDeploymentStatus: latest?.status ?? null,
          primaryDomain: primary?.hostname ?? null,
          serviceCount: services.length,
          hasMultipleServices: services.length > 1,
        };
      }),
    );

    return c.json({
      success: true,
      projects,
      numbers: {
        total_projects: result.total,
        total_deployments: 0,
        total_success_deployments: 0,
      },
    });
  } catch {
    // Table may not exist yet (e.g. PGlite before migrations)
    return c.json({
      success: true,
      projects: [],
      numbers: { total_projects: 0, total_deployments: 0, total_success_deployments: 0 },
    });
  }
}

export async function list(c: Context) {
  const userId = getUserId(c);
  const page = Number(c.req.query("page") ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  const result = await projectService.listProjects(userId, { page, perPage });
  result.rows.forEach((project) => {
    refreshProjectFaviconIfStale(project);
  });
  return c.json({
    data: result.rows,
    total: result.total,
    page: result.page,
    perPage: result.perPage,
  });
}

export async function create(c: Context) {
  const userId = getUserId(c);
  const body = await c.req.json<TCreateProjectBody>();
  const project = await projectService.createProject(userId, body);
  return c.json({ data: project }, 201);
}

export async function getById(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const project = await projectService.getProject(id, userId);
  refreshProjectFaviconIfStale(project);
  return c.json({ data: project });
}

// ─── Project environments ───────────────────────────────────────────────────

export async function listEnvironments(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const data = await projectService.listProjectEnvironments(id, userId);
  return c.json({ success: true, data });
}

export async function createEnvironment(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<TCreateProjectEnvironmentBody>();

  if (!body.environmentName?.trim()) {
    return c.json({ success: false, error: "environmentName is required" }, 400);
  }

  try {
    const data = await projectService.createProjectEnvironment(id, userId, body);
    return c.json({ success: true, data }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create environment";
    return c.json({ success: false, error: message }, 400);
  }
}

export async function update(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<TUpdateProjectBody>();
  const project = await projectService.updateProject(id, userId, body);
  return c.json({ data: project });
}

export async function remove(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const deleteApp = c.req.query("deleteApp") !== "false";
  // Allow opting in to volume wipe via either query string or JSON body —
  // the dashboard sends a body, but query is handy for tooling.
  let bodyWipeVolumes: boolean | undefined;
  try {
    const body = await c.req.json<{ wipeVolumes?: boolean }>();
    bodyWipeVolumes = body?.wipeVolumes;
  } catch {
    /* no body — fine */
  }
  const wipeVolumes = bodyWipeVolumes ?? c.req.query("wipeVolumes") === "true";
  const result = await projectService.deleteProject(id, userId, { deleteApp, wipeVolumes });
  return c.json({ message: "deleted", ...result });
}

export async function deletionPreview(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const { repos } = await import("@repo/db");
  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ success: false, error: "project-not-found" }, 404);
  }
  const preview = await projectService.previewProjectDeletion(project);
  return c.json({ success: true, preview });
}

// ─── Environment variables ───────────────────────────────────────────────────

export async function listEnvVars(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const environment = c.req.query("environment");
  const vars = await projectService.listEnvVars(id, userId, environment);
  return c.json({ data: vars });
}

export async function setEnvVars(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<TSetEnvVarsBody>();
  const result = await projectService.setEnvVars(id, userId, body);
  return c.json(result);
}

// ─── Resources ───────────────────────────────────────────────────────────────

export async function getResources(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const resources = await projectService.getResources(id, userId);
  return c.json({ data: resources });
}

export async function updateResources(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<TUpdateResourcesBody>();
  const resources = await projectService.updateResources(id, userId, body);
  return c.json({ data: resources });
}

// ─── Local projects ──────────────────────────────────────────────────────────

/** Scan a local directory and detect framework/stack */
export async function scanLocal(c: Context) {
  if (env.CLOUD_MODE) return c.notFound();

  const { path: dirPath } = await c.req.json<{ path: string }>();
  if (!dirPath) return c.json({ error: "path is required" }, 400);

  // Validate the path exists and is a directory
  try {
    const st = await stat(dirPath);
    if (!st.isDirectory()) return c.json({ error: "Path is not a directory" }, 400);
  } catch {
    return c.json({ error: "Directory not found" }, 404);
  }

  const result = await prepareService.resolveProjectInfo({ source: "local", path: dirPath });

  return c.json({
    success: true,
    name: result.repository.name,
    path: dirPath,
    stack: result.stack,
    projectType: result.projectType,
    category: result.category,
    packageManager: result.packageManager,
    installCommand: result.installCommand,
    buildCommand: result.buildCommand,
    startCommand: result.startCommand,
    buildImage: result.buildImage,
    outputDirectory: result.outputDirectory,
    rootDirectory: result.rootDirectory,
    productionPaths: result.productionPaths,
    port: result.port,
    services: result.services,
  });
}

/** Import a local folder as a project */
export async function importLocal(c: Context) {
  if (env.CLOUD_MODE) return c.notFound();

  const userId = getUserId(c);
  const body = await c.req.json<TCreateProjectBody & { localPath: string }>();

  if (!body.localPath) return c.json({ error: "localPath is required" }, 400);

  // Verify directory exists
  try {
    const st = await stat(body.localPath);
    if (!st.isDirectory()) return c.json({ error: "Path is not a directory" }, 400);
  } catch {
    return c.json({ error: "Directory not found" }, 404);
  }

  const project = await projectService.createProject(userId, {
    ...body,
    gitProvider: "local",
  });

  return c.json({ data: project }, 201);
}

/** List only local projects for the current user */
export async function listLocal(c: Context) {
  if (env.CLOUD_MODE) return c.notFound();

  const userId = getUserId(c);
  try {
    const result = await projectService.listProjects(userId, { page: 1, perPage: 100 });
    const localProjects = result.rows.filter((p) => p.gitProvider === "local");
    return c.json({ success: true, projects: localProjects });
  } catch {
    return c.json({ success: true, projects: [] });
  }
}

// ─── Runtime logs ────────────────────────────────────────────────────────────

/**
 * GET /projects/:id/logs — one-shot fetch of recent runtime logs.
 */
export async function runtimeLogs(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const tail = c.req.query("tail") ? Number(c.req.query("tail")) : undefined;

  try {
    const entries = await projectService.getRuntimeLogs(id, userId, tail);
    return c.json({ data: entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get logs";
    return c.json({ error: message }, 400);
  }
}

/**
 * GET /projects/:id/logs/stream — SSE stream of runtime logs.
 */
export async function runtimeLogStream(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const tail = c.req.query("tail") ? Number(c.req.query("tail")) : undefined;

  return streamSSE(c, async (sseStream) => {
    let cleanup: (() => void) | null = null;
    let serverId: string | null = null;

    try {
      const result = await projectService.streamRuntimeLogs(
        id,
        userId,
        (entry) => {
          void sseStream.writeSSE({
            event: "log",
            data: JSON.stringify({
              type: "log",
              data: entry.rawData,
              message: entry.message,
              timestamp: entry.timestamp,
              level: entry.level,
            }),
          });
        },
        { tail },
      );

      cleanup = result.cleanup;
      serverId = result.serverId;
      if (serverId) sshManager.retain(serverId);

      // Keep the stream open until client disconnects
      await new Promise<void>((resolve) => {
        sseStream.onAbort(() => {
          cleanup?.();
          resolve();
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stream logs";
      await sseStream.writeSSE({ event: "error", data: JSON.stringify({ error: message }) });
      cleanup?.();
    } finally {
      if (serverId) sshManager.release(serverId);
    }
  });
}

// ─── Server HTTP request logs ────────────────────────────────────────────────

function extractCloudStreamToken(result: unknown): { stream_url: string; token: string } | null {
  const root = result as Record<string, unknown> | null;
  const data = (root?.data && typeof root.data === "object" ? root.data : root) as Record<
    string,
    unknown
  > | null;
  const streamUrl = data?.stream_url ?? data?.streamUrl ?? data?.url;
  const token = data?.token;
  return typeof streamUrl === "string" && typeof token === "string"
    ? { stream_url: streamUrl, token }
    : null;
}

function extractCloudRequestLogs(result: unknown): unknown[] {
  const root = result as Record<string, unknown> | null;
  const data = root?.data as unknown;
  const candidates = [
    data,
    root?.requests,
    root?.logs,
    root?.items,
    root?.rows,
    data && typeof data === "object" ? (data as Record<string, unknown>).requests : undefined,
    data && typeof data === "object" ? (data as Record<string, unknown>).logs : undefined,
    data && typeof data === "object" ? (data as Record<string, unknown>).items : undefined,
    data && typeof data === "object" ? (data as Record<string, unknown>).rows : undefined,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

/**
 * GET /projects/:id/server-logs/stream-token
 *
 * Returns { kind: "cloud", url, token } or { kind: "self-hosted" }.
 * For cloud projects the dashboard connects directly to the edge SSE stream.
 */
export async function serverLogStreamToken(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");

  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ error: "Project not found" }, 404);
  }

  const source = await resolveProjectTrafficSource(id);
  if (!source) {
    return c.json({ error: "No domain configured for this project" }, 400);
  }

  if (source.kind === "cloud") {
    const client = getAdminOblienClient();
    let tokenResult: unknown = null;

    if (client) {
      try {
        tokenResult = await client.analytics.streamToken(source.domain);
      } catch {
        return c.json({ kind: "self-hosted" as const });
      }
    } else {
      tokenResult = await cloudAnalyticsProxy(userId, "streamToken", source.domain);
    }

    const tokenData = extractCloudStreamToken(tokenResult);
    if (!tokenData) {
      return c.json({ kind: "self-hosted" as const });
    }
    return c.json({ kind: "cloud" as const, url: tokenData.stream_url, token: tokenData.token });
  }

  return c.json({ kind: "self-hosted" as const });
}

/**
 * GET /projects/:id/server-logs/stream — SSE stream of HTTP request logs
 * from the OpenResty pipe_stream on the managed server.
 *
 * Cloud projects use stream-token + direct edge connection instead.
 * Auto-deploys Lua scripts once per API session per server.
 */
export async function serverLogStream(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");

  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ error: "Project not found" }, 404);
  }

  const source = await resolveProjectTrafficSource(id);
  if (!source || source.kind !== "self-hosted") {
    return c.json({ error: "Use stream-token endpoint for cloud projects" }, 400);
  }

  const { domain, serverId } = source;

  return streamSSE(c, async (sseStream) => {
    sshManager.retain(serverId);
    try {
      if (!luaDeployedServers.has(serverId)) {
        try {
          const executor = await sshManager.acquire(serverId);
          const paths = await getOpenRestyPaths(serverId, executor);
          await deployLuaScripts(executor, paths);
          luaDeployedServers.add(serverId);
        } catch {
          // Non-fatal — scripts may already be up to date
        }
      }

      const reqPath = `/logs/stream?domain=${encodeURIComponent(domain)}`;
      const conn = await mgmtStream(serverId, reqPath);
      if (!conn) {
        await sseStream
          .writeSSE({
            event: "error",
            data: JSON.stringify({
              error: "Failed to connect to log service — ensure OpenResty is running",
            }),
          })
          .catch(() => {});
        return;
      }

      sseStream.onAbort(() => conn.destroy());

      await new Promise<void>((resolve) => {
        conn.stream.on("data", (chunk: Buffer) => {
          sseStream.write(chunk.toString()).catch(() => conn.destroy());
        });
        conn.stream.on("close", () => resolve());
        conn.stream.on("end", () => resolve());
        conn.stream.on("error", () => resolve());
      });
    } finally {
      sshManager.release(serverId);
    }
  });
}

// ─── Recent server logs ──────────────────────────────────────────────────────

export async function recentServerLogs(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");

  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ error: "Project not found" }, 404);
  }

  const source = await resolveProjectTrafficSource(id);
  if (!source) {
    return c.json({ logs: [] });
  }

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);

  if (source.kind === "cloud") {
    const client = getAdminOblienClient();
    let result: unknown = null;

    if (client) {
      try {
        result = await client.analytics.requests(source.domain, { limit });
      } catch {
        return c.json({ logs: [] });
      }
    } else {
      result = await cloudAnalyticsProxy(userId, "requests", source.domain, { limit });
    }

    return c.json({ logs: extractCloudRequestLogs(result) });
  }

  const { domain, serverId } = source;

  const entries = await fetchMgmt<unknown[]>(
    serverId,
    `/logs/recent?domain=${encodeURIComponent(domain)}&limit=${limit}`,
  );
  return c.json({ logs: entries ?? [] });
}

// ─── Git info ────────────────────────────────────────────────────────────────

export async function getGitInfo(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const info = await projectService.getGitInfo(id, userId);

  // No repo linked yet
  if (!info.gitOwner || !info.gitRepo) {
    return c.json({ success: false, error: "No repository connected" });
  }

  const strategy = await resolveWebhookStrategy(userId, info);

  // Cloud projects (deployTarget=cloud) need the GitHub App installed — regardless
  // of whether this server is the SaaS or a local instance connected to cloud.
  const isCloudProject = info.deployTarget === "cloud";
  let installationInstalled = false;
  if (isCloudProject && info.gitOwner) {
    const instId = await getInstallationId(userId, info.gitOwner);
    installationInstalled = !!instId;
  }

  let sharedWebhookId = info.webhookId ?? null;
  if (!sharedWebhookId && info.gitOwner && info.gitRepo) {
    sharedWebhookId = await findSharedWebhookId(userId, info.gitOwner, info.gitRepo);
  }

  // Derive webhook_active from strategy + state
  const webhookActive =
    strategy === "app"
      ? installationInstalled
      : strategy === "domain"
        ? !!(info.autoDeploy && sharedWebhookId)
        : strategy === "repo"
          ? !!(info.autoDeploy && sharedWebhookId)
          : false;

  // Get available strategies for the UI
  const strategies = await getAvailableStrategies(userId, info);

  // Get project domains for webhook domain picker
  const domains = await repos.domain.listByProject(id);
  const verifiedDomains = domains
    .filter((d) => d.verified)
    .map((d) => ({ hostname: d.hostname, ssl: d.sslStatus === "active" }));

  let branch = info.gitBranch ?? "";
  if (!branch && info.gitOwner && info.gitRepo) {
    const repository = await getRepository(userId, info.gitOwner, info.gitRepo);
    branch = repository.default_branch;
  }
  const commits = branch
    ? await getRecentCommits(userId, info.gitOwner, info.gitRepo, branch, 10)
    : [];

  return c.json({
    success: true,
    owner: info.gitOwner,
    repo: info.gitRepo,
    branch,
    provider: info.gitProvider ?? "github",
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      author_avatar: c.authorAvatar,
      date: c.date,
      url: c.url,
    })),
    auto_deploy: info.autoDeploy ?? false,
    webhook_strategy: strategy,
    webhook_active: webhookActive,
    webhook_domain: info.webhookDomain ?? null,
    available_strategies: strategies.available,
    verified_domains: verifiedDomains,
    installation_installed: installationInstalled,
    install_url: isCloudProject && !installationInstalled ? getInstallUrl() : undefined,
  });
}

export async function listBranches(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const info = await projectService.getGitInfo(id, userId);

  if (!info.gitOwner || !info.gitRepo) {
    return c.json({ success: false, error: "No repository connected" }, 400);
  }

  const branches = await listGitHubBranches(userId, info.gitOwner, info.gitRepo);
  return c.json({
    success: true,
    data: branches.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: branch.protected,
    })),
  });
}

/**
 * POST /projects/:id/git/link  { owner, repo, branch? }
 *
 * Links a GitHub repo to an existing project and registers a deploy webhook.
 */
export async function linkRepo(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const { owner, repo, branch, installationId } = await c.req.json<{
    owner: string;
    repo: string;
    branch?: string;
    installationId?: number;
  }>();

  if (!owner?.trim() || !repo?.trim()) {
    return c.json({ success: false, error: "owner and repo are required" }, 400);
  }

  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Update git fields on the project
  const gitUrl = `https://github.com/${owner}/${repo}.git`;
  const defaultBranch = branch?.trim() || (await getRepository(userId, owner, repo)).default_branch;

  const gitFields: Record<string, unknown> = {
    gitProvider: "github",
    gitOwner: owner,
    gitRepo: repo,
    gitBranch: defaultBranch,
    gitUrl,
  };

  const strategy = await resolveWebhookStrategy(userId, project);

  if (strategy === "app") {
    // Cloud mode — verify the GitHub App is installed for this owner
    const resolvedInstId = await getInstallationId(userId, owner);
    if (!resolvedInstId) {
      return c.json(
        {
          success: false,
          error: "GitHub App is not installed for this account",
          install_url: getInstallUrl(),
          owner,
        },
        400,
      );
    }
    gitFields.installationId = resolvedInstId;
    gitFields.autoDeploy = true;
  } else if (strategy === "domain") {
    // User has a verified domain for webhooks → direct delivery
    const webhookUrl = `https://${project.webhookDomain}/_openship/hooks/github`;
    try {
      const wh = await registerWebhook(userId, owner, repo, webhookUrl);
      if (wh.hookId) gitFields.webhookId = wh.hookId;
      gitFields.autoDeploy = true;
    } catch {
      // Link succeeds without auto-deploy — user can enable later
    }
  } else if (strategy === "repo") {
    // Self-hosted with a public URL — create a repo-level push webhook.
    let webhookId: number | null = null;
    try {
      const result = await registerWebhook(userId, owner, repo);
      webhookId = result.hookId;
      gitFields.webhookId = webhookId;
      gitFields.autoDeploy = !!webhookId;
    } catch {
      // Webhook registration failed — link still succeeds, just no auto-deploy
    }
  }
  // strategy === "none": no webhook path is available for this instance yet

  await repos.project.update(id, gitFields);
  if (project.appId) {
    await repos.projectApp.update(project.appId, {
      gitProvider: "github",
      gitOwner: owner,
      gitRepo: repo,
      gitUrl,
      installationId: (gitFields.installationId as number | undefined) ?? installationId,
    });

    const sharedGitFields = {
      gitProvider: "github",
      gitOwner: owner,
      gitRepo: repo,
      gitUrl,
      installationId: (gitFields.installationId as number | undefined) ?? installationId,
      ...(typeof gitFields.webhookId === "number" ? { webhookId: gitFields.webhookId } : {}),
    };
    const siblings = await repos.project.listByApp(project.appId);
    await Promise.all(
      siblings
        .filter((sibling) => sibling.id !== id)
        .map((sibling) => repos.project.update(sibling.id, sharedGitFields)),
    );
  }

  return c.json({
    success: true,
    owner,
    repo,
    branch: defaultBranch,
    webhook_strategy: strategy,
    auto_deploy: !!gitFields.autoDeploy,
  });
}

async function listUserRepoProjects(userId: string, owner: string, repo: string) {
  const ownerKey = owner.toLowerCase();
  const repoKey = repo.toLowerCase();
  const projects = await repos.project.findByGitRepo(owner, repo);
  return projects.filter(
    (p) =>
      p.userId === userId &&
      p.gitOwner?.toLowerCase() === ownerKey &&
      p.gitRepo?.toLowerCase() === repoKey,
  );
}

async function findSharedWebhookId(userId: string, owner: string, repo: string) {
  const projects = await listUserRepoProjects(userId, owner, repo);
  return projects.find((p) => typeof p.webhookId === "number")?.webhookId ?? null;
}

async function syncSharedWebhookId(userId: string, owner: string, repo: string, webhookId: number) {
  const projects = await listUserRepoProjects(userId, owner, repo);
  await Promise.all(
    projects
      .filter((p) => p.webhookId !== webhookId)
      .map((p) => repos.project.update(p.id, { webhookId })),
  );
}

async function ensureSharedWebhook(
  userId: string,
  project: Project,
  owner: string,
  repo: string,
  webhookUrl?: string,
) {
  const existingHookId = project.webhookId ?? (await findSharedWebhookId(userId, owner, repo));
  const targetWebhookUrl = webhookUrl ?? `${runtimeTarget.api}/api/webhooks/github`;
  const result = await registerWebhook(userId, owner, repo, targetWebhookUrl);
  if (!result.hookId) return null;

  if (existingHookId && existingHookId !== result.hookId) {
    await updateWebhook(userId, owner, repo, existingHookId, { active: false }).catch(
      () => undefined,
    );
  }

  await syncSharedWebhookId(userId, owner, repo, result.hookId);
  return result.hookId;
}

async function disableSharedWebhookIfUnused(
  userId: string,
  owner: string,
  repo: string,
  webhookId: number | null,
) {
  const repoProjects = await repos.project.findByGitRepo(owner, repo);
  if (repoProjects.some((p) => p.autoDeploy)) return;

  const projects = repoProjects.filter((p) => p.userId === userId);
  const hookId = webhookId ?? projects.find((p) => typeof p.webhookId === "number")?.webhookId;
  if (hookId) {
    await updateWebhook(userId, owner, repo, hookId, { active: false });
  }
}

export async function setAutoDeploy(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ error: "Project not found" }, 404);
  }

  const owner = project.gitOwner;
  const repo = project.gitRepo;

  if (!owner || !repo) {
    return c.json({ success: false, error: "No repository linked" }, 400);
  }

  const strategy = await resolveWebhookStrategy(userId, project);

  // In "none" mode, auto-deploy can't work — suggest options
  if (strategy === "none" && enabled) {
    return c.json(
      {
        success: false,
        error:
          "Set a webhook domain or expose this Openship API on a public URL to enable auto-deploy.",
        webhook_strategy: "none",
      },
      400,
    );
  }

  try {
    if (strategy === "app") {
      // GitHub App handles push events natively — just toggle the DB flag
      await repos.project.update(id, { autoDeploy: enabled });
    } else if (strategy === "domain") {
      // User has a verified domain — direct webhook delivery
      if (enabled) {
        const webhookUrl = `https://${project.webhookDomain}/_openship/hooks/github`;
        const webhookId = await ensureSharedWebhook(userId, project, owner, repo, webhookUrl);
        if (!webhookId) {
          return c.json(
            {
              success: false,
              error: "Could not create webhook — you may not have admin access to this repository",
            },
            403,
          );
        }
        await repos.project.update(id, { autoDeploy: true });
      } else {
        await repos.project.update(id, { autoDeploy: false });
        await disableSharedWebhookIfUnused(userId, owner, repo, project.webhookId);
      }
    } else if (enabled) {
      // "repo" strategy — manage repo-level webhooks
      const webhookId = await ensureSharedWebhook(userId, project, owner, repo);
      if (!webhookId) {
        return c.json(
          {
            success: false,
            error: "Could not create webhook — you may not have admin access to this repository",
          },
          403,
        );
      }
      await repos.project.update(id, { autoDeploy: true });
    } else {
      // Disable this environment. Keep the repo webhook while sibling environments still use it.
      await repos.project.update(id, { autoDeploy: false });
      await disableSharedWebhookIfUnused(userId, owner, repo, project.webhookId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[setAutoDeploy] strategy=${strategy} enabled=${enabled}:`, msg);

    if (msg.includes("No GitHub access token")) {
      return c.json(
        { success: false, error: "GitHub is not connected. Link your GitHub account first." },
        401,
      );
    }
    if (msg.includes("404")) {
      await repos.project.update(id, { webhookId: null, autoDeploy: false });
      return c.json(
        {
          success: false,
          error: "Webhook was deleted on GitHub. Try disabling and re-enabling auto-deploy.",
        },
        410,
      );
    }
    if (msg.includes("403")) {
      return c.json(
        {
          success: false,
          error: "You don't have permission to manage webhooks on this repository.",
        },
        403,
      );
    }
    if (msg.includes("422")) {
      return c.json(
        {
          success: false,
          error:
            "A webhook already exists for this repository. Try disabling and re-enabling auto-deploy.",
        },
        409,
      );
    }
    return c.json({ success: false, error: msg || "Failed to configure auto-deploy" }, 500);
  }

  const updated = await repos.project.findById(id);
  return c.json({
    success: true,
    auto_deploy: updated?.autoDeploy ?? false,
    webhook_strategy: strategy,
  });
}

/**
 * POST /projects/:id/webhook-domain  { domain: string | null }
 *
 * Set or clear the domain used for receiving GitHub webhooks.
 *
 * When a domain is set:
 *   1. Validates it belongs to this project and is verified
 *   2. Adds /_openship/hooks/ location to the domain's nginx config
 *   3. The webhook URL becomes https://{domain}/_openship/hooks/github
 *
 * When domain is null → clears the webhook domain (falls back to edge relay or none).
 */
export async function setWebhookDomain(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const { domain: hostname } = await c.req.json<{ domain: string | null }>();

  const project = await repos.project.findById(id);
  if (!project || project.userId !== userId) {
    return c.json({ error: "Project not found" }, 404);
  }

  // ── Clear webhook domain ────────────────────────────────────────────
  if (!hostname) {
    // If clearing, remove the webhook location from the old domain's nginx config
    if (project.webhookDomain) {
      await reRegisterDomainRoute(project, project.webhookDomain, false);
    }
    await repos.project.update(id, { webhookDomain: null });
    return c.json({ success: true, webhook_domain: null });
  }

  // ── Set webhook domain ──────────────────────────────────────────────
  // Verify the domain belongs to this project
  const domains = await repos.domain.listByProject(id);
  const dom = domains.find((d) => d.hostname === hostname);
  if (!dom) {
    return c.json({ error: "Domain does not belong to this project" }, 400);
  }
  if (!dom.verified) {
    return c.json({ error: "Domain must be verified before it can receive webhooks" }, 400);
  }

  // Remove webhook location from the old domain if changing
  if (project.webhookDomain && project.webhookDomain !== hostname) {
    await reRegisterDomainRoute(project, project.webhookDomain, false);
  }

  // Add webhook location to the new domain's nginx config
  await reRegisterDomainRoute(project, hostname, true);

  await repos.project.update(id, { webhookDomain: hostname });

  const scheme = dom.sslStatus === "active" ? "https" : "http";
  const webhookUrl = `${scheme}://${hostname}/_openship/hooks/github`;

  return c.json({
    success: true,
    webhook_domain: hostname,
    webhook_url: webhookUrl,
  });
}

/**
 * Re-register a domain's nginx route with or without the webhook proxy location.
 * Reads the current deployment's service info to get the route target.
 */
async function reRegisterDomainRoute(
  project: { id: string; activeDeploymentId: string | null; port: number | null },
  hostname: string,
  enableWebhook: boolean,
): Promise<void> {
  if (!project.activeDeploymentId) return;

  try {
    const { routing } = platform();

    // Find the service deployment to get the container target
    const svcDeps = await repos.service.listByDeployment(project.activeDeploymentId);
    const primarySvc = svcDeps.find((s) => s.ip);

    if (!primarySvc?.ip) return;

    const port = primarySvc.hostPort?.toString() || project.port?.toString() || "3000";

    await routing.registerRoute({
      domain: hostname,
      tls: true,
      targetUrl: `http://${primarySvc.ip}:${port}`,
      webhookProxy: enableWebhook ? `${internalApiUrl}/api/webhooks/` : undefined,
    });
  } catch (err) {
    console.error(`[Webhook Domain] Failed to update nginx for ${hostname}:`, err);
  }
}

export async function setBranch(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const { branch } = await c.req.json<{ branch: string }>();
  if (!branch) return c.json({ error: "branch is required" }, 400);
  const result = await projectService.setBranch(id, userId, branch);
  return c.json(result);
}

// ─── Build options ───────────────────────────────────────────────────────────

export async function setOptions(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<Record<string, unknown>>();
  const result = await projectService.updateOptions(id, userId, body);
  return c.json({ data: result });
}

// ─── Sleep mode ──────────────────────────────────────────────────────────────

export async function setSleepMode(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const { sleep_mode } = await c.req.json<{ sleep_mode: string }>();
  if (!sleep_mode) return c.json({ error: "sleep_mode is required" }, 400);
  const result = await projectService.setSleepMode(id, userId, sleep_mode);
  return c.json(result);
}

// ─── Enable / Disable ────────────────────────────────────────────────────────

export async function enable(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  try {
    const result = await projectService.enableProject(id, userId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enable project";
    return c.json({ success: false, error: message }, 400);
  }
}

export async function disable(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  try {
    const result = await projectService.disableProject(id, userId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to disable project";
    return c.json({ success: false, error: message }, 400);
  }
}

// ─── Project deployments ─────────────────────────────────────────────────────

export async function listDeployments(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const page = Number(c.req.query("page") ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  const environment = c.req.query("environment") ?? undefined;
  const result = await projectService.listProjectDeployments(id, userId, {
    page,
    perPage,
    environment,
  });
  return c.json({
    data: result.rows,
    total: result.total,
    page: result.page,
    perPage: result.perPage,
  });
}

// ─── Deployment session ──────────────────────────────────────────────────────

export async function deploymentSession(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const result = await projectService.getLatestDeploymentSession(id, userId);
  return c.json(result);
}

// ─── Env var aliases (old API paths) ─────────────────────────────────────────

export async function envGet(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const environment = c.req.query("environment");
  const vars = await projectService.listEnvVars(id, userId, environment);
  return c.json({ data: vars });
}

export async function envSet(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<{ envVars?: TSetEnvVarsBody } & TSetEnvVarsBody>();

  // Support both { envVars: { environment, vars } } and flat { environment, vars }
  const payload = body.envVars || body;
  if (!payload.environment || !payload.vars) {
    return c.json({ error: "environment and vars are required" }, 400);
  }

  const result = await projectService.setEnvVars(id, userId, payload);
  return c.json(result);
}

// ─── Project info (enriched) ─────────────────────────────────────────────────

export async function getInfo(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const project = await projectService.getProject(id, userId);
  const environments = await projectService.listProjectEnvironments(id, userId);
  const hasServer = project.hasServer ?? project.productionMode === "host";
  const serviceRows = await repos.service.listByProject(id);
  const serviceCount = serviceRows.length;

  // Build the "options" object the dashboard expects for build settings
  const options = {
    buildCommand: project.buildCommand ?? "",
    outputDirectory: project.outputDirectory ?? "",
    productionPaths: project.productionPaths ?? "",
    installCommand: project.installCommand ?? "",
    startCommand: hasServer ? (project.startCommand ?? "") : "",
    productionPort: hasServer ? String(project.port ?? 3000) : "",
    hasServer,
    hasBuild: project.hasBuild ?? true,
    rootDirectory: project.rootDirectory ?? "./",
    isLoading: false,
    error: null,
  };

  // Fetch domains for this project
  const rawDomains = await listProjectRouteRows(id);
  const routeState = await resolveProjectRouteState(project, { projectDomains: rawDomains });
  const publicEndpoints = routeState.publicEndpoints;
  let domains: Array<Domain & { domain: string; primary: boolean }> = rawDomains.map((d) => ({
    ...d,
    domain: d.hostname,
    primary: d.isPrimary,
  }));

  const verifiedPrimaryDomain =
    rawDomains.find((domain) => domain.isPrimary && domain.verified)?.hostname ??
    rawDomains.find((domain) => domain.verified)?.hostname ??
    null;
  refreshProjectFaviconIfStale(project, {
    hostname: verifiedPrimaryDomain,
  });

  return c.json({
    success: true,
    data: {
      project: {
        ...project,
        publicEndpoints,
        options,
        domains,
        serviceCount,
        hasMultipleServices: serviceCount > 1,
      },
      environments,
    },
  });
}

// ─── Delete via POST (old API compat) ────────────────────────────────────────

export async function deletePost(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  let deleteApp = true;
  let wipeVolumes = false;
  try {
    const body = await c.req.json<{ deleteApp?: boolean; wipeVolumes?: boolean }>();
    deleteApp = body.deleteApp ?? true;
    wipeVolumes = body.wipeVolumes ?? false;
  } catch {
    // Old clients sent no body. Treat that as deleting the full app group
    // and NOT wiping volumes (safer default — user must opt in).
  }
  const result = await projectService.deleteProject(id, userId, { deleteApp, wipeVolumes });
  return c.json({ success: true, message: "deleted", ...result });
}

// ─── Update via POST (old API compat) ────────────────────────────────────────

export async function updatePost(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<TUpdateProjectBody>();
  const project = await projectService.updateProject(id, userId, body);
  return c.json({ data: project });
}

// ─── Connect custom domain ─────────────────────────────────────────────────────

export async function connectDomain(c: Context) {
  const userId = getUserId(c);
  const id = param(c, "id");
  const body = await c.req.json<{ domain: string; includeWww?: boolean }>();

  if (!body.domain?.trim()) {
    return c.json({ success: false, error: "Domain is required" }, 400);
  }

  try {
    const result = await domainService.addDomain(userId, {
      projectId: id,
      hostname: body.domain.trim(),
      isPrimary: true,
    });

    return c.json({
      success: true,
      domain: result.domain,
      records: result.records,
    });
  } catch (err) {
    if (err instanceof Error) {
      return c.json({ success: false, error: err.message, message: err.message }, 400);
    }
    throw err;
  }
}
