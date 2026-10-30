# Sabboura — working notes

A collaborative infinite whiteboard for the browser. Built in phases; each phase ends
with something the user checks themselves against a written checklist.

**Read this first, then `README.md` for the phase table and architecture.**

## Where things stand

Phases 0–5 and 7 are verified by the user; Phase 6 was deployed and not reported
back on. **Phase 8 (sharing, permissions, comments)**, **Phase 9 (workshop tools and
rich content)**, **Phase 10 (quick fixes and the text box)**, **Phase 11 (one
control pane, and who sees what)**, **Phase 12 (settings and shortcuts)**, **Phase 13
(presenting, frames, celebrations and media)** and **Phase 14 (placeholders, the Answer
role and locks)** are built, tested and deployed at
<https://sabboura.mh-hamad.workers.dev> (migrations 0001–0006 applied remotely) but not
yet checked by the user.

The plan was renumbered after Phase 9: the user's list of requests became Phases
10–16 — 11 one control pane and role-based controls, 12 settings and shortcuts, 13
presenting/frames/celebrations/media, 14 placeholders and the "Answer" role and owner
locks, 15 undo across people and sessions, 16 dashboard organisation — and the
original 10 (accessibility, Arabic and RTL) and 11 (hardening) are now **17** and
**18**. The next phase is **15**. Parked by the user: student picture uploads,
read4more.com, "see the stroke before it ends", Chrome zoom.

