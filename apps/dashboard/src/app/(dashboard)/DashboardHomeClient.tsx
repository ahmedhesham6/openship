"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  Rocket,
  ArrowRight,
  ExternalLink,
  Clock,
  BookOpen,
  Boxes,
  GitBranch,
  Settings,
  Activity,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { projectsApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import HomeTipCard from "@/components/overview/HomeTipCard";
import HomeWelcome from "@/components/overview/HomeWelcome";
import { useI18n } from "@/components/i18n-provider";
import { getProjectStatus, PROJECT_STATUS_META } from "@/utils/project-status";
import { PageContainer } from "@/components/ui/PageContainer";
import ProjectCard from "./projects/components/ProjectCard";
import { type Project } from "@/constants/mock";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

import { useDashboardHome } from "@/hooks/useDashboardHome";

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

interface DashboardHomeClientProps {
  initialData?: any;
}

export default function DashboardHomeClient({ initialData }: DashboardHomeClientProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  
  const { projects, numbers, loading } = useDashboardHome(initialData);

  /* ---------- greeting ---------- */
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t.dashboard.home.goodMorning
      : hour < 18
        ? t.dashboard.home.goodAfternoon
        : t.dashboard.home.goodEvening;
  const displayName = user?.name?.split(" ")[0] || "";

  const successRate = numbers.total_deployments 
    ? Math.round(((numbers.total_success_deployments || 0) / numbers.total_deployments) * 100)
    : 0;

  return (
    <PageContainer>
        
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-2xl font-medium text-foreground/80" style={{ letterSpacing: "-0.2px" }}>
            {displayName ? `${greeting}, ${displayName}` : greeting}
          </h1>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {t.dashboard.home.subtitle}
          </p>
        </div>

        {/* ── Main Grid ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          
          {/* ── LEFT COLUMN ────────────────────────────────────────── */}
          <div className="space-y-6 min-w-0">
            
            {/* Projects Section */}
            <div className="bg-card rounded-2xl border border-border/50">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center">
                    <FolderKanban className="size-[18px] text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground text-[15px]">Your Projects</h2>
                    <p className="text-xs text-muted-foreground">
                      {loading ? "Loading..." : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <Link
                  href="/projects"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  View all
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="divide-y divide-border/50">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                      <div className="w-10 h-10 bg-muted rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-32 bg-muted rounded" />
                        <div className="h-3 w-48 bg-muted rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <HomeWelcome />
              ) : (
                <div className="divide-y divide-border/50">
                  {projects.slice(0, 6).map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                  {projects.length > 6 && (
                    <Link
                      href="/projects"
                      className="block px-5 py-3 text-center text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                      View all {projects.length} projects →
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Shortcuts Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Link
                href="/library"
                className="bg-card border border-border/50 rounded-xl p-4 hover:bg-muted/40 hover:border-border transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <GitBranch className="size-[18px] text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">Import Git</p>
                <p className="text-xs text-muted-foreground mt-0.5">From repository</p>
              </Link>
              <Link
                href="/settings?tab=mcp"
                className="bg-card border border-border/50 rounded-xl p-4 hover:bg-muted/40 hover:border-border transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <Boxes className="size-[18px] text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">MCP Deploy</p>
                <p className="text-xs text-muted-foreground mt-0.5">Connect an AI agent</p>
              </Link>
              <Link
                href="/settings"
                className="bg-card border border-border/50 rounded-xl p-4 hover:bg-muted/40 hover:border-border transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <Settings className="size-[18px] text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">Settings</p>
                <p className="text-xs text-muted-foreground mt-0.5">Account & team</p>
              </Link>
              <a
                href="https://docs.openship.io"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-card border border-border/50 rounded-xl p-4 hover:bg-muted/40 hover:border-border transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <BookOpen className="size-[18px] text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground flex items-center gap-1">
                  Docs
                  <ExternalLink className="size-3 text-muted-foreground" />
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Learn more</p>
              </a>
            </div>
          </div>

          {/* ── RIGHT COLUMN (Sticky) ──────────────────────────────── */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            
            {/* Activity Overview */}
            <div className="bg-card rounded-2xl border border-border/50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="size-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground text-sm">Activity</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FolderKanban className="size-4 text-primary" />
                    </div>
                    <span className="text-sm text-muted-foreground">Projects</span>
                  </div>
                  <span className="text-lg font-semibold text-foreground">
                    {loading ? "–" : numbers.total_active_projects ?? 0}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                      <Rocket className="size-4 text-orange-500" />
                    </div>
                    <span className="text-sm text-muted-foreground">Deployments</span>
                  </div>
                  <span className="text-lg font-semibold text-foreground">
                    {loading ? "–" : numbers.total_deployments ?? 0}
                  </span>
                </div>
                
                <div className="h-px bg-border/60 my-2" />
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    <span className="text-sm text-muted-foreground">Success rate</span>
                  </div>
                  <span className={`text-sm font-medium ${successRate >= 80 ? 'text-emerald-500' : successRate >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                    {loading ? "–" : `${successRate}%`}
                  </span>
                </div>
              </div>
            </div>

            <HomeTipCard projectCount={projects.length} loading={loading} />

            {/* Recent Activity */}
            <div className="bg-card rounded-2xl border border-border/50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="size-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground text-sm">Recent</h3>
              </div>
              
              {loading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-muted" />
                      <div className="flex-1 h-4 bg-muted rounded" />
                    </div>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-4">
                  <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <Clock className="size-4 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    Your activity will appear here
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {projects.slice(0, 4).map((p) => {
                    const status = getProjectStatus(p);
                    const statusMeta = PROJECT_STATUS_META[status];

                    return (
                      <div
                        key={p.id}
                        onClick={() => router.push(`/projects/${p.id}`)}
                        className="flex items-center gap-3 cursor-pointer group"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
                            {p.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {statusMeta.label} • {timeAgo(p.updatedAt || p.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Usage Notice */}
            {!loading && (numbers.total_active_projects ?? 0) > 0 && (
              <div className="bg-card rounded-2xl border border-border/50 p-5">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <TrendingUp className="size-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">All systems operational</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Your projects are running smoothly
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
    </PageContainer>
  );
}
