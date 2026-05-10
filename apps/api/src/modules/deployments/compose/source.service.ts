import { execFile as cpExecFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  BuildConfig,
  ComposeSourceHandle,
  PrepareComposeSourceConfig,
  ResourceConfig,
} from "@repo/adapters";
import { BuildLogger } from "@repo/adapters";

import type { BuildConfigSnapshotLike } from "../build-config";

const execFileAsync = promisify(cpExecFile);

export interface ComposeSourceRuntime {
  prepareComposeSource?(
    config: PrepareComposeSourceConfig,
    logger?: BuildLogger,
  ): Promise<ComposeSourceHandle>;
  destroyComposeSource?(handle: ComposeSourceHandle): Promise<void>;
}

export type PreparedComposeSource =
  | { kind: "local"; path: string; cleanup: () => Promise<void> }
  | { kind: "cloud-workspace"; handle: ComposeSourceHandle; cleanup: () => Promise<void> };

function injectGitToken(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  try {
    const url = new URL(repoUrl);
    if (url.protocol !== "https:") return repoUrl;
    url.username = "x-access-token";
    url.password = token;
    return url.toString();
  } catch {
    return repoUrl;
  }
}

async function cloneComposeSource(opts: {
  repoUrl: string;
  branch: string;
  commitSha?: string | null;
  gitToken?: string;
}): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const sourceDir = await mkdtemp(join(tmpdir(), "openship-compose-source-"));
  const cloneUrl = injectGitToken(opts.repoUrl, opts.gitToken);

  try {
    await execFileAsync(
      "git",
      [
        "-c",
        "credential.helper=",
        "clone",
        "--depth",
        opts.commitSha ? "50" : "1",
        "--branch",
        opts.branch,
        cloneUrl,
        sourceDir,
      ],
      {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "true",
        },
      },
    );

    if (opts.commitSha) {
      await execFileAsync("git", [
        "-c",
        "credential.helper=",
        "-C",
        sourceDir,
        "checkout",
        opts.commitSha,
      ]);
    }

    await rm(join(sourceDir, ".git"), { recursive: true, force: true });
    return {
      path: sourceDir,
      cleanup: () => rm(sourceDir, { recursive: true, force: true }).catch(() => {}),
    };
  } catch (err) {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function prepareComposeBuildSource(opts: {
  runtime: ComposeSourceRuntime;
  logger: BuildLogger;
  snapshot: BuildConfigSnapshotLike;
  deploymentId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  branch: string;
  commitSha?: string | null;
  gitToken?: string;
  resources: ResourceConfig;
}): Promise<PreparedComposeSource> {
  const { logger, snapshot } = opts;

  logger.step("clone", "running", "Preparing compose source context...");
  logger.log("Preparing compose source context...\n");

  try {
    if (snapshot.localPath) {
      logger.step("clone", "completed", "Local compose source ready");
      logger.log("Local compose source ready.\n");
      return {
        kind: "local",
        path: snapshot.localPath,
        cleanup: async () => {},
      };
    }

    if (opts.runtime.prepareComposeSource) {
      const sourceHandle = await opts.runtime.prepareComposeSource(
        {
          deploymentId: opts.deploymentId,
          projectId: opts.projectId,
          slug: opts.projectSlug || opts.projectName,
          repoUrl: snapshot.repoUrl,
          branch: opts.branch,
          commitSha: opts.commitSha,
          gitToken: opts.gitToken,
          resources: opts.resources,
        },
        logger,
      );

      logger.step("clone", "completed", "Compose source workspace ready");
      return {
        kind: "cloud-workspace",
        handle: sourceHandle,
        cleanup: async () => {
          await opts.runtime.destroyComposeSource?.(sourceHandle);
        },
      };
    }

    logger.log(`Cloning compose source (branch: ${opts.branch})...\n`);
    const source = await cloneComposeSource({
      repoUrl: snapshot.repoUrl,
      branch: opts.branch,
      commitSha: opts.commitSha,
      gitToken: opts.gitToken,
    });

    logger.step("clone", "completed", "Compose source context ready");
    logger.log("Compose source context ready.\n");
    return { kind: "local", ...source };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to prepare compose source context";
    logger.step("clone", "failed", `Preparing compose source context - ${message}`);
    throw err;
  }
}

export function buildSourceOverrides(source: PreparedComposeSource | null): Partial<BuildConfig> {
  if (!source) return {};

  if (source.kind === "local") {
    return { localPath: source.path };
  }

  return {
    sourceRef: {
      kind: "cloud-workspace",
      workspaceId: source.handle.workspaceId,
      path: source.handle.path,
    },
  };
}
