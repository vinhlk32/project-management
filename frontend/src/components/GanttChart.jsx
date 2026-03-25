import React, { useState, useEffect, useRef, useMemo } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const HEADER_H = 52;   // 2 rows × 26 px
const ROW_H    = 36;
const BAR_H    = 22;
const BAR_Y    = (ROW_H - BAR_H) / 2;
const NAME_W   = 230;
const ARROW_O  = 10;   // elbow offset for routing

const ZOOM = {
  day:   { px: 34, label: 'Days'   },
  week:  { px: 16, label: 'Weeks'  },
  month: { px: 7,  label: 'Months' },
};

const STATUS_COLOR = {
  todo:         '#94a3b8',
  'in-progress':'#4a9eff',
  done:         '#22c55e',
};

// ── Date helpers ──────────────────────────────────────────────────────────────
const toDate      = s    => new Date(s + 'T00:00:00');
const daysBetween = (a, b) => Math.round((b - a) / 86_400_000);
const addDays     = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isoDate     = d    => d.toISOString().split('T')[0];

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
      label: String(d.getDate()),
      count: 1,
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
      d => { const offset = (d.getDay() + 6) % 7; return isoDate(addDays(d, -offset)); },
      d => { const offset = (d.getDay() + 6) % 7; const mon = addDays(d, -offset);
             return mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
    );
    return { top, bottom };
  }

  // month zoom
  const top = groupBy(days, d => String(d.getFullYear()), d => String(d.getFullYear()));
  const bottom = groupBy(days,
    d => `${d.getFullYear()}-${d.getMonth()}`,
    d => d.toLocaleString('default', { month: 'short' })
  );
  return { top, bottom };
}

// ── Arrow path builder ────────────────────────────────────────────────────────
function arrowPath(type, pred, succ) {
  const py   = pred.row * ROW_H + ROW_H / 2;
  const sy   = succ.row * ROW_H + ROW_H / 2;
  const dir  = py <= sy ? 1 : -1;
  const veer = ROW_H / 2 + 4;
  const O    = ARROW_O;

  switch (type) {
    case 'FS': {
      const mx = pred.right + O;
      if (succ.left >= mx + O)
        return `M${pred.right},${py} L${mx},${py} L${mx},${sy} L${succ.left},${sy}`;
      const my = py + dir * veer;
      return `M${pred.right},${py} L${mx},${py} L${mx},${my} L${succ.left - O},${my} L${succ.left - O},${sy} L${succ.left},${sy}`;
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
      return `M${pred.left},${py} L${mx},${py} L${mx},${my} L${succ.right + O},${my} L${succ.right + O},${sy} L${succ.right},${sy}`;
    }
    default: return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GanttChart({ project, tasks, onEditTask, refreshKey }) {
  const [zoom, setZoom] = useState('week');
  const [deps, setDeps] = useState([]);
  const scrollRef    = useRef(null);
  const nameBodyRef  = useRef(null);

  const { px: dayPx } = ZOOM[zoom];

  // Re-fetch deps whenever deps may have changed (modal close triggers refreshKey bump)
  useEffect(() => {
    fetch(`/api/projects/${project.id}/dependencies`)
      .then(r => r.json())
      .then(setDeps);
  }, [project.id, refreshKey]);

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

    // Snap start to the 1st of that month for a clean grid
    const rawStart = addDays(minD, -pad);
    const start = new Date(rawStart.getFullYear(), rawStart.getMonth(), 1);
    const end   = addDays(maxD, pad);

    return { timelineStart: start, totalDays: daysBetween(start, end) + 1 };
  }, [tasks, zoom]);

  const totalW  = totalDays * dayPx;
  const totalH  = tasks.length * ROW_H;
  const todayD  = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const todayX  = daysBetween(timelineStart, todayD) * dayPx;
  const todayStr = isoDate(todayD);

  // ── Bar positions ──────────────────────────────────────────────────────────
  const barPos = useMemo(() => {
    const map = {};
    tasks.forEach((t, i) => {
      const s = t.start_date ? toDate(t.start_date) : t.due_date ? toDate(t.due_date)   : null;
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

  // Sync vertical scroll: timeline → names column
  const onScroll = () => {
    if (nameBodyRef.current && scrollRef.current)
      nameBodyRef.current.scrollTop = scrollRef.current.scrollTop;
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
        </div>
      </div>

      {/* Main area */}
      <div className="gantt-main">

        {/* Left: fixed task-name column */}
        <div className="gantt-left" style={{ width: NAME_W }}>
          <div className="gantt-left-hdr" style={{ height: HEADER_H }}>Task</div>
          <div className="gantt-left-body" ref={nameBodyRef}>
            {tasks.map((t, i) => (
              <div
                key={t.id}
                className={`gantt-name-row${i % 2 ? ' alt' : ''}`}
                style={{ height: ROW_H }}
                onClick={() => onEditTask(t)}
                title={t.title}
              >
                <span className={`g-dot g-dot-${t.status}`} />
                <span className="g-task-name">{t.title}</span>
              </div>
            ))}
          </div>
        </div>

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
                const overdue = t.due_date && t.status !== 'done' && toDate(t.due_date) < todayD;
                const color   = overdue ? '#ff6b6b' : STATUS_COLOR[t.status];
                return (
                  <div
                    key={t.id}
                    className="gantt-bar"
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
                </defs>
                {deps.map(dep => {
                  const pred = barPos[dep.predecessor_id];
                  const succ = barPos[dep.successor_id];
                  if (!pred || !succ) return null;
                  const d = arrowPath(dep.type, pred, succ);
                  if (!d) return null;
                  return (
                    <path key={dep.id} d={d} fill="none" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#arr)" />
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
