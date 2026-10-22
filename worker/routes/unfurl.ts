import type { Env } from '../env';
import { fail, json } from '../http';

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

/**
 * Addresses that lead into private networks. A Worker cannot reach a user's LAN, but
 * a link-preview fetcher should still refuse to be pointed at anything but the open
 * web. Tests run against a page on localhost, and say so explicitly.
 */
function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.internal'))
    return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(name)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(name)) return true;
  if (name === '::1' || name.startsWith('fc') || name.startsWith('fd') || name.startsWith('fe80')) {
    return name.includes(':');
  }
  return false;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** The content of a <meta> tag by property or name, whichever order its attributes are in. */
function meta(html: string, key: string): string | undefined {
  const pattern = new RegExp(`<meta\\s[^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = pattern.exec(html)?.[0];
  const content = tag && /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
  return content ? decodeEntities(content).trim() : undefined;
}

/** Reads at most MAX_BYTES of the page: the head is near the top, and pages can be huge. */
async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let html = '';
  let read = 0;
  while (read < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  await reader.cancel().catch(() => undefined);
  return html;
}

export async function unfurl(request: Request, env: Env): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('url') ?? '';
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail('That is not a web address', 400);
  }
  if (!/^https?:$/.test(target.protocol)) return fail('Only web pages can be previewed', 400);
  if (env.UNFURL_ALLOW_LOCAL !== '1' && isPrivateHost(target.hostname)) {
    return fail('That address is not on the open web', 400);
  }

  let response: Response;
  try {
    response = await fetch(target.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SabbouraBot/1.0; link preview)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch {
    return fail('That page did not answer', 502);
  }
  if (!response.ok || !/html/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => undefined);
    return json({});
  }

  const html = await readHead(response);
  const finalUrl = new URL(response.url || target.href);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const imageRaw = meta(html, 'og:image') ?? meta(html, 'twitter:image');
  let image: string | undefined;
  if (imageRaw) {
    try {
      const resolved = new URL(imageRaw, finalUrl);
      if (/^https?:$/.test(resolved.protocol)) image = resolved.href;
    } catch {
      // A broken image address is simply no image.
    }
  }

  const clip = (text: string | undefined, max: number) =>
    text ? text.replace(/\s+/g, ' ').trim().slice(0, max) : undefined;
  return json(
    {
      title: clip(
        meta(html, 'og:title') ??
          meta(html, 'twitter:title') ??
          (titleTag && decodeEntities(titleTag)),
        200,
      ),
      description: clip(meta(html, 'og:description') ?? meta(html, 'description'), 300),
      image,
      site: clip(meta(html, 'og:site_name') ?? finalUrl.hostname.replace(/^www\./, ''), 80),
    },
    200,
  );
}
