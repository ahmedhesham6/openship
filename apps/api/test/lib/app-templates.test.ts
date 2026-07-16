import { describe, expect, it } from "vitest";
import { getAppTemplate } from "@repo/core";

describe("WordPress app template", () => {
  const template = getAppTemplate("wordpress");

  it("is a two-service docker-compose template", () => {
    expect(template).toBeDefined();
    expect(template!.framework).toBe("docker-compose");
    expect(template!.services.map((s) => s.name).sort()).toEqual(["mariadb", "wordpress"]);
  });

  it("wordpress depends on mariadb, is exposed, and reaches the DB by service name", () => {
    const wp = template!.services.find((s) => s.name === "wordpress")!;
    expect(wp.image).toBe("wordpress:latest");
    expect(wp.dependsOn).toContain("mariadb");
    expect(wp.exposed).toBe(true);
    expect(wp.environment?.WORDPRESS_DB_HOST).toBe("mariadb:3306");
    expect(wp.volumes).toContain("wordpress_data:/var/www/html");
  });

  it("mariadb persists its data and requires secret passwords (not stored as defaults)", () => {
    const db = template!.services.find((s) => s.name === "mariadb")!;
    expect(db.image).toBe("mariadb:11");
    expect(db.volumes).toContain("mariadb_data:/var/lib/mysql");
    expect(db.secretEnv).toContain("MARIADB_ROOT_PASSWORD");
    expect(db.environment).not.toHaveProperty("MARIADB_ROOT_PASSWORD");
  });
});
