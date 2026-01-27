import {
  fetchPositionsREST,
  closePosition,
  getMarketInfo,
  fetchTradeHistory
} from "./positionsApi";
import { write, setStatus } from "../utils/logger";
import { appState } from "../utils/state";

let positionsContainer: HTMLDivElement | null = null;
let positionsListEl: HTMLDivElement | null = null;
let tradesListEl: HTMLDivElement | null = null;

export function initPositionsUI() {
  positionsContainer = document.getElementById("positionsContainer") as HTMLDivElement;
  positionsListEl = document.getElementById("positionsList") as HTMLDivElement;
  tradesListEl = document.getElementById("tradesList") as HTMLDivElement;

  const btnRefreshPositions = document.getElementById("btnRefreshPositions") as HTMLButtonElement;
  const btnRefreshTrades = document.getElementById("btnRefreshTrades") as HTMLButtonElement;

  if (btnRefreshPositions) {
    btnRefreshPositions.onclick = handleRefreshPositions;
  }

  if (btnRefreshTrades) {
    btnRefreshTrades.onclick = handleRefreshTrades;
  }
}

async function handleRefreshPositions() {
  try {
    if (!appState.signerAddress) {
      setStatus("Connect wallet first", false);
      return;
    }

    const positions = await fetchPositionsREST();
    renderPositionsList(positions);
  } catch (error: any) {
    write({ error: error.message });
  }
}

async function handleRefreshTrades() {
  try {
    if (!appState.signerAddress) {
      setStatus("Connect wallet first", false);
      return;
    }

    const trades = await fetchTradeHistory();
    renderTradesList(trades);
  } catch (error: any) {
    write({ error: error.message });
  }
}

async function handleClosePosition(position: any) {
  try {
    if (!appState.client) {
      setStatus("Connect wallet and derive credentials first", false);
      return;
    }

    const assetId = position.asset;
    const size = parseFloat(position.size || "0");
    const curPrice = position.curPrice || 0;
    const title = position.title || "Unknown";
    const outcome = position.outcome || "";
    const negRisk = position.negativeRisk || false;

    if (size <= 0) {
      setStatus("Position size is 0", false);
      return;
    }

    // Get market info to determine tick size and best bid
    const marketInfo = await getMarketInfo(assetId);

    // Show close position dialog
    const closePrice = prompt(
      `Close "${title}" (${outcome})\n\n` +
      `Position Size: ${size} shares\n` +
      `Current Price: $${curPrice}\n` +
      `Best Bid: $${marketInfo.bestBid || "N/A"}\n` +
      `Tick Size: ${marketInfo.tickSize}\n\n` +
      `Enter sell price:`,
      marketInfo.bestBid || String(curPrice) || "0.5"
    );

    if (!closePrice) return;

    const price = parseFloat(closePrice);
    if (isNaN(price) || price <= 0 || price > 1) {
      setStatus("Invalid price. Must be between 0 and 1.", false);
      return;
    }

    await closePosition(
      assetId,
      size,
      price,
      String(marketInfo.tickSize),
      negRisk
    );

    // Refresh positions after closing
    await handleRefreshPositions();
  } catch (error: any) {
    write({ error: error.message });
  }
}

