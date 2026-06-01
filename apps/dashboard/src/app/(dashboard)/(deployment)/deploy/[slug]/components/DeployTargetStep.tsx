"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Server, Cloud, Cpu, ArrowRight, Pencil, ChevronDown, CheckCircle2, Loader2, Plus, Sparkles } from "lucide-react";
import { useDeployment } from "@/context/DeploymentContext";
import { usesServiceDeployment } from "@/context/deployment/types";
import { useCloud } from "@/context/CloudContext";
import { usePlatform } from "@/context/PlatformContext";
import { systemApi } from "@/lib/api/system";
import { settingsApi } from "@/lib/api/settings";
import type { ServerInfo } from "@/lib/api/system";
import { useToast } from "@/context/ToastContext";
import { useModal } from "@/context/ModalContext";
import type { DeployTarget, BuildStrategy } from "@/context/deployment/types";
import { createPersistedValue, createPersistedFlag } from "@/lib/persisted-value";
import { AddServerModal } from "./AddServerModal";

// ─── Option card ─────────────────────────────────────────────────────────────

interface OptionCardProps {
  value: string;
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
  /** Optional children rendered below when selected */
  children?: React.ReactNode;
}

export const OptionCard: React.FC<OptionCardProps> = ({
  selected,
  onSelect,
  icon,
  label,
  description,
  children,
}) => (
  <div>
    <button
      type="button"
      onClick={onSelect}
      className={`
        relative w-full text-left p-4 rounded-xl border transition-all
        ${selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border/50 bg-card hover:border-primary/30 hover:bg-primary/[0.02]"
        }
        ${selected && children ? "rounded-b-none border-b-0" : ""}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${selected ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground"}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${selected ? "text-foreground" : "text-foreground/80"}`}>
            {label}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
        {selected && (
          <div className="size-5 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
            <div className="size-2 rounded-full bg-primary-foreground" />
          </div>
        )}
      </div>
    </button>
    {selected && children && (
      <div className="border border-t-0 border-primary/20 bg-primary/[0.02] rounded-b-xl px-4 pb-4 pt-2">
        {children}
      </div>
    )}
  </div>
);

// ─── Server sub-selector (shown when "Servers" is selected with multiple) ────

interface ServerSubSelectorProps {
  servers: ServerInfo[];
  selectedId?: string;
  onSelect: (server: ServerInfo) => void;
}

const ServerSubSelector: React.FC<ServerSubSelectorProps> = ({
  servers,
  selectedId,
  onSelect,
}) => (
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-muted-foreground mb-2">Choose a server</p>
    {servers.map((s) => {
      const isSelected = selectedId === s.id;
      return (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
            isSelected
              ? "bg-primary/10 border border-primary/30"
              : "bg-card/60 border border-border/30 hover:border-primary/20 hover:bg-muted/30"
          }`}
        >
          <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
            isSelected ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground"
          }`}>
            <Server className="size-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {s.name || s.sshHost}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {s.sshUser || "root"}@{s.sshHost}:{s.sshPort || 22}
            </p>
          </div>
          {isSelected && (
            <CheckCircle2 className="size-4 text-primary shrink-0" />
          )}
        </button>
      );
    })}
  </div>
);

// ─── Compact summary (shown when editing from step 2) ────────────────────────

interface CompactSummaryProps {
  deployTarget: DeployTarget;
  buildStrategy: BuildStrategy;
  serverName?: string | null;
  showBuildStrategy?: boolean;
  onEdit: () => void;
}

const targetLabels: Record<DeployTarget, { label: string; icon: React.ReactNode }> = {
  local: { label: "This Machine", icon: <Cpu className="size-3.5" /> },
  server: { label: "My Server", icon: <Server className="size-3.5" /> },
  cloud: { label: "Oblien Cloud", icon: <Cloud className="size-3.5" /> },
};

const buildLabels: Record<BuildStrategy, { label: string; icon: React.ReactNode }> = {
  local: { label: "This Machine", icon: <Cpu className="size-3.5" /> },
  server: { label: "Remote", icon: <Cloud className="size-3.5" /> },
};

