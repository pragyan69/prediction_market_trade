import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { usePrivy, useWallets, useCreateWallet, useFundWallet } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { polygon } from 'viem/chains';

const POLYGON_CHAIN_ID = 137;

const ADDRESSES = {
  USDCe: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  CTF: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  NEG_RISK_CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  NEG_RISK_ADAPTER: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296',
} as const;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

const CTF_ABI = [
  'function isApprovedForAll(address,address) view returns (bool)',
  'function setApprovalForAll(address,bool)',
  'function balanceOf(address,uint256) view returns (uint256)',
];

export interface ApprovalStatus {
  name: string;
  approved: boolean;
  type: 'erc20' | 'erc1155';
  spender: string;
}

type LoginMethod = 'google' | 'twitter' | 'discord' | 'email' | 'wallet' | null;

interface WalletContextType {
  // Connection state
  isConnected: boolean;
  isReady: boolean;
  isInitializing: boolean;
  address: string | null;
  signer: ethers.Signer | null;
  provider: ethers.providers.Web3Provider | null;

  // User info
  walletType: 'embedded' | 'external' | null;
  walletIcon: string | null;
  userEmail: string | null;
  userName: string | null;
  loginMethod: LoginMethod;

  // Balance
  usdcBalance: number;
  maticBalance: number;
  refreshBalance: () => Promise<void>;

  // Actions
  connect: () => void;
  disconnect: () => Promise<void>;
  openFundWallet: () => Promise<void>;

  // Approvals
  approvals: ApprovalStatus[];
  isCheckingApprovals: boolean;
  isApproving: boolean;
  checkApprovals: () => Promise<void>;
  approveAll: () => Promise<void>;
  allApproved: boolean;
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
  const { fundWallet } = useFundWallet();

  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [maticBalance, setMaticBalance] = useState(0);
  const [walletType, setWalletType] = useState<'embedded' | 'external' | null>(null);
  const [walletIcon, setWalletIcon] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(null);

  // Approvals state
  const [approvals, setApprovals] = useState<ApprovalStatus[]>([]);
  const [isCheckingApprovals, setIsCheckingApprovals] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Get user display name
  const userName = user?.google?.name || user?.twitter?.name || user?.discord?.username || user?.email?.address || null;

