# Sabboura — handbook for coding agents

A collaborative infinite whiteboard for the browser, used by a teacher with classes:
boards, sharing, live collaboration, presenting, classroom roles. Built in phases; each
phase ends with something the user checks themselves against a written checklist.

This file is the one source of notes for any coding agent (Codex reads `AGENTS.md`;
Claude Code reads `CLAUDE.md`, which only imports this file). **Read it all before
changing anything**, then `README.md` (phase table, architecture, run and deploy) and
`docs/plan.html` (every phase's checklist; open it in a browser). `git log` is the
other source of truth: each phase is one commit whose message says what it added and
what it fixed.

## Start here

**Live:** <https://sabboura.read4more.com>. The old address,
<https://sabboura.mh-hamad.workers.dev>, sends page visits there (a permanent
redirect; its `/api/` still answers, for tabs left open).

**State (27 November 2026):** every planned phase, 0–18, is built, tested and deployed.
The user has checked Phases 0–5 and 7 against their lists; 6 and 8–18 are deployed and
not yet checked by them. What is left of the plan:

- Phase 18, item 5: the user looks at Cloudflare's and Firebase's usage after a week of
  real use (from 27 November) to confirm everything sits inside the free plans.
- The user checking the built phases against `docs/plan.html`. Expect bug reports from
  that; fix them as they come.

**Parked by the user** (only when asked): Arabic and right-to-left text; dark mode, high
contrast, reduced motion; onboarding; empty and error screens; an accessibility audit;
student picture uploads; anything on read4more.com itself; "see the stroke before it
ends"; Chrome zoom; the owner undoing a collaborator's steps; opening the app offline
after a reload (no service worker). Not built from the original Phase 9: LaTeX,
`.excalidraw` import, emoji reactions.

### Accounts, ownership and access

Everything belongs to the user; agents only hold a deploy key.

