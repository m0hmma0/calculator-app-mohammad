# Sabboura

A collaborative infinite whiteboard for the browser — real-time editing, folders and
sharing, images, freehand ink, text, shapes and a laser pointer.

Runs entirely on free tiers: Cloudflare Pages, D1, Durable Objects and R2, with Firebase
for Google sign-in.

## Status

Built in phases. Each phase ends with a working, checkable deliverable.

| Phase | What it adds                                 | State       |
| ----- | -------------------------------------------- | ----------- |
| **0** | Teardown, tooling, test harness, app shell   | ✅ done     |
| 1     | Infinite canvas — pan, zoom, minimap         | not started |
| 2     | Shapes, selection, transform handles         | not started |
| 3     | Freehand, text, images, laser pointer        | not started |
| 4     | Yjs document, per-user undo, offline, export | not started |
| 5     | Google sign-in, folders, boards (D1)         | not started |
| 6     | Image storage (R2)                           | not started |
| 7     | Real-time collaboration (Durable Objects)    | not started |
| 8     | Sharing, permissions, comments               | not started |
| 9     | Presentation mode, workshop tools, embeds    | not started |
| 10    | Accessibility, Arabic and RTL, polish        | not started |
| 11    | Hardening, load testing, launch              | not started |

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
  canvas/     renderer and the device-pixel-ratio plumbing
  geometry/   pure maths — rects, points, intersection, snapping
  ui/         React components: top bar, canvas stage, panels
  styles/     design tokens and global CSS
shared/       types used by both the app and the Worker
worker/       Cloudflare Worker: API routes, and later the board rooms
tests/
  unit/       Vitest
  e2e/        Playwright
```

Directories for `tools/` and `model/` arrive with the phases that need them.

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
