# Apps — the curated catalog

This directory is Openship's **App catalog**: the one-click installs in the dashboard's **Apps** tab. This
guide explains what an App is, why it exists, and exactly how to add one to the repo.

- **Catalog source** — one JSON per app in [`catalog/`](./catalog/) (`<id>.json`).
- **Merged artifact** — [`catalog.json`](./catalog.json), built from `catalog/*.json` by
  [`../../scripts/gen-catalog.ts`](../../scripts/gen-catalog.ts). This is what the bundle imports and the API
  serves.
- **Types** — [`../app-templates.ts`](../app-templates.ts) (`AppTemplate` and friends) and
  [`../app-settings.ts`](../app-settings.ts) (day-2 settings).
- **Shape validation** — [`schema.ts`](./schema.ts) (`isValidAppTemplate`), enforced by
  [`catalog.test.ts`](./catalog.test.ts).

---

## What is an App, and why?

An App **wraps a deployment into a one-click, focused experience.**

Without it, standing up (say) Ghost means: create a `services` project, add a `ghost` service + a `mysql`
service, hand-write the images and the env that wires them together, generate and match a DB password across
both, expose the right port, and then hunt through raw per-service env tabs whenever you want to change a
setting.

An App turns that into: **click Ghost → fill a short form → Deploy.** The catalog entry already knows the
images, how the services wire together, which secrets to generate (and keep in sync), what to expose, and —
after install — surfaces a **curated settings form** instead of raw env editing, plus a **connection card**
with the URLs and keys you need.

So an App is not a new runtime — it's **metadata over the normal services deploy** that removes the wiring,
the secret-juggling, and the raw-config surface. Same engine underneath (a repo-less `services` project
marked `isApp`); a much shorter path for the user.

### Two kinds

| `kind` | What it does |
|---|---|
| **`template`** | Instantiates the `services` defined in the entry (a backend + its DB, a CMS + its DB, …) and deploys them through the compose/services path. This is the common case. |
| **`flow`** | Provisioning already has a bespoke wizard (e.g. the mail stack). The entry just points at that wizard via `flowHref` (e.g. `/emails`); it does **not** instantiate services here. |

---

## Security & trust

The catalog is **curated, not open-ended** — installing an App never runs arbitrary third-party code. Every
app has to clear a bar, and every addition is reviewed before it ships:

- **Open-source only.** Each app is a well-known open-source project with a public source repository — you
  can see exactly what it is before you install it.
- **Official / reputable images, pinned.** Services use the project's official (or a widely trusted)
  published image at a **pinned version** (e.g. `qdrant/qdrant:v1.18.3`, `apache/kafka:4.0.0`) — never an
  unpinned or unknown-publisher image.
- **Reviewed before it's available.** Adding an app is a pull request to this repo. A maintainer reviews the
  image sources, ports, env, and secret handling before it's merged and flipped to `available: true`.
- **Fully auditable, nothing hidden.** Every app is a small public JSON in [`catalog/`](./catalog/): the
  images, ports, env, and volumes are all right there in the open. Nothing is fetched from a private source.
- **Secure defaults.** Credentials are **auto-generated** (never shipped as defaults or plaintext),
  publicly-exposed admin UIs require auth, and app containers are published on loopback behind the edge — not
  directly on a public interface.

So the definition in `catalog/<id>.json` is the whole truth: read it, check the upstream image, install with
confidence. Contributing one? Expect review on exactly these points.

---

## Add an App — step by step

### 1. Create `catalog/<id>.json`

`id` is a stable kebab-case slug (the filename matches it). Minimal single-service app:

```json
{
  "available": false,
  "id": "it-tools",
  "name": "IT-Tools",
  "description": "A handy collection of developer and sysadmin utilities. No login, no setup.",
  "kind": "template",
  "logo": "it-tools",
  "category": "other",
  "tags": ["developer", "tools", "utilities"],
  "framework": "docker-compose",
  "services": [
    {
      "name": "it-tools",
      "image": "corentinth/it-tools:latest",
      "ports": ["80:80"],
      "exposedPort": 80,
      "exposed": true,
      "restart": "unless-stopped"
    }
  ]
}
```

A multi-service app wires services by name and shares a generated secret across them:

```json
{
  "available": false,
  "id": "ghost",
  "name": "Ghost",
  "description": "Modern publishing platform for blogs, newsletters, and membership sites.",
  "kind": "template",
  "logo": "ghost",
  "category": "cms",
  "framework": "docker-compose",
  "services": [
    {
      "name": "ghost-db",
      "image": "mysql:8.0",
      "environment": { "MYSQL_DATABASE": "ghost" },
      "secretEnv": ["MYSQL_ROOT_PASSWORD"],
      "volumes": ["ghost_db:/var/lib/mysql"],
      "restart": "unless-stopped"
    },
    {
      "name": "ghost",
      "image": "ghost:5-alpine",
      "ports": ["2368:2368"],
      "exposedPort": 2368,
      "exposed": true,
      "dependsOn": ["ghost-db"],
      "environment": {
        "NODE_ENV": "production",
        "url": "{{publicUrl:ghost}}",
        "database__client": "mysql",
        "database__connection__host": "ghost-db",
        "database__connection__user": "root",
        "database__connection__database": "ghost"
      },
      "secretEnv": ["database__connection__password"],
      "volumes": ["ghost_content:/var/lib/ghost/content"],
      "restart": "unless-stopped"
    }
  ],
  "configFields": [
    { "key": "MYSQL_ROOT_PASSWORD", "service": "ghost-db", "label": "Database password", "generate": "secret", "generateGroup": "ghostdb", "secret": true },
    { "key": "database__connection__password", "service": "ghost", "label": "Ghost DB password", "generate": "secret", "generateGroup": "ghostdb", "secret": true }
  ]
}
```

