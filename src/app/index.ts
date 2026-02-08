// Polymarket Live Trading App
import { ethers } from "ethers";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import type { ApiKeyCreds, TickSize } from "@polymarket/clob-client";
import {
  polymarketWS,
  type BookMessage,
  type PriceChangeMessage,
  type LastTradePriceMessage,
  type BestBidAskMessage,
  type NewMarketMessage,
  type WebSocketMessage
} from "./websocket";

// ============= Constants =============
const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";
const CORS_PROXY = "https://corsproxy.io/?url=";

const ADDRESSES = {
  USDCe: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const CTF_ABI = [
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
  "function balanceOf(address,uint256) view returns (uint256)",
];

// ============= Types =============
interface Market {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  image: string;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume24hr: number;
  liquidity: number;
  negRisk: boolean;
  tickSize: number;
  minSize: number;
  bestBid: number;
  bestAsk: number;
  oneDayPriceChange: number;
  endDate: string;
}

interface Position {
  asset: string;
  title: string;
  image: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  negRisk: boolean;
}

interface Order {
  id: string;
  asset_id: string;
  market: string;
  side: string;
  price: number;
  size: number;
  filled: number;
  status: string;
}

// ============= State =============
let provider: ethers.providers.Web3Provider | null = null;
let signer: ethers.Signer | null = null;
let signerAddress: string | null = null;
let apiCreds: ApiKeyCreds | null = null;
let client: ClobClient | null = null;
let usdcBalance = 0;

let markets: Market[] = [];
let positions: Position[] = [];
let orders: Order[] = [];
let selectedMarket: Market | null = null;
let selectedOutcome = 0;
let tradeSide: "BUY" | "SELL" = "BUY";
let currentOrderBook: { bids: any[]; asks: any[] } = { bids: [], asks: [] };

// ============= DOM Elements =============
const $ = (id: string) => document.getElementById(id);

const wsStatus = $("wsStatus")!;
const wsStatusText = $("wsStatusText")!;
const balanceDisplay = $("balanceDisplay")!;
const btnConnect = $("btnConnect")!;
const searchInput = $("searchInput") as HTMLInputElement;
const marketsContainer = $("marketsContainer")!;

// Modal elements
const tradeModal = $("tradeModal")!;
const modalTitle = $("modalTitle")!;
const modalImage = $("modalImage") as HTMLImageElement;
const modalVolume = $("modalVolume")!;
const modalLiquidity = $("modalLiquidity")!;
const obAsks = $("obAsks")!;
const obBids = $("obBids")!;
const obSpread = $("obSpread")!;
const obUpdateTime = $("obUpdateTime")!;
const outcomeYes = $("outcomeYes")!;
const outcomeNo = $("outcomeNo")!;
const yesPrice = $("yesPrice")!;
const noPrice = $("noPrice")!;
const btnSideBuy = $("btnSideBuy")!;
const btnSideSell = $("btnSideSell")!;
const inputPrice = $("inputPrice") as HTMLInputElement;
const inputAmount = $("inputAmount") as HTMLInputElement;
const totalCost = $("totalCost")!;
const potentialReturn = $("potentialReturn")!;
const potentialProfit = $("potentialProfit")!;
const tradeWarning = $("tradeWarning")!;
const btnSubmitTrade = $("btnSubmitTrade")!;
const btnCloseModal = $("btnCloseModal")!;

// Portfolio/Orders
const portfolioValue = $("portfolioValue")!;
const totalPnl = $("totalPnl")!;
const positionCount = $("positionCount")!;
const positionsContainer = $("positionsContainer")!;
const ordersContainer = $("ordersContainer")!;

// ============= Initialize =============
async function init() {
  setupEventListeners();
  loadCredentials();
  await connectWebSocket();
  await fetchMarkets();
}

// ============= Event Listeners =============
function setupEventListeners() {
  // Navigation
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const view = (link as HTMLElement).dataset.view!;
      switchView(view);
    });
  });

  // Connect wallet
  btnConnect.onclick = connectWallet;

  // Search
  searchInput.oninput = () => renderMarkets();

  // Sort pills
  document.querySelectorAll(".pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      renderMarkets();
    });
  });

  // Layout toggle
  document.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const layout = (btn as HTMLElement).dataset.layout!;
      marketsContainer.className = `markets-container ${layout}-layout`;
    });
  });

  // Modal
  btnCloseModal.onclick = closeModal;
  tradeModal.querySelector(".modal-overlay")?.addEventListener("click", closeModal);

  // Outcome selection
  outcomeYes.onclick = () => selectOutcome(0);
  outcomeNo.onclick = () => selectOutcome(1);

  // Side toggle
  btnSideBuy.onclick = () => setSide("BUY");
  btnSideSell.onclick = () => setSide("SELL");

  // Price inputs
  inputPrice.oninput = updateCostCalculator;
  inputAmount.oninput = updateCostCalculator;

  // Quick buttons
  document.querySelectorAll("[data-price-type]").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = (btn as HTMLElement).dataset.priceType!;
      if (type === "bid") inputPrice.value = currentOrderBook.bids[0]?.price || "0.5";
      else if (type === "ask") inputPrice.value = currentOrderBook.asks[0]?.price || "0.5";
      else if (type === "mid") {
        const bid = Number(currentOrderBook.bids[0]?.price || 0.45);
        const ask = Number(currentOrderBook.asks[0]?.price || 0.55);
        inputPrice.value = ((bid + ask) / 2).toFixed(3);
      }
      updateCostCalculator();
    });
  });

  document.querySelectorAll("[data-amount-pct]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pct = Number((btn as HTMLElement).dataset.amountPct!);
      const price = Number(inputPrice.value) || 0.5;
      const maxShares = Math.floor(usdcBalance / price);
      inputAmount.value = String(Math.floor(maxShares * (pct / 100)));
      updateCostCalculator();
    });
  });

  // Submit trade
  btnSubmitTrade.onclick = submitTrade;

  // Portfolio refresh
  $("btnRefreshPortfolio")!.onclick = fetchPositions;
  $("btnRefreshOrders")!.onclick = fetchOrders;
  $("btnCancelAll")!.onclick = cancelAllOrders;
}

