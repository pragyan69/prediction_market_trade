// Trading App - Main Entry Point
import { ethers } from "ethers";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import type { ApiKeyCreds, TickSize } from "@polymarket/clob-client";
import {
  MarketPoller,
  sortMarkets,
  filterMarkets,
  formatVolume,
  formatPrice,
  formatPriceChange,
  type Market,
} from "./marketsApi";

// Constants
const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const SIGNATURE_TYPE = 0;

const ADDRESSES = {
  USDCe: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
} as const;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

const CTF_ABI = [
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
  "function balanceOf(address,uint256) view returns (uint256)",
];

// State
let provider: ethers.providers.Web3Provider | null = null;
let signer: ethers.Signer | null = null;
let signerAddress: string | null = null;
let apiCreds: ApiKeyCreds | null = null;
let client: ClobClient | null = null;
let usdcBalance: number = 0;

let selectedMarket: Market | null = null;
let selectedOutcomeIndex: number = 0;
let tradeSide: "BUY" | "SELL" = "BUY";

// Positions & Orders
interface Position {
  asset: string;
  conditionId: string;
  outcome: string;
  outcomeIndex: number;
  size: number;
  avgPrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  title: string;
  image: string;
  slug: string;
  negRisk: boolean;
  tickSize: string;
}

interface Order {
  id: string;
  asset_id: string;
  market: string;
  side: string;
  price: number;
  original_size: number;
  size_matched: number;
  status: string;
  outcome: string;
  created_at: string;
  title?: string;
}

let userPositions: Position[] = [];
let userOrders: Order[] = [];
let positionsWithOnChainBalances: (Position & { onChainBalance: number })[] = [];

const CORS_PROXY = "https://corsproxy.io/?url=";

// DOM Elements
const $ = (id: string) => document.getElementById(id);

const btnConnectWallet = $("btnConnectWallet") as HTMLButtonElement;
const walletBalance = $("walletBalance") as HTMLDivElement;
const usdcBalanceEl = $("usdcBalance") as HTMLSpanElement;
const marketsGrid = $("marketsGrid") as HTMLDivElement;
const marketCount = $("marketCount") as HTMLSpanElement;
const sortByEl = $("sortBy") as HTMLSelectElement;
const minLiquidityEl = $("minLiquidity") as HTMLInputElement;
const searchMarketsEl = $("searchMarkets") as HTMLInputElement;
const btnRefreshMarkets = $("btnRefreshMarkets") as HTMLButtonElement;
const autoRefreshEl = $("autoRefresh") as HTMLInputElement;

// Positions & Orders elements
const positionsGrid = $("positionsGrid") as HTMLDivElement;
const ordersGrid = $("ordersGrid") as HTMLDivElement;
const btnRefreshPositions = $("btnRefreshPositions") as HTMLButtonElement;
const btnRefreshOrders = $("btnRefreshOrders") as HTMLButtonElement;
const btnCancelAllOrders = $("btnCancelAllOrders") as HTMLButtonElement;
const positionsCountEl = $("positionsCount") as HTMLSpanElement;
const openOrdersCountEl = $("openOrdersCount") as HTMLSpanElement;
const positionsTotalValue = $("positionsTotalValue") as HTMLSpanElement;

// Modal elements
const tradeModal = $("tradeModal") as HTMLDivElement;
const modalMarketTitle = $("modalMarketTitle") as HTMLHeadingElement;
const modalMarketImage = $("modalMarketImage") as HTMLImageElement;
const modalMarketDescription = $("modalMarketDescription") as HTMLParagraphElement;
const outcomeButtons = $("outcomeButtons") as HTMLDivElement;
const bestBidEl = $("bestBid") as HTMLSpanElement;
const bestAskEl = $("bestAsk") as HTMLSpanElement;
const spreadEl = $("spread") as HTMLSpanElement;
const btnBuy = $("btnBuy") as HTMLButtonElement;
const btnSell = $("btnSell") as HTMLButtonElement;
const tradePriceEl = $("tradePrice") as HTMLInputElement;
const tradeSizeEl = $("tradeSize") as HTMLInputElement;
const totalCostEl = $("totalCost") as HTMLSpanElement;
const potentialPayoutEl = $("potentialPayout") as HTMLSpanElement;
const potentialProfitEl = $("potentialProfit") as HTMLSpanElement;
const minOrderSizeEl = $("minOrderSize") as HTMLSpanElement;
const tradeWarnings = $("tradeWarnings") as HTMLDivElement;
const btnSubmitTrade = $("btnSubmitTrade") as HTMLButtonElement;
const btnCloseModal = $("btnCloseModal") as HTMLButtonElement;

// Market Poller
const poller = new MarketPoller(10000);
let allMarkets: Market[] = [];

// Initialize
function init() {
  setupEventListeners();
  loadCredentials();
  startMarketPolling();
}

