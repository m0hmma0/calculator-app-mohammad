# Sabboura

A collaborative infinite whiteboard for the browser — real-time editing, folders and
sharing, images, freehand ink, text, shapes and a laser pointer.

Runs entirely on free tiers: Cloudflare Pages, D1, Durable Objects and R2, with Firebase
for Google sign-in.

## Status

Built in phases. Each phase ends with a working, checkable deliverable.

| Phase  | What it adds                                 | State       |
| ------ | -------------------------------------------- | ----------- |
| **0**  | Teardown, tooling, test harness, app shell   | ✅ done     |
| **1**  | Infinite canvas — pan, zoom, minimap         | ✅ done     |
| **2**  | Shapes, selection, transform handles         | ✅ done     |
| **3**  | Freehand, text, images, laser pointer        | ✅ done     |
| **4**  | Yjs document, per-user undo, offline, export | ✅ done     |
| **5**  | Google sign-in, folders, boards (D1)         | ✅ done     |
| **6**  | Image storage (R2)                           | built       |
| **7**  | Real-time collaboration (Durable Objects)    | ✅ done     |
| **8**  | Sharing, permissions, comments               | built       |
| **9**  | Presentation mode, workshop tools, embeds    | built       |
| **10** | Quick fixes and the text box                 | built       |
| 11     | One control pane, and who sees what          | not started |
| 12     | Settings and shortcuts                       | not started |
| 13     | Presenting, frames, celebrations and media   | not started |
| 14     | Classroom: placeholders, Answer role, locks  | not started |
| 15     | Undo across people and sessions              | not started |
| 16     | Dashboard organisation                       | not started |
| 17     | Accessibility, Arabic and RTL, polish        | not started |
| 18     | Hardening, load testing, launch              | not started |

Phases 10–16 were added from a list of requests after Phase 9; the original Phases 10
and 11 are now 17 and 18, and come last so that they cover the finished layout and
roles.

## Getting started

Requires Node 22 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Scripts

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `npm run dev`           | Vite dev server with hot reload                                |
| `npm run build`         | Production build into `dist/`                                  |
| `npm run build:preview` | Single self-contained `preview.html` for sharing a phase       |
| `npm run check`         | Format check, lint, typecheck and unit tests — run before push |
| `npm test`              | Unit tests (Vitest)                                            |
| `npm run test:e2e`      | Browser tests (Playwright)                                     |
| `npm run deploy`        | Build and deploy to Cloudflare (Phase 5 onwards)               |

### If Playwright cannot find a browser

Containers and CI images sometimes ship a Chromium older than the pinned Playwright
version. Point the tests at it instead of downloading a second copy:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e
```

## Layout

```
src/
  canvas/     renderer, viewport maths, grid, theme colour cache
  collab/     the room connection, presence, follow mode, version history
  geometry/   pure maths — rects, points, intersection, union
  api/        typed client for the Worker
  auth/       Firebase sign-in and the current token
  doc/        the Yjs document, undo, the binding into the store, server sync
  pages/      sign-in, dashboard, board, and the signed-out local board
  router/     three routes over the History API
  export/     PNG, SVG and PDF writers
  ink/        freehand sampling, straightening, simplifying, erasing
  input/      pointer state machine and keyboard shortcuts
  laser/      the ephemeral pointer trail — never saved
  media/      image import, downsampling and the decode cache
  model/      elements, bounds, transforms, hit-testing, z-order
  snapping/   alignment guides and equal-spacing detection
  scene/      demo content for the renderer panel
  state/      the board store
  ui/         React components: top bar, canvas stage, panels
  styles/     design tokens and global CSS
shared/       types used by both the app and the Worker
worker/       Cloudflare Worker: auth, API routes, and BoardRoom (one per board)
migrations/   D1 schema
tests/
  unit/       Vitest
  e2e/        Playwright