// ============= View Switching =============
function switchView(viewName: string) {
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", (link as HTMLElement).dataset.view === viewName);
  });

  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", (view as HTMLElement).dataset.view === viewName);
  });

  if (viewName === "portfolio" && signerAddress) fetchPositions();
  if (viewName === "orders" && signerAddress) fetchOrders();
}

// ============= WebSocket =============
async function connectWebSocket() {
  polymarketWS.onStatusChange((connected) => {
    wsStatus.className = `ws-indicator ${connected ? "connected" : "disconnected"}`;
    wsStatusText.textContent = connected ? "Live" : "Disconnected";
  });

  polymarketWS.onMessage((msg) => handleWSMessage(msg));

  try {
    await polymarketWS.connect();
  } catch (e) {
    console.error("WebSocket connection failed:", e);
  }
}

function handleWSMessage(msg: WebSocketMessage) {
  if (msg.event_type === "book") {
    // Full order book snapshot
    updateOrderBookUI(msg as BookMessage);
  } else if (msg.event_type === "price_change") {
    // Real-time price level changes - update market cards
    const priceMsg = msg as PriceChangeMessage;
    priceMsg.price_changes.forEach(pc => {
      const market = markets.find(m => m.clobTokenIds.includes(pc.asset_id));
      if (market) {
        const idx = market.clobTokenIds.indexOf(pc.asset_id);
        if (idx >= 0) {
          // Update with best bid (most relevant for display)
          market.outcomePrices[idx] = Number(pc.best_bid) || market.outcomePrices[idx];
          market.bestBid = Number(pc.best_bid);
          market.bestAsk = Number(pc.best_ask);
        }
        updateMarketCard(market);
      }
    });
  } else if (msg.event_type === "best_bid_ask") {
    // Quick best bid/ask updates
    const bbaMsg = msg as BestBidAskMessage;
    const market = markets.find(m => m.clobTokenIds.includes(bbaMsg.asset_id));
    if (market) {
      const idx = market.clobTokenIds.indexOf(bbaMsg.asset_id);
      if (idx >= 0) {
        market.outcomePrices[idx] = Number(bbaMsg.best_bid) || market.outcomePrices[idx];
        market.bestBid = Number(bbaMsg.best_bid);
        market.bestAsk = Number(bbaMsg.best_ask);
      }
      updateMarketCard(market);
    }
  } else if (msg.event_type === "last_trade_price") {
    // A trade happened - flash the card and update price
    const tradeMsg = msg as LastTradePriceMessage;
    const market = markets.find(m => m.clobTokenIds.includes(tradeMsg.asset_id));
    if (market) {
      const idx = market.clobTokenIds.indexOf(tradeMsg.asset_id);
      if (idx >= 0) {
        market.outcomePrices[idx] = Number(tradeMsg.price);
      }
      updateMarketCard(market);
      flashMarketCard(market.id);

      // If we have open orders for this asset, refresh state (order might have been filled)
      if (signerAddress && orders.some(o => o.asset_id === tradeMsg.asset_id)) {
        debouncedRefreshState();
      }
    }
  } else if (msg.event_type === "new_market") {
    // A new market was created - could add it to the list dynamically
    const newMarketMsg = msg as NewMarketMessage;
    console.log("[WS] New market created:", newMarketMsg.question);
    showToast(`New market: ${newMarketMsg.question.substring(0, 50)}...`, "success");
    // Optionally refetch markets to include the new one
    // fetchMarkets();
  } else if (msg.event_type === "market_resolved") {
    // Market resolved - update UI
    console.log("[WS] Market resolved:", msg);
    showToast("A market has been resolved!", "success");
  }
}

