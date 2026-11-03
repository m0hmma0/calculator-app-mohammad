# Sabboura — working notes

A collaborative infinite whiteboard for the browser. Built in phases; each phase ends
with something the user checks themselves against a written checklist.

**Read this first, then `README.md` for the phase table and architecture.**

## Where things stand

Phases 0–5 and 7 are verified by the user; Phase 6 was deployed and not reported
back on. **Phase 8 (sharing, permissions, comments)**, **Phase 9 (workshop tools and
rich content)**, **Phase 10 (quick fixes and the text box)**, **Phase 11 (one
control pane, and who sees what)**, **Phase 12 (settings and shortcuts)**, **Phase 13
(presenting, frames, celebrations and media)**, **Phase 14 (placeholders, the Answer
role and locks)**, **14.1 (fixes)**, **14.2 (pictures, locks, panning)** and **Phase 15
(undo after closing a board)** and **Phase 16 (dashboard organisation)** are built,
tested and deployed at
<https://sabboura.mh-hamad.workers.dev> (migrations 0001–0007 applied remotely) but not
yet checked by the user.

The plan was renumbered after Phase 9: the user's list of requests became Phases
10–16 — 11 one control pane and role-based controls, 12 settings and shortcuts, 13
presenting/frames/celebrations/media, 14 placeholders and the "Answer" role and owner
locks, 15 undo across people and sessions, 16 dashboard organisation — and the
original 10 (accessibility, Arabic and RTL) and 11 (hardening) are now **17** and
**18**. After Phase 14 the user's next list became **14.1** (text box heights, the
eraser, the side panel's layering and toggle, duplicates below, strikethrough, three
shortcuts, boards shared for answering by default) and **14.2** (paste to fit the
selection, cropping, the old lock plus "lock for others", panning while dragging). Phase
15 now holds only undo that survives closing a board, and Phase 17 only keyboard use of
the canvas and visible focus. On 2 November what was already done came out of 17 and 18:
17 is creating, reaching and typing into shapes from the keyboard (arrows and Delete
work) and focus rings off the board (the board's 62 controls already show one); 18 no
longer lists CI's end-to-end suite, panning 5,000 shapes or the README. **14.1, 14.2, 15 and 16 are built**; the next phase is **17**. Parked by the user: student
picture uploads, read4more.com, "see the stroke before it ends", Chrome zoom, and (taken
out of 15 and 17 on 1 November) the owner undoing a collaborator's steps, Arabic and
RTL, dark mode, high contrast, reduced motion, onboarding, empty and error states, and
the accessibility audit.

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
`src/workshop/presentation.ts`); numbered frames first, the rest in column order (`columnOrder`: down a column, then the
next to the right; asked for on 2 November instead of rows). `numberFramesAutomatically`
sets every `slide` to null (Insert menu, editors); `startPresentation` begins at
`selectedFrame` — a selected frame, else the frame holding the selection's middle.
`FrameNumbers` draws the number badges (a select for editors). The frame on show
(`src/workshop/onShow.ts` — presenting, or following a presenter) is drawn bare and
clipped on a dark surround; embeds and vote dots are clipped to it too. While
presenting, `BoardControls` shows only the slide controls, tools, Insert and full
screen. Celebrations carry `level` and `variant` (`src/fun/effects.ts`); several play at
once. Media is an embed of kind `media` (a file: `fileId` when stored, `local-media:`
on the signed-out board) or `player` (Vimeo, SoundCloud, Spotify); stored media counts
in `fileIdsInDoc` like images, and `GET /api/files` answers range requests. Since 3
November files are always-live players (`src/ui/MediaPlayers.tsx`: `SoundCard` with a
waveform from `embed.peaks`, `VideoCard` with its own bar), laid out in board units and
scaled by the layer; other sites' players start on one click (`startPlayer`, the
`started` list in `embedStore.ts`) and stay. Their controls carry `data-hud`, which is
what lets a viewer or a locked item play: without it the board's pan or select takes
the press (a test as a viewer catches that; one as the owner does not).

Phase 14 in one paragraph: a placeholder is a text box with `element.placeholder` (a
hint; `isPlaceholder`), drawn faint while empty and kept when emptied. It is placed
with the `placeholder` tool (Insert → Placeholder): a click gives one line, a drag the
size dragged (`placePlaceholder`). One press types into it whatever the tool, except
that the select tool of someone who edits tells its edge from its inside
(`onPlaceholderEdge`, a 10 px band): inside types, the edge selects, moves and resizes
like any box. Hover follows the same rule, after a selection's handles.
The Answer role (`'answer'`, between commenter and editor) may type in placeholders
only: the board stays read-only for them (`board.answers`), and their typing goes
through `transactAnswer`. The room judges each update from them with `isOnlyAnswers`
(`shared/answers.ts`), which decodes it without applying it and allows only text and
formatting in a placeholder's `text` and a new `h`. Locked items select (a drag box
takes them in) but do not move, nudge, erase or delete; 14.2 changed who they bind.
Migration 0006 rebuilds `shares` for the new role.

