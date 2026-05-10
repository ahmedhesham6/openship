export const DEFAULT_PORT = {
  web: 3000,
  dashboard: 3001,
  api: 4000,
  saasDashboard: 3002,
  saasApi: 4100,
} as const;

function localhost(port: number) {
  return `http://localhost:${port}`;
}

export const LOCAL_WEB_URL = localhost(DEFAULT_PORT.web);
export const LOCAL_DASHBOARD_URL = localhost(DEFAULT_PORT.dashboard);
export const LOCAL_API_URL = localhost(DEFAULT_PORT.api);
export const LOCAL_SAAS_DASHBOARD_URL = localhost(DEFAULT_PORT.saasDashboard);
export const LOCAL_SAAS_API_URL = localhost(DEFAULT_PORT.saasApi);
export const CLOUD_DASHBOARD_URL = "https://app.openship.io";
export const CLOUD_API_URL = "https://api.openship.io";

export const DASHBOARD_RUNTIME_TARGET_IDS = ["local", "local-saas", "cloud-saas"] as const;

export type DashboardRuntimeTargetId = (typeof DASHBOARD_RUNTIME_TARGET_IDS)[number];

export const CLOUD_RUNTIME_TARGET_ID = "cloud-saas" satisfies DashboardRuntimeTargetId;
export const CURRENT_SELF_HOSTED_RUNTIME_TARGET_ID = "local" satisfies DashboardRuntimeTargetId;
// Change this to "cloud-saas" when SaaS mode should use app/api.openship.io.
export const CURRENT_SAAS_RUNTIME_TARGET_ID = "local-saas" satisfies DashboardRuntimeTargetId;

export type DashboardRuntimeTarget = {
  id: DashboardRuntimeTargetId;
  dashboard: string;
  api: string;
  ports: {
    dashboard: number;
    api: number;
  };
  cloudTargetId: DashboardRuntimeTargetId;
  selfHosted: boolean;
  deployMode: "docker" | "cloud";
  authMode: "local";
};

export const DASHBOARD_RUNTIME_TARGETS = [
  {
    id: "local",
    dashboard: LOCAL_DASHBOARD_URL,
    api: LOCAL_API_URL,
    ports: {
      dashboard: DEFAULT_PORT.dashboard,
      api: DEFAULT_PORT.api,
    },
    cloudTargetId: CLOUD_RUNTIME_TARGET_ID,
    selfHosted: true,
    deployMode: "docker",
    authMode: "local",
  },
  {
    id: "local-saas",
    dashboard: LOCAL_SAAS_DASHBOARD_URL,
    api: LOCAL_SAAS_API_URL,
    ports: {
      dashboard: DEFAULT_PORT.saasDashboard,
      api: DEFAULT_PORT.saasApi,
    },
    cloudTargetId: "local-saas",
    selfHosted: false,
    deployMode: "cloud",
    authMode: "local",
  },
  {
    id: "cloud-saas",
    dashboard: CLOUD_DASHBOARD_URL,
    api: CLOUD_API_URL,
    ports: {
      dashboard: DEFAULT_PORT.saasDashboard,
      api: DEFAULT_PORT.saasApi,
    },
    cloudTargetId: CLOUD_RUNTIME_TARGET_ID,
    selfHosted: false,
    deployMode: "cloud",
    authMode: "local",
  },
] as const satisfies readonly DashboardRuntimeTarget[];

export function getDashboardRuntimeTarget(id: DashboardRuntimeTargetId) {
  const target = DASHBOARD_RUNTIME_TARGETS.find((candidate) => candidate.id === id);
  if (!target) {
    throw new Error(`Unknown Openship dashboard runtime target: ${id}`);
  }
  return target;
}

export function inferDashboardRuntimeTargetId(input: { cloudMode?: boolean } = {}): DashboardRuntimeTargetId {
  return input.cloudMode ? CURRENT_SAAS_RUNTIME_TARGET_ID : CURRENT_SELF_HOSTED_RUNTIME_TARGET_ID;
}

export function resolveDashboardRuntimeTarget(input: { cloudMode?: boolean } = {}) {
  return getDashboardRuntimeTarget(inferDashboardRuntimeTargetId(input));
}

export function getDashboardRuntimeOrigins() {
  return DASHBOARD_RUNTIME_TARGETS.flatMap(({ dashboard, api }) => [dashboard, api]);
}
