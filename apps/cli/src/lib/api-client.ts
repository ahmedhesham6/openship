/**
 * CLI HTTP client — communicates with the Openship API.
 */
import { LOCAL_API_URL } from "@repo/core";

export function getApiUrl(): string {
  return `${LOCAL_API_URL}/api`;
}

export async function apiRequest(path: string, options?: RequestInit) {
  const url = `${getApiUrl()}${path}`;
  const token = getStoredToken();

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((body.error as string) || `API error: ${res.status}`);
  }

  return res.json();
}

function getStoredToken(): string | null {
  // TODO: Read token from ~/.openship/config.json
  return null;
}