Phase 14.1 in one paragraph: `element.autoHeight` marks a text box whose height follows
its text (clicked boxes, clicked placeholders, pasted text); `fitted` (src/text/measure.ts)
works the height out, and the store applies it to every change that touches width, text,
style or hint (`fitHeights` before `applyPatches`). Dragging only the height of such a box
clears the flag; Settings no longer has a box height (`boxLines` is gone). `readBox` ignores a `<br>` that is the box's very last node. The eraser's
`removeElements` deletes from the document. The side panel (z-index 8, inside a stage that
`isolation: isolate`s its layers) shows when on and there is a selection, a tool with
options (`hasToolOptions`) or the object list; `ToolOptions inPanel` renders the pen's
settings at its top. `duplicateSelection('below' | 'inPlace')`. A `strike` mark and style.
Shortcuts `tool.placeholder` (Q), `tool.stamp` (S; again cycles), `stamp.N` (unset),
`present` (Mod+Enter), `text.strike` (Mod+Shift+X). New boards and duplicates get a link
(`defaultLink`): anyone, answer, logged as "link on".

Phase 14.2 in one paragraph: two locks (`setSelectionLocked(locked, 'all' | 'others')`).
A plain lock (`locked`, no `lockMode`) binds everyone, the owner too, and any editor sets
it; "Lock for others" (`lockMode: 'others'`, `mayLockForOthers`: the owner only) binds
all but the owner. `lockedForMe` in `src/sharing/boardAccess.ts` decides; one Unlock
clears both. A picture pasted with a selection takes `selectionAABB`'s width and goes
`DUPLICATE_GAP` below it (`placeAt(..., under)` in `useImageImport.ts`). Cropping:
`element.crop` is a window on the whole picture in fractions of it (`src/model/crop.ts`:
`recrop`, `wholePicture`, `cropSource`), `x/y/w/h` stay the box shown; `croppingId` in
the store is crop mode (double-click; Enter, Escape, a click away or a tool change end
it), `drawCropping` in `renderOverlay.ts` shows the ghost and crop marks. Edge panning is
an rAF loop in `useCanvasInteraction.ts` (`panAtEdge`, 40 px zone, up to 18 px a
frame) that runs only during a move drag. No migration: `crop` and `lockMode` are
document fields.

Phase 15 in one paragraph: `src/doc/history.ts` writes each undo step down as what it
did — per element touched, before and after (changed fields only; whole element for
made or deleted, null for "absent"), plus the page list — so steps outlive the tab. The
binding's third argument (`onTouched`) reports each transaction's elements before and
after; `trackHistory` keeps them as `pending` until the undo manager's
`stack-item-added`/`-updated` names the stack item, and stores them in its `meta`. The
last 100 (`HISTORY_LIMIT`) go to IndexedDB (`sabboura-history`, key `uid/boardId`,
`guest/…`, or `local`) a second after changes, to `localStorage` on `pagehide` if not yet
confirmed. The store's `undo` uses Yjs's undo manager while it has steps, then
`history.undo()`; `redo` tries `history.redo()` first. Replayed steps use
`HISTORY_ORIGIN` (not tracked, but saved and sent to the room) and change a field only
where it still reads as the step left it. No migration; nothing on the server.

Phase 16 in one paragraph: the workspace response carries archived folders and boards
too (`archivedAt`), and the dashboard filters them out of every view but Archive (and
an archived folder opened from there); `listBoards`/`listFolders` still mean "not
deleted". Archiving a folder (`POST /api/folders/:id/archive`) stamps it, its live
subfolders and their boards with one `archived_at`; `DELETE` on the same path brings
back what has that stamp, as the trash does with `deleted_at`. Boards: `POST`/`DELETE
/api/boards/:id/archive`. Archive is the owner's tidying, not access: links and shares
work as before, and a shared folder's contents leave archived things out. Folder order
is `folders.position` (integers, set by `POST /api/folders/order` with a parent's whole
order; null sorts after, by name; moving a folder to another parent clears it) and
`folders.pinned`; `sortFolders` and `sortBoards` in `workspaceStore.ts` are the one
place order is decided. Tiles/list and the board order are `settings.dashboard`
(`view`, `sort`). Dragging is HTML drag and drop (`useFolderDrag`), siblings only; the
list view's rows read down columns (`useListRows` sets the grid's row count from its
width). Migration 0007.

Images are stored once each under their SHA-256 (`shared/files.ts`); `GET /api/files/:hash`
is public because the hash is the capability. Unused images are swept only when a
trash is emptied, so undo still works until then.

