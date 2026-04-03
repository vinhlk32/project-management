import React from 'react';

const TYPE_CONFIG = {
  assignee_overlap: {
    icon: '👥',
    label: 'Assignee Overlap',
    color: '#f59e0b',
    bg: '#f59e0b18',
    border: '#f59e0b44',
  },
  dependency_violation: {
    icon: '🔗',
    label: 'Dependency Violated',
    color: '#ef4444',
    bg: '#ef444418',
    border: '#ef444444',
  },
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ConflictAlert({ conflicts, onClose, onGoToTask }) {
  const errors   = conflicts.filter(c => c.severity === 'error');
  const warnings = conflicts.filter(c => c.severity === 'warning');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal conflict-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="conflict-modal-title">
            <span className="conflict-modal-icon">⚠</span>
            {conflicts.length} Conflict{conflicts.length !== 1 ? 's' : ''} Detected
          </h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="conflict-summary-row">
          {errors.length > 0 && (
            <span className="conflict-summary-chip conflict-chip-error">
              {errors.length} error{errors.length !== 1 ? 's' : ''}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="conflict-summary-chip conflict-chip-warning">
              {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="conflict-summary-hint">
            Resolve conflicts to keep your schedule accurate.
          </span>
        </div>

        <ul className="conflict-list">
          {conflicts.map((c, i) => {
            const cfg = TYPE_CONFIG[c.type] || TYPE_CONFIG.dependency_violation;
            return (
              <li
                key={i}
                className="conflict-item"
                style={{ borderLeft: `3px solid ${cfg.color}`, background: cfg.bg }}
              >
                <div className="conflict-item-header">
                  <span className="conflict-type-badge" style={{ color: cfg.color, borderColor: cfg.border }}>
                    {cfg.icon} {cfg.label}
                  </span>
                </div>
                <p className="conflict-message">{c.message}</p>

                {c.type === 'assignee_overlap' && c.meta && (
                  <div className="conflict-meta">
                    <span className="conflict-meta-range">
                      {formatDate(c.meta.t1_start)} – {formatDate(c.meta.t1_due)}
                    </span>
                    <span className="conflict-meta-vs">overlaps</span>
                    <span className="conflict-meta-range">
                      {formatDate(c.meta.t2_start)} – {formatDate(c.meta.t2_due)}
                    </span>
                  </div>
                )}

                <div className="conflict-tasks-row">
                  {c.task_ids.map((id, j) => (
                    <button
                      key={id}
                      className="conflict-task-link"
                      onClick={() => { onGoToTask?.(id); onClose(); }}
                      title={`Open: ${c.task_titles[j]}`}
                    >
                      {c.task_titles[j]}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
