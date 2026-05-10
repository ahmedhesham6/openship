import { DASHBOARD_RUNTIME_TARGETS } from "@repo/core";

type RuntimeTarget = (typeof DASHBOARD_RUNTIME_TARGETS)[number];

type DeploymentInfoFallback = Pick<RuntimeTarget, "selfHosted" | "deployMode" | "authMode"> & {
  cloudAuthUrl: string;
};

const API_PATH_SUFFIX = "/api";
const AUTH_PATH_SUFFIX = "/api/auth";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function stripApiSuffix(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized.endsWith(AUTH_PATH_SUFFIX)) {
    return normalized.slice(0, -AUTH_PATH_SUFFIX.length) || "/";
  }

  if (normalized.endsWith(API_PATH_SUFFIX)) {
    return normalized.slice(0, -API_PATH_SUFFIX.length) || "/";
  }

  return normalized;
}

function parseHttpUrl(rawUrl: string, source?: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    if (source) {
      throw new Error(`${source} must be a valid http(s) URL.`);
    }
    return undefined;
  }
}

function toNormalizedOrigin(url: URL) {
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeOrigin(rawUrl: string, source?: string) {
  const url = parseHttpUrl(rawUrl, source);
  if (!url) {
    return undefined;
  }

  url.pathname = "/";
  return toNormalizedOrigin(url);
}

function normalizeApiOrigin(rawUrl: string, source?: string) {
  const url = parseHttpUrl(rawUrl, source);
  if (!url) {
    return undefined;
  }

  url.pathname = stripApiSuffix(url.pathname);
  return toNormalizedOrigin(url);
}

const KNOWN_RUNTIME_TARGETS = DASHBOARD_RUNTIME_TARGETS.map((target) => ({
  ...target,
  dashboardOrigin: normalizeOrigin(target.dashboard, `dashboard target ${target.id}`)!,
  apiOrigin: normalizeApiOrigin(target.api, `api target ${target.id}`)!,
  apiSiteOrigin: normalizeOrigin(target.api, `api site target ${target.id}`)!,
}));
type KnownRuntimeTarget = (typeof KNOWN_RUNTIME_TARGETS)[number];

const DEFAULT_RUNTIME_TARGET = KNOWN_RUNTIME_TARGETS.find(({ id }) => id === "local") ?? KNOWN_RUNTIME_TARGETS[0];

if (!DEFAULT_RUNTIME_TARGET) {
  throw new Error("At least one dashboard runtime target must be configured.");
}

function resolveRuntimeTargetByApiOrigin(apiOrigin: string) {
  return KNOWN_RUNTIME_TARGETS.find(({ apiOrigin: knownApiOrigin }) => knownApiOrigin === apiOrigin);
}

function resolveRuntimeTarget(rawUrl?: string) {
  if (!rawUrl) {
    return undefined;
  }

  const parsedUrl = parseHttpUrl(rawUrl);
  if (parsedUrl && !isProduction()) {
    const cloudTarget = KNOWN_RUNTIME_TARGETS.find(({ id }) => id === "cloud-saas");
    if (
      cloudTarget &&
      (parsedUrl.hostname === new URL(cloudTarget.dashboardOrigin).hostname ||
        parsedUrl.hostname === new URL(cloudTarget.apiSiteOrigin).hostname)
    ) {
      return cloudTarget;
    }

    if (parsedUrl.port) {
      const byDashboardPort = KNOWN_RUNTIME_TARGETS.find(({ dashboardOrigin }) =>
        new URL(dashboardOrigin).port === parsedUrl.port);
      if (byDashboardPort) {
        return byDashboardPort;
      }

      const byApiPort = KNOWN_RUNTIME_TARGETS.find(({ apiOrigin }) =>
        new URL(apiOrigin).port === parsedUrl.port);
      if (byApiPort) {
        return byApiPort;
      }
    }
  }

  const origin = normalizeOrigin(rawUrl);
  if (!origin) {
    return undefined;
  }

  return KNOWN_RUNTIME_TARGETS.find(({ dashboardOrigin, apiSiteOrigin }) =>
    dashboardOrigin === origin || apiSiteOrigin === origin);
}

function resolveApiOrigin(rawUrl?: string) {
  const target = resolveRuntimeTarget(rawUrl);
  if (target) {
    return target.apiOrigin;
  }

  const origin = rawUrl ? normalizeApiOrigin(rawUrl) : undefined;
  return origin ? resolveRuntimeTargetByApiOrigin(origin)?.apiOrigin : undefined;
}

function requireResolvedApiOrigin(context: string, rawUrl?: string) {
  const apiOrigin = resolveApiOrigin(rawUrl);
  if (apiOrigin) {
    return apiOrigin;
  }

  if (isProduction()) {
    throw new Error(
      `${context}: could not resolve the API origin from a known Openship runtime target.`,
    );
  }

  return DEFAULT_RUNTIME_TARGET.apiOrigin;
}

function getRequestOriginFromHeaders(headers: Pick<Headers, "get">) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) {
    return undefined;
  }

  const proto = headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}

