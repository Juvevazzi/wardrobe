export async function apiRequest(path, options, fallbackMessage = "The request could not be completed.") {
  const startedAt = Date.now();
  const method = options?.method || "GET";
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  if (import.meta.env.DEV) {
    console.debug(`[api] ${method} ${path} -> ${response.status} (${Date.now() - startedAt}ms)`);
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = value.error || fallbackMessage;
    console.error(`[api] ${method} ${path} failed:`, message);
    throw new Error(message);
  }
  return value;
}
