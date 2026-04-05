import React, { useState, useEffect } from 'react';
import CommentSection from './CommentSection';
import { useAuth } from '../context/AuthContext';

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

function addDaysLocal(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
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

const STATUS_COLORS = { todo: '#6b7280', 'in-progress': '#f59e0b', done: '#22c55e' };

export default function TaskModal({
  task,
  projectTasks,
  users = [],
  currentUser: currentUserProp,
  onSave,
  onClose,
  onEditTask,
  onSubtaskCreated,
}) {
  const { authFetch, currentUser: authCurrentUser } = useAuth();
  const currentUser = currentUserProp || authCurrentUser;
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
  const [estimatedDays, setEstimatedDays]   = useState(task?.estimated_days  || '');
  const [loggedHours, setLoggedHours] = useState(task?.logged_hours || '');
  const [notes, setNotes] = useState(task?.notes || '');

  // Dependencies for existing task (fetched from API)
  const [deps, setDeps] = useState([]);
  const [newDep, setNewDep] = useState({ predecessor_id: '', type: 'FS', lag: 0 });
  const [depError, setDepError] = useState('');

  // Pending dependencies for new task creation (local only, sent on save)
  const [pendingDeps, setPendingDeps] = useState([]);
  const [pendingDep, setPendingDep] = useState({ predecessor_id: '', type: 'FS', lag: 0 });

  // Subtasks
  const [subtasks, setSubtasks] = useState([]);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskSaving, setSubtaskSaving] = useState(false);

  const isEditing = !!task;

  useEffect(() => {
    if (!task?.id) return;
    authFetch(`/api/tasks/${task.id}/dependencies`)
      .then(r => r.json())
      .then(setDeps);
  }, [task?.id]);

  useEffect(() => {
    if (!task?.id) return;
    authFetch(`/api/tasks/${task.id}/subtasks`)
      .then(r => r.json())
      .then(setSubtasks);
  }, [task?.id]);

  // Auto-calculate dates from FS predecessors + estimated_days (create mode)
  useEffect(() => {
    if (isEditing || !estimatedDays || Number(estimatedDays) <= 0) return;
    const fsDeps = pendingDeps.filter(d => d.type === 'FS');
    if (!fsDeps.length) return;
    let latestDue = null; let latestLag = 0;
    for (const dep of fsDeps) {
      const pred = (projectTasks || []).find(t => t.id === dep.predecessor_id);
      if (pred?.due_date && (!latestDue || pred.due_date > latestDue)) {
        latestDue = pred.due_date; latestLag = dep.lag || 0;
      }
    }
    if (!latestDue) return;
    const autoStart = addDaysLocal(latestDue, latestLag + 1);
    const autoDue   = addDaysLocal(autoStart, Number(estimatedDays) - 1);
    setStartDate(autoStart);
    setDueDate(autoDue);
  }, [pendingDeps, estimatedDays]);

  // Recalculate due_date when estimated_days or start_date changes (both modes)
  useEffect(() => {
    if (!estimatedDays || Number(estimatedDays) <= 0 || !startDate) return;
    setDueDate(addDaysLocal(startDate, Number(estimatedDays) - 1));
  }, [estimatedDays, startDate]);

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
      notes: notes.slice(0, 200),
      start_date: startDate || null,
      due_date: dueDate || null,
      estimated_hours: estimatedHours ? Number(estimatedHours) : 0,
      estimated_days:  estimatedDays  ? Number(estimatedDays)  : 0,
      logged_hours: loggedHours ? Number(loggedHours) : 0,
      // Only include dependencies on create
      ...(!isEditing && pendingDeps.length > 0 && {
        dependencies: pendingDeps.map(({ predecessor_id, type, lag }) => ({ predecessor_id, type, lag })),
      }),
    });
  };

  const addLabel = (name) => {
    const trimmed = name.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    setLabels(prev => [...prev, trimmed]);
    setLabelInput('');
  };

  const removeLabel = (name) => setLabels(prev => prev.filter(l => l !== name));

  // ── Existing-task dependency management ───────────────────────────────────
  const addDependency = async () => {
    setDepError('');
    if (!newDep.predecessor_id) return;
    const res = await authFetch(`/api/tasks/${task.id}/dependencies`, {
      method: 'POST',
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
    await authFetch(`/api/dependencies/${depId}`, { method: 'DELETE' });
    setDeps(prev => prev.filter(d => d.id !== depId));
  };

  // ── Pending dependency management (create mode) ────────────────────────────
  const addPendingDep = () => {
    if (!pendingDep.predecessor_id) return;
    const predId = Number(pendingDep.predecessor_id);
    if (pendingDeps.some(d => d.predecessor_id === predId)) return;
    const predTask = (projectTasks || []).find(t => t.id === predId);
    setPendingDeps(prev => [...prev, {
      predecessor_id: predId,
      type: pendingDep.type,
      lag: Number(pendingDep.lag) || 0,
      predecessor_title: predTask?.title || String(predId),
    }]);
    setPendingDep({ predecessor_id: '', type: 'FS', lag: 0 });
  };

  const removePendingDep = (predId) => {
    setPendingDeps(prev => prev.filter(d => d.predecessor_id !== predId));
  };

  // ── Subtask creation ───────────────────────────────────────────────────────
  const createSubtask = async () => {
    if (!subtaskTitle.trim() || !task?.id) return;
    setSubtaskSaving(true);
    const res = await authFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: task.project_id,
        title: subtaskTitle.trim(),
        status: 'todo',
        priority: 'medium',
        parent_id: task.id,
      }),
    });
    setSubtaskSaving(false);
    if (!res.ok) return;
    const newSubtask = await res.json();
    setSubtasks(prev => [...prev, newSubtask]);
    setSubtaskTitle('');
    onSubtaskCreated?.(newSubtask);
  };

  const deleteSubtask = async (subtaskId) => {
    const res = await authFetch(`/api/tasks/${subtaskId}`, { method: 'DELETE' });
    if (res.ok) setSubtasks(prev => prev.filter(s => s.id !== subtaskId));
  };

  const existingPredIds = new Set(deps.map(d => d.predecessor_id));
  const pendingPredIds = new Set(pendingDeps.map(d => d.predecessor_id));

  const eligibleForEdit = (projectTasks || []).filter(
    t => t.id !== task?.id && !existingPredIds.has(t.id)
  );
  const eligibleForCreate = (projectTasks || []).filter(
    t => !pendingPredIds.has(t.id)
  );

  const assignee = users.find(u => String(u.id) === assigneeId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {isEditing
              ? (task.parent_id ? 'Edit Subtask' : 'Edit Task')
              : 'New Task'}
          </h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {isEditing && (
          <div className="modal-tabs">
            <button
              className={`modal-tab${activeTab === 'details' ? ' active' : ''}`}
              onClick={() => setActiveTab('details')}
            >Details</button>
            <button
              className={`modal-tab${activeTab === 'subtasks' ? ' active' : ''}`}
              onClick={() => setActiveTab('subtasks')}
            >
              Subtasks
              {subtasks.length > 0 && (
                <span className="tab-count">{subtasks.length}</span>
              )}
            </button>
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
                <label>Duration (days)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={estimatedDays}
                  onChange={e => setEstimatedDays(e.target.value)}
                  placeholder="0"
                  title="Sets duration; auto-calculates Finish date from Start"
                />
              </div>
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

            <div className="form-field">
              <label>Notes <span className="label-hint">({notes.length}/200)</span></label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 200))}
                maxLength={200}
                placeholder="Short note…"
              />
            </div>

            {/* ── Dependencies section for new task creation ── */}
            {!isEditing && (
              <div className="create-deps-section">
                <label>Dependencies <span className="label-hint">(optional — tasks this must wait for)</span></label>

                {pendingDeps.length > 0 && (
                  <ul className="deps-list">
                    {pendingDeps.map(d => (
                      <li key={d.predecessor_id} className="dep-item">
                        <span className="dep-type-badge">{d.type}</span>
                        <span className="dep-task-name">{d.predecessor_title}</span>
                        {d.lag !== 0 && (
                          <span className="dep-lag">{d.lag > 0 ? `+${d.lag}d` : `${d.lag}d`}</span>
                        )}
                        <button type="button" className="dep-remove" onClick={() => removePendingDep(d.predecessor_id)}>&times;</button>
                      </li>
                    ))}
                  </ul>
                )}

                {eligibleForCreate.length > 0 && (
                  <div className="dep-add-row">
                    <select
                      value={pendingDep.predecessor_id}
                      onChange={e => setPendingDep(p => ({ ...p, predecessor_id: e.target.value }))}
                    >
                      <option value="">Select predecessor…</option>
                      {eligibleForCreate.map(t => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                    <select
                      value={pendingDep.type}
                      onChange={e => setPendingDep(p => ({ ...p, type: e.target.value }))}
                      className="dep-type-select"
                    >
                      {DEP_TYPES.map(t => (
                        <option key={t} value={t}>{DEP_LABELS[t]}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="lag-input"
                      value={pendingDep.lag}
                      onChange={e => setPendingDep(p => ({ ...p, lag: e.target.value }))}
                      title="Lag in days"
                      placeholder="Lag"
                    />
                    <span className="lag-label">d lag</span>
                    <button type="button" className="btn-secondary dep-add-btn" onClick={addPendingDep}>
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary">
                {isEditing ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        )}

        {/* ── Subtasks Tab ───────────────────────────────────────────── */}
        {activeTab === 'subtasks' && isEditing && (
          <div className="deps-section deps-tab">
            <div className="deps-title">Subtasks</div>

            {subtasks.length > 0 ? (
              <ul className="subtasks-list">
                {subtasks.map(s => {
                  const doneCount = subtasks.filter(x => x.status === 'done').length;
                  return (
                    <li key={s.id} className="subtask-item" onClick={() => onEditTask?.(s)}>
                      <span
                        className="subtask-status-dot"
                        style={{ background: STATUS_COLORS[s.status] || '#6b7280' }}
                        title={s.status}
                      />
                      <span className={`subtask-title${s.status === 'done' ? ' subtask-done' : ''}`}>
                        {s.title}
                      </span>
                      {s.assignee_name && (
                        <Avatar name={s.assignee_name} color={s.assignee_color} size={20} />
                      )}
                      <button
                        className="dep-remove"
                        onClick={e => { e.stopPropagation(); deleteSubtask(s.id); }}
                        title="Delete subtask"
                      >&times;</button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="card-empty">No subtasks yet.</div>
            )}

            {subtasks.length > 0 && (
              <div className="subtask-progress">
                <div className="subtask-progress-bar">
                  <div
                    className="subtask-progress-fill"
                    style={{ width: `${Math.round((subtasks.filter(s => s.status === 'done').length / subtasks.length) * 100)}%` }}
                  />
                </div>
                <span className="subtask-progress-label">
                  {subtasks.filter(s => s.status === 'done').length} / {subtasks.length} done
                </span>
              </div>
            )}

            <div className="dep-add-row" style={{ marginTop: 14 }}>
              <input
                type="text"
                placeholder="New subtask title…"
                value={subtaskTitle}
                onChange={e => setSubtaskTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createSubtask(); } }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-primary dep-add-btn"
                onClick={createSubtask}
                disabled={subtaskSaving || !subtaskTitle.trim()}
              >
                {subtaskSaving ? '…' : '+ Add'}
              </button>
            </div>
          </div>
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

            {eligibleForEdit.length > 0 && (
              <div className="dep-add-row" style={{ marginTop: 12 }}>
                <select
                  value={newDep.predecessor_id}
                  onChange={e => setNewDep(p => ({ ...p, predecessor_id: e.target.value }))}
                >
                  <option value="">Select task…</option>
                  {eligibleForEdit.map(t => (
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
