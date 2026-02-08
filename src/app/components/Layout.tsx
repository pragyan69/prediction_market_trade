import { useState } from 'react';
import { Header } from './Header';
import { MarketsView } from './MarketsView';
import { PortfolioView } from './PortfolioView';
import { OrdersView } from './OrdersView';
import { TradeModal } from './TradeModal';
import { ToastContainer, type Toast } from './Toast';
import type { Market } from './MarketsView';

type View = 'markets' | 'portfolio' | 'orders';

export function Layout() {
  const [currentView, setCurrentView] = useState<View>('markets');
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const openTradeModal = (market: Market) => {
    setSelectedMarket(market);
  };

  const closeTradeModal = () => {
    setSelectedMarket(null);
  };

  return (
    <div id="root">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="main">
        {currentView === 'markets' && (
          <MarketsView onSelectMarket={openTradeModal} />
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
