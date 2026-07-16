import { describe, expect, test } from "vitest";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { probeTcp, probeHttp, waitForReady } from "./reachability";

/** Bind a throwaway TCP server on an ephemeral port and return {port, close}. */
async function listenEphemeral(): Promise<{ port: number; close: () => void }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("no port");
  return { port: address.port, close: () => server.close() };
}

/** Bind a throwaway HTTP server that always answers `status`. */
async function listenHttp(status: number): Promise<{ port: number; close: () => void }> {
  const server: HttpServer = createHttpServer((_req, res) => {
    res.statusCode = status;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("no port");
  return { port: address.port, close: () => server.close() };
}

/** A free port (bound then released), for negative cases. */
async function freePort(): Promise<number> {
  const { port, close } = await listenEphemeral();
  close();
  await new Promise((r) => setTimeout(r, 50));
  return port;
}

describe("probeTcp", () => {
  test("resolves true when the port is accepting connections", async () => {
    const { port, close } = await listenEphemeral();
    try {
      expect(await probeTcp("127.0.0.1", port, 1000)).toBe(true);
    } finally {
      close();
    }
  });

  test("resolves false when nothing is listening (connection refused)", async () => {
    // Bind then immediately close to get a port that's free right now.
    const { port, close } = await listenEphemeral();
    close();
    await new Promise((r) => setTimeout(r, 50));
    expect(await probeTcp("127.0.0.1", port, 1000)).toBe(false);
  });

  test("resolves false (never throws) on an unroutable host within the timeout", async () => {
    // TEST-NET-1 (192.0.2.0/24, RFC 5737) is guaranteed non-routable — the
    // connect stalls and must hit our timeout, resolving false rather than hanging.
    const start = Date.now();
    const result = await probeTcp("192.0.2.1", 22, 600);
    expect(result).toBe(false);
    // Bounded by the timeout, not the OS default (~20s+).
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe("probeHttp", () => {
  test("true for a 2xx response", async () => {
    const { port, close } = await listenHttp(200);
    try {
      expect(await probeHttp("127.0.0.1", port, "/", 1000)).toBe(true);
    } finally {
      close();
    }
  });

  test("true for a 4xx (server is serving, path just missing)", async () => {
    const { port, close } = await listenHttp(404);
    try {
      expect(await probeHttp("127.0.0.1", port, "/", 1000)).toBe(true);
    } finally {
      close();
    }
  });

  test("false for a 5xx", async () => {
    const { port, close } = await listenHttp(503);
    try {
      expect(await probeHttp("127.0.0.1", port, "/", 1000)).toBe(false);
    } finally {
      close();
    }
  });

  test("false (never throws) when nothing is listening", async () => {
    expect(await probeHttp("127.0.0.1", await freePort(), "/", 1000)).toBe(false);
  });
});

describe("waitForReady", () => {
  test("returns true once a port that starts late begins accepting connections", async () => {
    const { port, close } = await listenEphemeral();
    close(); // not listening yet
    // Bring it up after ~300ms; waitForReady should poll until it connects.
    const late = setTimeout(() => {
      createServer().listen(port, "127.0.0.1");
    }, 300);
    try {
      const ready = await waitForReady("127.0.0.1", port, { timeoutMs: 3000, intervalMs: 100 });
      expect(ready).toBe(true);
    } finally {
      clearTimeout(late);
    }
  });

  test("returns false when the port never comes up before the deadline", async () => {
    const start = Date.now();
    const ready = await waitForReady("127.0.0.1", await freePort(), {
      timeoutMs: 600,
      intervalMs: 100,
      probeTimeoutMs: 200,
    });
    expect(ready).toBe(false);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test("with a path, requires an HTTP status below 500", async () => {
    const bad = await listenHttp(500);
    try {
      const ready = await waitForReady("127.0.0.1", bad.port, {
        path: "/",
        timeoutMs: 500,
        intervalMs: 100,
      });
      expect(ready).toBe(false); // TCP connects, but 500 keeps it not-ready
    } finally {
      bad.close();
    }

    const good = await listenHttp(200);
    try {
      expect(await waitForReady("127.0.0.1", good.port, { path: "/", timeoutMs: 2000 })).toBe(true);
    } finally {
      good.close();
    }
  });
});