function getCurrentRuntimeTarget(rawUrl?: string) {
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
  return resolveRuntimeTarget(rawUrl ?? browserOrigin) ?? DEFAULT_RUNTIME_TARGET;
}

function resolveKnownRuntimeTargetById(id: RuntimeTarget["id"]) {
  return KNOWN_RUNTIME_TARGETS.find((target) => target.id === id);
}

function getCloudRuntimeTargetFor(target: KnownRuntimeTarget) {
  return resolveKnownRuntimeTargetById(target.cloudTargetId) ?? target;
}

function getCloudRuntimeTarget(rawUrl?: string) {
  return getCloudRuntimeTargetFor(getCurrentRuntimeTarget(rawUrl));
}

function buildDeploymentInfoFallback(target?: KnownRuntimeTarget): DeploymentInfoFallback {
  const runtimeTarget = target ?? DEFAULT_RUNTIME_TARGET;
  const cloudTarget = getCloudRuntimeTargetFor(runtimeTarget);

  return {
    selfHosted: runtimeTarget.selfHosted,
    deployMode: runtimeTarget.deployMode,
    authMode: runtimeTarget.authMode,
    cloudAuthUrl: cloudTarget.dashboardOrigin,
  };
}

export function getApiOrigin() {
  const requestOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
  return requireResolvedApiOrigin("Client API origin resolution", requestOrigin);
}

export function getApiOriginFromRequest(requestUrl: string) {
  return requireResolvedApiOrigin("Request API origin resolution", requestUrl);
}

export function getApiOriginFromHeaders(headers: Pick<Headers, "get">) {
  return requireResolvedApiOrigin("Server API origin resolution", getRequestOriginFromHeaders(headers));
}

export function getAuthBaseUrl() {
  return `${getApiOrigin()}${AUTH_PATH_SUFFIX}`;
}

export function getRestApiBaseUrl() {
  return `${getApiOrigin()}${API_PATH_SUFFIX}`;
}

export function getCloudDashboardUrl(rawUrl?: string) {
  if (rawUrl) {
    return normalizeOrigin(rawUrl, "cloudAuthUrl")!;
  }

  return getCloudRuntimeTarget(rawUrl).dashboardOrigin;
}

export function getCloudApiOrigin(rawUrl?: string) {
  if (rawUrl) {
    return normalizeApiOrigin(rawUrl, "cloudApiUrl")!;
  }

  return getCloudRuntimeTarget(rawUrl).apiOrigin;
}

export function getFallbackDeploymentInfo(rawUrl?: string) {
  return buildDeploymentInfoFallback(resolveRuntimeTarget(rawUrl));
}

export function getFallbackDeploymentInfoFromHeaders(headers: Pick<Headers, "get">) {
  return buildDeploymentInfoFallback(resolveRuntimeTarget(getRequestOriginFromHeaders(headers)));
}
