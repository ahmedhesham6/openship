import type { Context } from "hono";
import { getUserId } from "../../lib/controller-helpers";
import { repos } from "@repo/db";
import { randomBytes } from "node:crypto";
import {
  getBuildMode,
  getDeployDefaults,
  isValidDefaultDeployTarget,
  type BuildMode,
} from "./settings.service";

const VALID_MODES: BuildMode[] = ["auto", "server", "local"];

function generateId() {
  return "us_" + randomBytes(12).toString("base64url");
}

/** GET / — return platform settings for the authenticated user */
export async function get(c: Context) {
  const userId = getUserId(c);
  const [buildMode, deployDefaults] = await Promise.all([
    getBuildMode(userId),
    getDeployDefaults(userId),
  ]);
  return c.json({ buildMode, ...deployDefaults });
}

/** PUT / — create or update platform settings */
export async function upsert(c: Context) {
  const userId = getUserId(c);
  const body = await c.req.json();

  const buildMode = body.buildMode || "auto";
  if (!VALID_MODES.includes(buildMode)) {
    return c.json({ error: "buildMode must be 'auto', 'server', or 'local'" }, 400);
  }

  const row = await repos.settings.upsert({
    id: generateId(),
    userId,
    buildMode,
  });

  return c.json({
    buildMode: row.buildMode,
    defaultDeployTarget: isValidDefaultDeployTarget(row.defaultDeployTarget)
      ? row.defaultDeployTarget
      : null,
    defaultServerId: row.defaultServerId ?? null,
  });
}

/** PATCH /build-mode — update just the build mode preference */
export async function updateBuildMode(c: Context) {
  const userId = getUserId(c);
  const { buildMode } = await c.req.json();

  if (!VALID_MODES.includes(buildMode)) {
    return c.json({ error: "buildMode must be 'auto', 'server', or 'local'" }, 400);
  }

  const existing = await repos.settings.findByUser(userId);
  if (!existing) {
    await repos.settings.upsert({ id: generateId(), userId, buildMode });
  } else {
    await repos.settings.update(userId, { buildMode });
  }

  return c.json({ buildMode });
}

/**
 * PATCH /deploy-defaults — set/clear the user's default deploy target.
 *
 * Body shape:
 *   { defaultDeployTarget: "local" | "server" | "cloud" | null,
 *     defaultServerId?: string | null }
 *
 * Pass nulls to clear. When target="server", defaultServerId is required;
 * for other targets the server id is forced to null on the server side so
 * the row doesn't carry a stale association.
 */
export async function updateDeployDefaults(c: Context) {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));

  const rawTarget = body?.defaultDeployTarget;
  const target = rawTarget === null || rawTarget === undefined
    ? null
    : (isValidDefaultDeployTarget(rawTarget) ? rawTarget : "__invalid__");

  if (target === "__invalid__") {
    return c.json(
      { error: "defaultDeployTarget must be 'local', 'server', 'cloud', or null" },
      400,
    );
  }

  let serverId: string | null = null;
  if (target === "server") {
    const rawServerId = body?.defaultServerId;
    if (typeof rawServerId !== "string" || !rawServerId) {
      return c.json(
        { error: "defaultServerId is required when defaultDeployTarget='server'" },
        400,
      );
    }
    serverId = rawServerId;
  }

  const existing = await repos.settings.findByUser(userId);
  if (!existing) {
    await repos.settings.upsert({
      id: generateId(),
      userId,
      buildMode: "auto",
      defaultDeployTarget: target,
      defaultServerId: serverId,
    });
  } else {
    await repos.settings.update(userId, {
      defaultDeployTarget: target,
      defaultServerId: serverId,
    });
  }

  return c.json({ defaultDeployTarget: target, defaultServerId: serverId });
}
