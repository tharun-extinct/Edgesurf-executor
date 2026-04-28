# EdgeSurf Executor — Design & Architecture

## System Overview

EdgeSurf Executor injects keyboard shortcuts into the Edge Surf game (`edge://surf`) via Chrome DevTools Protocol (CDP). It auto-injects a JS snippet that listens for keybinds and programmatically clicks DOM buttons in the game UI.

```
┌────────────────┐     CDP / WebSocket       ┌─────────────────────────────┐
│  start.ps1     │ ── launches ────►         │  Microsoft Edge             │
│  (launcher)    │                           │  --remote-debugging-port    │
└────────┬───────┘                           │                             │
         │                                   │  ┌────────────────────────┐ │
         ▼                                   │  │ edge://surf            │ │
┌────────────────┐    Runtime.evaluate       │  │  ┌──────────────────┐  │ │
│  injector.js   │ ─────────────────────────►│  │  │ iframe:          │  │ │
│  (Node.js)     │   injects snippet.js      │  │  │ chrome-untrusted │  │ │
└────────────────┘                           │  │  │ ://surf/         │  │ │
                                             │  │  │                  │  │ │
                                             │  │  │  snippet.js      │  │ │
                                             │  │  └──────────────────┘  │ │
                                             │  └────────────────────────┘ │
                                             └─────────────────────────────┘
```

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Runtime | Node.js | Lightweight, CDP-native ecosystem |
| CDP Transport | `ws` (WebSocket) | Minimal dependency (~200KB vs Playwright's ~50MB) |
| Launcher | PowerShell | Native on Windows, no extra install |
| Injected Code | Vanilla JS | Runs in browser context, no bundler needed |

### Why CDP (Not Extensions)

Chromium **blocks all extensions and userscripts** from injecting into `edge://` and `chrome://` pages. The game also runs inside a `chrome-untrusted://surf/` iframe, adding another layer of isolation.

| Approach | Verdict |
|---|---|
| Extension (MV3) | ❌ Blocked on `edge://` pages |
| Tampermonkey | ❌ Blocked (extension limitation) |
| Bookmarklet | ❌ `javascript:` blocked on `edge://` |
| Console snippet | ✅ Works, but manual — no persistence |
| Playwright | ❌ Page model can't access `chrome-untrusted://` iframe |
| AutoHotkey | ❌ Blind input, no DOM access |
| **Raw CDP** | **✅ Direct WebSocket to iframe target** |

## Architecture

### File Structure

```
EdgeSurf-Executor/
├── src/
│   ├── snippet.js      # Injected JS — keyboard shortcuts + cursor mgmt
│   └── injector.js      # CDP connector — finds iframe target, injects snippet
├── start.ps1            # Launcher — starts Edge with CDP + runs injector
├── package.json
├── .github/
│   ├── design.md        # This file
│   └── copilot.instructions.md
└── README.md
```

### Data Flow

1. `start.ps1` launches Edge with `--remote-debugging-port=9222` (or detects an existing CDP session)
2. `injector.js` fetches `http://127.0.0.1:9222/json` to list CDP targets
3. Filters for `chrome-untrusted://surf/` iframe targets
4. Opens WebSocket, sends `Runtime.evaluate` with `snippet.js` source
5. Polls every 2s for new/reloaded surf tabs and re-injects

## Core Modules

### 1. `src/snippet.js` — Injected Shortcut Handler

Runs inside the `chrome-untrusted://surf/` iframe context.

**Responsibilities:**
- `keydown` event listener for shortcut keys
- DOM button interaction via `element.click()`
- Cursor hide/show based on game state (polling every 300ms)
- Double-injection guard (`window.__edgeSurfExecutorLoaded`)

**Shortcuts:**

| Key | Action | Flow |
|-----|--------|------|
| `R` | Restart game | Click "Back to menu" → wait 400ms → Click "Play" |

**DOM Selectors (discovered from live DOM):**

| Selector | Element | Notes |
|---|---|---|
| `#action-button` | Start / Resume / Play again | Text changes dynamically |
| `button[aria-label="Back to menu"]` | Back to menu | Below resume button |
| `#top-left button[aria-label="Play"]` | Play/pause icon | Top-left corner |
| `#game-canvas` | Game canvas | The actual game |
| `#game-tint` | Overlay tint | `opacity > 0.1` → menu/paused |
| `#ui-header` | Header text | "Paused", "Game Over", etc. |
| `#ui-overlay` | UI overlay | `display:none` during gameplay |

**Game State Detection:**
- **Active gameplay:** `#game-tint` opacity ≈ 0 AND `#action-button` not visible
- **Menu / Paused / Game Over:** `#game-tint` opacity > 0.1 OR `#action-button` visible

### 2. `src/injector.js` — CDP Connector

**Why raw CDP over Playwright?**
Playwright's `connectOverCDP()` exposes pages but cannot access `chrome-untrusted://` iframe targets via its page model. Raw CDP lets us target any debuggable frame directly by its `webSocketDebuggerUrl`.

**Injection flow:**
1. `GET /json` → list all targets
2. Find target where `url.startsWith("chrome-untrusted://surf/")` and `type === "iframe"`
3. Open WebSocket to `target.webSocketDebuggerUrl`
4. `Runtime.evaluate({ expression: snippetSource })`
5. Close WebSocket, mark target as injected
6. Repeat every 2s (poll for new tabs / page reloads)

### 3. `start.ps1` — Launcher

1. Checks if CDP port is already listening
2. If not, launches Edge with `--remote-debugging-port` and separate `--user-data-dir`
3. Waits for CDP readiness
4. Runs `node src/injector.js`

## Design Decisions

### Polling vs Event-Driven Injection
CDP supports `Target.targetCreated` events, but polling every 2s is simpler, more resilient to connection drops, and negligible overhead.

### Cursor Management via Polling
The surf game doesn't emit reliable state-change events. Polling `#game-tint` opacity every 300ms with a CSS class toggle (`edgesurf-hide-cursor`) is cheap and pragmatic.

### Restart Flow: Back to Menu → Play
A direct "Resume" continues the current game. The restart flow intentionally goes through "Back to menu" first to reset state, then triggers "Play" for a clean new game.

### No Playwright Dependency
Switched from Playwright to raw `ws` library. Reduces `node_modules` from ~50MB to ~200KB and removes the need for Playwright browser binaries.

## Adding New Shortcuts

1. Add a new `case` in the `switch (key)` block in `snippet.js`
2. Use `clickIfVisible(SEL.selectorName)` to interact with DOM buttons
3. For multi-step flows, use `setTimeout` for sequencing (game UI needs transition time)
4. Update the shortcuts table in this doc and in `README.md`

## Constraints & Limitations

- **Edge must be launched with `--remote-debugging-port`** — cannot attach to a normal instance
- **Separate user-data-dir required** if Edge is already running without the debug flag
- **DOM selectors may break** if Microsoft updates the surf game UI — inspect and re-discover
- **Canvas interactions** (during active gameplay) not supported — only DOM overlay buttons
- **Single-machine only** — CDP binds to localhost

## Future Enhancements

- Additional keybinds (mute, theme toggle, character select)
- CDP event-driven injection (`Target.targetCreated`) instead of polling
- Auto-discovery script for DOM selectors
- Cross-platform launcher (bash script for macOS/Linux)