// Event Listeners
function setupEventListeners() {
  btnConnectWallet.onclick = connectWallet;
  btnRefreshMarkets.onclick = () => poller.refresh();
  btnCloseModal.onclick = closeModal;
  tradeModal.querySelector(".modal-backdrop")?.addEventListener("click", closeModal);

  // Tabs
  document.querySelectorAll(".content-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = (tab as HTMLElement).dataset.tab;
      switchTab(tabName!);
    });
  });

  // Positions & Orders
  btnRefreshPositions.onclick = fetchAndRenderPositions;
  btnRefreshOrders.onclick = fetchAndRenderOrders;
  btnCancelAllOrders.onclick = cancelAllOrders;

  // Filters
  sortByEl.onchange = renderMarkets;
  minLiquidityEl.oninput = renderMarkets;
  searchMarketsEl.oninput = renderMarkets;

  autoRefreshEl.onchange = () => {
    if (autoRefreshEl.checked) {
      poller.start();
    } else {
      poller.stop();
    }
  };

  // Trade form
  btnBuy.onclick = () => setSide("BUY");
  btnSell.onclick = () => setSide("SELL");
  tradePriceEl.oninput = updateCostCalculator;
  tradeSizeEl.oninput = updateCostCalculator;

  // Price shortcuts
  document.querySelectorAll(".btn-price").forEach(btn => {
    btn.addEventListener("click", () => {
      const priceType = (btn as HTMLButtonElement).dataset.price;
      if (!selectedMarket) return;

      let price = 0;
      if (priceType === "bid") price = selectedMarket.bestBid;
      else if (priceType === "ask") price = selectedMarket.bestAsk;
      else if (priceType === "mid") price = (selectedMarket.bestBid + selectedMarket.bestAsk) / 2;

      tradePriceEl.value = price.toFixed(3);
      updateCostCalculator();
    });
  });

  // Size shortcuts
  document.querySelectorAll(".btn-size").forEach(btn => {
    btn.addEventListener("click", () => {
      const pct = Number((btn as HTMLButtonElement).dataset.pct);
      if (!selectedMarket || !usdcBalance) return;

      const price = Number(tradePriceEl.value) || selectedMarket.bestAsk;
      const maxShares = Math.floor(usdcBalance / price);
      const shares = Math.floor(maxShares * (pct / 100));

      tradeSizeEl.value = String(Math.max(shares, selectedMarket.orderMinSize));
      updateCostCalculator();
    });
  });

  // Submit trade
  btnSubmitTrade.onclick = submitTrade;
}

// Wallet Connection
async function connectWallet() {
  try {
    // @ts-ignore
    if (!window.ethereum) {
      alert("MetaMask not found. Please install MetaMask.");
      return;
    }

    btnConnectWallet.textContent = "Connecting...";
    btnConnectWallet.disabled = true;

    // @ts-ignore
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    signerAddress = await signer.getAddress();

    // Check network
    const network = await provider.getNetwork();
    if (network.chainId !== CHAIN_ID) {
      alert("Please switch to Polygon Mainnet (chainId 137)");
      btnConnectWallet.textContent = "Wrong Network";
      btnConnectWallet.disabled = false;
      return;
    }

    // Load or derive API credentials
    await ensureApiCredentials();

    // Get USDC balance
    await refreshBalance();

    // Update UI
    btnConnectWallet.textContent = `${signerAddress.slice(0, 6)}...${signerAddress.slice(-4)}`;
    btnConnectWallet.classList.add("connected");
    walletBalance.textContent = `$${usdcBalance.toFixed(2)} USDC`;

    // Fetch positions and orders count
    fetchAndRenderPositions();
    fetchAndRenderOrders();

    updateTradeButton();
  } catch (error: any) {
    console.error("Connection failed:", error);
    btnConnectWallet.textContent = "Connect Wallet";
    btnConnectWallet.disabled = false;
    alert(error.message || "Failed to connect wallet");
  }
}

async function ensureApiCredentials() {
  // Try to load from storage
  const stored = localStorage.getItem("POLY_USER_API_CREDS");
  if (stored) {
    try {
      apiCreds = JSON.parse(stored);
      if (apiCreds?.key && apiCreds?.secret && apiCreds?.passphrase) {
        await buildClient();
        return;
      }
    } catch {}
  }

  // Derive new credentials
  if (!signer) throw new Error("Signer required");

  const temp = new ClobClient(HOST, CHAIN_ID, signer as any);
  const derived: any = await temp.createOrDeriveApiKey();

  apiCreds = {
    key: derived.key ?? derived.apiKey,
    secret: derived.secret,
    passphrase: derived.passphrase,
  };

  localStorage.setItem("POLY_USER_API_CREDS", JSON.stringify(apiCreds));
  await buildClient();
}

async function buildClient() {
  if (!signer || !apiCreds || !signerAddress) return;
  client = new ClobClient(HOST, CHAIN_ID, signer as any, apiCreds, SIGNATURE_TYPE, signerAddress);
}

async function refreshBalance() {
  if (!signer || !signerAddress) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const balance = await usdc.balanceOf(signerAddress);
  const decimals = await usdc.decimals();
  usdcBalance = Number(ethers.utils.formatUnits(balance, decimals));

  usdcBalanceEl.textContent = `$${usdcBalance.toFixed(2)}`;
  walletBalance.textContent = `$${usdcBalance.toFixed(2)} USDC`;
}

