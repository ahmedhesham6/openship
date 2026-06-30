/**
 * GitHub webhook push events — branch-matched redeployment.
 */

import { repos, type Project } from "@repo/db";
import { triggerDeployment } from "../deployments/build.service";
import {
  compareCommits,
  getRepository,
} from "./github.service";
import { safeErrorMessage } from "@repo/core";
import {
  extractChangedFiles,
  routeServicesByChanges,
} from "./webhook-changed-files";
import { webhookActorCtx } from "./webhook-shared";
import { resolveOrgOwner } from "../../lib/org-actor";
import type { WebhookHandlerResult } from "../webhooks/webhook.types";
import type { GitHubPushPayload } from "./github.types";

// ─── Deployment deduplication ────────────────────────────────────────────────

const activeBranchDeployments = new Set<string>();

// ─── Branch deployment events ────────────────────────────────────────────────

export async function handlePush(payload: GitHubPushPayload): Promise<WebhookHandlerResult> {
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const ref = payload.ref;
  const commitSha = payload.head_commit?.id;
  const defaultBranch = payload.repository?.default_branch;

  if (!owner || !repo) {
    return { success: false, event: "push", error: "Missing repository info in payload" };
  }

  if (payload.deleted) {
    return { success: true, event: "push", message: "Ignoring deleted branch push" };
  }

  if (!ref?.startsWith("refs/heads/")) {
    return { success: true, event: "push", message: `Ignoring non-branch ref: ${ref ?? "unknown"}` };
  }

  const branch = ref.replace("refs/heads/", "");

  return triggerBranchDeployments({
    event: "push",
    owner,
    repo,
    branch,
    defaultBranch,
    commitSha,
    commitMessage: payload.head_commit?.message,
    payload,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface BranchDeploymentTrigger {
  event: "push";
  owner: string;
  repo: string;
  branch: string;
  defaultBranch?: string | null;
  commitSha?: string;
  commitMessage?: string;
  /** Raw push payload — needed for smart per-service routing. */
  payload?: GitHubPushPayload;
}

async function deployProjectFromPush(
  p: Project,
  input: BranchDeploymentTrigger,
) {
  // Webhooks have no human actor — attribute to the org OWNER (owns the
  // GitHub App installation + is the meaningful audit actor). No owner =
  // broken org state; fail rather than guess a random member.
  const owner = await resolveOrgOwner(p.organizationId).catch(() => null);
  if (!owner) {
    throw new Error(
      `No org owner available to act as webhook actor for project ${p.id} (org ${p.organizationId})`,
    );
  }
  const actorUserId = owner.userId;

  // ── Smart per-service routing ────────────────────────────────
  // Load services so we can answer "what changed in this push,
  // and which services does it affect?". For force-deploy paths
  // (forceAll / forceDeployNext / single-service projects with
  // no affected services) we just deploy everything.
  const services = await repos.service.listByProject(p.id).catch(() => []);
  const enabledServices = services.filter((s) => s.enabled);

  // Treat compose- and monorepo-kind services as "real" routable
  // services. A project with zero such rows is a single-app
  // project and always rebuilds (no smart routing to do).
  const routableServices = enabledServices.filter(
    (s) => s.kind === "compose" || s.kind === "monorepo",
  );

  let serviceIds: string[] | undefined;
  let forceAll = false;
  let routingReason: string | undefined;
  let changedPathsTruncated = false;
  let changedPaths: string[] | undefined;

  if (input.payload) {
    const extracted = await extractChangedFiles(input.payload, {
      isMonorepo:
        p.framework === "monorepo" || routableServices.length > 0,
      monorepoSharedPaths: p.monorepoSharedPaths,
      compareCommits: async (owner, repo, base, head) =>
        compareCommits(
          webhookActorCtx(actorUserId, p.organizationId ?? "", "webhook:compare-commits"),
          owner,
          repo,
          base,
          head,
        ),
    });

    forceAll = extracted.forceAll;
    routingReason = extracted.reason;
    changedPathsTruncated = extracted.truncated ?? false;
    changedPaths = Array.from(extracted.files);
    if (changedPathsTruncated) {
      console.warn(
        `[GitHub Webhook] ${input.owner}/${input.repo}#${input.branch} project ${p.id}: changed-files set is truncated (commits[] >= 20 and compareCommits could not recover the full list) — downstream deploy may miss some changes.`,
      );
    }

    // Honor the project-level one-shot "rebuild everything next
    // time" flag and clear it in the same tick. Atomic compare-and-set
    // so two concurrent webhooks can't both observe `true` and
    // double-fire force.
    const consumed = await repos.project
      .consumeForceDeployNext(p.id)
      .catch(() => false);
    if (consumed) {
      forceAll = true;
      routingReason = routingReason ?? "force-deploy-next";
    }

    if (!forceAll && routableServices.length > 0) {
      const routed = routeServicesByChanges(routableServices, extracted.files);
      if (routed.mode === "skip") {
        // No services affected → skip the deploy entirely. (mode "all" can't
        // occur here since routableServices.length > 0.)
        console.log(
          `[GitHub Webhook] ${input.owner}/${input.repo}#${input.branch} project ${p.id}: no services affected by ${extracted.files.size} changed file(s) — skipping deploy.`,
        );
        return { skipped: true as const, projectId: p.id };
      }
      if (routed.mode === "services") {
        serviceIds = routed.serviceIds;
      }
    }
  } else {
    // No payload was passed (manual trigger path going through this
    // code). Atomically consume the flag — same compare-and-set as
    // the payload branch — so concurrent manual triggers can't both
    // observe it `true`.
    const consumed = await repos.project
      .consumeForceDeployNext(p.id)
      .catch(() => false);
    if (consumed) {
      forceAll = true;
      routingReason = "force-deploy-next";
    }
  }

  if (routingReason) {
    console.log(
      `[GitHub Webhook] ${input.owner}/${input.repo}#${input.branch} project ${p.id}: forceAll=true (${routingReason})`,
    );
  }

  // Rollback context (strategy + commit_sha_before anchor) is resolved inside
  // triggerDeployment via the shared resolveRollbackContext helper — no need to
  // recompute it here.
  const triggered = await triggerDeployment(
    webhookActorCtx(actorUserId, p.organizationId, "webhook:github-push"),
    {
      projectId: p.id,
      branch: input.branch,
      commitSha: input.commitSha,
      commitMessage: input.commitMessage,
      trigger: "webhook",
      serviceIds,
      forceAll,
    },
  );

  // Persist changed-files snapshot onto the deployment row so the
  // dashboard and downstream consumers can see the path set + the
  // truncation flag. Best-effort — never roll back the trigger.
  if (triggered?.deployment?.id && (changedPaths || changedPathsTruncated)) {
    const deploymentId = triggered.deployment.id;
    await repos.deployment
      .setChangedPaths(
        deploymentId,
        changedPaths && changedPaths.length > 0 ? changedPaths : null,
        changedPathsTruncated,
      )
      .catch((err: unknown) => {
        console.warn(
          `[GitHub Webhook] failed to persist changedPaths for ${deploymentId}:`,
          err,
        );
      });
  }

  return triggered;
}

async function triggerBranchDeployments(
  input: BranchDeploymentTrigger,
): Promise<WebhookHandlerResult> {
  const deploymentKey = branchDeploymentKey(input);

  if (activeBranchDeployments.has(deploymentKey)) {
    return {
      success: true,
      event: input.event,
      message: `Already handled deployment trigger for ${input.owner}/${input.repo}#${input.branch}`,
    };
  }

  activeBranchDeployments.add(deploymentKey);

  try {
    const projects = await repos.project.findByGitRepo(input.owner, input.repo);
    const defaultBranch = await resolveDefaultBranch(input, projects);
    const autoDeployProjects = projects.filter(
      (p) => p.autoDeploy && projectWebhookBranch(p, defaultBranch) === input.branch,
    );

    if (autoDeployProjects.length === 0) {
      // No matching LOCAL project. This is an intentional no-op, not an error:
      // cloud-as-source projects are canonical on the SaaS and use the GitHub
      // App, so GitHub delivers their pushes to the SaaS (which deploys them) —
      // never to this self-hosted box. A self-hosted box only auto-deploys the
      // local projects whose repo/domain webhook points at it. (Auto-deploy for
      // a REPO-strategy project that was later promoted to cloud is a known
      // follow-up: its webhook should be re-bound to the SaaS App.)
      console.log(
        `[GitHub Webhook] ${input.event} for ${input.owner}/${input.repo}#${input.branch} - no matching LOCAL auto-deploy project (cloud projects deploy via the SaaS)`,
      );
      return { success: true, event: input.event, message: "No local auto-deploy projects matched" };
    }

    const results = await Promise.allSettled(
      autoDeployProjects.map((p) => deployProjectFromPush(p, input)),
    );

    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (
          r.value &&
          typeof r.value === "object" &&
          "skipped" in r.value &&
          (r.value as { skipped: boolean }).skipped
        ) {
          skipped++;
        } else {
          succeeded++;
        }
      } else {
        failed++;
      }
    }

    if (failed > 0) {
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String(r.reason));
      console.error(
        `[GitHub Webhook] ${input.event} deploy failures for ${input.owner}/${input.repo}#${input.branch}:`,
        errors,
      );
    }

    return {
      success: true,
      event: input.event,
      message:
        `Triggered ${succeeded} deployment(s) for ${input.owner}/${input.repo}#${input.branch}` +
        `${skipped ? `, ${skipped} skipped (no affected services)` : ""}` +
        `${failed ? `, ${failed} failed` : ""}`,
    };
  } finally {
    activeBranchDeployments.delete(deploymentKey);
  }
}