- **Cloudflare** (free plan; the user's account): the Worker `sabboura`, the D1
  database `sabboura`, the R2 bucket `sabboura-files`, the Durable Object class
  `BoardRoom`, three rate-limit bindings, and the zone **read4more.com** (the user's own
  domain, bought from a registrar; its DNS is on this account). `sabboura.read4more.com`
  is a Workers custom domain (`routes` in `wrangler.toml`). The old address is
  `<worker name>.<account's workers.dev subdomain>`: renaming the Worker, renaming the
  subdomain or moving to another Cloudflare account ends it for good. read4more.com's
  own site is the user's and is not touched.
- **Firebase** project `r4m-whiteboard`: Google sign-in only. Its authorised domains
  must list `sabboura.read4more.com` and `sabboura.mh-hamad.workers.dev` (both done).
  The web config is public and lives in `.env.example`.
- **GitHub** repository `m0hmma0/calculator-app-mohammad`; CI runs `.github/workflows/ci.yml`
  (format, lint, types, unit, both Playwright projects) on every push.
- **Deploy key:** `CLOUDFLARE_API_TOKEN`, held as an environment secret of the agent's
  environment, never in the repository or in chat. It can deploy the Worker, D1, R2 and
  the custom domain; it cannot read the zone's DNS records. If an agent has no token,
  hand the user the commands instead. **Never ask for a token, key or password in chat;
  direct the user to their environment's secrets.**
- Builds read `.env` (gitignored): `cp .env.example .env` first, or the bundle falls
  back to the signed-out, single local board.
- Claude-only extras the user may mention: a published preview of the signed-out
  build and the plan as pages on claude.ai (private to the user). Other agents cannot
  open them; `docs/plan.html` is the plan, kept in step by hand.

### How the user wants work done

- **Branch:** develop on `claude/collaborative-whiteboard-app-hqkq5u`. Never push to
  `main`; open a pull request only when asked.
- **"The faster way"** (agreed 26 November): run `npm run check` and the Playwright
  specs that touch the change locally, commit, push, **deploy at once**
  (`npm run deploy`; apply any new migration remotely first), then look at CI on GitHub
  afterwards and fix and redeploy if it fails for a real reason. Known noise, not real
  failures: the local test server dying mid-suite (see below), and document.spec
  "survives the tab being closed part-way through" (flaky, about 1 run in 6).
- One commit per phase or per request, its message saying what was added, what was
  fixed and how it was tested.
- Before building a large request, show a short plan and wait for the go-ahead (the
  user asked for that for the mobile and presenting list); small fixes go straight in.
- Ask when a choice is really theirs (a name, an address, which of two behaviours);
  otherwise decide and say what was decided.
- Report honestly: what failed, what was skipped, what could not be verified (the
  live site, for one, cannot be opened from Claude's cloud container). The user is not
  a developer: answer in plain words, with what they need to click or check.
- Keep `docs/plan.html` and this file up to date with each change worth knowing.
- Tell them what a change costs on the free plan before adding anything that writes
  or sends per change (see "The account is on Cloudflare's free plan" below).

### Tooling notes per agent

- Any agent: Node 22+, `npm ci`, then the commands below. End-to-end tests need a
  Chromium that matches the pinned Playwright (`npx playwright install chromium`).
- Claude Code's cloud container: Chromium is pre-installed but older than the pinned
  Playwright, so pass `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`; its
  proxy blocks `*.workers.dev` and read4more.com, so the live site cannot be fetched
  from there (`npx wrangler deployments list` confirms a deploy).

## What each phase built

Short histories of the parts most worth knowing before touching them. The phase list
itself is in README.md.

Phase 9 in one paragraph: pages (`element.page`, absent = first page; removed on 20
November — see below), presentation (`src/workshop/presentation.ts`, followers fit the
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

Presenter view (11 November, asked for after Phase 16): while presenting, "Presenter
view" (slide controls, or Insert) opens an audience window — this app at the same
address plus `#audience=<channel>` (`src/workshop/audienceMode.ts`; `main.tsx` renders
`AudienceView` instead of `App`). It has no room, account or storage: the presenter's
window (`src/workshop/audience.ts`) feeds it over a BroadcastChannel — the whole Yjs
document on `hello`, then each update; the page, frame and started site players; laser
trails as ages (the windows' clocks differ); and play/pause/seek of video and sound
files (`data-element-id` on the media element). The audience window draws the slide
fitted edge to edge, nothing is pressable there but other sites' iframes, double-click
or F fills the screen, and the pointer hides. While it is open the presenter's own files
and celebration sounds are muted (heard there; if that window may not play sound
unasked, it plays muted and tells the presenter's copy to play aloud: `heardHere`), and
site players show "Playing in the audience window". Exit closes it; closing it keeps
presenting. The presenter's side gets `PresenterNotes` along the bottom (the slide fits
above: `notesInset`): slide n of m, next, a clock, and the frame's notes —
`element.notes`, a document field, so anyone with the board's data could read them,
though only presenter view shows them. Presenting keys ignore text fields now
(`isTypingTarget`). Shortcut `present.audience`, no default key. No migration, no
server cost.

Recording presenter view (11 November, redone the same day after the user's first
try: smeared video after the first frame, the camera behind a video, a small picture):
the notes strip has a recording row (`src/ui/RecordControls.tsx`) — Camera, Microphone
and Slides' sound switches, the camera's shape (circle, rounded square, wide), Size
(1080p or 720p, remembered), and Record / Pause / Stop, with "Recording 1920×1080 from a
W×H window" (amber when the window is smaller: make it full screen). The camera
(`src/recording/camera.ts`) is opened in the presenter's window and its stream handed to
the audience window directly (`window.sabbouraAudience.setCamera`, same origin — a
stream cannot go over a channel); its place is fractions of the slide (`CameraLayout`,
localStorage, sent in the `state` message), dragged and sized on the presenter's slide
(`PresenterCamera`), and it sits over the embed layer (z-index 10 in the audience
window; the embed layer is 1 — it used to sit under videos). Recording
(`src/recording/recorder.ts`) asks for a tab (`getDisplayMedia`, the audience tab and
its sound), routes the slides' sound and the microphone through Web Audio as three
continuous tracks (mix, mic, slides), and hands the picture and those tracks as
`MediaStreamTrackProcessor` streams to a worker (`encodeWorker.ts`, `?worker&inline`).
The worker fits each tab picture into exactly 1280×720 or 1920×1080 on the dark
surround, encodes at a steady 30 fps (repeating an unchanged picture) with WebCodecs
H.264, a key frame every 2 s, and each sound as AAC (Opus where there is no AAC
encoder, as on Linux Chromium); at Stop it writes with mediabunny: video with sound and
video alone as MP4 (index at the front), each sound as M4A or OGG. Chrome's own
MediaRecorder MP4 (fragmented, one key frame) was what smeared in the user's player. A
tab is recorded at its on-screen size — Chrome does not render it larger when asked —
so a small audience window gives a soft 1080p. Files stay in the window
(`RecordingResult`: five downloads and "Download all"; `beforeunload` warns); nothing
goes to the server. The audience window sets a capture handle, but Chromium does not
report it back, so the check is "a tab, and the handle if there is one". Tests
(recording.spec): `--use-fake-ui-for-media-stream` makes Chromium record the wrong tab —
use context `permissions` and `--auto-select-tab-capture-source-by-title=slides`; the
audience window is made 2:1 so the frames' dark bands prove which tab was recorded;
ffprobe/ffmpeg, where installed (this container has them; the test skips that part otherwise), decode every frame and check
codecs, size and key frames. `elementsFromPoint` skips `pointer-events: none`, which is
everything in the audience window. Playwright's headless shell (what CI runs by default) has no camera,
microphone or tab recording, so recording.spec asks for `channel: 'chromium'` (the full
browser, headless) unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE` is set; reproduce with
`/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`.

Presenting, 11 November, third round: Space plays and pauses the slide's video or sound
files (`present.media`, presenting scope; `toggleSlideMedia` in `src/workshop/slideMedia.ts`
— media whose centre is in the frame, the last played or the first by reading order;
other sites' players cannot be reached) and is no longer one of Next frame's keys.
Presenter view has big previous/next buttons either side of the slide (`SlideArrows` in
`WorkshopLayer.tsx`; the slide is fitted between them, `ARROW_ROOM` in `show()`) and the
next slide drawn beside the notes (`NextSlide` in `PresenterNotes.tsx`, the board's own
renderer). A video full screen gets the pointer and keys: `.screen:fullscreen` restores
`pointer-events` (the card's `none` was inherited), and `mediaFullScreen()` keeps the
board's keys and pointer handler out. Frame transitions: `element.transition` (a document
field; "" or absent is none), chosen in the side panel for selected frames
(`TransitionPicker`, tiles with a live preview on hover); seven effects in
`src/workshop/transitions.ts` — shatter, portal, glitch, pixels, warp, blinds, ink — each a
`makePlayer(kind, from, to, seed)` drawn at t in 0..1, seeded by the frame so every screen
plays the same. `SlideTransition` (over the board, z-index 2) plays it in the presenter's
stage, the audience window and followers' screens: it watches `frameOnShowId()`, copies the
board canvas before it redraws (the old slide), waits `SETTLE_FRAMES` and copies again (the
new one); `usePresentation.transitioning` hides the embed layer meanwhile. Reduced motion
gets a cross-fade. Not into a presentation's first slide, nor out of one.

Web pages (11 November): a lesson page — one HTML file, its CSS and JS inside — is a code
box with `language: 'html'` and `webView: true` (`isWebPage`, `src/webpage/pageStore.ts`);
its HTML is the element's `text`, so it lives in the board (2 MB cap on import). In:
Insert → Web page (empty, editor open to paste; `insertWebPage`), Import or drop an
.html file (`importWebPage`: 1280×800, selected and zoomed to). A Code / Web switch and
the page's other controls sit above it (`PageBar` in `src/ui/WebPages.tsx`, rendered
inside the embed layer so slide clips and transitions apply). The page runs in an iframe
with `srcdoc` and `sandbox` without `allow-same-origin` — an opaque origin, cut off from
the board, its sign-in and its storage (webpages.spec proves it) — laid out in board
units and scaled. `src/webpage/shim.ts` goes first in its head: Math.random seeded by
the element id (every copy shuffles alike), localStorage/sessionStorage in memory, and
a recorder of trusted clicks (not on form fields), input/change, keys outside fields,
drags (pointer down/move/up) and scrolls, sent to the board by postMessage; it replays
logs it is sent, each event when its target exists (3 s at most). Logs are per page and
person in the root map `pageLogs` (`shared/pageLogs.ts`, key `<page>|<uid>`, never a map
per page: two first writers would overwrite each other), written with `PAGE_ORIGIN`
(not undoable), capped at 4,000 entries. A page shows: the presenter's log in the
audience window (`forcedViewer`, from the state message's `person`), the leader's while
`element.lead` is someone else, someone watched (`watchPage`, the teacher's "Watch…"),
or one's own — replayed on open, which is how progress is remembered across devices.
"Start over" deletes one's own log. The Answer role may write only its own logs:
`isOnlyAnswers(doc, update, uid)` allows a list under its own key and small plain
entries in it, nothing else (unit tests in answers.test.ts; the class test in
workshop.spec fails when the room is not told who sent the change). Viewers use pages
unsaved. Playwright's clicks inside a scaled frame miss: tests click at the screen
position (`clickIn`). The canvas draws a card with the page's title under the frame
(thumbnails, transitions). Fill box (12 November): a page written as one fixed-size card (a single
visible child of body whose declared width or height is in px, found through the
style sheets) is stretched to the whole box by the page script (`FILL`, `fill()`):
html/body to 100% with no margin, the card to 100% — so the box is the page, and
dragging the box gives the page room. "Fill box" in the bar turns it off
(`element.asWritten`). A page that flows already is left alone. Same day, asked for: no "Use
page" — a page takes the pointer whenever the select tool is in hand (anyone below
editor: any tool but the laser), and any other tool draws on the board over it;
the board keeps a 10 px edge band and the boxes of non-stroke items lying over the
page (`.edge` divs, `itemsOver`) for selecting and moving. Code / Web is in the
right-click menu (`menu-web-view`), Fill the box in the side panel's code section
(`web-page-fill`, a checkbox). Everything stacked above the lowest web page, the
stroke being drawn, the selection and the laser are drawn on a second canvas over
the embed layer (`board-over`, `data-board-over`; the audience window has one too,
and transitions copy it with the board), so they show on top of pages. Pixel helpers
in content.spec and collab.spec read both canvases. Keys and the wheel (12 November): the page script passes on a
key the page did not take (not typed into a field, not `preventDefault`ed by the page —
checked a tick later) as `{sabboura: 'key'}`, and `handOnKey` dispatches it on the board's
window, so shortcuts work while the page has focus; Escape in a field blurs it. A wheel
turn goes to the page while something under the pointer can still scroll that way
(`canScroll`), else (and always with Ctrl/⌘) to the board as a synthetic wheel event on
the stage at the same screen point (`handOnWheel`). Same day: the canvas over the live layer now takes
what is stacked above any embed too (`isLiveLayer`: web pages, videos, sounds, players),
so ink drawn on a video stays on top of it. A playing video pauses on a click on its
picture (`media-tap`, only with the select or hand tool, so a pen draws over it). A
frame is picked by its title as well (`frameTitleBox`, passed `zoom` in `PickOptions`
by the select tool and its hover).

Recordings that cannot be lost (12 November): the encoding worker writes every encoded
piece to the browser's private disk (OPFS, `src/recording/storage.ts`:
`recordings/<id>/` with `meta.json`, `video.bin`/`.json`, `sound-<name>.bin`/`.json`;
a .bin is 21-byte heads plus data) through sync access handles, flushed every second
(`stored` messages: the row shows "safe on disk m:ss"). The files are made from disk
— at Stop, or by `{t: 'recover'}` — into `out/`, MP4 with the index at the end
(`fastStart: false`, written through a `StreamTarget`, never all in memory), and read
back as disk-backed `File`s. A Web Lock (`holdRecording`) marks a recording this tab is
making or showing; `unsavedRecordings()` lists the rest, and `RecoveryNotice`
(mounted with `RecordingResult` at the app's root, in `main.tsx`) offers them:
Recover or Delete. Closing the result dialog deletes the disk copy only if the files
were downloaded or saved to the folder; otherwise it is kept and offered again
(`putAwayRecording`); Delete removes it. The folder (`src/recording/folder.ts`):
`showDirectoryPicker`, the handle kept in IndexedDB (`sabboura-recording`), permission
asked on the Stop or Recover click; files written there after they are made
(`saveToRecordingFolder`, "Name (2).mp4" when taken). `navigator.storage.persist()` at
Record; the row shows the room left (`recordingSpace`), amber under 2 GB. A full disk
(`{t: 'full'}`) stops the recording and keeps what there is. Tests close the tab
mid-recording (`page.close({ runBeforeUnload: false })`) and recover it in a new page —
they wait for `record-stored` first: under load nothing may reach the disk in the
first seconds. The folder test stands an OPFS folder in for the picker.

Phase 17a (20 November; the user's mobile and presenting list became 17a, 17b and 17c,
and keyboard use of the canvas moved after them): pages are gone. `dropExtraPages`
(`src/doc/board.ts`) keeps the page list's first page, makes its things plain, deletes
the rest and empties the list, as `SYSTEM_ORIGIN` (not undoable, sent to the room); the
store's `dropOldPages` runs it when the stored copy is in and again at the room's first
sync, and it does nothing on a read-only board. The store still has `page`/`setPage`,
and history still replays an old step's page list, for boards nobody has edited since.
`PresentButton` (owner only, hidden while presenting, disabled without frames) sits
where the page tabs were and keeps the test id `present-start`; Insert has neither it
nor Presenter view, which opens from the slide controls (`presenter-view`). The
spotlight button reads "Follow me" / "Stop follow me".

Phase 17b (20 November): presenting on a phone, the hand and the laser. While a slide
is on show, every change of view goes through `setViewportGuard(guardSlide)` in the
store (set at `startPresentation`, cleared at stop): `keepOnSlide` never lets the zoom
go below the slide's fitted size (`fittedView`, which `show` also uses) and, zoomed in,
keeps the view inside the frame (a side narrower than the screen stays centred). A
hand drag that ends at the fitted size calls `swipeSlides` (50 px, mostly across).
Laser points carry `mark` (a press starts one, a release ends it; `laserMarks` splits
them, `renderLaser` draws each alone), sent as `m` in presence and `mark` to the
audience window; `INK_TRAIL_MS` is 1500; `show` clears the laser when the frame
changes. Transitions are drawn at `TRANSITION_DENSITY` (1.25 picture pixels to a screen
pixel) and shatter cuts its shards once, ahead: at a 6× slower CPU, 14–45 frames per
effect instead of 5–24. `FrameSizePicker` (side panel, frames): This screen,
phones both ways (19.5:9), laptops 16:9 and 16:10, keeping the corner and the area
(`src/workshop/frameSizes.ts`). The presenting bar is one row (`data-presenting`:
nowrap, scrolls; the squeeze aims for one row by overflow); along the bottom of a
phone the slide bar takes the width with 48 px arrows. The browser's own "drag from
the top to exit full screen" notice cannot be changed by a page.

Phase 17c (20 November): presenter view and a remote control. **Remote control**
(`src/workshop/remote.ts`, `src/pages/RemoteView.tsx`): while presenting, "Remote
control" (slide controls; `RemoteControlButton`, a QR code by `qrcode-generator`) makes
a link — this page plus `#remote=<key>` and, with a room, `&b=<board>` (`remoteMode.ts`;
`main.tsx` renders `RemoteView`). With a room, the presenter sends `remote-open` (owner
only; the room keeps `remoteKey`, `remoteUid`, `remoteTab` in its meta table), and a
remote authenticates with `{t:'auth', token:'', remote: key}`: the room lets it in as a
viewer of the document (`attachment.remote`), never a peer (no join/leave, no presence
to or from it, skipped by `reauthorize`), passes its `remote` actions to the presenter's
sockets and the presenter's `remote-state` (frame, since) to it. A wrong key, or a
presentation that ended (`remote-close` at `stopPresentation` → `closeRemote`), is
refused for good (4401); a presenter momentarily disconnected is `waiting` (4409, the
remote retries). On the signed-out board a BroadcastChannel (`sabboura-remote-<key>`)
carries the document and the same messages, so the remote must be another tab of this
browser. Link only, no sign-in (agreed): it can read the board, notes included, and move
the slides; nothing else. **Presenter view**: Record, Stamps and Celebrations switches
(`uiPrefs.presenterRecord` etc., all off at first; recording is never hidden while it
runs — tests turn `presenter-show-record` on first); a divider (`presenter-divider`,
`uiPrefs.notesShare`); on a short landscape stage (a phone on its side) the notes go
down the right (`notesSide`, `slideArea` in presentation.ts); `BAR_ROOM` keeps the slide
clear of the slide controls along the bottom; the head row is one row (icons and
"Close" on narrow screens); notes keep their scroll per slide (`useNotesScroll`), and
the wheel scrolls them (the panel is no longer `data-wheel-pans`). `SlidePicture` draws a
slide for presenter view's next slide and the remote. The audience window has a
full-screen button (`audience-fullscreen`), only before full screen and while the
pointer moves. Not done: one row for the slide controls in the 112 px pane (the pane is
too narrow; on phones they are one row since 17b).

Phase 17d (26 November): the board without a mouse. The stage is focusable
(`tabIndex=0`, `role="application"`, a ring inside its edge). With the focus on it,
Tab and Shift+Tab select the next or previous item in reading order (`readingOrder` in
`src/input/keyboardBoard.ts`: top-level, not hidden; across a row, then down) and bring
it into view; past either end Tab clears the selection and goes on to the next
control, so nothing traps the focus. Enter is a shortcut (`place-or-type` in ACTIONS):
with a shape, frame, note or text tool it puts one in the middle of the view (notes and
text open for typing), and with one item selected it types into it as a double-click
would; it does nothing while the focus is on a control (`boardHasKeys`). Typing begun
from the keyboard gives the focus back to the board when it ends (`takeRefocusBoard`).
`BoardAnnouncer` says the selection aloud ("Rectangle: Start, 1 of 2"; test id
`board-announce`). Off the board: the dashboard's search box had its ring switched off,
and the share dialog did not take the focus; the dialog now does, and gives it back to
the button that opened it. `focus.spec` tabs round the dashboard, Settings and the
share dialog and checks every stop has a ring (outline or box-shadow). The command
palette's field and cursor chat keep `outline: none` (the caret, and an accent border,
show their focus).

Watching full screen (26 November, asked for after 17d): someone following a presenter
gets `WatchPrompt` at the top of their board ("Ana is presenting — Watch full screen",
`watch-prompt`, `watch-fullscreen`, `watch-dismiss`). Watching (`src/workshop/watching.ts`)
sets `html[data-watching]` and asks for the browser's full screen (it needs the press);
CSS hides everything marked `data-watch-hide` (the controls), the stage's
`data-present-hide` children and the following frame, so the slide is alone. Leaving full
screen, or the presentation ending, ends it; where a page cannot go full screen (an
iPhone) a small Exit shows instead. A follower now refits the presenter's frame when its
own stage changes size (`startFollowing` in publish.ts), which full screen needs.

Slides link (26 November, asked for: "share the audience window"): while presenting,
"Share slides" (`ShareSlidesButton`, beside Remote control; test ids `watch-link-*`) gives
a second link, `#watch=<key>` (+ `&b=<board>`), made together with the remote control's
(`openLinks` in remote.ts; `remote-open` now carries `watch`, kept as `watchKey` in the
room's meta). `main.tsx` renders `AudienceView` with `link` for it: the audience window
fed from the room (a `RoomConnection` with the key, the slide from `remote-state`) or, on
the signed-out board, from the presenter's tab over `sabboura-remote-<key>`. The room
lets it in like a remote but `watchOnly`: every message from it is ignored. It ends with
the presentation, like the remote. Since the same day: a key the room does not know is told to wait
(`waiting`, 4409, the link keeps trying), since it may be a link made while the
presenter's page was reconnecting; only a key from a presentation that ended (the room
keeps the last 12 in `endedKeys`) is refused for good (`ended`, 4410). Opening either
dialog sends `remote-open` again. On the signed-out board the dialogs say the link works
only in this browser's other tabs (`*-local`), never another device or a private
window. It plays the presenter's video and sound files along (`watchMedia` in
`src/workshop/showFeed.ts`: play, pause, seek and the time each second, sent as
`remote-media` through the room to slides links only, or `media` on the channel) and
shows the laser (with a room, the room passes the presenter's presence to slides links,
and the presenter sends presence while `room.watched`, set when a link says hello;
without one, `watchLaser` frames on the channel). A screen not allowed to play sound
unasked plays muted and shows "Tap for sound" (`audience-sound`).

Presenting fixes (26 November, evening): `presenter()` in presence.ts never picks one's
own account (another window or device of the same signed-in person is left free to
edit; guests excepted), so spotlight tests use two people (`twoWindows(..., true)` in
collab.spec and workshop.spec). "Follow me" is on the slide controls while presenting
(`FollowMeToggle`, `present-follow-me`), presenter view included. Watching full screen
fits the slide with no padding (`useWatching` in the follower's fit), as the audience
window does.

Co-owner (26 November, migration 0008, applied remotely): a sixth role, `coowner`,
between editor and owner (`RANK` in access.ts), for boards and folders, given to named
people only (`LINK_ROLES` leaves it out of links). `actsAsOwner` (shared/sharing.ts) is
what `selectIsOwner`, `lockedForMe`, `mayLockForOthers` and the Present shortcut now ask:
a co-owner presents, uses Follow me, the remote and slides links (the room's
`remote-open`/`remote-close` take `atLeast(role, 'coowner')`), has the minimap, locks for
others and is not held by such locks, and opens Share; `ownedResource` in
routes/sharing.ts lets them manage people, the link and export. Kept for the owner:
`transferBoard` (`ownerOnly`), and everything tied to the owner's workspace (rename,
move, archive, trash — those queries match `owner_id`). The board's badge reads
"Co-owner".

On me (27 November): the spotlight is "On me" / "On you · n/m" (`spotlight`,
`follower-count` shows only "1/2"), and it is forced: `presenter()` ignores
`dismissedSpotlight` and `leaderSession` puts it before a chosen follow, the card's
"Follow their view" is disabled ("On them"), and a follower who zooms keeps following —
`startFollowing` keeps their own view (`ownView`) until the leader's frame or view
changes (a `key` of leader, frame or view, stage size, watching) or they are put "On me"
again. One person can be put "On me" from their card (`peer-summon`; `summoned` in the
presence store and `PresenceState.summoned`). The people bar shows while presenting too;
`FollowMeToggle` is gone. An owner (or co-owner) does not see their own other windows —
avatars or cursors (`isMyOtherWindow`); other people's two windows still show twice, so
spotlight and avatar tests use two people (collab.spec's `twoWindows` defaults to two).
Pointers still for `CURSOR_IDLE_MS` (2 s) hide (`cursorAt` per peer). Presenting is a
badge on the avatar (`peer-presenting`). A lock for others holds co-owners; only the
owner sets it (`mayLockForOthers`, and the right-click menu's `realOwner`). Locked items
keep the plain cursor. The audience window and slides links zoom (wheel, pinch, drag
while zoomed; `keepOnSlide`), reset at each new slide. Known flaky, before this too:
document.spec "survives the tab being closed part-way through" (about 1 run in 6 here).

Phase 18 (27 November): hardening. The first sync goes to pages that say `zip` in the
handshake as `SYNC_STEP2_V2` (Yjs's second encoding), and any frame over 32 kB as a
deflated `ZIP` frame (fflate; `zipFrame`/`unzipFrame`) — 5,000 shapes are 0.27 MB on the
wire, not 4. Element ids carry a random part per page (`PAGE_PART` in element.ts):
`<type>_<time>_<counter>` collided when two windows drew in the same millisecond, and
one shape replaced the other everywhere. Errors from browsers (`src/errors/report.ts`,
`ErrorBoundary`) go to `POST /api/errors` (no auth, before the token check) and become
`browser-error` lines in the Worker's log (Cloudflare's Logs); `release` is the commit
(`__RELEASE__` in vite.config.ts), builds are reproducible, and
`scripts/symbolicate.mjs` reads a stack against `dist/assets/*.map`. Rate limits are
Cloudflare's bindings (`LIMIT_API` 1200, `LIMIT_HEAVY` 60, `LIMIT_ERRORS` 30 a minute
per address; `worker/limits.ts`), and the room's per-page bucket (400, +100/s; over it,
close 4429, the page waits 15 s) and `FrameAssembler(64)`. Tokens must have
`email_verified`. `public/_headers` sets framing, nosniff and referrer headers on the
static pages. Tests: `hardening.spec.ts` (workspace project).

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

The full plan, every phase's checklist included, is `docs/plan.html` (a copy of the
user's plan page on claude.ai, <https://claude.ai/artifact/CfqvTAYeG43t2mcbJEBaQ2>; a
signed-out preview of the build is <https://claude.ai/artifact/MxJJwHz82XCdHNVmAKwC4a>
— Claude republishes both after each phase, rebuilding the preview with `.env` moved
aside).

