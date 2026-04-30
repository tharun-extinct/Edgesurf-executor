# EdgeSurf Executor — Design & Architecture

## System Overview

EdgeSurf Executor injects keyboard shortcuts into the Edge Surf game (`edge://surf`) by injecting a JS snippet into the `chrome-untrusted://surf/` iframe via Chrome DevTools Protocol (CDP).

```
┌────────────────┐     CDP / WebSocket       ┌─────────────────────────────┐
│  start.ps1     │ ── launches ────►         │  Microsoft Edge             │
│  start.bat     │                           │  --remote-debugging-port    │
└────────┬───────┘                           │                             │
         │                                   │  ┌────────────────────────┐ │
         ▼                                   │  │ edge://surf            │ │
┌────────────────┐    Runtime.evaluate       │  │  ┌──────────────────┐  │ │
│  injector.js   │ ─────────────────────────►│  │  │ iframe:          │  │ │
│  (Node.js)     │   injects snippet.js      │  │  │ chrome-untrusted │  │ │
└────────────────┘                           │  │  │ ://surf/         │  │ │
                                             │  │  │                  │  │ │
                                             │  │  │  snippet.js ✓   │  │ │
                                             │  │  └──────────────────┘  │ │
                                             │  └────────────────────────┘ │
                                             └─────────────────────────────┘
```

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Runtime | Node.js + `ws` | Lightweight, CDP-native, minimal dependency (~200KB) |
| Launcher | PowerShell + Batch | Native on Windows, double-click to run |
| Injected Code | Vanilla JS | Runs in browser context, no bundler needed |

### Why CDP is the Only Option

Chromium enforces a **hard security boundary** on `edge://` pages. Every browser-level injection method is blocked:

| Approach | Verdict |
|---|---|
| Extension content scripts | ❌ Blocked on `edge://` pages |
| Extension `chrome.debugger` API | ❌ Cannot attach to `edge://` tabs |
| Tampermonkey | ❌ Blocked (extension limitation) |
| Bookmarklet | ❌ `javascript:` blocked on `edge://` |
| Console snippet | ✅ Works, but manual — no persistence |
| Playwright | ❌ Page model can't access `chrome-untrusted://` iframe |
| AutoHotkey | ❌ Blind input, no DOM access |
| **Raw CDP via `--remote-debugging-port`** | **✅ Direct WebSocket to iframe target** |

The `--remote-debugging-port` flag operates at the **browser process level**, bypassing all extension/page security restrictions.

## Architecture

### File Structure

```
EdgeSurf-Executor/
├── src/
│   ├── snippet.js            # Injected JS — keyboard shortcuts + cursor mgmt
│   └── injector.js           # Raw CDP connector via WebSocket
├── start.bat                 # Double-click launcher (Windows)
├── start.ps1                 # PowerShell launcher (full-featured)
├── package.json
├── .github/
│   ├── design.md             # This file
│   └── copilot.instructions.md
└── README.md
```

### Data Flow

1. `start.bat` / `start.ps1` launches Edge in debug mode using the user's own profile (`--user-data-dir`)
2. Homepage/startup pages are suppressed (`--no-startup-window`, `--homepage=about:blank`)
3. A second Edge call opens **only** `edge://surf` as the single tab
4. `injector.js` fetches `http://127.0.0.1:9222/json` to list CDP targets
5. Finds `chrome-untrusted://surf/` iframe target
6. Opens WebSocket to `target.webSocketDebuggerUrl`
7. Sends `Runtime.evaluate` with `snippet.js` source
8. Polls every 2s for new/reloaded surf tabs and re-injects

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

Connects to Edge's debug port and injects the snippet into the surf iframe.

**Injection flow:**
1. `GET /json` → list all targets
2. Find target where `url.startsWith("chrome-untrusted://surf/")` and `type === "iframe"`
3. Open WebSocket to `target.webSocketDebuggerUrl`
4. `Runtime.evaluate({ expression: snippetSource })`
5. Close WebSocket, mark target as injected
6. Repeat every 2s (poll for new tabs / page reloads)

### 3. `start.ps1` / `start.bat` — Launchers

1. Checks if CDP port is already listening (skips launch if Edge is already in debug mode)
2. If not, launches Edge with the following flags:
   - `--remote-debugging-port=9222` — enables CDP
   - `--user-data-dir=<user-profile>` — uses the user's real Edge profile
   - `--no-startup-window` — prevents homepage/startup tabs from loading
   - `--no-first-run --no-default-browser-check` — skips prompts
   - `--homepage=about:blank --restore-last-session=false` — suppresses default pages
3. Opens `edge://surf` as the **only** tab via a second Edge call
4. Runs `node src/injector.js`

> **Constraint:** Edge must NOT already be running with this profile. The `--remote-debugging-port` flag is ignored if an Edge instance with the same profile is already active.

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

- **Edge must NOT be already running** with the same profile — close Edge first, then run the launcher
- **`--remote-debugging-port` is per-process** — if Edge is already open, the flag is silently ignored
- **DOM selectors may break** if Microsoft updates the surf game UI — inspect and re-discover
- **Canvas interactions** (during active gameplay) not supported — only DOM overlay buttons
- **Single-machine only** — CDP binds to localhost

## Future Enhancements

- Additional keybinds (mute, theme toggle, character select)
- CDP event-driven injection (`Target.targetCreated`) instead of polling
- Auto-discovery script for DOM selectors
- Cross-platform launcher (bash script for macOS/Linux)