function updateOrderBookUI(book: BookMessage) {
  if (!selectedMarket) return;
  if (!selectedMarket.clobTokenIds.includes(book.asset_id)) return;

  currentOrderBook = {
    bids: book.bids || [],
    asks: book.asks || [],
  };

  // Update asks (reversed for display)
  const asks = [...(book.asks || [])].slice(0, 5).reverse();
  obAsks.innerHTML = asks.map(level => `
    <div class="ob-level ask">
      <span class="ob-price">${Number(level.price).toFixed(3)}</span>
      <span class="ob-size">${Number(level.size).toFixed(0)}</span>
    </div>
  `).join("") || '<div class="ob-level">No asks</div>';

  // Update bids
  const bids = (book.bids || []).slice(0, 5);
  obBids.innerHTML = bids.map(level => `
    <div class="ob-level bid">
      <span class="ob-price">${Number(level.price).toFixed(3)}</span>
      <span class="ob-size">${Number(level.size).toFixed(0)}</span>
    </div>
  `).join("") || '<div class="ob-level">No bids</div>';

  // Update spread
  const bestBid = Number(bids[0]?.price || 0);
  const bestAsk = Number(asks[asks.length - 1]?.price || 1);
  obSpread.textContent = `Spread: ${((bestAsk - bestBid) * 100).toFixed(1)}%`;

  // Update time
  obUpdateTime.textContent = new Date().toLocaleTimeString();
}

// ============= Fetch Markets =============
// Only called ONCE on startup - all subsequent updates come via WebSocket
async function fetchMarkets() {
  try {
    // Use CORS proxy for initial fetch only - WebSocket handles all live updates
    const apiUrl = `${GAMMA_API}/markets?active=true&closed=false&limit=50`;
    const response = await fetch(`${CORS_PROXY}${encodeURIComponent(apiUrl)}`);
    const data = await response.json();

    console.log(`[Markets] Loaded ${data.length} markets from API (one-time fetch)`);

    markets = data.map((m: any) => ({
      id: m.id,
      question: m.question,
      conditionId: m.conditionId,
      slug: m.slug,
      image: m.image || m.icon || "",
      outcomes: JSON.parse(m.outcomes || '["Yes","No"]'),
      outcomePrices: JSON.parse(m.outcomePrices || '[0.5,0.5]').map(Number),
      clobTokenIds: JSON.parse(m.clobTokenIds || '[]'),
      volume24hr: Number(m.volume24hr || 0),
      liquidity: Number(m.liquidityNum || m.liquidity || 0),
      negRisk: m.negRisk ?? false,
      tickSize: Number(m.orderPriceMinTickSize || 0.01),
      minSize: Number(m.orderMinSize || 1),
      bestBid: Number(m.bestBid || 0),
      bestAsk: Number(m.bestAsk || 1),
      oneDayPriceChange: Number(m.oneDayPriceChange || 0),
      endDate: m.endDate || "",
    }));

    // Subscribe to WebSocket for all markets - this enables live price updates
    console.log(`[WebSocket] Subscribing to ${markets.length} markets for live updates...`);
    markets.forEach(m => {
      if (m.conditionId) {
        polymarketWS.subscribeToMarket(m.conditionId);
      }
      // Also subscribe to individual assets for more granular updates
      m.clobTokenIds.forEach(tokenId => {
        polymarketWS.subscribeToAsset(tokenId);
      });
    });
    console.log("[WebSocket] Subscribed! All price updates now come via WebSocket (no more API polling)");

    renderMarkets();
  } catch (error) {
    console.error("Failed to fetch markets:", error);
    marketsContainer.innerHTML = '<div class="empty-state">Failed to load markets</div>';
  }
}

