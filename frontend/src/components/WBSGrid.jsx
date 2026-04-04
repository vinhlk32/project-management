import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

const COLUMNS = [
  { key: 'wbs',            label: '#',            width: 60,  editable: false },
  { key: 'title',          label: 'Task Name',    width: 240, editable: true  },
  { key: 'estimated_days', label: 'Days',         width: 60,  editable: true  },
  { key: 'start_date',     label: 'Start',        width: 110, editable: true  },
  { key: 'due_date',       label: 'Finish',       width: 110, editable: true  },
  { key: 'predecessors',   label: 'Predecessors', width: 110, editable: false },
  { key: 'assignee_id',    label: 'Assignee',     width: 130, editable: true  },
  { key: 'status',         label: 'Status',       width: 110, editable: true  },
  { key: 'priority',       label: 'Priority',     width: 100, editable: true  },
];

const EDITABLE_KEYS = COLUMNS.filter(c => c.editable).map(c => c.key);

const STATUS_OPTIONS   = ['todo', 'in-progress', 'done'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical'];
const STATUS_COLORS    = { todo: '#6b7280', 'in-progress': '#f59e0b', done: '#22c55e' };
const PRIORITY_COLORS  = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };

function addDays(dateStr, n) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// Build flat list: top-level tasks with subtasks inserted after their parent,
// each row gets _depth (0 = top-level) and _wbs ("1", "1.1", "2", etc.)
function buildRows(allTasks) {
  const byParent = {};
  allTasks.forEach(t => {
    const key = t.parent_id ?? 'root';
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(t);
  });

  const result = [];
  function walk(parentKey, depth, parentWbs) {
    (byParent[parentKey] || []).forEach((task, idx) => {
      const wbs = parentWbs ? `${parentWbs}.${idx + 1}` : `${idx + 1}`;
      result.push({ ...task, _depth: depth, _wbs: wbs });
      walk(task.id, depth + 1, wbs);
    });
  }
  walk('root', 0, '');
  return result;
}

