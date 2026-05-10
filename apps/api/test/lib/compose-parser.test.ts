import { describe, expect, it } from "vitest";
import { parseComposeFile } from "../../src/lib/compose-parser";

describe("parseComposeFile", () => {
  it("resolves Docker Compose environment interpolation from .env content", () => {
    const parsed = parseComposeFile(
      `
services:
  app:
    image: node:\${NODE_VERSION:-22}
    environment:
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET:-change-me-in-production}
      DATABASE_URL: postgres://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@db:5432/app
      EMPTY_DEFAULT: \${EMPTY_VALUE:-fallback}
      EMPTY_NO_COLON: \${EMPTY_VALUE-fallback}
`,
      {
        envFileContent: `
NODE_VERSION=20
BETTER_AUTH_SECRET=from-env
POSTGRES_USER=openship
POSTGRES_PASSWORD=secret
EMPTY_VALUE=
`,
      },
    );

    expect(parsed.services[0]?.image).toBe("node:20");
    expect(parsed.services[0]?.environment).toEqual({
      BETTER_AUTH_SECRET: "from-env",
      DATABASE_URL: "postgres://openship:secret@db:5432/app",
      EMPTY_DEFAULT: "fallback",
      EMPTY_NO_COLON: "",
    });
    expect(parsed.services[0]?.environmentMeta?.BETTER_AUTH_SECRET).toMatchObject({
      source: "env-file",
      variable: "BETTER_AUTH_SECRET",
      resolvedValue: "from-env",
    });
    expect(parsed.services[0]?.environmentMeta?.EMPTY_DEFAULT).toMatchObject({
      source: "default",
      variable: "EMPTY_VALUE",
      defaultValue: "fallback",
      resolvedValue: "fallback",
    });
  });

  it("uses compose defaults when .env does not define the variable", () => {
    const parsed = parseComposeFile(`
services:
  app:
    environment:
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET:-change-me-in-production}
      GOOGLE_GENERATIVE_AI_API_KEY: \${GOOGLE_GENERATIVE_AI_API_KEY}
      GEMINI_MODEL: \${GEMINI_MODEL:-gemini-2.5-flash}
      PLAIN_MISSING: \${PLAIN_MISSING}
`);

    expect(parsed.services[0]?.environment).toEqual({
      BETTER_AUTH_SECRET: "change-me-in-production",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GEMINI_MODEL: "gemini-2.5-flash",
      PLAIN_MISSING: "",
    });
    expect(parsed.services[0]?.environmentMeta?.BETTER_AUTH_SECRET).toMatchObject({
      source: "default",
      variable: "BETTER_AUTH_SECRET",
      defaultValue: "change-me-in-production",
      resolvedValue: "change-me-in-production",
    });
    expect(parsed.services[0]?.environmentMeta?.PLAIN_MISSING).toMatchObject({
      source: "missing",
      variable: "PLAIN_MISSING",
      resolvedValue: "",
    });
    expect(parsed.services[0]?.environmentMeta?.GOOGLE_GENERATIVE_AI_API_KEY).toMatchObject({
      source: "missing",
      variable: "GOOGLE_GENERATIVE_AI_API_KEY",
      resolvedValue: "",
    });
    expect(parsed.services[0]?.environmentMeta?.GEMINI_MODEL).toMatchObject({
      source: "default",
      variable: "GEMINI_MODEL",
      defaultValue: "gemini-2.5-flash",
      resolvedValue: "gemini-2.5-flash",
    });
  });

  it("supports array env form and bare keys loaded from .env", () => {
    const parsed = parseComposeFile(
      `
services:
  app:
    environment:
      - BETTER_AUTH_SECRET
      - NODE_ENV=\${NODE_ENV:-production}
`,
      {
        envFileContent: `
BETTER_AUTH_SECRET=from-env
NODE_ENV=development
`,
      },
    );

    expect(parsed.services[0]?.environment).toEqual({
      BETTER_AUTH_SECRET: "from-env",
      NODE_ENV: "development",
    });
    expect(parsed.services[0]?.environmentMeta?.BETTER_AUTH_SECRET).toMatchObject({
      source: "env-file",
      variable: "BETTER_AUTH_SECRET",
      resolvedValue: "from-env",
    });
  });

  it("keeps escaped dollars literal", () => {
    const parsed = parseComposeFile(`
services:
  app:
    command: echo $$BETTER_AUTH_SECRET
    environment:
      LITERAL: $$BETTER_AUTH_SECRET
`);

    expect(parsed.services[0]?.command).toBe("echo $BETTER_AUTH_SECRET");
    expect(parsed.services[0]?.environment.LITERAL).toBe("$BETTER_AUTH_SECRET");
  });
});
