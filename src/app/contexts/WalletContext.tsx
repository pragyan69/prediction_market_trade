import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { ethers } from 'ethers';

const POLYGON_CHAIN_ID = 137;

// USDC.e address on Polygon
const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

type LoginMethod = 'google' | 'twitter' | 'discord' | 'email' | 'wallet' | null;

interface WalletContextType {
  // Connection state
  isConnected: boolean;
  isReady: boolean;
  isInitializing: boolean;
  address: string | null;  // EOA address
  signer: ethers.Signer | null;
  provider: ethers.providers.Web3Provider | null;

  // User info
  walletType: 'embedded' | 'external' | null;
  walletIcon: string | null;
  userEmail: string | null;
  userName: string | null;
  loginMethod: LoginMethod;

  // EOA Balances
  eoaMaticBalance: number;
  eoaUsdceBalance: number;
  refreshEoaBalance: () => Promise<void>;

  // Actions
  connect: () => void;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();

  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [eoaMaticBalance, setEoaMaticBalance] = useState(0);
  const [eoaUsdceBalance, setEoaUsdceBalance] = useState(0);
  const [walletType, setWalletType] = useState<'embedded' | 'external' | null>(null);
  const [walletIcon, setWalletIcon] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(null);

  // Get user display name
  const userName = user?.google?.name || user?.twitter?.name || user?.discord?.username || user?.email?.address || null;

  // Determine login method
  const detectLoginMethod = useCallback((): LoginMethod => {
    if (!user) return null;
    const linkedAccounts = user.linkedAccounts || [];
    const hasWallet = linkedAccounts.some((acc: any) => acc.type === 'wallet');
    const hasSocial = user.google || user.twitter || user.discord || user.email;

    if (user.google) return 'google';
    if (user.twitter) return 'twitter';
    if (user.discord) return 'discord';
    if (user.email) return 'email';
    if (hasWallet && !hasSocial) return 'wallet';
    return null;
  }, [user]);

  // Create embedded wallet if user logged in but has no wallet
  useEffect(() => {
    async function ensureWallet() {
      if (authenticated && walletsReady && wallets.length === 0) {
        console.log('[Wallet] Creating embedded wallet...');
        try {
          await createWallet();
          console.log('[Wallet] Embedded wallet created');
        } catch (error) {
          console.error('[Wallet] Failed to create embedded wallet:', error);
        }
      }
    }
    ensureWallet();
  }, [authenticated, walletsReady, wallets.length, createWallet]);

  // Initialize wallet when wallets change
  useEffect(() => {
    async function initWallet() {
      if (!authenticated || !walletsReady || wallets.length === 0) {
        return;
      }

      setIsInitializing(true);
      console.log('[Wallet] Initializing, found', wallets.length, 'wallets');

      const detectedLoginMethod = detectLoginMethod();
      setLoginMethod(detectedLoginMethod);

      // Select wallet based on login method
      const externalWallet = wallets.find(w => w.walletClientType !== 'privy');
      const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');

      let activeWallet;
      if (detectedLoginMethod === 'wallet') {
        activeWallet = externalWallet;
      } else if (detectedLoginMethod) {
        activeWallet = embeddedWallet;
      } else {
        activeWallet = embeddedWallet || externalWallet;
      }

      if (!activeWallet) {
        setIsInitializing(false);
        return;
      }

      console.log('[Wallet] Using:', activeWallet.walletClientType, activeWallet.address);

      try {
        // Switch to Polygon
        try {
          await activeWallet.switchChain(POLYGON_CHAIN_ID);
          console.log('[Wallet] Switched to Polygon');
        } catch (e) {
          console.warn('[Wallet] Chain switch warning:', e);
        }

        // Get provider and signer
        const ethereumProvider = await activeWallet.getEthereumProvider();
        const ethersProvider = new ethers.providers.Web3Provider(ethereumProvider as any);
        const ethersSigner = ethersProvider.getSigner();
        const signerAddress = await ethersSigner.getAddress();

        setProvider(ethersProvider);
        setSigner(ethersSigner);
        setAddress(signerAddress);

        const isEmbedded = activeWallet.walletClientType === 'privy';
        setWalletType(isEmbedded ? 'embedded' : 'external');

        // Set wallet icon
        if (!isEmbedded) {
          const clientType = activeWallet.walletClientType;
          if (clientType === 'metamask') setWalletIcon('metamask');
          else if (clientType === 'coinbase_wallet') setWalletIcon('coinbase');
          else if (clientType === 'wallet_connect') setWalletIcon('walletconnect');
          else setWalletIcon('wallet');
        } else {
          if (user?.google) setWalletIcon('google');
          else if (user?.twitter) setWalletIcon('twitter');
          else if (user?.discord) setWalletIcon('discord');
          else if (user?.email) setWalletIcon('email');
          else setWalletIcon('privy');
        }

        console.log('[Wallet] Connected to EOA:', signerAddress);
      } catch (error) {
        console.error('[Wallet] Failed to initialize:', error);
      } finally {
        setIsInitializing(false);
      }
    }

    initWallet();
  }, [authenticated, walletsReady, wallets, user, detectLoginMethod]);

  // Refresh EOA balance (POL + USDC.e)
  const refreshEoaBalance = useCallback(async () => {
    if (!provider || !address) return;
    try {
      // Get POL balance
      const maticBal = await provider.getBalance(address);
      setEoaMaticBalance(Number(ethers.utils.formatUnits(maticBal, 18)));

      // Get USDC.e balance
      const usdc = new ethers.Contract(USDC_E_ADDRESS, ERC20_ABI, provider);
      const usdcBal = await usdc.balanceOf(address);
      setEoaUsdceBalance(Number(ethers.utils.formatUnits(usdcBal, 6)));

      console.log('[Wallet] EOA Balances - POL:', ethers.utils.formatUnits(maticBal, 18), 'USDC.e:', ethers.utils.formatUnits(usdcBal, 6));
    } catch (error) {
      console.error('[Wallet] Failed to refresh EOA balance:', error);
    }
  }, [provider, address]);

  // Auto-refresh balance
  useEffect(() => {
    if (address && provider) {
      refreshEoaBalance();
    }
  }, [address, provider, refreshEoaBalance]);

  const connect = useCallback(() => {
    login();
  }, [login]);

  const disconnect = useCallback(async () => {
    console.log('[Wallet] Disconnecting...');
    await logout();
    setSigner(null);
    setProvider(null);
    setAddress(null);
    setEoaMaticBalance(0);
    setEoaUsdceBalance(0);
    setWalletType(null);
    setWalletIcon(null);
    setLoginMethod(null);
  }, [logout]);

  const value: WalletContextType = {
    isConnected: authenticated && !!address,
    isReady: ready && walletsReady,
    isInitializing,
    address,
    signer,
    provider,
    walletType,
    walletIcon,
    userEmail: user?.email?.address || null,
    userName,
    loginMethod,
    eoaMaticBalance,
    eoaUsdceBalance,
    refreshEoaBalance,
    connect,
    disconnect,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}
