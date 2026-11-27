import { describe, expect, it } from 'vitest';
import { redirectToCanonical } from '../../worker/redirect';

const NEW = 'sabboura.read4more.com';
const at = (url: string, method = 'GET') => redirectToCanonical(new Request(url, { method }), NEW);

describe('the old address sends pages to the custom domain', () => {
  it('moves a page, keeping its path and query', () => {
    const moved = at('https://sabboura.mh-hamad.workers.dev/b/brd_123?x=1');
    expect(moved?.status).toBe(301);
    expect(moved?.headers.get('location')).toBe(`https://${NEW}/b/brd_123?x=1`);
  });

  it('moves a share link', () => {
    expect(at('https://sabboura.mh-hamad.workers.dev/l/abc')?.headers.get('location')).toBe(
      `https://${NEW}/l/abc`,
    );
  });

  it('leaves the API alone, so tabs already open keep working', () => {
    expect(at('https://sabboura.mh-hamad.workers.dev/api/workspace')).toBeNull();
    expect(at('https://sabboura.mh-hamad.workers.dev/', 'POST')).toBeNull();
  });

  it('leaves the custom domain, and anywhere else, alone', () => {
    expect(at(`https://${NEW}/b/brd_123`)).toBeNull();
    expect(at('http://localhost:8788/b/brd_123')).toBeNull();
    expect(redirectToCanonical(new Request('https://x.workers.dev/'), undefined)).toBeNull();
  });
});
