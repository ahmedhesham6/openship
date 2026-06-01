"use client";

/**
 * Reputation warm-up banner — sits at the top of the admin panel for the
 * first ~7 days after a domain starts sending, telling the operator that
 * early mail may land in spam while reputation builds. Dismissable;
 * dismissal and the warm-up start timestamp are kept in localStorage keyed
 * by `serverId:domain` so each domain on a multi-domain mail server has
 * its own independent banner + clock.
 *
 * Visual: amber-tinted card with a soft gradient, two short lines, an
 * "I know" dismiss link. Designed to read like a one-time editorial note
 * rather than an error or warning.
 */

import { useEffect, useState } from "react";
import { Clock3, X } from "lucide-react";

const WARMUP_WINDOW_DAYS = 7;
export const REPUTATION_STORAGE_PREFIX = "openship:mail:reputation:";

/**
 * Per-domain localStorage key used by `ReputationBanner`. Exported so the
 * post-ack flow in DomainsTab can seed `installedAt = Date.now()` at the
 * moment the operator confirms DNS, which is when the new domain starts
 * accepting/sending mail in earnest.
 */
export function reputationStorageKey(serverId: string, domain: string): string {
  return `${REPUTATION_STORAGE_PREFIX}${serverId}:${domain}`;
}

interface ReputationBannerProps {
  serverId: string;
  domain: string;
}

interface StoredState {
  installedAt: number;
  dismissed: boolean;
}

function readState(key: string): StoredState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    if (typeof parsed.installedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(key: string, state: StoredState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

export function ReputationBanner({ serverId, domain }: ReputationBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!serverId || !domain || typeof window === "undefined") return;
    const key = reputationStorageKey(serverId, domain);
    const now = Date.now();
    let state = readState(key);

    if (!state) {
      state = { installedAt: now, dismissed: false };
      writeState(key, state);
    }

    if (state.dismissed) return;

    const elapsedDays = (now - state.installedAt) / (1000 * 60 * 60 * 24);
    if (elapsedDays >= WARMUP_WINDOW_DAYS) return;

    setVisible(true);
  }, [serverId, domain]);

  const dismiss = () => {
    const key = reputationStorageKey(serverId, domain);
    const current = readState(key) ?? { installedAt: Date.now(), dismissed: false };
    writeState(key, { ...current, dismissed: true });
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200/70 dark:border-amber-500/30 bg-gradient-to-br from-amber-50 via-amber-50/60 to-orange-50/40 dark:from-amber-500/[0.08] dark:via-amber-500/[0.04] dark:to-orange-500/[0.03]">
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-44 rounded-full bg-amber-300/30 dark:bg-amber-400/15 blur-3xl pointer-events-none"
      />
      <div className="relative flex items-start gap-3.5 p-4 pr-12">
        <div className="size-9 rounded-xl bg-amber-100 dark:bg-amber-500/20 border border-amber-200/80 dark:border-amber-500/30 flex items-center justify-center shrink-0">
          <Clock3
            className="size-4 text-amber-700 dark:text-amber-300"
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-amber-900 dark:text-amber-100 leading-snug">
            Reputation warm-up for{" "}
            <span className="font-mono font-medium">{domain}</span>
          </p>
          <p className="text-[13px] text-amber-900/85 dark:text-amber-100/85 leading-relaxed mt-0.5">
            Brand-new sending domains have no reputation yet, so providers may
            file early mail to spam for the first 24-48 hours. This is normal.
            Mark messages as &quot;not spam&quot; from your testing inbox and
            deliverability improves quickly.{" "}
            <button
              type="button"
              onClick={dismiss}
              className="font-medium text-amber-900 dark:text-amber-100 underline-offset-4 hover:underline"
            >
              I know, hide this
            </button>
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 p-1 rounded-md text-amber-700/70 dark:text-amber-200/60 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-500/15 transition-colors"
        >
          <X className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
