import { appState } from "../utils/state";
import { write, setStatus } from "../utils/logger";
import type { OpenOrder } from "../types";

/**
 * Fetch all open orders for the connected wallet
 */
export async function fetchOpenOrders(): Promise<OpenOrder[]> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }
  if (!appState.signerAddress) {
    throw new Error("Wallet not connected.");
  }

  try {
    setStatus("Fetching open orders...", true);

    // The CLOB client's getOpenOrders method
    const orders = await appState.client.getOpenOrders({
      owner: appState.signerAddress,
    });

    write({ openOrdersCount: orders?.length ?? 0, orders });
    setStatus(`Found ${orders?.length ?? 0} open orders`, true);

    return orders ?? [];
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to fetch orders: ${msg}` });
    setStatus(`Error fetching orders: ${msg}`, false);
    throw error;
  }
}

/**
 * Cancel a specific order by order ID
 */
export async function cancelOrder(orderId: string): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }

  try {
    setStatus(`Canceling order ${orderId}...`, true);

    const result = await appState.client.cancelOrder({ orderID: orderId });

    write({ cancelResult: result, orderId });
    setStatus(`Order ${orderId} canceled successfully`, true);

    return result;
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to cancel order: ${msg}` });
    setStatus(`Error canceling order: ${msg}`, false);
    throw error;
  }
}

/**
 * Cancel multiple orders by their IDs
 */
export async function cancelOrders(orderIds: string[]): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }

  try {
    setStatus(`Canceling ${orderIds.length} orders...`, true);

    const result = await appState.client.cancelOrders(orderIds);

    write({ cancelResult: result, orderIds });
    setStatus(`${orderIds.length} orders canceled successfully`, true);

    return result;
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to cancel orders: ${msg}` });
    setStatus(`Error canceling orders: ${msg}`, false);
    throw error;
  }
}

/**
 * Cancel all open orders for the connected wallet
 */
export async function cancelAllOrders(): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }

  try {
    setStatus("Canceling all orders...", true);

    const result = await appState.client.cancelAll();

    write({ cancelAllResult: result });
    setStatus("All orders canceled successfully", true);

    return result;
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to cancel all orders: ${msg}` });
    setStatus(`Error canceling all orders: ${msg}`, false);
    throw error;
  }
}

/**
 * Cancel all orders for a specific market (asset_id / token_id)
 */
export async function cancelMarketOrders(assetId: string): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }

  try {
    setStatus(`Canceling all orders for market ${assetId}...`, true);

    const result = await appState.client.cancelMarketOrders({ asset_id: assetId });

    write({ cancelMarketResult: result, assetId });
    setStatus(`All orders for market canceled successfully`, true);

    return result;
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to cancel market orders: ${msg}` });
    setStatus(`Error canceling market orders: ${msg}`, false);
    throw error;
  }
}

/**
 * Get order by ID
 */
export async function getOrder(orderId: string): Promise<any> {
  if (!appState.client) {
    throw new Error("Client not initialized. Connect and derive credentials first.");
  }

  try {
    const order = await appState.client.getOrder(orderId);
    write({ order });
    return order;
  } catch (error: any) {
    const msg = error?.message || String(error);
    write({ error: `Failed to get order: ${msg}` });
    throw error;
  }
}