function projectWebhookBranch(project: Project, defaultBranch?: string | null): string | null {
  return project.gitBranch?.trim() || defaultBranch?.trim() || null;
}

async function resolveDefaultBranch(
  input: BranchDeploymentTrigger,
  projects: Project[],
): Promise<string | null> {
  const payloadDefaultBranch = input.defaultBranch?.trim();
  if (payloadDefaultBranch) return payloadDefaultBranch;

  const unbranchedProject = projects.find(
    (p) => !p.gitBranch?.trim() && p.gitOwner && p.gitRepo,
  );
  if (!unbranchedProject) return null;

  try {
    const owner = await resolveOrgOwner(unbranchedProject.organizationId).catch(() => null);
    if (!owner) return null;
    const repository = await getRepository(
      webhookActorCtx(owner.userId, unbranchedProject.organizationId, "webhook:github-resolve-default-branch"),
      input.owner,
      input.repo,
    );
    return repository.default_branch;
  } catch (err) {
    const message = safeErrorMessage(err);
    console.warn(
      `[GitHub Webhook] Could not resolve default branch for ${input.owner}/${input.repo}: ${message}`,
    );
    return null;
  }
}

function branchDeploymentKey(input: BranchDeploymentTrigger): string {
  const commit = input.commitSha?.trim() || "unknown";
  return `${input.owner}/${input.repo}#${input.branch}@${commit}`.toLowerCase();
}
