import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const HEADER_H   = 52;   // 2 rows × 26 px
const ROW_H      = 36;
const BAR_H      = 22;
const BAR_Y      = (ROW_H - BAR_H) / 2;
const ARROW_O    = 10;
const MIN_NAME_W = 180;
const MAX_NAME_W = 580;
const DEFAULT_W  = 240;

// Extra fixed column widths
const ASSIGN_W = 36;  // avatar only
const DATE_W   = 82;  // start or due

const ZOOM = {
  day:   { px: 34, label: 'Days'   },
  week:  { px: 16, label: 'Weeks'  },
  month: { px: 7,  label: 'Months' },
};

const STATUS_COLOR = {
  todo:          '#94a3b8',
  'in-progress': '#4a9eff',
  done:          '#22c55e',
};

const PRIORITY_COLOR = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };

// ── Date helpers ──────────────────────────────────────────────────────────────
const toDate      = s    => new Date(s + 'T00:00:00');
const daysBetween = (a, b) => Math.round((b - a) / 86_400_000);
const addDays     = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isoDate     = d    => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function fmtShort(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Header builders ───────────────────────────────────────────────────────────
function groupBy(days, keyFn, labelFn) {
  const groups = [];
  let cur = null;
  for (const d of days) {
    const k = keyFn(d);
    if (!cur || cur.key !== k) { cur = { key: k, label: labelFn(d), count: 0 }; groups.push(cur); }
    cur.count++;
  }
  return groups;
}

function buildHeader(days, zoom) {
  const todayStr = isoDate(new Date());
  if (zoom === 'day') {
    const top = groupBy(days,
      d => `${d.getFullYear()}-${d.getMonth()}`,
      d => d.toLocaleString('default', { month: 'long', year: 'numeric' })
    );
    const bottom = days.map(d => ({
      label: String(d.getDate()), count: 1,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isToday:   isoDate(d) === todayStr,
    }));
    return { top, bottom };
  }
  if (zoom === 'week') {
    const top = groupBy(days,
      d => `${d.getFullYear()}-${d.getMonth()}`,
      d => d.toLocaleString('default', { month: 'long', year: 'numeric' })
    );
    const bottom = groupBy(days,
      d => { const o = (d.getDay() + 6) % 7; return isoDate(addDays(d, -o)); },
      d => { const o = (d.getDay() + 6) % 7; const mon = addDays(d, -o);
             return mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
    );
    return { top, bottom };
  }
  const top = groupBy(days, d => String(d.getFullYear()), d => String(d.getFullYear()));
  const bottom = groupBy(days,
    d => `${d.getFullYear()}-${d.getMonth()}`,
    d => d.toLocaleString('default', { month: 'short' })
  );
  return { top, bottom };
}

// ── Arrow path builder ────────────────────────────────────────────────────────
function arrowPath(type, pred, succ) {
  const py  = pred.row * ROW_H + ROW_H / 2;
  const sy  = succ.row * ROW_H + ROW_H / 2;
  const dir = py <= sy ? 1 : -1;
  const veer = ROW_H / 2 + 4;
  const O   = ARROW_O;

  switch (type) {
    case 'FS': {
      const mx = pred.right + O;
      if (succ.left >= mx + O)
        return `M${pred.right},${py} L${mx},${py} L${mx},${sy} L${succ.left},${sy}`;
      const my = py + dir * veer;
      return `M${pred.right},${py} L${mx},${py} L${mx},${my} L${succ.left-O},${my} L${succ.left-O},${sy} L${succ.left},${sy}`;
    }
    case 'SS': {
      const mx = Math.min(pred.left, succ.left) - O;
      return `M${pred.left},${py} L${mx},${py} L${mx},${sy} L${succ.left},${sy}`;
    }
    case 'FF': {
      const mx = Math.max(pred.right, succ.right) + O;
      return `M${pred.right},${py} L${mx},${py} L${mx},${sy} L${succ.right},${sy}`;
    }
    case 'SF': {
      const mx = pred.left - O;
      if (succ.right <= mx - O)
        return `M${pred.left},${py} L${mx},${py} L${mx},${sy} L${succ.right},${sy}`;
      const my = py + dir * veer;
      return `M${pred.left},${py} L${mx},${py} L${mx},${my} L${succ.right+O},${my} L${succ.right+O},${sy} L${succ.right},${sy}`;
    }
    default: return null;
  }
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, color, size = 22 }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: color || '#4a9eff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700, color: '#fff',
        flexShrink: 0,
      }}
      title={name}
    >
      {initials}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GanttChart({ project, tasks, onEditTask, onDateChange, refreshKey }) {
  const { authFetch } = useAuth();
  const [zoom,        setZoom]        = useState('week');
  const [deps,        setDeps]        = useState([]);
  const [showCP,      setShowCP]      = useState(false);
  const [nameW,       setNameW]       = useState(DEFAULT_W);
  const [editingCell, setEditingCell] = useState(null); // { taskId, field }
  const [dragging,    setDragging]    = useState(false);

  const scrollRef   = useRef(null);
  const nameBodyRef = useRef(null);
  const isDragging  = useRef(false);
  const dragStartX  = useRef(0);
  const dragStartW  = useRef(0);

  const { px: dayPx } = ZOOM[zoom];

  // Column visibility thresholds
  const showAssignee = nameW >= 310;
  const showDates    = nameW >= 420;
  const extraW       = (showAssignee ? ASSIGN_W + 4 : 0) + (showDates ? DATE_W * 2 + 8 : 0);
  const nameColW     = nameW - extraW - 30; // 30 = padding + dot

  // Fetch deps on project/refreshKey change
  useEffect(() => {
    authFetch(`/api/projects/${project.id}/dependencies`)
      .then(r => r.json())
      .then(setDeps);
  }, [project.id, refreshKey]);

  // ── Drag-to-resize logic ───────────────────────────────────────────────────
  const onResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = nameW;
    setDragging(true);
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [nameW]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const clamped = Math.max(MIN_NAME_W, Math.min(MAX_NAME_W, dragStartW.current + delta));
      setNameW(clamped);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragging(false);
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // ── Timeline bounds ────────────────────────────────────────────────────────
  const { timelineStart, totalDays } = useMemo(() => {
    const dates = tasks.flatMap(t =>
      [t.start_date, t.due_date].filter(Boolean).map(toDate)
    );
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    dates.push(todayD);

    const minD = new Date(Math.min(...dates));
    const maxD = new Date(Math.max(...dates));
    const pad  = zoom === 'day' ? 7 : zoom === 'week' ? 21 : 45;

    const rawStart = addDays(minD, -pad);
    const start    = new Date(rawStart.getFullYear(), rawStart.getMonth(), 1);
    const end      = addDays(maxD, pad);

    return { timelineStart: start, totalDays: daysBetween(start, end) + 1 };
  }, [tasks, zoom]);

  const totalW   = totalDays * dayPx;
  const totalH   = tasks.length * ROW_H;
  const todayD   = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const todayX   = daysBetween(timelineStart, todayD) * dayPx;
  const todayStr = isoDate(todayD);

  // ── Critical Path (CPM) ────────────────────────────────────────────────────
  const criticalIds = useMemo(() => {
    if (!showCP || !tasks.length) return new Set();
    const dur = t => Math.max(1, t.estimated_days > 0 ? t.estimated_days
      : (t.start_date && t.due_date ? daysBetween(toDate(t.start_date), toDate(t.due_date)) + 1 : 1));
    const fsDeps = deps.filter(d => d.type === 'FS');
    const succs = {}, preds = {};
    tasks.forEach(t => { succs[t.id] = []; preds[t.id] = []; });
    fsDeps.forEach(d => { if (succs[d.predecessor_id]) succs[d.predecessor_id].push(d); if (preds[d.successor_id]) preds[d.successor_id].push(d); });
    // Kahn topological sort
    const inDeg = {}; tasks.forEach(t => { inDeg[t.id] = preds[t.id].length; });
    const queue = tasks.filter(t => inDeg[t.id] === 0).map(t => t.id);
    const order = [];
    while (queue.length) {
      const id = queue.shift(); order.push(id);
      succs[id]?.forEach(d => { if (--inDeg[d.successor_id] === 0) queue.push(d.successor_id); });
    }
    // Forward pass: ES / EF
    const ES = {}, EF = {};
    order.forEach(id => {
      const t = tasks.find(x => x.id === id); if (!t) return;
      const pe = preds[id].map(d => (EF[d.predecessor_id] ?? 0) + (d.lag || 0) + 1);
      ES[id] = pe.length ? Math.max(...pe) : 0;
      EF[id] = ES[id] + dur(t) - 1;
    });
    // Backward pass: LS / LF
    const end = Math.max(0, ...Object.values(EF));
    const LS = {}, LF = {};
    [...order].reverse().forEach(id => {
      const t = tasks.find(x => x.id === id); if (!t) return;
      const sl = succs[id].map(d => (LS[d.successor_id] ?? end) - (d.lag || 0) - 1);
      LF[id] = sl.length ? Math.min(...sl) : end;
      LS[id] = LF[id] - dur(t) + 1;
    });
    return new Set(order.filter(id => (LS[id] ?? 0) - (ES[id] ?? 0) === 0));
  }, [showCP, tasks, deps]);

  // ── Bar positions ──────────────────────────────────────────────────────────
  const barPos = useMemo(() => {
    const map = {};
    tasks.forEach((t, i) => {
      const s = t.start_date ? toDate(t.start_date) : t.due_date   ? toDate(t.due_date)   : null;
      const e = t.due_date   ? toDate(t.due_date)   : t.start_date ? toDate(t.start_date) : null;
      if (!s || !e) return;
      const left  = daysBetween(timelineStart, s) * dayPx;
      const width = Math.max((daysBetween(s, e) + 1) * dayPx, dayPx);
      map[t.id] = { left, right: left + width, width, row: i };
    });
    return map;
  }, [tasks, timelineStart, dayPx]);

  // ── Header cells ───────────────────────────────────────────────────────────
  const allDays = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(timelineStart, i)),
    [timelineStart, totalDays]
  );
  const { top: topCells, bottom: botCells } = useMemo(
    () => buildHeader(allDays, zoom),
    [allDays, zoom]
  );

  // Scroll to today on zoom change
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollLeft = Math.max(0, todayX - 240);
  }, [todayX]);

  // Sync vertical scroll: right → left
  const onScroll = () => {
    if (nameBodyRef.current && scrollRef.current)
      nameBodyRef.current.scrollTop = scrollRef.current.scrollTop;
  };

  // ── Inline date cell handler ───────────────────────────────────────────────
  const commitDate = (taskId, field, value) => {
    setEditingCell(null);
    if (onDateChange) onDateChange(taskId, field, value || null);
  };

  const noDateTasks = tasks.filter(t => !t.start_date && !t.due_date);

  return (
    <div className="gantt-wrap">

      {/* Toolbar */}
      <div className="gantt-toolbar">
        <div className="zoom-btns">
          {Object.entries(ZOOM).map(([k, { label }]) => (
            <button key={k} className={`zoom-btn${zoom === k ? ' active' : ''}`} onClick={() => setZoom(k)}>
              {label}
            </button>
          ))}
          <button className={`zoom-btn${showCP ? ' active' : ''}`} onClick={() => setShowCP(v => !v)} title="Highlight critical path (zero float)">
            Critical Path
          </button>
        </div>
        <div className="gantt-toolbar-hint">
          Drag <span className="gantt-hint-icon">⇔</span> divider to expand WBS · Click dates to edit inline
        </div>
        <div className="gantt-legend">
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <span key={s} className="legend-item">
              <span className="legend-dot" style={{ background: c }} />
              {s === 'in-progress' ? 'In Progress' : s[0].toUpperCase() + s.slice(1)}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#ff6b6b' }} /> Overdue
          </span>
          {showCP && (
            <span className="legend-item">
              <span className="legend-dot" style={{ background: '#ef4444' }} /> Critical
            </span>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="gantt-main">

        {/* Left: resizable WBS panel */}
        <div className="gantt-left" style={{ width: nameW }}>

          {/* WBS Header */}
          <div className="gantt-left-hdr wbs-hdr" style={{ height: HEADER_H }}>
            <div className="wbs-hdr-top">WBS</div>
            <div className="wbs-hdr-cols">
              <span className="wbs-col-name" style={{ width: nameColW }}>Task</span>
              {showAssignee && (
                <span className="wbs-col-small" style={{ width: ASSIGN_W }}>Who</span>
              )}
              {showDates && (
                <>
                  <span className="wbs-col-date" style={{ width: DATE_W }}>Start</span>
                  <span className="wbs-col-date" style={{ width: DATE_W }}>Due</span>
                </>
              )}
            </div>
          </div>

          {/* WBS Body rows */}
          <div className="gantt-left-body" ref={nameBodyRef}>
            {tasks.map((t, i) => {
              const overdue = t.due_date && t.status !== 'done' && toDate(t.due_date) < todayD;
              return (
                <div
                  key={t.id}
                  className={`gantt-name-row${i % 2 ? ' alt' : ''}`}
                  style={{ height: ROW_H }}
                >
                  {/* Status dot + name */}
                  <div
                    className="wbs-name-cell"
                    style={{ width: nameColW, minWidth: 60 }}
                    onClick={() => onEditTask(t)}
                    title={t.title}
                  >
                    <span className={`g-dot g-dot-${t.status}`} />
                    {t.priority && (
                      <span
                        className="wbs-priority-dot"
                        style={{ background: PRIORITY_COLOR[t.priority] }}
                        title={t.priority}
                      />
                    )}
                    <span className="g-task-name">{t.title}</span>
                  </div>

                  {/* Assignee avatar */}
                  {showAssignee && (
                    <div className="wbs-assign-cell" style={{ width: ASSIGN_W }}>
                      {t.assignee_name
                        ? <Avatar name={t.assignee_name} color={t.assignee_color} size={22} />
                        : <span className="wbs-unassigned" title="Unassigned">—</span>
                      }
                    </div>
                  )}

                  {/* Start date */}
                  {showDates && (
                    <div
                      className={`wbs-date-cell${editingCell?.taskId === t.id && editingCell?.field === 'start_date' ? ' editing' : ''}`}
                      style={{ width: DATE_W }}
                      onClick={() => setEditingCell({ taskId: t.id, field: 'start_date' })}
                      title="Click to edit start date"
                    >
                      {editingCell?.taskId === t.id && editingCell?.field === 'start_date' ? (
                        <input
                          type="date"
                          className="wbs-date-input"
                          defaultValue={t.start_date || ''}
                          autoFocus
                          onChange={e => commitDate(t.id, 'start_date', e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className={`wbs-date-text${!t.start_date ? ' empty' : overdue ? ' overdue' : ''}`}>
                          {t.start_date ? fmtShort(t.start_date) : '—'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Due date */}
                  {showDates && (
                    <div
                      className={`wbs-date-cell${editingCell?.taskId === t.id && editingCell?.field === 'due_date' ? ' editing' : ''}`}
                      style={{ width: DATE_W }}
                      onClick={() => setEditingCell({ taskId: t.id, field: 'due_date' })}
                      title="Click to edit due date"
                    >
                      {editingCell?.taskId === t.id && editingCell?.field === 'due_date' ? (
                        <input
                          type="date"
                          className="wbs-date-input"
                          defaultValue={t.due_date || ''}
                          autoFocus
                          onChange={e => commitDate(t.id, 'due_date', e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className={`wbs-date-text${!t.due_date ? ' empty' : overdue ? ' overdue' : ''}`}>
                          {t.due_date ? fmtShort(t.due_date) : '—'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Drag-resize handle */}
        <div
          className={`gantt-resizer${dragging ? ' dragging' : ''}`}
          onMouseDown={onResizerMouseDown}
          title="Drag to resize WBS panel"
        />

        {/* Right: scrollable timeline */}
        <div className="gantt-scroll" ref={scrollRef} onScroll={onScroll}>
          <div style={{ width: totalW, minWidth: totalW }}>

            {/* Sticky header */}
            <div className="gantt-hdr" style={{ height: HEADER_H, width: totalW }}>
              <div className="gantt-hdr-row" style={{ height: 26 }}>
                {topCells.map((c, i) => (
                  <div key={i} className="gantt-hdr-cell" style={{ width: c.count * dayPx }}>
                    {c.count * dayPx >= 50 ? c.label : ''}
                  </div>
                ))}
              </div>
              <div className="gantt-hdr-row gantt-hdr-bot" style={{ height: 26 }}>
                {botCells.map((c, i) => {
                  const w = c.count * dayPx;
                  return (
                    <div
                      key={i}
                      className={`gantt-hdr-cell${c.isWeekend ? ' weekend' : ''}${c.isToday ? ' today-hdr' : ''}`}
                      style={{ width: w }}
                    >
                      {w >= 18 ? c.label : ''}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Body */}
            <div style={{ position: 'relative', width: totalW, height: totalH }}>

              {/* Row stripes */}
              {tasks.map((_, i) => (
                <div
                  key={i}
                  className={`gantt-row-bg${i % 2 ? ' alt' : ''}`}
                  style={{ top: i * ROW_H, height: ROW_H, width: totalW }}
                />
              ))}

              {/* Weekend + today column highlight (day view only) */}
              {zoom === 'day' && allDays.map((d, i) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isToday   = isoDate(d) === todayStr;
                if (!isWeekend && !isToday) return null;
                return (
                  <div
                    key={i}
                    className={`gantt-col-hl${isToday ? ' today-col' : ' weekend-col'}`}
                    style={{ left: i * dayPx, width: dayPx, height: totalH }}
                  />
                );
              })}

              {/* Today vertical line */}
              {todayX >= 0 && todayX <= totalW && (
                <div className="gantt-today-line" style={{ left: todayX, height: totalH }} />
              )}

              {/* Bars */}
              {tasks.map((t, i) => {
                const pos = barPos[t.id];
                if (!pos) return null;
                const overdue     = t.due_date && t.status !== 'done' && toDate(t.due_date) < todayD;
                const isCritical  = showCP && criticalIds.has(t.id);
                const color       = isCritical ? '#ef4444' : overdue ? '#ff6b6b' : STATUS_COLOR[t.status];
                return (
                  <div
                    key={t.id}
                    className={`gantt-bar${isCritical ? ' gantt-bar-critical' : ''}`}
                    style={{ left: pos.left, top: i * ROW_H + BAR_Y, width: pos.width, background: color }}
                    onClick={() => onEditTask(t)}
                    title={`${t.title}${t.start_date ? '\n▶ ' + t.start_date : ''}${t.due_date ? '\n■ ' + t.due_date : ''}`}
                  >
                    {pos.width > 34 && <span className="gantt-bar-lbl">{t.title}</span>}
                  </div>
                );
              })}

              {/* Dependency arrows */}
              <svg
                style={{ position: 'absolute', inset: 0, width: totalW, height: totalH, pointerEvents: 'none', overflow: 'visible' }}
              >
                <defs>
                  <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L0,7 L7,3.5 z" fill="#64748b" />
                  </marker>
                  <marker id="arr-crit" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L0,7 L7,3.5 z" fill="#ef4444" />
                  </marker>
                </defs>
                {deps.map(dep => {
                  const pred = barPos[dep.predecessor_id];
                  const succ = barPos[dep.successor_id];
                  if (!pred || !succ) return null;
                  const d = arrowPath(dep.type, pred, succ);
                  if (!d) return null;
                  const isCritArrow = showCP && dep.type === 'FS' && criticalIds.has(dep.predecessor_id) && criticalIds.has(dep.successor_id);
                  return (
                    <path key={dep.id} d={d} fill="none"
                      stroke={isCritArrow ? '#ef4444' : '#64748b'}
                      strokeWidth={isCritArrow ? 2 : 1.5}
                      markerEnd={isCritArrow ? 'url(#arr-crit)' : 'url(#arr)'} />
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks without any dates */}
      {noDateTasks.length > 0 && (
        <div className="gantt-no-dates">
          <span>No dates set: </span>
          {noDateTasks.map(t => (
            <span key={t.id} className="gantt-no-date-chip" onClick={() => onEditTask(t)}>
              {t.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
