import React, { useState, useEffect } from 'react';

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];
const DEP_LABELS = {
  FS: 'FS — Finish to Start',
  SS: 'SS — Start to Start',
  FF: 'FF — Finish to Finish',
  SF: 'SF — Start to Finish',
};

export default function TaskModal({ task, projectTasks, onSave, onClose }) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState(task?.status || 'todo');
  const [startDate, setStartDate] = useState(task?.start_date || '');
  const [dueDate, setDueDate] = useState(task?.due_date || '');

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
      start_date: startDate || null,
      due_date: dueDate || null,
    });
  };

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

    // Refresh own dates if they were affected by the new dependency
    const affectedSelf = affected.find(t => t.id === task.id);
    if (affectedSelf) {
      setStartDate(affectedSelf.start_date || '');
      setDueDate(affectedSelf.due_date || '');
    }
    // Notify parent of other affected tasks
    if (affected.length) onSave.__affectedUpdate?.(affected);
  };

  const removeDependency = async (depId) => {
    await fetch(`/api/dependencies/${depId}`, { method: 'DELETE' });
    setDeps(prev => prev.filter(d => d.id !== depId));
  };

  // Tasks eligible as predecessors: same project, not self, not already a predecessor
  const existingPredIds = new Set(deps.map(d => d.predecessor_id));
  const eligible = (projectTasks || []).filter(
    t => t.id !== task?.id && !existingPredIds.has(t.id)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEditing ? 'Edit Task' : 'New Task'}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

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

          <label>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="todo">Todo</option>
            <option value="in-progress">In Progress</option>
            <option value="done">Done</option>
          </select>

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

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">
              {isEditing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>

        {isEditing && (
          <div className="deps-section">
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

            {eligible.length > 0 && (
              <div className="dep-add-row">
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
