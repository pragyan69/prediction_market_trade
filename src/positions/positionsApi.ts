import { Side, OrderType } from "@polymarket/clob-client";
import { appState } from "../utils/state";
import { write, setStatus } from "../utils/logger";
import type { Position } from "../types";

/**
 * Fetch all positions (balances) for the connected wallet
 * Uses the CLOB client's REST endpoint for balance/positions
 */
export async function fetchPositions(): Promise<Position[]> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }
  if (!appState.signerAddress) {
    throw new Error("Wallet not connected.");
  }

  try {
    setStatus("Fetching positions...", true);

    // Try to get positions/balances from the CLOB API
    // The endpoint is typically GET /positions or /balance-allowance
    const positions = await appState.client.getBalanceAllowance();

    write({ positionsData: positions });
    setStatus(`Fetched positions data`, true);

    // Parse and return as Position array
    // The exact structure depends on the API response
    return positions?.balances ?? positions ?? [];
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to fetch positions: ${msg}` });
    setStatus(`Error fetching positions: ${msg}`, false);
    throw error;
  }
}

/**
 * Fetch positions from Polymarket data API
 */
export async function fetchPositionsREST(): Promise<any[]> {
  if (!appState.signerAddress) {
    throw new Error("Wallet not connected.");
  }

  try {
    setStatus("Fetching positions...", true);

    // Use Polymarket data API for positions
    const url = `https://data-api.polymarket.com/positions?sizeThreshold=1&limit=100&sortBy=TOKENS&sortDirection=DESC&user=${appState.signerAddress}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const positions = await response.json();
    write({ positionsCount: positions?.length ?? 0, positions });
    setStatus(`Found ${positions?.length ?? 0} positions`, true);

    return positions ?? [];
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to fetch positions: ${msg}` });
    setStatus(`Error fetching positions: ${msg}`, false);
    throw error;
  }
}

/**
 * Close a position by selling all tokens at market or limit price
 * This creates a sell order for the entire position size
 */
export async function closePosition(
  assetId: string,
  size: number,
  price: number,
  tickSize: string,
  negRisk: boolean
): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }

  try {
    setStatus(`Closing position for ${assetId}...`, true);

    // Create a SELL order to close the position
    const result = await appState.client.createAndPostOrder(
      {
        tokenID: assetId,
        price,
        size,
        side: Side.SELL,
      },
      {
        tickSize: tickSize as any,
        negRisk,
      },
      OrderType.GTC
    );

    write({ closePositionResult: result, assetId, size, price });
    setStatus(`Position close order submitted: ${result.orderID}`, true);

    return result;
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to close position: ${msg}` });
    setStatus(`Error closing position: ${msg}`, false);
    throw error;
  }
}

/**
 * Get trade history for the connected wallet
 */
export async function fetchTradeHistory(): Promise<any[]> {
  if (!appState.signerAddress) {
    throw new Error("Wallet not connected.");
  }

  try {
    setStatus("Fetching trade history...", true);

    const response = await fetch(
      `https://gamma-api.polymarket.com/trades?user=${appState.signerAddress.toLowerCase()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const trades = await response.json();
    write({ tradesCount: trades?.length ?? 0, trades });
    setStatus(`Found ${trades?.length ?? 0} trades`, true);

    return trades ?? [];
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to fetch trade history: ${msg}` });
    setStatus(`Error fetching trades: ${msg}`, false);
    throw error;
  }
}

/**
 * Get market info for a token ID to help with closing positions
 */
export async function getMarketInfo(tokenId: string): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized.");
  }

  try {
    const orderBook = await appState.client.getOrderBook(tokenId);
    return {
      tickSize: orderBook.tick_size,
      negRisk: (orderBook as any).neg_risk ?? false,
      bestBid: orderBook.bids?.[0]?.price,
      bestAsk: orderBook.asks?.[0]?.price,
    };
  } catch (error: any) {
    write({ error: `Failed to get market info: ${error.message}` });
    throw error;
  }
}
