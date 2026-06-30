/**
 * Analytics routes - mounted at /api/analytics in app.ts.
 *
 * All routes require authentication. Every route declares a permission
 * tag enforced by secureRouter middleware (check + audit emission).
 */

import { Hono } from "hono";
import { secureRouter } from "../../lib/secure-router";
import { cloudProjectProxyByQuery } from "../../lib/cloud/project-router";
import * as ctrl from "./analytics.controller";

const r = secureRouter(new Hono(), {
  module: "analytics",
  basePath: "/api/analytics",
});

/* All analytics routes require authentication. Project-scoped analytics carry
   the project id in the QUERY (?projectId=), so cloudProjectProxyByQuery (after
   the permission middleware) forwards them to the SaaS for a cloud project and
   no-ops for org-wide requests. */

/* ─── Request analytics ────────────────────────────────────────────────── */
r.get("/", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.summary);
r.get("/periods", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.periods);
r.get("/overview", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.overview);

/* ─── Deployment stats ─────────────────────────────────────────────────── */
r.get("/deployments", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.deploymentStats);

/* ─── Resource usage ───────────────────────────────────────────────────── */
r.get("/usage", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.usage);
r.get("/usage/stream", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.usageStream);
r.get("/container", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.containerInfo);

/* ─── Dashboard ────────────────────────────────────────────────────────── */
r.get("/dashboard", { tag: "analytics:read" }, cloudProjectProxyByQuery, ctrl.dashboard);

/* ─── Server analytics (scraped from OpenResty mgmt API) ───────────────── */
r.get(
  "/server/:serverId",
  { tag: "server:read", ids: { server: "serverId" } },
  ctrl.serverAnalytics,
);
r.get(
  "/server/:serverId/geo",
  { tag: "server:read", ids: { server: "serverId" } },
  ctrl.serverGeo,
);
r.get(
  "/server/:serverId/live",
  { tag: "server:read", ids: { server: "serverId" } },
  ctrl.serverAnalyticsLive,
);

export const analyticsRoutes = r.hono;
