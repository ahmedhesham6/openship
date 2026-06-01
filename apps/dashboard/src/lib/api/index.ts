/**
 * @module @/lib/api
 *
 * Centralised API layer for the Openship dashboard.
 *
 * Usage:
 *   import { projectsApi, deployApi, githubApi } from "@/lib/api";
 *   const { projects, numbers } = await projectsApi.getHome();
 */

/* --- Low-level client (rarely needed directly) -------------------- */
export {
	api,
	ApiError,
	getApiErrorMessage,
	isAbortError,
	isNetworkError,
	setNetworkErrorHandler,
	getApiBaseUrl,
} from "./client";
export type { RequestOptions } from "./client";

/* --- Endpoint registry (single source of truth for paths) --------- */
export { endpoints } from "./endpoints";

/* --- Domain services ---------------------------------------------- */
export { projectsApi } from "./projects";
export { deployApi } from "./deploy";
export { domainsApi } from "./domains";
export { githubApi } from "./github";
export { iconsApi } from "./icons";
export { imagesApi } from "./images";
export type { ImageCatalogEntry, ListImagesResponse } from "./images";
export { aiApi } from "./ai";
export { sandboxApi } from "./sandbox";
export { systemApi } from "./system";
export { settingsApi } from "./settings";
export type {
  BuildMode,
  UserSettingsResponse,
  DefaultDeployTarget,
  DeployDefaultsResponse,
} from "./settings";
export { cloudApi } from "./cloud";
export type { CloudStatus } from "./cloud";
export { servicesApi } from "./services";
export type { Service, ServiceContainer, ServiceEnvVar, ServiceInput } from "./services";
export { mailApi } from "./mail";
export { mailAdminApi } from "./mail-admin";
export type {
  AdminDomain,
  AdminMailbox,
  CreateDomainPayload,
  UpdateDomainPayload,
  CreateMailboxPayload,
  UpdateMailboxPayload,
  DomainDependents,
  AdditionalDomainDnsState,
  MailServerStats,
  DnsCheck,
  DnsCheckStatus,
  DnsScanResult,
  ComponentAction,
  ComponentActionResult,
  ComponentLogs,
  BulkRestartResult,
} from "./mail-admin";
export type {
  MailSetupStep,
  MailStepStatus,
  MailSetupStatus,
  MailCredentials,
  MailWebmailSummary,
  DnsRecord,
  DnsRecords,
  MailSSEEvent,
  PortConflict,
  PortResolution,
  PortUsage,
  MailComponentHealth,
  MailComponentStatus,
  MailComponentDef,
  MailHealthResponse,
  Branding,
  WebmailTargetOption,
} from "./mail";

/* --- Auth helpers -------------------------------------------------- */
export { getAuthToken } from "./auth";