function loadCredentials() {
  const stored = localStorage.getItem("POLY_USER_API_CREDS");
  if (stored) {
    try {
      apiCreds = JSON.parse(stored);
    } catch {}
  }
}

// Market Polling
function startMarketPolling() {
  poller.subscribe(markets => {
    allMarkets = markets;
    renderMarkets();
  });

  poller.start();
}

// Render Markets
function renderMarkets() {
  let markets = [...allMarkets];

  // Apply filters
  markets = filterMarkets(markets, {
    search: searchMarketsEl.value,
    minLiquidity: Number(minLiquidityEl.value) || 0,
  });

  // Apply sorting
  markets = sortMarkets(markets, sortByEl.value);

  // Update count
  marketCount.textContent = `${markets.length} markets`;

  // Render cards
  if (markets.length === 0) {
    marketsGrid.innerHTML = '<div class="loading">No markets found</div>';
    return;
  }

  marketsGrid.innerHTML = markets.map(market => createMarketCard(market)).join("");

  // Add click handlers
  document.querySelectorAll(".market-card").forEach(card => {
    card.addEventListener("click", () => {
      const marketId = (card as HTMLElement).dataset.marketId;
      const market = allMarkets.find(m => m.id === marketId);
      if (market) openTradeModal(market);
    });
  });
}

function createMarketCard(market: Market): string {
  const yesPrice = market.outcomePrices[0] || 0.5;
  const noPrice = market.outcomePrices[1] || 0.5;
  const priceChange = formatPriceChange(market.oneDayPriceChange);

  return `
    <div class="market-card" data-market-id="${market.id}">
      <div class="market-card-header">
        <img src="${market.image}" alt="" class="market-image" onerror="this.style.display='none'" />
        <h3 class="market-title">${escapeHtml(market.question)}</h3>
      </div>
      <div class="market-prices">
        <div class="outcome-price yes">
          <div class="outcome-label">Yes</div>
          <div class="outcome-value">${formatPrice(yesPrice)}</div>
        </div>
        <div class="outcome-price no">
          <div class="outcome-label">No</div>
          <div class="outcome-value">${formatPrice(noPrice)}</div>
        </div>
      </div>
      <div class="market-stats">
        <div class="market-stat">
          <span class="market-stat-label">24h Vol</span>
          <span class="market-stat-value">${formatVolume(market.volume24hr)}</span>
        </div>
        <div class="market-stat">
          <span class="market-stat-label">Liquidity</span>
          <span class="market-stat-value">${formatVolume(market.liquidity)}</span>
        </div>
        <div class="market-stat">
          <span class="market-stat-label">24h</span>
          <span class="market-stat-value price-change ${priceChange.isPositive ? 'up' : 'down'}">${priceChange.text}</span>
        </div>
      </div>
    </div>
  `;
}

// Trade Modal
function openTradeModal(market: Market) {
  selectedMarket = market;
  selectedOutcomeIndex = 0;
  tradeSide = "BUY";

  // Populate modal
  modalMarketTitle.textContent = market.question;
  modalMarketImage.src = market.image;
  modalMarketDescription.textContent = market.description;

  // Outcome buttons
  outcomeButtons.innerHTML = market.outcomes.map((outcome, i) => `
    <button class="btn-outcome ${outcome.toLowerCase()} ${i === 0 ? 'selected' : ''}" data-index="${i}">
      <span class="outcome-name">${outcome}</span>
      <span class="outcome-price">${formatPrice(market.outcomePrices[i])}</span>
    </button>
  `).join("");

  document.querySelectorAll(".btn-outcome").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-outcome").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedOutcomeIndex = Number((btn as HTMLButtonElement).dataset.index);
      updateOrderbook();
      updateCostCalculator();
    });
  });

  // Order book
  updateOrderbook();

  // Trade form defaults
  tradePriceEl.value = market.bestAsk.toFixed(3);
  tradeSizeEl.value = String(market.orderMinSize);
  minOrderSizeEl.textContent = `${market.orderMinSize} shares`;

  // Side buttons
  setSide("BUY");

  // Calculate costs
  updateCostCalculator();

  // Update submit button
  updateTradeButton();

  // Show modal
  tradeModal.classList.remove("hidden");
}

function closeModal() {
  tradeModal.classList.add("hidden");
  selectedMarket = null;
}

function updateOrderbook() {
  if (!selectedMarket) return;

  bestBidEl.textContent = selectedMarket.bestBid.toFixed(3);
  bestAskEl.textContent = selectedMarket.bestAsk.toFixed(3);
  spreadEl.textContent = selectedMarket.spread.toFixed(3);
}

function setSide(side: "BUY" | "SELL") {
  tradeSide = side;

  btnBuy.classList.toggle("active", side === "BUY");
  btnSell.classList.toggle("active", side === "SELL");

  updateCostCalculator();
  updateTradeButton();
}

