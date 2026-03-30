import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const PRIORITY_COLORS = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const STATUS_COLORS = {
  todo: '#94a3b8',
  'in-progress': '#4a9eff',
  done: '#22c55e',
};

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress-bar-wrap">
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="progress-bar-pct">{pct}%</span>
    </div>
  );
}

function Avatar({ name, color, size = 28 }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  return (
    <div
      className="avatar"
      style={{ background: color || '#4a9eff', width: size, height: size, fontSize: size * 0.38 }}
      title={name}
    >
      {initials}
    </div>
  );
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard({ project, users }) {
  const { authFetch } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    authFetch(`/api/projects/${project.id}/analytics`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { setAnalytics(data); setLoading(false); })
      .catch(err => { console.error('Failed to load analytics:', err); setLoading(false); });
  }, [project?.id]);

  if (!project) {
    return <div className="empty-state">Select a project to view its dashboard.</div>;
  }

  if (loading) {
    return <div className="empty-state">Loading analytics…</div>;
  }

  if (!analytics) {
    return <div className="empty-state">Failed to load analytics. Please try again.</div>;
  }

  const { taskStats, priorityStats, assigneeStats, overdueCount, recentActivity } = analytics;

  const totalTasks = taskStats.reduce((s, r) => s + Number(r.count), 0);
  const doneTasks = taskStats.find(r => r.status === 'done')?.count ?? 0;
  const inProgressTasks = taskStats.find(r => r.status === 'in-progress')?.count ?? 0;
  const todoTasks = taskStats.find(r => r.status === 'todo')?.count ?? 0;
  const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const criticalTasks = priorityStats.find(r => r.priority === 'critical')?.count ?? 0;
  const highTasks = priorityStats.find(r => r.priority === 'high')?.count ?? 0;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">{project.name}</h2>
          {project.description && <p className="dashboard-desc">{project.description}</p>}
        </div>
      </div>

      {/* Summary stats */}
      <div className="stat-grid">
        <StatCard label="Total Tasks" value={totalTasks} color="#4a9eff" />
        <StatCard label="Completed" value={doneTasks} sub={`${completionRate}% done`} color="#22c55e" />
        <StatCard label="In Progress" value={inProgressTasks} color="#f59e0b" />
        <StatCard label="Overdue" value={overdueCount} color="#ef4444" />
        <StatCard label="Critical / High" value={`${criticalTasks} / ${highTasks}`} color="#f97316" />
        <StatCard label="Team Members" value={users.length} color="#8b5cf6" />
      </div>

      <div className="dashboard-grid">
        {/* Completion progress */}
        <div className="dashboard-card">
          <div className="card-title">Project Progress</div>
          <div className="progress-section">
            <ProgressBar value={Number(doneTasks)} max={totalTasks} color="#22c55e" />
            <div className="progress-legend">
              {[
                { label: 'Todo', count: todoTasks, color: STATUS_COLORS.todo },
                { label: 'In Progress', count: inProgressTasks, color: STATUS_COLORS['in-progress'] },
                { label: 'Done', count: doneTasks, color: STATUS_COLORS.done },
              ].map(({ label, count, color }) => (
                <div key={label} className="legend-row">
                  <span className="legend-dot" style={{ background: color }} />
                  <span className="legend-text">{label}</span>
                  <span className="legend-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Priority breakdown */}
        <div className="dashboard-card">
          <div className="card-title">By Priority</div>
          <div className="priority-bars">
            {['critical', 'high', 'medium', 'low'].map(p => {
              const count = Number(priorityStats.find(r => r.priority === p)?.count ?? 0);
              return (
                <div key={p} className="priority-bar-row">
                  <span className="priority-label-text" style={{ color: PRIORITY_COLORS[p] }}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </span>
                  <div className="priority-bar-track">
                    <div
                      className="priority-bar-fill"
                      style={{ width: totalTasks > 0 ? `${(count / totalTasks) * 100}%` : '0%', background: PRIORITY_COLORS[p] }}
                    />
                  </div>
                  <span className="priority-bar-count">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team workload */}
        <div className="dashboard-card">
          <div className="card-title">Team Workload</div>
          {assigneeStats.filter(a => Number(a.total) > 0).length === 0 ? (
            <div className="card-empty">No tasks assigned yet</div>
          ) : (
            <div className="workload-list">
              {assigneeStats.filter(a => Number(a.total) > 0).map(a => (
                <div key={a.id} className="workload-row">
                  <Avatar name={a.name} color={a.avatar_color} />
                  <div className="workload-info">
                    <div className="workload-name">{a.name}</div>
                    <ProgressBar value={Number(a.done)} max={Number(a.total)} color="#22c55e" />
                  </div>
                  <div className="workload-counts">
                    <span className="wc wc-todo">{Number(a.total) - Number(a.done) - Number(a.in_progress)}</span>
                    <span className="wc wc-prog">{a.in_progress}</span>
                    <span className="wc wc-done">{a.done}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="dashboard-card">
          <div className="card-title">Recent Activity</div>
          {recentActivity.length === 0 ? (
            <div className="card-empty">No comments yet</div>
          ) : (
            <div className="activity-list">
              {recentActivity.map(c => (
                <div key={c.id} className="activity-item">
                  <Avatar name={c.user_name || c.author_name} color={c.user_color} size={26} />
                  <div className="activity-body">
                    <div className="activity-meta">
                      <span className="activity-author">{c.user_name || c.author_name}</span>
                      <span className="activity-on"> on </span>
                      <span className="activity-task">{c.task_title}</span>
                    </div>
                    <div className="activity-content">{c.content}</div>
                    <div className="activity-time">{formatTime(c.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
