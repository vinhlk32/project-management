import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

const COLUMN_DEFS = [
  { key: 'wbs',            label: '#',            width: 60,  editable: false },
  { key: 'title',          label: 'Task Name',    width: 220, editable: true  },
  { key: 'estimated_days', label: 'Days',         width: 60,  editable: true  },
  { key: 'start_date',     label: 'Start',        width: 110, editable: true  },
  { key: 'due_date',       label: 'Finish',       width: 110, editable: true  },
  { key: 'predecessors',   label: 'Predecessors', width: 110, editable: true  },
  { key: 'assignee_id',    label: 'Assignee',     width: 130, editable: true  },
  { key: 'status',         label: 'Status',       width: 110, editable: true  },
  { key: 'notes',          label: 'Notes',        width: 180, editable: true  },
];

const STATUS_OPTIONS = ['todo', 'in-progress', 'done'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(dateStr, n) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

function daysBetween(a, b) {
  if (!a || !b) return '';
  const n = Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000) + 1;
  return n > 0 ? String(n) : '';
}

function todayStr() { return localDateStr(new Date()); }

// Apply formula logic when one schedule field changes, return updated patch.
function applyScheduleFormula(current, field, value) {
  let days  = field === 'estimated_days' ? value : (current.estimated_days ?? '');
  let start = field === 'start_date'     ? value : (current.start_date     ?? '');
  let due   = field === 'due_date'       ? value : (current.due_date       ?? '');

  const daysNum = Number(days) || 0;

  if (field === 'estimated_days') {
    if (daysNum > 0) {
      if (!start) start = todayStr();
      due = addDays(start, daysNum - 1);
    }
  } else if (field === 'start_date') {
    if (daysNum > 0 && start) {
      due = addDays(start, daysNum - 1);
    } else if (start && due) {
      if (due < start) { due = start; days = '1'; }
      else days = daysBetween(start, due);
    }
  } else if (field === 'due_date') {
    if (due && start) {
      if (due < start) return { error: 'Finish date cannot be before start date' };
      days = daysBetween(start, due);
    }
  }

  return { estimated_days: days, start_date: start, due_date: due, error: null };
}

// Parse "3FS, 5FF+2, 3FS-1" → [{wbs:'3',type:'FS',lag:0}, ...]
function parsePredecessors(str) {
  if (!str?.trim()) return [];
  return str.split(',').map(s => {
    s = s.trim();
    const m = s.match(/^([\d.]+)(FS|FF|SS|SF)?([+-]\d+)?$/i);
    if (!m) return null;
    return { wbs: m[1], type: (m[2] || 'FS').toUpperCase(), lag: m[3] ? parseInt(m[3]) : 0 };
  }).filter(Boolean);
}

// Format deps array → display string using wbsByTaskId map
function formatPredecessors(taskId, deps, wbsByTaskId) {
  return deps
    .filter(d => d.successor_id === taskId)
    .map(d => {
      const wbs = wbsByTaskId[d.predecessor_id];
      if (!wbs) return null;
      const type = (d.type && d.type !== 'FS') ? d.type : '';
      const lag  = d.lag ? (d.lag > 0 ? `+${d.lag}` : `${d.lag}`) : '';
      return `${wbs}${type}${lag}`;
    })
    .filter(Boolean).join(', ');
}

// Compute new dates for a successor given predecessor dates, dep type, lag, and successor duration
function computeSuccessorDates(predStart, predFinish, depType, lag, succDays) {
  const days = Number(succDays) || 1;
  let start, finish;
  if (depType === 'FS' || !depType) {
    start  = addDays(predFinish, lag + 1);
    finish = addDays(start, days - 1);
  } else if (depType === 'SS') {
    start  = addDays(predStart, lag);
    finish = addDays(start, days - 1);
  } else if (depType === 'FF') {
    finish = addDays(predFinish, lag);
    start  = addDays(finish, -(days - 1));
  } else if (depType === 'SF') {
    finish = addDays(predStart, lag);
    start  = addDays(finish, -(days - 1));
  }
  return { start, finish };
}