function updateCostCalculator() {
  if (!selectedMarket) return;

  const price = Number(tradePriceEl.value) || 0;
  const size = Number(tradeSizeEl.value) || 0;

  const cost = price * size;
  const payout = size; // Each share pays $1 if correct
  const profit = payout - cost;

  totalCostEl.textContent = `$${cost.toFixed(2)}`;
  potentialPayoutEl.textContent = `$${payout.toFixed(2)}`;
  potentialProfitEl.textContent = `$${profit.toFixed(2)}`;

  // Warnings
  const warnings: string[] = [];

  if (size < selectedMarket.orderMinSize) {
    warnings.push(`Minimum order size is ${selectedMarket.orderMinSize} shares`);
  }

  if (cost > usdcBalance && tradeSide === "BUY") {
    warnings.push(`Insufficient balance. You have $${usdcBalance.toFixed(2)} USDC`);
  }

  if (price <= 0 || price >= 1) {
    warnings.push("Price must be between 0 and 1");
  }

  // Check tick size
  const tickSize = selectedMarket.orderPriceMinTickSize;
  const priceRounded = Math.round(price / tickSize) * tickSize;
  if (Math.abs(price - priceRounded) > 0.0001) {
    warnings.push(`Price must be a multiple of ${tickSize}`);
  }

  if (warnings.length > 0) {
    tradeWarnings.innerHTML = warnings.join("<br>");
    tradeWarnings.classList.remove("hidden");
    btnSubmitTrade.disabled = true;
  } else {
    tradeWarnings.classList.add("hidden");
    btnSubmitTrade.disabled = !signerAddress;
  }
}

function updateTradeButton() {
  if (!signerAddress) {
    btnSubmitTrade.textContent = "Connect Wallet to Trade";
    btnSubmitTrade.className = "btn-submit";
    btnSubmitTrade.disabled = true;
  } else {
    btnSubmitTrade.textContent = tradeSide === "BUY" ? "Buy Shares" : "Sell Shares";
    btnSubmitTrade.className = `btn-submit ${tradeSide.toLowerCase()}`;
    updateCostCalculator(); // Re-check for valid trade
  }
}

// Submit Trade
async function submitTrade() {
  if (!selectedMarket || !client || !signerAddress || !signer) {
    alert("Please connect your wallet first");
    return;
  }

  const price = Number(tradePriceEl.value);
  const size = Number(tradeSizeEl.value);
  const tokenId = selectedMarket.clobTokenIds[selectedOutcomeIndex];

  if (!tokenId) {
    alert("Invalid token ID for selected outcome");
    return;
  }

  btnSubmitTrade.disabled = true;
  btnSubmitTrade.textContent = "Fetching market info...";

  try {
    // IMPORTANT: Fetch actual market info to get correct negRisk status
    const orderBook = await client.getOrderBook(tokenId);
    const negRisk = Boolean((orderBook as any).neg_risk ?? selectedMarket.negRisk);
    const tickSize = String(orderBook.tick_size || selectedMarket.orderPriceMinTickSize) as TickSize;

    console.log("Market info:", { tokenId, negRisk, tickSize });

    // For SELL orders, check actual token balance first
    if (tradeSide === "SELL") {
      btnSubmitTrade.textContent = "Checking token balance...";

      // Check balance via CTF contract (direct on-chain)
      const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);
      const tokenBalance = await ctf.balanceOf(signerAddress, tokenId);
      const balanceFormatted = Number(ethers.utils.formatUnits(tokenBalance, 6));

      // Also try to get balance from CLOB API (may have more accurate neg-risk data)
      let clobBalance = 0;
      try {
        const balanceData = await client.getBalanceAllowance({ asset_type: "CONDITIONAL", token_id: tokenId });
        clobBalance = Number(balanceData?.balance || 0);
        console.log("CLOB balance data:", balanceData);
      } catch (e) {
        console.log("Could not fetch CLOB balance:", e);
      }

      console.log("Token balance check:", {
        tokenId,
        negRisk,
        onChainBalance: tokenBalance.toString(),
        onChainFormatted: balanceFormatted,
        clobBalance,
        tryingToSell: size
      });

      // Use the higher of the two balances (CLOB API is usually more accurate for neg-risk)
      const effectiveBalance = Math.max(balanceFormatted, clobBalance);

      if (effectiveBalance < size * 0.99) { // 1% tolerance
        alert(`Insufficient token balance!\n\nOn-chain balance: ${balanceFormatted.toFixed(4)} tokens\nCLOB balance: ${clobBalance.toFixed(4)} tokens\nTrying to sell: ${size} tokens\n\n${negRisk ? "This is a neg-risk market - tokens may be wrapped differently." : ""}`);
        updateTradeButton();
        return;
      }
    }

    btnSubmitTrade.textContent = "Checking approvals...";

    // Ensure ALL approvals (always check both regular and neg-risk to be safe)
    await ensureAllApprovals();

    // Debug: Check all approval statuses
    await debugApprovalStatus();

    btnSubmitTrade.textContent = "Submitting order...";

    // Submit order
    const side = tradeSide === "BUY" ? Side.BUY : Side.SELL;

    const response = await client.createAndPostOrder(
      { tokenID: tokenId, price, size, side },
      { tickSize, negRisk },
      OrderType.GTC
    );

    alert(`Order submitted!\nOrder ID: ${response.orderID}\nStatus: ${response.status}`);
    closeModal();

    // Refresh balance and positions
    await refreshBalance();
    await fetchAndRenderPositions();
    await fetchAndRenderOrders();
  } catch (error: any) {
    console.error("Trade failed:", error);

    // More helpful error message
    let errorMsg = error.message || String(error);
    if (errorMsg.includes("not enough balance") || errorMsg.includes("allowance")) {
      errorMsg += "\n\nPossible causes:\n1. Token balance is 0 (check console logs)\n2. Approvals not confirmed on-chain yet\n3. For neg-risk markets, tokens may be held differently";
    }

    alert(`Trade failed: ${errorMsg}`);
  } finally {
    updateTradeButton();
  }
}

