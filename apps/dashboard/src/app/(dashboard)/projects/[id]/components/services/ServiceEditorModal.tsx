"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Service, ServiceInput } from "@/lib/api/services";
import { RoutingSettingsCard } from "@/components/routing/RoutingSettingsCard";
import EnvironmentVariables from "@/components/import-project/EnvironmentVariables";

type EnvRow = { key: string; value: string; visible: boolean };

type ServiceEditorMode = "create" | "edit";

interface ServiceEditorModalProps {
  open: boolean;
  mode: ServiceEditorMode;
  service?: Service | null;
  projectName: string;
  onClose: () => void;
  onSubmit: (data: ServiceInput) => Promise<void>;
}

const splitList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const joinList = (value?: string[] | null) => (value ?? []).join("\n");

const envRowsFromRecord = (value?: Record<string, string> | null): EnvRow[] =>
  // Service env values are config knobs more often than secrets — show them
  // by default so the user can read what's there without un-masking each row.
  Object.entries(value ?? {}).map(([key, val]) => ({ key, value: val, visible: true }));

const envRecordFromRows = (rows: EnvRow[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    out[k] = r.value;
  }
  return out;
};

export function ServiceEditorModal({
  open,
  mode,
  service,
  projectName,
  onClose,
  onSubmit,
}: ServiceEditorModalProps) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"image" | "build">("image");
  const [image, setImage] = useState("");
  const [build, setBuild] = useState("");
  const [dockerfile, setDockerfile] = useState("");
  const [ports, setPorts] = useState("");
  const [dependsOn, setDependsOn] = useState("");
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [volumes, setVolumes] = useState("");
  const [command, setCommand] = useState("");
  const [restart, setRestart] = useState("unless-stopped");
  const [enabled, setEnabled] = useState(true);
  const [exposed, setExposed] = useState(false);
  const [exposedPort, setExposedPort] = useState("");
  const [domain, setDomain] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [domainType, setDomainType] = useState<"free" | "custom">("free");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setName(service?.name ?? "");
    setSourceType(service?.build || service?.dockerfile ? "build" : "image");
    setImage(service?.image ?? "");
    setBuild(service?.build ?? "");
    setDockerfile(service?.dockerfile ?? "");
    setPorts(joinList(service?.ports));
    setDependsOn(joinList(service?.dependsOn));
    setEnvRows(envRowsFromRecord(service?.environment));
    setVolumes(joinList(service?.volumes));
    setCommand(service?.command ?? "");
    setRestart(service?.restart ?? "unless-stopped");
    setEnabled(service?.enabled ?? true);
    setExposed(service?.exposed ?? false);
    setExposedPort(service?.exposedPort ?? "");
    setDomain(service?.domain ?? "");
    setCustomDomain(service?.customDomain ?? "");
    setDomainType(service?.domainType === "custom" ? "custom" : "free");
    setError(null);
    setSaving(false);
  }, [open, service]);

  const portList = useMemo(() => splitList(ports), [ports]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("Service name is required.");
      return;
    }

    if (sourceType === "image" && !image.trim()) {
      setError("Add an image, or switch to Dockerfile build.");
      return;
    }

    if (sourceType === "build" && !build.trim() && !dockerfile.trim()) {
      setError("Add a build context or Dockerfile path.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload: ServiceInput = {
      name: trimmedName,
      image: sourceType === "image" ? image.trim() : "",
      build: sourceType === "build" ? build.trim() || "." : "",
      dockerfile: sourceType === "build" ? dockerfile.trim() : "",
      ports: portList,
      dependsOn: splitList(dependsOn),
      environment: envRecordFromRows(envRows),
      volumes: splitList(volumes),
      command: command.trim(),
      restart,
      enabled,
      exposed,
      exposedPort: exposed ? exposedPort.trim() || undefined : undefined,
      domain: exposed && domainType === "free" ? domain.trim() || undefined : undefined,
      customDomain:
        exposed && domainType === "custom" ? customDomain.trim() || undefined : undefined,
      domainType,
    };

    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save service.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} maxWidth="760px" width="100%" maxHeight="92vh">
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col">
        <div className="border-b border-border/40 px-6 py-5">
          <h2 className="text-base font-semibold text-foreground">
            {mode === "create" ? "Add service" : "Edit service"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Services are project children. Compose can create them, and manual services use the same deploy path.
          </p>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <Field label="Name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="web"
              className="h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
            />
          </Field>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSourceType("image")}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  sourceType === "image"
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                }`}
              >
                Image
              </button>
              <button
                type="button"
                onClick={() => setSourceType("build")}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  sourceType === "build"
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                }`}
              >
                Dockerfile
              </button>
            </div>

            {sourceType === "image" ? (
              <Field label="Image">
                <input
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  placeholder="postgres:16"
                  className="h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
                />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Build context">
                  <input
                    value={build}
                    onChange={(event) => setBuild(event.target.value)}
                    placeholder="."
                    className="h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
                  />
                </Field>
                <Field label="Dockerfile">
                  <input
                    value={dockerfile}
                    onChange={(event) => setDockerfile(event.target.value)}
                    placeholder="Dockerfile"
                    className="h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ports">
              <textarea
                value={ports}
                onChange={(event) => setPorts(event.target.value)}
                placeholder={"3000\n8080:80"}
                rows={3}
                className="w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
              />
            </Field>
            <Field label="Depends on">
              <textarea
                value={dependsOn}
                onChange={(event) => setDependsOn(event.target.value)}
                placeholder={"db\nredis"}
                rows={3}
                className="w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Command">
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npm start"
                className="h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
              />
            </Field>
            <Field label="Restart policy">
              <select
                value={restart}
                onChange={(event) => setRestart(event.target.value)}
                className="h-11 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
              >
                <option value="unless-stopped">unless-stopped</option>
                <option value="always">always</option>
                <option value="on-failure">on-failure</option>
                <option value="no">no</option>
              </select>
            </Field>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Environment</p>
            <EnvironmentVariables
              mode="settings"
              envVars={envRows}
              onEnvVarsChange={setEnvRows}
              isEditingMode={true}
              setIsEditingMode={() => { /* always editing in modal context */ }}
              showSettingsActions={false}
              borderless
            />
          </div>

          <Field label="Volumes">
            <textarea
              value={volumes}
              onChange={(event) => setVolumes(event.target.value)}
              placeholder={"pgdata:/var/lib/postgresql/data"}
              rows={2}
              className="w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
            />
          </Field>

          <div className="rounded-2xl border border-border/50 bg-muted/10 p-4">
            <RoutingSettingsCard
              projectName={projectName}
              domain={domain}
              customDomain={customDomain}
              domainType={domainType}
              exposed={exposed}
              ports={portList}
              exposedPort={exposedPort}
              onExposedChange={setExposed}
              onDomainTypeChange={setDomainType}
              onDomainChange={setDomain}
              onCustomDomainChange={setCustomDomain}
              onExposedPortChange={setExposedPort}
              saveMode="change"
            />
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-border/50 bg-muted/10 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Enabled</span>
              <span className="text-xs text-muted-foreground">Enabled services deploy with the project.</span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/40 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground/[0.06] px-4 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.1] disabled:opacity-50"
          >
            <X className="size-4" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : mode === "create" ? (
              <Plus className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            {mode === "create" ? "Add service" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
