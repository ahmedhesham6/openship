import { beforeEach, describe, expect, it, vi } from "vitest";

const { cloudClient, runCloudPreflight, preflightFn } = vi.hoisted(() => ({
  cloudClient: vi.fn(),
  runCloudPreflight: vi.fn(),
  preflightFn: vi.fn(),
}));

vi.mock("@repo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/db")>();
  return {
    ...actual,
    repos: {},
  };
});

vi.mock("../../../src/lib/controller-helpers", () => ({
  platform: () => ({ target: "desktop" }),
}));

vi.mock("../../../src/lib/cloud/client", () => ({
  cloudClient,
}));

vi.mock("../../../src/lib/cloud/session", () => ({
  // De-conflation reads this when a cloud preflight comes back null; stub
  // it so the mock surface is complete even on that branch.
  isCloudConnectedForOrg: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../src/lib/cloud-preflight", () => ({
  runCloudPreflight,
}));

import { runPreflightChecks } from "../../../src/modules/deployments/preflight";

describe("runPreflightChecks", () => {
  beforeEach(() => {
    runCloudPreflight.mockReset();
    cloudClient.mockReset();
    preflightFn.mockReset();
    preflightFn.mockImplementation(async (input: { slug?: string }) => ({
      runtime: { ok: true },
      slug: input.slug
        ? {
            available: input.slug !== "taken-endpoint",
            message: input.slug === "taken-endpoint"
              ? "\"taken-endpoint.openship.test\" is already taken. Choose a different subdomain."
              : undefined,
          }
        : undefined,
    }));
    cloudClient.mockReturnValue({ preflight: preflightFn } as any);
    runCloudPreflight.mockImplementation(async (_userId: string, input: { slug?: string }) =>
      preflightFn(input),
    );
  });

  it("checks free-domain availability for every public endpoint", async () => {
    const result = await runPreflightChecks({
      repoUrl: "https://github.com/acme/app.git",
      branch: "main",
      buildImage: "node:22",
      installCommand: "npm install",
      buildCommand: "npm run build",
      startCommand: "npm start",
      port: 3000,
      hasBuild: true,
      hasServer: true,
      deployTarget: "server",
      organizationId: "org-1",
    } as any, {
      ctx: { userId: "user-1", organizationId: "org-1" } as any,
      buildStrategy: "local",
      publicEndpoints: [
        { port: 3000, domain: "taken-endpoint", domainType: "free" },
        { port: 4000, domain: "ok-endpoint", domainType: "free" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        // ids are keyed by endpoint index now (collision-safe): endpoint 0
        // = taken-endpoint (port 3000), endpoint 1 = ok-endpoint (port 4000).
        expect.objectContaining({
          id: "endpoint-0-availability",
          status: "fail",
        }),
        expect.objectContaining({
          id: "endpoint-1-availability",
          status: "pass",
        }),
      ]),
    );
    expect(
      preflightFn.mock.calls.some(([input]) => input && input.slug === "taken-endpoint"),
    ).toBe(true);
    expect(
      preflightFn.mock.calls.some(([input]) => input && input.slug === "ok-endpoint"),
    ).toBe(true);
  });

  it("accepts static path-targeted public endpoints", async () => {
    const result = await runPreflightChecks({
      repoUrl: "https://github.com/acme/docs.git",
      branch: "main",
      buildImage: "node:22",
      installCommand: "npm install",
      buildCommand: "npm run build",
      startCommand: "",
      port: 3000,
      hasBuild: true,
      hasServer: false,
      deployTarget: "cloud",
      organizationId: "org-1",
    } as any, {
      ctx: { userId: "user-1", organizationId: "org-1" } as any,
      buildStrategy: "local",
      publicEndpoints: [
        { targetPath: "/docs", domain: "docs-site", domainType: "free" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.checks.some((check) => check.status === "fail")).toBe(false);
  });

  it("does not require framework build fields for compose service deploys", async () => {
    const result = await runPreflightChecks(
      {
        repoUrl: "",
        localPath: "/srv/my-stack",
        branch: "main",
        framework: "docker-compose",
        buildImage: null,
        installCommand: null,
        buildCommand: null,
        startCommand: null,
        port: 3000,
        hasBuild: true,
        hasServer: true,
        deployTarget: "server",
        organizationId: "org-1",
      } as any,
      {
        ctx: { userId: "user-1", organizationId: "org-1" } as any,
        buildStrategy: "local",
        multiService: true,
        composeServices: [
          {
            kind: "compose",
            name: "web",
            build: ".",
            dockerfile: "Dockerfile",
            ports: ["3000:3000"],
            dependsOn: [],
            environment: {},
            volumes: [],
            exposed: false,
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "config",
          label: "Service configuration",
          status: "pass",
        }),
      ]),
    );
    expect(result.checks.some((check) => check.message?.includes("build image"))).toBe(false);
    expect(result.checks.some((check) => check.message?.includes("install command"))).toBe(false);
    expect(result.checks.some((check) => check.message?.includes("start command"))).toBe(false);
  });
});