function renderPositionsList(positions: any[]) {
  if (!positionsListEl) return;

  if (!positions || positions.length === 0) {
    positionsListEl.innerHTML = `<p class="no-data">No positions found.</p>`;
    return;
  }

  const html = positions.map((pos, idx) => {
    const title = pos.title || "Unknown Market";
    const outcome = pos.outcome || "Unknown";
    const size = pos.size || 0;
    const avgPrice = pos.avgPrice || 0;
    const curPrice = pos.curPrice || 0;
    const initialValue = pos.initialValue || 0;
    const currentValue = pos.currentValue || 0;
    const cashPnl = pos.cashPnl || 0;
    const percentPnl = pos.percentPnl || 0;
    const assetId = pos.asset || "";
    const endDate = pos.endDate || "";

    return `
      <div class="position-card" data-position-idx="${idx}">
        <div class="position-header">
          <span class="position-title">${title}</span>
          <span class="position-outcome-badge ${outcome.toLowerCase()}">${outcome}</span>
        </div>
        <div class="position-details">
          <div class="position-row">
            <span class="label">Size:</span>
            <span class="value">${size} shares</span>
          </div>
          <div class="position-row">
            <span class="label">Avg Price:</span>
            <span class="value">$${avgPrice.toFixed(3)}</span>
          </div>
          <div class="position-row">
            <span class="label">Current Price:</span>
            <span class="value">$${curPrice.toFixed(3)}</span>
          </div>
          <div class="position-row">
            <span class="label">Initial Value:</span>
            <span class="value">$${initialValue.toFixed(2)}</span>
          </div>
          <div class="position-row">
            <span class="label">Current Value:</span>
            <span class="value">$${currentValue.toFixed(2)}</span>
          </div>
          <div class="position-row">
            <span class="label">P&L:</span>
            <span class="value ${cashPnl >= 0 ? 'profit' : 'loss'}">
              $${cashPnl.toFixed(2)} (${percentPnl.toFixed(2)}%)
            </span>
          </div>
          <div class="position-row">
            <span class="label">End Date:</span>
            <span class="value">${endDate || 'N/A'}</span>
          </div>
          <div class="position-row">
            <span class="label">Asset ID:</span>
            <span class="value asset-id" title="${assetId}">${assetId.slice(0, 16)}...</span>
          </div>
        </div>
        <div class="position-actions">
          <button class="btn-close-position" data-position-idx="${idx}">Close Position</button>
          <button class="btn-copy-asset" data-asset="${assetId}">Copy Asset ID</button>
        </div>
      </div>
    `;
  }).join("");

  positionsListEl.innerHTML = html;

  // Attach close handlers
  positionsListEl.querySelectorAll(".btn-close-position").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.target as HTMLButtonElement).dataset.positionIdx || "0");
      if (positions[idx]) {
        handleClosePosition(positions[idx]);
      }
    });
  });

  // Attach copy handlers
  positionsListEl.querySelectorAll(".btn-copy-asset").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const assetId = (e.target as HTMLButtonElement).dataset.asset || "";
      navigator.clipboard.writeText(assetId).then(() => {
        setStatus("Asset ID copied to clipboard", true);
      });
    });
  });
}

function renderTradesList(trades: any[]) {
  if (!tradesListEl) return;

  if (!trades || trades.length === 0) {
    tradesListEl.innerHTML = `<p class="no-data">No trade history found.</p>`;
    return;
  }

  // Show last 20 trades
  const recentTrades = trades.slice(0, 20);

  const html = recentTrades.map(trade => {
    const side = trade.side || (trade.type === "buy" ? "BUY" : "SELL");
    const price = trade.price || "N/A";
    const size = trade.size || trade.amount || "N/A";
    const timestamp = trade.timestamp || trade.created_at || trade.createdAt;
    const status = trade.status || "FILLED";

    return `
      <div class="trade-card">
        <div class="trade-header">
          <span class="trade-side ${side.toLowerCase()}">${side}</span>
          <span class="trade-status">${status}</span>
        </div>
        <div class="trade-details">
          <span class="trade-price">$${price}</span>
          <span class="trade-size">${size} shares</span>
          <span class="trade-time">${timestamp ? new Date(timestamp * 1000).toLocaleString() : 'N/A'}</span>
        </div>
      </div>
    `;
  }).join("");

  tradesListEl.innerHTML = html;
}

export function showPositionsSection() {
  if (positionsContainer) {
    positionsContainer.style.display = "block";
  }
}

export function hidePositionsSection() {
  if (positionsContainer) {
    positionsContainer.style.display = "none";
  }
}
