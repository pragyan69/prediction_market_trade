import { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { WalletModal } from './WalletModal';

interface HeaderProps {
  currentView: 'markets' | 'portfolio' | 'orders';
  onViewChange: (view: 'markets' | 'portfolio' | 'orders') => void;
}

export function Header({ currentView, onViewChange }: HeaderProps) {
  const {
    isConnected,
    isInitializing,
    address,
    usdcBalance,
    connect,
    walletIcon,
    userName,
    walletType,
    allApproved,
    approvals,
  } = useWallet();
  const { isConnected: wsConnected } = useWebSocket();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const approvedCount = approvals.filter(a => a.approved).length;
  const totalApprovals = approvals.length;

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

  const getDisplayName = () => {
    if (isInitializing) return 'Connecting...';
    if (userName) return userName.length > 20 ? userName.slice(0, 20) + '...' : userName;
    if (address) return `${address.slice(0, 6)}...${address.slice(-4)}`;
    return 'Connected';
  };

  const formatBalance = (balance: number) => {
    if (balance >= 1000000) return `$${(balance / 1000000).toFixed(2)}M`;
    if (balance >= 1000) return `$${(balance / 1000).toFixed(2)}K`;
    return `$${balance.toFixed(2)}`;
  };

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">Polymarket</span>
        </div>
        <nav className="nav">
          <a
            href="#markets"
            className={`nav-link ${currentView === 'markets' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); onViewChange('markets'); }}
          >
            Markets
          </a>
          <a
            href="#portfolio"
            className={`nav-link ${currentView === 'portfolio' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); onViewChange('portfolio'); }}
          >
            Portfolio
          </a>
          <a
            href="#orders"
            className={`nav-link ${currentView === 'orders' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); onViewChange('orders'); }}
          >
            Orders
          </a>
        </nav>
      </div>

      <div className="header-right">
        <div className="connection-status">
          <span className={`ws-indicator ${wsConnected ? 'connected' : 'disconnected'}`}></span>
          <span>{wsConnected ? 'Live' : 'Disconnected'}</span>
        </div>

        {isConnected && (
          <>
            <div className="balance-display">
              <span className="balance-amount">{formatBalance(usdcBalance)}</span>
              <span className="balance-label">USDC</span>
            </div>

            {/* Wallet Info Card */}
            <div className="wallet-info">
              <div className="wallet-type-badge">
                {walletType === 'embedded' ? 'Privy Wallet' : 'External Wallet'}
              </div>
              {address && (
                <div className="wallet-address">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </div>
              )}
            </div>
          </>
        )}

        {isConnected ? (
          <div className="wallet-connected">
            <button className="btn-connect connected" onClick={() => setIsWalletModalOpen(true)}>
              <span className="btn-icon">{getWalletIconEmoji()}</span>
              <span className="btn-text">{getDisplayName()}</span>
              {!allApproved && totalApprovals > 0 && (
                <span className="approval-badge">{totalApprovals - approvedCount}</span>
              )}
            </button>
          </div>
        ) : (
          <button className="btn-connect" onClick={connect} disabled={isInitializing}>
            <span className="btn-icon">⬡</span>
            <span className="btn-text">{isInitializing ? 'Connecting...' : 'Connect Wallet'}</span>
          </button>
        )}
      </div>

      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />
    </header>
  );
}
