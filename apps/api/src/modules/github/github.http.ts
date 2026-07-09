/**
 * @module github.http
 *
 * The single api.github.com HTTP primitive. Every DIRECT GitHub read in
 * self-hosted mode funnels through here: given an ALREADY-RESOLVED token,
 * it issues the request with the canonical GitHub headers and parses the
 * JSON body.
 *
 * Deliberately dumb — it does NOT resolve tokens (that's `tokenFor`) and
 * does NOT authorize (that's the gh-cli gate). Two surfaces share it so
 * the wire mechanics live in exactly one place:
 *
 *   - `ghFetch`     → throws on non-2xx; used by `githubFetch`, where the
 *                     caller wants GitHub failures surfaced.
 *   - `ghFetchSoft` → returns null on ANY failure; used by the ungated
 *                     gh-CLI listing helpers, which treat GitHub as a
 *                     best-effort enhancement.
 *
 * Note: this is the DIRECT-to-github.com path. Cloud-app control-plane
 * calls (identity, install URL, installations list, token mint) go
 * through `cloudClient().github.*` (SaaS proxy) instead — a separate
 * surface by design (the hybrid: SaaS mints the token, this fetches the
 * data).
 */

export interface GhRequest {
  url: string;
  method?: string;
  /** GET → serialized to the query string; non-GET → JSON request body. */
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

function ghHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(extra ?? {}),
  };
}

function withQuery(url: string, method: string, params?: Record<string, unknown>): string {
  if (method !== "GET" || !params) return url;
  const entries: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) entries[k] = String(v);
  const qs = new URLSearchParams(entries).toString();
  return qs ? `${url}?${qs}` : url;
}

/** github.com REST should never hang — bound every call so a stalled request
 *  can't block a caller (e.g. the pre-deploy branch resolve) indefinitely. */
const GH_FETCH_TIMEOUT_MS = 20_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GH_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Throwing variant. 204 → `{ success: true }`; non-2xx → throws with
 * GitHub's own error message. This is the contract `githubFetch` relies on.
 */
export async function ghFetch<T = unknown>(token: string, req: GhRequest): Promise<T> {
  const method = req.method ?? "GET";
  const res = await timedFetch(withQuery(req.url, method, req.params), {
    method,
    headers: ghHeaders(token, req.headers),
    body: method !== "GET" ? JSON.stringify(req.params ?? {}) : undefined,
  });

  if (res.status === 204) return { success: true } as T;

  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) {
    throw new Error(
      `GitHub API error (${res.status}): ${(data as { message?: string }).message ?? "Unknown"}`,
    );
  }
  return data;
}

/**
 * Soft variant — returns null on ANY failure (network error, non-2xx,
 * parse error). Used by the ungated local gh-CLI listing helpers, which
 * surface GitHub as an optional enhancement and never throw at the caller.
 */
export async function ghFetchSoft<T = unknown>(token: string, req: GhRequest): Promise<T | null> {
  try {
    const method = req.method ?? "GET";
    const res = await timedFetch(withQuery(req.url, method, req.params), {
      method,
      headers: ghHeaders(token, req.headers),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
