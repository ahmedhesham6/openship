/**
 * Project routes - mounted at /api/projects in app.ts.
 *
 * Every route declares a permission tag enforced by secureRouter
 * middleware (check + audit emission). The boot scanner refuses to
 * start if any route lacks one.
 *
 * Cloud-as-source: per-`:id` project routes carry `cloudProjectProxy`
 * (mounted AFTER the permission middleware). For a project that is canonical
 * on the SaaS (no local row), it forwards the request to the SaaS as the org
 * owner and returns that response; for a local project it falls through to the
 * local handler. See lib/cloud/project-router.ts.
 */

import { Hono } from "hono";
import { localOnly } from "../../middleware";
import { secureRouter } from "../../lib/secure-router";
import { cloudProjectProxy } from "../../lib/cloud/project-router";
import * as ctrl from "./project.controller";
import * as transfer from "./transfer.controller";

const r = secureRouter(new Hono(), {
  module: "projects",
  basePath: "/api/projects",
});

/* All project routes require authentication. The route-level
   `requirePermission` middleware (mounted automatically by secureRouter)
   loads each resource and validates org membership via the resource's
   own `organization_id` — no session-mutating auto-switch needed. */

/* ─── Local-only routes (hidden in cloud mode) ─────────────────────────── */
r.get("/local", { tag: "project:list" }, localOnly, ctrl.listLocal);
// Collection-scoped writes: org from request (X-Organization-Id or
// session default); no :id in the URL — the controller resolves the
// project from the JSON body. `collection: true` keeps the existing
// :id-required default safe for per-resource routes below.
r.post("/scan", { tag: "project:write", collection: true }, localOnly, ctrl.scanLocal);
r.post("/import", { tag: "project:write", collection: true }, localOnly, ctrl.importLocal);

/* ─── Top-level project operations ─────────────────────────────────────── */
// getHome merges local + cloud projects server-side; create/ensure stay local
// for now (promote-to-cloud lives on /:id/transfer/to-cloud).
r.get("/home", { tag: "project:list" }, ctrl.getHome);
r.post("/ensure", { tag: "project:write", collection: true }, ctrl.ensure);
r.get("/", { tag: "project:list" }, ctrl.list);
r.post("/", { tag: "project:write", collection: true }, ctrl.create);

/* ─── Projects CRUD ────────────────────────────────────────────────────── */
r.get("/:id", { tag: "project:read" }, cloudProjectProxy, ctrl.getById);
r.patch("/:id", { tag: "project:write" }, cloudProjectProxy, ctrl.update);
r.delete("/:id", { tag: "project:admin" }, cloudProjectProxy, ctrl.remove);
r.get("/:id/info", { tag: "project:read" }, cloudProjectProxy, ctrl.getInfo);
r.get("/:id/environments", { tag: "project:read" }, cloudProjectProxy, ctrl.listEnvironments);
r.post("/:id/environments", { tag: "project:write" }, cloudProjectProxy, ctrl.createEnvironment);
r.get("/:id/deletion-preview", { tag: "project:read" }, cloudProjectProxy, ctrl.deletionPreview);

/* ─── Build options ────────────────────────────────────────────────────── */
r.post("/:id/options", { tag: "project:write" }, cloudProjectProxy, ctrl.setOptions);

/* ─── Enable / Disable ─────────────────────────────────────────────────── */
r.post("/:id/enable", { tag: "project:write" }, cloudProjectProxy, ctrl.enable);
r.post("/:id/disable", { tag: "project:write" }, cloudProjectProxy, ctrl.disable);

/* ─── Environment variables ────────────────────────────────────────────── */
// Project-scoped bulk routes (no per-env_var id in the URL) → gate on the
// project, matching what the controllers already assert (permission.assert
// project:read/write) and how /:id/options works. The previous
// project:env_var:* tags required a :envVarId param these routes don't have,
// so the permission middleware 400'd before the handler. Secret VALUES stay
// protected by masking in listEnvVars, not by the route tag.
r.get("/:id/env", { tag: "project:read" }, cloudProjectProxy, ctrl.listEnvVars);
// Project env edits go through the MERGE path (PATCH) only — the old destructive
// full-replace PUT was removed (it could wipe/corrupt masked secrets and had no
// remaining caller; the editor sends a diff via mergeEnvVars).
r.patch("/:id/env", { tag: "project:write" }, cloudProjectProxy, ctrl.mergeEnvVars);

