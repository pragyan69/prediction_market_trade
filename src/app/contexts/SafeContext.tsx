import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { RelayClient, RelayerTransactionState } from '@polymarket/builder-relayer-client';
import { deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { useWallet } from './WalletContext';

const POLYGON_CHAIN_ID = 137;
const RELAY_URL = 'https://relayer-v2.polymarket.com';

// Builder credentials from environment
const builderConfig = new BuilderConfig({
  localBuilderCreds: {
    key: import.meta.env.VITE_BUILDER_API_KEY || '',
    secret: import.meta.env.VITE_BUILDER_SECRET || '',
    passphrase: import.meta.env.VITE_BUILDER_PASSPHRASE || '',
  },
});

// Contract addresses on Polygon
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

interface SafeContextType {
  // Safe wallet
  safeAddress: string | null;
  isSafeDeployed: boolean;
  isDeployingSafe: boolean;
  deploySafe: () => Promise<void>;

  // Balances (from Safe wallet)
  safeUsdceBalance: number;
  safeMaticBalance: number;
  refreshSafeBalance: () => Promise<void>;

  // Approvals (gasless via RelayClient)
  approvals: ApprovalStatus[];
  isCheckingApprovals: boolean;
  isApproving: boolean;
  checkApprovals: () => Promise<void>;
  approveAll: () => Promise<void>;
  allApproved: boolean;

  // RelayClient
  relayClient: RelayClient | null;
}

const SafeContext = createContext<SafeContextType | null>(null);

export function useSafe() {
  const context = useContext(SafeContext);
  if (!context) {
    throw new Error('useSafe must be used within a SafeProvider');
  }
  return context;
}

export function SafeProvider({ children }: { children: ReactNode }) {
  const { signer, address, provider, isConnected } = useWallet();

  const [safeAddress, setSafeAddress] = useState<string | null>(null);
  const [isSafeDeployed, setIsSafeDeployed] = useState(false);
  const [isDeployingSafe, setIsDeployingSafe] = useState(false);
  const [relayClient, setRelayClient] = useState<RelayClient | null>(null);

  // Balances
  const [safeUsdceBalance, setSafeUsdceBalance] = useState(0);
  const [safeMaticBalance, setSafeMaticBalance] = useState(0);

  // Approvals
  const [approvals, setApprovals] = useState<ApprovalStatus[]>([]);
  const [isCheckingApprovals, setIsCheckingApprovals] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Derive Safe address from EOA
  useEffect(() => {
    if (!address) {
      setSafeAddress(null);
      return;
    }

    try {
      const config = getContractConfig(POLYGON_CHAIN_ID);
      const derived = deriveSafe(address, config.SafeContracts.SafeFactory);
      setSafeAddress(derived);
      console.log('[Safe] Derived Safe address:', derived, 'from EOA:', address);
    } catch (error) {
      console.error('[Safe] Failed to derive Safe address:', error);
    }
  }, [address]);

  // Check if Safe is deployed
  useEffect(() => {
    async function checkDeployment() {
      if (!safeAddress || !provider) {
        setIsSafeDeployed(false);
        return;
      }

      try {
        const code = await provider.getCode(safeAddress);
        const deployed = code !== '0x';
        setIsSafeDeployed(deployed);
        console.log('[Safe] Safe deployed:', deployed);
      } catch (error) {
        console.error('[Safe] Failed to check Safe deployment:', error);
        setIsSafeDeployed(false);
      }
    }

    checkDeployment();
  }, [safeAddress, provider]);

  // Initialize RelayClient
  useEffect(() => {
    async function initRelayClient() {
      if (!signer || !address) {
        setRelayClient(null);
        return;
      }

      try {
        // RelayClient constructor: (relayerUrl, chainId, signer, builderConfig, relayTxType)
        const client = new RelayClient(
          RELAY_URL,
          POLYGON_CHAIN_ID,
          signer as any,
          builderConfig
        );

        setRelayClient(client);
        console.log('[Safe] RelayClient initialized');
      } catch (error) {
        console.error('[Safe] Failed to initialize RelayClient:', error);
      }
    }

    initRelayClient();
  }, [signer, address]);

  // Refresh Safe balance
  const refreshSafeBalance = useCallback(async () => {
    if (!provider || !safeAddress) return;

    try {
      // Get USDC.e balance
      const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, provider);
      const usdcBal = await usdc.balanceOf(safeAddress);
      setSafeUsdceBalance(Number(ethers.utils.formatUnits(usdcBal, 6)));

      // Get MATIC/POL balance
      const maticBal = await provider.getBalance(safeAddress);
      setSafeMaticBalance(Number(ethers.utils.formatUnits(maticBal, 18)));

      console.log('[Safe] Safe balances - USDC.e:', ethers.utils.formatUnits(usdcBal, 6), 'POL:', ethers.utils.formatUnits(maticBal, 18));
    } catch (error) {
      console.error('[Safe] Failed to refresh Safe balance:', error);
    }
  }, [provider, safeAddress]);

  // Auto-refresh balance when Safe address changes
  useEffect(() => {
    if (safeAddress && provider) {
      refreshSafeBalance();
    }
  }, [safeAddress, provider, refreshSafeBalance]);

  // Deploy Safe (gasless via RelayClient)
  const deploySafe = useCallback(async () => {
    if (!relayClient || isSafeDeployed) {
      console.log('[Safe] Cannot deploy - no client or already deployed');
      return;
    }

    setIsDeployingSafe(true);
    console.log('[Safe] Deploying Safe...');

    try {
      const response = await relayClient.deploy();
      console.log('[Safe] Deploy transaction submitted:', response.transactionID);

      // Poll until mined
      const result = await relayClient.pollUntilState(
        response.transactionID,
        [
          RelayerTransactionState.STATE_MINED,
          RelayerTransactionState.STATE_CONFIRMED,
          RelayerTransactionState.STATE_FAILED,
        ],
        undefined,
        40,    // maxPolls (40 * 3s = 2 minutes)
        3000   // 3 second polling interval
      );

      if (!result || result.state === RelayerTransactionState.STATE_FAILED) {
        throw new Error('Safe deployment failed');
      }

      console.log('[Safe] Safe deployed successfully at:', result.proxyAddress);
      setIsSafeDeployed(true);
      if (result.proxyAddress) {
        setSafeAddress(result.proxyAddress);
      }
    } catch (error) {
      console.error('[Safe] Safe deployment failed:', error);
      throw error;
    } finally {
      setIsDeployingSafe(false);
    }
  }, [relayClient, isSafeDeployed]);

  // Check approvals for Safe address
  const checkApprovals = useCallback(async () => {
    if (!provider || !safeAddress) {
      console.log('[Safe] Cannot check approvals - no provider or Safe address');
      return;
    }

    setIsCheckingApprovals(true);
    console.log('[Safe] Checking approvals for Safe:', safeAddress);

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
        usdc.allowance(safeAddress, ADDRESSES.CTF),
        usdc.allowance(safeAddress, ADDRESSES.CTF_EXCHANGE),
        usdc.allowance(safeAddress, ADDRESSES.NEG_RISK_CTF_EXCHANGE),
        usdc.allowance(safeAddress, ADDRESSES.NEG_RISK_ADAPTER),
        ctf.isApprovedForAll(safeAddress, ADDRESSES.CTF_EXCHANGE),
        ctf.isApprovedForAll(safeAddress, ADDRESSES.NEG_RISK_CTF_EXCHANGE),
        ctf.isApprovedForAll(safeAddress, ADDRESSES.NEG_RISK_ADAPTER),
      ]);

      const approvalStatuses: ApprovalStatus[] = [
        { name: 'USDC → CTF', type: 'erc20', spender: ADDRESSES.CTF, approved: !allowanceCTF.isZero() },
        { name: 'USDC → Exchange', type: 'erc20', spender: ADDRESSES.CTF_EXCHANGE, approved: !allowanceExchange.isZero() },
        { name: 'USDC → NegRisk Exchange', type: 'erc20', spender: ADDRESSES.NEG_RISK_CTF_EXCHANGE, approved: !allowanceNegExchange.isZero() },
        { name: 'USDC → NegRisk Adapter', type: 'erc20', spender: ADDRESSES.NEG_RISK_ADAPTER, approved: !allowanceNegAdapter.isZero() },
        { name: 'CTF → Exchange', type: 'erc1155', spender: ADDRESSES.CTF_EXCHANGE, approved: approvedExchange },
        { name: 'CTF → NegRisk Exchange', type: 'erc1155', spender: ADDRESSES.NEG_RISK_CTF_EXCHANGE, approved: approvedNegExchange },
        { name: 'CTF → NegRisk Adapter', type: 'erc1155', spender: ADDRESSES.NEG_RISK_ADAPTER, approved: approvedNegAdapter },
      ];

      console.log('[Safe] Approvals:', approvalStatuses.filter(a => a.approved).length, '/', approvalStatuses.length);
      setApprovals(approvalStatuses);
    } catch (error) {
      console.error('[Safe] Failed to check approvals:', error);
    } finally {
      setIsCheckingApprovals(false);
    }
  }, [provider, safeAddress]);

  // Auto-check approvals when Safe is deployed
  useEffect(() => {
    if (safeAddress && provider && isSafeDeployed) {
      checkApprovals();
    }
  }, [safeAddress, provider, isSafeDeployed, checkApprovals]);

  // Approve all (gasless via RelayClient)
  const approveAll = useCallback(async () => {
    if (!relayClient || !safeAddress) {
      console.error('[Safe] Cannot approve - no RelayClient or Safe address');
      return;
    }

    // Deploy Safe first if needed
    if (!isSafeDeployed) {
      console.log('[Safe] Safe not deployed, deploying first...');
      await deploySafe();
    }

    const pending = approvals.filter(a => !a.approved);
    if (pending.length === 0) {
      console.log('[Safe] All already approved');
      return;
    }

    setIsApproving(true);
    console.log('[Safe] Approving', pending.length, 'contracts via RelayClient (gasless)...');

    try {
      // Build approval transactions
      const usdcInterface = new ethers.utils.Interface(ERC20_ABI);
      const ctfInterface = new ethers.utils.Interface(CTF_ABI);

      const transactions = pending.map(approval => {
        if (approval.type === 'erc20') {
          return {
            to: ADDRESSES.USDCe,
            data: usdcInterface.encodeFunctionData('approve', [approval.spender, ethers.constants.MaxUint256]),
            value: '0',
          };
        } else {
          return {
            to: ADDRESSES.CTF,
            data: ctfInterface.encodeFunctionData('setApprovalForAll', [approval.spender, true]),
            value: '0',
          };
        }
      });

      console.log('[Safe] Submitting', transactions.length, 'approval transactions...');

      // Execute via RelayClient (gasless!)
      const response = await relayClient.execute(transactions, 'Set token approvals');
      console.log('[Safe] Approval transaction submitted:', response.transactionID);

      // Poll until mined
      const result = await relayClient.pollUntilState(
        response.transactionID,
        [
          RelayerTransactionState.STATE_MINED,
          RelayerTransactionState.STATE_CONFIRMED,
          RelayerTransactionState.STATE_FAILED,
        ],
        undefined,
        40,
        3000
      );

      if (!result || result.state === RelayerTransactionState.STATE_FAILED) {
        throw new Error('Approval transaction failed');
      }

      console.log('[Safe] Approvals set successfully!');
      await checkApprovals();
    } catch (error) {
      console.error('[Safe] Approval failed:', error);
      throw error;
    } finally {
      setIsApproving(false);
    }
  }, [relayClient, safeAddress, isSafeDeployed, deploySafe, approvals, checkApprovals]);

  const allApproved = approvals.length > 0 && approvals.every(a => a.approved);

  const value: SafeContextType = {
    safeAddress,
    isSafeDeployed,
    isDeployingSafe,
    deploySafe,
    safeUsdceBalance,
    safeMaticBalance,
    refreshSafeBalance,
    approvals,
    isCheckingApprovals,
    isApproving,
    checkApprovals,
    approveAll,
    allApproved,
    relayClient,
  };

  return (
    <SafeContext.Provider value={value}>
      {children}
    </SafeContext.Provider>
  );
}
