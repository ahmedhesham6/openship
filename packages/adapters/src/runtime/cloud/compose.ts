import type { Oblien, WorkspaceHandle } from "oblien";

import { DEFAULT_RESOURCE_CONFIG, type LogCallback, type ResourceConfig } from "../../types";
import type { WorkspaceRuntimePlan } from "../../dockerfile";
import { BuildLogger, injectGitToken, sq } from "../build-pipeline";
import type {
  ComposeSourceHandle,
  MultiServiceDeployConfig,
  MultiServiceDeployResult,
  MultiServiceGroupHandle,
  PrepareComposeSourceConfig,
} from "../types";

type CloudWorkspaceRuntime = Awaited<ReturnType<WorkspaceHandle["runtime"]>>;

export const COMPOSE_SOURCE_PATH = "/openship/source";

const SOURCE_WORKSPACE_IMAGE = "node:22";

export interface CloudBuiltArtifact {
  workspaceId: string;
  runtime: WorkspaceRuntimePlan;
}

interface CloudComposeServiceState {
  serviceName: string;
  workspaceId: string;
  ip?: string;
  ports: number[];
}

interface CloudComposeGroupState {
  id: string;
  resources?: ResourceConfig;
  services: Map<string, CloudComposeServiceState>;
}

interface CloudComposeSupportDeps {
  client: Oblien;
  builtArtifacts: Map<string, CloudBuiltArtifact>;
  workspace(workspaceId: string): WorkspaceHandle;
  provisionWorkspace(
    config: {
      name: string;
      image: string;
      mode: "temporary" | "permanent";
      resources: ResourceConfig;
      env?: Record<string, string>;
      ttl?: string;
    },
    logger: BuildLogger,
  ): Promise<{ workspaceId: string; runtime: CloudWorkspaceRuntime }>;
  execAndStream(
    runtime: CloudWorkspaceRuntime,
    command: string[],
    onLog: LogCallback,
    timeoutSeconds?: number,
  ): Promise<void>;
}

function now(): string {
  return new Date().toISOString();
}