// Debug function to check all approval statuses
async function debugApprovalStatus() {
  if (!signer || !signerAddress) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);

  const approvalStatus = {
    "USDC Allowances": {
      CTF: ethers.utils.formatUnits(await usdc.allowance(signerAddress, ADDRESSES.CTF), 6),
      CTF_EXCHANGE: ethers.utils.formatUnits(await usdc.allowance(signerAddress, ADDRESSES.CTF_EXCHANGE), 6),
      NEG_RISK_CTF_EXCHANGE: ethers.utils.formatUnits(await usdc.allowance(signerAddress, ADDRESSES.NEG_RISK_CTF_EXCHANGE), 6),
      NEG_RISK_ADAPTER: ethers.utils.formatUnits(await usdc.allowance(signerAddress, ADDRESSES.NEG_RISK_ADAPTER), 6),
    },
    "CTF ApprovalForAll": {
      CTF_EXCHANGE: await ctf.isApprovedForAll(signerAddress, ADDRESSES.CTF_EXCHANGE),
      NEG_RISK_CTF_EXCHANGE: await ctf.isApprovedForAll(signerAddress, ADDRESSES.NEG_RISK_CTF_EXCHANGE),
      NEG_RISK_ADAPTER: await ctf.isApprovedForAll(signerAddress, ADDRESSES.NEG_RISK_ADAPTER),
    }
  };

  console.log("Current approval status:", approvalStatus);
}

async function ensureApprovals(negRisk: boolean) {
  if (!signer || !signerAddress) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);

  // Check and set ERC20 approvals
  const spenders = [
    ADDRESSES.CTF,
    ADDRESSES.CTF_EXCHANGE,
    ...(negRisk ? [ADDRESSES.NEG_RISK_CTF_EXCHANGE, ADDRESSES.NEG_RISK_ADAPTER] : []),
  ];

  for (const spender of spenders) {
    const allowance = await usdc.allowance(signerAddress, spender);
    if (allowance.eq(0)) {
      const tx = await usdc.approve(spender, ethers.constants.MaxUint256);
      await tx.wait();
    }
  }

  // Check and set ERC1155 approvals
  const operators = [
    ADDRESSES.CTF_EXCHANGE,
    ...(negRisk ? [ADDRESSES.NEG_RISK_CTF_EXCHANGE, ADDRESSES.NEG_RISK_ADAPTER] : []),
  ];

  for (const operator of operators) {
    const approved = await ctf.isApprovedForAll(signerAddress, operator);
    if (!approved) {
      const tx = await ctf.setApprovalForAll(operator, true);
      await tx.wait();
    }
  }
}

// Ensure ALL approvals for both regular and neg-risk markets
async function ensureAllApprovals() {
  if (!signer || !signerAddress) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);

  // ALL ERC20 spenders
  const allSpenders = [
    { address: ADDRESSES.CTF, name: "CTF" },
    { address: ADDRESSES.CTF_EXCHANGE, name: "CTF_EXCHANGE" },
    { address: ADDRESSES.NEG_RISK_CTF_EXCHANGE, name: "NEG_RISK_CTF_EXCHANGE" },
    { address: ADDRESSES.NEG_RISK_ADAPTER, name: "NEG_RISK_ADAPTER" },
  ];

  for (const spender of allSpenders) {
    const allowance = await usdc.allowance(signerAddress, spender.address);
    if (allowance.eq(0)) {
      console.log(`Approving USDC for ${spender.name}...`);
      const tx = await usdc.approve(spender.address, ethers.constants.MaxUint256);
      await tx.wait();
      console.log(`Approved USDC for ${spender.name}`);
    }
  }

  // ALL ERC1155 operators (for selling)
  const allOperators = [
    { address: ADDRESSES.CTF_EXCHANGE, name: "CTF_EXCHANGE" },
    { address: ADDRESSES.NEG_RISK_CTF_EXCHANGE, name: "NEG_RISK_CTF_EXCHANGE" },
    { address: ADDRESSES.NEG_RISK_ADAPTER, name: "NEG_RISK_ADAPTER" },
  ];

  for (const operator of allOperators) {
    const approved = await ctf.isApprovedForAll(signerAddress, operator.address);
    if (!approved) {
      console.log(`Approving CTF for ${operator.name}...`);
      const tx = await ctf.setApprovalForAll(operator.address, true);
      await tx.wait();
      console.log(`Approved CTF for ${operator.name}`);
    }
  }

  console.log("All approvals complete!");
}

