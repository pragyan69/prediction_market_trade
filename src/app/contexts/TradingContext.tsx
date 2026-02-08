import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import type { ApiKeyCreds, TickSize } from '@polymarket/clob-client';
import { useWallet } from './WalletContext';

const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

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
  const { signer, address, isConnected, approveAll, allApproved } = useWallet();

  const [client, setClient] = useState<ClobClient | null>(null);
  const [apiCreds, setApiCreds] = useState<ApiKeyCreds | null>(null);
  const [isDerivingCreds, setIsDerivingCreds] = useState(false);

  // Initialize CLOB client when wallet connects
  useEffect(() => {
    async function initClient() {
      if (!signer || !address) {
        setClient(null);
        setApiCreds(null);
        return;
      }

      setIsDerivingCreds(true);

      try {
        // Check for stored credentials
        const stored = localStorage.getItem('POLY_USER_API_CREDS');
        let creds: ApiKeyCreds | null = null;

        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed?.key && parsed?.secret && parsed?.passphrase) {
              creds = parsed;
            }
          } catch {}
        }

        if (!creds) {
          // Derive new credentials (requires signing a message)
          console.log('Deriving API credentials...');
          const temp = new ClobClient(HOST, CHAIN_ID, signer as any);
          const derived: any = await temp.createOrDeriveApiKey();

          creds = {
            key: derived.key ?? derived.apiKey,
            secret: derived.secret,
            passphrase: derived.passphrase,
          };

          localStorage.setItem('POLY_USER_API_CREDS', JSON.stringify(creds));
          console.log('API credentials derived and saved');
        }

        setApiCreds(creds);
        setClient(new ClobClient(HOST, CHAIN_ID, signer as any, creds, 0, address));

      } catch (error) {
        console.error('Failed to initialize trading client:', error);
      } finally {
        setIsDerivingCreds(false);
      }
    }

    initClient();
  }, [signer, address]);

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

    // Ensure approvals before trading
    if (!allApproved) {
      await approveAll();
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

    return {
      orderID: response.orderID || '',
      status: response.status || 'unknown',
    };
  }, [client, allApproved, approveAll]);

  // Get open orders
  const getOpenOrders = useCallback(async () => {
    if (!client) return [];
    try {
      return await client.getOpenOrders();
    } catch (error) {
      console.error('Failed to get open orders:', error);
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
      // Use public endpoint
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