function toEnvArray(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

function joinWorkspacePath(base: string, ...parts: string[]): string {
  return [base, ...parts].filter(Boolean).join("/").replace(/\/+/g, "/");
}

function firstContainerPort(portSpecs: string[]): number | undefined {
  for (const spec of portSpecs) {
    const clean = spec.trim();
    if (!clean) continue;
    const parts = clean.split(":");
    const raw = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
    const match = raw?.match(/^(\d+)(?:\/(?:tcp|udp))?$/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function restartPolicyForWorkload(policy?: string): "always" | "on-failure" | "never" {
  if (policy === "no" || policy === "never") return "never";
  if (policy === "on-failure") return "on-failure";
  return "always";
}

function exposeTarget(port: number, serviceName: string, slug?: string, domain = "opsh.io") {
  const service = `service "${serviceName}" on port ${port}`;
  return slug ? `${service} for slug "${slug}" (${slug}.${domain})` : service;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export class CloudComposeSupport {
  private readonly groups = new Map<string, CloudComposeGroupState>();

  constructor(private readonly deps: CloudComposeSupportDeps) {}

  async ensureServiceGroup(config: {
    deploymentId: string;
    projectId: string;
    slug: string;
    resources?: ResourceConfig;
  }): Promise<MultiServiceGroupHandle> {
    const id = `cloud-compose:${config.deploymentId}`;
    if (!this.groups.has(id)) {
      this.groups.set(id, {
        id,
        resources: config.resources,
        services: new Map(),
      });
    }
    return { id };
  }

  async prepareSource(
    config: PrepareComposeSourceConfig,
    logger?: BuildLogger,
  ): Promise<ComposeSourceHandle> {
    const log = logger ?? new BuildLogger();
    const provisioned = await this.deps.provisionWorkspace(
      {
        name: `${config.slug}-source`.slice(0, 60),
        image: config.image || SOURCE_WORKSPACE_IMAGE,
        mode: "temporary",
        resources: config.resources ?? DEFAULT_RESOURCE_CONFIG,
        ttl: "30m",
      },
      log,
    );

    try {
      const cloneUrl = injectGitToken(config.repoUrl, config.gitToken);
      const depthArgs = config.commitSha ? "--depth 50 " : "--depth 1 ";
      const checkoutCommand = config.commitSha
        ? `cd ${sq(COMPOSE_SOURCE_PATH)} && git -c credential.helper= checkout ${sq(config.commitSha)}`
        : "";
      const command = [
        "set -e",
        "if ! command -v git >/dev/null 2>&1; then",
        "  if command -v apt-get >/dev/null 2>&1; then",
        "    export DEBIAN_FRONTEND=noninteractive",
        "    apt-get update",
        "    apt-get install -y git ca-certificates",
        "  elif command -v apk >/dev/null 2>&1; then",
        "    apk add --no-cache git ca-certificates",
        "  elif command -v yum >/dev/null 2>&1; then",
        "    yum install -y git ca-certificates",
        "  else",
        '    echo "git is required to clone compose source, but no supported package manager was found." >&2',
        "    exit 1",
        "  fi",
        "fi",
        "rm -rf /openship",
        "mkdir -p /openship",
        `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true git -c credential.helper= clone ${depthArgs}--branch ${sq(config.branch)} ${sq(cloneUrl)} ${sq(COMPOSE_SOURCE_PATH)}`,
        checkoutCommand,
        `rm -rf ${sq(joinWorkspacePath(COMPOSE_SOURCE_PATH, ".git"))}`,
      ]
        .filter(Boolean)
        .join("\n");

      log.log(`Cloning compose source in Oblien workspace (branch: ${config.branch})...\n`);
      await this.deps.execAndStream(provisioned.runtime, ["sh", "-c", command], log.callback, 900);
      log.log("Compose source workspace ready.\n");

      return {
        id: provisioned.workspaceId,
        kind: "cloud-workspace",
        workspaceId: provisioned.workspaceId,
        path: COMPOSE_SOURCE_PATH,
      };
    } catch (err) {
      await this.deps
        .workspace(provisioned.workspaceId)
        .delete()
        .catch(() => {});
      throw err;
    }
  }

  async destroySource(handle: ComposeSourceHandle): Promise<void> {
    await this.deps
      .workspace(handle.workspaceId)
      .delete()
      .catch(() => {});
  }

  async deployServiceWorkload(
    group: MultiServiceGroupHandle,
    config: MultiServiceDeployConfig,
    onLog?: LogCallback,
  ): Promise<MultiServiceDeployResult> {
    const log = onLog ?? (() => {});
    const groupState = this.groups.get(group.id) ?? {
      id: group.id,
      services: new Map<string, CloudComposeServiceState>(),
    };
    this.groups.set(group.id, groupState);

    const builtArtifact = this.deps.builtArtifacts.get(config.image);
    const workspaceId =
      builtArtifact?.workspaceId ?? (await this.createImageServiceWorkspace(config, log));
    const ws = this.deps.workspace(workspaceId);

    try {
      await ws.lifecycle.makePermanent();
    } catch (err) {
      throw new Error(
        `Failed to make service workspace permanent: ${err instanceof Error ? err.message : err}`,
      );
    }

    const runtimeEnv = {
      ...(builtArtifact?.runtime.env ?? {}),
      ...config.environment,
    };
    const port =
      config.publicPort ?? firstContainerPort(config.ports) ?? builtArtifact?.runtime.exposedPort;
    const workdir = builtArtifact?.runtime.workdir ?? "/";
    const startCommand = config.command ?? builtArtifact?.runtime.startCommand;

    log({
      timestamp: now(),
      message: `Deploying cloud service "${config.serviceName}" in workspace ${workspaceId}...\n`,
      level: "info",
    });

    if (startCommand) {
      await ws.workloads.delete("app").catch(() => {});
      await ws.workloads.create({
        id: "app",
        name: "app",
        cmd: ["sh", "-c", `cd ${sq(workdir)} && ${startCommand}`],
        working_dir: workdir,
        env: [...toEnvArray(runtimeEnv), ...(port ? [`PORT=${port}`] : [])],
        restart_policy: restartPolicyForWorkload(config.restart),
        max_restarts: 10,
      });
    } else {
      log({
        timestamp: now(),
        message: `No command configured for "${config.serviceName}". Using the workspace image default process.\n`,
        level: "warn",
      });
    }

    if (config.expose && port) {
      try {
        await ws.network.update({ ingress_ports: [port] });
      } catch (err) {
        throw new Error(
          `Failed to open ${exposeTarget(port, config.serviceName, config.publicSlug)}: ${errorMessage(err)}`,
        );
      }

      if (config.customDomain) {
        try {
          await ws.domains.connect({ domain: config.customDomain, port });
        } catch (err) {
          throw new Error(
            `Failed to connect custom domain "${config.customDomain}" for service "${config.serviceName}" on port ${port}: ${errorMessage(err)}`,
          );
        }
      } else if (config.publicSlug) {
        try {
          log({
            timestamp: now(),
            message: `Exposing ${exposeTarget(port, config.serviceName, config.publicSlug)}...\n`,
            level: "info",
          });
          await ws.publicAccess.expose({
            port,
            domain: "opsh.io",
            slug: config.publicSlug,
            label: config.serviceName,
          });
        } catch (err) {
          throw new Error(
            `Failed to expose ${exposeTarget(port, config.serviceName, config.publicSlug)}: ${errorMessage(err)}`,
          );
        }
      }
    }

    const ip = await this.resolveWorkspaceIp(ws);
    const ports = [
      ...new Set([
        ...config.ports
          .map((item) => firstContainerPort([item]))
          .filter((item): item is number => typeof item === "number"),
        ...(port ? [port] : []),
      ]),
    ];

    groupState.services.set(config.serviceName, {
      serviceName: config.serviceName,
      workspaceId,
      ip: ip ?? undefined,
      ports,
    });

    await this.syncServiceDiscovery(groupState, log);

    log({
      timestamp: now(),
      message: `Cloud service "${config.serviceName}" started${ip ? ` at ${ip}` : ""}.\n`,
      level: "info",
    });

    return {
      containerId: workspaceId,
      status: "running",
      ip: ip ?? undefined,
      hostPort: port,
    };
  }

  private async createImageServiceWorkspace(
    config: MultiServiceDeployConfig,
    onLog: LogCallback,
  ): Promise<string> {
    const resources: ResourceConfig = {
      cpuCores: config.resources?.cpuCores ?? DEFAULT_RESOURCE_CONFIG.cpuCores,
      memoryMb: config.resources?.memoryMb ?? DEFAULT_RESOURCE_CONFIG.memoryMb,
      diskMb: DEFAULT_RESOURCE_CONFIG.diskMb,
    };

    onLog({
      timestamp: now(),
      message: `Creating cloud service "${config.serviceName}" from image "${config.image}"...\n`,
      level: "info",
    });

    let wsData: { id: string };
    try {
      wsData = await this.deps.client.workspaces.create({
        name: `${config.slug}-${config.serviceName}`.slice(0, 60),
        image: config.image,
        mode: "permanent",
        config: {
          cpus: resources.cpuCores,
          memory_mb: resources.memoryMb,
          disk_size_mb: resources.diskMb,
          env: toEnvArray(config.environment),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog({
        timestamp: now(),
        message: `Failed to create cloud service "${config.serviceName}" from image "${config.image}": ${message}\n`,
        level: "error",
      });
      throw err;
    }

    return wsData.id;
  }

  private async resolveWorkspaceIp(ws: WorkspaceHandle): Promise<string | null> {
    try {
      const network = await ws.network.get();
      if (network.ip) return network.ip;
    } catch {
      // Fall through to workspace metadata.
    }

    const data = await ws.get();
    return ((data as Record<string, unknown>).ip as string | undefined) ?? null;
  }

  private async syncServiceDiscovery(
    group: CloudComposeGroupState,
    onLog: LogCallback,
  ): Promise<void> {
    const services = [...group.services.values()].filter((service) => service.ip);
    if (services.length === 0) return;

    const workspaceIds = [...new Set(services.map((service) => service.workspaceId))];
    const hostsLines = services.map(
      (service) => `${service.ip} ${service.serviceName} # openship-compose:${group.id}`,
    );
    const hostsBlock = hostsLines.join("\n");

    for (const service of services) {
      const ws = this.deps.workspace(service.workspaceId);
      const privateLinks = workspaceIds.filter(
        (workspaceId) => workspaceId !== service.workspaceId,
      );
      if (privateLinks.length > 0) {
        const currentNetwork = await ws.network.get().catch(() => null);
        const currentIngress = Array.isArray(
          (currentNetwork as Record<string, unknown> | null)?.ingress_ports,
        )
          ? ((currentNetwork as Record<string, unknown>).ingress_ports as number[])
          : undefined;
        await ws.network
          .update({
            private_link_ids: privateLinks,
            ...(currentIngress ? { ingress_ports: currentIngress } : {}),
          })
          .catch((err) => {
            onLog({
              timestamp: now(),
              message: `Warning: failed to link private network for "${service.serviceName}": ${err instanceof Error ? err.message : err}\n`,
              level: "warn",
            });
          });
      }

      try {
        const rt = await ws.runtime();
        const script = `set -e
tmp=$(mktemp)
grep -v ' # openship-compose:${group.id}' /etc/hosts > "$tmp" || true
cat >> "$tmp" <<'EOF'
${hostsBlock}
EOF
cat "$tmp" > /etc/hosts
rm -f "$tmp"`;
        await this.deps.execAndStream(rt, ["sh", "-c", script], onLog);
      } catch (err) {
        onLog({
          timestamp: now(),
          message: `Warning: failed to update service discovery for "${service.serviceName}": ${err instanceof Error ? err.message : err}\n`,
          level: "warn",
        });
      }
    }
  }
}
