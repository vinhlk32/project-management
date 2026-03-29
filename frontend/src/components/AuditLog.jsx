import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const ACTION_BADGE_COLORS = {
  login_success:    { bg: '#d1fae5', color: '#065f46' },
  login_failed:     { bg: '#fee2e2', color: '#991b1b' },
  logout:           { bg: '#f1f5f9', color: '#475569' },
  project_created:  { bg: '#dbeafe', color: '#1d4ed8' },
  project_updated:  { bg: '#fef3c7', color: '#d97706' },
  project_deleted:  { bg: '#fee2e2', color: '#991b1b' },
  task_created:     { bg: '#dbeafe', color: '#1d4ed8' },
  task_updated:     { bg: '#fef3c7', color: '#d97706' },
  task_deleted:     { bg: '#fee2e2', color: '#991b1b' },
  user_created:     { bg: '#dbeafe', color: '#1d4ed8' },
  user_updated:     { bg: '#fef3c7', color: '#d97706' },
  user_deleted:     { bg: '#fee2e2', color: '#991b1b' },
  password_changed: { bg: '#ede9fe', color: '#7c3aed' },
};

const ALL_ACTIONS = Object.keys(ACTION_BADGE_COLORS);

function ActionBadge({ action }) {
  const style = ACTION_BADGE_COLORS[action] || { bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{
      background: style.bg,
      color: style.color,
      fontSize: 11,
      fontWeight: 700,
      borderRadius: 4,
      padding: '2px 8px',
      letterSpacing: '0.03em',
      whiteSpace: 'nowrap',
    }}>
      {action}
    </span>
  );
}

function formatDateTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const PAGE_SIZE = 50;

export default function AuditLog() {
  const { authFetch } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const fetchLogs = useCallback(async (pageNum = 0) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', PAGE_SIZE);
      params.set('offset', pageNum * PAGE_SIZE);
      if (filterAction) params.set('action', filterAction);
      if (filterUserId) params.set('userId', filterUserId);
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo + 'T23:59:59');

      const res = await authFetch(`/api/audit-logs?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to load audit logs');
        return;
      }
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [authFetch, filterAction, filterUserId, filterFrom, filterTo]);

  // Initial load and auto-refresh every 30s
  useEffect(() => {
    fetchLogs(page);
    const interval = setInterval(() => fetchLogs(page), 30000);
    return () => clearInterval(interval);
  }, [fetchLogs, page]);

  const applyFilters = (e) => {
    e.preventDefault();
    setPage(0);
    fetchLogs(0);
  };

  const clearFilters = () => {
    setFilterAction('');
    setFilterUserId('');
    setFilterFrom('');
    setFilterTo('');
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="audit-log">
      <div className="ua-header">
        <div>
          <h2 className="ua-title">Audit Log</h2>
          <p className="ua-subtitle">{total} total event{total !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-secondary" onClick={() => fetchLogs(page)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Filter bar */}
      <form className="audit-filters" onSubmit={applyFilters}>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="filter-select"
        >
          <option value="">All Actions</option>
          {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <input
          className="search-input"
          type="number"
          placeholder="User ID"
          value={filterUserId}
          onChange={e => setFilterUserId(e.target.value)}
          style={{ width: 100 }}
        />

        <input
          type="date"
          className="search-input"
          value={filterFrom}
          onChange={e => setFilterFrom(e.target.value)}
          style={{ width: 150 }}
          title="From date"
        />
        <span style={{ color: '#8892a4', fontSize: 13 }}>to</span>
        <input
          type="date"
          className="search-input"
          value={filterTo}
          onChange={e => setFilterTo(e.target.value)}
          style={{ width: 150 }}
          title="To date"
        />

        <button type="submit" className="btn-primary" style={{ padding: '6px 16px' }}>Apply</button>
        {(filterAction || filterUserId || filterFrom || filterTo) && (
          <button type="button" className="btn-secondary" onClick={clearFilters}>Clear</button>
        )}
      </form>

      {error && <div className="ua-error">{error}</div>}

      <div className="ua-table-wrap">
        <table className="ua-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>IP Address</th>
              <th>User Agent</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: '#8892a4', padding: 32 }}>
                  No audit log entries found.
                </td>
              </tr>
            )}
            {logs.map(log => (
              <tr key={log.id} className="ua-row">
                <td className="ua-date" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</td>
                <td>
                  <span style={{ fontSize: 13 }}>
                    {log.user_name || (log.user_id ? `User #${log.user_id}` : <span style={{ color: '#8892a4' }}>—</span>)}
                  </span>
                </td>
                <td><ActionBadge action={log.action} /></td>
                <td style={{ fontSize: 12, color: '#6b7a8d' }}>
                  {log.entity_type && log.entity_id
                    ? `${log.entity_type} #${log.entity_id}`
                    : <span style={{ color: '#8892a4' }}>—</span>}
                </td>
                <td style={{ fontSize: 12, fontFamily: 'monospace', color: '#8892a4' }}>
                  {log.ip_address || '—'}
                </td>
                <td style={{ fontSize: 11, color: '#8892a4', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.user_agent || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="audit-pagination">
          <button
            className="btn-secondary"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </button>
          <span style={{ fontSize: 13, color: '#8892a4' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="btn-secondary"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
