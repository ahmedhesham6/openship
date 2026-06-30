/**
 * Service routes — mounted as sub-routes of /api/projects/:id/services.
 *
 * Every route declares a permission TAG that the secureRouter middleware
 * enforces (permission check + audit event). The boot scanner refuses
 * to start if any route lacks one.
 *
 * Cloud-as-source: the `:id` is the project id, so `cloudProjectProxy` (after
 * the permission middleware) forwards the whole request to the SaaS for a cloud
 * project, or falls through to the local handler for a local project.
 *
 * Tag conventions used here:
 *   project:service:list  — list services for a project
 *   project:service:read  — read one service
 *   project:service:write — create/update service or container actions
 *   project:service:admin — delete service
 *   project:read          — listing containers for a project (project-scoped)
 */

import { Hono } from "hono";
import { tbValidator } from "@hono/typebox-validator";
import { secureRouter } from "../../lib/secure-router";
import { cloudProjectProxy } from "../../lib/cloud/project-router";
import * as ctrl from "./service.controller";
import {
  CreateServiceBody,
  SetServiceEnvVarsBody,
  UpdateServiceBody,
} from "./service.schema";

const r = secureRouter(new Hono(), {
  module: "services",
  basePath: "/api/projects/:id/services",
});

/* Auth runs before any permission check. */

/* ─── Service CRUD ─────────────────────────────────────────────────────── */
r.get("/", { tag: "project:service:list" }, cloudProjectProxy, ctrl.list);
r.post(
  "/",
  { tag: "project:service:write" },
  cloudProjectProxy,
  tbValidator("json", CreateServiceBody),
  ctrl.create,
);
r.get(
  "/containers",
  { tag: "project:read" },
  cloudProjectProxy,
  ctrl.activeContainers,
);
r.post(
  "/sync",
  { tag: "project:service:write" },
  cloudProjectProxy,
  ctrl.syncFromCompose,
);
r.get("/:serviceId", { tag: "project:service:read" }, cloudProjectProxy, ctrl.getById);
r.get(
  "/:serviceId/logs",
  { tag: "project:service:read" },
  cloudProjectProxy,
  ctrl.runtimeLogs,
);
r.get(
  "/:serviceId/logs/stream",
  { tag: "project:service:read" },
  cloudProjectProxy,
  ctrl.runtimeLogStream,
);
r.patch(
  "/:serviceId",
  { tag: "project:service:write" },
  cloudProjectProxy,
  tbValidator("json", UpdateServiceBody),
  ctrl.update,
);
r.delete(
  "/:serviceId",
  { tag: "project:service:admin" },
  cloudProjectProxy,
  ctrl.remove,
);

/* ─── Per-service container actions ─────────────────────────────────────── */
r.post("/:serviceId/start", { tag: "project:service:write" }, cloudProjectProxy, ctrl.startContainer);
r.post("/:serviceId/stop", { tag: "project:service:write" }, cloudProjectProxy, ctrl.stopContainer);
r.post("/:serviceId/restart", { tag: "project:service:write" }, cloudProjectProxy, ctrl.restartContainer);

/* ─── Service environment variables ─────────────────────────────────────── */
r.get(
  "/:serviceId/env",
  { tag: "project:service:read" },
  cloudProjectProxy,
  ctrl.listEnvVars,
);
r.put(
  "/:serviceId/env",
  { tag: "project:service:write" },
  cloudProjectProxy,
  tbValidator("json", SetServiceEnvVarsBody),
  ctrl.setEnvVars,
);

export const serviceRoutes = r.hono;
