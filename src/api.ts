export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Org-Planner': 'local' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: `Request failed (${response.status}).` }));
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
