"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useProjectSettings } from "@/context/ProjectSettingsContext";
import { usePlatform } from "@/context/PlatformContext";
import { servicesApi, type Service, type ServiceContainer, type ServiceInput } from "@/lib/api/services";
import { deployApi } from "@/lib/api/deploy";
import { useToast } from "@/context/ToastContext";
import { resolveServiceHostnameLabel } from "@repo/core";
import { useRouter } from "next/navigation";
import {
  Layers,
  RefreshCw,
  Globe,
  Container,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  Plus,
  Database,
  Zap,
} from "lucide-react";
import { ServiceDetailPanel } from "./services/ServiceDetailPanel";
import { AddServiceModal } from "./services/AddServiceModal";

/* ── Main Component ─────────────────────────────────────────────────── */

export const ServicesTab = () => {
  const { id, slug, projectData, servicesData, refreshServices } = useProjectSettings();
  const { baseDomain } = usePlatform();
  const { showToast } = useToast();
  const router = useRouter();

  const [containers, setContainers] = useState<ServiceContainer[]>([]);
  const [containersLoading, setContainersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const services = servicesData.services;
  const loading = servicesData.isLoading || containersLoading;
  const projectSlugBase = projectData.slug || projectData.name || "project";
  const selectedId = slug?.[1] ?? null;
  const hasProjectId = Boolean(id && id !== "undefined");

  const fetchData = useCallback(async () => {
    if (!hasProjectId) {
      setContainers([]);
      setContainersLoading(false);
      return;
    }

    try {
      setContainersLoading(true);
      setError(null);
      const [, ctRes] = await Promise.all([refreshServices(), servicesApi.containers(id)]);
      if (ctRes.success) setContainers(ctRes.containers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load services");
    } finally {
      setContainersLoading(false);
    }
  }, [hasProjectId, id, refreshServices]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const containerFor = (serviceId: string) => containers.find((c) => c.serviceId === serviceId);

  const selectedService = services.find((s) => s.id === selectedId);

  const resolveServiceUrl = (service: Service) => {
    if (!service.exposed) return null;
    if (service.domainType === "custom" && service.customDomain) {
      return `https://${service.customDomain}`;
    }
    const subdomain = resolveServiceHostnameLabel(projectSlugBase, service.name, service.domain);
    return `https://${subdomain}.${baseDomain}`;
  };

  const openService = (serviceId: string) => {
    if (!hasProjectId) return;
    router.push(`/projects/${id}/services/${serviceId}`);
  };

  const closeService = () => {
    if (!hasProjectId) return;
    router.push(`/projects/${id}/services`);
  };

  const handleCreateService = async (data: ServiceInput) => {
    if (!hasProjectId) return;

    const result = await servicesApi.create(id, data);
    if (!result.success) {
      throw new Error("Failed to create service");
    }

    await fetchData();

    // Auto-deploy the new service. Without this step `createService` only
    // saves a DB row — no container actually starts until the next project
    // deploy. We trigger a redeploy of the project's active deployment so
    // the user's "Add" gesture really brings the service up.
    //
    // If there's no active deployment (brand new project), we surface a
    // softer message — the user has to do the first deploy themselves.
    const activeDeploymentId = projectData?.activeDeploymentId;
    if (activeDeploymentId) {
      showToast(`${data.name} added — deploying…`, "success", "Service");
      deployApi
        .buildRedeploy(activeDeploymentId)
        .then((res: any) => {
          if (res?.success === false) {
            showToast(res?.error || "Deploy failed", "error", data.name);
            return;
          }
          showToast(`${data.name} is starting`, "success", "Service");
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Deploy failed";
          showToast(msg, "error", data.name);
        });
    } else {
      showToast(`${data.name} saved — deploy the project to start it`, "success", "Service");
    }

    if (result.service?.id) {
      router.push(`/projects/${id}/services/${result.service.id}`);
    }
  };

  /* ── Loading state ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card rounded-2xl border border-border/50 p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded-lg" />
                <div className="h-3 w-48 bg-muted/60 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ── Error state ───────────────────────────────────────────────── */
  if (error || servicesData.error) {
    return (
      <div className="bg-card rounded-2xl border border-border/50 p-8 text-center">
        <AlertCircle className="size-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">Failed to load services</p>
        <p className="text-xs text-muted-foreground mb-4">{error || servicesData.error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
      </div>
    );
  }

  /* ── Empty state ───────────────────────────────────────────────── */
  if (services.length === 0) {
    return (
      <>
        <div className="bg-card rounded-2xl border border-border/50 p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Layers className="size-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-foreground/80 mb-1">No services connected</p>
          <p className="text-xs text-muted-foreground/60 max-w-[300px] mx-auto mb-5 leading-relaxed">
            Add databases, caches, or other services to extend your app.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-5">
            {[
              { label: "PostgreSQL", icon: Database },
              { label: "Redis", icon: Zap },
              { label: "MySQL", icon: Database },
            ].map((svc) => (
              <span
                key={svc.label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/40 text-[12px] text-muted-foreground"
              >
                <svc.icon className="size-3" />
                {svc.label}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" />
              Add Service
            </button>
          </div>
        </div>
        <AddServiceModal
          open={createOpen}
          projectName={projectSlugBase}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreateService}
        />
      </>
    );
  }

  /* ── Service list + detail panel ───────────────────────────────── */
  if (selectedService) {
    return (
      <div className="space-y-5">
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={closeService}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors shrink-0"
              >
                <ArrowLeft className="size-3.5" />
                All services
              </button>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {selectedService.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Service settings, ports, logs, and container controls.
                </p>
              </div>
            </div>

            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors shrink-0"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
          </div>
        </div>

        <ServiceDetailPanel
          service={selectedService}
          container={containerFor(selectedService.id)}
          projectId={id}
          projectSlugBase={projectSlugBase}
          onRefresh={fetchData}
          onDeleted={closeService}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Layers className="size-[18px] text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {services.length} Service{services.length !== 1 ? "s" : ""}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose a service to open its full settings screen.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" />
              Add Service
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 divide-y divide-border/30 overflow-hidden">
        {services.map((svc) => {
          const ct = containerFor(svc.id);
          const status = ct?.status ?? (svc.enabled ? "stopped" : "disabled");
          const resolvedUrl = resolveServiceUrl(svc);

          return (
            <button
              key={svc.id}
              onClick={() => openService(svc.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-foreground/[0.025]"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-muted/50">
                <Container className="size-[18px] text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-foreground truncate">
                    {svc.name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] ${svc.exposed ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted/60 text-muted-foreground/70"}`}
                  >
                    <Globe className="size-2.5" />
                    {svc.exposed ? "Public" : "Internal"}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground truncate mt-1">
                  {resolvedUrl?.replace("https://", "") ?? (svc.image || svc.build || "—")}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <StatusBadge status={status} />
                <ChevronRight className="size-4 text-muted-foreground/50" />
              </div>
            </button>
          );
        })}
      </div>

      <AddServiceModal
        open={createOpen}
        projectName={projectSlugBase}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateService}
      />
    </div>
  );
};

/* ── Status Badge ───────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { dot: string; badge: string; label: string }> = {
    running: {
      dot: "bg-emerald-500",
      badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      label: "Running",
    },
    stopped: {
      dot: "bg-muted-foreground/30",
      badge: "bg-muted/60 text-muted-foreground/70",
      label: "Stopped",
    },
    disabled: {
      dot: "bg-muted-foreground/20",
      badge: "bg-muted/40 text-muted-foreground/50",
      label: "Disabled",
    },
    failed: {
      dot: "bg-red-500",
      badge: "bg-red-500/10 text-red-600 dark:text-red-400",
      label: "Failed",
    },
    starting: {
      dot: "bg-amber-500",
      badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      label: "Starting",
    },
  };
  const s = map[status] ?? map.stopped;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
