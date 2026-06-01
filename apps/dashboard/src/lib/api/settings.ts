import { api } from "./client";
import { endpoints } from "./endpoints";

export type BuildMode = "auto" | "server" | "local";
export type DefaultDeployTarget = "local" | "server" | "cloud";

export interface UserSettingsResponse {
  buildMode: BuildMode;
  defaultDeployTarget: DefaultDeployTarget | null;
  defaultServerId: string | null;
}

export interface DeployDefaultsResponse {
  defaultDeployTarget: DefaultDeployTarget | null;
  defaultServerId: string | null;
}

export const settingsApi = {
  /** Get the current user's platform settings */
  get: () => api.get<UserSettingsResponse>(endpoints.settings.get),

  /** Create or update all platform settings */
  upsert: (data: { buildMode: BuildMode }) =>
    api.put<UserSettingsResponse>(endpoints.settings.upsert, data),

  /** Update only the build mode preference */
  updateBuildMode: (buildMode: BuildMode) =>
    api.patch<UserSettingsResponse>(endpoints.settings.buildMode, { buildMode }),

  /**
   * Update (or clear) the default deploy target.
   * Pass `defaultDeployTarget: null` to clear. When target='server',
   * `defaultServerId` is required.
   */
  updateDeployDefaults: (data: {
    defaultDeployTarget: DefaultDeployTarget | null;
    defaultServerId?: string | null;
  }) => api.patch<DeployDefaultsResponse>(endpoints.settings.deployDefaults, data),
};
