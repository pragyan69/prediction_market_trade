import { useState, useCallback } from 'react';
import { Header } from './Header';
import { MarketsView } from './MarketsView';
import { PortfolioView } from './PortfolioView';
import { OrdersView } from './OrdersView';
import { TradeModal } from './TradeModal';
import { ToastContainer, type Toast } from './Toast';
import type { Market } from './MarketsView';

const CLOB_HOST = 'https://clob.polymarket.com';

type View = 'markets' | 'portfolio' | 'orders';

export function Layout() {
  const [currentView, setCurrentView] = useState<View>('markets');
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);
  const [invalidMarketIds, setInvalidMarketIds] = useState<Set<string>>(new Set());
  const [isValidating, setIsValidating] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Validate orderbook exists before opening modal
  const openTradeModal = useCallback(async (market: Market) => {
    // Skip if already known to be invalid
    if (invalidMarketIds.has(market.id)) {
      showToast('This market is unavailable for trading', 'error');
      return;
    }

    setIsValidating(true);

    try {
      // Check if orderbook exists for the Yes token
      const tokenId = market.clobTokenIds[0];
      const response = await fetch(`${CLOB_HOST}/book?token_id=${tokenId}`);

      if (!response.ok) {
        throw new Error('Orderbook not found');
      }

      const book = await response.json();

      // Check if orderbook has any bids or asks
      if (!book || (!book.bids?.length && !book.asks?.length)) {
        throw new Error('Empty orderbook');
      }

      // Orderbook is valid, open the modal
      setSelectedMarket(market);
    } catch (error) {
      console.error('[Layout] Market validation failed:', market.question, error);
      // Mark this market as invalid so it's filtered out
      setInvalidMarketIds(prev => new Set(prev).add(market.id));
      showToast('This market has no active orderbook. It has been removed from the list.', 'error');
    } finally {
      setIsValidating(false);
    }
  }, [invalidMarketIds]);

  const closeTradeModal = () => {
    setSelectedMarket(null);
  };

  return (
    <div id="root">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="main">
        {currentView === 'markets' && (
          <MarketsView
            onSelectMarket={openTradeModal}
            invalidMarketIds={invalidMarketIds}
            isValidating={isValidating}
          />
        )}
        {currentView === 'portfolio' && (
          <PortfolioView showToast={showToast} />
        )}
        {currentView === 'orders' && (
          <OrdersView showToast={showToast} />
        )}
      </main>

      {selectedMarket && (
        <TradeModal
          market={selectedMarket}
          onClose={closeTradeModal}
          showToast={showToast}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