```

Directories for `tools/` and `model/` arrive with the phases that need them.

## Shortcuts

| Keys                       | Action                             |
| -------------------------- | ---------------------------------- |
| `V` / `H`                  | Select tool / hand tool            |
| Hold `Space`               | Temporary hand tool                |
| Scroll                     | Pan · `Shift`+scroll pans sideways |
| `⌘`/`Ctrl` + scroll, pinch | Zoom toward the pointer            |
| `+` / `−`                  | Zoom in / out                      |
| `Shift 0` / `Shift 1`      | Zoom to 100% / zoom to fit         |
| `Shift 2`                  | Zoom to selection (Phase 2)        |

Shortcuts match on physical key position, so they work on any keyboard layout.

## The document

Board content lives in a [Yjs](https://yjs.dev) document rather than in component
state. Each element is its own map, so two people editing different fields of the
same shape both keep their change. Undo is scoped to this tab's origin, which is what
makes `⌘Z` walk back your own edits and leave everyone else's alone — the same
mechanism that carries into real-time collaboration in Phase 7.

Two things deliberately stay **out** of the shared document:

- **The camera.** Where you are looking is personal; putting it in the document would
  drag collaborators around after each other. It goes in `localStorage`.
- **The laser trail.** Ephemeral by definition — never saved, never undoable.

Boards persist to IndexedDB, so the app keeps working with the network down. It has no
service worker yet, so a _reload_ while offline will not load the app itself; that
arrives with the rest of the offline work in Phase 18.

## Collaboration

Each board has a room: a Cloudflare Durable Object that holds the live document, every
open socket, and — in its own SQLite storage — an append-only log of every change plus
periodic snapshots. Browsers talk to it over one WebSocket (`shared/collab.ts` is the
protocol). On every connect, the browser and the room swap state vectors and send each
other whatever the other is missing, which is how offline work merges: there is no
separate queue to replay.

Presence — pointers, selections, the laser, cursor chat, who is presenting — goes
through the same socket but is never stored. Version history is read straight from the
room's log; restoring is a new change, so nothing after it is lost. Sockets use the
hibernation API, so an idle board costs nothing and wakes on the next message.

A window that loses its connection without saying goodbye would otherwise linger as a
second copy of its person. Each page sends an id of its own with its handshake, and a
page that connects again replaces its earlier socket. A socket that has not pinged for
three minutes (a closed laptop, a lost network) is dropped the next time anyone on the
board does anything.

`/` opens cursor chat; clicking someone's avatar follows their view.

## Sharing

A board or folder is private until its owner shares it. The share dialog offers a link —
for anyone who has it, anyone signed in, or anyone at one email domain; to view, comment
or edit; optionally expiring — and named Google accounts by email. Sharing a folder
covers every board inside it, including ones added later, and a board can override what
it inherits. One rule decides access everywhere (`worker/access.ts`), and the board's
room enforces it: a viewer's edits are refused by the server, not just hidden in the
interface. Turning a link off, or removing someone, drops them from an open board within
seconds.

Also here: comment threads pinned to the board with @mentions, in-app notifications,
a switch for whether viewers may export, handing a board to another owner, and a log of
every sharing change.

## Workshop tools and rich content

The board's top bar holds undo and redo, the everyday tools (select, hand, pen,
highlighter, eraser, laser) and two menus. **Insert** (orange) has shapes, lines and arrows, sticky
notes, ABC Text, frames, tables, stamps (the emoji becomes the pointer; each click puts
one down; Escape puts it away), Import (pictures, SVG, PDF), and the workshop: present,
timer, dot voting, and the minimap (also `M`). **Tools** has version history,
comments, the library and the object list. One bar at the bottom holds pages, the side
panel, the minimap and zoom, and folds down to a single button. The side panel opens
only from that bar and closes with its ×. All of these choices are remembered per
browser in `sabboura:ui`. On a phone the tools take their own row and menus open as
sheets above the bottom bar.

Writing and drawing:

- **Text boxes** are dragged out to a size, or clicked for a 55-character by 8-line box
  of 40px type; they grow as they fill. One click selects, a double click edits.
  Pasted text from anywhere becomes a text box.
- **Formatting part of a text**: select words and press Ctrl/⌘ B, I or U, or use the
  side panel, which also gives the words a colour or a highlight; with nothing
  selected, it applies to what is typed next. Not typing, the panel's colour and
  highlight apply to the whole box. Nothing floats over the box being typed in, and
  nothing is laid over the board under it; the mouse wheel over it moves the board. It is stored as formatting on
  the shared `Y.Text` (`element.marks` in the app, `src/text/marks.ts`), so it moves
  with the words as anyone types. Text is edited in a `contenteditable` box
  (`src/ui/RichTextEditor.tsx`, `src/text/domText.ts`); code blocks keep a plain
  textarea.
- **Links on words**: select words and press Ctrl/⌘ K (or the panel's link button) and
  type an address in the panel — Ctrl/⌘ K opens the panel if it is shut — or paste an
  address over them. Only web and email addresses are taken
  (`normaliseLink`). Typing straight after a link is not linked. On the board a link
  shows its address on hover and opens with Ctrl/⌘-click (a plain click still selects,
  so linked text can be moved); for someone who can only view, a click opens it.
- **A text box's fill** paints a box behind its words; the side panel adds pale fills
  that deepen on a dark board.
- **Pictures** pasted, dropped or imported are sized by their shape against the
  screen's height at 58% zoom: near square (up to 1.5 times as wide as tall) or tall,
  half that height; clearly wide (up to 3 times), a sixth; wider still, a ninth
  (`pictureBox` in `src/media/images.ts`).
- **Picking up another tool** puts the selection down.
- **The right-click menu** has copy, paste (which reads the clipboard, and may ask
  first), duplicate, delete, lock, unlock, group, ungroup and the side panel, and
  turns left or up near an edge so none of it is off the board.
- **A video that was played** has a strip along its top that the board answers to:
  press it to select the video, drag it to move. A press anywhere on the board takes
  the keyboard back from the player, so Delete works again.
- **Celebrations** (Insert → Celebrate, or C, D, O, M, Q, U, A while presenting):
  confetti, drum roll, bubbles, mic drop, quiet, curtain call and applause, for
  everyone on the board at once (`src/fun/`). Sounds are synthesised with Web Audio,
  and can be muted.
- **Lists** are written into the text ("• " or "1. "), word-processor style: Enter
  continues the list, Enter on an empty item ends it, Shift+Enter breaks a line
  inside an item, Backspace after a marker removes it, "- " starts bullets, and a
  changed number carries through the items after it (`src/text/lists.ts`).
- **Ink** follows a stylus's pressure, or a mouse's speed, and is drawn as curves
  rather than segments, from every pointer sample. Pens come in 1.5, 3, 6 and 12.
  Holding Shift draws a straight line, pulled exactly level or upright when it is
  within 12° of either (`snapLevel` in `src/ink/stroke.ts`).
- **The highlighter** (`I`) draws a wide, even, flat-ended band in one of six
  highlighter colours. On a light board it multiplies with what is under it, so words
  stay black under it; on a dark board it is simply see-through.
- **Smart shapes**: hold Ctrl (⌘) while drawing a closed outline and it becomes a
  rectangle, square, triangle, circle, oval, cloud or spike on lifting the pen
  (`src/ink/recognize.ts`); anything else stays ink. Clouds and spikes are in Insert
  too. Any shape can hold words: double-click it.
- **The side panel** arranges a selection in a row or a column, scrolls when long, and
  keeps position and size folded away at its foot.

Following someone fits their whole view on your screen, whatever its size, and a thin
frame in their colour says you are following. Clicking an avatar opens a card: whether
they are following you (an eye on their avatar says the same), follow or stop, and
"Show their screen edges", which outlines their screen on your board so you can keep
within it while presenting.

- **Pages.** A board has pages along the bottom; each keeps its own content and its
  own camera. Elements carry a `page` field — absent means the first page, so every
  board from before pages still opens unchanged.
- **Presentation.** Workshop → Present frames. Frames play in reading order (rows top
  to bottom, left to right in a row); arrow keys, Space and Page Up/Down move, Escape
  leaves. Presenting is spotlighting: everyone else on the board follows, and each
  follower's screen fits the same frame.
- **Timer and dot voting.** The timer takes any length in minutes and seconds and offers
  the last four used. Both live in the board's document but outside the
  element map, so they are shared, survive a reload, and are not undoable. The timer
  counts to an instant on the room's clock (the welcome message carries it), so every
  screen ends together. Each tab writes its own ballot, so nobody's dots overwrite
  anybody else's; the budget is per person.
- **Tables and stamps** from the Insert menu. Table cells are separate entries, so two
  people typing in different cells both keep what they typed. Code blocks were taken
  out of the menu at the user's request; ones already on a board still draw
  highlighted and edit as plain text.
- **Links.** A pasted YouTube link becomes a video that plays in place
  (youtube-nocookie); any other link becomes a card, filled in by `/api/unfurl`, which
  fetches the page from the Worker, refuses private addresses, and reads Open Graph.
- **Library.** Save the selection (with everything inside it) under a name, then click
  or drag it onto any board. Kept in D1 per account (`library_items`); images in a
  library item are protected from the trash sweep by `library_files`. Signed out, the
  library is this browser's own.
- **Import.** SVG becomes editable shapes — rectangles, ellipses, lines and text map
  across, paths become ink along their outline (a path's fill is not kept), gradients
  and filters are dropped, and nothing in the file runs. PDF becomes one stored picture
  per page (up to 50), drawn by PDF.js, which loads only when a PDF is imported.

## Accounts and storage

Signing in is Firebase (Google); every request carries that ID token and the Worker
verifies it against Google's published keys, pinning the audience and issuer. Nothing
is trusted from the browser — a board belongs to the account that owns the row.

| Where        | What                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| D1           | users, folders, boards — anything that has to be queried                 |
| R2           | each board's Yjs snapshot and its thumbnail                              |
| IndexedDB    | the same board locally, so it opens instantly and survives going offline |
| localStorage | the camera, which is personal rather than shared                         |

**A build with no Firebase project configured is still a whiteboard.** It falls back
to a single local board saved in the browser, which is what the published preview
shows. Set `VITE_FIREBASE_*` (see `.env.example`) to turn accounts on.

### Running the backend locally

```bash
npm run build
node scripts/test-backend.mjs   # Worker + local D1 + R2 on :8788
```

That script also serves a JWKS and mints tokens on `:8799`, so the end-to-end tests
exercise the real verification path — same code, different key owner — rather than a
bypass of it.

## Architecture

One Cloudflare Worker serves the app, the API and the sync server:

```
Browser
  │  static assets (free, unmetered)
  │  REST calls   ──►  Worker  ──►  D1        folders, boards, sharing
  │  image reads  ──►  Worker  ──►  R2        cached at the edge
  └─ WebSocket    ──►  Worker  ──►  Durable Object "board:<id>"
                                     ├─ Yjs document in memory
                                     ├─ SQLite: update log + snapshots
                                     └─ every open socket for this board
```

## Theming

Three states, handled at the token level in `src/styles/tokens.css`: light on bare
`:root`, dark under `prefers-color-scheme` (guarded so an explicit light choice wins),
and dark again under `[data-theme="dark"]`. Components only ever read tokens.