Phase 9 in one paragraph: pages (`element.page`, absent = first page; the camera is
stored per page), presentation (`src/workshop/presentation.ts`, followers fit the
presenter's frame via presence `present`), a timer and dot votes in the document's
meta map and `votes` map (`src/workshop/workshop.ts`; the room's clock comes in the
welcome message as `now`), tables/code/embeds as element types, `/api/unfurl` for link
cards, a per-account library (`worker/routes/library.ts`, migration 0004), and SVG/PDF
import (`src/importers/`). Not built from the original plan: LaTeX, `.excalidraw`
import, emoji reactions.

Phase 12 in one paragraph: settings (`shared/settings.ts`, sanitised on both sides) are
the default text size, the clicked box's shape in characters × lines, the size others
start at on your boards, and changed shortcuts. Signed in they live in D1
(`user_settings`, `/api/settings`) with a localStorage copy; signed out, only the copy
(`src/settings/settings.ts`). `textDefaults()` is what a new text box starts at — on
someone else's board the size is the owner's (`textSize` in the board's open
response). Every shortcut is one entry in `src/input/shortcuts.ts` with a scope (board,
presenting, typing); the handlers call `actionFor(event, scope)`. Settings is a page
(`/settings`) and the same panel as a dialog over a board (`src/settings/dialog.ts`).

Phase 13 in one paragraph: a frame's place in the presentation is `element.slide`, a
fractional key (`framesInOrder`, `renumberFrame`, `slidePatches` in
`src/workshop/presentation.ts`); numbered frames first, the rest in reading order.
`FrameNumbers` draws the number badges (a select for editors). The frame on show
(`src/workshop/onShow.ts` — presenting, or following a presenter) is drawn bare and
clipped on a dark surround; embeds and vote dots are clipped to it too. While
presenting, `BoardControls` shows only the slide controls, tools, Insert and full
screen. Celebrations carry `level` and `variant` (`src/fun/effects.ts`); several play at
once. Media is an embed of kind `media` (a file: `fileId` when stored, `local-media:`
on the signed-out board) or `player` (Vimeo, SoundCloud, Spotify); stored media counts
in `fileIdsInDoc` like images, and `GET /api/files` answers range requests.

Phase 14 in one paragraph: a placeholder is a text box with `element.placeholder` (a
hint; `isPlaceholder`), drawn faint while empty and kept when emptied. One press types
into it whatever the tool (`typeInto` on a select-tool drag, so a drag still moves it).
The Answer role (`'answer'`, between commenter and editor) may type in placeholders
only: the board stays read-only for them (`board.answers`), and their typing goes
through `transactAnswer`. The room judges each update from them with `isOnlyAnswers`
(`shared/answers.ts`), which decodes it without applying it and allows only text and
formatting in a placeholder's `text` and a new `h`. Locks bind everyone but the owner
(`lockedForMe`, `mayLock` in `src/sharing/boardAccess.ts`): only the owner locks, any
editor unlocks, and locked items select (a drag box takes them in) but do not move,
nudge, erase or delete. Migration 0006 rebuilds `shares` for the new role.

Images are stored once each under their SHA-256 (`shared/files.ts`); `GET /api/files/:hash`
is public because the hash is the capability. Unused images are swept only when a
trash is emptied, so undo still works until then.

Each board has a room — the `BoardRoom` Durable Object (`worker/room.ts`), SQLite-backed.
It owns the board's content: an append-only update log plus snapshots every 200
updates, from which version history is read. It writes the R2 snapshot and the D1
search text and image references itself, two seconds after changes (an alarm). The
browser only uploads the thumbnail. A room with no storage seeds itself from the R2
snapshot, which is how pre-Phase-7 boards and duplicates arrive. Sockets hibernate;
auth is the first message (a browser cannot put a token on a WebSocket).

**Access is one rule, `worker/access.ts`,** used by every REST route and by the room. A
board's chain is the board then each folder above it; a person grant (by email) applies
from the nearest resource that has one, a link applies if its token was presented and
its audience admits this person, and the stronger of the two wins. Guests (a link, no
account) send `x-share-key` and a chosen name; the room labels them "(guest)". The room
refuses edits from anyone below editor (the Phase 8 gate) and re-checks every open
socket when sharing changes (`tellRooms(..., '/reauthorize')`) or a link expires (its
alarm). Comments, notifications (in-app only; no email) and the audit log live in D1.

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
- **IndexedDB saves a change a moment after it is made**, so a reload inside that
  moment lost the last edit — on a slow CI runner, every time. `guardUnsaved` in
  `src/doc/board.ts` keeps unconfirmed changes and writes them to localStorage on
  `pagehide`. To reproduce timing bugs like this, throttle the CPU through CDP
  (`Emulation.setCPUThrottlingRate`); this container's Chromium is fast enough to
  hide them, and `/opt/pw-browsers/chromium_headless_shell-1194` is closer to CI's.
- **The local D1/R2 outlive a test run, and images are deduplicated across accounts.**
  A test picture identical to one from an earlier run is legitimately "still in use",
  so storage tests stamp each picture with a per-test nonce.
- **Waiting for "the next request" catches the previous one's.** Derive ids from what
  the test itself made (hash the bytes) rather than from whichever request comes next.
- **A room's content arrives after the page opens.** Anything that scans the board on
  open (moving inline images, resuming uploads) must wait for the room's first sync,
  not just IndexedDB — on a device that never opened the board, IndexedDB is empty.
- `test-backend.mjs` builds `dist-test/` once at startup; restart it to see UI changes.
- **A control inside the stage needs `data-hud`** on it or an ancestor, or the canvas
  takes the pointer on pointerdown and the click never arrives.
- **Tests that open one board in two windows as the same person** share that
  person's identity — vote budgets, `self.uid` — so use two accounts when the point is
  two people (see `twoWindows(..., true)` in `workshop.spec.ts`).
- **The object list and the side panel are off by default**, but the specs read the
  board through them, so `playwright.config.ts` starts every test with
  `tests/e2e/prefs.json` (both on). A
  test of a first visit uses `test.use({ storageState: { cookies: [], origins: [] } })`.
  The renderer panel is in the command palette (`command-dev-panel`), and the palette
  only answers once the board is on screen.
- **Pen strokes are not selected when drawn**; a test that needs a stroke's size picks
  it from the object list first.
- **Pasted pictures are sized by shape** against the screen's height at 58% zoom (near
  square half of it, wide a sixth, very wide a ninth), so a near-square one is still
  taller than the screen at 100%; a test that grabs a picture's handles zooms to the
  selection first.
- **Text tool defaults are big** (40px type, 55 characters by 8 lines when clicked);
  a test that needs a small box drags one out. Typed text grows a box's height
  (`setElementText` measures it), so heights in tests are lower bounds.
- **A new shortcut is a line in `ACTIONS` (`src/input/shortcuts.ts`)** and a case in
  the handler for its scope — never a key compared by hand, or Settings cannot change
  it and the cheat sheet will not show it. Default keys must not clash within a scope
  (a unit test checks). Keys are `event.code`, written `Mod+Alt+Shift+Code`.
- **Waiting for "Saved to your account" right after a change** used to pass before the
  save began; a change now shows "Saving…" at once, so the wait is real.
- **A media embed's address may be relative** (`/api/files/<hash>`) or not a web
  address at all (`local-media:<hash>`): never `new URL()` it without a try. That
  crashed the side panel once, only on account boards.
- **Presenting no longer covers the window**: the stage keeps its place beside the
  pane, and children marked `data-present-hide` (side panel, frame numbers, comment
  pins, minimap, status lines) step aside. A new overlay that should not show on a
  slide needs that attribute.
- **The slide controls render once**, in the pane on a wide screen or along the
  bottom of a tall one (`useSidePane`), so `presentation-bar` and `present-stop` are
  never doubled.
