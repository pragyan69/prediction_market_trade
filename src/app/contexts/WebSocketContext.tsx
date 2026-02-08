import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { polymarketWS, type WebSocketMessage, type BookMessage } from '../websocket';

interface WebSocketContextType {
  isConnected: boolean;
  subscribeToMarket: (conditionId: string) => void;
  subscribeToAsset: (assetId: string) => void;
  unsubscribeFromMarket: (conditionId: string) => void;
  onMessage: (handler: (msg: WebSocketMessage) => void) => () => void;
  getStats: () => { connected: boolean; subscribedMarkets: number; subscribedAssets: number; messagesReceived: number };
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);

  // Connect to WebSocket on mount
  useEffect(() => {
    const unsubscribeStatus = polymarketWS.onStatusChange((connected) => {
      setIsConnected(connected);
    });

    polymarketWS.connect().catch(console.error);

    return () => {
      unsubscribeStatus();
    };
  }, []);

  const subscribeToMarket = useCallback((conditionId: string) => {
    polymarketWS.subscribeToMarket(conditionId);
  }, []);

  const subscribeToAsset = useCallback((assetId: string) => {
    polymarketWS.subscribeToAsset(assetId);
  }, []);

  const unsubscribeFromMarket = useCallback((conditionId: string) => {
    polymarketWS.unsubscribeFromMarket(conditionId);
  }, []);

  const onMessage = useCallback((handler: (msg: WebSocketMessage) => void) => {
    return polymarketWS.onMessage(handler);
  }, []);

  const getStats = useCallback(() => {
    return polymarketWS.getStats();
  }, []);

  const value: WebSocketContextType = {
    isConnected,
    subscribeToMarket,
    subscribeToAsset,
    unsubscribeFromMarket,
    onMessage,
    getStats,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
