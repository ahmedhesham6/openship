"use client";

/**
 * Domains tab — list + create/edit/delete for vmail.domain rows.
 *
 * Real table layout (DataTable primitive) with sticky header, dense
 * rows, and proper columns: Domain · Mailboxes · Aliases · Quota ·
 * Status · actions. Skeleton placeholders cover loading.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Globe } from "lucide-react";
import {
  mailAdminApi,
  type AdminDomain,
  type AdditionalDomainDnsState,
  getApiErrorMessage,
} from "@/lib/api";
import { useModal } from "@/context/ModalContext";
import {
  DataTable,
  RowIconButton,
  type DataTableColumn,
} from "./_shared/data-table";
import { StatusPill } from "./_shared/status-pill";
import {
  Field,
  FormModalContent,
  inputClassName,
} from "./_shared/form-modal-content";
import { useToast } from "@/context/ToastContext";
import type { DnsRecords } from "@/lib/api";
import { DnsHoldBanner } from "../dns-hold-banner";
import {
  ReputationBanner,
  REPUTATION_STORAGE_PREFIX,
  reputationStorageKey,
} from "./reputation-banner";
import { WelcomeModal } from "./welcome-modal";

interface DomainsTabProps {
  serverId: string;
  primaryDomain: string;
  /**
   * Invoked after a successful domain delete. The parent uses this to
   * clear `?domain=<deleted>` from the URL so the Mailboxes tab doesn't
   * keep fetching from a domain that no longer exists.
   */
  onDomainDeleted?: (domain: string) => void;
}