- **Celebrations are the number pad, at any time** — the letters that started them
  while presenting are gone (they would have fought the tool keys once presenting
  keeps the drawing tools, Phase 13).
- **The canvas presses `preventDefault` on pointer-down**, so focus never moves on its
  own: anything that must end on a click elsewhere (typing) is ended there explicitly.
- **The text editor is `contenteditable`, not a textarea** (except for code), so tests
  read it with `textContent`, not `toHaveValue`. Formatting lives on the Y.Text
  (`formatYText`); typing after formatted text inherits it, which is Yjs's default —
  except a link, which the editor stops at its end. Colours, highlights and links sit
  in `data-*` attributes in the box, because a browser rewrites an inline colour
  (`#e03131` reads back as `rgb(…)`) and the box would then never match the text.
- **Focus leaving the text box for the side panel's link field** must not end typing;
  the editor checks `[data-keep-typing]` on blur. A new control that takes focus while
  typing needs that attribute on an ancestor. Every other panel control presses
  `preventDefault` on mouse-down, so the box keeps the focus.
- **The wheel is ignored over anything `data-hud`** unless it is also
  `data-wheel-pans` (the text box being typed in).
- **A played video holds the keyboard** (the iframe has focus); a press on the board
  blurs it. Tests focus `embed-player` to reproduce that.
- **Ghost windows**: the room drops a socket that has not pinged for `PEER_STALE_MS`
  (3 minutes; 45 seconds on the test backend), and a page's reconnection replaces its
  own earlier socket (`tab` in the handshake). The tests route the WebSocket through
  a stand-in that can be cut and never passes on a close.
- **Picking up another tool clears the selection** (`setTool`), so a test that draws
  a shape and then switches tool finds nothing selected.
- **The controls are a pane on the right at Playwright's default 1280×720** (wide and
  landscape), 112 px wide, so the board ends at x = 1168 and starts at y = 0. A test
  of the bar along the top sets a tall viewport. The layout is decided by one media
  query, `(min-width: 900px) and (orientation: landscape)`, repeated in each
  stylesheet that depends on it; `--pane-w` (global.css) is the pane's width there.
- **A board opens fitted to its contents** (`fitOnOpen`), not where its camera was
  left — but only if it has contents, so a test drawing on a fresh board in two
  windows still sees the same coordinates in both.
- **A viewer's tools are the hand and the laser** (`VIEWER_TOOLS`); boards open
  read-only until the role is known, so an editor's tool starts as the hand and goes
  back to select when the role arrives.
- **A folder's name shows twice on the dashboard** (sidebar and card); tests scope
  to `getByRole('complementary')` or the card's test id.
- **Controlled checkboxes that wait for the server** do not change on click, so
  Playwright's `.check()` fails; tests click and wait for the result instead.
- **An owner must never wait for the server to draw.** Boards open read-only until the
  role is known, except boards already in the owner's own workspace.
- A new migration must be applied remotely **before** `npm run deploy`
  (`npx wrangler d1 migrations apply sabboura --remote`), or the new Worker queries
  tables that do not exist yet.

- **A board opens fitted only until you change something.** The room's first sync can
  arrive after the page has drawn; it used to refit the view then, under a drag in
  progress. Any local change now cancels the pending fit (`attachDocument`).
- **Locks do not stop the owner**, including on the signed-out board, where you are
  the owner. A test of a lock blocking a move needs a second account.
- **An Answer person's board is read-only** (`board.readOnly`); their typing is the
  one exception, through `transactAnswer`. Anything new they should be able to change
  needs a place in `isOnlyAnswers` too, or the room refuses it.
- **Never `open(p, 'w')` in the same expression that reads `p`** in a Python edit
  script: the file is emptied before it is read. It wiped a source file once; restore
  with `git checkout --` and re-apply.

- **The account is on Cloudflare's free plan, and its daily caps are the budget.** On
  30 October 2026 D1 reached 76% of its 100,000 rows written: each room save deleted
  and re-inserted the board's whole picture list (2 rows per picture, every 2 seconds of
  editing). Saves now write only what changed (`boardFilesUpdate`). The rooms took about
  94,000 requests that day, nearly all live-connection messages; presence now goes only
  while someone else is on the board, and changes are batched for 400 ms when nobody is
  (40 ms when someone is). Before adding anything that writes per change or sends per
  frame, work out its daily cost; `npx wrangler d1 insights sabboura --sort-by writes`
  and Cloudflare's GraphQL analytics (`durableObjectsInvocationsAdaptiveGroups`,
  `durableObjectsPeriodicGroups`) show where it goes.

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