// ============= Render Markets =============
function renderMarkets() {
  const search = searchInput.value.toLowerCase();
  const sortBy = document.querySelector(".pill.active")?.getAttribute("data-sort") || "volume24hr";

  let filtered = markets.filter(m =>
    m.question.toLowerCase().includes(search)
  );

  // Sort
  filtered.sort((a, b) => {
    switch (sortBy) {
      case "volume24hr": return b.volume24hr - a.volume24hr;
      case "liquidity": return b.liquidity - a.liquidity;
      case "newest": return Number(b.id) - Number(a.id);
      case "ending": return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
      default: return 0;
    }
  });

  if (filtered.length === 0) {
    marketsContainer.innerHTML = '<div class="empty-state">No markets found</div>';
    return;
  }

  marketsContainer.innerHTML = filtered.map(m => createMarketCard(m)).join("");

  // Add click handlers
  document.querySelectorAll(".market-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = (card as HTMLElement).dataset.id!;
      const market = markets.find(m => m.id === id);
      if (market) openTradeModal(market);
    });
  });
}

function createMarketCard(m: Market): string {
  const yesPrice = (m.outcomePrices[0] * 100).toFixed(0);
  const noPrice = (m.outcomePrices[1] * 100).toFixed(0);
  const change = m.oneDayPriceChange * 100;
  const changeClass = change >= 0 ? "up" : "down";
  const changeSign = change >= 0 ? "+" : "";

  return `
    <div class="market-card" data-id="${m.id}">
      <div class="market-header">
        <img src="${m.image}" alt="" class="market-image" onerror="this.style.display='none'" />
        <h3 class="market-title">${escapeHtml(m.question)}</h3>
      </div>
      <div class="market-prices">
        <div class="price-box yes">
          <div class="price-label">Yes</div>
          <div class="price-value">${yesPrice}¢</div>
          <div class="price-change ${changeClass}">${changeSign}${change.toFixed(1)}%</div>
        </div>
        <div class="price-box no">
          <div class="price-label">No</div>
          <div class="price-value">${noPrice}¢</div>
        </div>
      </div>
      <div class="market-footer">
        <div class="market-stat">
          <span class="stat-label">24h Vol</span>
          <span class="stat-value">${formatVolume(m.volume24hr)}</span>
        </div>
        <div class="market-stat">
          <span class="stat-label">Liquidity</span>
          <span class="stat-value">${formatVolume(m.liquidity)}</span>
        </div>
        <div class="market-stat">
          <span class="stat-label"><span class="live-dot"></span>Live</span>
        </div>
      </div>
    </div>
  `;
}

function updateMarketCard(m: Market) {
  const card = document.querySelector(`.market-card[data-id="${m.id}"]`);
  if (!card) return;

  const yesBox = card.querySelector(".price-box.yes .price-value");
  const noBox = card.querySelector(".price-box.no .price-value");

  if (yesBox) yesBox.textContent = `${(m.outcomePrices[0] * 100).toFixed(0)}¢`;
  if (noBox) noBox.textContent = `${(m.outcomePrices[1] * 100).toFixed(0)}¢`;
}

