import { describe, it, expect } from "vitest";
import { generateDockerfile } from "./docker-build-plan";
import type { BuildConfig } from "../types";

// generateDockerfile reads only a handful of fields; a partial cast keeps the
// fixtures readable (same pattern as deploy-pipeline.test.ts).
function config(over: Partial<BuildConfig>): BuildConfig {
  return {
    buildImage: "node:22",
    runtimeImage: "node:22",
    installCommand: "",
    buildCommand: "",
    startCommand: "node index.js",
    port: 3000,
    stack: "node",
    envVars: {},
    ...over,
  } as unknown as BuildConfig;
}

describe("generateDockerfile — PHP fpm+nginx branch", () => {
  const df = generateDockerfile(
    config({
      buildImage: "php:8.3-cli",
      runtimeImage: "php:8.3-fpm",
      installCommand: "composer install --no-dev --optimize-autoloader",
      startCommand:
        "envsubst '$PORT' < /etc/nginx/app.conf.template > /etc/nginx/conf.d/default.conf && php-fpm -D && nginx -g 'daemon off;'",
      port: 8000,
      stack: "laravel",
    }),
  );

  it("builds on php-cli with Composer pulled in", () => {
    expect(df).toContain("FROM php:8.3-cli AS builder");
    expect(df).toContain("COPY --from=composer:2 /usr/bin/composer /usr/bin/composer");
    expect(df).toContain("composer install --no-dev --optimize-autoloader");
  });

  it("runs on php-fpm with nginx installed and configured for public/", () => {
    expect(df).toContain("FROM php:8.3-fpm AS runtime");
    expect(df).toContain("nginx gettext-base");
    expect(df).toContain("docker-php-ext-install pdo_mysql");
    expect(df).toContain("/etc/nginx/app.conf.template");
    expect(df).toContain("fastcgi_pass 127.0.0.1:9000");
    expect(df).toContain("COPY --from=builder /workspace /app");
  });

  it("launches via the start command (fpm + nginx), not a dev server", () => {
    expect(df).toContain("php-fpm -D");
    expect(df).toContain("nginx -g 'daemon off;'");
    expect(df).not.toContain("php artisan serve");
  });
});

describe("generateDockerfile — non-PHP is unaffected", () => {
  it("a same-image Node build stays single-stage with no nginx", () => {
    const df = generateDockerfile(config({ buildImage: "node:22", runtimeImage: "node:22" }));
    expect(df).toContain("FROM node:22");
    expect(df).not.toContain("nginx");
    expect(df).not.toContain("AS builder"); // single stage
  });
});
