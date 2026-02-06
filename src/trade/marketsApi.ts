// Markets API - Fetches live markets from Gamma API with polling

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CORS_PROXY = "https://corsproxy.io/?url=";

export interface Market {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  description: string;
  image: string;
  icon: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  volume24hr: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  negRisk: boolean;
  clobTokenIds: string[];
  orderPriceMinTickSize: number;
  orderMinSize: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  oneDayPriceChange: number;
  endDate: string;
  events: MarketEvent[];
}

export interface MarketEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
}

// Parse market data from API response
function parseMarket(raw: any): Market {
  const outcomes = JSON.parse(raw.outcomes || '["Yes", "No"]');
  const outcomePrices = JSON.parse(raw.outcomePrices || '[0.5, 0.5]').map(Number);
  const clobTokenIds = JSON.parse(raw.clobTokenIds || '[]');

  return {
    id: raw.id,
    question: raw.question,
    conditionId: raw.conditionId,
    slug: raw.slug,
    description: raw.description || "",
    image: raw.image || raw.icon || "",
    icon: raw.icon || raw.image || "",
    outcomes,
    outcomePrices,
    volume: Number(raw.volumeNum || raw.volume || 0),
    volume24hr: Number(raw.volume24hr || 0),
    liquidity: Number(raw.liquidityNum || raw.liquidity || 0),
    active: raw.active ?? true,
    closed: raw.closed ?? false,
    negRisk: raw.negRisk ?? false,
    clobTokenIds,
    orderPriceMinTickSize: Number(raw.orderPriceMinTickSize || 0.01),
    orderMinSize: Number(raw.orderMinSize || 1),
    bestBid: Number(raw.bestBid || 0),
    bestAsk: Number(raw.bestAsk || 1),
    spread: Number(raw.spread || 0),
    oneDayPriceChange: Number(raw.oneDayPriceChange || 0),
    endDate: raw.endDate || "",
    events: raw.events || [],
  };
}

// Fetch markets from Gamma API
export async function fetchMarkets(options: {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
}): Promise<Market[]> {
  const params = new URLSearchParams({
    limit: String(options.limit || 50),
    offset: String(options.offset || 0),
    active: String(options.active ?? true),
    closed: String(options.closed ?? false),
  });

  const apiUrl = `${GAMMA_API_BASE}/markets?${params}`;
  const url = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.map(parseMarket);
  } catch (error) {
    console.error("Failed to fetch markets:", error);
    throw error;
  }
}

// Market polling manager (simulated WebSocket)
export class MarketPoller {
  private intervalId: number | null = null;
  private listeners: Set<(markets: Market[]) => void> = new Set();
  private markets: Market[] = [];
  private pollInterval: number;

  constructor(pollIntervalMs: number = 10000) {
    this.pollInterval = pollIntervalMs;
  }

  // Subscribe to market updates
  subscribe(callback: (markets: Market[]) => void): () => void {
    this.listeners.add(callback);

    // Send current data immediately if available
    if (this.markets.length > 0) {
      callback(this.markets);
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  // Start polling
  async start(): Promise<void> {
    if (this.intervalId !== null) return;

    // Fetch immediately
    await this.poll();

    // Set up interval
    this.intervalId = window.setInterval(() => {
      this.poll();
    }, this.pollInterval);
  }

  // Stop polling
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Set poll interval
  setInterval(ms: number): void {
    this.pollInterval = ms;
    if (this.intervalId !== null) {
      this.stop();
      this.start();
    }
  }

  // Force refresh
  async refresh(): Promise<void> {
    await this.poll();
  }

  // Get current markets
  getMarkets(): Market[] {
    return this.markets;
  }

  private async poll(): Promise<void> {
    try {
      this.markets = await fetchMarkets({
        limit: 50,
        active: true,
        closed: false,
      });

      // Notify all listeners
      this.listeners.forEach(callback => {
        callback(this.markets);
      });
    } catch (error) {
      console.error("Market poll failed:", error);
    }
  }
}

// Sort markets by different criteria
export function sortMarkets(markets: Market[], sortBy: string): Market[] {
  const sorted = [...markets];

  switch (sortBy) {
    case "volume24hr":
      return sorted.sort((a, b) => b.volume24hr - a.volume24hr);
    case "liquidity":
      return sorted.sort((a, b) => b.liquidity - a.liquidity);
    case "volume":
      return sorted.sort((a, b) => b.volume - a.volume);
    case "newest":
      return sorted.sort((a, b) => Number(b.id) - Number(a.id));
    default:
      return sorted;
  }
}

// Filter markets
export function filterMarkets(
  markets: Market[],
  filters: {
    search?: string;
    minLiquidity?: number;
  }
): Market[] {
  return markets.filter(market => {
    // Filter by search
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!market.question.toLowerCase().includes(search)) {
        return false;
      }
    }

    // Filter by min liquidity
    if (filters.minLiquidity && market.liquidity < filters.minLiquidity) {
      return false;
    }

    return true;
  });
}

// Format helpers
export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(2)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

export function formatPrice(price: number): string {
  return `${(price * 100).toFixed(1)}%`;
}

export function formatPriceChange(change: number): { text: string; isPositive: boolean } {
  const pct = change * 100;
  const sign = pct >= 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    isPositive: pct >= 0,
  };
}
