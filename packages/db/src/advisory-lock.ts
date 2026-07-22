import { getDriver, getPgPool } from "./client";

export interface AdvisoryLockHandle {
  release(): Promise<void>;
}

/**
 * 31-bit signed-positive int hash of a string identity, for Postgres advisory
 * lock keys. `pg_advisory_lock` takes a bigint; hashing a string identity down
 * to one keys the lock by identity, not by row presence. Collisions just make
 * two unrelated keys serialize (correctness preserved); 31 bits ≈ 2B buckets,
 * so collision risk is negligible.
 */
export function hashStringToInt(input: string): number {
  // FNV-1a 32-bit, masked to 31 bits so it fits a signed int4 and stays
  // consistent across drivers that don't auto-cast unsigned.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h & 0x7fffffff;
}

/**
 * Run `fn` while holding a Postgres SESSION-level advisory lock keyed by
 * `scopeKey`, serializing it across every process/replica sharing the database.
 * The lock is held on a dedicated pooled connection for the whole of `fn` and
 * released in `finally` (session-level, not xact-scoped, because callers may run
 * long — e.g. provisioning a server).
 *
 * On the PGlite driver (single embedded process — desktop/dev) there is nothing
 * to coordinate across processes, so this is a passthrough; callers still layer
 * an in-process mutex on top for same-process serialization.
 */
export async function withAdvisoryLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  if (getDriver() === "pglite") {
    return fn();
  }

  const key = hashStringToInt(scopeKey);
  const client = await getPgPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [key]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

/**
 * Try to acquire a session-level advisory lock without waiting. The returned
 * handle owns its pooled connection until release, so callers can hold the lock
 * across lifecycles that outlive a single awaited function (for example SSE).
 */
export async function tryAcquireAdvisoryLock(scopeKey: string): Promise<AdvisoryLockHandle | null> {
  if (getDriver() === "pglite") {
    return { release: async () => {} };
  }

  const key = hashStringToInt(scopeKey);
  const client = await getPgPool().connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [key],
    );
    if (result.rows[0]?.acquired !== true) {
      client.release();
      return null;
    }
  } catch (err) {
    client.release();
    throw err;
  }

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
      } catch (err) {
        client.release(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
      client.release();
    },
  };
}
