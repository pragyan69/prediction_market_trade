import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useSafe } from '../contexts/SafeContext';
import { useTrading } from '../contexts/TradingContext';

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

interface OrdersViewProps {
  showToast: (message: string, type: 'success' | 'error') => void;
}

export function OrdersView({ showToast }: OrdersViewProps) {
  const { isConnected } = useWallet();
  const { refreshSafeBalance } = useSafe();
  const { getOpenOrders, cancelOrder, cancelAllOrders, isInitialized } = useTrading();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!isInitialized) return;

    setIsLoading(true);

    try {
      const data = await getOpenOrders();
      setOrders((data || []).map((o: any) => ({
        id: o.id,
        asset_id: o.asset_id,
        market: o.market,
        side: o.side,
        price: Number(o.price),
        size: Number(o.original_size || o.size),
        filled: Number(o.size_matched || 0),
        status: o.status,
      })));
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      showToast('Failed to load orders', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [isInitialized, getOpenOrders, showToast]);

  useEffect(() => {
    if (isConnected && isInitialized) {
      fetchOrders();
    }
  }, [isConnected, isInitialized, fetchOrders]);

  const handleCancelOrder = async (orderId: string) => {
    setCancellingId(orderId);

    try {
      await cancelOrder(orderId);
      showToast('Order cancelled', 'success');
      await fetchOrders();
      await refreshSafeBalance();
    } catch (error: any) {
      showToast(`Failed: ${error.message}`, 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelAll = async () => {
    if (orders.length === 0) return;
    if (!confirm(`Cancel all ${orders.length} orders?`)) return;

    setIsLoading(true);

    try {
      await cancelAllOrders();
      showToast('All orders cancelled', 'success');
      await fetchOrders();
      await refreshSafeBalance();
    } catch (error: any) {
      showToast(`Failed: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div id="ordersView" className="view active">
        <div className="empty-state">Connect wallet to view orders</div>
      </div>
    );
  }

  return (
    <div id="ordersView" className="view active">
      <div className="orders-header">
        <h2>Open Orders</h2>
        <div className="orders-actions">
          <button className="btn-secondary" onClick={fetchOrders} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            className="btn-danger"
            onClick={handleCancelAll}
            disabled={isLoading || orders.length === 0}
          >
            Cancel All
          </button>
        </div>
      </div>

      <div className="orders-container">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">No open orders</div>
        ) : (
          orders.map(order => (
            <div key={order.id} className="order-card">
              <span className={`order-side ${order.side.toLowerCase()}`}>
                {order.side}
              </span>
              <div className="order-info">
                <div className="order-market">{order.market.slice(0, 30)}...</div>
                <div className="order-details">
                  ${order.price.toFixed(3)} x {order.size} ({order.filled} filled)
                </div>
              </div>
              <button
                className="btn-danger"
                onClick={() => handleCancelOrder(order.id)}
                disabled={cancellingId === order.id}
              >
                {cancellingId === order.id ? '...' : 'Cancel'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
