"use client";

/**
 * Branding tab — white-labels the Zero webmail surface.
 *
 * Flow: dashboard → openship API (`/api/mail/branding/:serverId`)
 *               → Zero webmail server (`PATCH /admin/branding`)
 *
 * The Zero server fully owns branding storage (its local filesystem at
 * ${BRANDING_PATH}/config.json). The dashboard never talks to Zero
 * directly — openship proxies the call so:
 *   - The shared `BRANDING_ADMIN_TOKEN` stays server-side, never in the
 *     browser.
 *   - The dashboard authenticates to openship with the operator's normal
 *     session (no cross-origin Zero auth needed).
 *   - Zero can run on a different host from iRedMail and from openship —
 *     the only requirement is "openship API can reach Zero's HTTP port".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ExternalLink,
  Loader2,
  Palette,
  RotateCcw,
  Sparkles,
  Type,
} from "lucide-react";
import { mailApi, type Branding } from "@/lib/api";
import { SectionCard } from "./_shared/section-card";
import { Field, inputClassName } from "./_shared/form-modal-content";

const DEFAULTS: Branding = {
  siteTitle: "OpenShip Mail",
  siteDescription: "Your self-hosted mailbox.",
  loginHeading: "OpenShip Mail",
  loginSubtext: "Sign in with your mailbox credentials",
  loginFooter: "Self-hosted on your own mail server. No third parties.",
  homeHtml: null,
};

interface Props {
  serverId: string;
}

export function BrandingTab({ serverId }: Props) {
  const [initial, setInitial] = useState<Branding | null>(null);
  const [form, setForm] = useState<Branding>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const { branding } = await mailApi.getBranding(serverId);
      setInitial(branding);
      setForm(branding);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load branding");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!initial) return false;
    return (
      initial.siteTitle !== form.siteTitle ||
      initial.siteDescription !== form.siteDescription ||
      initial.loginHeading !== form.loginHeading ||
      initial.loginSubtext !== form.loginSubtext ||
      initial.loginFooter !== form.loginFooter
    );
  }, [initial, form]);

  const setField = (k: keyof Branding) => (v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  const onSave = async () => {
    setSaving(true);
    try {
      const { branding } = await mailApi.updateBranding(serverId, {
        siteTitle: form.siteTitle,
        siteDescription: form.siteDescription,
        loginHeading: form.loginHeading,
        loginSubtext: form.loginSubtext,
        loginFooter: form.loginFooter,
      });
      setInitial(branding);
      setForm(branding);
      toast.success("Branding saved", {
        description: "Refresh the login page to see updates.",
      });
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setForm({ ...DEFAULTS, homeHtml: form.homeHtml });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-8 justify-center">
        <Loader2 className="size-4 animate-spin" />
        Loading branding…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-600 dark:text-red-400">
        <div className="font-semibold mb-1">Couldn't reach the webmail server</div>
        <p className="leading-relaxed">{loadErr}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Openship API proxies branding writes to the webmail server. Check
          that <code className="font-mono">MAIL_WEBMAIL_URL</code> is set
          and reachable from the API host.
        </p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
        >
          <RotateCcw className="size-3.5" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
      <div className="space-y-5">
        <SectionCard
          icon={Type}
          title="Site identity"
          description="Shows in the browser tab and on the mail dashboard."
        >
          <div className="space-y-4">
            <Field label="Site title" hint="The <title> tag for every page.">
              <input
                className={inputClassName}
                value={form.siteTitle}
                onChange={(e) => setField("siteTitle")(e.target.value)}
                maxLength={120}
                placeholder="OpenShip Mail"
              />
            </Field>
            <Field
              label="Site description"
              hint="Meta description used by search engines and link previews."
            >
              <input
                className={inputClassName}
                value={form.siteDescription}
                onChange={(e) => setField("siteDescription")(e.target.value)}
                maxLength={400}
                placeholder="Your self-hosted mailbox."
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          icon={Palette}
          title="Login page"
          description="The heading, subtext, and footer on the sign-in screen."
        >
          <div className="space-y-4">
            <Field label="Heading">
              <input
                className={inputClassName}
                value={form.loginHeading}
                onChange={(e) => setField("loginHeading")(e.target.value)}
                maxLength={120}
                placeholder="OpenShip Mail"
              />
            </Field>
            <Field label="Subtext">
              <input
                className={inputClassName}
                value={form.loginSubtext}
                onChange={(e) => setField("loginSubtext")(e.target.value)}
                maxLength={240}
                placeholder="Sign in with your mailbox credentials"
              />
            </Field>
            <Field
              label="Footer"
              hint="Tiny single line below the sign-in card."
            >
              <input
                className={inputClassName}
                value={form.loginFooter}
                onChange={(e) => setField("loginFooter")(e.target.value)}
                maxLength={240}
                placeholder="Self-hosted on your own mail server. No third parties."
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          icon={Sparkles}
          title="Home page HTML"
          description="Raw HTML for a custom landing page at /. Coming soon."
        >
          <Field
            label="HTML body"
            hint="When implemented, this HTML will render at the root URL instead of redirecting to /login."
          >
            <textarea
              className={`${inputClassName} min-h-[140px] font-mono text-xs resize-y opacity-60`}
              disabled
              placeholder="<!-- Coming soon: paste arbitrary HTML for the landing page -->"
              value=""
              readOnly
            />
          </Field>
        </SectionCard>
      </div>

      <aside className="space-y-5">
        <SectionCard icon={Check} title="Save changes">
          <div className="space-y-3">
            <button
              onClick={() => void onSave()}
              disabled={!dirty || saving}
              className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2.5 text-sm font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {saving ? "Saving…" : "Save branding"}
            </button>
            <button
              onClick={onReset}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2.5 text-sm font-semibold rounded-xl bg-muted text-foreground hover:bg-muted/80 border border-border transition-colors disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
              Reset to defaults
            </button>
          </div>
        </SectionCard>

        <SectionCard icon={ExternalLink} title="Preview">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Open the webmail's sign-in screen in a new tab. Hard
            refresh (Cmd+Shift+R) if you saved branding moments ago — the
            client caches the response briefly.
          </p>
        </SectionCard>
      </aside>
    </div>
  );
}
