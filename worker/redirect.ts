/**
 * The old address (27 November): a page opened at a *.workers.dev address moves to the
 * custom domain, the same path and query; the browser keeps the #link part. Only page
 * visits: a tab already open there keeps talking to the API until it is reloaded.
 */
export function redirectToCanonical(
  request: Request,
  canonical: string | undefined,
): Response | null {
  if (!canonical) return null;
  const url = new URL(request.url);
  if (url.hostname === canonical || !url.hostname.endsWith('.workers.dev')) return null;
  if (url.pathname.startsWith('/api/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  return Response.redirect(`https://${canonical}${url.pathname}${url.search}`, 301);
}
