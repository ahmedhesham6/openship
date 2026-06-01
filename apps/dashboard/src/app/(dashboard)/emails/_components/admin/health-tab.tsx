"use client";

/**
 * Health tab — single place to answer "is everything working?"
 *
 * Two sections operators check in different troubleshooting flows but
 * want to see together:
 *
 *   1. Daemons   — live systemd status of Postfix, Dovecot, Amavis,
 *                  ClamAV, etc. Polled every 10 s. Check this when
 *                  "mail isn't sending" — usually a daemon is down.
 *   2. DNS scan  — live public-DNS lookup for every record the install
 *                  expected the operator to publish. Compares actual
 *                  values against expected and reports pass/warn/fail.
 *                  Check this when "mail sends but lands in spam" or
 *                  "Gmail/Outlook reject with PTR/SPF errors".
 *
 * A header banner aggregates both into one verdict.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
  Globe,
  Loader2,
  Play,
  RefreshCcw,
  RotateCw,
  ScrollText,
  Search,
  Square,
} from "lucide-react";
import {
  mailAdminApi,
  mailApi,
  type ComponentAction,
  type DnsCheck,
  type DnsCheckStatus,
  type DnsScanResult,
  type MailComponentHealth,
  type MailComponentStatus,
} from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { SectionCard } from "./_shared/section-card";
import { Skeleton } from "./_shared/skeleton";
import { StatusPill, type PillTone } from "./_shared/status-pill";
import { LogsDrawer } from "./_shared/logs-drawer";
import DropdownMenu, { type MenuAction } from "@/components/ui/DropdownMenu";

const HEALTH_POLL_MS = 10_000;

export function HealthTab({ serverId }: { serverId: string }) {
  const [components, setComponents] = useState<MailComponentHealth[] | null>(null);
  const [componentsErr, setComponentsErr] = useState<string | null>(null);
  const [componentsLastUpdated, setComponentsLastUpdated] = useState<number | null>(null);

  const [dns, setDns] = useState<DnsScanResult | null>(null);
  const [dnsErr, setDnsErr] = useState<string | null>(null);
  const [dnsRefreshing, setDnsRefreshing] = useState(false);

  const tickComponents = useCallback(async () => {
    try {
      const r = await mailApi.getHealth(serverId);
      setComponents(r.components);
      setComponentsErr(null);
      setComponentsLastUpdated(Date.now());
    } catch (err) {
      setComponentsErr(err instanceof Error ? err.message : "Health check failed");
    }
  }, [serverId]);

  const tickDns = useCallback(async () => {
    try {
      const r = await mailAdminApi.dns.scan(serverId);
      setDns(r);
      setDnsErr(null);
    } catch (err) {
      setDnsErr(err instanceof Error ? err.message : "DNS scan failed");
    }
  }, [serverId]);

  // Poll daemon health on a timer; DNS scan only on demand (it's slower
  // and the records don't change minute-to-minute).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await tickComponents();
    };
    void tick();
    void tickDns();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void tick();
    }, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tickComponents, tickDns]);

  const onRescan = async () => {
    if (dnsRefreshing) return;
    setDnsRefreshing(true);
    try {
      await tickDns();
    } finally {
      setDnsRefreshing(false);
    }
  };

  const summary = summarizeHealth(components, dns?.checks ?? null);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Health</h2>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
          Live daemon status + DNS scan. Daemons refresh on a 10-second poll;
          DNS scan runs once on open and again whenever you click Rescan.
        </p>
      </div>

      {summary && (
        <div
          className={`rounded-2xl border ${summary.banner} flex items-center gap-4 px-5 py-4`}
        >
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${summary.iconBg}`}
          >
            <summary.Icon
              className={`size-5 ${summary.iconColor}`}
              strokeWidth={2}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${summary.textColor}`}>
              {summary.label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{summary.sub}</p>
          </div>
        </div>
      )}

      {/* ── Daemons ───────────────────────────────────────────────────── */}
      <SectionCard
        title="Daemons"
        description="Mail-server processes managed by systemd on the VPS."
        density="split"
        icon={Activity}
        action={
          componentsLastUpdated && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              updated {timeAgo(componentsLastUpdated)}
            </span>
          )
        }
      >
        {componentsErr && (
          <div className="px-5 py-3 text-sm text-red-600 dark:text-red-400 border-b border-border/40 bg-red-500/5">
            {componentsErr}
          </div>
        )}
        {components === null && !componentsErr ? (
          <DaemonsSkeleton />
        ) : components ? (
          <div className="divide-y divide-border/40">
            {components.map((c) => (
              <DaemonRow
                key={c.key}
                component={c}
                serverId={serverId}
                onActed={tickComponents}
              />
            ))}
          </div>
        ) : null}
      </SectionCard>

      {/* ── DNS scan ──────────────────────────────────────────────────── */}
      <SectionCard
        title="DNS scan"
        description={
          dns?.domain
            ? `Live public-DNS check of every record we expect for ${dns.domain}.`
            : "Live public-DNS check of every record this server expects."
        }
        density="split"
        icon={Search}
        action={
          <button
            onClick={onRescan}
            disabled={dnsRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 border border-border transition-colors disabled:opacity-50"
          >
            <RefreshCcw
              className={`size-3 ${dnsRefreshing ? "animate-spin" : ""}`}
            />
            Rescan
          </button>
        }
      >
        {dnsErr && (
          <div className="px-5 py-3 text-sm text-red-600 dark:text-red-400 border-b border-border/40 bg-red-500/5">
            {dnsErr}
          </div>
        )}
        {dns === null && !dnsErr ? (
          <DnsScanSkeleton />
        ) : dns && dns.checks.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Globe
              className="size-7 text-muted-foreground/60 mx-auto mb-3"
              strokeWidth={1.5}
            />
            <p className="text-sm text-muted-foreground">
              No DNS records on file yet. Finish the install wizard to populate
              the scan.
            </p>
          </div>
        ) : dns ? (
          <div className="divide-y divide-border/40">
            {dns.checks.map((c) => (
              <DnsCheckRow key={c.key} check={c} />
            ))}
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * Daemon row — every row exposes Logs directly and a 3-dot menu with the
 * status-aware lifecycle actions (start / stop / restart). "Missing" units
 * have no menu since there's nothing to act on.
 */
function DaemonRow({
  component,
  serverId,
  onActed,
}: {
  component: MailComponentHealth;
  serverId: string;
  onActed: () => void;
}) {
  const presentation = daemonStatusPresentation(component.status);
  const { showToast } = useToast();
  const [acting, setActing] = useState<ComponentAction | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const run = async (action: ComponentAction) => {
    if (acting) return;
    setActing(action);
    try {
      await mailAdminApi.components.action(serverId, component.key, action);
      showToast(`${component.label} ${actionPastTense(action)}`, "success");
      await onActed();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `${action} failed`,
        "error",
        `${component.label} ${action} failed`,
      );
    } finally {
      setActing(null);
    }
  };

  const menuActions: MenuAction[] = (() => {
    if (component.status === "missing") return [];
    const items: MenuAction[] = [];
    const isRunning =
      component.status === "active" || component.status === "activating";
    if (isRunning) {
      items.push({
        id: "restart",
        label: acting === "restart" ? "Restarting…" : "Restart",
        icon: <RotateCw className="size-4" strokeWidth={2.25} />,
        onClick: () => void run("restart"),
        disabled: acting !== null,
      });
      items.push({
        id: "stop",
        label: acting === "stop" ? "Stopping…" : "Stop",
        icon: <Square className="size-4" strokeWidth={2.25} />,
        onClick: () => void run("stop"),
        disabled: acting !== null,
        variant: "danger",
      });
    } else {
      items.push({
        id: "start",
        label: acting === "start" ? "Starting…" : "Start",
        icon: <Play className="size-4" strokeWidth={2.25} />,
        onClick: () => void run("start"),
        disabled: acting !== null,
        variant: "success",
      });
      items.push({
        id: "restart",
        label: acting === "restart" ? "Restarting…" : "Restart",
        icon: <RotateCw className="size-4" strokeWidth={2.25} />,
        onClick: () => void run("restart"),
        disabled: acting !== null,
      });
    }
    return items;
  })();

  return (
    <>
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${presentation.iconBg}`}
        >
          <presentation.Icon
            className={`size-5 ${presentation.iconColor}`}
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">
              {component.label}
            </p>
            <span className="font-mono text-[11px] text-muted-foreground/80 truncate">
              {component.unit}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {component.description}
          </p>
          {component.activeSince && component.status === "active" && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              Up {timeAgo(new Date(component.activeSince).getTime())}
            </p>
          )}
        </div>
        <StatusPill tone={presentation.tone} icon={presentation.PillIcon}>
          {presentation.label}
        </StatusPill>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setLogsOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Open logs"
          >
            <ScrollText className="size-3.5" strokeWidth={2.25} />
            Logs
          </button>
          {menuActions.length > 0 && (
            <DropdownMenu
              actions={menuActions}
              align="right"
              disabled={acting !== null}
              triggerClassName="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
              trigger={
                acting ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
                ) : undefined
              }
            />
          )}
        </div>
      </div>
      {logsOpen && (
        <LogsDrawer
          serverId={serverId}
          componentKey={component.key}
          unit={component.unit}
          label={component.label}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </>
  );
}

function actionPastTense(action: ComponentAction): string {
  switch (action) {
    case "start":
      return "started";
    case "stop":
      return "stopped";
    case "restart":
      return "restarted";
  }
}

function DnsCheckRow({ check }: { check: DnsCheck }) {
  const presentation = dnsStatusPresentation(check.status);
  const showExpectedActual =
    (check.status === "warn" || check.status === "fail") && check.expected;
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${presentation.iconBg}`}
      >
        <presentation.Icon
          className={`size-5 ${presentation.iconColor}`}
          strokeWidth={2}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground">{check.label}</p>
          <span className="font-mono text-[11px] text-muted-foreground/80">
            {check.recordType} · {check.queriedName}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {check.message}
        </p>
        {showExpectedActual && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px]">
            <RowKV label="Expected" value={check.expected} />
            <RowKV
              label="Actual"
              value={check.actual || "(no record)"}
              muted={!check.actual}
            />
          </div>
        )}
      </div>
      <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
    </div>
  );
}

