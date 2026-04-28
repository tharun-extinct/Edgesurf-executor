# EdgeSurf Executor — Design & Architecture

## System Overview

EdgeSurf Executor injects keyboard shortcuts into the Edge Surf game (`edge://surf`) by injecting a JS snippet into the `chrome-untrusted://surf/` iframe.

**Two injection methods are available:**

### Method 1: Edge Extension (Primary — No Debug Mode Required)

```
┌────────────────────────┐         ┌─────────────────────────────┐
│  Edge Extension (MV3)  │         │  Microsoft Edge (normal)    │
│  background.js         │         │                             │
│                        │         │  ┌────────────────────────┐ │
│  chrome.debugger API   │────────►│  │ edge://surf            │ │
│  (attach to tab)       │         │  │  ┌──────────────────┐  │ │
│                        │  CDP    │  │  │ iframe:          │  │ │
│  Target.attachToTarget │────────►│  │  │ chrome-untrusted │  │ │
│  Runtime.evaluate      │         │  │  │ ://surf/         │  │ │
│                        │         │  │  │                  │  │ │
│                        │         │  │  │  snippet ✓       │  │ │
└────────────────────────┘         │  │  └──────────────────┘  │ │
                                   │  └────────────────────────┘ │
                                   └─────────────────────────────┘
```

### Method 2: Node.js CDP Injector (Fallback — Requires Debug Mode)

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
                                             │  │  │  snippet.js ✓   │  │ │
                                             │  │  └──────────────────┘  │ │
                                             │  └────────────────────────┘ │
                                             └─────────────────────────────┘
```

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| **Extension** | MV3 + `chrome.debugger` API | No debug mode needed, auto-injects on tab load |
| Fallback Runtime | Node.js + `ws` | CDP injector for when extension isn't installed |
| Launcher | PowerShell | Native on Windows, no extra install |
| Injected Code | Vanilla JS | Runs in browser context, no bundler needed |

### Why `chrome.debugger` API

Chromium blocks **content scripts** from injecting into `edge://` pages, but the `chrome.debugger` extension API can **attach to any tab** (including `edge://`) and send CDP commands like `Runtime.evaluate`. This is the same protocol used by DevTools.

| Approach | Verdict |
|---|---|
| Extension content scripts | ❌ Blocked on `edge://` pages |
| **Extension + `chrome.debugger`** | **✅ Attaches to any tab, sends CDP commands — no debug flag** |
| Tampermonkey | ❌ Blocked (extension limitation) |
| Bookmarklet | ❌ `javascript:` blocked on `edge://` |
| Console snippet | ✅ Works, but manual — no persistence |
| Playwright | ❌ Page model can't access `chrome-untrusted://` iframe |
| Raw CDP (Node.js) | ✅ Works, but requires `--remote-debugging-port` |
| AutoHotkey | ❌ Blind input, no DOM access |

## Architecture

### File Structure

```
EdgeSurf-Executor/
├── extension/                # ← PRIMARY: Edge extension (no debug mode)
│   ├── manifest.json         # MV3 manifest with debugger permission
│   ├── background.js         # Service worker — auto-injects via chrome.debugger
│   └── icons/                # Extension icons
├── src/                      # ← FALLBACK: Node.js CDP injector
│   ├── snippet.js            # Injected JS — keyboard shortcuts + cursor mgmt
│   └── injector.js           # Raw CDP connector (requires --remote-debugging-port)
├── start.ps1                 # Launcher for fallback method
├── package.json
├── .github/
│   ├── design.md             # This file
│   └── copilot.instructions.md
└── README.md
```

### Data Flow — Extension (Primary)

1. Extension installs and background service worker starts
2. `chrome.tabs.onUpdated` detects navigation to `edge://surf`
3. `chrome.debugger.attach()` attaches to the tab (shows info banner)
4. `Target.setDiscoverTargets` + `Target.getTargets` finds the `chrome-untrusted://surf/` iframe
5. `Target.attachToTarget` opens a CDP session to the iframe
6. `Runtime.evaluate` injects the snippet into the iframe context
7. On tab close/navigation away, debugger detaches automatically

### Data Flow — Node.js CDP (Fallback)

1. `start.ps1` launches Edge with `--remote-debugging-port=9222`
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

### 2. `extension/background.js` — Extension Service Worker (Primary)

Uses the `chrome.debugger` API — the **same CDP protocol** as the Node.js injector, but runs **inside the browser** without needing `--remote-debugging-port`.

**Key mechanisms:**
- `chrome.debugger.attach(tabId, "1.3")` — attaches to any tab including `edge://surf`
- `Target.getTargets` — discovers the `chrome-untrusted://surf/` iframe inside the tab
- `Target.attachToTarget` — opens a flattened CDP session to the iframe
- `Runtime.evaluate` via the session — injects the snippet directly into iframe context
- `chrome.tabs.onUpdated` — auto-detects when user opens `edge://surf`
- `chrome.action.onClicked` — manual re-inject or open `edge://surf` on icon click

**Trade-off:** Edge shows an info banner *"EdgeSurf Executor started debugging this browser"* which the user can dismiss. This is purely cosmetic.

### 3. `src/injector.js` — Raw CDP Connector (Fallback)

For users who prefer not to install an extension. Requires Edge launched with `--remote-debugging-port`.

**Injection flow:**
1. `GET /json` → list all targets
2. Find target where `url.startsWith("chrome-untrusted://surf/")` and `type === "iframe"`
3. Open WebSocket to `target.webSocketDebuggerUrl`
4. `Runtime.evaluate({ expression: snippetSource })`
5. Close WebSocket, mark target as injected
6. Repeat every 2s (poll for new tabs / page reloads)

### 4. `start.ps1` — Launcher (for fallback method)

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

- **Extension method:** Shows "debugging" info banner (cosmetic only, can be dismissed)
- **Fallback method:** Edge must be launched with `--remote-debugging-port`
- **DOM selectors may break** if Microsoft updates the surf game UI — inspect and re-discover
- **Canvas interactions** (during active gameplay) not supported — only DOM overlay buttons
- **Single-machine only** — CDP binds to localhost

## Future Enhancements

- Additional keybinds (mute, theme toggle, character select)
- CDP event-driven injection (`Target.targetCreated`) instead of polling
- Auto-discovery script for DOM selectors
- Cross-platform launcher (bash script for macOS/Linux)
- Suppress or auto-dismiss the debugger info banner
