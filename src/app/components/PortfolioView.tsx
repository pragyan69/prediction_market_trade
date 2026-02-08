import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';

const DATA_API = 'https://data-api.polymarket.com';

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

interface PortfolioViewProps {
  showToast: (message: string, type: 'success' | 'error') => void;
}

export function PortfolioView({ showToast }: PortfolioViewProps) {
  const { isConnected, address, refreshBalance } = useWallet();

  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    if (!address) return;

    setIsLoading(true);

    try {
      const response = await fetch(
        `${DATA_API}/positions?user=${address.toLowerCase()}&sizeThreshold=1&limit=100`
      );
      const data = await response.json();

      setPositions((data || []).map((p: any) => ({
        asset: p.asset,
        title: p.title || 'Unknown',
        image: p.image || '',
        outcome: p.outcome || 'Yes',
        size: Number(p.size || 0),
        avgPrice: Number(p.avgPrice || 0),
        currentPrice: Number(p.curPrice || 0),
        pnl: Number(p.cashPnl || 0),
        negRisk: p.negativeRisk ?? false,
      })));
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      showToast('Failed to load positions', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [address, showToast]);

  useEffect(() => {
    if (isConnected && address) {
      fetchPositions();
    }
  }, [isConnected, address, fetchPositions]);

  // Calculate totals
  const portfolioValue = positions.reduce((sum, p) => sum + (p.size * p.currentPrice), 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  if (!isConnected) {
    return (
      <div id="portfolioView" className="view active">
        <div className="empty-state">Connect wallet to view positions</div>
      </div>
    );
  }

  return (
    <div id="portfolioView" className="view active">
      <div className="portfolio-header">
        <div className="portfolio-summary">
          <div className="summary-card">
            <span className="summary-label">Portfolio Value</span>
            <span className="summary-value">${portfolioValue.toFixed(2)}</span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Total P&L</span>
            <span className={`summary-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Positions</span>
            <span className="summary-value">{positions.length}</span>
          </div>
        </div>
        <button className="btn-secondary" onClick={fetchPositions} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="positions-container">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
          </div>
        ) : positions.length === 0 ? (
          <div className="empty-state">No positions found</div>
        ) : (
          positions.map(position => (
            <div key={position.asset} className="position-card">
              <img
                src={position.image}
                alt=""
                className="position-image"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="position-info">
                <div className="position-title">{position.title}</div>
                <span className={`position-outcome ${position.outcome.toLowerCase()}`}>
                  {position.outcome}
                </span>
              </div>
              <div className="position-stats">
                <div className="position-stat">
                  <div className="position-stat-label">Shares</div>
                  <div className="position-stat-value">{position.size.toFixed(2)}</div>
                </div>
                <div className="position-stat">
                  <div className="position-stat-label">Avg</div>
                  <div className="position-stat-value">${position.avgPrice.toFixed(3)}</div>
                </div>
                <div className="position-stat">
                  <div className="position-stat-label">Current</div>
                  <div className="position-stat-value">${position.currentPrice.toFixed(3)}</div>
                </div>
                <div className="position-stat">
                  <div className="position-stat-label">P&L</div>
                  <div className={`position-stat-value ${position.pnl >= 0 ? 'profit' : 'loss'}`}>
                    {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="position-actions">
                <button className="btn-success">Sell</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
