import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Mode = "local" | "saas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

function parseMode(value: string | undefined): Mode {
  return value === "saas" ? "saas" : "local";
}

function getConfig(mode: Mode) {
  if (mode === "saas") {
    return {
      envFile: ".env.saas",
      env: {
        NODE_ENV: "development",
        CLOUD_MODE: "true",
        DEPLOY_MODE: "cloud",
        PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR ?? path.join(homedir(), ".openship", "data-saas"),
      },
    };
  }

  return {
    envFile: ".env",
    env: {
      NODE_ENV: "development",
      CLOUD_MODE: "false",
    },
  };
}

const mode = parseMode(process.argv[2]);
const config = getConfig(mode);

const child = spawn(
  "node",
  ["--env-file", config.envFile, "--import", "tsx", "--watch", "src/index.ts"],
  {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...config.env,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
