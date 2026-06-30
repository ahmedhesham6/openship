/**
 * Project transfer controller — HTTP wrappers around transfer.service.
 *
 *   POST /api/projects/:id/transfer/to-cloud        - local → cloud
 *   POST /api/projects/:id/transfer/to-self-hosted  - cloud → local
 *
 * Both routes are guarded by the project:admin tag in project.routes.ts.
 *
 * SCOPE: data move only. Business-logic concerns (container teardown,
 * GitHub re-binding, DNS, race-condition handling) are deferred per the
 * note in transfer.service.ts.
 */

import type { Context } from "hono";
import { param } from "../../lib/controller-helpers";
import { getRequestContext } from "../../lib/request-context";
import { safeErrorMessage } from "@repo/core";
import {
  transferProjectToSelfHosted,
  TransferAlreadyOnTargetError,
  TransferConflictError,
  TransferNotConnectedError,
  TransferCloudCallFailedError,
  TransferProjectNotFoundError,
  promoteProjectToCloud,
} from "./transfer.service";

type StatusCode = 400 | 404 | 409 | 412 | 502 | 500;

/** Coerce a thrown transfer error into a typed HTTP response. */
function transferErrorResponse(c: Context, err: unknown, fallback: string) {
  if (err instanceof TransferAlreadyOnTargetError) {
    c.status(409);
    return c.json({ error: err.message, code: err.code, side: err.side });
  }
  if (err instanceof TransferConflictError) {
    c.status(409);
    return c.json({
      error: err.message,
      code: err.code,
      conflictKind: err.conflictKind,
      conflictValue: err.conflictValue,
    });
  }
  if (err instanceof TransferNotConnectedError) {
    c.status(412);
    return c.json({ error: err.message, code: err.code });
  }
  if (err instanceof TransferCloudCallFailedError) {
    c.status(502);
    return c.json({ error: err.message, code: err.code });
  }
  if (err instanceof TransferProjectNotFoundError) {
    c.status(404);
    return c.json({ error: err.message, code: err.code });
  }
  const message = err instanceof Error ? safeErrorMessage(err) : fallback;
  c.status(500 as StatusCode);
  return c.json({ error: message });
}

/**
 * POST /api/projects/:id/transfer/to-cloud
 * Auth: project:admin
 *
 * Moves a self-hosted project's subgraph to Openship Cloud, then flips
 * `project.cloudWorkspaceId` so subsequent requests resolve via the cloud
 * workspace. Body is empty (no options today).
 */
export async function transferToCloud(c: Context) {
  const projectId = param(c, "id");
  const ctx = getRequestContext(c);
  const organizationId = ctx.organizationId;

  try {
    const result = await promoteProjectToCloud(ctx, projectId);

    if (!result.localRemoved) {
      // Cloud copy exists, but the local project couldn't be removed → drift.
      // 207 so the dashboard can warn and offer "finish local cleanup"; the
      // cloud copy is authoritative.
      return c.json(
        {
          ok: false,
          code: "PROMOTE_LOCAL_CLEANUP_FAILED",
          projectId: result.projectId,
          imported: result.imported,
          message:
            "Promoted to cloud, but local cleanup failed. Retry to remove the local copy.",
        },
        207,
      );
    }

    if (result.unrecoverableSteps > 0) {
      // Row gone, but a local resource (e.g. a leaked container) needs manual
      // cleanup. Promote succeeded; surface the stragglers.
      return c.json(
        {
          ok: true,
          projectId: result.projectId,
          imported: result.imported,
          warning: "Promoted to cloud; some local resources need manual cleanup.",
        },
        207,
      );
    }

    return c.json({
      ok: true,
      projectId: result.projectId,
      imported: result.imported,
    });
  } catch (err) {
    return transferErrorResponse(c, err, "Project transfer to cloud failed");
  }
}

/**
 * POST /api/projects/:id/transfer/to-self-hosted
 * Auth: project:admin
 *
 * Reverse of /to-cloud — pulls the project's subgraph back from the SaaS,
 * wipes the (shadow) local rows for that project, restores in merge mode,
 * clears cloudWorkspaceId.
 */
export async function transferToSelfHosted(c: Context) {
  const projectId = param(c, "id");
  const organizationId = getRequestContext(c).organizationId;

  try {
    const result = await transferProjectToSelfHosted({
      projectId,
      organizationId,
    });
    return c.json({
      ok: true,
      projectId: result.projectId,
      cloudWorkspaceId: null,
      imported: result.imported,
    });
  } catch (err) {
    return transferErrorResponse(
      c,
      err,
      "Project transfer to self-hosted failed",
    );
  }
}