// Cascade date changes from one task to all its successors (draft only).
function cascadeDraftDates(changedId, changedStart, changedFinish, allRows, allDeps, drafts, visited = new Set()) {
  if (visited.has(changedId)) return drafts;
  visited.add(changedId);
  let newDrafts = { ...drafts };

  const successorDeps = allDeps.filter(d => d.predecessor_id === changedId);
  for (const dep of successorDeps) {
    const succ = allRows.find(r => r.id === dep.successor_id);
    if (!succ) continue;
    const succDraft = newDrafts[succ.id] || {};
    const succDays  = succDraft.estimated_days ?? String(succ.estimated_days || 1);
    const { start, finish } = computeSuccessorDates(changedStart, changedFinish, dep.type, dep.lag || 0, succDays);
    if (!start || !finish) continue;
    newDrafts[succ.id] = { ...succDraft, start_date: start, due_date: finish, estimated_days: String(daysBetween(start, finish)) };
    newDrafts = cascadeDraftDates(succ.id, start, finish, allRows, allDeps, newDrafts, visited);
  }
  return newDrafts;
}

// Rollup parent dates from subtasks, then cascade parent's successors.
function rollupParent(changedTaskId, allRows, allDeps, drafts) {
  const task = allRows.find(r => r.id === changedTaskId);
  if (!task || !task.parent_id) return drafts;
  const parent = allRows.find(r => r.id === task.parent_id);
  if (!parent) return drafts;

  const siblings = allRows.filter(r => r.parent_id === parent.id);
  const starts = [], finishes = [];
  for (const s of siblings) {
    const d = drafts[s.id] || {};
    const st = d.start_date ?? s.start_date;
    const fi = d.due_date   ?? s.due_date;
    if (st) starts.push(st);
    if (fi) finishes.push(fi);
  }

  let newDrafts = { ...drafts };
  const minStart  = starts.length  ? starts.sort()[0]            : '';
  const maxFinish = finishes.length ? finishes.sort().reverse()[0] : '';
  const pDays     = (minStart && maxFinish) ? daysBetween(minStart, maxFinish) : '';

  const pDraft = newDrafts[parent.id] || {};
  newDrafts[parent.id] = { ...pDraft, start_date: minStart, due_date: maxFinish, estimated_days: pDays };

  // Cascade parent's change to its successors
  if (minStart && maxFinish) {
    newDrafts = cascadeDraftDates(parent.id, minStart, maxFinish, allRows, allDeps, newDrafts);
  }
  // Recurse: if parent is also a subtask, rollup grandparent
  return rollupParent(parent.id, allRows, allDeps, newDrafts);
}

// Build flat DFS list with _depth and _wbs
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