// Helpers
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Tab Switching
function switchTab(tabName: string) {
  // Update tab buttons
  document.querySelectorAll(".content-tab").forEach(tab => {
    tab.classList.toggle("active", (tab as HTMLElement).dataset.tab === tabName);
  });

  // Update tab panels
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", (panel as HTMLElement).dataset.panel === tabName);
  });

  // Load data for the tab
  if (tabName === "positions" && signerAddress) {
    fetchAndRenderPositions();
  } else if (tabName === "orders" && signerAddress) {
    fetchAndRenderOrders();
  }
}

// Fetch and Render Positions
async function fetchAndRenderPositions() {
  if (!signerAddress) {
    positionsGrid.innerHTML = '<div class="empty-state">Connect wallet to view positions</div>';
    return;
  }

  positionsGrid.innerHTML = '<div class="loading">Loading positions...</div>';

  try {
    // Use same API as old page - direct call with sizeThreshold=1
    const apiUrl = `https://data-api.polymarket.com/positions?sizeThreshold=1&limit=100&sortBy=TOKENS&sortDirection=DESC&user=${signerAddress.toLowerCase()}`;

    let data;
    try {
      // Try direct call first (works if CORS allows)
      const response = await fetch(apiUrl);
      data = await response.json();
      console.log("Direct API call succeeded:", data?.length, "positions");
    } catch (corsError) {
      // Fall back to CORS proxy if direct call fails
      console.log("Direct call failed, using CORS proxy...");
      const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;
      const response = await fetch(proxyUrl);
      data = await response.json();
    }

    console.log("Raw positions data:", data);

    userPositions = (data || []).map((p: any) => ({
      asset: p.asset,
      conditionId: p.conditionId,
      outcome: p.outcome || (p.outcomeIndex === 0 ? "Yes" : "No"),
      outcomeIndex: p.outcomeIndex ?? 0,
      size: Number(p.size || 0),
      avgPrice: Number(p.avgPrice || 0),
      currentPrice: Number(p.curPrice || p.price || 0),
      value: Number(p.currentValue || 0),
      pnl: Number(p.cashPnl || p.pnl || 0),
      pnlPercent: Number(p.percentPnl || p.pnlPercent || 0),
      title: p.title || p.question || "Unknown Market",
      image: p.image || "",
      slug: p.slug || "",
      negRisk: p.negativeRisk ?? p.negRisk ?? false,
      tickSize: p.tickSize || "0.01",
    }));

    console.log("Parsed positions:", userPositions);

    renderPositions();

    // Update stats
    positionsCountEl.textContent = String(userPositions.length);
    const totalValue = userPositions.reduce((sum, p) => sum + p.value, 0);
    positionsTotalValue.textContent = `Total: $${totalValue.toFixed(2)}`;
  } catch (error) {
    console.error("Failed to fetch positions:", error);
    positionsGrid.innerHTML = '<div class="empty-state">Failed to load positions</div>';
  }
}

