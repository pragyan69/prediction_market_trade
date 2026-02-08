import { PrivyProvider } from '@privy-io/react-auth';
import { polygon } from 'viem/chains';
import { WalletProvider } from './contexts/WalletContext';
import { TradingProvider } from './contexts/TradingContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { Layout } from './components/Layout';

// Use environment variable or fallback to the app ID
// You MUST enable Google/Twitter/Discord OAuth in the Privy Dashboard for this App ID
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmlc020f5004jl20cro1fu8o6';

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
        },
        defaultChain: polygon,
        supportedChains: [polygon],
      }}
    >
      <WalletProvider>
        <TradingProvider>
          <WebSocketProvider>
            <Layout />
          </WebSocketProvider>
        </TradingProvider>
      </WalletProvider>
    </PrivyProvider>
  );
}
