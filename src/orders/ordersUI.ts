import {
  fetchOpenOrders,
  cancelOrder,
  cancelAllOrders
} from "./ordersApi";
import { write, setStatus } from "../utils/logger";
import { appState } from "../utils/state";
import type { OpenOrder } from "../types";

let ordersContainer: HTMLDivElement | null = null;
let ordersListEl: HTMLDivElement | null = null;

export function initOrdersUI() {
  ordersContainer = document.getElementById("ordersContainer") as HTMLDivElement;
  ordersListEl = document.getElementById("ordersList") as HTMLDivElement;

  const btnRefreshOrders = document.getElementById("btnRefreshOrders") as HTMLButtonElement;
  const btnCancelAllOrders = document.getElementById("btnCancelAllOrders") as HTMLButtonElement;

  if (btnRefreshOrders) {
    btnRefreshOrders.onclick = handleRefreshOrders;
  }

  if (btnCancelAllOrders) {
    btnCancelAllOrders.onclick = handleCancelAllOrders;
  }
}

async function handleRefreshOrders() {
  try {
    if (!appState.client) {
      setStatus("Connect wallet and derive credentials first", false);
      return;
    }

    const orders = await fetchOpenOrders();
    renderOrdersList(orders);
  } catch (error: any) {
    write({ error: error.message });
  }
}

async function handleCancelAllOrders() {
  try {
    if (!appState.client) {
      setStatus("Connect wallet and derive credentials first", false);
      return;
    }

    if (!confirm("Are you sure you want to cancel ALL open orders?")) {
      return;
    }

    await cancelAllOrders();
    await handleRefreshOrders();
  } catch (error: any) {
    write({ error: error.message });
  }
}

async function handleCancelOrder(orderId: string) {
  try {
    await cancelOrder(orderId);
    await handleRefreshOrders();
  } catch (error: any) {
    write({ error: error.message });
  }
}

function renderOrdersList(orders: OpenOrder[]) {
  if (!ordersListEl) return;

  if (!orders || orders.length === 0) {
    ordersListEl.innerHTML = `<p class="no-data">No open orders found.</p>`;
    return;
  }

  const html = orders.map(order => `
    <div class="order-card" data-order-id="${order.id}">
      <div class="order-header">
        <span class="order-side ${order.side.toLowerCase()}">${order.side}</span>
        <span class="order-id">#${order.id.slice(0, 8)}...</span>
        <span class="order-status">${order.status || 'LIVE'}</span>
      </div>
      <div class="order-details">
        <div class="order-row">
          <span class="label">Token ID:</span>
          <span class="value" title="${order.asset_id}">${order.asset_id.slice(0, 20)}...</span>
        </div>
        <div class="order-row">
          <span class="label">Price:</span>
          <span class="value">$${order.price}</span>
        </div>
        <div class="order-row">
          <span class="label">Size:</span>
          <span class="value">${order.original_size} (${order.size_matched} filled)</span>
        </div>
        <div class="order-row">
          <span class="label">Type:</span>
          <span class="value">${order.order_type || 'GTC'}</span>
        </div>
        <div class="order-row">
          <span class="label">Created:</span>
          <span class="value">${new Date(order.created_at * 1000).toLocaleString()}</span>
        </div>
      </div>
      <div class="order-actions">
        <button class="btn-cancel-order" data-order-id="${order.id}">Cancel Order</button>
      </div>
    </div>
  `).join("");

  ordersListEl.innerHTML = html;

  // Attach cancel handlers
  ordersListEl.querySelectorAll(".btn-cancel-order").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const orderId = (e.target as HTMLButtonElement).dataset.orderId;
      if (orderId) {
        handleCancelOrder(orderId);
      }
    });
  });
}

export function showOrdersSection() {
  if (ordersContainer) {
    ordersContainer.style.display = "block";
  }
}

export function hideOrdersSection() {
  if (ordersContainer) {
    ordersContainer.style.display = "none";
  }
}
