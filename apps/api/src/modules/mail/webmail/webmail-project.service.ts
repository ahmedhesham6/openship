/**
 * Webmail-as-project bridge.
 *
 * Webmail ships through the SAME deploy pipeline every other project uses.
 * The only divergences from a normal repo deploy are:
 *
 *   1. The source comes from `apps/email/` on the API host via `localPath`
 *      instead of `git clone`.
 *   2. Build/install/start commands are fixed by openship — the user does not
 *      get to edit them on the project row.
 *
 * Everything else — preflight, toolchain installation (bun via the standard
 * catalog), workspace transfer, OpenResty vhost, Let's Encrypt cert,
 * lifecycle hooks — is the standard `createQueuedDeployment` → `startBuild`
 * path. The bespoke 10-step engine that used to live here is gone.
 */
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { repos, type Project } from "@repo/db";
import { sshManager } from "../../../lib/ssh-manager";
import {
  buildConfigSnapshot,
  createQueuedDeployment,
  encryptEnvVars,
  metaWithPrevious,
  runDeploymentPreflight,
  startBuild,
  type DeploymentConfigSnapshot,
} from "../../deployments/build.service";
import {
  listProjectRouteRows,
  resolveProjectRouteState,
  syncProjectRouteState,
} from "../../domains/project-route.service";
import * as settingsService from "../../settings/settings.service";
import {
  readState,
  writeState,
  type MailWebmailState,
  type MailServerState,
} from "../mail-state";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_NAME = "Webmail";

/** Persistent branding dir on the target — survives redeploys because the
 *  standard pipeline only wipes the workspace dir, not /var/lib. */
/** Root of all persistent webmail state outside the per-deploy release dir. */
const REMOTE_PERSIST_DIR = "/var/lib/openship-webmail";
const REMOTE_BRANDING_DIR = `${REMOTE_PERSIST_DIR}/branding`;
/** SQLite file lives outside the release dir so redeploys don't wipe sessions/user-state. */
const REMOTE_SQLITE_PATH = `${REMOTE_PERSIST_DIR}/zero.db`;

/** Internal port Zero binds to behind the OpenResty vhost the pipeline creates. */
const DEFAULT_INTERNAL_PORT = 4080;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveLocalSourceDir(): string {
  if (process.env.MAIL_WEBMAIL_SOURCE_DIR) {
    return process.env.MAIL_WEBMAIL_SOURCE_DIR;
  }
  return resolve(process.cwd(), "../../apps/email");
}

function deriveAcmeEmail(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  const base = parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  return `admin@${base}`;
}

/**
 * The only operational concern that doesn't fit in the standard pipeline:
 * a persistent branding dir outside the workspace. The pipeline wipes the
 * workspace on every redeploy; branding config has to live somewhere else.
 *
 * Bun itself is installed by `ensureToolchain` via the standard catalog
 * (webmail stack declares `requiredTools: ["bun"]`) — no bespoke install here.
 */
async function prepareTarget(serverId: string): Promise<void> {
  await sshManager.withExecutor(serverId, async (exec) => {
    await exec.mkdir(REMOTE_PERSIST_DIR);
    await exec.exec(`chmod 0750 ${REMOTE_PERSIST_DIR}`);
    await exec.mkdir(REMOTE_BRANDING_DIR);
    await exec.exec(`chmod 0750 ${REMOTE_BRANDING_DIR}`);
  });
}

async function persistWebmailBlock(
  mailServerId: string,
  block: MailWebmailState,
): Promise<void> {
  await sshManager.withExecutor(mailServerId, async (exec) => {
    const state = await readState(exec);
    if (!state) {
      throw new Error(
        "Could not persist webmail state — mail state file is missing on the server.",
      );
    }
    const next: MailServerState = { ...state, webmail: block };
    await writeState(exec, next);
  });
}

/**
 * Read the existing webmail block (if any) so a redeploy can reuse the
 * branding token + session encryption key. Returns null on any failure —
 * the caller falls back to minting fresh secrets.
 */
async function readExistingWebmailBlock(
  mailServerId: string,
): Promise<{ block: MailWebmailState | null; installDomain: string | null }> {
  try {
    let block: MailWebmailState | null = null;
    let installDomain: string | null = null;
    await sshManager.withExecutor(mailServerId, async (exec) => {
      const state = await readState(exec);
      block = state?.webmail ?? null;
      installDomain = state?.domain ?? null;
    });
    return { block, installDomain };
  } catch {
    return { block: null, installDomain: null };
  }
}