function flashMarketCard(id: string) {
  const card = document.querySelector(`.market-card[data-id="${id}"]`);
  if (card) {
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 300);
  }
}

// ============= Trade Modal =============
function openTradeModal(market: Market) {
  selectedMarket = market;
  selectedOutcome = 0;
  tradeSide = "BUY";
  currentOrderBook = { bids: [], asks: [] };

  // Populate modal
  modalTitle.textContent = market.question;
  modalImage.src = market.image;
  modalVolume.textContent = `Vol: ${formatVolume(market.volume24hr)}`;
  modalLiquidity.textContent = `Liq: ${formatVolume(market.liquidity)}`;

  // Prices
  yesPrice.textContent = `${(market.outcomePrices[0] * 100).toFixed(0)}¢`;
  noPrice.textContent = `${(market.outcomePrices[1] * 100).toFixed(0)}¢`;

  // Reset form
  selectOutcome(0);
  setSide("BUY");
  inputPrice.value = market.bestAsk.toFixed(3);
  inputAmount.value = String(market.minSize);

  // Subscribe to this market's WebSocket
  if (market.clobTokenIds[selectedOutcome]) {
    polymarketWS.subscribeToAsset(market.clobTokenIds[selectedOutcome]);
  }

  // Fetch initial order book
  fetchOrderBook(market.clobTokenIds[selectedOutcome]);

  updateCostCalculator();
  updateTradeButton();

  tradeModal.classList.add("open");
}

function closeModal() {
  tradeModal.classList.remove("open");
  selectedMarket = null;
}

async function fetchOrderBook(tokenId: string) {
  if (!client && !signer) {
    // Use public endpoint
    try {
      const response = await fetch(`${HOST}/book?token_id=${tokenId}`);
      const book = await response.json();
      currentOrderBook = {
        bids: book.bids || [],
        asks: book.asks || [],
      };
      updateOrderBookUI({
        event_type: "book",
        asset_id: tokenId,
        market: "",
        bids: book.bids || [],
        asks: book.asks || [],
        timestamp: Date.now().toString(),
        hash: "",
      });
    } catch (e) {
      console.error("Failed to fetch order book:", e);
    }
  } else if (client) {
    try {
      const book = await client.getOrderBook(tokenId);
      currentOrderBook = {
        bids: book.bids || [],
        asks: book.asks || [],
      };
      updateOrderBookUI({
        event_type: "book",
        asset_id: tokenId,
        market: "",
        bids: book.bids || [],
        asks: book.asks || [],
        timestamp: Date.now().toString(),
        hash: "",
      });
    } catch (e) {
      console.error("Failed to fetch order book:", e);
    }
  }
}

function selectOutcome(index: number) {
  selectedOutcome = index;
  outcomeYes.classList.toggle("selected", index === 0);
  outcomeNo.classList.toggle("selected", index === 1);

  if (selectedMarket?.clobTokenIds[index]) {
    fetchOrderBook(selectedMarket.clobTokenIds[index]);
    polymarketWS.subscribeToAsset(selectedMarket.clobTokenIds[index]);
  }
}

function setSide(side: "BUY" | "SELL") {
  tradeSide = side;
  btnSideBuy.classList.toggle("active", side === "BUY");
  btnSideSell.classList.toggle("active", side === "SELL");
  updateCostCalculator();
  updateTradeButton();
}

function updateCostCalculator() {
  const price = Number(inputPrice.value) || 0;
  const amount = Number(inputAmount.value) || 0;

  const cost = price * amount;
  const payout = amount;
  const profit = payout - cost;
  const profitPct = cost > 0 ? (profit / cost) * 100 : 0;

  totalCost.textContent = `$${cost.toFixed(2)}`;
  potentialReturn.textContent = `$${payout.toFixed(2)}`;
  potentialProfit.textContent = `$${profit.toFixed(2)} (${profitPct.toFixed(0)}%)`;

  // Warnings
  const warnings: string[] = [];

  if (selectedMarket) {
    if (amount < selectedMarket.minSize) {
      warnings.push(`Min order size: ${selectedMarket.minSize} shares`);
    }
    if (cost > usdcBalance && tradeSide === "BUY") {
      warnings.push(`Insufficient balance ($${usdcBalance.toFixed(2)} available)`);
    }
  }

  if (warnings.length > 0) {
    tradeWarning.textContent = warnings.join(". ");
    tradeWarning.classList.remove("hidden");
    btnSubmitTrade.disabled = true;
  } else {
    tradeWarning.classList.add("hidden");
    btnSubmitTrade.disabled = !signerAddress;
  }
}

