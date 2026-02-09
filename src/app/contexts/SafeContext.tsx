import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config';
import { useWallet } from './WalletContext';

const POLYGON_CHAIN_ID = 137;

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

// Transaction states from relayer
const TX_STATE = {
  PENDING: 'STATE_PENDING',
  SUBMITTED: 'STATE_SUBMITTED',
  MINED: 'STATE_MINED',
  CONFIRMED: 'STATE_CONFIRMED',
  FAILED: 'STATE_FAILED',
} as const;

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

  // Approvals (gasless via server API)
  approvals: ApprovalStatus[];
  isCheckingApprovals: boolean;
  isApproving: boolean;
  checkApprovals: () => Promise<void>;
  approveAll: () => Promise<void>;
  allApproved: boolean;
}

const SafeContext = createContext<SafeContextType | null>(null);

export function useSafe() {
  const context = useContext(SafeContext);
  if (!context) {
    throw new Error('useSafe must be used within a SafeProvider');
  }
  return context;
}

// EIP-712 domain for Safe deployment signature (CreateProxy)
const getSafeDeployDomain = (chainId: number, safeFactory: string) => ({
  name: 'Polymarket Contract Proxy Factory',
  chainId,
  verifyingContract: safeFactory,
});

// EIP-712 types for Safe deployment (CreateProxy)
const SAFE_DEPLOY_TYPES = {
  CreateProxy: [
    { name: 'paymentToken', type: 'address' },
    { name: 'payment', type: 'uint256' },
    { name: 'paymentReceiver', type: 'address' },
  ],
};

