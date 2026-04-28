/**
 * EdgeSurf Executor — CDP Injector
 *
 * Connects to an already-running Edge instance (with --remote-debugging-port)
 * and injects the shortcut snippet into the chrome-untrusted://surf/ iframe.
 *
 * The edge://surf page hosts the game inside an iframe at chrome-untrusted://surf/.
 * Extensions and Playwright page model cannot access this iframe directly,
 * so we use raw CDP (Chrome DevTools Protocol) via WebSocket to target the iframe.
 *
 * Usage:
 *   1. Launch Edge with: msedge --remote-debugging-port=9222
 *   2. Open edge://surf in a tab
 *   3. Run: node src/injector.js
 */

const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const CDP_PORT = process.env.CDP_PORT || 9222;
const CDP_HOST = "127.0.0.1";
const SNIPPET_PATH = path.join(__dirname, "snippet.js");
const POLL_INTERVAL_MS = 2000;

/** Fetch CDP targets list */
function getTargets() {
  return new Promise((resolve, reject) => {
    http
      .get(`http://${CDP_HOST}:${CDP_PORT}/json`, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

/** Send a CDP command over WebSocket and wait for the response */
function cdpSend(ws, id, method, params = {}) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Inject snippet into a CDP target via WebSocket */
async function injectViaWebSocket(wsUrl, snippetCode) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on("error", reject);
    ws.on("open", async () => {
      try {
        const result = await cdpSend(ws, 1, "Runtime.evaluate", {
          expression: snippetCode,
          returnByValue: true,
        });
        ws.close();
        if (result.result?.exceptionDetails) {
          reject(new Error(result.result.exceptionDetails.text));
        } else {
          resolve(true);
        }
      } catch (err) {
        ws.close();
        reject(err);
      }
    });
  });
}

async function main() {
  console.log(`[Injector] Connecting to Edge CDP at ${CDP_HOST}:${CDP_PORT}...`);

  let targets;
  try {
    targets = await getTargets();
  } catch (err) {
    console.error(
      "[Injector] Failed to connect. Is Edge running with --remote-debugging-port?\n",
      `  Launch Edge with:  msedge --remote-debugging-port=${CDP_PORT}\n`,
      err.message
    );
    process.exit(1);
  }

  console.log("[Injector] Connected ✓");
  console.log("[Injector] Watching for chrome-untrusted://surf/ iframe...\n");

  const snippetCode = fs.readFileSync(SNIPPET_PATH, "utf-8");

  // Track injected target IDs
  const injectedTargets = new Set();

  async function injectIntoSurfTargets() {
    try {
      const currentTargets = await getTargets();

      // Find the chrome-untrusted://surf/ iframe target
      const surfTargets = currentTargets.filter(
        (t) => t.url === "chrome-untrusted://surf/" && !injectedTargets.has(t.id)
      );

      for (const target of surfTargets) {
        try {
          await injectViaWebSocket(target.webSocketDebuggerUrl, snippetCode);
          injectedTargets.add(target.id);
          console.log(`[Injector] ✓ Injected into: ${target.url} (${target.id})`);
        } catch (err) {
          console.warn(`[Injector] ✗ Injection failed for ${target.id}:`, err.message);
        }
      }
    } catch {
      // CDP connection lost — Edge may have closed
    }
  }

  // Initial injection
  await injectIntoSurfTargets();

  // Keep polling for new surf tabs/navigations
  setInterval(injectIntoSurfTargets, POLL_INTERVAL_MS);

  console.log("[Injector] Running. Press Ctrl+C to stop.\n");
  process.on("SIGINT", () => {
    console.log("\n[Injector] Stopped.");
    process.exit(0);
  });
}

main();
