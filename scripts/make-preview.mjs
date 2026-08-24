/**
 * Turns the single-file Vite build into a fragment that can be published as an
 * artifact: the artifact host supplies <!doctype>, <html>, <head> and <body>, so
 * we keep the title, the inlined <style> and <script>, and the body contents.
 *
 * Vite inlines the bundle into <head>, and that bundle can contain anything —
 * including the literal text "</script>" inside a string. So rather than matching
 * individual tags in the inlined region, we split the head at the first <script>
 * or <style> and pass everything from there on through untouched.
 *
 * Run via `npm run build:preview`. Output: preview.html (gitignored).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('dist-preview/index.html', root);
const target = new URL('preview.html', root);

const html = await readFile(source, 'utf8');

const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1];
const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];

if (head == null || body == null) {
  throw new Error('Could not find <head> and <body> — did `vite build --mode preview` run?');
}

// Everything before the first inlined asset is plain document metadata we control.
const firstAsset = head.search(/<(?:script|style)[\s>]/i);
if (firstAsset === -1) {
  throw new Error(
    'No inlined <script> or <style> in the build — is vite-plugin-singlefile active?',
  );
}

const preamble = head.slice(0, firstAsset);
const assets = head.slice(firstAsset);

if (/<link[^>]+href=["']https?:/i.test(preamble)) {
  throw new Error('Preview references an external stylesheet — the artifact CSP will block it.');
}

const title = /<title>[\s\S]*?<\/title>/i.exec(preamble)?.[0] ?? '<title>Sabboura</title>';
const fragment = `${title}\n${body.trim()}\n${assets.trim()}\n`;

if (!fragment.includes('id="root"')) {
  throw new Error('Preview is missing the #root mount point.');
}

await writeFile(target, fragment, 'utf8');

const kb = (Buffer.byteLength(fragment) / 1024).toFixed(1);
console.log(`preview.html written — ${kb} KB (${fileURLToPath(target)})`);