/**
 * Flip the `installed` flag on the mail-state webmail block to true.
 * Called from the deployment success hook so a failed build never leaves
 * a stale "Open webmail" CTA. Returns silently if the block is missing
 * (the deploy didn't go through `startWebmailDeploy` — nothing to flip).
 *
 * The mailServerId is derived from the project slug (`webmail-<id>`) —
 * the slug is the only piece of webmail context that survives into the
 * generic deployment lifecycle.
 */
export async function markWebmailInstalled(mailServerId: string): Promise<void> {
  try {
    await sshManager.withExecutor(mailServerId, async (exec) => {
      const state = await readState(exec);
      if (!state?.webmail) return;
      const next: MailServerState = {
        ...state,
        webmail: {
          ...state.webmail,
          installed: true,
          deployedAt: new Date().toISOString(),
        },
      };
      await writeState(exec, next);
    });
  } catch (err) {
    console.warn(
      `[webmail] could not flip installed=true for ${mailServerId}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Extract the mailServerId encoded in a `webmail-<id>` project slug. */
export function mailServerIdFromWebmailSlug(slug: string): string | null {
  const m = slug.match(/^webmail-(.+)$/);
  return m?.[1] ?? null;
}

/**
 * Webmail-specific teardown that the generic project cleanup doesn't cover:
 *
 *   - The persistent branding dir on the target host (it lives outside the
 *     deploy artifact dir, since the standard pipeline wipes the workspace
 *     on every redeploy — so the generic runtime.destroy never touches it).
 *   - The `webmail` block in mail-state.json on the mail VPS, so a future
 *     re-deploy starts fresh instead of inheriting a stale brandingToken
 *     or `installed=true` flag.
 *
 * Called from project-cleanup.service after the standard manifest cleanup
 * (containers, routes, artifacts) has finished. All failures are swallowed
 * — the project rows are already soft-deleted, so a failing branding-dir
 * remove can't strand the user; it just leaves /var/lib/openship-webmail
 * behind until the next deploy reuses it.
 */
export async function cleanupWebmailInstall(input: {
  mailServerId: string;
}): Promise<void> {
  // 1. Read the webmail block to find the target host (webmail may live on
  //    a separate server from the mail VPS) BEFORE we wipe the block.
  let targetServerId: string | null = null;
  try {
    await sshManager.withExecutor(input.mailServerId, async (exec) => {
      const state = await readState(exec);
      targetServerId = state?.webmail?.targetServerId ?? null;
    });
  } catch (err) {
    console.warn(
      `[webmail] could not read mail-state on ${input.mailServerId}: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 2. Wipe the persistent branding dir on the target host.
  if (targetServerId) {
    try {
      await sshManager.withExecutor(targetServerId, async (exec) => {
        await exec.rm(REMOTE_BRANDING_DIR);
      });
    } catch (err) {
      console.warn(
        `[webmail] could not remove branding dir on ${targetServerId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 3. Strip the webmail block from mail-state on the mail VPS.
  try {
    await sshManager.withExecutor(input.mailServerId, async (exec) => {
      const state = await readState(exec);
      if (!state?.webmail) return;
      const next: MailServerState = { ...state };
      delete next.webmail;
      await writeState(exec, next);
    });
  } catch (err) {
    console.warn(
      `[webmail] could not clear mail-state webmail block on ${input.mailServerId}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// ─── Project ensure ──────────────────────────────────────────────────────────

/**
 * Find-or-create the project row for this webmail install. Keyed off the mail
 * server ID so redeploys reuse the same project. `localPath` makes the pipeline
 * stream `apps/email/` to the target instead of cloning a repo.
 */
export async function ensureWebmailProject(
  userId: string,
  mailServerId: string,
): Promise<{ projectId: string; appId: string; project: Project }> {
  const slug = `webmail-${mailServerId}`;
  const localPath = resolveLocalSourceDir();

  // Fixed config — the user can't edit these on the project row, and we
  // reconcile every deploy so old rows from earlier code paths pick up
  // fixes here. Vanilla `bun install` + `bun run build` work because
  // `apps/email/package.json` has a postinstall that installs both
  // subdirs and a top-level `build` script that builds only the client.
  const WEBMAIL_CONFIG = {
    framework: "webmail",
    packageManager: "bun",
    installCommand: "bun install",
    buildCommand: "bun run build",
    outputDirectory: "client/build/client",
    startCommand: "bun run server/src/main.ts",
    productionMode: "host" as const,
    port: DEFAULT_INTERNAL_PORT,
    hasServer: true,
    hasBuild: true,
    buildImage: "oven/bun:latest",
    localPath,
  };

  let app = await repos.projectApp.findBySlug(userId, slug);
  if (!app) {
    app = await repos.projectApp.create({
      userId,
      name: PROJECT_NAME,
      slug,
    });
  }

  let project = await repos.project.findBySlug(userId, slug);
  if (!project) {
    project = await repos.project.create({
      userId,
      appId: app.id,
      name: PROJECT_NAME,
      slug,
      environmentName: "Production",
      environmentSlug: "production",
      environmentType: "production",
      ...WEBMAIL_CONFIG,
    });
  } else {
    // Reconcile every deploy: fixed commands aren't user-editable, so a
    // divergence means we shipped a change since this row was created.
    const diverged = (Object.keys(WEBMAIL_CONFIG) as Array<keyof typeof WEBMAIL_CONFIG>).some(
      (k) => (project as Record<string, unknown>)[k] !== WEBMAIL_CONFIG[k],
    );
    if (diverged) {
      await repos.project.update(project.id, WEBMAIL_CONFIG);
      project = { ...project, ...WEBMAIL_CONFIG };
    }
  }

  return { projectId: project.id, appId: app.id, project };
}

// ─── Deploy lifecycle ────────────────────────────────────────────────────────

export interface StartWebmailDeployInput {
  userId: string;
  mailServerId: string;
  targetServerId: string;
  hostname: string;
  internalPort?: number;
}

export interface StartWebmailDeployResult {
  deploymentId: string;
  projectId: string;
}

/**
 * Drive a webmail deploy through the standard project pipeline.
 *
 * Mirrors `requestBuildAccess`'s flow step-for-step:
 *   - snapshot from project columns via `buildConfigSnapshot`
 *   - apply deploy-target / runtimeMode overrides (these are the bits the
 *     normal UI lets the user pick — we pick them programmatically)
 *   - resolve buildStrategy via `settingsService.resolveStrategy`
 *   - run preflight (port availability, custom domain validity, etc.)
 *   - `createQueuedDeployment` + `startBuild`
 *
 * The two differences vs. a normal repo deploy: the snapshot already has
 * `localPath` (no git clone) and we skip the `runsApps` mail-only refusal
 * because webmail is intentionally paired with the mail VPS.
 */
export async function startWebmailDeploy(
  input: StartWebmailDeployInput,
): Promise<StartWebmailDeployResult> {
  const internalPort = input.internalPort ?? DEFAULT_INTERNAL_PORT;
  const publicUrl = `https://${input.hostname}/`;
  const publicOrigin = `https://${input.hostname}`;

  // ── 1. Project row carries localPath + fixed build config ─────────────
  const { project, projectId } = await ensureWebmailProject(
    input.userId,
    input.mailServerId,
  );

  // ── 2. Custom hostname → project route. The standard pipeline reads
  //       this and provisions OpenResty + a Let's Encrypt cert. ─────────
  const projectDomains = await listProjectRouteRows(project.id);
  const routeState = await syncProjectRouteState(project, {
    projectDomains,
    nextPublicEndpoints: [
      {
        port: internalPort,
        customDomain: input.hostname,
        domainType: "custom",
      },
    ],
  });

  // ── 3. Branding token + session key + mail-state, persisted before
  //       deploy so the openship API can PATCH /admin/branding the
  //       moment the bun process surfaces. `installed` stays false until
  //       the deploy success hook flips it. Reuse an existing
  //       sessionEncryptionKey when redeploying so sessions survive. ───
  const { block: existingState, installDomain: mailInstallDomain } =
    await readExistingWebmailBlock(input.mailServerId);
  if (!mailInstallDomain) {
    // Without the mail VPS's install domain we can't tell Zero where IMAP /
    // SMTP live, and every webmail sign-in would fall back to
    // `mail.<userDomain>` — broken for additional domains, and a TLS-cert
    // mismatch for any user whose domain isn't the install one. Fail fast
    // here rather than ship a webmail that can't authenticate anyone.
    throw new Error(
      "Mail server install state is missing — finish the mail install before deploying webmail.",
    );
  }
  const brandingToken =
    existingState?.brandingToken ?? randomBytes(32).toString("hex");
  const sessionEncryptionKey =
    existingState?.sessionEncryptionKey ?? randomBytes(32).toString("hex");
  const webmailState: MailWebmailState = {
    installed: false,
    targetServerId: input.targetServerId,
    hostname: input.hostname,
    url: publicUrl,
    internalPort,
    brandingToken,
    sessionEncryptionKey,
    deployedAt: new Date().toISOString(),
    version: "local",
  };
  await persistWebmailBlock(input.mailServerId, webmailState);

  // ── 4. Persistent dirs on the target — branding + sqlite both live
  //       under /var/lib/openship-webmail. (Bun comes from the toolchain
  //       catalog via ensureToolchain — not from here.) ────────────────
  await prepareTarget(input.targetServerId);

  // ── 5. Build the env map in memory. Webmail env vars are fixed by
  //       openship (not user-editable in the project Env Vars UI), so we
  //       bypass the project envVar table and pass them straight to the
  //       deployment — same direct path requestBuildAccess uses for
  //       caller-supplied vars. Vite bakes VITE_PUBLIC_* at build time;
  //       the server reads the non-prefixed PUBLIC_* names at runtime.
  //       ACME_EMAIL is read by the SSL feature installer. ─────────────
  // IMAP / SMTP coordinates Zero uses to authenticate every sign-in.
  // Without these, `session.defaultMailHosts` falls back to
  // `mail.<userDomain>` per email, which:
  //   - silently breaks for any additional domain the operator added
  //     (we never publish A/AAAA for `mail.<additionalDomain>`), and
  //   - relies on `mail.<installDomain>` happening to resolve from
  //     Zero's host, which isn't guaranteed when Zero runs on the
  //     orchestrator and the mail VPS is a separate host.
  // Pinning to `mail.<installDomain>:993/465` here makes every user's
  // login route to the actual MTA, matching what `test-email.service.ts`
  // and `mail-credentials.service.ts` already use server-side.
  const mailHost = `mail.${mailInstallDomain}`;
  const plainEnvMap: Record<string, string> = {
    PORT: String(internalPort),
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    PUBLIC_BASE_URL: publicOrigin,
    PUBLIC_BACKEND_URL: publicOrigin,
    PUBLIC_APP_URL: publicOrigin,
    COOKIE_DOMAIN: input.hostname,
    TRUSTED_ORIGINS: publicOrigin,
    SESSION_ENCRYPTION_KEY: sessionEncryptionKey,
    SQLITE_PATH: REMOTE_SQLITE_PATH,
    BRANDING_PATH: REMOTE_BRANDING_DIR,
    BRANDING_ADMIN_TOKEN: brandingToken,
    DEFAULT_IMAP_HOST: mailHost,
    DEFAULT_IMAP_PORT: "993",
    DEFAULT_SMTP_HOST: mailHost,
    DEFAULT_SMTP_PORT: "465",
    VITE_PUBLIC_BACKEND_URL: publicOrigin,
    VITE_PUBLIC_APP_URL: publicOrigin,
    ACME_EMAIL: deriveAcmeEmail(input.hostname),
  };

  // ── 6. Snapshot — same helper requestBuildAccess uses. The project row
  //       is the single source of truth for build commands / port /
  //       localPath. We only override the deploy-target picker bits. ────
  const snapshot = buildConfigSnapshot(project, "main");
  snapshot.deployTarget = "server";
  snapshot.serverId = input.targetServerId;
  snapshot.runtimeMode = "bare";
  snapshot.serviceDeploymentMode = "single";
  snapshot.buildStrategy = await settingsService.resolveStrategy(
    input.userId,
    snapshot.framework,
    snapshot.buildStrategy,
  );

  // ── 7. Preflight — port availability, custom domain validity, required
  //       fields. Same call as the normal flow. ────────────────────────
  await runDeploymentPreflight(snapshot, routeState, { userId: input.userId });

  // ── 8. Encrypt + attach the env map directly to the deployment row.
  //       executeBuildAndDeploy reads dep.envVars, decrypts, and feeds
  //       them to runtime.build + runtime.deploy. ──────────────────────
  const dep = await createQueuedDeployment({
    projectId,
    userId: input.userId,
    branch: "main",
    environment: "production",
    framework: snapshot.framework,
    meta: metaWithPrevious(snapshot, project),
    envVars: encryptEnvVars(plainEnvMap),
    trigger: "manual",
  });

  // Fire-and-forget — the standard pipeline owns logging, SSE, lifecycle.
  await startBuild(dep.id, input.userId);

  return { deploymentId: dep.id, projectId };
}
