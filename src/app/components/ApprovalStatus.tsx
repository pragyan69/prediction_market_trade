import { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';

export function ApprovalStatus() {
  const { approvals, isCheckingApprovals, isApproving, checkApprovals, approveAll, allApproved } = useWallet();
  const [isExpanded, setIsExpanded] = useState(false);

  const approvedCount = approvals.filter(a => a.approved).length;
  const totalCount = approvals.length;

  if (totalCount === 0) return null;

  return (
    <div className="approval-dropdown">
      <button
        className={`approval-trigger ${allApproved ? 'all-approved' : 'pending'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isCheckingApprovals ? (
          <span>Checking...</span>
        ) : allApproved ? (
          <span>✓ All Approved</span>
        ) : (
          <span>{approvedCount}/{totalCount} Approved</span>
        )}
      </button>

      {isExpanded && (
        <div className="approval-panel">
          <div className="approval-panel-header">
            <span>Contract Approvals</span>
            <button className="btn-refresh" onClick={checkApprovals} disabled={isCheckingApprovals}>
              ↻
            </button>
          </div>

          <div className="approval-grid">
            {approvals.map(approval => (
              <div
                key={approval.name}
                className={`approval-item ${approval.approved ? 'approved' : 'pending'}`}
              >
                <span className="approval-icon">{approval.approved ? '✓' : '○'}</span>
                <span className="approval-label">{approval.name}</span>
              </div>
            ))}
          </div>

          {!allApproved && (
            <button
              className="btn-approve-all"
              onClick={approveAll}
              disabled={isApproving}
            >
              {isApproving ? 'Approving...' : `Approve All (${totalCount - approvedCount} remaining)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
