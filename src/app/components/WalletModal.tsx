import { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { ApprovalStatus } from './ApprovalStatus';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const {
    address,
    userName,
    userEmail,
    walletType,
    walletIcon,
    loginMethod,
    usdcBalance,
    maticBalance,
    refreshBalance,
    disconnect,
    openFundWallet,
    approvals,
    isCheckingApprovals,
    isApproving,
    checkApprovals,
    approveAll,
    allApproved,
  } = useWallet();

  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'wallet' | 'approvals'>('wallet');

  if (!isOpen) return null;

  const copyAddress = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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

            {/* Address */}
            <div className="wallet-address-section">
              <label>Wallet Address</label>
              <div className="wallet-address-row">
                <span className="wallet-address-text">{address}</span>
                <button className="btn-copy" onClick={copyAddress}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div className="wallet-type-badge-large">
                {walletType === 'embedded' ? 'Privy Embedded Wallet' : 'External Wallet'}
              </div>
            </div>

            {/* Balances */}
            <div className="wallet-balances">
              <div className="balance-card">
                <div className="balance-token">
                  <span className="token-icon">💵</span>
                  <span className="token-name">USDC</span>
                </div>
                <div className="balance-value">${formatBalance(usdcBalance)}</div>
              </div>
              <div className="balance-card">
                <div className="balance-token">
                  <span className="token-icon">💎</span>
                  <span className="token-name">MATIC</span>
                </div>
                <div className="balance-value">{formatBalance(maticBalance, 4)}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="wallet-actions">
              <button className="btn-deposit" onClick={openFundWallet}>
                <span>💰</span>
                Deposit
              </button>
              <button className="btn-refresh" onClick={refreshBalance}>
                <span>🔄</span>
                Refresh
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
                You need all 7 approvals to place orders.
              </p>

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

              {!allApproved && (
                <button
                  className="btn-approve-all"
                  onClick={approveAll}
                  disabled={isApproving}
                >
                  {isApproving ? 'Approving...' : `Approve All (${totalApprovals - approvedCount} remaining)`}
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
                disabled={isCheckingApprovals}
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
