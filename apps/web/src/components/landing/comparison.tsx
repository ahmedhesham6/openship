/**
 * Comparison - clean table, Openship column visually highlighted with
 * tinted background. Each cell carries a refined status mark (win / loss
 * / neutral) so the comparison reads at a glance, without bright colors.
 */

type Status = "win" | "loss" | "neutral";
type Cell = { text: string; status: Status };
type Row = { feature: string; openship: Cell; managed: Cell; selfhost: Cell };

const ROWS: Row[] = [
  {
    feature: "Where the build runs",
    openship: { text: "Your machine - server stays free",   status: "win" },
    managed:  { text: "Their build runners",                status: "neutral" },
    selfhost: { text: "Always on your production server",   status: "loss" },
  },
  {
    feature: "What lives on your VPS",
    openship: { text: "Only the apps you shipped",          status: "win" },
    managed:  { text: "Not applicable - managed",           status: "neutral" },
    selfhost: { text: "Dashboard, build agent, DB, queue",  status: "loss" },
  },
  {
    feature: "Servers",
    openship: { text: "Many over SSH, shift workloads between them", status: "win" },
    managed:  { text: "Their infrastructure - not exposed", status: "neutral" },
    selfhost: { text: "Multi-server on some tools",         status: "neutral" },
  },
  {
    feature: "Import an existing server",
    openship: { text: "Scan and adopt running containers in place", status: "win" },
    managed:  { text: "No - redeploy from source",          status: "loss" },
    selfhost: { text: "No - redeploy each app by hand",     status: "loss" },
  },
  {
    feature: "Custom domains and SSL",
    openship: { text: "Unlimited, wildcards, automatic",    status: "win" },
    managed:  { text: "Limited per plan, sometimes paid",   status: "loss" },
    selfhost: { text: "Manual NGINX or Caddy",              status: "neutral" },
  },
  {
    feature: "Edge access rules",
    openship: { text: "Per-route rate-limit, IP + country bans, hotlink - no reload", status: "win" },
    managed:  { text: "Basic, often plan-gated",            status: "neutral" },
    selfhost: { text: "Hand-write Traefik or nginx",        status: "neutral" },
  },
  {
    feature: "Traffic analytics & logs",
    openship: { text: "Built-in per-route traffic, geo, live request logs", status: "win" },
    managed:  { text: "Dashboards, capped by plan",         status: "neutral" },
    selfhost: { text: "Bolt on Grafana or Plausible",       status: "loss" },
  },
  {
    feature: "Managed databases",
    openship: { text: "Postgres, Redis, Mongo, MySQL",      status: "win" },
    managed:  { text: "Bring your own - third-party",       status: "loss" },
    selfhost: { text: "Run yourself, no managed tooling",   status: "loss" },
  },
  {
    feature: "Backups",
    openship: { text: "Scheduled DB + volume, one-click restore", status: "win" },
    managed:  { text: "Plan-gated, database only",          status: "neutral" },
    selfhost: { text: "DIY or per-tool",                    status: "neutral" },
  },
  {
    feature: "Audit log",
    openship: { text: "Built in and free - every change tracked", status: "win" },
    managed:  { text: "Higher plans only",                  status: "neutral" },
    selfhost: { text: "Paid add-on or absent",              status: "loss" },
  },
  {
    feature: "Mail server",
    openship: { text: "Transactional from your domain",     status: "win" },
    managed:  { text: "Not included - bring Sendgrid",      status: "loss" },
    selfhost: { text: "Configure Postfix yourself",         status: "loss" },
  },
  {
    feature: "Interfaces",
    openship: { text: "CLI, web, desktop - same backend",   status: "win" },
    managed:  { text: "Web only, or thin CLI",              status: "neutral" },
    selfhost: { text: "Web on the server itself",           status: "neutral" },
  },
  {
    feature: "Local / solo control",
    openship: { text: "Desktop app, loopback only, nothing always-on", status: "win" },
    managed:  { text: "Cloud account, always remote",       status: "neutral" },
    selfhost: { text: "Needs an always-on server",          status: "loss" },
  },
  {
    feature: "Migration path",
    openship: { text: "Cloud ⇄ self-host, no rebuild",      status: "win" },
    managed:  { text: "Rewrite to leave",                   status: "loss" },
    selfhost: { text: "Manual export and re-deploy",        status: "neutral" },
  },
  {
    feature: "Pricing model",
    openship: { text: "Flat - your compute, your cost",     status: "win" },
    managed:  { text: "Per-seat + bandwidth + invocations", status: "loss" },
    selfhost: { text: "Free, but you maintain the OS",      status: "neutral" },
  },
  {
    feature: "Vendor lock-in",
    openship: { text: "Plain containers, eject any day",    status: "win" },
    managed:  { text: "Vendor-specific runtime & edge",     status: "loss" },
    selfhost: { text: "Tied to the tool's install layout",  status: "loss" },
  },
  {
    feature: "Source",
    openship: { text: "Open source, Apache 2.0, fork-friendly", status: "win" },
    managed:  { text: "Closed source",                      status: "loss" },
    selfhost: { text: "Mixed licenses",                     status: "neutral" },
  },
];

function StatusMark({ status }: { status: Status }) {
  return (
    <span className={`cmp-mark cmp-mark--${status}`} aria-hidden="true">
      {status === "win" && (
        <svg viewBox="0 0 14 14" fill="none">
          <path d="M3 7.2 L6 10 L11 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {status === "loss" && (
        <svg viewBox="0 0 14 14" fill="none">
          <path d="M4 4 L10 10 M10 4 L4 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      {status === "neutral" && (
        <svg viewBox="0 0 14 14" fill="none">
          <path d="M3.5 7 L10.5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

export function Comparison() {
  return (
    <section className="cmp-section">
      <div className="cmp-container">
        <header className="cmp-head">
          <p className="cmp-eyebrow">Compared to the alternatives</p>
          <h2 className="cmp-title">
            Different choices,<br />made honestly.
          </h2>
          <p className="cmp-sub">
            The right tool depends on what you&rsquo;re building. Here&rsquo;s where Openship sits
            against managed clouds and other self-hosting tools.
          </p>
        </header>

        <div className="cmp">
          <div className="cmp-highlight" aria-hidden="true" />

          {/* Header */}
          <div className="cmp-row cmp-row--head">
            <div className="cmp-cell cmp-cell--feature">Feature</div>
            <div className="cmp-cell cmp-cell--win">Openship</div>
            <div className="cmp-cell">Managed (Vercel, Netlify)</div>
            <div className="cmp-cell">Self-host (Coolify, Dokku)</div>
          </div>

          {/* Body */}
          {ROWS.map((r) => (
            <div key={r.feature} className="cmp-row">
              <div className="cmp-cell cmp-cell--feature">{r.feature}</div>
              <div className="cmp-cell cmp-cell--win">
                <StatusMark status={r.openship.status} />
                <span>{r.openship.text}</span>
              </div>
              <div className="cmp-cell">
                <StatusMark status={r.managed.status} />
                <span>{r.managed.text}</span>
              </div>
              <div className="cmp-cell">
                <StatusMark status={r.selfhost.status} />
                <span>{r.selfhost.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
