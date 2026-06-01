"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, Rocket, Terminal, ShieldAlert } from "lucide-react";
import { useMonitorStream } from "@/hooks/useMonitorStream";
import type { RuntimeMode } from "@/context/deployment/types";

// Below this RAM the sandbox engine itself starts contending for memory with
// the app — on a 512MB/1GB VPS that's a real problem. Above it, Docker's
// overhead is single-digit-percent CPU + ~30-80MB RAM, which is negligible
// vs. the security upside, so we recommend sandbox even for solo projects.
const TWO_GB = 2 * 1024 * 1024 * 1024;

interface RuntimeModeModalContentProps {
  initialRuntimeMode: RuntimeMode;
  serverId?: string;
  onClose: () => void;
  onConfirm: (runtimeMode: RuntimeMode) => void | Promise<void>;
}

// Sandboxed is first because it's what we recommend. Order matters — users
// scan top-down, and the first option becomes the cognitive default.
const runtimeOptions: Array<{
  value: RuntimeMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: "docker",
    label: "Sandboxed",
    description:
      "Runs in an isolated container. A compromised process can't reach your host's files or other apps. Tiny overhead, big safety net.",
    icon: <ShieldCheck className="size-5" />,
  },
  {
    value: "bare",
    label: "Direct",
    description:
      "Runs as a regular system process. Lowest overhead, but a compromise has full host access. Only pick this if RAM is genuinely tight.",
    icon: <Terminal className="size-5" />,
  },
];

const RuntimeModeModalContent: React.FC<RuntimeModeModalContentProps> = ({
  initialRuntimeMode,
  serverId,
  onClose,
  onConfirm,
}) => {
  const { stats } = useMonitorStream(serverId ?? null, true);
  const hasAutoDefaultedRef = useRef(false);
  const hasUserSelectedRef = useRef(false);
  const [selectedRuntimeMode, setSelectedRuntimeMode] = useState<RuntimeMode>(initialRuntimeMode);

  const lowRam = useMemo(() => (stats ? stats.memTotal < TWO_GB : false), [stats]);

  // Default recommendation: sandboxed everywhere except on RAM-starved boxes
  // where the engine itself would eat into the app's headroom. We still let
  // the user override either way — this is a nudge, not a lock.
  const recommendedMode: RuntimeMode = lowRam ? "bare" : "docker";

  useEffect(() => {
    if (!stats || hasAutoDefaultedRef.current || hasUserSelectedRef.current) return;
    hasAutoDefaultedRef.current = true;
    setSelectedRuntimeMode(recommendedMode);
  }, [stats, recommendedMode]);

  const ramGB = stats ? (stats.memTotal / (1024 * 1024 * 1024)).toFixed(1) : null;

  return (
    <div className="space-y-4 px-5 pb-5 pt-1">
      <div>
        <h2 className="text-lg font-semibold text-foreground">How should it run?</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick how this app is isolated on the host
          {ramGB ? ` — server has ${ramGB} GB RAM` : ""}.
        </p>
      </div>

      <div className="space-y-2">
        {runtimeOptions.map((option) => {
          const selected = selectedRuntimeMode === option.value;
          const isRecommended = option.value === recommendedMode;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                hasUserSelectedRef.current = true;
                setSelectedRuntimeMode(option.value);
              }}
              className={`w-full rounded-xl border p-3 text-left transition-all ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border/50 hover:border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={selected ? "text-primary" : "text-muted-foreground"}>
                  {option.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                      {option.label}
                    </p>
                    {isRecommended && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {option.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Security caveat — only shown when the user is leaning toward (or
          got nudged into) bare metal. Don't preach when the safer option
          is already selected. */}
      {selectedRuntimeMode === "bare" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2.5">
          <ShieldAlert className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
            {lowRam ? (
              <>
                We picked Direct because this server has limited RAM. Sandboxed adds
                ~50–80&nbsp;MB which would tighten things further. If you can spare it,
                Sandboxed is still safer.
              </>
            ) : (
              <>
                Direct runs the app directly on the host — an exploit means full host
                access. Sandboxed adds maybe 1–2% CPU and a few dozen MB of RAM. For
                most apps the tradeoff isn't close.
              </>
            )}
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl border border-border/50 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onConfirm(selectedRuntimeMode)}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
        >
          <Rocket className="size-4" />
          Deploy
        </button>
      </div>
    </div>
  );
};

export default React.memo(RuntimeModeModalContent);