/* ─── Per-project clone token (git credential override) ────────────────── */
r.get("/:id/clone-token", { tag: "project:read" }, cloudProjectProxy, ctrl.getCloneToken);
r.patch("/:id/clone-token", { tag: "project:admin" }, cloudProjectProxy, ctrl.updateCloneToken);

/* ─── Git ──────────────────────────────────────────────────────────────── */
r.get("/:id/git", { tag: "project:read" }, cloudProjectProxy, ctrl.getGitInfo);
r.get("/:id/commit-status", { tag: "project:read" }, cloudProjectProxy, ctrl.getCommitStatus);
r.post("/:id/git/link", { tag: "project:write" }, cloudProjectProxy, ctrl.linkRepo);
r.get("/:id/branches", { tag: "project:read" }, cloudProjectProxy, ctrl.listBranches);
r.post("/:id/auto-deploy", { tag: "project:write" }, cloudProjectProxy, ctrl.setAutoDeploy);
r.post("/:id/webhook-domain", { tag: "project:write" }, cloudProjectProxy, ctrl.setWebhookDomain);
r.post("/:id/branch", { tag: "project:write" }, cloudProjectProxy, ctrl.setBranch);

/* ─── Resources ────────────────────────────────────────────────────────── */
r.get("/:id/resources", { tag: "project:read" }, cloudProjectProxy, ctrl.getResources);
r.patch("/:id/resources", { tag: "project:write" }, cloudProjectProxy, ctrl.updateResources);
r.post("/:id/resources", { tag: "project:write" }, cloudProjectProxy, ctrl.updateResources);

/* ─── Sleep mode ───────────────────────────────────────────────────────── */
r.post("/:id/sleep-mode", { tag: "project:write" }, cloudProjectProxy, ctrl.setSleepMode);

/* ─── Deployments ──────────────────────────────────────────────────────── */
r.get("/:id/deployments", { tag: "project:deployment:list" }, cloudProjectProxy, ctrl.listDeployments);
r.post("/:id/deployment-session", { tag: "project:deployment:write" }, cloudProjectProxy, ctrl.deploymentSession);

/* ─── Custom domain ────────────────────────────────────────────────────── */
r.post("/:id/connect", { tag: "project:domain:write" }, cloudProjectProxy, ctrl.connectDomain);

/* ─── Runtime logs ─────────────────────────────────────────────────────── */
r.get("/:id/logs", { tag: "project:read" }, cloudProjectProxy, ctrl.runtimeLogs);
r.get("/:id/logs/stream", { tag: "project:read" }, cloudProjectProxy, ctrl.runtimeLogStream);

/* ─── Server HTTP request logs ─────────────────────────────────────────── */
r.get("/:id/server-logs/recent", { tag: "project:read" }, cloudProjectProxy, ctrl.recentServerLogs);
r.get("/:id/server-logs/stream-token", { tag: "project:read" }, cloudProjectProxy, ctrl.serverLogStreamToken);
r.get("/:id/server-logs/stream", { tag: "project:read" }, cloudProjectProxy, ctrl.serverLogStream);

/* ─── Project transfer / promote (local → cloud) ───────────────────────── */
// Self-hosted ONLY: promote pushes a LOCAL project to the SaaS, and bring-home
// pulls it back. Meaningless on the SaaS itself (it IS the cloud), so localOnly
// 404s them there — never proxied, never run in CLOUD_MODE.
r.post("/:id/transfer/to-cloud", { tag: "project:admin" }, localOnly, transfer.transferToCloud);
r.post("/:id/transfer/to-self-hosted", { tag: "project:admin" }, localOnly, transfer.transferToSelfHosted);

export const projectRoutes = r.hono;