export const DeployTargetSummary: React.FC<CompactSummaryProps> = ({
  deployTarget,
  buildStrategy,
  serverName,
  showBuildStrategy = true,
  onEdit,
}) => {
  const target = targetLabels[deployTarget];
  const build = deployTarget === "cloud"
    ? { label: "Openship Cloud", icon: <Cloud className="size-3.5" /> }
    : buildLabels[buildStrategy];
  const deployLabel = deployTarget === "server" && serverName
    ? serverName
    : target.label;

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center gap-3 px-4 py-3 bg-card rounded-xl border border-border/50 hover:border-primary/30 transition-all group"
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        {showBuildStrategy && (
          <>
            <div className="flex items-center gap-1.5 text-sm">
              {build.icon}
              <span className="text-muted-foreground">Build:</span>
              <span className="font-medium text-foreground">{build.label}</span>
            </div>
            <ArrowRight className="size-3 text-muted-foreground/50" />
          </>
        )}
        <div className="flex items-center gap-1.5 text-sm">
          {target.icon}
          <span className="text-muted-foreground">Deploy:</span>
          <span className="font-medium text-foreground">{deployLabel}</span>
        </div>
      </div>
      <Pencil className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

// ─── Hook: resolve available targets ─────────────────────────────────────────

export interface ResolvedTargets {
  ready: boolean;
  /** All configured servers */
  servers: ServerInfo[];
  hasCloudConnected: boolean;
  hasCloudOption: boolean;
  /** True when there's a real choice to make */
  hasChoice: boolean;
  /** Refetch the server list — used after returning from /servers/new */
  refreshServers: () => void;
}

export function useDesktopTargets(): ResolvedTargets {
  const cloud = useCloud();
  const { selfHosted } = usePlatform();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serversReady, setServersReady] = useState(false);

  // Fetch servers + filter to ones that can run apps. Exposed so the picker
  // can re-pull after the user adds a new server in another tab.
  const fetchServers = useCallback(() => {
    if (!selfHosted) {
      setServersReady(true);
      return () => {};
    }

    let cancelled = false;
    systemApi.listServers()
      .then((list) => { if (!cancelled) setServers(list.filter((s) => s.runsApps)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setServersReady(true); });
    return () => { cancelled = true; };
  }, [selfHosted]);

  useEffect(() => {
    const cleanup = fetchServers();
    return cleanup;
  }, [fetchServers]);

  // Refresh when the tab regains focus — covers the "added a server in a new
  // tab" flow without forcing the user to reload the deploy page.
  useEffect(() => {
    if (!selfHosted) return;
    const onFocus = () => { fetchServers(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [selfHosted, fetchServers]);

  const hasServers = servers.length > 0;
  const hasCloudConnected = cloud.connected;
  const hasCloudOption = true;
  const ready = serversReady && !cloud.loading;

  return {
    ready,
    servers,
    hasCloudConnected,
    hasCloudOption,
    hasChoice: ready && Number(hasServers) + Number(hasCloudOption) > 1,
    refreshServers: fetchServers,
  };
}

// ─── Soft "last pick" memory ─────────────────────────────────────────────────
// Remembers the most recent deploy choice across deployments without the user
// having to opt in via "Save as default". Distinct from the settings-API
// default, which is the explicit, cross-device "always use this" setting:
// localStorage here is the soft, per-browser "what did I pick last time".
//
// Priority on seed: settings-API default > localStorage > auto-select fallback.

type LastPick = {
  target: DeployTarget;
  serverId?: string | null;
};

const lastPickStore = createPersistedValue<LastPick>(
  "openship.deploy-last-pick",
  (raw): raw is LastPick => {
    if (!raw || typeof raw !== "object") return false;
    const obj = raw as { target?: unknown; serverId?: unknown };
    if (obj.target !== "local" && obj.target !== "server" && obj.target !== "cloud") return false;
    if (obj.serverId !== undefined && obj.serverId !== null && typeof obj.serverId !== "string") return false;
    return true;
  },
);

// "Have we shown the first-deploy build hint yet?" — set on the first
// Continue. Once set, subsequent deploys get the full Build picker.
const buildHintFlag = createPersistedFlag("openship.build-hint-seen");

// ─── Main step ───────────────────────────────────────────────────────────────

interface DeployTargetStepProps {
  targets: ResolvedTargets;
  onContinue: () => void;
  /**
   * When true (the default), the step auto-advances to the next step if a
   * saved default applies cleanly — the user never sees this screen. Set to
   * false by the parent when the user explicitly navigated back here via
   * the edit affordance, so we don't bounce them straight back out.
   */
  autoSkipAllowed?: boolean;
}

const DeployTargetStep: React.FC<DeployTargetStepProps> = ({ targets, onContinue, autoSkipAllowed = true }) => {
  const { config, updateConfig } = useDeployment();
  const { requireCloud } = useCloud();
  const { selfHosted } = usePlatform();
  const { showToast } = useToast();
  const { showModal, hideModal } = useModal();
  const { ready, servers, hasCloudConnected, hasCloudOption, hasChoice, refreshServers } = targets;
  const hasServers = servers.length > 0;
  const isSingleServer = servers.length === 1;
  // "Save as my default for every deployment" — persists the picked target
  // (+ server id when applicable) to user_settings on continue.
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  // Whether to render the full picker vs the compact summary pill.
  // Default = full picker. Flips to compact when a saved default applies
  // cleanly. User can re-expand any time via the pencil on the pill.
  const [expanded, setExpanded] = useState(true);
  // Track when the defaults fetch is done so we can suppress the picker
  // for a brief moment instead of flashing the full picker before collapsing.
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  // First-deploy-ever flag — read from localStorage on mount. When true,
  // we hide the Build picker, auto-match build to deploy, and show a small
  // hint card instead. Flipped off on the first successful Continue so the
  // full picker re-appears on subsequent deploys.
  const [isFirstBuildHint, setIsFirstBuildHint] = useState(false);
  // User can opt into picking the build location manually from inside the
  // hint — when true, the hint hides and the full Build picker is shown.
  const [revealBuildPicker, setRevealBuildPicker] = useState(false);

  // Add server inline via modal. On create, refresh the server list and
  // auto-select the new one so the user lands on it immediately — no extra
  // clicks, no tab juggling, deploy config stays intact.
  const openAddServer = () => {
    const id = showModal({
      width: "720px",
      maxWidth: "92vw",
      showCloseButton: false,
      customContent: (
        <AddServerModal
          onCancel={() => hideModal(id)}
          onCreated={(server) => {
            hideModal(id);
            refreshServers();
            updateConfig({ deployTarget: "server", serverId: server.id });
            lastPickStore.write({ target: "server", serverId: server.id });
          }}
        />
      ),
    });
  };
  const isServiceDeployment = usesServiceDeployment(config);
  const showBuildStrategy =
    config.projectType === "app" || (config.projectType === "services" && !isServiceDeployment);

  // On mount: read first-deploy flag from localStorage. We treat the very
  // first deploy as "build hint shown" — once the user clicks Continue we
  // mark it seen, and from then on the full Build picker is back. Skipping
  // the picker on first run keeps the UI focused; the option remains
  // available in the post-continue summary and in Settings.
  useEffect(() => {
    setIsFirstBuildHint(!buildHintFlag.isSet());
  }, []);

  // First-deploy-only: auto-match build to deploy target. If the user opts
  // to pick manually via the hint's "Choose build location", `revealBuildPicker`
  // flips and we stop forcing the match.
  useEffect(() => {
    if (!isFirstBuildHint || revealBuildPicker) return;
    const want: BuildStrategy = config.deployTarget === "local" ? "local" : "server";
    if (config.buildStrategy !== want) {
      updateConfig({ buildStrategy: want });
    }
  }, [isFirstBuildHint, revealBuildPicker, config.deployTarget, config.buildStrategy, updateConfig]);

  // Seed the picker from the user's saved default (if any). The ref makes
  // sure we only ever APPLY the default once — even under StrictMode's
  // double-mount in dev — so we never clobber a choice the user made after
  // the initial seed. The fetch itself is allowed to re-run; only the
  // current invocation's `cancelled` flag gates state updates.
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    settingsApi.get()
      .then((res) => {
        if (cancelled) return;
        if (appliedDefaultRef.current) return; // already seeded — don't overwrite
        appliedDefaultRef.current = true;

        const target = res?.defaultDeployTarget;
        const savedServerId = res?.defaultServerId;
        let applied = false;
        if (target === "server") {
          if (savedServerId && servers.some((s) => s.id === savedServerId)) {
            updateConfig({ deployTarget: "server", serverId: savedServerId });
            applied = true;
          }
        } else if (target === "cloud") {
          updateConfig({ deployTarget: "cloud", serverId: undefined, buildStrategy: "server" });
          applied = true;
        } else if (target === "local") {
          updateConfig({ deployTarget: "local", serverId: undefined });
          applied = true;
        }

        // No explicit settings-API default? Try the soft "last pick"
        // memory from localStorage. Validate against current state — if the
        // remembered server has since been deleted, fall through.
        if (!applied) {
          const last = lastPickStore.read();
          if (last) {
            if (last.target === "server") {
              if (last.serverId && servers.some((s) => s.id === last.serverId)) {
                updateConfig({ deployTarget: "server", serverId: last.serverId });
                applied = true;
              }
            } else if (last.target === "cloud" && hasCloudOption) {
              updateConfig({ deployTarget: "cloud", serverId: undefined, buildStrategy: "server" });
              applied = true;
            } else if (last.target === "local") {
              updateConfig({ deployTarget: "local", serverId: undefined });
              applied = true;
            }
          }
        }

        // Collapse to compact summary only when defaults applied cleanly.
        // Without a default — or with a stale serverId — keep the full
        // picker so the user can make a fresh choice.
        if (applied) setExpanded(false);
      })
      .catch(() => { /* no default — picker falls back to auto-select */ })
      .finally(() => { if (!cancelled) setDefaultsLoaded(true); });
    return () => { cancelled = true; };
    // Excluded `servers` / `updateConfig` on purpose: this is a one-shot
    // seed keyed off `ready`. The dep array is intentionally tight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Auto-set deploy target when there's only one option
  useEffect(() => {
    if (!ready || hasChoice) {
      return;
    }

    if (hasServers) {
      updateConfig({ deployTarget: "server", serverId: servers[0].id });
      return;
    }

    if (hasCloudOption) {
      updateConfig({ deployTarget: "cloud", serverId: undefined, buildStrategy: "server" });
    }
  }, [ready, hasChoice, hasServers, hasCloudOption, servers, updateConfig]);

  useEffect(() => {
    if (config.deployTarget === "cloud" && config.buildStrategy !== "server") {
      updateConfig({ buildStrategy: "server" });
    }
  }, [config.deployTarget, config.buildStrategy, updateConfig]);

  // Auto-select single server
  useEffect(() => {
    if (isSingleServer && config.deployTarget === "server" && !config.serverId) {
      updateConfig({ serverId: servers[0].id });
    }
  }, [isSingleServer, config.deployTarget, config.serverId, servers, updateConfig]);

  const handleDeployTargetChange = (target: DeployTarget) => {
    const updates: Partial<typeof config> = { deployTarget: target };
    if (target === "cloud") {
      updates.serverId = undefined;
      updates.buildStrategy = "server";
    }
    if (target === "server" && isSingleServer) {
      updates.serverId = servers[0].id;
    }
    updateConfig(updates);
    // Soft memory: remember this choice for next deployment. For "server"
    // without a resolved serverId yet, store null and let the next
    // handleServerSelect refine it.
    lastPickStore.write({
      target,
      serverId: target === "server" ? (updates.serverId ?? null) : null,
    });
  };

  const handleServerSelect = (server: ServerInfo) => {
    updateConfig({ deployTarget: "server", serverId: server.id });
    lastPickStore.write({ target: "server", serverId: server.id });
  };

  // Build the deploy target options
  const deployTargetOptions: Array<{
    value: DeployTarget;
    icon: React.ReactNode;
    label: string;
    description: string;
  }> = [];

  if (hasServers) {
    if (isSingleServer) {
      // Single server → show directly by name
      deployTargetOptions.push({
        value: "server",
        icon: <Server className="size-5" />,
        label: servers[0].name || servers[0].sshHost,
        description: "Deploy to your remote server via SSH.",
      });
    } else {
      // Multiple servers → show "Servers" category
      deployTargetOptions.push({
        value: "server",
        icon: <Server className="size-5" />,
        label: "Servers",
        description: `Choose from ${servers.length} configured servers.`,
      });
    }
  }

  if (hasCloudOption) {
    deployTargetOptions.push({
      value: "cloud",
      icon: <Cloud className="size-5" />,
      label: "Openship Cloud",
      description: hasCloudConnected
        ? "Deploy to managed cloud infrastructure. No server setup needed."
        : "Connect your Openship Cloud account and deploy to managed infrastructure.",
    });
  }

  const buildOptions: Array<{
    value: BuildStrategy;
    icon: React.ReactNode;
    label: string;
    description: string;
  }> = [
    {
      value: "local",
      icon: <Cpu className="size-5" />,
      label: "This Machine",
      description: "Build locally, then transfer the output. Faster if you have a powerful machine.",
    },
    {
      value: "server",
      icon: <Cloud className="size-5" />,
      label: "Remote",
      description: "Build on the deploy target. Best when your machine has limited resources.",
    },
  ];
  const visibleBuildOptions = config.deployTarget === "cloud"
    ? [{
        value: "server" as const,
        icon: <Cloud className="size-5" />,
        label: "Openship Cloud",
        description: "Build in managed cloud infrastructure.",
      }]
    : buildOptions;

  const hasAnyDeployTarget = deployTargetOptions.length > 0;
  const canContinue = ready && (
    config.deployTarget === "cloud" ||
    (config.deployTarget === "server" && !!config.serverId && hasServers)
  );

  // Auto-skip eligibility — true when a saved default has applied cleanly
  // AND the parent allows skipping. While true, we want to bypass the UI
  // entirely (no flash of compact summary before onContinue fires).
  const baseLoading = !ready || !defaultsLoaded;
  const baseCompactEligible = !baseLoading && !expanded && canContinue;
  const wouldAutoSkip = autoSkipAllowed && baseCompactEligible;

  // Render flags. When we're about to auto-skip, keep showing the loading
  // spinner so the user sees a single transition (spinner → next step)
  // instead of (spinner → compact pill → next step).
  const showLoading = baseLoading || wouldAutoSkip;
  const useCompact = !showLoading && baseCompactEligible;
  const showFullPicker = !showLoading && !useCompact;

  // Auto-skip the entire step when a saved default applies cleanly. Parent
  // sets autoSkipAllowed=false when the user navigated back here on purpose,
  // so this only fires on the initial entry. Ref prevents StrictMode and
  // re-render double-fires; once we've handed off to onContinue we're done.
  const autoSkippedRef = useRef(false);
  useEffect(() => {
    if (!wouldAutoSkip) return;
    if (autoSkippedRef.current) return;
    autoSkippedRef.current = true;
    // Persist the "build hint seen" flag too — auto-skipping past the
    // picker also means the user has effectively been through it once.
    buildHintFlag.set();
    onContinue();
  }, [wouldAutoSkip, onContinue]);

  // Server name for the compact pill — falls back to host if unnamed.
  const selectedServer = config.deployTarget === "server" && config.serverId
    ? servers.find((s) => s.id === config.serverId)
    : null;
  const summaryServerName = selectedServer
    ? (selectedServer.name || selectedServer.sshHost)
    : null;

  // Persist the current pick as the user's default — fire-and-forget so it
  // never blocks the deploy flow. Failures are surfaced as a toast; the
  // deploy itself continues either way.
  const persistDefault = async () => {
    if (!saveAsDefault) return;
    setSavingDefault(true);
    try {
      await settingsApi.updateDeployDefaults({
        defaultDeployTarget: config.deployTarget,
        defaultServerId: config.deployTarget === "server" ? (config.serverId ?? null) : null,
      });
      showToast("Saved as your default deploy target", "success", "Defaults");
    } catch {
      showToast("Couldn't save default — your deploy will still continue", "error", "Defaults");
    } finally {
      setSavingDefault(false);
    }
  };

  const handleContinue = () => {
    // The only hard gate at this step: deploying TO Openship Cloud needs an
    // Openship Cloud connection. Anything else (free .${baseDomain} domains
    // on own-server / local, free domains in compose services, etc.) is a
    // downstream concern — the stack/domains screens after Continue prompt
    // for cloud at the exact moment it's actually needed. Interrupting here
    // is paternalistic and breaks the "I picked my own server, leave me
    // alone" signal the user just gave us.
    if (config.deployTarget === "cloud" && !hasCloudConnected) {
      if (!requireCloud("Deploying to Openship Cloud")) {
        return;
      }
    }

    // Mark the build hint as seen — future deploys get the full Build picker.
    buildHintFlag.set();

    void persistDefault();
    onContinue();
  };

  return (
    <div className="space-y-8">
      {showLoading && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Where do you want to deploy?
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Loading your available deploy targets
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking servers and cloud connection...
          </div>
        </div>
      )}

      {/* Compact summary — saved default applied cleanly. The pill itself
          is the edit affordance: clicking expands the full picker so the
          user can change build/deploy for this one deployment. */}
      {useCompact && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            Deploy &amp; build
          </h3>
          <DeployTargetSummary
            deployTarget={config.deployTarget}
            buildStrategy={config.buildStrategy}
            serverName={summaryServerName}
            showBuildStrategy={showBuildStrategy}
            onEdit={() => setExpanded(true)}
          />
        </div>
      )}

      {/* Deploy target */}
      {showFullPicker && hasAnyDeployTarget && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Where do you want to deploy?
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {hasChoice
                ? "Choose where your application will run"
                : "Only one deploy target is currently available"}
            </p>
          </div>
          <div className="space-y-2">
            {deployTargetOptions.map((opt) => (
              <OptionCard
                key={opt.value}
                value={opt.value}
                selected={config.deployTarget === opt.value}
                onSelect={() => handleDeployTargetChange(opt.value)}
                icon={opt.icon}
                label={opt.label}
                description={opt.description}
              >
                {/* Sub-selector for multiple servers */}
                {opt.value === "server" && !isSingleServer && config.deployTarget === "server" && (
                  <ServerSubSelector
                    servers={servers}
                    selectedId={config.serverId}
                    onSelect={handleServerSelect}
                  />
                )}
              </OptionCard>
            ))}
          </div>
          {selfHosted && (
            <button
              type="button"
              onClick={openAddServer}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 bg-card/40 px-4 py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/30 transition-all"
            >
              <Plus className="size-3.5" />
              Add your own server
            </button>
          )}
        </div>
      )}

      {showFullPicker && !hasAnyDeployTarget && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Where do you want to deploy?
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              No deploy target is available yet
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card px-4 py-4 text-sm text-muted-foreground leading-relaxed">
            Connect Openship Cloud or add a server to continue with this deployment.
          </div>
          {selfHosted && (
            <button
              type="button"
              onClick={openAddServer}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 bg-card/40 px-4 py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/30 transition-all"
            >
              <Plus className="size-3.5" />
              Add your own server
            </button>
          )}
        </div>
      )}

      {/* First-deploy hint — replaces the build picker on the user's very
          first deployment. We auto-match build to deploy target and surface
          the option as an inline "did you know" so the picker isn't gone
          forever — they can reveal it inline or change it on the next
          screen. After the first Continue, the full picker is always shown. */}
      {showFullPicker && showBuildStrategy && isFirstBuildHint && !revealBuildPicker && (
        <div className="rounded-xl border border-border/40 bg-muted/15 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <Sparkles className="size-4 text-amber-500" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                We&apos;ll {config.options.hasBuild ? "build" : "prepare"} where you deploy
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                {config.deployTarget === "cloud"
                  ? "Builds run in managed cloud infrastructure — nothing to set up."
                  : config.deployTarget === "server"
                    ? `Builds run on your ${summaryServerName ? `server "${summaryServerName}"` : "server"}. If it's a small VPS, building on this machine can be much faster. You can change this on the next screen or save a preference in Settings.`
                    : "Builds run on this machine. You can change this on the next screen or save a preference in Settings."}
              </p>
              {config.deployTarget !== "cloud" && (
                <button
                  type="button"
                  onClick={() => setRevealBuildPicker(true)}
                  className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Choose build location
                  <ArrowRight className="size-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showFullPicker && showBuildStrategy && (!isFirstBuildHint || revealBuildPicker) && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {config.options.hasBuild ? "Where do you want to build?" : "Where do you want to prepare it?"}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {config.options.hasBuild
                ? "Choose where the build process runs"
                : "Choose where the repository is cloned and staged before deploy"}
            </p>
          </div>
          <div className="space-y-2">
            {visibleBuildOptions.map((opt) => (
              <OptionCard
                key={opt.value}
                value={opt.value}
                selected={config.buildStrategy === opt.value}
                onSelect={() => updateConfig({ buildStrategy: opt.value })}
                icon={opt.icon}
                label={opt.label}
                description={opt.description}
              />
            ))}
          </div>
        </div>
      )}

      {/* Save as default — fire-and-forget on continue. Only shown in the
          full picker; in compact mode the default's already in use. */}
      {showFullPicker && canContinue && (
        <label className="flex items-start gap-2.5 cursor-pointer select-none px-1">
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => setSaveAsDefault(e.target.checked)}
            disabled={savingDefault}
            className="mt-0.5 size-4 shrink-0 rounded border-border/60 bg-card text-primary focus:ring-2 focus:ring-primary/30 focus:ring-offset-0 cursor-pointer disabled:opacity-50"
          />
          <span className="text-sm text-muted-foreground leading-snug">
            Save as my default for every deployment.{" "}
            <span className="text-muted-foreground/70">
              Change it later in Settings, or per-deploy from the picker on this page.
            </span>
          </span>
        </label>
      )}

      {/* Continue */}
      <button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        Continue
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
};

export default DeployTargetStep;