Each board has a room — the `BoardRoom` Durable Object (`worker/room.ts`), SQLite-backed.
It owns the board's content: an append-only update log plus snapshots every 200
entries, from which version history is read. Changes are applied and passed on at
once but written to the log once a second, one entry per person (`flush`, `FLUSH_MS`);
the sender's ack waits for the write, and anything held is written at once when a
socket closes, before history is read and at the alarm. On connect the room asks
editors and Answer people for anything it lacks, which is how changes it held but lost
in a restart, and answers typed offline, come back. It writes the R2 snapshot and the D1
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
- **wrangler dev sometimes exits mid-suite** ("Network connection lost" from the local
  runtime, then its proxy gives up): three times on 2 November and once on CI, deep into
  a full run, near the 5,000-shapes test. Every later test then failed to connect.
  `test-backend.mjs` now starts it again (up to 5 times, logged as `[test-backend]
wrangler dev exited`), so only the tests caught at that moment fail and CI retries
  them. The cause is not pinned down; the local runtime grows to about 500 MB over a
  full run, so memory is the first suspect. A real crash of the Worker would still show
  as that message — look for it before calling a failure flaky.
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
- **Text tool defaults are big** (40px type, 55 characters wide when clicked, one line
  tall and following its words); a test that needs a small box drags one out. Typed
  text grows a dragged box's height (`setElementText` measures it), so heights there
  are lower bounds; a clicked box's height is exact.
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
- **A media card lets the pointer through except at its controls**, so Playwright's
  `locator.click()` on its title waits forever ("does not receive pointer events"); a
  test that presses the card itself uses `page.mouse.click` at the spot. Its controls
  are `media-play`, `media-wave`, `media-seek`, `media-toggle`, `media-fullscreen`.
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
- **A plain lock stops the owner too; a lock for others does not** — including on the
  signed-out board, where you are the owner. A test of a lock for others blocking a
  move needs a second account.
- **A pasted picture lands under whatever is selected**, at its width, and is then
  selected itself, so a test that pastes twice in a row stacks them; click empty board
  first to paste where the pointer is.
- **The eraser starts in drawings mode** (`eraserMode: 'drawings'`): only `path`
  elements (pen, highlighter, and SVG-imported line art), whole. A test that erases a
  shape or a text box picks `eraser-object` or `eraser-stroke` first.
- **"Archive" is a word on every card now** (Phase 16: the Archive button, and the
  sidebar's Archive link), so a test that finds a folder by the text "Archive" finds them
  all. The workspace tests' folder is called "Past terms" for that reason.
- **A new spec that needs the backend goes in both regexes** in `playwright.config.ts`
  (the canvas project's `testIgnore`, the workspace project's `testMatch`);
  `dashboard.spec.ts` was added to both.
- **Undo outlives the board now** (Phase 15). A test that reloads and expects a clean
  undo stack gets the earlier visit's steps; the signed-out board's history is
  `local` in IndexedDB, and a fresh Playwright context starts without it.
- **Closing a page cuts off an IndexedDB write started as it closes** — proven again
  in Phase 15: without the `localStorage` copy on `pagehide`, a reload straight after a
  change lost the last steps. Anything else that must survive a close needs the same.
- **A board reopened is fitted to its contents**, so world coordinates read from the
  inspector are screen pixels only before a reload (at 100% and the starting camera).
- **An Answer person's board is read-only** (`board.readOnly`); their typing is the
  one exception, through `transactAnswer`. Anything new they should be able to change
  needs a place in `isOnlyAnswers` too, or the room refuses it.
- **A Yjs document rebuilt from stored updates holds its root types as stand-ins** until
  something asks for one by name (`doc.getMap('elements')`), which swaps in the real map
  and re-parents its children. So ask first, then compare: `item.parent ===
doc.getMap(...)` read left to right was false on the first call. It refused the first
  answer typed into a room that had just woken (`isOnlyAnswers`); CI's slower runner
  hit it, this container rarely.
- **A new board already has a link** (anyone, can answer). A test that wants a link to
  view turns it on only if it is off and sets the role (`enableLink` in sharing.spec);
  clicking the switch blindly turns it off.
- **The side panel can be absent with nothing selected** (when the object list is off),
  and the pen's options move into it when it is on: a test of the floating options bar
  switches the panel off first.
- **Never `open(p, 'w')` in the same expression that reads `p`** in a Python edit
  script: the file is emptied before it is read. It wiped a source file once; restore
  with `git checkout --` and re-apply.

- **The account is on Cloudflare's free plan, and its daily caps are the budget.** On
  30 October 2026 D1 reached 76% of its 100,000 rows written: each room save deleted
  and re-inserted the board's whole picture list (2 rows per picture, every 2 seconds of
  editing). Saves now write only what changed (`boardFilesUpdate`). The rooms took about
  94,000 requests that day, nearly all live-connection messages; presence now goes only
  while someone else is on the board, and changes are batched for 400 ms when nobody is
  (40 ms when someone is). The room writes its log once a second, one entry per person,
  instead of one entry (about 4 rows) per message. Before adding anything that writes per change or sends per
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
