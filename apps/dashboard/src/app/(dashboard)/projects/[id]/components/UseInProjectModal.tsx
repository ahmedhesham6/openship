"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Network, Globe } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { Checkbox } from "@/components/ui/Checkbox";
import { AppLogo } from "@/components/AppLogo";
import { projectsApi } from "@/lib/api";
import { connectionsApi, type ConnectionMode } from "@/lib/api/connections";
import { getApiErrorMessage } from "@/lib/api/client";
import { useToast } from "@/context/ToastContext";
import { usePlatform } from "@/context/PlatformContext";
import { useI18n, interpolate } from "@/components/i18n-provider";
import type { AppConnectionOutput } from "@/lib/api/apps";

/** Derive a sensible env var name from the source app + chosen output. */
function defaultEnvKey(appTemplateId: string | null | undefined, outputId: string): string {
  if (appTemplateId === "mongodb") return "MONGODB_URI";
  if (outputId.toLowerCase().includes("db") || outputId.toLowerCase().includes("url"))
    return "DATABASE_URL";
  return outputId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

/** Raw shape we read off projectsApi.getHome() (loosely typed there). */
interface RawProject {
  id: string;
  name?: string;
  slug?: string;
  primaryDomain?: string | null;
  domain?: string | null;
  appTemplateId?: string;
  favicon?: string | null;
  deployTarget?: string | null;
  serverName?: string | null;
}

/** A picker-ready target: enough meta to tell projects apart. */
interface TargetProject {
  id: string;
  name: string;
  description: string;
  appTemplateId?: string;
  favicon?: string | null;
}

/** Fallback subtitle when a project has no domain: where it runs. */
function hostingLabel(
  p: RawProject,
  hosting: { cloud: string; server: string; local: string },
): string | null {
  if (p.deployTarget === "cloud") return hosting.cloud;
  if (p.deployTarget === "server") return p.serverName || hosting.server;
  if (p.deployTarget === "local") return hosting.local;
  return null;
}

/**
 * "Use in a project" — wire this database app into another project. Injects the
 * chosen connection value as a secret env var on the target; Internal mode joins
 * the target to this app's private network (no public port), Public uses the
 * published host:port. Applies on the target's next deploy.
 */
export function UseInProjectModal({
  open,
  onClose,
  sourceProjectId,
  sourceAppTemplateId,
  outputs,
}: {
  open: boolean;
  onClose: () => void;
  sourceProjectId: string;
  sourceAppTemplateId: string | null | undefined;
  outputs: AppConnectionOutput[];
}) {
  const { t } = useI18n();
  const c = t.projects.connections;
  const { showToast } = useToast();
  const { baseDomain } = usePlatform();

  // Only outputs that carry a value can be injected (URLs / keys, not "—").
  const injectable = useMemo(() => outputs.filter((o) => o.value), [outputs]);

  const [targets, setTargets] = useState<TargetProject[]>([]);
  const [targetId, setTargetId] = useState("");
  const [mode, setMode] = useState<ConnectionMode>("internal");
  // One row per injectable output: whether to wire it + its (editable) env name.
  const [rows, setRows] = useState<Record<string, { checked: boolean; envKey: string }>>({});
  const [busy, setBusy] = useState(false);

  // Seed the checklist whenever the outputs change: primary URL checked, rest
  // off; each env name auto-derived (user can edit before connecting).
  useEffect(() => {
    if (!open) return;
    const primaryId =
      injectable.find((o) => o.id === "dbUrl")?.id ??
      injectable.find((o) => /url/i.test(o.id))?.id ??
      injectable[0]?.id;
    const seeded: Record<string, { checked: boolean; envKey: string }> = {};
    for (const o of injectable) {
      seeded[o.id] = {
        checked: o.id === primaryId,
        envKey: defaultEnvKey(sourceAppTemplateId, o.id),
      };
    }
    setRows(seeded);
  }, [open, injectable, sourceAppTemplateId]);

  useEffect(() => {
    if (!open) return;
    projectsApi
      .getHome()
      .then((res) => {
        const list = (res?.projects ?? [])
          .filter((p: { id?: string }) => p.id && p.id !== sourceProjectId)
          .map((p: RawProject): TargetProject => {
            const domain =
              p.primaryDomain ||
              (p.slug ? `${p.slug}.${baseDomain}` : null) ||
              hostingLabel(p, t.projects.hosting);
            return {
              id: p.id,
              name: p.name ?? p.id,
              description: domain ?? "",
              appTemplateId: p.appTemplateId,
              favicon: p.favicon,
            };
          });
        setTargets(list);
      })
      .catch(() => setTargets([]));
  }, [open, sourceProjectId, baseDomain, t]);

  const selected = injectable.filter((o) => rows[o.id]?.checked && rows[o.id]?.envKey.trim());

  const submit = async () => {
    if (!targetId || selected.length === 0 || busy) return;
    setBusy(true);
    let ok = 0;
    let firstError: unknown = null;
    for (const o of selected) {
      try {
        await connectionsApi.create(targetId, {
          sourceProjectId,
          outputId: o.id,
          envKey: rows[o.id].envKey.trim(),
          mode,
        });
        ok += 1;
      } catch (err) {
        firstError = firstError ?? err;
      }
    }
    setBusy(false);
    const targetName = targets.find((p) => p.id === targetId)?.name ?? "";
    if (ok > 0) {
      showToast(interpolate(c.connectedN, { count: String(ok), project: targetName }), "success");
    }
    if (firstError && ok === 0) {
      showToast(getApiErrorMessage(firstError, c.failed), "error");
      return;
    }
    if (firstError) showToast(getApiErrorMessage(firstError, c.failed), "error");
    onClose();
  };

  return (
    <Modal isOpen={open} onClose={onClose} width="480px" maxWidth="95vw" showCloseButton>
      <div className="p-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-foreground">{c.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{c.subtitle}</p>
        </div>

        <div className="space-y-4">
          {/* Target project — rich rows: logo + name + domain/host */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {c.targetLabel}
            </label>
            <div className="mt-1">
              <CustomSelect
                value={targetId}
                options={targets.map((p) => ({
                  value: p.id,
                  label: p.name,
                  description: p.description || undefined,
                  icon: (
                    <AppLogo appId={p.appTemplateId} src={p.favicon ?? undefined} className="size-4" />
                  ),
                }))}
                onChange={setTargetId}
                placeholder={c.targetPlaceholder}
              />
            </div>
          </div>

          {/* Values to inject — tick one or more; each gets its own env var */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {c.valuesLabel}
            </label>
            <div className="mt-1 space-y-1.5">
              {injectable.map((o) => {
                const row = rows[o.id] ?? { checked: false, envKey: "" };
                return (
                  <div
                    key={o.id}
                    className={`flex items-center gap-2 rounded-xl border p-2 transition-colors ${
                      row.checked ? "border-primary/40 bg-primary/[0.04]" : "border-border/50"
                    }`}
                  >
                    <Checkbox
                      checked={row.checked}
                      onCheckedChange={(checked) =>
                        setRows((prev) => ({ ...prev, [o.id]: { ...row, checked } }))
                      }
                      aria-label={o.label}
                    />
                    <span className="w-28 shrink-0 truncate text-sm text-foreground" title={o.label}>
                      {o.label}
                    </span>
                    <input
                      value={row.envKey}
                      onChange={(e) =>
                        setRows((prev) => ({ ...prev, [o.id]: { ...row, envKey: e.target.value } }))
                      }
                      onFocus={() =>
                        !row.checked &&
                        setRows((prev) => ({ ...prev, [o.id]: { ...row, checked: true } }))
                      }
                      spellCheck={false}
                      placeholder="ENV_VAR"
                      className="min-w-0 flex-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                    />
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">{c.redeployHint}</p>
          </div>

          {/* Reach mode */}
          <div className="space-y-2">
            <ModeCard
              selected={mode === "internal"}
              onSelect={() => setMode("internal")}
              icon={<Network className="size-4" />}
              label={c.modeInternal}
              desc={c.modeInternalDesc}
            />
            <ModeCard
              selected={mode === "public"}
              onSelect={() => setMode("public")}
              icon={<Globe className="size-4" />}
              label={c.modePublic}
              desc={c.modePublicDesc}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {c.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!targetId || selected.length === 0 || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {c.connect}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ModeCard({
  selected,
  onSelect,
  icon,
  label,
  desc,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        selected ? "border-primary/50 bg-primary/5" : "border-border/50 hover:bg-muted/30"
      }`}
    >
      <span className={`mt-0.5 ${selected ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
