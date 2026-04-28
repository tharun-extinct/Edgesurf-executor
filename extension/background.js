/**
 * EdgeSurf Executor — Background Service Worker
 *
 * Uses chrome.debugger API to attach to edge://surf tabs and inject
 * the shortcut snippet into the chrome-untrusted://surf/ iframe.
 *
 * No --remote-debugging-port needed. Works with a normal Edge instance.
 *
 * Flow:
 *   1. Listen for tab updates → detect edge://surf tabs
 *   2. Attach chrome.debugger to the tab
 *   3. Discover the chrome-untrusted://surf/ iframe target via Target.getTargets
 *   4. Attach to the iframe target and inject snippet via Runtime.evaluate
 */

// --- Snippet source (embedded) ----------------------------------------------
// This is the same snippet.js content, embedded as a string for injection.
// We read it at build time or embed it directly.

const SNIPPET_SOURCE = `
(function EdgeSurfExecutor() {
  if (window.__edgeSurfExecutorLoaded) return;
  window.__edgeSurfExecutorLoaded = true;

  console.log("[EdgeSurf-Executor] Loaded (via extension) ✓");

  const SEL = {
    actionButton: "#action-button",
    playButton: '#top-left button[aria-label="Play"]',
    backToMenu: 'button[aria-label="Back to menu"]',
    canvas: "#game-canvas",
    gameTint: "#game-tint",
    uiHeader: "#ui-header",
    uiOverlay: "#ui-overlay",
    gameUI: "#game-ui",
  };

  function clickIfVisible(selector) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) {
      el.click();
      console.log('[EdgeSurf-Executor] Clicked: ' + selector + ' ("' + el.textContent.trim().substring(0, 30) + '")');
      return true;
    }
    return false;
  }

  function isGameActive() {
    const tint = document.querySelector(SEL.gameTint);
    if (tint) {
      const opacity = parseFloat(getComputedStyle(tint).opacity);
      if (opacity > 0.1) return false;
    }
    const actionBtn = document.querySelector(SEL.actionButton);
    if (actionBtn && actionBtn.offsetParent !== null) return false;
    return !!document.querySelector(SEL.canvas);
  }

  const cursorStyle = document.createElement("style");
  cursorStyle.id = "edgesurf-cursor-hide";
  cursorStyle.textContent = "html.edgesurf-hide-cursor, html.edgesurf-hide-cursor * { cursor: none !important; }";
  document.head.appendChild(cursorStyle);

  function updateCursor() {
    if (isGameActive()) {
      document.documentElement.classList.add("edgesurf-hide-cursor");
    } else {
      document.documentElement.classList.remove("edgesurf-hide-cursor");
    }
  }

  setInterval(updateCursor, 300);

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const key = e.key.toLowerCase();
    switch (key) {
      case "r":
        e.preventDefault();
        if (clickIfVisible(SEL.backToMenu)) {
          console.log("[EdgeSurf-Executor] Back to menu clicked, waiting to start game...");
          setTimeout(() => {
            clickIfVisible(SEL.actionButton);
            console.log("[EdgeSurf-Executor] Game restarted via R");
          }, 400);
        } else if (clickIfVisible(SEL.actionButton)) {
          console.log("[EdgeSurf-Executor] Action button clicked via R");
        }
        break;
    }
  });

  updateCursor();
  console.log("[EdgeSurf-Executor] Shortcuts active — press R to restart");
})();
`;

// --- State ------------------------------------------------------------------

/** Set of tab IDs we've already injected into */
const injectedTabs = new Set();

/** Set of tab IDs we're currently attached to (debugger) */
const attachedTabs = new Set();

// --- Core Logic -------------------------------------------------------------

/**
 * Check if a URL is an edge://surf page.
 */
function isSurfUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("edge://surf") ||
    url.startsWith("chrome://surf") ||
    url.startsWith("chrome-untrusted://surf")
  );
}

/**
 * Send a CDP command via chrome.debugger.
 */
