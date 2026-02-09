import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { PriceChangeMessage, LastTradePriceMessage } from '../websocket';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CORS_PROXY = 'https://corsproxy.io/?url=';

export interface Market {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  image: string;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume24hr: number;
  liquidity: number;
  negRisk: boolean;
  tickSize: number;
  minSize: number;
  bestBid: number;
  bestAsk: number;
  oneDayPriceChange: number;
  endDate: string;
}

interface MarketsViewProps {
  onSelectMarket: (market: Market) => void;
  invalidMarketIds?: Set<string>;
  isValidating?: boolean;
}

type SortOption = 'volume24hr' | 'liquidity' | 'newest' | 'ending';
type LayoutOption = 'grid' | 'list';

export function MarketsView({ onSelectMarket, invalidMarketIds = new Set(), isValidating = false }: MarketsViewProps) {
  const { subscribeToMarket, subscribeToAsset, onMessage } = useWebSocket();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('volume24hr');
  const [layout, setLayout] = useState<LayoutOption>('grid');
  const [flashingMarkets, setFlashingMarkets] = useState<Set<string>>(new Set());

  // Fetch markets on mount
  useEffect(() => {
    async function fetchMarkets() {
      try {
        const apiUrl = `${GAMMA_API}/markets?active=true&closed=false&limit=50`;
        const response = await fetch(`${CORS_PROXY}${encodeURIComponent(apiUrl)}`);
        const data = await response.json();

        const parsed: Market[] = data
          .map((m: any) => ({
            id: m.id,
            question: m.question,
            conditionId: m.conditionId,
            slug: m.slug,
            image: m.image || m.icon || '',
            outcomes: JSON.parse(m.outcomes || '["Yes","No"]'),
            outcomePrices: JSON.parse(m.outcomePrices || '[0.5,0.5]').map(Number),
            clobTokenIds: JSON.parse(m.clobTokenIds || '[]'),
            volume24hr: Number(m.volume24hr || 0),
            liquidity: Number(m.liquidityNum || m.liquidity || 0),
            negRisk: m.negRisk ?? false,
            tickSize: Number(m.orderPriceMinTickSize || 0.01),
            minSize: Number(m.orderMinSize || 1),
            bestBid: Number(m.bestBid || 0),
            bestAsk: Number(m.bestAsk || 1),
            oneDayPriceChange: Number(m.oneDayPriceChange || 0),
            endDate: m.endDate || '',
          }))
          // Filter out markets with low/no liquidity or no clobTokenIds
          // Require minimum $100 liquidity to ensure orderbook exists
          .filter((m: Market) => m.liquidity >= 100 && m.clobTokenIds.length >= 2);

        console.log('[Markets] Loaded', parsed.length, 'markets with sufficient liquidity');
        setMarkets(parsed);

        // Subscribe to WebSocket for live updates
        parsed.forEach(m => {
          if (m.conditionId) subscribeToMarket(m.conditionId);
          m.clobTokenIds.forEach(tokenId => subscribeToAsset(tokenId));
        });

      } catch (error) {
        console.error('Failed to fetch markets:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMarkets();
  }, [subscribeToMarket, subscribeToAsset]);

  // Handle WebSocket messages
  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.event_type === 'price_change') {
        const priceMsg = msg as PriceChangeMessage;
        setMarkets(prev => prev.map(market => {
          const change = priceMsg.price_changes.find(pc => market.clobTokenIds.includes(pc.asset_id));
          if (change) {
            const idx = market.clobTokenIds.indexOf(change.asset_id);
            const newPrices = [...market.outcomePrices];
            newPrices[idx] = Number(change.best_bid) || newPrices[idx];
            return { ...market, outcomePrices: newPrices, bestBid: Number(change.best_bid), bestAsk: Number(change.best_ask) };
          }
          return market;
        }));
      } else if (msg.event_type === 'last_trade_price') {
        const tradeMsg = msg as LastTradePriceMessage;
        setMarkets(prev => prev.map(market => {
          const idx = market.clobTokenIds.indexOf(tradeMsg.asset_id);
          if (idx >= 0) {
            const newPrices = [...market.outcomePrices];
            newPrices[idx] = Number(tradeMsg.price);

            // Flash the card
            setFlashingMarkets(prev => new Set(prev).add(market.id));
            setTimeout(() => {
              setFlashingMarkets(prev => {
                const next = new Set(prev);
                next.delete(market.id);
                return next;
              });
            }, 300);

            return { ...market, outcomePrices: newPrices };
          }
          return market;
        }));
      }
    });

    return unsubscribe;
  }, [onMessage]);

  // Filter and sort markets
  const filteredMarkets = markets
    .filter(m => !invalidMarketIds.has(m.id)) // Exclude markets with invalid orderbooks
    .filter(m => m.question.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      switch (sortBy) {
        case 'volume24hr': return b.volume24hr - a.volume24hr;
        case 'liquidity': return b.liquidity - a.liquidity;
        case 'newest': return Number(b.id) - Number(a.id);
        case 'ending': return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
        default: return 0;
      }
    });

  const formatVolume = (v: number) => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <div id="marketsView" className="view active">
      {/* Validation overlay */}
      {isValidating && (
        <div className="validation-overlay">
          <div className="validation-spinner">
            <div className="spinner"></div>
            <span>Checking market...</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search markets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-pills">
          {(['volume24hr', 'liquidity', 'newest', 'ending'] as SortOption[]).map(option => (
            <button
              key={option}
              className={`pill ${sortBy === option ? 'active' : ''}`}
              onClick={() => setSortBy(option)}
            >
              {option === 'volume24hr' ? 'Trending' :
               option === 'liquidity' ? 'Liquid' :
               option === 'newest' ? 'New' : 'Ending Soon'}
            </button>
          ))}
        </div>

        <div className="view-toggle">
          <button
            className={`toggle-btn ${layout === 'grid' ? 'active' : ''}`}
            onClick={() => setLayout('grid')}
          >
            ▦
          </button>
          <button
            className={`toggle-btn ${layout === 'list' ? 'active' : ''}`}
            onClick={() => setLayout('list')}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Markets Container */}
      <div className={`markets-container ${layout}-layout`}>
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Connecting to Polymarket...</p>
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="empty-state">No markets found</div>
        ) : (
          filteredMarkets.map(market => (
            <div
              key={market.id}
              className={`market-card ${flashingMarkets.has(market.id) ? 'flash' : ''}`}
              onClick={() => onSelectMarket(market)}
            >
              <div className="market-header">
                <img
                  src={market.image}
                  alt=""
                  className="market-image"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <h3 className="market-title">{market.question}</h3>
              </div>

              <div className="market-prices">
                <div className="price-box yes">
                  <div className="price-label">Yes</div>
                  <div className="price-value">{(market.outcomePrices[0] * 100).toFixed(0)}¢</div>
                  <div className={`price-change ${market.oneDayPriceChange >= 0 ? 'up' : 'down'}`}>
                    {market.oneDayPriceChange >= 0 ? '+' : ''}{(market.oneDayPriceChange * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="price-box no">
                  <div className="price-label">No</div>
                  <div className="price-value">{(market.outcomePrices[1] * 100).toFixed(0)}¢</div>
                </div>
              </div>

              <div className="market-footer">
                <div className="market-stat">
                  <span className="stat-label">24h Vol</span>
                  <span className="stat-value">{formatVolume(market.volume24hr)}</span>
                </div>
                <div className="market-stat">
                  <span className="stat-label">Liquidity</span>
                  <span className="stat-value">{formatVolume(market.liquidity)}</span>
                </div>
                <div className="market-stat">
                  <span className="stat-label"><span className="live-dot"></span>Live</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
