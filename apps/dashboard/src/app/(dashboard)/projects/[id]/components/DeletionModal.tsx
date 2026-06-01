import React, { useEffect, useState } from "react";
import { AlertTriangle, Database, HardDrive, Loader2 } from "lucide-react";
import { projectsApi } from "@/lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deleteApp: boolean, wipeVolumes: boolean) => void;
  projectName: string;
  projectId?: string | number;
}

interface ServicePreview {
  id: string;
  name: string;
  image: string | null;
  volumes: string[];
  hasContainer: boolean;
}

interface Preview {
  selfHosted: boolean;
  services: ServicePreview[];
  deploymentVolumes: string[];
  networks: string[];
  totalVolumes: number;
}

export const DeletionModal = ({
  isOpen,
  onClose,
  onConfirm,
  projectName,
  projectId,
}: Props) => {
  const [inputValue, setInputValue] = useState("");
  const [deleteApp, setDeleteApp] = useState(true);
  const [wipeVolumes, setWipeVolumes] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const isConfirmDisabled = inputValue !== projectName;

  // Reset state + fetch the deletion preview each time the modal opens.
  // Preview is a read-only snapshot of what teardown will touch — services
  // with their named volumes, networks. Used to render the wipe-data toggle
  // intelligently (no toggle when there's nothing to wipe).
  useEffect(() => {
    if (!isOpen) return;
    setInputValue("");
    setDeleteApp(true);
    setWipeVolumes(false);
    setPreview(null);

    if (!projectId) return;
    let cancelled = false;
    setPreviewLoading(true);
    projectsApi
      .deletionPreview(projectId)
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res.preview) {
          setPreview({
            selfHosted: res.preview.selfHosted,
            services: res.preview.services,
            deploymentVolumes: res.preview.deploymentVolumes,
            networks: res.preview.networks,
            totalVolumes: res.preview.totalVolumes,
          });
        }
      })
      .catch(() => { /* preview is informational — silent on failure */ })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const hasVolumes = (preview?.totalVolumes ?? 0) > 0;
  const servicesWithVolumes = preview?.services.filter((s) => s.volumes.length > 0) ?? [];
  const showWipeBlock = !previewLoading && preview?.selfHosted && hasVolumes;

  const handleConfirm = () => {
    if (isConfirmDisabled) return;
    onConfirm(deleteApp, showWipeBlock ? wipeVolumes : false);
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div
        className="border border-border/60 rounded-2xl max-w-lg w-full shadow-xl overflow-hidden"
        style={{ backgroundColor: "var(--th-card-bg-solid, var(--card))" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <div className="size-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-[18px] text-amber-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground">Delete project</h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              This action cannot be undone.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            You are about to delete <strong className="text-foreground">{projectName}</strong>.
          </p>

          {/* App vs single environment */}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-muted/15 p-3">
            <input
              type="checkbox"
              checked={deleteApp}
              onChange={(e) => setDeleteApp(e.target.checked)}
              className="mt-0.5 size-4 rounded border-border accent-red-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Delete all environments</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {deleteApp
                  ? "Removes the project app and every branch environment under it."
                  : "Removes only this environment. Other branches stay."}
              </span>
            </span>
          </label>

          {/* Wipe-volumes block — only shows when there's actual data on disk */}
          {previewLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Scanning attached services and volumes…
            </div>
          ) : showWipeBlock ? (
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <label className="flex cursor-pointer items-start gap-3 bg-muted/15 px-3 py-3">
                <input
                  type="checkbox"
                  checked={wipeVolumes}
                  onChange={(e) => setWipeVolumes(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-border accent-red-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <HardDrive className="size-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      Also wipe service data ({preview!.totalVolumes} volume{preview!.totalVolumes === 1 ? "" : "s"})
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {wipeVolumes
                      ? "Volumes will be permanently removed — database contents, caches, uploads, everything stored by these services will be gone."
                      : "Off: containers are removed but their named volumes stay on disk. Re-attach them later by name."}
                  </span>
                </span>
              </label>

              {/* Service list — only services that actually have volumes */}
              {servicesWithVolumes.length > 0 && (
                <ul className="border-t border-border/40 divide-y divide-border/30">
                  {servicesWithVolumes.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <Database className="size-3.5 text-muted-foreground/70 shrink-0" />
                      <span className="text-[13px] font-medium text-foreground truncate flex-1">
                        {s.name}
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground/70 shrink-0">
                        {s.volumes.length} vol{s.volumes.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                  {preview!.deploymentVolumes.length > 0 && (
                    <li className="flex items-center gap-3 px-3 py-2.5">
                      <Database className="size-3.5 text-muted-foreground/70 shrink-0" />
                      <span className="text-[13px] font-medium text-foreground truncate flex-1">
                        App data
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground/70 shrink-0">
                        {preview!.deploymentVolumes.length} vol{preview!.deploymentVolumes.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          ) : null}

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              {wipeVolumes
                ? "All deployments, domains, env vars, and persistent service data will be permanently removed."
                : "All deployments, domains, env vars, and analytics will be permanently removed."}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Type <span className="font-mono text-foreground bg-muted/60 px-1 rounded">{projectName}</span> to confirm.
            </p>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={projectName}
              spellCheck={false}
              autoComplete="off"
              className="w-full px-3 py-2 bg-muted/30 text-foreground border border-border/50 rounded-xl text-sm focus:border-primary/40 focus:ring-2 focus:ring-primary/15 outline-none transition-all"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border/40 px-5 py-3 bg-muted/[0.04]">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-xl bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              isConfirmDisabled
                ? "bg-muted text-muted-foreground/70 cursor-not-allowed"
                : "bg-red-600 text-white hover:bg-red-700"
            }`}
          >
            {wipeVolumes
              ? deleteApp ? "Delete + wipe data" : "Delete environment + wipe data"
              : deleteApp ? "Delete project" : "Delete environment"}
          </button>
        </div>
      </div>
    </div>
  );
};