function updateTradeButton() {
  if (!signerAddress) {
    btnSubmitTrade.textContent = "Connect Wallet";
    btnSubmitTrade.className = "btn-trade";
    btnSubmitTrade.disabled = true;
  } else {
    btnSubmitTrade.textContent = tradeSide === "BUY" ? "Buy Shares" : "Sell Shares";
    btnSubmitTrade.className = `btn-trade ${tradeSide.toLowerCase()}`;
    updateCostCalculator();
  }
}

// ============= Submit Trade =============
async function submitTrade() {
  if (!selectedMarket || !client || !signerAddress || !signer) {
    showToast("Connect wallet first", "error");
    return;
  }

  const price = Number(inputPrice.value);
  const size = Number(inputAmount.value);
  const tokenId = selectedMarket.clobTokenIds[selectedOutcome];

  btnSubmitTrade.disabled = true;
  btnSubmitTrade.textContent = "Processing...";

  try {
    // Get market info
    const orderBook = await client.getOrderBook(tokenId);
    const negRisk = Boolean((orderBook as any).neg_risk ?? selectedMarket.negRisk);
    const tickSize = String(orderBook.tick_size || selectedMarket.tickSize) as TickSize;

    // Ensure approvals
    await ensureAllApprovals();

    // Submit order
    const response = await client.createAndPostOrder(
      { tokenID: tokenId, price, size, side: tradeSide === "BUY" ? Side.BUY : Side.SELL },
      { tickSize, negRisk },
      OrderType.GTC
    );

    showToast(`Order submitted! ID: ${response.orderID}`, "success");
    closeModal();

    // Immediately refresh state
    await refreshAllState();

    // Also refresh again after a short delay (API may take time to reflect changes)
    setTimeout(() => refreshAllState(), 2000);

  } catch (error: any) {
    console.error("Trade failed:", error);
    showToast(`Trade failed: ${error.message}`, "error");
  } finally {
    updateTradeButton();
  }
}

// Refresh all user state (balance, orders, positions)
let isRefreshing = false;
async function refreshAllState() {
  if (!signerAddress || isRefreshing) return;

  isRefreshing = true;
  console.log("[State] Refreshing balance, orders, positions...");

  // Show syncing indicator
  balanceDisplay.classList.add("syncing");
  wsStatusText.textContent = "Syncing...";

  try {
    // Refresh in parallel for speed
    await Promise.all([
      refreshBalance(),
      fetchOrders(),
      fetchPositions(),
    ]);
    console.log("[State] Refresh complete");
  } finally {
    isRefreshing = false;
    balanceDisplay.classList.remove("syncing");
    wsStatusText.textContent = polymarketWS.isConnected() ? "Live" : "Disconnected";
  }
}

// Debounced version to prevent too many refreshes from rapid trade events
let refreshTimeout: number | null = null;
function debouncedRefreshState() {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }
  refreshTimeout = window.setTimeout(() => {
    refreshAllState();
    refreshTimeout = null;
  }, 1500); // Wait 1.5s after last trade event before refreshing
}

// ============= Wallet Connection =============
async function connectWallet() {
  try {
    // @ts-ignore
    if (!window.ethereum) {
      showToast("MetaMask not found", "error");
      return;
    }

    btnConnect.querySelector(".btn-text")!.textContent = "Connecting...";

    // @ts-ignore
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    signerAddress = await signer.getAddress();

    const network = await provider.getNetwork();
    if (network.chainId !== CHAIN_ID) {
      showToast("Please switch to Polygon", "error");
      return;
    }

    await ensureApiCredentials();

    // Fetch all user state (balance, orders, positions)
    await refreshAllState();

    // Update UI
    btnConnect.querySelector(".btn-text")!.textContent = `${signerAddress.slice(0, 6)}...${signerAddress.slice(-4)}`;
    btnConnect.classList.add("connected");
    balanceDisplay.classList.remove("hidden");

    showToast("Wallet connected!", "success");
    updateTradeButton();

  } catch (error: any) {
    console.error("Connection failed:", error);
    showToast(error.message, "error");
    btnConnect.querySelector(".btn-text")!.textContent = "Connect Wallet";
  }
}

