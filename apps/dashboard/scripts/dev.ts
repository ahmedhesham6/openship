import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveDashboardRuntimeTarget } from "@repo/core";

type Mode = "local" | "saas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const nextBin = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");

function parseMode(value: string | undefined): Mode {
  return value === "saas" ? "saas" : "local";
}

function getRuntimeTarget(mode: Mode) {
  return resolveDashboardRuntimeTarget({
    cloudMode: mode === "saas",
  });
}

function getConfig(mode: Mode) {
  const target = getRuntimeTarget(mode);

  if (mode === "saas") {
    return {
      port: String(target.ports.dashboard),
      distDir: ".next-saas",
    };
  }

  return {
    port: String(target.ports.dashboard),
    distDir: ".next",
  };
}

const mode = parseMode(process.argv[2]);
const config = getConfig(mode);

const child = spawn("node", [nextBin, "dev", "--port", config.port], {
  cwd: appRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? config.distDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
