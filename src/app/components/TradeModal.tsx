import { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useSafe } from '../contexts/SafeContext';
import { useTrading } from '../contexts/TradingContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { Market } from './MarketsView';
import type { BookMessage } from '../websocket';

interface TradeModalProps {
  market: Market;
  onClose: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
}

interface OrderBookLevel {
  price: string;
  size: string;
}

export function TradeModal({ market, onClose, showToast }: TradeModalProps) {
  const { isConnected, connect } = useWallet();
  const { safeUsdceBalance, refreshSafeBalance, isSafeDeployed } = useSafe();
  const { placeOrder, getOrderBook, isInitialized, isDerivingCreds } = useTrading();
  const { subscribeToAsset, onMessage } = useWebSocket();

  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState(market.bestAsk.toFixed(3) || '0.50');
  const [amount, setAmount] = useState(String(market.minSize || 10));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({ bids: [], asks: [] });
  const [orderbookError, setOrderbookError] = useState<string | null>(null);
  const [isLoadingBook, setIsLoadingBook] = useState(true);

  // Refresh balances when modal opens
  useEffect(() => {
    if (isConnected) {
      refreshSafeBalance();
    }
  }, [isConnected, refreshSafeBalance]);

  // Fetch initial order book
  useEffect(() => {
    async function fetchBook() {
      const tokenId = market.clobTokenIds[selectedOutcome];
      if (!tokenId) {
        setOrderbookError('No token ID for this outcome');
        setIsLoadingBook(false);
        return;
      }

      setIsLoadingBook(true);
      setOrderbookError(null);

      try {
        const book = await getOrderBook(tokenId);

        // Check if orderbook has any data
        if (!book || (!book.bids?.length && !book.asks?.length)) {
          setOrderbookError('No active orderbook for this market');
          setOrderBook({ bids: [], asks: [] });
        } else {
          setOrderBook({
            bids: book.bids || [],
            asks: book.asks || [],
          });
          setOrderbookError(null);
        }
      } catch (error: any) {
        console.error('Failed to fetch order book:', error);
        const errorMsg = error?.response?.data?.error || error?.message || 'Failed to load orderbook';
        if (errorMsg.includes('does not exist')) {
          setOrderbookError('This market orderbook does not exist. Try a different market.');
        } else {
          setOrderbookError(errorMsg);
        }
        setOrderBook({ bids: [], asks: [] });
      } finally {
        setIsLoadingBook(false);
      }
    }

    fetchBook();
    subscribeToAsset(market.clobTokenIds[selectedOutcome]);
  }, [market, selectedOutcome, getOrderBook, subscribeToAsset]);

  // Handle WebSocket order book updates
  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.event_type === 'book') {
        const bookMsg = msg as BookMessage;
        if (market.clobTokenIds.includes(bookMsg.asset_id)) {
          setOrderBook({
            bids: bookMsg.bids || [],
            asks: bookMsg.asks || [],
          });
        }
      }
    });

    return unsubscribe;
  }, [market, onMessage]);

  // Calculate costs
  const priceNum = Number(price) || 0;
  const amountNum = Number(amount) || 0;
  const totalCost = priceNum * amountNum;
  const potentialReturn = amountNum;
  const potentialProfit = potentialReturn - totalCost;
  const profitPct = totalCost > 0 ? (potentialProfit / totalCost) * 100 : 0;

  // Validation
  const MIN_ORDER_VALUE = 1; // Polymarket requires minimum $1 order value
  const insufficientBalance = side === 'BUY' && totalCost > safeUsdceBalance;
  const belowMinSize = amountNum < market.minSize;
  const belowMinValue = totalCost < MIN_ORDER_VALUE;
  const hasValidOrderbook = !orderbookError && (orderBook.bids.length > 0 || orderBook.asks.length > 0);
  const canSubmit = isConnected && isInitialized && !insufficientBalance && !belowMinSize && !belowMinValue && priceNum > 0 && amountNum > 0 && hasValidOrderbook && !isLoadingBook;

  // Submit trade
  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);

    try {
      const result = await placeOrder({
        tokenId: market.clobTokenIds[selectedOutcome],
        price: priceNum,
        size: amountNum,
        side,
        negRisk: market.negRisk,
        tickSize: String(market.tickSize),
      });

      showToast(`Order placed! ID: ${result.orderID}`, 'success');
      onClose();
    } catch (error: any) {
      console.error('Trade failed:', error);
      showToast(`Trade failed: ${error.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick price buttons
  const setBidPrice = () => setPrice(orderBook.bids[0]?.price || '0.45');
  const setAskPrice = () => setPrice(orderBook.asks[0]?.price || '0.55');
  const setMidPrice = () => {
    const bid = Number(orderBook.bids[0]?.price || 0.45);
    const ask = Number(orderBook.asks[0]?.price || 0.55);
    setPrice(((bid + ask) / 2).toFixed(3));
  };

  // Quick amount buttons
  const setAmountPct = (pct: number) => {
    const maxShares = Math.floor(safeUsdceBalance / priceNum);
    setAmount(String(Math.floor(maxShares * (pct / 100))));
  };

  // Format volume
  const formatVolume = (v: number) => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <div className="modal open">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-container">
        <div className="modal-header">
          <div className="modal-title-section">
            <img src={market.image} alt="" className="modal-image" />
            <div>
              <h2 className="modal-title">{market.question}</h2>
              <div className="modal-meta">
                <span className="meta-item">Vol: {formatVolume(market.volume24hr)}</span>
                <span className="meta-item">Liq: {formatVolume(market.liquidity)}</span>
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Order Book */}
          <div className="orderbook-section">
            <div className="orderbook-header">
              <span>Live Order Book</span>
              <span className="ob-update-time">{new Date().toLocaleTimeString()}</span>
            </div>
            <div className="orderbook">
              <div className="ob-side asks">
                <div className="ob-header">Asks (Sell)</div>
                <div className="ob-levels">
                  {[...orderBook.asks].slice(0, 5).reverse().map((level, i) => (
                    <div key={i} className="ob-level ask">
                      <span className="ob-price">{Number(level.price).toFixed(3)}</span>
                      <span className="ob-size">{Number(level.size).toFixed(0)}</span>
                    </div>
                  ))}
                  {orderBook.asks.length === 0 && <div className="ob-level">No asks</div>}
                </div>
              </div>

              <div className="ob-spread">
                <span>
                  Spread: {((Number(orderBook.asks[0]?.price || 1) - Number(orderBook.bids[0]?.price || 0)) * 100).toFixed(1)}%
                </span>
              </div>

              <div className="ob-side bids">
                <div className="ob-header">Bids (Buy)</div>
                <div className="ob-levels">
                  {orderBook.bids.slice(0, 5).map((level, i) => (
                    <div key={i} className="ob-level bid">
                      <span className="ob-price">{Number(level.price).toFixed(3)}</span>
                      <span className="ob-size">{Number(level.size).toFixed(0)}</span>
                    </div>
                  ))}
                  {orderBook.bids.length === 0 && <div className="ob-level">No bids</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Outcome Selection */}
          <div className="outcome-section">
            <div
              className={`outcome-btn yes ${selectedOutcome === 0 ? 'selected' : ''}`}
              onClick={() => setSelectedOutcome(0)}
            >
              <span className="outcome-label">Yes</span>
              <span className="outcome-price">{(market.outcomePrices[0] * 100).toFixed(0)}¢</span>
            </div>
            <div
              className={`outcome-btn no ${selectedOutcome === 1 ? 'selected' : ''}`}
              onClick={() => setSelectedOutcome(1)}
            >
              <span className="outcome-label">No</span>
              <span className="outcome-price">{(market.outcomePrices[1] * 100).toFixed(0)}¢</span>
            </div>
          </div>

          {/* Trade Form */}
          <div className="trade-section">
            <div className="side-toggle">
              <button
                className={`side-btn buy ${side === 'BUY' ? 'active' : ''}`}
                onClick={() => setSide('BUY')}
              >
                Buy
              </button>
              <button
                className={`side-btn sell ${side === 'SELL' ? 'active' : ''}`}
                onClick={() => setSide('SELL')}
              >
                Sell
              </button>
            </div>

            <div className="input-group">
              <label>Price</label>
              <div className="input-with-btns">
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="0.999"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                <div className="quick-btns">
                  <button className="quick-btn" onClick={setBidPrice}>Bid</button>
                  <button className="quick-btn" onClick={setMidPrice}>Mid</button>
                  <button className="quick-btn" onClick={setAskPrice}>Ask</button>
                </div>
              </div>
            </div>

            <div className="input-group">
              <label>Amount (shares)</label>
              <div className="input-with-btns">
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="quick-btns">
                  <button className="quick-btn" onClick={() => setAmountPct(25)}>25%</button>
                  <button className="quick-btn" onClick={() => setAmountPct(50)}>50%</button>
                  <button className="quick-btn" onClick={() => setAmountPct(100)}>Max</button>
                </div>
              </div>
            </div>

            {/* Cost Summary */}
            <div className="cost-summary">
              <div className="cost-row">
                <span>Safe Balance</span>
                <span>${safeUsdceBalance.toFixed(2)} USDC.e</span>
              </div>
              <div className="cost-row">
                <span>Total Cost</span>
                <span>${totalCost.toFixed(2)}</span>
              </div>
              <div className="cost-row">
                <span>Potential Return</span>
                <span>${potentialReturn.toFixed(2)}</span>
              </div>
              <div className="cost-row profit">
                <span>Potential Profit</span>
                <span>${potentialProfit.toFixed(2)} ({profitPct.toFixed(0)}%)</span>
              </div>
            </div>

            {/* Warnings */}
            {insufficientBalance && (
              <div className="trade-warning">
                Insufficient balance (${safeUsdceBalance.toFixed(2)} available in Safe)
              </div>
            )}

            {belowMinSize && (
              <div className="trade-warning">
                Min order size: {market.minSize} shares
              </div>
            )}

            {belowMinValue && !belowMinSize && (
              <div className="trade-warning">
                Min order value: $1.00 (current: ${totalCost.toFixed(2)})
              </div>
            )}

            {!isSafeDeployed && isConnected && (
              <div className="trade-info">
                Safe will be deployed automatically (gasless)
              </div>
            )}

            {!isInitialized && isConnected && !isDerivingCreds && (
              <div className="trade-info">
                Initializing trading client...
              </div>
            )}

            {safeUsdceBalance === 0 && isConnected && (
              <div className="trade-warning">
                Transfer USDC.e to your Safe wallet to trade
              </div>
            )}

            {orderbookError && (
              <div className="trade-warning">
                {orderbookError}
              </div>
            )}

            {isLoadingBook && (
              <div className="trade-info">
                Loading orderbook...
              </div>
            )}

            {/* Submit */}
            <button
              className={`btn-trade ${side.toLowerCase()}`}
              onClick={isConnected ? handleSubmit : connect}
              disabled={isConnected && (!canSubmit || isSubmitting || isDerivingCreds || !isInitialized)}
            >
              {!isConnected ? 'Connect Wallet' :
               isDerivingCreds ? 'Deriving API Keys...' :
               !isInitialized ? 'Initializing...' :
               isLoadingBook ? 'Loading Orderbook...' :
               orderbookError ? 'Market Unavailable' :
               isSubmitting ? 'Processing...' :
               side === 'BUY' ? 'Buy Shares' : 'Sell Shares'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