async function renderPositions() {
  if (userPositions.length === 0) {
    positionsGrid.innerHTML = '<div class="empty-state">No positions found</div>';
    return;
  }

  positionsGrid.innerHTML = '<div class="loading">Checking on-chain balances...</div>';

  // Check on-chain balances for each position
  positionsWithOnChainBalances = await Promise.all(userPositions.map(async (pos) => {
    let onChainBalance = 0;
    if (signer && signerAddress) {
      try {
        const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);
        const balance = await ctf.balanceOf(signerAddress, pos.asset);
        onChainBalance = Number(ethers.utils.formatUnits(balance, 6));
      } catch (e) {
        console.warn("Could not fetch on-chain balance for", pos.asset);
      }
    }
    return { ...pos, onChainBalance };
  }));

  // Filter: Only show positions with actual on-chain balance > 0.01
  const activePositions = positionsWithOnChainBalances.filter(pos => pos.onChainBalance >= 0.01);
  const soldPositions = positionsWithOnChainBalances.filter(pos => pos.onChainBalance < 0.01);

  if (activePositions.length === 0 && soldPositions.length === 0) {
    positionsGrid.innerHTML = '<div class="empty-state">No positions found</div>';
    return;
  }

  // Update positions count with active positions only
  positionsCountEl.textContent = String(activePositions.length);
  const totalValue = activePositions.reduce((sum, p) => sum + (p.onChainBalance * p.currentPrice), 0);
  positionsTotalValue.textContent = `Total: $${totalValue.toFixed(2)}`;

  let html = '';

  // Render active positions
  if (activePositions.length > 0) {
    html += activePositions.map(pos => {
      const pnlClass = pos.pnl >= 0 ? "profit" : "loss";
      const pnlSign = pos.pnl >= 0 ? "+" : "";

      return `
        <div class="position-card" data-asset="${pos.asset}">
          <img src="${pos.image}" alt="" class="position-image" onerror="this.style.display='none'" />
          <div class="position-info">
            <div class="position-title">${escapeHtml(pos.title)}</div>
            <span class="position-outcome ${pos.outcome.toLowerCase()}">${pos.outcome}${pos.negRisk ? ' (Neg-Risk)' : ''}</span>
            <div class="position-stats">
              <div class="position-stat">
                <span class="position-stat-label">Shares</span>
                <span class="position-stat-value">${pos.onChainBalance.toFixed(2)}</span>
              </div>
              <div class="position-stat">
                <span class="position-stat-label">Avg Price</span>
                <span class="position-stat-value">$${pos.avgPrice.toFixed(3)}</span>
              </div>
              <div class="position-stat">
                <span class="position-stat-label">Current</span>
                <span class="position-stat-value">$${pos.currentPrice.toFixed(3)}</span>
              </div>
              <div class="position-stat">
                <span class="position-stat-label">Value</span>
                <span class="position-stat-value">$${(pos.onChainBalance * pos.currentPrice).toFixed(2)}</span>
              </div>
              <div class="position-stat">
                <span class="position-stat-label">P&L</span>
                <span class="position-stat-value ${pnlClass}">${pnlSign}$${pos.pnl.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div class="position-actions">
            <button class="btn-position sell" data-action="sell" data-asset="${pos.asset}">Sell</button>
            <button class="btn-position buy" data-action="buy" data-asset="${pos.asset}">Buy More</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Show sold positions in a collapsed section (if any)
  if (soldPositions.length > 0) {
    html += `
      <div class="sold-positions-header" style="margin-top: 24px; padding: 12px; background: #1a1a1a; border-radius: 8px; cursor: pointer;" onclick="this.nextElementSibling.classList.toggle('hidden')">
        <span style="color: #888;">Recently Sold (${soldPositions.length})</span>
        <span style="color: #666; font-size: 12px;"> - API shows stale data, click to toggle</span>
      </div>
      <div class="sold-positions hidden" style="opacity: 0.5;">
        ${soldPositions.map(pos => `
          <div class="position-card" style="border-color: #333;">
            <div class="position-info">
              <div class="position-title" style="color: #666;">${escapeHtml(pos.title)}</div>
              <span class="position-outcome" style="background: #333; color: #666;">SOLD</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  positionsGrid.innerHTML = html;

  // Add click handlers for active positions
  document.querySelectorAll(".btn-position").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      const asset = (btn as HTMLElement).dataset.asset;

      // Find position and update with on-chain balance
      const position = positionsWithOnChainBalances.find(p => p.asset === asset);
      if (position && position.onChainBalance >= 0.01) {
        // Update position size to on-chain balance for accurate selling
        const updatedPosition = { ...position, size: position.onChainBalance };
        openPositionTradeModal(updatedPosition, action as "buy" | "sell");
      }
    });
  });
}

// Open trade modal for a position
async function openPositionTradeModal(position: Position, action: "buy" | "sell") {
  // Find matching market or create a minimal one
  const market = allMarkets.find(m =>
    m.clobTokenIds.includes(position.asset) ||
    m.conditionId === position.conditionId
  );

  // Try to fetch actual market info from order book
  let actualNegRisk = position.negRisk;
  let actualTickSize = position.tickSize;
  let bestBid = position.currentPrice - 0.01;
  let bestAsk = position.currentPrice + 0.01;

  if (client) {
    try {
      const orderBook = await client.getOrderBook(position.asset);
      actualNegRisk = Boolean((orderBook as any).neg_risk ?? position.negRisk);
      actualTickSize = String(orderBook.tick_size || position.tickSize);
      if (orderBook.bids && orderBook.bids.length > 0) {
        bestBid = Number(orderBook.bids[0].price);
      }
      if (orderBook.asks && orderBook.asks.length > 0) {
        bestAsk = Number(orderBook.asks[0].price);
      }
      console.log("Fetched order book:", { negRisk: actualNegRisk, tickSize: actualTickSize, bestBid, bestAsk });
    } catch (e) {
      console.warn("Could not fetch order book:", e);
    }
  }

  selectedMarket = market || {
    id: position.conditionId,
    question: position.title,
    conditionId: position.conditionId,
    slug: position.slug,
    description: "",
    image: position.image,
    icon: position.image,
    outcomes: ["Yes", "No"],
    outcomePrices: [position.currentPrice, 1 - position.currentPrice],
    volume: 0,
    volume24hr: 0,
    liquidity: 0,
    active: true,
    closed: false,
    negRisk: actualNegRisk,
    clobTokenIds: [position.asset],
    orderPriceMinTickSize: Number(actualTickSize) || 0.01,
    orderMinSize: 1,
    bestBid,
    bestAsk,
    spread: bestAsk - bestBid,
    oneDayPriceChange: 0,
    endDate: "",
    events: [],
  };

  selectedOutcomeIndex = position.outcomeIndex;

  // Populate modal
  modalMarketTitle.textContent = position.title;
  modalMarketImage.src = position.image;
  modalMarketDescription.textContent = `Position: ${position.size.toFixed(2)} ${position.outcome} shares @ $${position.avgPrice.toFixed(3)} avg`;

  // Outcome buttons - pre-select the position's outcome
  outcomeButtons.innerHTML = `
    <button class="btn-outcome ${position.outcome.toLowerCase()} selected" data-index="${position.outcomeIndex}">
      <span class="outcome-name">${position.outcome}</span>
      <span class="outcome-price">${formatPrice(position.currentPrice)}</span>
    </button>
  `;

  // Order book - use actual fetched data
  bestBidEl.textContent = selectedMarket.bestBid.toFixed(3);
  bestAskEl.textContent = selectedMarket.bestAsk.toFixed(3);
  spreadEl.textContent = selectedMarket.spread.toFixed(3);

  // Set side based on action
  tradeSide = action.toUpperCase() as "BUY" | "SELL";
  setSide(tradeSide);

  // Pre-fill form with actual best bid/ask
  if (action === "sell") {
    // For selling, use best bid (what buyers are willing to pay)
    tradePriceEl.value = selectedMarket.bestBid.toFixed(3);
    tradeSizeEl.value = position.size.toFixed(2);
  } else {
    // For buying, use best ask (what sellers are asking)
    tradePriceEl.value = selectedMarket.bestAsk.toFixed(3);
    tradeSizeEl.value = String(selectedMarket.orderMinSize);
  }

  minOrderSizeEl.textContent = `${selectedMarket.orderMinSize} shares`;

  updateCostCalculator();
  updateTradeButton();

  tradeModal.classList.remove("hidden");
}

// Fetch and Render Orders
async function fetchAndRenderOrders() {
  if (!client || !signerAddress) {
    ordersGrid.innerHTML = '<div class="empty-state">Connect wallet to view orders</div>';
    return;
  }

  ordersGrid.innerHTML = '<div class="loading">Loading orders...</div>';

  try {
    const orders = await client.getOpenOrders();
    userOrders = (orders || []).map((o: any) => ({
      id: o.id || o.order_id,
      asset_id: o.asset_id,
      market: o.market,
      side: o.side,
      price: Number(o.price),
      original_size: Number(o.original_size || o.size),
      size_matched: Number(o.size_matched || 0),
      status: o.status || "LIVE",
      outcome: o.outcome || "Yes",
      created_at: o.created_at || o.timestamp,
      title: o.title || o.market,
    }));

    renderOrders();
    openOrdersCountEl.textContent = String(userOrders.length);
  } catch (error) {
    console.error("Failed to fetch orders:", error);
    ordersGrid.innerHTML = '<div class="empty-state">Failed to load orders</div>';
  }
}

function renderOrders() {
  if (userOrders.length === 0) {
    ordersGrid.innerHTML = '<div class="empty-state">No open orders</div>';
    return;
  }

  ordersGrid.innerHTML = userOrders.map(order => {
    const remaining = order.original_size - order.size_matched;
    const statusClass = order.size_matched > 0 ? "partial" : "live";

    return `
      <div class="order-card" data-order-id="${order.id}">
        <span class="order-side-badge ${order.side.toLowerCase()}">${order.side}</span>
        <div class="order-info">
          <div class="order-market">${escapeHtml(order.title || order.market.slice(0, 20) + "...")}</div>
          <div class="order-details">
            <span>Price: $${order.price.toFixed(3)}</span>
            <span>Size: ${remaining.toFixed(2)} / ${order.original_size.toFixed(2)}</span>
            <span>Filled: ${order.size_matched.toFixed(2)}</span>
          </div>
        </div>
        <span class="order-status ${statusClass}">${order.size_matched > 0 ? "Partial" : "Live"}</span>
        <button class="btn-cancel" data-order-id="${order.id}">Cancel</button>
      </div>
    `;
  }).join("");

  // Add cancel handlers
  document.querySelectorAll(".btn-cancel").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const orderId = (btn as HTMLElement).dataset.orderId;
      await cancelOrder(orderId!);
    });
  });
}

async function cancelOrder(orderId: string) {
  if (!client) return;

  try {
    await client.cancelOrder({ orderID: orderId });
    await fetchAndRenderOrders();
  } catch (error: any) {
    console.error("Failed to cancel order:", error);
    alert(`Failed to cancel order: ${error.message}`);
  }
}

async function cancelAllOrders() {
  if (!client || userOrders.length === 0) return;

  if (!confirm(`Cancel all ${userOrders.length} orders?`)) return;

  try {
    await client.cancelAll();
    await fetchAndRenderOrders();
  } catch (error: any) {
    console.error("Failed to cancel orders:", error);
    alert(`Failed to cancel orders: ${error.message}`);
  }
}

// Start the app
init();