export function DomainsTab({
  serverId,
  primaryDomain,
  onDomainDeleted,
}: DomainsTabProps) {
  const { showModal, hideModal } = useModal();
  const { showToast } = useToast();
  const [rows, setRows] = useState<AdminDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDns, setPendingDns] = useState<AdditionalDomainDnsState[]>([]);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  // Additional domains currently in their 7-day reputation warm-up window.
  // Seeded from localStorage on mount and updated whenever the operator
  // acks a new domain. Excludes the primary install — its banner lives at
  // the admin-panel level.
  const [warmupDomains, setWarmupDomains] = useState<string[]>([]);
  // The additional domain (if any) whose welcome / test-email modal is
  // currently open. Set right after the operator acks the DNS banner so
  // the modal can fire a real test FROM the freshly-published domain —
  // proving MX/SPF/DKIM/DMARC end-to-end against the records they just
  // pasted into their provider.
  const [welcomeFor, setWelcomeFor] = useState<string | null>(null);

  const acknowledgeDomain = useCallback(
    async (domain: string) => {
      setAcknowledging(domain);
      try {
        await mailAdminApi.domains.acknowledgeDns(serverId, domain);
        // Seed the reputation warm-up clock for this domain right now —
        // ack is when the domain effectively starts sending. Banner picks
        // it up on next mount of <ReputationBanner /> for this domain.
        if (typeof window !== "undefined" && domain !== primaryDomain) {
          const key = reputationStorageKey(serverId, domain);
          if (!window.localStorage.getItem(key)) {
            window.localStorage.setItem(
              key,
              JSON.stringify({ installedAt: Date.now(), dismissed: false }),
            );
          }
          setWarmupDomains((prev) =>
            prev.includes(domain) ? prev : [...prev, domain],
          );
        }
        await reload();
        // Open the welcome / test-email modal AS the additional domain.
        // The primary install's welcome modal already fires from the
        // install flow at /emails — re-firing it here would be a dupe.
        if (domain !== primaryDomain) {
          setWelcomeFor(domain);
        }
      } catch (err) {
        showToast(
          getApiErrorMessage(err, "Failed to acknowledge DNS records"),
          "error",
        );
      } finally {
        setAcknowledging(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId, primaryDomain, showToast],
  );

  // Scan localStorage once on mount to pick up any additional domains
  // that are still inside their warm-up window (e.g. acked in a previous
  // session). Filter out dismissed ones and any that have aged out.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefix = `${REPUTATION_STORAGE_PREFIX}${serverId}:`;
    const now = Date.now();
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const domain = k.slice(prefix.length);
      if (!domain || domain === primaryDomain) continue;
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as {
          installedAt?: number;
          dismissed?: boolean;
        };
        if (parsed.dismissed) continue;
        if (typeof parsed.installedAt !== "number") continue;
        const elapsedDays = (now - parsed.installedAt) / (1000 * 60 * 60 * 24);
        if (elapsedDays >= 7) continue;
        out.push(domain);
      } catch {
        /* ignore malformed entries */
      }
    }
    setWarmupDomains(out);
  }, [serverId, primaryDomain]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [domainsRes, pendingRes] = await Promise.all([
        mailAdminApi.domains.list(serverId),
        mailAdminApi.domains.pendingDns(serverId).catch(() => ({ pending: [] })),
      ]);
      setRows(domainsRes.domains);
      setPendingDns(pendingRes.pending);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load domains"));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    const id = showModal({
      maxWidth: "520px",
      showCloseButton: false,
      customContent: (
        <CreateDomainForm
          onCancel={() => hideModal(id)}
          onCreated={() => {
            hideModal(id);
            void reload();
          }}
          serverId={serverId}
        />
      ),
    });
  };

  const openEdit = (row: AdminDomain) => {
    const id = showModal({
      maxWidth: "520px",
      showCloseButton: false,
      customContent: (
        <EditDomainForm
          serverId={serverId}
          row={row}
          onCancel={() => hideModal(id)}
          onSaved={() => {
            hideModal(id);
            void reload();
          }}
        />
      ),
    });
  };

  const openDelete = (row: AdminDomain) => {
    const id = showModal({
      maxWidth: "480px",
      showCloseButton: false,
      customContent: (
        <DeleteDomainConfirm
          serverId={serverId}
          row={row}
          onCancel={() => hideModal(id)}
          onDeleted={() => {
            hideModal(id);
            // Clear the per-domain reputation warm-up record from
            // localStorage and from in-memory state so the banner stops
            // rendering for a domain that no longer exists. Banner state
            // lives entirely client-side — the backend already drops the
            // DNS-pending record inside `deleteDomain`.
            if (typeof window !== "undefined") {
              window.localStorage.removeItem(
                reputationStorageKey(serverId, row.domain),
              );
            }
            setWarmupDomains((prev) => prev.filter((d) => d !== row.domain));
            onDomainDeleted?.(row.domain);
            void reload();
          }}
        />
      ),
    });
  };

  const columns: DataTableColumn<AdminDomain>[] = [
    {
      key: "domain",
      header: "Domain",
      width: "minmax(220px, 1.5fr)",
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Globe className="size-4 text-muted-foreground" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {r.domain}
            </p>
            {r.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {r.description}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "mailboxes",
      header: "Mailboxes",
      width: "110px",
      align: "right",
      hideBelow: "md",
      cell: (r) => (
        <span className="text-sm text-foreground tabular-nums">
          {r.mailboxes}
        </span>
      ),
    },
    {
      key: "aliases",
      header: "Aliases",
      width: "110px",
      align: "right",
      hideBelow: "md",
      cell: (r) => (
        <span className="text-sm text-foreground tabular-nums">
          {r.aliases}
        </span>
      ),
    },
    {
      key: "quota",
      header: "Default quota",
      width: "130px",
      align: "right",
      hideBelow: "lg",
      cell: (r) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {r.defaultQuotaMB > 0
            ? `${(r.defaultQuotaMB / 1024).toFixed(1)} GB`
            : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      cell: (r) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          {r.active ? (
            <StatusPill tone="success" dot>
              Active
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" dot>
              Disabled
            </StatusPill>
          )}
          {r.domain === primaryDomain && (
            <StatusPill tone="info">Primary</StatusPill>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            Domains
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
            Each row maps to a row in vmail.domain on the mail VPS.
            Additional domains accept mail once their MX record points here.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25 shrink-0"
        >
          <Plus className="size-4" />
          Add domain
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {pendingDns.length > 0 && (
        <div className="space-y-4">
          {pendingDns.map((p) => (
            <DnsHoldBanner
              key={p.domain}
              records={p.records as unknown as DnsRecords}
              domain={p.domain}
              title={`Publish DNS records for ${p.domain}`}
              description={
                <>
                  Mail can flow to <strong>{p.domain}</strong> once these are
                  live. The MX record points back to your existing mail server;
                  DKIM was generated automatically when the domain was added.
                  Add them at your DNS provider, then click{" "}
                  <strong>I've set the records — continue</strong>.
                </>
              }
              acknowledging={acknowledging === p.domain}
              onAcknowledge={() => void acknowledgeDomain(p.domain)}
            />
          ))}
        </div>
      )}

      {warmupDomains.length > 0 && (
        <div className="space-y-3">
          {warmupDomains.map((d) => (
            <ReputationBanner key={d} serverId={serverId} domain={d} />
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.domain}
        loading={loading}
        rowActions={(row) => (
          <>
            <RowIconButton
              icon={Pencil}
              label="Edit"
              onClick={() => openEdit(row)}
            />
            <RowIconButton
              icon={Trash2}
              label="Delete"
              variant="danger"
              disabled={row.domain === primaryDomain && row.mailboxes > 0}
              onClick={() => openDelete(row)}
            />
          </>
        )}
        empty={{
          icon: Globe,
          title: "No domains yet",
          description:
            "Add a domain to start hosting mailboxes under it. Make sure its MX record points to this mail server.",
          action: (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" />
              Add domain
            </button>
          ),
        }}
      />

      {welcomeFor && (
        <WelcomeModal
          serverId={serverId}
          domain={welcomeFor}
          onClose={() => setWelcomeFor(null)}
        />
      )}
    </div>
  );
}

// ─── Create form ─────────────────────────────────────────────────────────────

function CreateDomainForm({
  serverId,
  onCancel,
  onCreated,
}: {
  serverId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { showToast } = useToast();
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [defaultQuotaGB, setDefaultQuotaGB] = useState("");

  const submit = async () => {
    const res = await mailAdminApi.domains.create(serverId, {
      domain: domain.trim().toLowerCase(),
      description: description.trim() || undefined,
      defaultQuotaMB: defaultQuotaGB
        ? Math.round(Number(defaultQuotaGB) * 1024)
        : undefined,
    });
    if (res.dnsWarning) {
      // The domain row was created but DKIM/DNS provisioning failed —
      // surface the reason so the operator knows why no banner will
      // appear and what to fix.
      showToast(res.dnsWarning, "error");
    }
    onCreated();
  };

  return (
    <FormModalContent
      title="Add domain"
      description="Adds a new entry to vmail.domain on the mail VPS. Make sure the MX record for this domain points to the mail server before sending mail through it."
      submitLabel="Create domain"
      submittingLabel="Creating…"
      onSubmit={submit}
      onCancel={onCancel}
      disabled={!domain.trim()}
    >
      <Field label="Domain" hint="e.g. acme.com — no protocol, no path.">
        <input
          type="text"
          autoFocus
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="acme.com"
          className={inputClassName}
        />
      </Field>
      <Field label="Description" hint="Optional — shown only in the dashboard.">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Acme Corp marketing"
          className={inputClassName}
        />
      </Field>
      <Field
        label="Default mailbox quota (GB)"
        hint="Optional. Default for new mailboxes in this domain; can be overridden per mailbox. Leave blank for unlimited."
      >
        <input
          type="number"
          min={0}
          step={0.5}
          value={defaultQuotaGB}
          onChange={(e) => setDefaultQuotaGB(e.target.value)}
          placeholder="5"
          className={inputClassName}
        />
      </Field>
    </FormModalContent>
  );
}

// ─── Edit form ───────────────────────────────────────────────────────────────

function EditDomainForm({
  serverId,
  row,
  onCancel,
  onSaved,
}: {
  serverId: string;
  row: AdminDomain;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(row.description);
  const [defaultQuotaGB, setDefaultQuotaGB] = useState(
    row.defaultQuotaMB > 0 ? String(row.defaultQuotaMB / 1024) : "",
  );
  const [active, setActive] = useState(row.active);

  const submit = async () => {
    await mailAdminApi.domains.update(serverId, row.domain, {
      description,
      defaultQuotaMB: defaultQuotaGB ? Math.round(Number(defaultQuotaGB) * 1024) : 0,
      active,
    });
    onSaved();
  };

  return (
    <FormModalContent
      title={`Edit ${row.domain}`}
      submitLabel="Save changes"
      submittingLabel="Saving…"
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Description">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClassName}
        />
      </Field>
      <Field
        label="Default mailbox quota (GB)"
        hint="Leave blank or 0 for unlimited."
      >
        <input
          type="number"
          min={0}
          step={0.5}
          value={defaultQuotaGB}
          onChange={(e) => setDefaultQuotaGB(e.target.value)}
          className={inputClassName}
        />
      </Field>
      <label className="flex items-start gap-3 cursor-pointer p-3 -mx-1 rounded-xl hover:bg-muted/30 transition-colors">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="rounded border-border mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">
            Active
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
            When unchecked, mail addressed to this domain is rejected at the
            MX gate.
          </span>
        </span>
      </label>
    </FormModalContent>
  );
}

// ─── Delete confirm ──────────────────────────────────────────────────────────

function DeleteDomainConfirm({
  serverId,
  row,
  onCancel,
  onDeleted,
}: {
  serverId: string;
  row: AdminDomain;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const hasDependents = row.mailboxes > 0 || row.aliases > 0;
  const [cascade, setCascade] = useState(false);

  const submit = async () => {
    if (hasDependents && !cascade) {
      throw new Error(
        `Domain still has ${row.mailboxes} mailbox(es) and ${row.aliases} alias(es). Tick "Also delete…" to remove them, or delete them manually first.`,
      );
    }
    await mailAdminApi.domains.delete(serverId, row.domain, {
      cascade: hasDependents ? cascade : false,
    });
    onDeleted();
  };

  const partsLabel = [
    row.mailboxes > 0 ? `${row.mailboxes} mailbox${row.mailboxes === 1 ? "" : "es"}` : null,
    row.aliases > 0 ? `${row.aliases} alias${row.aliases === 1 ? "" : "es"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <FormModalContent
      title={`Delete ${row.domain}?`}
      description={
        hasDependents
          ? `This domain still has ${partsLabel}. Tick the box below to delete them too — mailbox files on disk will be removed and cannot be undone.`
          : "Removes the domain row and any admin mappings. Mail to this domain will start being rejected immediately."
      }
      submitLabel={hasDependents && cascade ? `Delete domain + ${partsLabel}` : "Delete domain"}
      submittingLabel="Deleting…"
      submitVariant="danger"
      onSubmit={submit}
      onCancel={onCancel}
      disabled={hasDependents && !cascade}
    >
      {hasDependents ? (
        <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2.5">
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
            className="mt-0.5 size-4 rounded border-rose-500/40 text-rose-600 focus:ring-rose-500/40"
          />
          <span className="text-sm leading-snug">
            <span className="font-medium text-foreground">
              Also delete {partsLabel}
            </span>
            <span className="block text-xs text-muted-foreground/80 mt-0.5">
              Permanently removes every mailbox under this domain (DB rows
              and Maildir files on disk) along with all aliases. This cannot
              be reversed.
            </span>
          </span>
        </label>
      ) : (
        <div />
      )}
    </FormModalContent>
  );
}