async function ensureApiCredentials() {
  const stored = localStorage.getItem("POLY_USER_API_CREDS");
  if (stored) {
    try {
      apiCreds = JSON.parse(stored);
      if (apiCreds?.key && apiCreds?.secret && apiCreds?.passphrase) {
        client = new ClobClient(HOST, CHAIN_ID, signer as any, apiCreds, 0, signerAddress!);
        return;
      }
    } catch {}
  }

  const temp = new ClobClient(HOST, CHAIN_ID, signer as any);
  const derived: any = await temp.createOrDeriveApiKey();

  apiCreds = {
    key: derived.key ?? derived.apiKey,
    secret: derived.secret,
    passphrase: derived.passphrase,
  };

  localStorage.setItem("POLY_USER_API_CREDS", JSON.stringify(apiCreds));
  client = new ClobClient(HOST, CHAIN_ID, signer as any, apiCreds, 0, signerAddress!);
}

async function refreshBalance() {
  if (!signer || !signerAddress) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const balance = await usdc.balanceOf(signerAddress);
  usdcBalance = Number(ethers.utils.formatUnits(balance, 6));

  balanceDisplay.querySelector(".balance-amount")!.textContent = `$${usdcBalance.toFixed(2)}`;
}

function loadCredentials() {
  const stored = localStorage.getItem("POLY_USER_API_CREDS");
  if (stored) {
    try {
      apiCreds = JSON.parse(stored);
    } catch {}
  }
}

async function ensureAllApprovals() {
  if (!signer || !signerAddress) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);

  const spenders = [ADDRESSES.CTF, ADDRESSES.CTF_EXCHANGE, ADDRESSES.NEG_RISK_CTF_EXCHANGE, ADDRESSES.NEG_RISK_ADAPTER];
  const operators = [ADDRESSES.CTF_EXCHANGE, ADDRESSES.NEG_RISK_CTF_EXCHANGE, ADDRESSES.NEG_RISK_ADAPTER];

  for (const spender of spenders) {
    const allowance = await usdc.allowance(signerAddress, spender);
    if (allowance.eq(0)) {
      const tx = await usdc.approve(spender, ethers.constants.MaxUint256);
      await tx.wait();
    }
  }

  for (const operator of operators) {
    const approved = await ctf.isApprovedForAll(signerAddress, operator);
    if (!approved) {
      const tx = await ctf.setApprovalForAll(operator, true);
      await tx.wait();
    }
  }
}

// ============= Positions =============
async function fetchPositions() {
  if (!signerAddress) return;

  positionsContainer.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    const response = await fetch(`${DATA_API}/positions?user=${signerAddress.toLowerCase()}&sizeThreshold=1&limit=100`);
    const data = await response.json();

    positions = (data || []).map((p: any) => ({
      asset: p.asset,
      title: p.title || "Unknown",
      image: p.image || "",
      outcome: p.outcome || "Yes",
      size: Number(p.size || 0),
      avgPrice: Number(p.avgPrice || 0),
      currentPrice: Number(p.curPrice || 0),
      pnl: Number(p.cashPnl || 0),
      negRisk: p.negativeRisk ?? false,
    }));

    renderPositions();

  } catch (error) {
    console.error("Failed to fetch positions:", error);
    positionsContainer.innerHTML = '<div class="empty-state">Failed to load positions</div>';
  }
}