function RowKV({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-0.5">
        {label}
      </p>
      <p
        className={`font-mono break-all ${
          muted ? "text-muted-foreground/70 italic" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Skeletons ───────────────────────────────────────────────────────────────

function DaemonsSkeleton() {
  return (
    <div className="divide-y divide-border/40">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-72 max-w-full" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

function DnsScanSkeleton() {
  return (
    <div className="divide-y divide-border/40">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-start gap-4 px-5 py-4">
          <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-2.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ─── Status mappings ─────────────────────────────────────────────────────────

interface StatusPresentation {
  Icon: typeof Check;
  PillIcon: typeof Check;
  iconBg: string;
  iconColor: string;
  tone: PillTone;
  label: string;
}

function daemonStatusPresentation(status: MailComponentStatus): StatusPresentation {
  switch (status) {
    case "active":
      return {
        Icon: Check,
        PillIcon: Check,
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-600 dark:text-emerald-400",
        tone: "success",
        label: "Running",
      };
    case "activating":
      return {
        Icon: Loader2,
        PillIcon: Loader2,
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-600 dark:text-blue-400 animate-spin",
        tone: "info",
        label: "Starting",
      };
    case "deactivating":
      return {
        Icon: Loader2,
        PillIcon: Loader2,
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-600 dark:text-amber-400 animate-spin",
        tone: "warning",
        label: "Stopping",
      };
    case "inactive":
      return {
        Icon: CircleDashed,
        PillIcon: CircleDashed,
        iconBg: "bg-muted",
        iconColor: "text-muted-foreground",
        tone: "neutral",
        label: "Stopped",
      };
    case "failed":
      return {
        Icon: CircleX,
        PillIcon: CircleX,
        iconBg: "bg-red-500/10",
        iconColor: "text-red-600 dark:text-red-400",
        tone: "danger",
        label: "Failed",
      };
    case "missing":
      return {
        Icon: CircleAlert,
        PillIcon: CircleAlert,
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-600 dark:text-amber-400",
        tone: "warning",
        label: "Missing",
      };
    default:
      return {
        Icon: CircleDashed,
        PillIcon: CircleDashed,
        iconBg: "bg-muted",
        iconColor: "text-muted-foreground",
        tone: "neutral",
        label: "Unknown",
      };
  }
}

interface DnsStatusPresentation {
  Icon: typeof Check;
  iconBg: string;
  iconColor: string;
  tone: PillTone;
  label: string;
}

function dnsStatusPresentation(status: DnsCheckStatus): DnsStatusPresentation {
  switch (status) {
    case "pass":
      return {
        Icon: Check,
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-600 dark:text-emerald-400",
        tone: "success",
        label: "Pass",
      };
    case "warn":
      return {
        Icon: AlertTriangle,
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-600 dark:text-amber-400",
        tone: "warning",
        label: "Warning",
      };
    case "fail":
      return {
        Icon: CircleX,
        iconBg: "bg-red-500/10",
        iconColor: "text-red-600 dark:text-red-400",
        tone: "danger",
        label: "Fail",
      };
    default:
      return {
        Icon: CircleDashed,
        iconBg: "bg-muted",
        iconColor: "text-muted-foreground",
        tone: "neutral",
        label: "Unknown",
      };
  }
}

// ─── Banner summary ──────────────────────────────────────────────────────────

interface BannerSummary {
  Icon: typeof Check;
  banner: string;
  iconBg: string;
  iconColor: string;
  textColor: string;
  label: string;
  sub: string;
}

function summarizeHealth(
  components: MailComponentHealth[] | null,
  checks: DnsCheck[] | null,
): BannerSummary | null {
  if (!components && !checks) return null;

  // Separate "missing" from "down" — a unit that isn't installed on this
  // host is a different operator problem than one that exists and is
  // failing. The banner names which is which so the user doesn't have
  // to scan the whole list to figure out what's broken.
  const downComponents =
    components?.filter(
      (c) => c.status === "failed" || c.status === "inactive",
    ) ?? [];
  const missingComponents =
    components?.filter((c) => c.status === "missing") ?? [];
  const dnsFails = checks?.filter((c) => c.status === "fail").length ?? 0;
  const dnsWarns = checks?.filter((c) => c.status === "warn").length ?? 0;

  const allClean =
    downComponents.length === 0 &&
    missingComponents.length === 0 &&
    dnsFails === 0 &&
    dnsWarns === 0;

  if (allClean && (components || checks)) {
    return {
      Icon: CheckCircle2,
      banner: "bg-emerald-500/5 border-emerald-500/30",
      iconBg: "bg-emerald-500/10",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      label: "All systems operational",
      sub: "Daemons are running and every DNS record is published correctly.",
    };
  }

  if (
    downComponents.length === 0 &&
    missingComponents.length === 0 &&
    dnsFails === 0
  ) {
    return {
      Icon: AlertTriangle,
      banner: "bg-amber-500/5 border-amber-500/30",
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-600 dark:text-amber-400",
      textColor: "text-amber-700 dark:text-amber-300",
      label: "Almost there",
      sub: `${dnsWarns} optional DNS record${dnsWarns === 1 ? "" : "s"} could be improved — see DNS scan below.`,
    };
  }

  // If only "missing" daemons (nothing actually down, no DNS fails), it's
  // a soft warning — the box doesn't ship that daemon. Don't paint the
  // whole banner red for that.
  if (
    downComponents.length === 0 &&
    missingComponents.length > 0 &&
    dnsFails === 0
  ) {
    const names = missingComponents.map((c) => c.label).join(", ");
    return {
      Icon: AlertTriangle,
      banner: "bg-amber-500/5 border-amber-500/30",
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-600 dark:text-amber-400",
      textColor: "text-amber-700 dark:text-amber-300",
      label: `${names} not installed`,
      sub:
        missingComponents.length === 1
          ? "Mail still works without it; install only if you actually need this component."
          : "Mail still works without them; install only if you actually need these components.",
    };
  }

  const parts: string[] = [];
  if (downComponents.length > 0) {
    parts.push(`${downComponents.map((c) => c.label).join(", ")} down`);
  }
  if (missingComponents.length > 0) {
    parts.push(
      `${missingComponents.map((c) => c.label).join(", ")} not installed`,
    );
  }
  if (dnsFails > 0) {
    parts.push(`${dnsFails} DNS record${dnsFails === 1 ? "" : "s"} missing`);
  }

  return {
    Icon: CircleX,
    banner: "bg-red-500/5 border-red-500/30",
    iconBg: "bg-red-500/10",
    iconColor: "text-red-600 dark:text-red-400",
    textColor: "text-red-700 dark:text-red-300",
    label: "Issues need attention",
    sub: parts.join(" · "),
  };
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
