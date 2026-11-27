/**
 * Reads a browser error's stack against the build it came from (Phase 18).
 *
 *   node scripts/symbolicate.mjs < stack.txt
 *   node scripts/symbolicate.mjs --maps dist/assets < stack.txt
 *
 * Paste the `stack` from a "browser-error" line in Cloudflare's Worker logs. The maps
 * are the build's own: `npm run build` at the report's `release` commit (with the same
 * .env) makes the same files, or use the build that is deployed now if the release is
 * the current one. Frames whose file has no map here are printed as they are.
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const args = process.argv.slice(2);
const at = args.indexOf('--maps');
const mapsDir = at >= 0 ? args[at + 1] : 'dist/assets';
const stack = readFileSync(0, 'utf8');

const maps = new Map();
function mapFor(file) {
  if (!maps.has(file)) {
    const path = join(mapsDir, `${file}.map`);
    maps.set(file, existsSync(path) ? new TraceMap(readFileSync(path, 'utf8')) : null);
  }
  return maps.get(file);
}

for (const line of stack.split('\n')) {
  const frame = /^(.*?)(\S+\/assets\/([^/:\s)]+\.js)):(\d+):(\d+)(.*)$/.exec(line);
  const map = frame ? mapFor(basename(frame[3])) : null;
  if (!frame || !map) {
    console.log(line);
    continue;
  }
  const found = originalPositionFor(map, { line: Number(frame[4]), column: Number(frame[5]) - 1 });
  if (!found.source) {
    console.log(line);
    continue;
  }
  const where = `${found.source.replace(/^(\.\.\/)+/, '')}:${found.line}:${found.column + 1}`;
  console.log(`${frame[1]}${where}${found.name ? ` (${found.name})` : ''}${frame[6]}`);
}
