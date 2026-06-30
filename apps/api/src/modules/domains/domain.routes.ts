/**
 * Domain routes - mounted at /api/domains in app.ts.
 *
 * Every route declares a permission tag enforced by secureRouter.
 */

import { Hono } from "hono";
import { tbValidator } from "@hono/typebox-validator";
import { secureRouter } from "../../lib/secure-router";
import { cloudDomainProxy } from "../../lib/cloud/project-router";
import * as ctrl from "./domain.controller";
import { AddDomainBody } from "./domain.schema";

const r = secureRouter(new Hono(), {
  module: "domains",
  basePath: "/api/domains",
});


/* ─── Domains ──────────────────────────────────────────────────────────── */
r.get("/", { tag: "domain:list" }, ctrl.list);
r.post("/", { tag: "domain:write" }, tbValidator("json", AddDomainBody), ctrl.add);
// Side-effect-free DNS probe — POST is used to carry hostname in body.
// readOnly opts out of the scanner's "POST must be write/admin" rule.
r.post("/preview", { tag: "domain:read", readOnly: true }, ctrl.preview);
// Per-domain routes carry cloudDomainProxy (after the permission middleware):
// a domain belonging to a cloud project is proxied to the SaaS; a local domain
// falls through to the local handler.
r.delete("/:id", { tag: "domain:admin" }, cloudDomainProxy, ctrl.remove);
r.post("/:id/verify", { tag: "domain:write" }, cloudDomainProxy, ctrl.verify);
r.get("/:id/records", { tag: "domain:read" }, cloudDomainProxy, ctrl.records);
r.post("/:id/renew", { tag: "domain:write" }, cloudDomainProxy, ctrl.renewSsl);
r.post("/:id/verify-ssl", { tag: "domain:write" }, cloudDomainProxy, ctrl.verifySsl);
r.post("/renew-all", { tag: "domain:write" }, ctrl.renewAllSsl);
r.post("/verify-pending", { tag: "domain:write" }, ctrl.verifyPending);

export const domainRoutes = r.hono;
