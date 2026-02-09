import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import type { ApiKeyCreds, TickSize } from '@polymarket/clob-client';
import { useWallet } from './WalletContext';
import { useSafe } from './SafeContext';

const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Signature types for Polymarket
// 0 = EOA (standard wallet)
// 1 = POLY_PROXY
// 2 = POLY_GNOSIS_SAFE (for Safe wallets)
const SIGNATURE_TYPE_EOA = 0;
const SIGNATURE_TYPE_POLY_GNOSIS_SAFE = 2;

interface TradingContextType {
  client: ClobClient | null;
  apiCreds: ApiKeyCreds | null;
  isInitialized: boolean;
  isDerivingCreds: boolean;

  // Trading
  placeOrder: (params: {
    tokenId: string;
    price: number;
    size: number;
    side: 'BUY' | 'SELL';
    negRisk: boolean;
    tickSize: string;
  }) => Promise<{ orderID: string; status: string }>;

  // Orders
  getOpenOrders: () => Promise<any[]>;
  cancelOrder: (orderId: string) => Promise<void>;
  cancelAllOrders: () => Promise<void>;

  // Order book
  getOrderBook: (tokenId: string) => Promise<any>;
}

const TradingContext = createContext<TradingContextType | null>(null);

export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error('useTrading must be used within a TradingProvider');
  }
  return context;
}

export function TradingProvider({ children }: { children: ReactNode }) {
  const { signer, address } = useWallet();
  const { safeAddress, isSafeDeployed, deploySafe, approveAll, allApproved } = useSafe();

  const [client, setClient] = useState<ClobClient | null>(null);
  const [apiCreds, setApiCreds] = useState<ApiKeyCreds | null>(null);
  const [isDerivingCreds, setIsDerivingCreds] = useState(false);

  // Initialize CLOB client when wallet connects
  // The client uses EOA signer but trades execute from Safe address
  useEffect(() => {
    async function initClient() {
      if (!signer || !address || !safeAddress) {
        setClient(null);
        setApiCreds(null);
        return;
      }

      setIsDerivingCreds(true);

      try {
        // Check for stored credentials (keyed by EOA address)
        const storageKey = `POLY_API_CREDS_${address}`;
        const stored = localStorage.getItem(storageKey);
        let creds: ApiKeyCreds | null = null;

        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed?.key && parsed?.secret && parsed?.passphrase) {
              creds = parsed;
              console.log('[Trading] Using stored API credentials');
            }
          } catch {}
        }

        if (!creds) {
          // Derive new credentials (requires signing a message)
          console.log('[Trading] Deriving API credentials...');
          const temp = new ClobClient(HOST, CHAIN_ID, signer as any);
          const derived: any = await temp.createOrDeriveApiKey();

          creds = {
            key: derived.key ?? derived.apiKey,
            secret: derived.secret,
            passphrase: derived.passphrase,
          };

          localStorage.setItem(storageKey, JSON.stringify(creds));
          console.log('[Trading] API credentials derived and saved');
        }

        setApiCreds(creds);

        // Create client with Safe address as the funder/proxy address
        // Orders are signed by EOA but execute from Safe
        // IMPORTANT: Use signature type 2 (POLY_GNOSIS_SAFE) for Safe wallets
        const clobClient = new ClobClient(
          HOST,
          CHAIN_ID,
          signer as any,
          creds,
          SIGNATURE_TYPE_POLY_GNOSIS_SAFE, // Signature type for Gnosis Safe
          safeAddress // funder address (Safe wallet)
        );

        setClient(clobClient);
        console.log('[Trading] CLOB client initialized');
        console.log('[Trading] - EOA Signer:', address);
        console.log('[Trading] - Safe/Funder:', safeAddress);
        console.log('[Trading] - Signature Type:', SIGNATURE_TYPE_POLY_GNOSIS_SAFE, '(POLY_GNOSIS_SAFE)');

      } catch (error) {
        console.error('[Trading] Failed to initialize client:', error);
      } finally {
        setIsDerivingCreds(false);
      }
    }

    initClient();
  }, [signer, address, safeAddress]);

  // Place order
  const placeOrder = useCallback(async (params: {
    tokenId: string;
    price: number;
    size: number;
    side: 'BUY' | 'SELL';
    negRisk: boolean;
    tickSize: string;
  }) => {
    if (!client) {
      throw new Error('Trading client not initialized');
    }

    // Deploy Safe if needed (gasless)
    if (!isSafeDeployed) {
      console.log('[Trading] Deploying Safe before trading...');
      await deploySafe();
    }

    // Ensure approvals before trading (gasless)
    if (!allApproved) {
      console.log('[Trading] Setting approvals before trading...');
      await approveAll();
    }

    console.log('[Trading] Placing order...', params);

    // Validate orderbook exists before placing order
    try {
      const orderbook = await client.getOrderBook(params.tokenId);
      if (!orderbook || (!orderbook.bids?.length && !orderbook.asks?.length)) {
        throw new Error('This market has no active orderbook. Try a different market with more liquidity.');
      }
      console.log('[Trading] Orderbook validated:', orderbook.bids?.length, 'bids,', orderbook.asks?.length, 'asks');
    } catch (error: any) {
      if (error.message?.includes('no active orderbook')) {
        throw error;
      }
      // If orderbook fetch fails with specific error, the market is invalid
      if (error?.response?.status === 400 || error?.response?.data?.error?.includes('does not exist')) {
        throw new Error('This market orderbook does not exist. The market may be resolved or inactive.');
      }
      console.warn('[Trading] Orderbook check warning:', error.message);
    }

    const response = await client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side === 'BUY' ? Side.BUY : Side.SELL,
      },
      {
        tickSize: params.tickSize as TickSize,
        negRisk: params.negRisk,
      },
      OrderType.GTC
    );

    console.log('[Trading] Order placed:', response);

    // Check if response indicates an error
    if (response.error || response.status === 400) {
      throw new Error(response.error || 'Order failed');
    }

    return {
      orderID: response.orderID || '',
      status: response.status || 'unknown',
    };
  }, [client, isSafeDeployed, deploySafe, allApproved, approveAll]);

  // Get open orders
  const getOpenOrders = useCallback(async () => {
    if (!client) return [];
    try {
      return await client.getOpenOrders();
    } catch (error) {
      console.error('[Trading] Failed to get open orders:', error);
      return [];
    }
  }, [client]);

  // Cancel order
  const cancelOrder = useCallback(async (orderId: string) => {
    if (!client) throw new Error('Trading client not initialized');
    await client.cancelOrder({ orderID: orderId });
  }, [client]);

  // Cancel all orders
  const cancelAllOrders = useCallback(async () => {
    if (!client) throw new Error('Trading client not initialized');
    await client.cancelAll();
  }, [client]);

  // Get order book
  const getOrderBook = useCallback(async (tokenId: string) => {
    if (!client) {
      const response = await fetch(`${HOST}/book?token_id=${tokenId}`);
      return await response.json();
    }
    return await client.getOrderBook(tokenId);
  }, [client]);

  const value: TradingContextType = {
    client,
    apiCreds,
    isInitialized: !!client,
    isDerivingCreds,
    placeOrder,
    getOpenOrders,
    cancelOrder,
    cancelAllOrders,
    getOrderBook,
  };

  return (
    <TradingContext.Provider value={value}>
      {children}
    </TradingContext.Provider>
  );
}
