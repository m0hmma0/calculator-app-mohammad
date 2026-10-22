# Sabboura — working notes

A collaborative infinite whiteboard for the browser. Built in phases; each phase ends
with something the user checks themselves against a written checklist.

**Read this first, then `README.md` for the phase table and architecture.**

## Where things stand

Phases 0–5 are done, each verified by its checklist and green CI. **Phase 6 (images on
R2)** is built, tested and deployed at <https://sabboura.mh-hamad.workers.dev>
(migrations 0001 and 0002 applied remotely) but not yet checked by the user. The next
phase is **7 (real-time)**, then 8 (sharing — the user has asked for it).

Images are stored once each under their SHA-256 (`shared/files.ts`); `GET /api/files/:hash`
is public because the hash is the capability. Which images a board uses is read from
its Yjs snapshot by the Worker on every save, and unused images are swept only when a
trash is emptied, so undo still works until then.

The full plan, including every phase's checklist, lives in an artifact:
<https://claude.ai/code/artifact/5e80f000-99d0-42bf-9525-7e76a632abdb>

A live preview of the current build (signed-out local mode) is published at:
<https://claude.ai/artifact/MxJJwHz82XCdHNVmAKwC4a>

`git log` is the other source of truth — each phase is one commit whose message says
what it added and what it fixed.

## Deploying

`npm run deploy` builds and runs `wrangler deploy`. It needs `CLOUDFLARE_API_TOKEN` as
an environment secret (Workers Scripts: Edit, D1: Edit, R2: Edit) and `.env` with the
Firebase web config (see `.env.example`; values are public: project `r4m-whiteboard`).
`.env` is gitignored, so a fresh container must recreate it before building, or the
bundle falls back to local-only mode. The container's proxy blocks `*.workers.dev`, so
the live site cannot be fetched from here; `npx wrangler deployments list` confirms a
deploy. Google sign-in needs `sabboura.mh-hamad.workers.dev` in Firebase's authorised
domains.

Never ask for a token, key or password in chat; direct the user to environment
secrets instead.

## Working agreement

- Develop on `claude/collaborative-whiteboard-app-hqkq5u`. Do **not** push to `main`;
  open a pull request instead.
- One commit per phase. End commit messages with the attribution trailers the session
  reminder gives.
- **Run `npm run check` before every commit.** CI has caught an unformatted file more
  than once; it is the whole check, not just the tests.
- After each phase: rebuild the preview and republish it to the same artifact URL, so
  the user always has something to click.
- Report what actually happened — failing tests, skipped scope, limitations — rather
  than a summary that reads better than the truth.

## Commands

```bash
npm run dev                    # Vite dev server
npm run check                  # format, lint, typecheck, unit tests — before committing
npm test                       # unit (Vitest)
npm run test:e2e               # browser (Playwright): canvas + workspace projects
npm run build:preview          # single-file preview.html for publishing as an artifact
node scripts/test-backend.mjs  # Worker + local D1/R2 on :8788, key server on :8799
```

End-to-end tests need a browser. In this container Chromium predates the pinned
Playwright, so pass `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.

## Things that have bitten before

- **`pkill -f "wrangler dev"` kills your own shell**, because the pattern matches the
  command line running it. Exit code 144 is that. Use `pkill -f "[w]rangler"`, and put
  the kill in its own call so no other argument contains the pattern either.
- **Yjs writes a literal U+FFFD** when splitting a surrogate pair, and the artifact
  host rejects a document containing one. `scripts/make-preview.mjs` escapes it and
  fails loudly if any survive.
- **Editing files with a script skips Prettier.** Always run `npx prettier --write` on
  whatever a script touched, or CI's formatting step fails.
- **A pattern that matched before may not match after Prettier reflowed the file.**
  Assert in the script when replacing text, so a silent no-op cannot pass as success.
- **Generated output must be in `.gitignore`, `.prettierignore` _and_ `eslint.config.js`.**
  Missing the last one produced 2,094 lint errors from a build directory.
- Test builds live in `dist-test/`; the Worker serves them via `wrangler dev --assets`.
- **The local D1/R2 outlive a test run, and images are deduplicated across accounts.**
  A test picture identical to one from an earlier run is legitimately "still in use",
  so storage tests stamp each picture with a per-test nonce.
- **Waiting for "the next request" catches the previous one's.** Derive ids from what
  the test itself made (hash the bytes) rather than from whichever request comes next.
- A new migration must be applied remotely **before** `npm run deploy`
  (`npx wrangler d1 migrations apply sabboura --remote`), or the new Worker queries
  tables that do not exist yet.

## Design decisions worth not relitigating

- **Web only.** React Native was dropped deliberately — it made Arabic text, clipboard
  paste and desktop file-drop much harder for no gain, since no app store is wanted.
- **Shift frees an image's aspect ratio** rather than locking it. The reverse of
  Figma, and intentional: it was asked for.
- **The camera and the laser trail stay out of the shared document.** The camera is
  personal (localStorage); the laser is ephemeral by definition.
- **Group boxes and bound connector endpoints are derived on read**, not stored, so no
  peer races to write a value every peer can compute.
- **Undo is scoped to this tab's origin**, which is what makes it undo only your own
  edits once collaboration lands in Phase 7.
- **A build with no Firebase project is still a whiteboard**, falling back to one local
  board. A deployment without sign-in should be usable, not a locked door.

## Testing posture

Prove behaviour, not implementation. The backend tests run the real Worker against
local D1 and R2 and verify real RS256 tokens against a key server of their own — the
verification path is never stubbed, because that is the part most worth proving. When
a test needs something the app does not expose, add the readout to the UI if a user
would want it too (that is where the inspector's X/Y/W/H came from); otherwise assert
through pixels or the DOM rather than a back door.