function cdpSend(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Attach debugger to a tab, find the surf iframe, and inject the snippet.
 */
async function injectIntoTab(tabId) {
  if (injectedTabs.has(tabId)) return;

  const debugTarget = { tabId };

  try {
    // Step 1: Attach debugger to the tab
    if (!attachedTabs.has(tabId)) {
      await new Promise((resolve, reject) => {
        chrome.debugger.attach(debugTarget, "1.3", () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            attachedTabs.add(tabId);
            resolve();
          }
        });
      });
      // Give the debugger a moment to fully attach
      await new Promise((r) => setTimeout(r, 500));
    }

    // Step 2: Try to discover the iframe target
    let injected = false;

    try {
      await cdpSend(debugTarget, "Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = await cdpSend(debugTarget, "Target.getTargets");

      const surfIframe = targetInfos.find(
        (t) =>
          t.type === "iframe" &&
          t.url &&
          t.url.startsWith("chrome-untrusted://surf")
      );

      if (surfIframe) {
        try {
          const { sessionId } = await cdpSend(debugTarget, "Target.attachToTarget", {
            targetId: surfIframe.targetId,
            flatten: true,
          });

          await cdpSend(
            { tabId, sessionId },
            "Runtime.evaluate",
            { expression: SNIPPET_SOURCE, returnByValue: true }
          );

          injected = true;
          console.log(`[EdgeSurf-Executor] Injected via iframe session (tab ${tabId})`);
        } catch (sessionErr) {
          console.warn(`[EdgeSurf-Executor] Session inject failed:`, sessionErr.message);
        }
      }
    } catch (targetErr) {
      console.warn(`[EdgeSurf-Executor] Target discovery failed:`, targetErr.message);
    }

    // Step 3: Fallback — inject into all frames via Page.getFrameTree
    if (!injected) {
      try {
        await cdpSend(debugTarget, "Page.enable");
        const { frameTree } = await cdpSend(debugTarget, "Page.getFrameTree");

        // Find the surf iframe in the frame tree
        const surfFrame = findSurfFrame(frameTree);
        if (surfFrame) {
          await cdpSend(debugTarget, "Runtime.enable");
          // Create an isolated world in the iframe to run our snippet
          const { executionContextId } = await cdpSend(
            debugTarget,
            "Page.createIsolatedWorld",
            { frameId: surfFrame.frame.id, worldName: "EdgeSurfExecutor" }
          );

          await cdpSend(debugTarget, "Runtime.evaluate", {
            expression: SNIPPET_SOURCE,
            contextId: executionContextId,
            returnByValue: true,
          });

          injected = true;
          console.log(`[EdgeSurf-Executor] Injected via isolated world (tab ${tabId}, frame ${surfFrame.frame.url})`);
        }
      } catch (frameErr) {
        console.warn(`[EdgeSurf-Executor] Frame tree inject failed:`, frameErr.message);
      }
    }

    // Step 4: Last resort — inject directly into the main frame
    if (!injected) {
      try {
        await cdpSend(debugTarget, "Runtime.evaluate", {
          expression: SNIPPET_SOURCE,
          returnByValue: true,
        });
        injected = true;
        console.log(`[EdgeSurf-Executor] Injected directly into main frame (tab ${tabId})`);
      } catch (directErr) {
        console.warn(`[EdgeSurf-Executor] Direct inject failed:`, directErr.message);
      }
    }

    if (injected) {
      injectedTabs.add(tabId);
    }
  } catch (err) {
    console.warn(`[EdgeSurf-Executor] Failed to inject into tab ${tabId}:`, err.message);
  }
}

/**
 * Recursively find the chrome-untrusted://surf frame in a frame tree.
 */
function findSurfFrame(frameTree) {
  if (
    frameTree.frame &&
    frameTree.frame.url &&
    frameTree.frame.url.startsWith("chrome-untrusted://surf")
  ) {
    return frameTree;
  }
  if (frameTree.childFrames) {
    for (const child of frameTree.childFrames) {
      const found = findSurfFrame(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Detach debugger from a tab.
 */
function detachTab(tabId) {
  if (attachedTabs.has(tabId)) {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        // Ignore — tab may already be closed
      }
    });
    attachedTabs.delete(tabId);
  }
  injectedTabs.delete(tabId);
}

// --- Event Listeners --------------------------------------------------------

// Watch for tab navigations to edge://surf
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Check both changeInfo.url and tab.url (edge:// URLs may only appear in one)
  const url = changeInfo.url || tab.url || tab.pendingUrl || "";

  if (changeInfo.status === "complete" && isSurfUrl(url)) {
    // Delay to let the iframe load fully
    setTimeout(() => injectIntoTab(tabId), 1500);
  }

  // Also trigger on URL change to edge://surf (even before "complete")
  if (changeInfo.url && isSurfUrl(changeInfo.url)) {
    injectedTabs.delete(tabId); // Reset injection state for fresh page
    setTimeout(() => injectIntoTab(tabId), 2000);
  }

  // If the tab navigated away from surf, clean up
  if (changeInfo.url && !isSurfUrl(changeInfo.url)) {
    detachTab(tabId);
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  detachTab(tabId);
});

// Handle debugger detach (e.g., user clicked "cancel" on the banner)
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    injectedTabs.delete(source.tabId);
    console.log(`[EdgeSurf-Executor] Debugger detached from tab ${source.tabId}: ${reason}`);
  }
});

// On extension icon click: manually trigger injection on the active tab
chrome.action.onClicked.addListener(async (tab) => {
  if (isSurfUrl(tab.url || tab.pendingUrl)) {
    injectedTabs.delete(tab.id); // Force re-injection
    await injectIntoTab(tab.id);
  } else {
    // Open edge://surf in a new tab
    chrome.tabs.create({ url: "edge://surf" });
  }
});

// Check existing tabs on startup / install
chrome.runtime.onInstalled.addListener(() => {
  console.log("[EdgeSurf-Executor] Extension installed/updated");
  scanExistingTabs();
});

// Also scan on service worker startup (covers restarts)
scanExistingTabs();

function scanExistingTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (isSurfUrl(tab.url || tab.pendingUrl || "")) {
        setTimeout(() => injectIntoTab(tab.id), 1500);
      }
    }
  });
}

console.log("[EdgeSurf-Executor] Background service worker started");
