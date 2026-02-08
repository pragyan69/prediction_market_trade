// Polymarket WebSocket Service
// Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market
// All price updates come through this WebSocket - no API polling needed!

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface BookMessage {
  event_type: "book";
  asset_id: string;
  market: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
  hash: string;
}

export interface PriceChangeMessage {
  event_type: "price_change";
  market: string;
  price_changes: {
    asset_id: string;
    price: string;
    size: string;
    side: "BUY" | "SELL";
    hash: string;
    best_bid: string;
    best_ask: string;
  }[];
  timestamp: string;
}

export interface LastTradePriceMessage {
  event_type: "last_trade_price";
  asset_id: string;
  market: string;
  price: string;
  side: "BUY" | "SELL";
  size: string;
  fee_rate_bps?: string;
  timestamp: string;
}

export interface TickSizeChangeMessage {
  event_type: "tick_size_change";
  asset_id: string;
  market: string;
  old_tick_size: string;
  new_tick_size: string;
  side: string;
  timestamp: string;
}

export interface BestBidAskMessage {
  event_type: "best_bid_ask";
  market: string;
  asset_id: string;
  best_bid: string;
  best_ask: string;
  spread: string;
  timestamp: string;
}

export interface NewMarketMessage {
  event_type: "new_market";
  id: string;
  question: string;
  market: string;
  slug: string;
  description: string;
  assets_ids: string[];
  outcomes: string[];
  timestamp: string;
}

export interface MarketResolvedMessage {
  event_type: "market_resolved";
  id: string;
  question: string;
  market: string;
  slug: string;
  winning_asset_id: string;
  winning_outcome: string;
  timestamp: string;
}

export type WebSocketMessage =
  | BookMessage
  | PriceChangeMessage
  | LastTradePriceMessage
  | TickSizeChangeMessage
  | BestBidAskMessage
  | NewMarketMessage
  | MarketResolvedMessage;

type MessageHandler = (message: WebSocketMessage) => void;
type StatusHandler = (connected: boolean) => void;

export class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private subscribedMarkets: Set<string> = new Set();
  private subscribedAssets: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: number | null = null;
  private messageCount = 0;

  private readonly WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

  // Connect to WebSocket
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      console.log("[WS] Connecting to Polymarket WebSocket...");
      console.log("[WS] URL:", this.WS_URL);

      this.ws = new WebSocket(this.WS_URL);

      this.ws.onopen = () => {
        console.log("[WS] Connected! Ready for real-time updates");
        this.reconnectAttempts = 0;
        this.messageCount = 0;
        this.notifyStatus(true);

        // Resubscribe to any previously subscribed markets
        if (this.subscribedMarkets.size > 0) {
          console.log(`[WS] Re-subscribing to ${this.subscribedMarkets.size} markets...`);
          this.subscribedMarkets.forEach(market => {
            this.sendSubscribe(market);
          });
        }
        if (this.subscribedAssets.size > 0) {
          console.log(`[WS] Re-subscribing to ${this.subscribedAssets.size} assets...`);
          this.subscribedAssets.forEach(asset => {
            this.sendSubscribeAsset(asset);
          });
        }

        // Start ping interval to keep connection alive
        this.startPing();

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error("[WS] Failed to parse message:", e);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[WS] Connection error:", error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (code: ${event.code}, reason: ${event.reason || "none"})`);
        this.notifyStatus(false);
        this.stopPing();

        // Attempt reconnect with exponential backoff
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
          console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => this.connect(), delay);
        } else {
          console.error("[WS] Max reconnection attempts reached. Please refresh the page.");
        }
      };
    });
  }

  // Disconnect
  disconnect() {
    console.log("[WS] Disconnecting...");
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedMarkets.clear();
    this.subscribedAssets.clear();
  }

  // Subscribe to a market (by condition ID)
  subscribeToMarket(conditionId: string) {
    this.subscribedMarkets.add(conditionId);
    if (this.isConnected()) {
      this.sendSubscribe(conditionId);
    }
  }

  // Subscribe to an asset (by token ID)
  subscribeToAsset(assetId: string) {
    this.subscribedAssets.add(assetId);
    if (this.isConnected()) {
      this.sendSubscribeAsset(assetId);
    }
  }

  // Unsubscribe from market
  unsubscribeFromMarket(conditionId: string) {
    this.subscribedMarkets.delete(conditionId);
    if (this.isConnected()) {
      this.sendUnsubscribe(conditionId);
    }
  }

  // Check if connected
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Get stats
  getStats() {
    return {
      connected: this.isConnected(),
      subscribedMarkets: this.subscribedMarkets.size,
      subscribedAssets: this.subscribedAssets.size,
      messagesReceived: this.messageCount,
    };
  }

  // Register message handler
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  // Register status handler
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  // Private methods
  private sendSubscribe(conditionId: string) {
    this.send({
      type: "subscribe",
      channel: "market",
      markets: [conditionId],
    });
  }

  private sendSubscribeAsset(assetId: string) {
    this.send({
      type: "subscribe",
      channel: "market",
      assets_ids: [assetId],
    });
  }

  private sendUnsubscribe(conditionId: string) {
    this.send({
      type: "unsubscribe",
      channel: "market",
      markets: [conditionId],
    });
  }

  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(data: any) {
    this.messageCount++;

    // Log first few messages for debugging
    if (this.messageCount <= 3) {
      console.log(`[WS] Message #${this.messageCount}:`, data.event_type, data);
    } else if (this.messageCount === 4) {
      console.log("[WS] Further messages will be processed silently...");
    }

    // Handle all known message types
    const knownTypes = [
      "book",
      "price_change",
      "last_trade_price",
      "tick_size_change",
      "best_bid_ask",
      "new_market",
      "market_resolved"
    ];

    if (knownTypes.includes(data.event_type)) {
      this.messageHandlers.forEach(handler => handler(data as WebSocketMessage));
    }
  }

  private notifyStatus(connected: boolean) {
    this.statusHandlers.forEach(handler => handler(connected));
  }

  private startPing() {
    this.pingInterval = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: "ping" });
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

// Singleton instance
export const polymarketWS = new PolymarketWebSocket();
