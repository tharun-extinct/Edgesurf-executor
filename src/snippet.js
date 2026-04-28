/**
 * EdgeSurf Executor — Keyboard Shortcut Snippet
 * Injected into chrome-untrusted://surf/ iframe via Playwright CDP.
 *
 * Shortcuts:
 *   R — Restart / Resume / Play again (clicks #action-button)
 *
 * Cursor: Hidden during active gameplay, visible on menus.
 *
 * DOM Structure (edge://surf → iframe chrome-untrusted://surf/):
 *   #game-ui          — Main UI wrapper
 *   #game-canvas      — The game canvas
 *   #game-tint        — Overlay tint (visible when paused/menu/game-over)
 *   #ui-header        — Shows "Paused", "Game Over", etc.
 *   #action-button    — Dynamic button: "Play" / "Resume game" / "Play again"
 *   #top-left button  — Play/pause icon button (aria-label="Play")
 *   #ui-overlay       — Additional overlay (display:none during gameplay)
 */

(function EdgeSurfExecutor() {
  // Prevent double-injection
  if (window.__edgeSurfExecutorLoaded) return;
  window.__edgeSurfExecutorLoaded = true;

  console.log("[EdgeSurf-Executor] Loaded ✓");

  // --- Selectors (discovered from live DOM) ---------------------------------
  const SEL = {
    actionButton: "#action-button",                        // "Play" / "Resume game" / "Play again"
    playButton: '#top-left button[aria-label="Play"]',     // Top-left play icon
    backToMenu: 'button[aria-label="Back to menu"]',       // Back to menu
    canvas: "#game-canvas",
    gameTint: "#game-tint",
    uiHeader: "#ui-header",
    uiOverlay: "#ui-overlay",
    gameUI: "#game-ui",
  };

  // --- Helpers --------------------------------------------------------------

  /** Click an element if it exists and is visible. Returns true on success. */
  function clickIfVisible(selector) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) {
      el.click();
      console.log(`[EdgeSurf-Executor] Clicked: ${selector} ("${el.textContent.trim().substring(0, 30)}")`);
      return true;
    }
    return false;
  }

  /**
   * Determine if the game is actively being played (not paused, not menu, not game-over).
   * During active gameplay:
   *   - #game-tint has opacity near 0
   *   - #action-button is not visible
   */
  function isGameActive() {
    const tint = document.querySelector(SEL.gameTint);
    if (tint) {
      const opacity = parseFloat(getComputedStyle(tint).opacity);
      if (opacity > 0.1) return false; // tint is showing → not in active gameplay
    }
    const actionBtn = document.querySelector(SEL.actionButton);
    if (actionBtn && actionBtn.offsetParent !== null) return false; // action button visible → menu/paused
    // Canvas must exist
    return !!document.querySelector(SEL.canvas);
  }

  // --- Cursor Management ----------------------------------------------------

  const cursorStyle = document.createElement("style");
  cursorStyle.id = "edgesurf-cursor-hide";
  cursorStyle.textContent = `
    html.edgesurf-hide-cursor,
    html.edgesurf-hide-cursor * {
      cursor: none !important;
    }
  `;
  document.head.appendChild(cursorStyle);

  function updateCursor() {
    if (isGameActive()) {
      document.documentElement.classList.add("edgesurf-hide-cursor");
    } else {
      document.documentElement.classList.remove("edgesurf-hide-cursor");
    }
  }

  // Poll cursor state every 300ms
  setInterval(updateCursor, 300);

  // --- Keyboard Shortcuts ---------------------------------------------------

  document.addEventListener("keydown", (e) => {
    // Ignore if user is typing in an input/textarea
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const key = e.key.toLowerCase();

    switch (key) {
      case "r":
        e.preventDefault();
        // Step 1: Click "Back to menu" if visible (below Resume button)
        if (clickIfVisible(SEL.backToMenu)) {
          console.log("[EdgeSurf-Executor] Back to menu clicked, waiting to start game...");
          // Step 2: Wait for menu to load, then click "Play" / start game
          setTimeout(() => {
            clickIfVisible(SEL.actionButton);
            console.log("[EdgeSurf-Executor] Game restarted via R");
          }, 400);
        } else if (clickIfVisible(SEL.actionButton)) {
          // If no "Back to menu" (e.g., game-over screen), click action button directly
          console.log("[EdgeSurf-Executor] Action button clicked via R");
        }
        break;
    }
  });

  // Initial cursor state
  updateCursor();
  console.log("[EdgeSurf-Executor] Shortcuts active — press R to restart/resume");
})();
