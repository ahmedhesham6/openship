/**
 * @repo/adapters - platform abstraction layer.
 *
 * Three layers, one entry point:
 *   1. Runtime  → build/deploy/stop/start lifecycle (Docker, Bare, Cloud)
 *   2. Infra    → routing (OpenResty) + SSL (certbot/ACME) - separate from runtime
 *   3. System   → prerequisite checks + setup validation (self-hosted only)
 *
 * The Platform ties them together:
 *   const { runtime, routing, ssl, system } = getPlatform();
 */

// ─── Shared types ────────────────────────────────────────────────────────────
export type {
  ResourceConfig,
  ContainerStatus,
  BuildStrategy,
  BuildConfig,
  DeployPublicEndpoint,
  DeployConfig,
  BuildResult,
  DeploymentResult,
  BuildStep,
  LogEntry,
  LogCallback,
  ContainerInfo,
  ResourceUsage,
  RouteConfig,
  SslResult,
  SshConfig,
  CommandExecutor,
  ShellOptions,
  ShellSession,
  ProvisionLock,
} from "./types";

export { BUILD_STEPS } from "./types";

export { DEFAULT_RESOURCE_CONFIG, DEFAULT_BUILD_RESOURCE_CONFIG } from "./types";

// ─── Runtime layer ───────────────────────────────────────────────────────────
export type {
  RuntimeAdapter,
  RuntimeCapability,
  MultiServiceRuntimeAdapter,
  MultiServiceGroupHandle,
  MultiServiceDeployConfig,
  MultiServiceDeployResult,
  DeploymentRef,
  RollbackInput,
  MakeActiveResult,
} from "./runtime/types";
export { assertCapability, isMultiServiceRuntime } from "./runtime/types";
export { DockerRuntime, type DockerConnectionOptions } from "./runtime/docker";
export { BareRuntime, type BareRuntimeOptions } from "./runtime/bare";
export {
  CloudRuntime,
  type CloudAdminProxy,
  PAGE_CONTAINER_PREFIX,
  provisionCloudWorkspace,
} from "./runtime/cloud";
export { BuildLogger } from "./runtime/build-pipeline";
export {
  type DeployEnvironment,
  type DeployRouting,
  type DeployPipelineInput,
  type DeployPipelineResult,
  type PromptUserFn,
  runDeployPipeline,
} from "./runtime/deploy-pipeline";
export {
  type RoutedDomainInput,
  type RouteRegistrationOptions,
  registerResolvedRoutes,
} from "./runtime/route-registration";
export {
  type PortOccupant,
  probeListeningPort,
  ensurePortAvailable,
} from "./runtime/port-conflict";
export { type RuntimeMode, type CreateRuntimeOptions, createRuntime } from "./runtime/index";
export { resolveDockerfileCandidates } from "./runtime/docker-paths";

// ─── Infrastructure layer ────────────────────────────────────────────────────
export type { RoutingProvider, SslProvider } from "./infra/types";
export { NginxProvider, type NginxProviderOptions, type RateLimitConfig } from "./infra/nginx";
export { CloudInfraProvider } from "./infra/cloud";
export { NoopInfraProvider } from "./infra/noop";
export {
  OPENRESTY_MGMT_PORT,
  deployLuaScripts,
  detectOpenRestyPaths,
  type OpenRestyPaths,
} from "./infra/openresty-lua";

// ─── System layer ────────────────────────────────────────────────────────────
export type {
  ComponentStatus,
  Feature,
  FeatureReadiness,
  InstallerConfig,
  InstallResult,
  PrerequisiteRule,
  RuntimeMode as SystemRuntimeMode,
  SystemComponentDefinition,
  SetupResult,
  SystemCheckResult,
  SystemLog,
  SystemLogCallback,
} from "./system/types";

export type { SetupState, SetupStateStore, ComponentState } from "./system/state";
export { FileStateStore } from "./system/state";

export type {
  EnvironmentProfile,
  LinuxDistro,
  SystemArch,
  SystemOs,
  SystemPackageManager,
  SystemServiceManager,
} from "./system/environment";
export { resolveEnvironment } from "./system/environment";
export { systemCatalog } from "./system/catalog";
export { SYSTEM_COMPONENTS, getSystemComponentDefinition } from "./system/components";
export {
  isRemoteConnectionError,
  isRetryableRemoteConnectionError,
  isSshAuthError,
  isRuntimeNotFoundError,
  isSshDisconnectedError,
  SshDisconnectedError,
} from "./system/errors";
export { probeTcp, probeHttp, waitForReady } from "./system/reachability";

export { LocalExecutor, SshExecutor, SystemSshExecutor, createExecutor } from "./system/executor";
export {
  ensureRemoteJournal,
  runJournaled,
  runReliable,
  execReliable,
  parseFrame,
  OpInterruptedError,
  OPSH_RUN_VERSION,
  REMOTE_ENV_PREFIX,
  type JournalRunResult,
  type RunJournaledOptions,
  type ReliableRunResult,
  type RunReliableOptions,
} from "./system/remote-journal";

export {
  checkAll as checkAllComponents,
  checkComponents,
  checkCertbot,
  checkDocker,
  checkGit,
  checkOpenResty,
  COMPONENT_CHECKS,
} from "./system/checks";
export {
  COMPONENT_INSTALLERS,
  COMPONENT_UNINSTALLERS,
  getRemovalSupport,
  installCertbot,
  installDocker,
  installGit,
  installOpenResty,
  installRsync,
  uninstallCertbot,
  uninstallOpenResty,
  uninstallRsync,
} from "./system/installer";
export { SystemManager, type SystemManagerOptions } from "./system/setup";

// ─── Toolchain layer ────────────────────────────────────────────────────────
export type {
  ToolchainStatus,
  ToolchainCheckResult,
  ToolchainCheckEntry,
  ToolchainInstallPlan,
  ToolchainInstallResult,
} from "./toolchain";

export { toolchainCatalog } from "./toolchain";
export { checkTool, checkTools, checkToolchain, checkToolchainForStack } from "./toolchain";
export { installTool, installTools } from "./toolchain";

// ─── Dockerfile planning ────────────────────────────────────────────────────
export type {
  CompileDockerfileOptions,
  DockerfileCommandForm,
  DockerfileInstruction,
  DockerfileInstructionKeyword,
  DockerfileParseResult,
  WorkspaceBuildPlan,
  WorkspaceBuildStagePlan,
  WorkspaceCommand,
  WorkspaceCopyStep,
  WorkspaceExposedPort,
  WorkspacePlanDiagnostic,
  WorkspacePlanSeverity,
  WorkspaceRuntimePlan,
  WorkspaceRunStep,
  WorkspaceStageStep,
} from "./dockerfile";
export {
  compileDockerfileParseResult,
  compileDockerfileToWorkspacePlan,
  parseDockerfile,
} from "./dockerfile";

// ─── Platform (top-level entry point) ────────────────────────────────────────
export type { PlatformTarget, PlatformConfig, Platform } from "./platform";
export { createPlatform, initPlatform, getPlatform, resetPlatform } from "./platform";

// ─── Oblien SDK (re-export for single source of truth) ───────────────────────
export { Oblien } from "oblien";
export type {
  NamespaceUsageUnits,
  NamespaceUsageUnitBucket,
  NamespaceUsageUnitsParams,
} from "oblien";

// ─── Backup adapters (importing the index seeds all three registries) ───────
export * from "./backup";
