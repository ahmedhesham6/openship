/**
 * Deployment routes - mounted at /api/deployments in app.ts.
 *
 * Every route declares a permission tag enforced by secureRouter.
 */

import { Hono } from "hono";
import { secureRouter } from "../../lib/secure-router";
import { cloudDeploymentProxy, cloudProjectProxyByQuery } from "../../lib/cloud/project-router";
import * as ctrl from "./deployment.controller";

const r = secureRouter(new Hono(), {
  module: "deployments",
  basePath: "/api/deployments",
});


/* ── CRUD + operations ─────────────────────────────────────────────── */
// ?projectId=<cloud project> proxies to the SaaS; org-wide list stays local.
r.get("/", { tag: "deployment:list" }, cloudProjectProxyByQuery, ctrl.list);
// Collection-scoped writes — no :id in the URL, controller resolves the
// project from the JSON body. `collection: true` tells the permission
// middleware to scope the check to the caller's org rather than demand
// a :id param it can't supply.
r.post("/", { tag: "deployment:write", collection: true }, ctrl.create);
r.post("/prepare", { tag: "deployment:write", collection: true }, ctrl.prepare);

/* ── Build access (creates a new deployment - no ID yet) ───────────── */
r.post("/build/access", { tag: "deployment:write", collection: true }, ctrl.buildAccess);

/* ── SSL ───────────────────────────────────────────────────────────── */
// Side-effect-free SSL status probe — uses POST only to carry hostname
// in body. Permission required is "read"; readOnly tells the scanner
// the POST + read combination is intentional.
r.post("/ssl/status", { tag: "deployment:read", readOnly: true }, ctrl.sslStatus);
r.post("/ssl/renew", { tag: "deployment:write", collection: true }, ctrl.sslRenew);

/* ── Deployment by ID ──────────────────────────────────────────────── */
// cloudDeploymentProxy (after the permission middleware) forwards the request
// to the SaaS when the deployment belongs to a cloud project, else falls
// through to the local handler.
r.get("/:id", { tag: "deployment:read" }, cloudDeploymentProxy, ctrl.getById);
r.get("/:id/logs", { tag: "deployment:read" }, cloudDeploymentProxy, ctrl.logs);
r.get("/:id/stream", { tag: "deployment:read" }, cloudDeploymentProxy, ctrl.stream);
r.get("/:id/build", { tag: "deployment:read" }, cloudDeploymentProxy, ctrl.buildStatus);
r.post("/:id/build", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.buildStart);
r.post("/:id/redeploy", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.buildRedeploy);
r.post("/:id/rollback", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.rollback);
r.post("/:id/pin", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.pin);
r.post("/:id/reject", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.reject);
r.post("/:id/cancel", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.cancel);
r.delete("/:id", { tag: "deployment:admin" }, cloudDeploymentProxy, ctrl.remove);
r.post("/:id/restart", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.restart);
r.post("/:id/build/respond", { tag: "deployment:write" }, cloudDeploymentProxy, ctrl.buildRespond);
r.get("/:id/info", { tag: "deployment:read" }, cloudDeploymentProxy, ctrl.containerInfo);
r.get("/:id/usage", { tag: "deployment:read" }, cloudDeploymentProxy, ctrl.containerUsage);

export const deploymentRoutes = r.hono;