  // Determine login method from user's linked accounts
  const detectLoginMethod = useCallback((): LoginMethod => {
    if (!user) return null;

    // Check the user's linked accounts to determine how they logged in
    // Privy stores login methods in user.linkedAccounts
    const linkedAccounts = user.linkedAccounts || [];

    // If user has wallet linked and no social accounts, they logged in with wallet
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
        console.log('[Wallet] User authenticated but no wallet found, creating embedded wallet...');
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
      if (!authenticated || !walletsReady) {
        return;
      }

      if (wallets.length === 0) {
        console.log('[Wallet] Waiting for wallet to be created...');
        return;
      }

      setIsInitializing(true);
      console.log('[Wallet] Initializing wallet, found', wallets.length, 'wallets');

      // Detect login method
      const detectedLoginMethod = detectLoginMethod();
      setLoginMethod(detectedLoginMethod);
      console.log('[Wallet] Detected login method:', detectedLoginMethod);

      // Find wallets
      const externalWallet = wallets.find(w => w.walletClientType !== 'privy');
      const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');

      // SELECT WALLET BASED ON LOGIN METHOD:
      // - Social login (google/twitter/discord/email) → Use embedded wallet ONLY
      // - Wallet login → Use external wallet ONLY
      let activeWallet;
      if (detectedLoginMethod === 'wallet') {
        // User logged in with external wallet - use external wallet ONLY
        activeWallet = externalWallet;
        console.log('[Wallet] Login method is wallet - using external wallet');
      } else if (detectedLoginMethod) {
        // User logged in with social (google/twitter/discord/email) - use embedded wallet ONLY
        activeWallet = embeddedWallet;
        console.log('[Wallet] Login method is social - using embedded wallet');
      } else {
        // Fallback: prefer embedded for new users
        activeWallet = embeddedWallet || externalWallet;
        console.log('[Wallet] Unknown login method - using available wallet');
      }

      if (!activeWallet) {
        console.log('[Wallet] No active wallet found for login method:', detectedLoginMethod);
        setIsInitializing(false);
        return;
      }

      console.log('[Wallet] Using wallet:', activeWallet.walletClientType, activeWallet.address);

      try {
        // Switch to Polygon
        console.log('[Wallet] Switching to Polygon...');
        try {
          await activeWallet.switchChain(POLYGON_CHAIN_ID);
        } catch (switchError) {
          console.warn('[Wallet] Chain switch warning:', switchError);
          // Continue anyway - some wallets don't support switching
        }

        // Get EIP-1193 provider
        console.log('[Wallet] Getting Ethereum provider...');
        const ethereumProvider = await activeWallet.getEthereumProvider();

        // Create ethers v5 provider and signer
        const ethersProvider = new ethers.providers.Web3Provider(ethereumProvider as any);
        const ethersSigner = ethersProvider.getSigner();
        const signerAddress = await ethersSigner.getAddress();

        console.log('[Wallet] Connected to address:', signerAddress);

        const isEmbedded = activeWallet.walletClientType === 'privy';

        setProvider(ethersProvider);
        setSigner(ethersSigner);
        setAddress(signerAddress);
        setWalletType(isEmbedded ? 'embedded' : 'external');

        // Set wallet icon based on login method
        if (!isEmbedded) {
          const clientType = activeWallet.walletClientType;
          if (clientType === 'metamask') setWalletIcon('metamask');
          else if (clientType === 'coinbase_wallet') setWalletIcon('coinbase');
          else if (clientType === 'wallet_connect') setWalletIcon('walletconnect');
          else setWalletIcon('wallet');
        } else {
          // For embedded wallet, show the login method icon
          if (user?.google) setWalletIcon('google');
          else if (user?.twitter) setWalletIcon('twitter');
          else if (user?.discord) setWalletIcon('discord');
          else if (user?.email) setWalletIcon('email');
          else setWalletIcon('privy');
        }

      } catch (error) {
        console.error('[Wallet] Failed to initialize wallet:', error);
      } finally {
        setIsInitializing(false);
      }
    }

    initWallet();
  }, [authenticated, walletsReady, wallets, user, detectLoginMethod]);

  // Refresh balance (USDC + MATIC)
  const refreshBalance = useCallback(async () => {
    if (!provider || !address) return;

    try {
      // Get USDC balance
      const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, provider);
      const usdcBal = await usdc.balanceOf(address);
      setUsdcBalance(Number(ethers.utils.formatUnits(usdcBal, 6)));
      console.log('[Wallet] USDC Balance:', ethers.utils.formatUnits(usdcBal, 6));

      // Get MATIC balance
      const maticBal = await provider.getBalance(address);
      setMaticBalance(Number(ethers.utils.formatUnits(maticBal, 18)));
      console.log('[Wallet] MATIC Balance:', ethers.utils.formatUnits(maticBal, 18));
    } catch (error) {
      console.error('[Wallet] Failed to refresh balance:', error);
    }
  }, [provider, address]);

  // Open Privy fund wallet modal
  const openFundWallet = useCallback(async () => {
    if (!address) {
      console.error('[Wallet] Cannot fund - no address');
      return;
    }

    try {
      console.log('[Wallet] Opening fund wallet modal for:', address);
      await fundWallet(address, {
        chain: polygon,
      });
    } catch (error) {
      console.error('[Wallet] Failed to open fund wallet:', error);
    }
  }, [address, fundWallet]);

  // Auto-refresh balance when address changes
  useEffect(() => {
    if (address && provider) {
      refreshBalance();
    }
  }, [address, provider, refreshBalance]);

  // Check all 7 approvals
  const checkApprovals = useCallback(async () => {
    if (!provider || !address) {
      console.log('[Approvals] Cannot check - no provider or address');
      return;
    }

    setIsCheckingApprovals(true);
    console.log('[Approvals] Checking approvals for', address);

    try {
      const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, provider);
      const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, provider);

      const [
        allowanceCTF,
        allowanceExchange,
        allowanceNegExchange,
        allowanceNegAdapter,
        approvedExchange,
        approvedNegExchange,
        approvedNegAdapter,
      ] = await Promise.all([
        usdc.allowance(address, ADDRESSES.CTF),
        usdc.allowance(address, ADDRESSES.CTF_EXCHANGE),
        usdc.allowance(address, ADDRESSES.NEG_RISK_CTF_EXCHANGE),
        usdc.allowance(address, ADDRESSES.NEG_RISK_ADAPTER),
        ctf.isApprovedForAll(address, ADDRESSES.CTF_EXCHANGE),
        ctf.isApprovedForAll(address, ADDRESSES.NEG_RISK_CTF_EXCHANGE),
        ctf.isApprovedForAll(address, ADDRESSES.NEG_RISK_ADAPTER),
      ]);

      const approvalStatuses = [
        { name: 'USDC → CTF', type: 'erc20' as const, spender: ADDRESSES.CTF, approved: !allowanceCTF.isZero() },
        { name: 'USDC → Exchange', type: 'erc20' as const, spender: ADDRESSES.CTF_EXCHANGE, approved: !allowanceExchange.isZero() },
        { name: 'USDC → NegRisk Exchange', type: 'erc20' as const, spender: ADDRESSES.NEG_RISK_CTF_EXCHANGE, approved: !allowanceNegExchange.isZero() },
        { name: 'USDC → NegRisk Adapter', type: 'erc20' as const, spender: ADDRESSES.NEG_RISK_ADAPTER, approved: !allowanceNegAdapter.isZero() },
        { name: 'CTF → Exchange', type: 'erc1155' as const, spender: ADDRESSES.CTF_EXCHANGE, approved: approvedExchange },
        { name: 'CTF → NegRisk Exchange', type: 'erc1155' as const, spender: ADDRESSES.NEG_RISK_CTF_EXCHANGE, approved: approvedNegExchange },
        { name: 'CTF → NegRisk Adapter', type: 'erc1155' as const, spender: ADDRESSES.NEG_RISK_ADAPTER, approved: approvedNegAdapter },
      ];

      console.log('[Approvals] Status:', approvalStatuses.filter(a => a.approved).length, '/', approvalStatuses.length, 'approved');
      setApprovals(approvalStatuses);
    } catch (error) {
      console.error('[Approvals] Failed to check approvals:', error);
    } finally {
      setIsCheckingApprovals(false);
    }
  }, [provider, address]);

  // Auto-check approvals when address changes
  useEffect(() => {
    if (address && provider) {
      checkApprovals();
    }
  }, [address, provider, checkApprovals]);

  // Approve all missing approvals
  const approveAll = useCallback(async () => {
    if (!signer || !address) {
      console.error('[Approvals] Cannot approve - no signer or address');
      return;
    }

    const pending = approvals.filter(a => !a.approved);
    if (pending.length === 0) {
      console.log('[Approvals] All already approved');
      return;
    }

    setIsApproving(true);
    console.log('[Approvals] Approving', pending.length, 'contracts...');

    try {
      const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
      const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ABI, signer);

      for (const approval of pending) {
        try {
          console.log('[Approvals] Approving', approval.name, '...');
          if (approval.type === 'erc20') {
            const tx = await usdc.approve(approval.spender, ethers.constants.MaxUint256);
            console.log('[Approvals] TX sent:', tx.hash);
            await tx.wait();
            console.log('[Approvals]', approval.name, 'approved!');
          } else {
            const tx = await ctf.setApprovalForAll(approval.spender, true);
            console.log('[Approvals] TX sent:', tx.hash);
            await tx.wait();
            console.log('[Approvals]', approval.name, 'approved!');
          }
        } catch (error) {
          console.error(`[Approvals] Failed to approve ${approval.name}:`, error);
          throw error; // Re-throw to stop the loop
        }
      }

      await checkApprovals();
    } catch (error) {
      console.error('[Approvals] Approval process failed:', error);
    } finally {
      setIsApproving(false);
    }
  }, [signer, address, approvals, checkApprovals]);

  const connect = useCallback(() => {
    login();
  }, [login]);

  const disconnect = useCallback(async () => {
    console.log('[Wallet] Disconnecting...');
    await logout();
    setSigner(null);
    setProvider(null);
    setAddress(null);
    setUsdcBalance(0);
    setMaticBalance(0);
    setWalletType(null);
    setWalletIcon(null);
    setLoginMethod(null);
    setApprovals([]);
  }, [logout]);

  const allApproved = approvals.length > 0 && approvals.every(a => a.approved);

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
    usdcBalance,
    maticBalance,
    refreshBalance,
    connect,
    disconnect,
    openFundWallet,
    approvals,
    isCheckingApprovals,
    isApproving,
    checkApprovals,
    approveAll,
    allApproved,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}
