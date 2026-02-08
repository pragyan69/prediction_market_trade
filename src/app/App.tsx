import { PrivyProvider } from '@privy-io/react-auth';
import { WalletProvider } from './contexts/WalletContext';
import { SafeProvider } from './contexts/SafeContext';
import { TradingProvider } from './contexts/TradingContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { Layout } from './components/Layout';
import type { Chain } from 'viem';

// Use environment variable or fallback to the app ID
// You MUST enable Google/Twitter/Discord OAuth in the Privy Dashboard for this App ID
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmlc020f5004jl20cro1fu8o6';

// Define Polygon with explicit RPC to ensure Privy uses correct network
const polygonMainnet: Chain = {
  id: 137,
  name: 'Polygon',
  nativeCurrency: {
    decimals: 18,
    name: 'POL',
    symbol: 'POL',
  },
  rpcUrls: {
    default: {
      http: ['https://polygon-rpc.com'],
    },
    public: {
      http: ['https://polygon-rpc.com'],
    },
  },
  blockExplorers: {
    default: { name: 'PolygonScan', url: 'https://polygonscan.com' },
  },
};

export function App() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'twitter', 'discord', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#6366f1',
          showWalletLoginFirst: false,
          landingHeader: 'Login to Polymarket',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          // Skip Privy's transaction confirmation UI to avoid balance check issues
          noPromptOnSignature: true,
        },
        defaultChain: polygonMainnet,
        supportedChains: [polygonMainnet],
      }}
    >
      <WalletProvider>
        <SafeProvider>
          <TradingProvider>
            <WebSocketProvider>
              <Layout />
            </WebSocketProvider>
          </TradingProvider>
        </SafeProvider>
      </WalletProvider>
    </PrivyProvider>
  );
}