## Deploying

`npm run deploy` builds and runs `wrangler deploy`. It needs `CLOUDFLARE_API_TOKEN` as
an environment secret (Workers Scripts: Edit, D1: Edit, R2: Edit) and `.env` with the
Firebase web config (`cp .env.example .env`; the values are public: project
`r4m-whiteboard`). `.env` is gitignored, so a fresh checkout must recreate it before
building, or the bundle falls back to local-only mode. The container's proxy blocks `*.workers.dev`, so
the live site cannot be fetched from here; `npx wrangler deployments list` confirms a
deploy. Google sign-in needs `sabboura.mh-hamad.workers.dev` and `sabboura.read4more.com` in
Firebase's authorised domains. The custom domain is `routes` in wrangler.toml
(`custom_domain = true`; read4more.com is a zone on the same Cloudflare account). Page
visits to a `*.workers.dev` address get a 301 to `CANONICAL_HOST` (`worker/redirect.ts`;
`/api/` is left alone so open tabs keep working); for that, pages reach the Worker
first (`run_worker_first` in wrangler.toml, all but `/assets/*` and the favicon). Local
wrangler dev rewrites the Host header, so the rule is unit-tested, not seen in e2e.

Never ask for a token, key or password in chat; direct the user to environment
secrets instead.

## Working agreement

- See "How the user wants work done" above. Claude Code ends commit messages with the
  attribution trailers its session gives; other agents follow their own convention.
- **Run `npm run check` before every commit.** CI has caught an unformatted file more
  than once; it is the whole check, not just the tests.
- After each phase (Claude only): rebuild the preview and republish it to the same
  artifact URL, so the user always has something to click. Another agent tells the
  user the change is live at sabboura.read4more.com instead.
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

- **The test backend counts rate limits only for requests with `x-rate-key`**
  (`RATE_LIMIT_TEST`), since every test comes from one address. A test that hammers
  names its own key. The test key server's tokens are `email_verified` unless
  `&verified=no`.
- **Chrome's network emulation is harsh on WebSockets**: 0.27 MB took it two seconds at
  "9 Mbit/s". Timings from it are an upper bound, not a forecast.

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
  query, `(min-width: 900px) and (min-height: 520px) and (orientation: landscape)`,
  repeated in each stylesheet that depends on it; `--pane-w` (global.css) is the
  pane's width there. A phone on its side (under 520 px tall) gets the bar since 17b.
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