function renderPositions() {
  const total = positions.reduce((sum, p) => sum + (p.size * p.currentPrice), 0);
  const pnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  portfolioValue.textContent = `$${total.toFixed(2)}`;
  totalPnl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
  totalPnl.className = `summary-value ${pnl >= 0 ? "profit" : "loss"}`;
  positionCount.textContent = String(positions.length);

  if (positions.length === 0) {
    positionsContainer.innerHTML = '<div class="empty-state">No positions found</div>';
    return;
  }

  positionsContainer.innerHTML = positions.map(p => `
    <div class="position-card">
      <img src="${p.image}" class="position-image" onerror="this.style.display='none'" />
      <div class="position-info">
        <div class="position-title">${escapeHtml(p.title)}</div>
        <span class="position-outcome ${p.outcome.toLowerCase()}">${p.outcome}</span>
      </div>
      <div class="position-stats">
        <div class="position-stat">
          <div class="position-stat-label">Shares</div>
          <div class="position-stat-value">${p.size.toFixed(2)}</div>
        </div>
        <div class="position-stat">
          <div class="position-stat-label">Avg</div>
          <div class="position-stat-value">$${p.avgPrice.toFixed(3)}</div>
        </div>
        <div class="position-stat">
          <div class="position-stat-label">Current</div>
          <div class="position-stat-value">$${p.currentPrice.toFixed(3)}</div>
        </div>
        <div class="position-stat">
          <div class="position-stat-label">P&L</div>
          <div class="position-stat-value ${p.pnl >= 0 ? "profit" : "loss"}">${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(2)}</div>
        </div>
      </div>
      <div class="position-actions">
        <button class="btn-success" onclick="sellPosition('${p.asset}')">Sell</button>
      </div>
    </div>
  `).join("");
}

// ============= Orders =============
async function fetchOrders() {
  if (!client) return;

  ordersContainer.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    const data = await client.getOpenOrders();
    orders = (data || []).map((o: any) => ({
      id: o.id,
      asset_id: o.asset_id,
      market: o.market,
      side: o.side,
      price: Number(o.price),
      size: Number(o.original_size || o.size),
      filled: Number(o.size_matched || 0),
      status: o.status,
    }));

    renderOrders();

  } catch (error) {
    console.error("Failed to fetch orders:", error);
    ordersContainer.innerHTML = '<div class="empty-state">Failed to load orders</div>';
  }
}

function renderOrders() {
  if (orders.length === 0) {
    ordersContainer.innerHTML = '<div class="empty-state">No open orders</div>';
    return;
  }

  ordersContainer.innerHTML = orders.map(o => `
    <div class="order-card">
      <span class="order-side ${o.side.toLowerCase()}">${o.side}</span>
      <div class="order-info">
        <div class="order-market">${o.market.slice(0, 20)}...</div>
        <div class="order-details">$${o.price.toFixed(3)} x ${o.size} (${o.filled} filled)</div>
      </div>
      <button class="btn-danger" onclick="cancelOrder('${o.id}')">Cancel</button>
    </div>
  `).join("");
}

async function cancelAllOrders() {
  if (!client || orders.length === 0) return;
  if (!confirm(`Cancel all ${orders.length} orders?`)) return;

  try {
    await client.cancelAll();
    showToast("All orders cancelled", "success");
    // Refresh all state
    await refreshAllState();
  } catch (error: any) {
    showToast(`Failed: ${error.message}`, "error");
  }
}

// Make functions available globally for onclick handlers
(window as any).cancelOrder = async (orderId: string) => {
  if (!client) return;
  try {
    await client.cancelOrder({ orderID: orderId });
    showToast("Order cancelled", "success");
    // Refresh all state (balance may change if order was partially filled)
    await refreshAllState();
  } catch (error: any) {
    showToast(`Failed: ${error.message}`, "error");
  }
};

(window as any).sellPosition = async (asset: string) => {
  const position = positions.find(p => p.asset === asset);
  if (!position) return;

  const market = markets.find(m => m.clobTokenIds.includes(asset));
  if (market) {
    openTradeModal(market);
    setSide("SELL");
    inputAmount.value = position.size.toFixed(2);
    updateCostCalculator();
  }
};

// ============= Helpers =============
function formatVolume(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message: string, type: "success" | "error" = "success") {
  const container = $("toastContainer")!;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === "success" ? "✓" : "✕"}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// ============= Start =============
init();