// ── Component ─────────────────────────────────────────────────────────────────
export default function WBSGrid({ project, tasks: allTasks, users = [], onTasksChange, onEditTask }) {
  const { authFetch } = useAuth();

  const [rows,      setRows]      = useState([]);
  const [deps,      setDeps]      = useState([]);
  const [drafts,    setDrafts]    = useState({});
  const [saving,    setSaving]    = useState(new Set());
  const [errors,    setErrors]    = useState({});
  const [collapsed, setCollapsed] = useState(new Set());
  const [colWidths, setColWidths] = useState(
    () => Object.fromEntries(COLUMN_DEFS.map(c => [c.key, c.width]))
  );

  const resizeRef = useRef(null);

  // ── Rebuild rows ──────────────────────────────────────────────────────────
  useEffect(() => { setRows(buildRows(allTasks)); }, [allTasks]);

  // ── Load deps ─────────────────────────────────────────────────────────────
  useEffect(() => {
    authFetch(`/api/projects/${project.id}/dependencies`)
      .then(r => r.ok ? r.json() : [])
      .then(setDeps)
      .catch(() => {});
  }, [project.id]);

  // ── Resize mouse handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      if (!resizeRef.current) return;
      const { key, startX, startWidth } = resizeRef.current;
      setColWidths(prev => ({ ...prev, [key]: Math.max(40, startWidth + e.clientX - startX) }));
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const parentIds = useMemo(() => new Set(rows.filter(r => r.parent_id).map(r => r.parent_id)), [rows]);

  const visibleRows = useMemo(() => {
    const hidden = new Set();
    rows.forEach(r => {
      if (r.parent_id && (collapsed.has(r.parent_id) || hidden.has(r.parent_id))) hidden.add(r.id);
    });
    return rows.filter(r => !hidden.has(r.id));
  }, [rows, collapsed]);

  const wbsByTaskId = useMemo(() => {
    const m = {}; rows.forEach(r => { m[r.id] = r._wbs; }); return m;
  }, [rows]);

  // ── Draft helpers ─────────────────────────────────────────────────────────
  const val = (task, field) => {
    const d = drafts[task.id];
    if (d && field in d) return d[field] ?? '';
    if (field === 'predecessors') return formatPredecessors(task.id, deps, wbsByTaskId);
    const v = task[field];
    return v != null ? String(v) : '';
  };

  const isDirty = (taskId) => taskId in drafts;

  const updateDraft = (task, field, value) => {
    const scheduleFields = ['estimated_days', 'start_date', 'due_date'];
    setErrors(prev => { const n = {...prev}; delete n[task.id]; return n; });

    if (field === 'predecessors') {
      const parsed = parsePredecessors(value);
      const invalid = parsed.filter(p => !rows.find(r => r._wbs === p.wbs));
      if (invalid.length) {
        setErrors(prev => ({ ...prev, [task.id]: `Invalid predecessor WBS: ${invalid.map(p=>p.wbs).join(', ')}` }));
        setDrafts(prev => ({ ...prev, [task.id]: { ...prev[task.id], predecessors: value } }));
        return;
      }
      // Compute new dates for this task based on parsed predecessors
      let newStart = '', newFinish = '';
      const taskDraft = drafts[task.id] || {};
      const taskDays  = Number(taskDraft.estimated_days ?? task.estimated_days ?? 1);
      for (const p of parsed) {
        const predRow = rows.find(r => r._wbs === p.wbs);
        if (!predRow) continue;
        const predDraft  = drafts[predRow.id] || {};
        const predStart  = predDraft.start_date ?? predRow.start_date ?? '';
        const predFinish = predDraft.due_date   ?? predRow.due_date   ?? '';
        const { start, finish } = computeSuccessorDates(predStart, predFinish, p.type, p.lag, taskDays);
        if (start && (!newStart || start > newStart)) { newStart = start; newFinish = finish; }
      }
      setDrafts(prev => {
        let nd = { ...prev, [task.id]: { ...prev[task.id], predecessors: value, ...(newStart ? { start_date: newStart, due_date: newFinish, estimated_days: String(taskDays) } : {}) } };
        if (newStart) nd = cascadeDraftDates(task.id, newStart, newFinish, rows, deps, nd);
        return nd;
      });
      return;
    }

    if (scheduleFields.includes(field)) {
      setDrafts(prev => {
        const existing = prev[task.id] || {};
        const current = {
          estimated_days: existing.estimated_days ?? String(task.estimated_days ?? ''),
          start_date:     existing.start_date     ?? (task.start_date || ''),
          due_date:       existing.due_date       ?? (task.due_date   || ''),
        };
        const result = applyScheduleFormula(current, field, value);
        if (result.error) {
          setTimeout(() => setErrors(e => ({ ...e, [task.id]: result.error })), 0);
          return { ...prev, [task.id]: { ...existing, [field]: value } };
        }
        let nd = {
          ...prev,
          [task.id]: { ...existing, estimated_days: result.estimated_days, start_date: result.start_date, due_date: result.due_date },
        };
        nd = cascadeDraftDates(task.id, result.start_date, result.due_date, rows, deps, nd);
        nd = rollupParent(task.id, rows, deps, nd);
        return nd;
      });
      return;
    }

    // non-schedule fields
    setDrafts(prev => ({ ...prev, [task.id]: { ...prev[task.id], [field]: value } }));
  };

  const discardDraft = useCallback((taskId) => {
    setDrafts(prev => { const n = { ...prev }; delete n[taskId]; return n; });
    setErrors(prev => { const n = { ...prev }; delete n[taskId]; return n; });
  }, []);

  // ── Save row ──────────────────────────────────────────────────────────────
  const saveRow = useCallback(async (task) => {
    const draft = drafts[task.id] || {};
    if (errors[task.id]) return;
    setSaving(prev => new Set(prev).add(task.id));

    const merged = { ...task, ...draft };
    const estDays = Math.max(0, Math.min(9999, Number(merged.estimated_days) || 0));

    // Build dependencies array if predecessors draft present
    let dependencies = null;
    if ('predecessors' in draft) {
      const predsStr = draft.predecessors ?? '';
      if (!predsStr.trim()) {
        dependencies = [];
      } else {
        const parsed = parsePredecessors(predsStr);
        dependencies = parsed.map(p => {
          const predRow = rows.find(r => r._wbs === p.wbs);
          return predRow ? { predecessor_id: predRow.id, type: p.type, lag: p.lag } : null;
        }).filter(Boolean);
      }
    }

    const body = {
      title:           (merged.title || '').trim() || task.title,
      description:     merged.description || '',
      status:          merged.status || task.status,
      priority:        merged.priority || task.priority,
      assignee_id:     merged.assignee_id ? Number(merged.assignee_id) : null,
      labels:          merged.labels || '',
      notes:           (merged.notes || '').slice(0, 200),
      start_date:      merged.start_date || null,
      due_date:        merged.due_date   || null,
      estimated_hours: Number(merged.estimated_hours) || 0,
      estimated_days:  estDays,
      logged_hours:    Number(merged.logged_hours)    || 0,
      ...(dependencies !== null ? { dependencies } : {}),
    };

    if (!body.title) {
      setErrors(prev => ({ ...prev, [task.id]: 'Title is required' }));
      setSaving(prev => { const s = new Set(prev); s.delete(task.id); return s; });
      return;
    }

    try {
      const res  = await authFetch(`/api/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setErrors(prev => ({ ...prev, [task.id]: json.error || 'Save failed' })); return; }

      const { task: updated, affected } = json;
      discardDraft(task.id);

      // Reload deps from server after predecessor save
      if (dependencies !== null) {
        authFetch(`/api/projects/${project.id}/dependencies`)
          .then(r => r.ok ? r.json() : []).then(setDeps).catch(() => {});
      }

      setRows(prev => {
        const next = prev.map(r => r.id === updated.id ? { ...r, ...updated } : r);
        if (!affected?.length) return next;
        return next.map(r => { const a = affected.find(x => x.id === r.id); return a ? { ...r, ...a } : r; });
      });
      onTasksChange?.(prev => {
        const next = prev.map(t => t.id === updated.id ? { ...t, ...updated } : t);
        if (!affected?.length) return next;
        return next.map(t => { const a = affected.find(x => x.id === t.id); return a ? { ...t, ...a } : t; });
      });
      if (affected?.length) {
        setDrafts(prev => {
          const nd = { ...prev };
          affected.forEach(t => { delete nd[t.id]; });
          return nd;
        });
      }
    } finally {
      setSaving(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }, [drafts, errors, authFetch, discardDraft, onTasksChange, rows, deps, project.id]);

  // ── Row CRUD ───────────────────────────────────────────────────────────────
  const createRow = useCallback(async (afterIdx, parentId = null) => {
    const res = await authFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ project_id: project.id, title: 'New Task', status: 'todo', priority: 'medium', parent_id: parentId }),
    });
    if (!res.ok) return;
    const newTask = await res.json();
    onTasksChange?.(prev => [...prev, newTask]);
  }, [authFetch, project.id, onTasksChange]);

  const deleteRow = useCallback(async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    const res = await authFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (res.ok) {
      discardDraft(task.id);
      onTasksChange?.(prev => prev.filter(t => t.id !== task.id && t.parent_id !== task.id));
    }
  }, [authFetch, discardDraft, onTasksChange]);

  const toggleCollapse = useCallback((id) => {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  // ── Tab key — move focus without saving ───────────────────────────────────
  const handleTab = (e, rowIdx, colKey) => {
    const editableCols = COLUMN_DEFS.filter(c => c.editable).map(c => c.key);
    const ci = editableCols.indexOf(colKey);
    if (e.shiftKey) {
      if (ci > 0) {
        e.preventDefault();
        document.getElementById(`cell-${rowIdx}-${editableCols[ci - 1]}`)?.focus();
      }
    } else {
      if (ci < editableCols.length - 1) {
        e.preventDefault();
        document.getElementById(`cell-${rowIdx}-${editableCols[ci + 1]}`)?.focus();
      }
    }
  };

  // ── Render one cell ────────────────────────────────────────────────────────
  const renderCell = (task, rowIdx, col) => {
    const w        = colWidths[col];
    const cellId   = `cell-${rowIdx}-${col}`;
    const dirty    = isDirty(task.id);
    const isSaving = saving.has(task.id);
    const isParent = parentIds.has(task.id);

    if (col === 'wbs') {
      const hasChildren = parentIds.has(task.id);
      return (
        <td key={col} className="wbs-grid-cell wbs-cell-wbs" style={{ width: w, minWidth: w }}>
          {hasChildren
            ? <button className="wbs-collapse-btn" onClick={() => toggleCollapse(task.id)}>{collapsed.has(task.id) ? '▶' : '▼'}</button>
            : null}
          <span className="wbs-num">{task._wbs}</span>
        </td>
      );
    }

    if (col === 'predecessors') return (
      <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
        <input
          id={cellId}
          className="wbs-inline-input"
          disabled={isSaving}
          value={val(task, 'predecessors')}
          onChange={e => updateDraft(task, 'predecessors', e.target.value)}
          onBlur={e => updateDraft(task, 'predecessors', e.target.value)}
          onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
          placeholder="e.g. 2, 3FS+1"
          title="Format: WBS[type][±lag], e.g. 2FS, 3FF+1"
        />
      </td>
    );

    if (col === 'assignee_id') return (
      <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
        <select id={cellId} className="wbs-inline-select" disabled={isSaving}
          value={val(task, 'assignee_id')}
          onChange={e => updateDraft(task, 'assignee_id', e.target.value)}
          onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
        >
          <option value="">— Unassigned —</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </td>
    );

    if (col === 'status') return (
      <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
        <select id={cellId} className="wbs-inline-select" disabled={isSaving}
          value={val(task, 'status')}
          onChange={e => updateDraft(task, 'status', e.target.value)}
          onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
    );

    if (col === 'notes') return (
      <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
        <input
          id={cellId}
          className="wbs-inline-input wbs-notes-input"
          disabled={isSaving}
          maxLength={200}
          value={val(task, 'notes')}
          onChange={e => updateDraft(task, 'notes', e.target.value.slice(0, 200))}
          onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
          placeholder="Notes…"
        />
      </td>
    );

    if (col === 'start_date' || col === 'due_date') {
      if (isParent) {
        return (
          <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
            <span className="wbs-cell-locked" title="Dates computed from subtasks">
              {val(task, col) || '—'}
            </span>
          </td>
        );
      }
      return (
        <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
          <input id={cellId} type="date" className="wbs-inline-input wbs-date-input-cell" disabled={isSaving}
            value={val(task, col)}
            onChange={e => updateDraft(task, col, e.target.value)}
            onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
          />
        </td>
      );
    }

    if (col === 'estimated_days') {
      if (isParent) {
        return (
          <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
            <span className="wbs-cell-locked" title="Dates computed from subtasks">
              {val(task, col) || '—'}
            </span>
          </td>
        );
      }
      return (
        <td key={col} className="wbs-grid-cell" style={{ width: w, minWidth: w }}>
          <input id={cellId} type="number" min="0" step="1" className="wbs-inline-input wbs-num-input" disabled={isSaving}
            value={val(task, 'estimated_days')}
            onChange={e => updateDraft(task, 'estimated_days', e.target.value)}
            onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
          />
        </td>
      );
    }

    // Title
    const indent = task._depth * 20;
    return (
      <td key={col} className={`wbs-grid-cell${dirty ? ' wbs-dirty-cell' : ''}`} style={{ width: w, minWidth: w }}>
        <input id={cellId} className="wbs-inline-input" disabled={isSaving}
          style={{ paddingLeft: `${8 + indent}px` }}
          value={val(task, 'title')}
          onChange={e => updateDraft(task, 'title', e.target.value)}
          onKeyDown={e => { if (e.key === 'Tab') handleTab(e, rowIdx, col); }}
          placeholder="Task name"
        />
      </td>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="wbs-grid-wrap">
      <div className="wbs-grid-toolbar">
        <span className="wbs-grid-hint">
          Edit cells freely · formula runs live · click <strong>✓</strong> to save a row · <kbd>Tab</kbd> moves between cells
        </span>
        <button className="btn-primary wbs-add-btn" onClick={() => createRow(visibleRows.length - 1, null)}>
          + Add Task
        </button>
      </div>

      <div className="wbs-grid-scroll">
        <table className="wbs-grid-table">
          <thead>
            <tr className="wbs-grid-head-row">
              {COLUMN_DEFS.map(c => (
                <th key={c.key} className="wbs-grid-th" style={{ width: colWidths[c.key], minWidth: colWidths[c.key] }}>
                  <span className="wbs-th-label">{c.label}</span>
                  <span className="wbs-resize-handle"
                    onMouseDown={e => { e.preventDefault(); resizeRef.current = { key: c.key, startX: e.clientX, startWidth: colWidths[c.key] }; }}
                  />
                </th>
              ))}
              <th className="wbs-grid-th wbs-grid-th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((task, rowIdx) => {
              const dirty    = isDirty(task.id);
              const isSaving = saving.has(task.id);
              const errMsg   = errors[task.id];
              return (
                <React.Fragment key={task.id}>
                  <tr
                    className={[
                      'wbs-grid-row',
                      task._depth > 0 ? 'wbs-subtask-row' : '',
                      rowIdx % 2 ? 'alt' : '',
                      dirty   ? 'wbs-row-dirty' : '',
                      isSaving ? 'saving' : '',
                    ].filter(Boolean).join(' ')}
                    onDoubleClick={() => onEditTask(task)}
                  >
                    {COLUMN_DEFS.map(c => renderCell(task, rowIdx, c.key))}
                    <td className="wbs-grid-cell wbs-cell-actions">
                      {dirty && (
                        <>
                          <button className="wbs-action-btn wbs-action-save" disabled={isSaving || !!errMsg}
                            onClick={e => { e.stopPropagation(); saveRow(task); }}
                            title="Save changes">✓</button>
                          <button className="wbs-action-btn wbs-action-discard" disabled={isSaving}
                            onClick={e => { e.stopPropagation(); discardDraft(task.id); }}
                            title="Discard changes">↺</button>
                        </>
                      )}
                      <button className="wbs-action-btn" onClick={e => { e.stopPropagation(); onEditTask(task); }} title="Open detail">⊞</button>
                      <button className="wbs-action-btn wbs-action-add"
                        onClick={e => { e.stopPropagation(); createRow(rowIdx, task._depth > 0 ? task.parent_id : null); }}
                        title="Insert row below">+</button>
                      <button className="wbs-action-btn wbs-action-del"
                        onClick={e => { e.stopPropagation(); deleteRow(task); }}
                        title="Delete">×</button>
                    </td>
                  </tr>
                  {errMsg && (
                    <tr className="wbs-error-row">
                      <td colSpan={COLUMN_DEFS.length + 1} className="wbs-row-error-msg">⚠ {errMsg}</td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={COLUMN_DEFS.length + 1} className="wbs-grid-empty">
                  No tasks yet. <button className="wbs-link-btn" onClick={() => createRow(-1, null)}>Add the first task</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
