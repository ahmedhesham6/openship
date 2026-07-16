/**
 * Curated multi-service app templates.
 *
 * Some apps aren't a "git → build → run" source project — they're a fixed set
 * of upstream images wired together (a CMS + its database, etc.). These deploy
 * through the compose/services path: create a repo-less `services` project, seed
 * the service rows below, deploy. The runtime handles service discovery (each
 * service is reachable by name on the project network) and volume namespacing.
 *
 * `secretEnv` lists keys the operator must supply (passwords) — the instantiator
 * collects them and writes them through the per-service secret env endpoint,
 * rather than storing them as plaintext defaults here.
 */

export interface TemplateServiceSpec {
  /** Service name — also its hostname/alias on the project network. */
  name: string;
  /** Upstream image (image-only services skip build/clone). */
  image: string;
  /** Port mappings, compose syntax (e.g. "8080:80"). */
  ports?: readonly string[];
  /** Non-secret environment defaults. */
  environment?: Readonly<Record<string, string>>;
  /** Env keys the operator must fill in (secrets) — not stored as defaults. */
  secretEnv?: readonly string[];
  /** Named volumes / bind mounts (compose syntax). Named volumes are project-scoped. */
  volumes?: readonly string[];
  /** Services that must be running first (deploy ordering). */
  dependsOn?: readonly string[];
  /** Publish this service on a public route. */
  exposed?: boolean;
}

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  /** Stack id the instantiated project should carry. */
  framework: "docker-compose";
  services: readonly TemplateServiceSpec[];
}

/**
 * WordPress + MariaDB. WordPress reaches the DB at host `mariadb` (the service
 * name → network alias). The operator supplies `MARIADB_ROOT_PASSWORD`,
 * `MARIADB_PASSWORD`, and `WORDPRESS_DB_PASSWORD` — the last two MUST match.
 */
const WORDPRESS_TEMPLATE: AppTemplate = {
  id: "wordpress",
  name: "WordPress",
  description: "WordPress CMS backed by MariaDB, with persistent volumes for content and data.",
  framework: "docker-compose",
  services: [
    {
      name: "mariadb",
      image: "mariadb:11",
      environment: {
        MARIADB_DATABASE: "wordpress",
        MARIADB_USER: "wordpress",
      },
      secretEnv: ["MARIADB_ROOT_PASSWORD", "MARIADB_PASSWORD"],
      volumes: ["mariadb_data:/var/lib/mysql"],
    },
    {
      name: "wordpress",
      image: "wordpress:latest",
      ports: ["8080:80"],
      exposed: true,
      dependsOn: ["mariadb"],
      environment: {
        WORDPRESS_DB_HOST: "mariadb:3306",
        WORDPRESS_DB_NAME: "wordpress",
        WORDPRESS_DB_USER: "wordpress",
      },
      secretEnv: ["WORDPRESS_DB_PASSWORD"],
      volumes: ["wordpress_data:/var/www/html"],
    },
  ],
};

export const APP_TEMPLATES: readonly AppTemplate[] = [WORDPRESS_TEMPLATE];

export function getAppTemplate(id: string): AppTemplate | undefined {
  return APP_TEMPLATES.find((t) => t.id === id);
}
