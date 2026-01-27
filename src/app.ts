/**
 * Application initialization - connects new modules with the existing main.ts
 * This file initializes the orders and positions UI without modifying main.ts
 */

import { initOrdersUI } from "./orders";
import { initPositionsUI } from "./positions";
import { initLogger } from "./utils/logger";
import { updateState, appState } from "./utils/state";

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", () => {
  // Initialize logger with the existing log element
  const logEl = document.getElementById("log") as HTMLPreElement;
  const statusEl = document.getElementById("status") as HTMLDivElement;

  if (logEl && statusEl) {
    initLogger(logEl, statusEl);
  }

  // Initialize UI modules
  initOrdersUI();
  initPositionsUI();

  // Hook into main.ts's client creation
  // We'll observe the client from the window if main.ts exposes it
  // or we can intercept the derive button click

  // Watch for state changes from main.ts by polling localStorage
  // This is a non-invasive way to sync state
  setInterval(() => {
    syncStateFromMain();
  }, 1000);
});

/**
 * Sync state from main.ts by checking localStorage and global state
 */
function syncStateFromMain() {
  // Check for API creds in localStorage (same as main.ts uses)
  const storedCreds = localStorage.getItem("POLY_USER_API_CREDS");
  if (storedCreds && !appState.apiCreds) {
    try {
      const creds = JSON.parse(storedCreds);
      if (creds?.key && creds?.secret && creds?.passphrase) {
        updateState({ apiCreds: creds });
      }
    } catch {}
  }

  // Check if ethereum is available and get signer address
  // @ts-ignore
  if (window.ethereum && !appState.signerAddress) {
    // @ts-ignore
    window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts && accounts.length > 0) {
        updateState({ signerAddress: accounts[0] });
      }
    }).catch(() => {});
  }
}

// Export for potential use by main.ts
export { updateState, appState };