export function SafeProvider({ children }: { children: ReactNode }) {
  const { signer, address, provider, isConnected } = useWallet();

  const [safeAddress, setSafeAddress] = useState<string | null>(null);
  const [safeFactoryAddress, setSafeFactoryAddress] = useState<string | null>(null);
  const [isSafeDeployed, setIsSafeDeployed] = useState(false);
  const [isDeployingSafe, setIsDeployingSafe] = useState(false);

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
      setSafeFactoryAddress(null);
      return;
    }

    try {
      const config = getContractConfig(POLYGON_CHAIN_ID);
      const derived = deriveSafe(address, config.SafeContracts.SafeFactory);
      setSafeAddress(derived);
      setSafeFactoryAddress(config.SafeContracts.SafeFactory);
      console.log('[Safe] Derived Safe address:', derived, 'from EOA:', address);
    } catch (error) {
      console.error('[Safe] Failed to derive Safe address:', error);
    }
  }, [address]);

  // Check if Safe is deployed (using relayer API)
  const checkSafeDeployed = useCallback(async (): Promise<boolean> => {
    if (!safeAddress) return false;

    try {
      // First check with relayer
      const response = await fetch(`/api/safe/deployed?address=${safeAddress}`);
      const data = await response.json();
      console.log('[Safe] Relayer deployed check:', data);
      return data.deployed === true;
    } catch (error) {
      console.error('[Safe] Failed to check deployment via relayer:', error);

      // Fallback to on-chain check
      if (provider) {
        try {
          const code = await provider.getCode(safeAddress);
          return code !== '0x';
        } catch {
          return false;
        }
      }
      return false;
    }
  }, [safeAddress, provider]);

  useEffect(() => {
    async function checkDeployment() {
      if (!safeAddress) {
        setIsSafeDeployed(false);
        return;
      }

      const deployed = await checkSafeDeployed();
      setIsSafeDeployed(deployed);
      console.log('[Safe] Safe deployed:', deployed);
    }

    checkDeployment();
  }, [safeAddress, checkSafeDeployed]);

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

  // Poll transaction status via server API
  const pollTransactionStatus = async (txId: string, maxPolls = 40, interval = 3000): Promise<any> => {
    for (let i = 0; i < maxPolls; i++) {
      try {
        const response = await fetch(`/api/safe/status?txId=${txId}`);
        const result = await response.json();

        // Response is an array of transactions
        const tx = Array.isArray(result) ? result[0] : result;
        const state = tx?.state;

        console.log(`[Safe] Poll ${i + 1}/${maxPolls} - Status:`, state);

        if (state === TX_STATE.MINED || state === TX_STATE.CONFIRMED) {
          return tx;
        }
        if (state === TX_STATE.FAILED) {
          throw new Error('Transaction failed');
        }

        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        console.error('[Safe] Poll error:', error);
        if (i === maxPolls - 1) throw error;
      }
    }
    throw new Error('Transaction timeout');
  };

  // Deploy Safe (gasless via server API)
  const deploySafe = useCallback(async () => {
    if (!signer || !address || !safeAddress || !safeFactoryAddress) {
      console.log('[Safe] Cannot deploy - missing requirements');
      return;
    }

    // Check if already deployed
    const alreadyDeployed = await checkSafeDeployed();
    if (alreadyDeployed) {
      console.log('[Safe] Safe already deployed');
      setIsSafeDeployed(true);
      return;
    }

    setIsDeployingSafe(true);
    console.log('[Safe] Deploying Safe...');

    try {
      // Sign the deploy message with EIP-712 (CreateProxy)
      const domain = getSafeDeployDomain(POLYGON_CHAIN_ID, safeFactoryAddress);
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const message = {
        paymentToken: ZERO_ADDRESS,
        payment: 0n, // Use BigInt
        paymentReceiver: ZERO_ADDRESS,
      };

      console.log('[Safe] Signing deploy message...');
      console.log('[Safe] Domain:', domain);
      console.log('[Safe] Message:', message);
      const signature = await (signer as any)._signTypedData(domain, SAFE_DEPLOY_TYPES, message);
      console.log('[Safe] Signature obtained:', signature);

      // Send to server API
      const response = await fetch('/api/safe/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eoaAddress: address,
          signature,
          proxyAddress: safeAddress,
          safeFactoryAddress,
        }),
      });

      const responseText = await response.text();
      console.log('[Safe] Deploy response:', response.status, responseText);

      if (!responseText) {
        throw new Error('Empty response from server');
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }

      if (!response.ok) {
        throw new Error(result.error || 'Deploy request failed');
      }
      console.log('[Safe] Deploy transaction submitted:', result.transactionID || result.id);

      // Poll for completion
      const txId = result.transactionID || result.id;
      if (txId) {
        console.log('[Safe] Polling for deploy completion...');
        try {
          const finalResult = await pollTransactionStatus(txId);
          console.log('[Safe] Safe deployed successfully!', finalResult);
        } catch (pollError) {
          console.log('[Safe] Poll failed, checking deployment directly...');
          // Even if poll fails, check if actually deployed
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
        }
      }

      // Verify deployment with relayer
      const deployed = await checkSafeDeployed();
      if (deployed) {
        console.log('[Safe] Deployment confirmed with relayer!');
        setIsSafeDeployed(true);
      } else {
        console.log('[Safe] Deployment not yet confirmed, may need more time');
        // Set optimistically and let UI check again
        setIsSafeDeployed(true);
      }
    } catch (error) {
      console.error('[Safe] Safe deployment failed:', error);
      throw error;
    } finally {
      setIsDeployingSafe(false);
    }
  }, [signer, address, safeAddress, safeFactoryAddress, checkSafeDeployed]);

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

  // Multisend contract address on Polygon
  const SAFE_MULTISEND = '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D';

  // Create a multisend transaction from multiple transactions
  const createMultisendData = (transactions: Array<{ to: string; data: string; value: string; operation: number }>) => {
    // Encode each transaction for multisend
    const encodedTxns = transactions.map(tx => {
      const operation = tx.operation || 0;
      const to = tx.to;
      const value = ethers.BigNumber.from(tx.value || '0');
      const data = tx.data;
      const dataLength = ethers.utils.hexDataLength(data);

      return ethers.utils.solidityPack(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [operation, to, value, dataLength, data]
      );
    });

    // Concatenate all encoded transactions
    const packedData = ethers.utils.hexConcat(encodedTxns);

    // Encode the multiSend call
    const multisendInterface = new ethers.utils.Interface([
      'function multiSend(bytes memory transactions)',
    ]);

    return multisendInterface.encodeFunctionData('multiSend', [packedData]);
  };

  // Approve all (gasless via server API)
  const approveAll = useCallback(async () => {
    if (!signer || !address || !safeAddress) {
      console.error('[Safe] Cannot approve - no signer or Safe address');
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
    console.log('[Safe] Approving', pending.length, 'contracts via server API (gasless)...');

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
            operation: 0, // CALL
          };
        } else {
          return {
            to: ADDRESSES.CTF,
            data: ctfInterface.encodeFunctionData('setApprovalForAll', [approval.spender, true]),
            value: '0',
            operation: 0, // CALL
          };
        }
      });

      // Get nonce from relayer
      console.log('[Safe] Getting nonce...');
      const nonceResponse = await fetch(`/api/safe/nonce?address=${address}&type=SAFE`);
      const nonceData = await nonceResponse.json();
      // Nonce must be a string for the relayer API
      const nonce = String(nonceData.nonce || '0');
      console.log('[Safe] Got nonce:', nonce);

      // Aggregate transactions - single tx or multisend
      let finalTo: string;
      let finalData: string;
      let finalOperation: number;

      if (transactions.length === 1) {
        finalTo = transactions[0].to;
        finalData = transactions[0].data;
        finalOperation = 0; // CALL
      } else {
        // Use multisend for multiple transactions
        finalTo = SAFE_MULTISEND;
        finalData = createMultisendData(transactions);
        finalOperation = 1; // DELEGATECALL for multisend
      }

      // Build EIP-712 struct hash for SafeTx (matching SDK approach)
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

      // Create the EIP-712 typed data hash manually
      const safeTxDomain = {
        chainId: POLYGON_CHAIN_ID,
        verifyingContract: safeAddress,
      };

      const safeTxTypes = {
        SafeTx: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'operation', type: 'uint8' },
          { name: 'safeTxGas', type: 'uint256' },
          { name: 'baseGas', type: 'uint256' },
          { name: 'gasPrice', type: 'uint256' },
          { name: 'gasToken', type: 'address' },
          { name: 'refundReceiver', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const safeTxMessage = {
        to: finalTo,
        value: ethers.BigNumber.from(0),
        data: finalData,
        operation: finalOperation,
        safeTxGas: ethers.BigNumber.from(0),
        baseGas: ethers.BigNumber.from(0),
        gasPrice: ethers.BigNumber.from(0),
        gasToken: ZERO_ADDRESS,
        refundReceiver: ZERO_ADDRESS,
        nonce: ethers.BigNumber.from(nonce),
      };

      // Compute the EIP-712 typed data hash using ethers._TypedDataEncoder
      const typedDataHash = ethers.utils._TypedDataEncoder.hash(
        safeTxDomain,
        safeTxTypes,
        safeTxMessage
      );
      console.log('[Safe] Computed typed data hash:', typedDataHash);

      // Sign the hash using signMessage (eth_sign / personal_sign)
      // This matches the SDK's approach: signer.signMessage(structHash)
      console.log('[Safe] Signing with signMessage...');
      const signature = await signer.signMessage(ethers.utils.arrayify(typedDataHash));
      console.log('[Safe] Got signature:', signature.substring(0, 30) + '...');

      // Pack signature in Gnosis format with adjusted v value for eth_sign
      // v = 27/28 for EIP-712, v = 31/32 for eth_sign (add +4)
      const sig = ethers.utils.splitSignature(signature);
      let adjustedV = sig.v;
      if (adjustedV === 27 || adjustedV === 28) {
        adjustedV += 4; // Convert to eth_sign format for Gnosis Safe
      }
      const packedSig = ethers.utils.solidityPack(
        ['uint256', 'uint256', 'uint8'],
        [sig.r, sig.s, adjustedV]
      );
      console.log('[Safe] Packed signature (v adjusted to', adjustedV, '):', packedSig.substring(0, 40) + '...');

      console.log('[Safe] Submitting', transactions.length, 'approval transactions...');

      // Send to server API with correct format
      const response = await fetch('/api/safe/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: address,
          to: finalTo,
          proxyWallet: safeAddress,
          data: finalData,
          nonce: nonce,
          signature: packedSig,
          signatureParams: {
            gasPrice: '0',
            operation: `${finalOperation}`,
            safeTxnGas: '0',
            baseGas: '0',
            gasToken: ZERO_ADDRESS,
            refundReceiver: ZERO_ADDRESS,
          },
          metadata: 'Set token approvals',
        }),
      });

      const responseText = await response.text();
      console.log('[Safe] Execute response:', response.status, responseText);

      if (!response.ok) {
        let error;
        try {
          error = JSON.parse(responseText);
        } catch {
          error = { error: responseText };
        }
        throw new Error(error.error || 'Execute request failed');
      }

      const result = JSON.parse(responseText);
      console.log('[Safe] Approval transaction submitted:', result.transactionID || result.id);

      // Poll for completion
      const txId = result.transactionID || result.id;
      if (txId) {
        await pollTransactionStatus(txId);
      }

      console.log('[Safe] Approvals set successfully!');
      await checkApprovals();
    } catch (error) {
      console.error('[Safe] Approval failed:', error);
      throw error;
    } finally {
      setIsApproving(false);
    }
  }, [signer, address, safeAddress, isSafeDeployed, deploySafe, approvals, checkApprovals]);

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
  };

  return (
    <SafeContext.Provider value={value}>
      {children}
    </SafeContext.Provider>
  );
}