export default function WBSGrid({ project, tasks: allTasks, users = [], onTasksChange, onEditTask }) {
  const { authFetch } = useAuth();
  const [rows, setRows]               = useState([]);
  const [deps, setDeps]               = useState([]);
  const [editingCell, setEditingCell] = useState(null); // { rowIdx, col }
  const [saving, setSaving]           = useState(new Set());
  const inputRef    = useRef(null);
  const skipBlurRef = useRef(false); // prevent double-save when keyboard commit fires blur

  // Rebuild flat tree whenever allTasks changes
  useEffect(() => {
    setRows(buildRows(allTasks));
  }, [allTasks]);

  useEffect(() => {
    authFetch(`/api/projects/${project.id}/dependencies`)
      .then(r => r.ok ? r.json() : [])
      .then(setDeps)
      .catch(() => {});
  }, [project.id]);

  // Auto-focus input when editing cell changes
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select) inputRef.current.select();
    }
  }, [editingCell]);

  // Map task id → wbs string for predecessor display
  const wbsByTaskId = useMemo(() => {
    const map = {};
    rows.forEach(r => { map[r.id] = r._wbs; });
    return map;
  }, [rows]);

  const getPredecessorStr = useCallback((taskId) => {
    return deps
      .filter(d => d.successor_id === taskId)
      .map(d => {
        const wbs = wbsByTaskId[d.predecessor_id];
        if (!wbs) return null;
        const suffix = d.type && d.type !== 'FS' ? d.type : '';
        const lag    = d.lag ? (d.lag > 0 ? `+${d.lag}` : `${d.lag}`) : '';
        return `${wbs}${suffix}${lag}`;
      })
      .filter(Boolean)
      .join(', ');
  }, [deps, wbsByTaskId]);

  const applyAffected = useCallback((affected, baseRows) => {
    if (!affected?.length) return baseRows;
    return baseRows.map(r => {
      const a = affected.find(x => x.id === r.id);
      return a ? { ...r, ...a } : r;
    });
  }, []);

  // Core save: PUT task, then apply affected (successor date propagation)
  const saveField = useCallback(async (task, field, value) => {
    // Skip no-op saves
    if (task[field] === value) return;

    setSaving(prev => new Set(prev).add(task.id));

    const body = {
      title:           task.title,
      description:     task.description || '',
      status:          task.status,
      priority:        task.priority,
      assignee_id:     task.assignee_id || null,
      labels:          task.labels || '',
      start_date:      task.start_date || null,
      due_date:        task.due_date || null,
      estimated_hours: task.estimated_hours || 0,
      estimated_days:  task.estimated_days  || 0,
      logged_hours:    task.logged_hours || 0,
      [field]: value,
    };

    // Auto-compute due_date when days or start_date changes
    const days  = field === 'estimated_days' ? Number(value)    : (task.estimated_days || 0);
    const start = field === 'start_date'     ? (value || null)  : task.start_date;
    if (days > 0 && start) body.due_date = addDays(start, days - 1);

    try {
      const res = await authFetch(`/api/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!res.ok) return;
      const { task: updated, affected } = await res.json();

      // Update rows (preserves _depth / _wbs metadata) + propagate affected successors
      setRows(prev => {
        const next = prev.map(r => r.id === updated.id ? { ...r, ...updated } : r);
        return applyAffected(affected, next);
      });

      // Propagate up to TaskList so other views stay in sync
      onTasksChange?.(prev => {
        const next = prev.map(t => t.id === updated.id ? { ...t, ...updated } : t);
        if (!affected?.length) return next;
        return next.map(t => {
          const a = affected.find(x => x.id === t.id);
          return a ? { ...t, ...a } : t;
        });
      });
    } finally {
      setSaving(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }, [authFetch, applyAffected, onTasksChange]);

  // Blur handler — skipped when keyboard (Enter/Tab/Esc) already handled the commit
  const handleBlur = useCallback((task, col, value) => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    setEditingCell(null);
    saveField(task, col, value);
  }, [saveField]);

  const createRow = useCallback(async (afterIdx, parentId = null) => {
    const res = await authFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: project.id,
        title: 'New Task',
        status: 'todo',
        priority: 'medium',
        parent_id: parentId,
      }),
    });
    if (!res.ok) return;
    const newTask = await res.json();
    // Let allTasks update via onTasksChange → useEffect will rebuild rows
    onTasksChange?.(prev => [...prev, newTask]);
    setEditingCell({ rowIdx: afterIdx + 1, col: 'title' });
  }, [authFetch, project.id, onTasksChange]);

  const deleteRow = useCallback(async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    const res = await authFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (res.ok) {
      // Remove task and any of its subtasks from parent state
      onTasksChange?.(prev => prev.filter(t => t.id !== task.id && t.parent_id !== task.id));
    }
  }, [authFetch, onTasksChange]);

  const moveCell = useCallback((rowIdx, col, direction) => {
    const colIdx = EDITABLE_KEYS.indexOf(col);
    if (direction === 'next') {
      if (colIdx < EDITABLE_KEYS.length - 1) setEditingCell({ rowIdx, col: EDITABLE_KEYS[colIdx + 1] });
      else if (rowIdx < rows.length - 1)     setEditingCell({ rowIdx: rowIdx + 1, col: EDITABLE_KEYS[0] });
      else                                   setEditingCell(null);
    } else {
      if (colIdx > 0)      setEditingCell({ rowIdx, col: EDITABLE_KEYS[colIdx - 1] });
      else if (rowIdx > 0) setEditingCell({ rowIdx: rowIdx - 1, col: EDITABLE_KEYS[EDITABLE_KEYS.length - 1] });
    }
  }, [rows.length]);

  const handleKeyDown = useCallback((e, rowIdx, col, task, getValue) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      skipBlurRef.current = true;
      saveField(task, col, getValue());
      if (rowIdx < rows.length - 1) setEditingCell({ rowIdx: rowIdx + 1, col });
      else { setEditingCell(null); createRow(rowIdx); }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      skipBlurRef.current = true;
      saveField(task, col, getValue());
      moveCell(rowIdx, col, e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Escape') {
      skipBlurRef.current = true;
      setEditingCell(null);
    }
  }, [rows.length, saveField, createRow, moveCell]);

  const renderCell = (task, rowIdx, col) => {
    const isEdit = editingCell?.rowIdx === rowIdx && editingCell?.col === col;
    const colDef = COLUMNS.find(c => c.key === col);
    const w      = colDef.width;

    /* ── WBS number ── */
    if (col === 'wbs') return (
      <td key={col} className="wbs-grid-cell wbs-cell-wbs" style={{ width: w }}>
        {task._wbs}
      </td>
    );

    /* ── Predecessors (read-only) ── */
    if (col === 'predecessors') return (
      <td key={col} className="wbs-grid-cell wbs-cell-text" style={{ width: w }}>
        <span className="wbs-cell-val">{getPredecessorStr(task.id) || <span className="wbs-empty">—</span>}</span>
      </td>
    );

    /* ── Assignee select ── */
    if (col === 'assignee_id') {
      if (isEdit) return (
        <td key={col} className="wbs-grid-cell editing" style={{ width: w }}>
          <select
            ref={inputRef}
            className="wbs-cell-select"
            defaultValue={task.assignee_id || ''}
            onChange={e => {
              skipBlurRef.current = true;
              saveField(task, 'assignee_id', e.target.value ? Number(e.target.value) : null);
              setEditingCell(null);
            }}
            onBlur={() => { skipBlurRef.current = false; setEditingCell(null); }}
          >
            <option value="">— Unassigned —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </td>
      );
      return (
        <td key={col} className="wbs-grid-cell wbs-cell-text" style={{ width: w }}
          onClick={() => setEditingCell({ rowIdx, col })}>
          <span className="wbs-cell-val">{task.assignee_name || <span className="wbs-empty">—</span>}</span>
        </td>
      );
    }

    /* ── Status select ── */
    if (col === 'status') {
      if (isEdit) return (
        <td key={col} className="wbs-grid-cell editing" style={{ width: w }}>
          <select
            ref={inputRef}
            className="wbs-cell-select"
            defaultValue={task.status}
            onChange={e => {
              skipBlurRef.current = true;
              saveField(task, 'status', e.target.value);
              setEditingCell(null);
            }}
            onBlur={() => { skipBlurRef.current = false; setEditingCell(null); }}
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
      );
      return (
        <td key={col} className="wbs-grid-cell" style={{ width: w }}
          onClick={() => setEditingCell({ rowIdx, col })}>
          <span className="wbs-status-chip" style={{ background: STATUS_COLORS[task.status] + '22', color: STATUS_COLORS[task.status] }}>
            {task.status}
          </span>
        </td>
      );
    }

    /* ── Priority select ── */
    if (col === 'priority') {
      if (isEdit) return (
        <td key={col} className="wbs-grid-cell editing" style={{ width: w }}>
          <select
            ref={inputRef}
            className="wbs-cell-select"
            defaultValue={task.priority}
            onChange={e => {
              skipBlurRef.current = true;
              saveField(task, 'priority', e.target.value);
              setEditingCell(null);
            }}
            onBlur={() => { skipBlurRef.current = false; setEditingCell(null); }}
          >
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </td>
      );
      return (
        <td key={col} className="wbs-grid-cell" style={{ width: w }}
          onClick={() => setEditingCell({ rowIdx, col })}>
          <span className="wbs-priority-chip" style={{ color: PRIORITY_COLORS[task.priority] }}>
            {task.priority}
          </span>
        </td>
      );
    }

    /* ── Date inputs ── */
    if (col === 'start_date' || col === 'due_date') {
      if (isEdit) return (
        <td key={col} className="wbs-grid-cell editing" style={{ width: w }}>
          <input
            ref={inputRef}
            type="date"
            className="wbs-cell-input wbs-date-input-cell"
            defaultValue={task[col] || ''}
            onKeyDown={e => handleKeyDown(e, rowIdx, col, task, () => e.target.value || null)}
            onBlur={e    => handleBlur(task, col, e.target.value || null)}
          />
        </td>
      );
      return (
        <td key={col} className="wbs-grid-cell wbs-cell-text" style={{ width: w }}
          onClick={() => setEditingCell({ rowIdx, col })}>
          <span className={`wbs-cell-val${!task[col] ? ' wbs-empty' : ''}`}>{task[col] || '—'}</span>
        </td>
      );
    }

    /* ── Estimated days ── */
    if (col === 'estimated_days') {
      if (isEdit) return (
        <td key={col} className="wbs-grid-cell editing" style={{ width: w }}>
          <input
            ref={inputRef}
            type="number"
            min="0"
            step="1"
            className="wbs-cell-input wbs-num-input"
            defaultValue={task.estimated_days || ''}
            onKeyDown={e => handleKeyDown(e, rowIdx, col, task, () => Number(e.target.value) || 0)}
            onBlur={e    => handleBlur(task, col, Number(e.target.value) || 0)}
          />
        </td>
      );
      return (
        <td key={col} className="wbs-grid-cell wbs-cell-text" style={{ width: w }}
          onClick={() => setEditingCell({ rowIdx, col })}>
          <span className={`wbs-cell-val${!task.estimated_days ? ' wbs-empty' : ''}`}>
            {task.estimated_days || '—'}
          </span>
        </td>
      );
    }

    /* ── Title — with subtask indent ── */
    const indent = task._depth * 20;
    if (isEdit) return (
      <td key={col} className="wbs-grid-cell editing" style={{ width: w }}>
        <input
          ref={inputRef}
          className="wbs-cell-input"
          style={{ paddingLeft: `${8 + indent}px` }}
          defaultValue={task[col] || ''}
          onKeyDown={e => handleKeyDown(e, rowIdx, col, task, () => e.target.value)}
          onBlur={e    => handleBlur(task, col, e.target.value)}
        />
      </td>
    );
    return (
      <td
        key={col}
        className={`wbs-grid-cell wbs-cell-text${saving.has(task.id) ? ' saving' : ''}`}
        style={{ width: w }}
        onClick={() => setEditingCell({ rowIdx, col })}
      >
        <span className="wbs-task-name-val" style={{ paddingLeft: `${indent}px` }} title={task[col]}>
          {task._depth > 0 && <span className="wbs-subtask-arrow">↳ </span>}
          {task[col] || <span className="wbs-empty">—</span>}
        </span>
      </td>
    );
  };

  return (
    <div className="wbs-grid-wrap">
      <div className="wbs-grid-toolbar">
        <span className="wbs-grid-hint">
          Click cell to edit · <kbd>Enter</kbd> save &amp; next row · <kbd>Tab</kbd> next cell · <kbd>Esc</kbd> cancel · <kbd>Double-click</kbd> open detail
        </span>
        <button className="btn-primary wbs-add-btn" onClick={() => createRow(rows.length - 1, null)}>
          + Add Task
        </button>
      </div>

      <div className="wbs-grid-scroll">
        <table className="wbs-grid-table">
          <thead>
            <tr className="wbs-grid-head-row">
              {COLUMNS.map(c => (
                <th key={c.key} className="wbs-grid-th" style={{ width: c.width, minWidth: c.width }}>{c.label}</th>
              ))}
              <th className="wbs-grid-th wbs-grid-th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task, rowIdx) => (
              <tr
                key={task.id}
                className={[
                  'wbs-grid-row',
                  task._depth > 0 ? 'wbs-subtask-row' : '',
                  rowIdx % 2 ? 'alt' : '',
                  saving.has(task.id) ? 'saving' : '',
                ].filter(Boolean).join(' ')}
                onDoubleClick={() => onEditTask(task)}
              >
                {COLUMNS.map(c => renderCell(task, rowIdx, c.key))}
                <td className="wbs-grid-cell wbs-cell-actions">
                  <button className="wbs-action-btn" onClick={e => { e.stopPropagation(); onEditTask(task); }} title="Open full detail">⊞</button>
                  <button className="wbs-action-btn wbs-action-add"
                    onClick={e => { e.stopPropagation(); createRow(rowIdx, task._depth > 0 ? task.parent_id : null); }}
                    title="Insert row below">+</button>
                  <button className="wbs-action-btn wbs-action-del"
                    onClick={e => { e.stopPropagation(); deleteRow(task); }}
                    title="Delete row">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="wbs-grid-empty">
                  No tasks yet.{' '}
                  <button className="wbs-link-btn" onClick={() => createRow(-1, null)}>Add the first task</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
