export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const fail = (message: string, status: number): Response => json({ error: message }, status);

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Trims, collapses whitespace and caps length, so a name cannot break the UI. */
export function cleanName(value: unknown, fallback: string, max = 120): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned === '' ? fallback : cleaned;
}
