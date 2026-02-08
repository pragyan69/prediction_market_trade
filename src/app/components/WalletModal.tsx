import { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useSafe } from '../contexts/SafeContext';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const {
    address,
    userName,
    walletType,
    walletIcon,
    loginMethod,
    disconnect,
    eoaUsdceBalance,
    eoaMaticBalance,
    refreshEoaBalance,
  } = useWallet();

  const {
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
  } = useSafe();

  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'wallet' | 'approvals'>('wallet');

  if (!isOpen) return null;

  const copyAddress = async (addr: string) => {
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatBalance = (balance: number, decimals = 2) => {
    if (balance >= 1000000) return `${(balance / 1000000).toFixed(2)}M`;
    if (balance >= 1000) return `${(balance / 1000).toFixed(2)}K`;
    return balance.toFixed(decimals);
  };

  const getLoginMethodLabel = () => {
    switch (loginMethod) {
      case 'google': return 'Google';
      case 'twitter': return 'Twitter';
      case 'discord': return 'Discord';
      case 'email': return 'Email';
      case 'wallet': return 'External Wallet';
      default: return 'Unknown';
    }
  };

  const getWalletIconEmoji = () => {
    switch (walletIcon) {
      case 'google': return '🔵';
      case 'twitter': return '🐦';
      case 'discord': return '💜';
      case 'email': return '📧';
      case 'metamask': return '🦊';
      case 'coinbase': return '🔵';
      case 'walletconnect': return '🔗';
      default: return '👛';
    }
  };

  const approvedCount = approvals.filter(a => a.approved).length;
  const totalApprovals = approvals.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wallet-modal-header">
          <h2>Wallet</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="wallet-modal-tabs">
          <button
            className={`wallet-tab ${activeTab === 'wallet' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallet')}
          >
            Wallet
          </button>
          <button
            className={`wallet-tab ${activeTab === 'approvals' ? 'active' : ''}`}
            onClick={() => setActiveTab('approvals')}
          >
            Approvals {!allApproved && <span className="tab-badge">{totalApprovals - approvedCount}</span>}
          </button>
        </div>

        {activeTab === 'wallet' ? (
          <div className="wallet-modal-content">
            {/* User Info */}
            <div className="wallet-user-info">
              <div className="wallet-avatar">
                {getWalletIconEmoji()}
              </div>
              <div className="wallet-user-details">
                <span className="wallet-user-name">{userName || 'Connected'}</span>
                <span className="wallet-login-method">via {getLoginMethodLabel()}</span>
              </div>
            </div>

            {/* EOA Wallet (where your funds currently are) */}
            <div className="wallet-address-section">
              <label>EOA Wallet (Your Privy Wallet)</label>
              <div className="wallet-address-row">
                <span className="wallet-address-text">
                  {address ? `${address.slice(0, 10)}...${address.slice(-8)}` : 'Not connected'}
                </span>
                <button className="btn-copy" onClick={() => address && copyAddress(address)}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* EOA Balances */}
            <div className="wallet-balances">
              <div className="balance-card">
                <div className="balance-token">
                  <span className="token-icon">💵</span>
                  <span className="token-name">USDC.e (EOA)</span>
                </div>
                <div className="balance-value">${formatBalance(eoaUsdceBalance)}</div>
              </div>
              <div className="balance-card">
                <div className="balance-token">
                  <span className="token-icon">💎</span>
                  <span className="token-name">POL (EOA)</span>
                </div>
                <div className="balance-value">{formatBalance(eoaMaticBalance, 4)}</div>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '16px 0' }} />

            {/* Safe Wallet (for trading) */}
            <div className="wallet-address-section">
              <label>Safe Wallet (Trading)</label>
              <div className="wallet-address-row">
                <span className="wallet-address-text">
                  {safeAddress ? `${safeAddress.slice(0, 10)}...${safeAddress.slice(-8)}` : 'Deriving...'}
                </span>
                <button className="btn-copy" onClick={() => safeAddress && copyAddress(safeAddress)}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div className="wallet-type-badge-large">
                {isSafeDeployed ? '✓ Safe Deployed' : 'Safe Not Deployed'}
              </div>
            </div>

            {/* Deploy Safe Button if not deployed */}
            {!isSafeDeployed && safeAddress && (
              <button
                className="btn-deploy-safe"
                onClick={deploySafe}
                disabled={isDeployingSafe}
              >
                {isDeployingSafe ? 'Deploying Safe...' : 'Deploy Safe (Gasless)'}
              </button>
            )}

            {/* Safe Balances */}
            <div className="wallet-balances">
              <div className="balance-card">
                <div className="balance-token">
                  <span className="token-icon">💵</span>
                  <span className="token-name">USDC.e (Safe)</span>
                </div>
                <div className="balance-value">${formatBalance(safeUsdceBalance)}</div>
              </div>
              <div className="balance-card">
                <div className="balance-token">
                  <span className="token-icon">💎</span>
                  <span className="token-name">POL (Safe)</span>
                </div>
                <div className="balance-value">{formatBalance(safeMaticBalance, 4)}</div>
              </div>
            </div>

            {/* Transfer Instructions */}
            {eoaUsdceBalance > 0 && safeUsdceBalance === 0 && (
              <div className="deposit-info" style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                <p className="deposit-text" style={{ color: 'var(--yellow)' }}>
                  Your USDC.e is in your EOA. Transfer it to your Safe to trade.
                </p>
              </div>
            )}

            {/* Deposit Info */}
            <div className="deposit-info">
              <p className="deposit-text">
                Send <strong>USDC.e</strong> to your Safe address on <strong>Polygon</strong> to trade:
              </p>
              <div className="deposit-address">
                {safeAddress || 'Loading...'}
              </div>
            </div>

            {/* Actions */}
            <div className="wallet-actions">
              <button className="btn-deposit" onClick={() => safeAddress && copyAddress(safeAddress)}>
                <span>📋</span>
                {copied ? 'Copied!' : 'Copy Safe Address'}
              </button>
              <button className="btn-refresh" onClick={() => { refreshSafeBalance(); refreshEoaBalance(); }}>
                <span>🔄</span>
                Refresh All
              </button>
            </div>

            {/* Disconnect */}
            <button className="btn-disconnect" onClick={disconnect}>
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <div className="wallet-modal-content">
            {/* Approvals Tab */}
            <div className="approvals-section">
              <div className="approvals-header">
                <h3>Contract Approvals</h3>
                <span className="approvals-count">
                  {approvedCount}/{totalApprovals} Approved
                </span>
              </div>

              <p className="approvals-description">
                These approvals allow Polymarket contracts to trade on your behalf.
                <br />
                <strong>All approvals are gasless!</strong>
              </p>

              {!isSafeDeployed && (
                <div className="approval-warning">
                  Safe must be deployed first. Click "Deploy Safe" in the Wallet tab.
                </div>
              )}

              <div className="approvals-list">
                {approvals.map((approval, idx) => (
                  <div key={idx} className={`approval-item ${approval.approved ? 'approved' : 'pending'}`}>
                    <span className="approval-status-icon">
                      {approval.approved ? '✓' : '○'}
                    </span>
                    <span className="approval-name">{approval.name}</span>
                    <span className="approval-type">{approval.type.toUpperCase()}</span>
                  </div>
                ))}
              </div>

              {isSafeDeployed && !allApproved && (
                <button
                  className="btn-approve-all"
                  onClick={approveAll}
                  disabled={isApproving}
                >
                  {isApproving ? 'Approving...' : `Approve All (Gasless)`}
                </button>
              )}

              {allApproved && (
                <div className="all-approved-message">
                  ✓ All approvals complete. You're ready to trade!
                </div>
              )}

              <button
                className="btn-refresh-approvals"
                onClick={checkApprovals}
                disabled={isCheckingApprovals || !isSafeDeployed}
              >
                {isCheckingApprovals ? 'Checking...' : 'Refresh Approvals'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
