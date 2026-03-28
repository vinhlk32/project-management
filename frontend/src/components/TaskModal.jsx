import React, { useState, useEffect } from 'react';
import CommentSection from './CommentSection';

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];
const DEP_LABELS = {
  FS: 'FS — Finish to Start',
  SS: 'SS — Start to Start',
  FF: 'FF — Finish to Finish',
  SF: 'SF — Start to Finish',
};

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical'];
const PRIORITY_COLORS = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };

const LABEL_PRESETS = [
  { name: 'Bug', color: '#ef4444' },
  { name: 'Feature', color: '#8b5cf6' },
  { name: 'Design', color: '#ec4899' },
  { name: 'Research', color: '#06b6d4' },
  { name: 'Blocked', color: '#f97316' },
  { name: 'Review', color: '#f59e0b' },
  { name: 'Testing', color: '#22c55e' },
  { name: 'Docs', color: '#6b7280' },
];

function labelColor(name) {
  const preset = LABEL_PRESETS.find(l => l.name.toLowerCase() === name.toLowerCase());
  if (preset) return preset.color;
  // Generate a stable color from the label name
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#4a9eff', '#8b5cf6', '#ec4899', '#06b6d4', '#22c55e', '#f97316', '#f59e0b'];
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({ name, color, size = 26 }) {
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

export default function TaskModal({ task, projectTasks, users = [], currentUser, onSave, onClose }) {
  const [activeTab, setActiveTab] = useState('details');
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState(task?.status || 'todo');
  const [priority, setPriority] = useState(task?.priority || 'medium');
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ? String(task.assignee_id) : '');
  const [labels, setLabels] = useState(task?.labels ? task.labels.split(',').filter(Boolean) : []);
  const [labelInput, setLabelInput] = useState('');
  const [startDate, setStartDate] = useState(task?.start_date || '');
  const [dueDate, setDueDate] = useState(task?.due_date || '');
  const [estimatedHours, setEstimatedHours] = useState(task?.estimated_hours || '');
  const [loggedHours, setLoggedHours] = useState(task?.logged_hours || '');

  const [deps, setDeps] = useState([]);
  const [newDep, setNewDep] = useState({ predecessor_id: '', type: 'FS', lag: 0 });
  const [depError, setDepError] = useState('');

  const isEditing = !!task;

  useEffect(() => {
    if (!task?.id) return;
    fetch(`/api/tasks/${task.id}/dependencies`)
      .then(r => r.json())
      .then(setDeps);
  }, [task?.id]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description,
      status,
      priority,
      assignee_id: assigneeId ? Number(assigneeId) : null,
      labels: labels.join(','),
      start_date: startDate || null,
      due_date: dueDate || null,
      estimated_hours: estimatedHours ? Number(estimatedHours) : 0,
      logged_hours: loggedHours ? Number(loggedHours) : 0,
    });
  };

  const addLabel = (name) => {
    const trimmed = name.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    setLabels(prev => [...prev, trimmed]);
    setLabelInput('');
  };

  const removeLabel = (name) => setLabels(prev => prev.filter(l => l !== name));

  const addDependency = async () => {
    setDepError('');
    if (!newDep.predecessor_id) return;
    const res = await fetch(`/api/tasks/${task.id}/dependencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        predecessor_id: Number(newDep.predecessor_id),
        type: newDep.type,
        lag: Number(newDep.lag) || 0,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      setDepError(err.error || 'Failed to add dependency');
      return;
    }
    const { dependency, affected } = await res.json();
    setDeps(prev => [...prev, dependency]);
    setNewDep({ predecessor_id: '', type: 'FS', lag: 0 });

    const affectedSelf = affected.find(t => t.id === task.id);
    if (affectedSelf) {
      setStartDate(affectedSelf.start_date || '');
      setDueDate(affectedSelf.due_date || '');
    }
    if (affected.length) onSave.__affectedUpdate?.(affected);
  };

  const removeDependency = async (depId) => {
    await fetch(`/api/dependencies/${depId}`, { method: 'DELETE' });
    setDeps(prev => prev.filter(d => d.id !== depId));
  };

  const existingPredIds = new Set(deps.map(d => d.predecessor_id));
  const eligible = (projectTasks || []).filter(
    t => t.id !== task?.id && !existingPredIds.has(t.id)
  );

  const assignee = users.find(u => String(u.id) === assigneeId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEditing ? 'Edit Task' : 'New Task'}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {isEditing && (
          <div className="modal-tabs">
            <button
              className={`modal-tab${activeTab === 'details' ? ' active' : ''}`}
              onClick={() => setActiveTab('details')}
            >Details</button>
            <button
              className={`modal-tab${activeTab === 'comments' ? ' active' : ''}`}
              onClick={() => setActiveTab('comments')}
            >Comments</button>
            <button
              className={`modal-tab${activeTab === 'deps' ? ' active' : ''}`}
              onClick={() => setActiveTab('deps')}
            >Dependencies</button>
          </div>
        )}

        {/* ── Details Tab ────────────────────────────────────────────── */}
        {activeTab === 'details' && (
          <form onSubmit={handleSubmit}>
            <label>Title *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Task title"
              required
            />

            <label>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
            />

            <div className="form-row">
              <div className="form-field">
                <label>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="todo">Todo</option>
                  <option value="in-progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div className="form-field">
                <label>Priority</label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  style={{ borderLeft: `4px solid ${PRIORITY_COLORS[priority]}` }}
                >
                  {PRIORITY_OPTIONS.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <label>Assignee</label>
            <div className="assignee-row">
              {assignee && <Avatar name={assignee.name} color={assignee.avatar_color} />}
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="assignee-select"
              >
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <label>Labels</label>
            <div className="labels-area">
              <div className="labels-row">
                {labels.map(l => (
                  <span key={l} className="label-chip" style={{ background: labelColor(l) + '22', color: labelColor(l), borderColor: labelColor(l) + '44' }}>
                    {l}
                    <button type="button" className="label-remove" onClick={() => removeLabel(l)}>&times;</button>
                  </span>
                ))}
              </div>
              <div className="label-presets">
                {LABEL_PRESETS.filter(p => !labels.includes(p.name)).map(p => (
                  <button
                    key={p.name}
                    type="button"
                    className="label-preset-chip"
                    style={{ background: p.color + '18', color: p.color, borderColor: p.color + '40' }}
                    onClick={() => addLabel(p.name)}
                  >+ {p.name}</button>
                ))}
              </div>
              <div className="label-custom-row">
                <input
                  type="text"
                  placeholder="Custom label…"
                  value={labelInput}
                  onChange={e => setLabelInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel(labelInput); } }}
                  className="label-input"
                />
                <button type="button" className="btn-secondary" onClick={() => addLabel(labelInput)}>Add</button>
              </div>
            </div>

            <div className="date-row">
              <div className="date-field">
                <label>Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="date-field">
                <label>Due Date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Estimated Hours</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimatedHours}
                  onChange={e => setEstimatedHours(e.target.value)}
                  placeholder="0"
                />
              </div>
              {isEditing && (
                <div className="form-field">
                  <label>Logged Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={loggedHours}
                    onChange={e => setLoggedHours(e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary">
                {isEditing ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        )}

        {/* ── Comments Tab ───────────────────────────────────────────── */}
        {activeTab === 'comments' && isEditing && (
          <CommentSection taskId={task.id} users={users} currentUser={currentUser} />
        )}

        {/* ── Dependencies Tab ───────────────────────────────────────── */}
        {activeTab === 'deps' && isEditing && (
          <div className="deps-section deps-tab">
            <div className="deps-title">Dependencies (predecessors)</div>

            {deps.length > 0 && (
              <ul className="deps-list">
                {deps.map(d => (
                  <li key={d.id} className="dep-item">
                    <span className="dep-type-badge">{d.type}</span>
                    <span className="dep-task-name">{d.predecessor_title}</span>
                    {d.lag !== 0 && (
                      <span className="dep-lag">{d.lag > 0 ? `+${d.lag}d` : `${d.lag}d`}</span>
                    )}
                    <button className="dep-remove" onClick={() => removeDependency(d.id)} title="Remove">&times;</button>
                  </li>
                ))}
              </ul>
            )}

            {deps.length === 0 && <div className="card-empty">No dependencies yet.</div>}

            {eligible.length > 0 && (
              <div className="dep-add-row" style={{ marginTop: 12 }}>
                <select
                  value={newDep.predecessor_id}
                  onChange={e => setNewDep(p => ({ ...p, predecessor_id: e.target.value }))}
                >
                  <option value="">Select task…</option>
                  {eligible.map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
                <select
                  value={newDep.type}
                  onChange={e => setNewDep(p => ({ ...p, type: e.target.value }))}
                  className="dep-type-select"
                >
                  {DEP_TYPES.map(t => (
                    <option key={t} value={t}>{DEP_LABELS[t]}</option>
                  ))}
                </select>
                <input
                  type="number"
                  className="lag-input"
                  value={newDep.lag}
                  onChange={e => setNewDep(p => ({ ...p, lag: e.target.value }))}
                  title="Lag in days"
                  placeholder="Lag"
                />
                <span className="lag-label">d lag</span>
                <button type="button" className="btn-primary dep-add-btn" onClick={addDependency}>
                  Add
                </button>
              </div>
            )}

            {depError && <div className="dep-error">{depError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