Notes that matter:
- **Service name = hostname.** `ghost` reaches the DB at `ghost-db` on the project network — that's why the
  DB host is just `"ghost-db"`.
- **`exposed: true` + `exposedPort`** picks the one service that gets a public route.
- **`generateGroup`** makes two fields get the **same** generated value — here the DB password matches on both
  sides. Secrets are auto-filled (operators never type them) and stored encrypted.
- **`{{publicUrl:ghost}}`** is resolved at install to the app's public URL (see [Placeholders](#placeholders)).

### 2. Give it a logo

`logo` is an id resolved by the dashboard's `AppLogo` component
([`apps/dashboard/src/components/AppLogo.tsx`](../../../../apps/dashboard/src/components/AppLogo.tsx)):

- **On [simpleicons](https://simpleicons.org)?** Set `logo` to the simpleicons slug (e.g. `"ghost"`,
  `"grafana"`) — nothing else needed.
- **Not on simpleicons (or the mark renders wrong)?** Drop an SVG in
  `apps/dashboard/public/app-logos/<id>.svg` and add a `LOGO_CONFIG` entry mapping the id to that `src`
  (see how `buzz` does it). Apps with no good mark fall back to a generic glyph.

### 3. Regenerate the merged catalog

```bash
cd packages/core
bun scripts/gen-catalog.ts        # rewrites src/apps/catalog.json from catalog/*.json
```

Order is preserved from the existing `catalog.json` (curated / featured-first); a **new** app is appended
alphabetically — reorder by hand in `catalog.json` if you want it featured earlier. A drift test fails CI if
you edit a `catalog/*.json` without regenerating.

### 4. Validate

```bash
cd packages/core && bunx vitest run src/apps/catalog.test.ts
```

This asserts `catalog.json` is in sync **and** that every app passes `isValidAppTemplate` (required fields,
valid `category`, etc.).

### 5. Flip it live when ready

`"available": false` (or omitted) → the app shows in the catalog **dimmed / "coming soon"**, not installable.
Set `"available": true` to light it up (it joins `AVAILABLE_APP_IDS`). Install is also guarded server-side, so
a coming-soon app can't be installed by API either.

---

## Field reference

Full types live in [`../app-templates.ts`](../app-templates.ts). The ones you'll use most:

**Top level** — `id`, `name`, `description`, `kind`, `logo`, `category`, `tags`, `available`, and for
`template`: `framework` (stack id), `services`, `configFields`. For `flow`: `flowHref`.

**`services[]`** (`TemplateServiceSpec`) — `name`, `image`, `ports`, `exposedPort`, `exposed`, `environment`
(non-secret defaults), `secretEnv` (keys the operator/instantiator fills), `volumes` (named volumes are
project-scoped), `dependsOn`, `healthcheck`, `restart`, `command`, and `routes[]` for a service that needs
more than one public port.

**`configFields[]`** (`AppConfigField`) — the Create-App form inputs. Each maps to one env `key` on one
`service`. Use `generate: "secret"` for values the operator never types, `generateGroup` to share one
generated value across fields, and `generate: "jwt"` (+ `jwtSecretGroup`, `jwtRole`) for signed keys
(Supabase anon/service_role). `secret: true` stores it encrypted.

**Optional, high-value:**
- **`settings[]`** (`AppSettingGroup`, see [`../app-settings.ts`](../app-settings.ts)) — the **day-2** curated
  settings form shown after install (a friendly form over per-service env). A field with `installStep: true`
  is also collected in the install wizard. Declaring `settings` makes the app "schema"-managed automatically.
- **`connection`** — the post-install **Connection card**: `outputs[]` with `source` of
  `env:<service>:<KEY>` or `publicUrl:<service>[:<port>]`, `secret: true` to mask + reveal.
- **`prepare[]`** — commands run **inside** a service container after the first deploy, whose stdout is
  captured and persisted as an env var (e.g. Convex's admin key). Must be re-run-safe; failures are advisory.
- **`endpoints[]`** — what the install wizard asks you how to ship: `kind: "http"` (domain-routable) vs
  `"tcp"` (a raw DB port, no domain). Omit → one `http` endpoint per exposed service.
- **`files[]`** — generated config files bind-mounted into a container at deploy (for apps that need a config
  *file*, not just env — e.g. an init `.sql`). Self-hosted / desktop only. Supports placeholders.
- **`management`** — override how the installed app is managed: `{ kind: "custom", href }` for a bespoke
  surface (mail → `/emails`); omit to derive (`schema` when `settings` exist, else raw project tabs).

## Placeholders

Resolved at install, usable in `environment` values, `files[].content`, and `connection` outputs:

- `{{publicUrl:<service>}}` — the app's public URL for that service (`[:port]` for a specific route).
- `{{config:<KEY>}}` — a generated config value (e.g. a `generate` secret) by key.

## Checklist

- [ ] **Open-source** app; **official / reputable** image **pinned** to a version (no unpinned or unknown-publisher images).
- [ ] `catalog/<id>.json` created, `id` matches the filename (kebab-case).
- [ ] Services wire by name; one service `exposed` with an `exposedPort`.
- [ ] Secrets use `generate`/`generateGroup` + `secret: true` — no plaintext credentials.
- [ ] Logo resolves (simpleicons slug, or vendored `public/app-logos/<id>.svg` + `LOGO_CONFIG`).
- [ ] `bun scripts/gen-catalog.ts` run; `catalog.json` committed.
- [ ] `bunx vitest run src/apps/catalog.test.ts` passes.
- [ ] `available: true` only when it actually deploys cleanly end to end.
