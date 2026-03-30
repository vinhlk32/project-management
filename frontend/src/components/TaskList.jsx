import React, { useState, useEffect } from 'react';
import TaskModal from './TaskModal';
import GanttChart from './GanttChart';
import { useAuth } from '../context/AuthContext';

const STATUS_LABELS = { todo: 'Todo', 'in-progress': 'In Progress', done: 'Done' };
const STATUS_ORDER  = ['todo', 'in-progress', 'done'];

const PRIORITY_COLORS = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
const PRIORITY_ICONS  = { low: '↓', medium: '→', high: '↑', critical: '‼' };

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(due_date, status) {
  return due_date && status !== 'done' && new Date(due_date) < new Date().setHours(0, 0, 0, 0);
}

function labelColor(name) {
  const presets = { Bug: '#ef4444', Feature: '#8b5cf6', Design: '#ec4899', Research: '#06b6d4', Blocked: '#f97316', Review: '#f59e0b', Testing: '#22c55e', Docs: '#6b7280' };
  if (presets[name]) return presets[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#4a9eff', '#8b5cf6', '#ec4899', '#06b6d4', '#22c55e', '#f97316', '#f59e0b'];
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({ name, color, size = 22 }) {
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

export default function TaskList({ project, users = [], currentUser: currentUserProp }) {
  const { authFetch, currentUser: authCurrentUser } = useAuth();
  const currentUser = currentUserProp || authCurrentUser;
  const [tasks,        setTasks]        = useState([]);
  const [view,         setView]         = useState('kanban');
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editingTask,  setEditingTask]  = useState(null);
  const [ganttRefresh, setGanttRefresh] = useState(0);
  const [search,       setSearch]       = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  useEffect(() => {
    authFetch(`/api/projects/${project.id}/tasks`)
      .then(r => r.ok ? r.json() : [])
      .then(setTasks)
      .catch(err => console.error('Failed to load tasks:', err));
  }, [project.id]);

  const applyAffected = (affected) => {
    if (!affected?.length) return;
    setTasks(prev => prev.map(t => affected.find(a => a.id === t.id) || t));
  };

  const saveTask = async (data) => {
    if (editingTask) {
      const res = await authFetch(`/api/tasks/${editingTask.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (!res.ok) { console.error('Failed to update task'); closeModal(); return; }
      const { task: updated, affected } = await res.json();
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
      applyAffected(affected);
    } else {
      const res = await authFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ ...data, project_id: project.id }),
      });
      if (!res.ok) { console.error('Failed to create task'); closeModal(); return; }
      const created = await res.json();
      setTasks(prev => [created, ...prev]);
    }
    closeModal();
  };

  saveTask.__affectedUpdate = applyAffected;

  const deleteTask = async (id) => {
    const res = await authFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) setTasks(prev => prev.filter(t => t.id !== id));
    else console.error('Failed to delete task');
  };

  const openEdit  = (task) => { setEditingTask(task); setModalOpen(true); };
  const openNew   = ()     => { setEditingTask(null);  setModalOpen(true); };
  const closeModal = ()    => {
    setModalOpen(false);
    setEditingTask(null);
    setGanttRefresh(n => n + 1);
  };

  // Apply filters
  const filtered = tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) &&
        !t.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterAssignee && String(t.assignee_id) !== filterAssignee) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    return true;
  });

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = filtered.filter(t => t.status === s);
    return acc;
  }, {});

  const hasFilters = search || filterAssignee || filterPriority;

  return (
    <div className="task-view">
      <div className="task-header">
        <h2>{project.name}</h2>
        <div className="task-header-right">
          <div className="view-toggle">
            <button className={`view-btn${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')}>
              Kanban
            </button>
            <button className={`view-btn${view === 'gantt' ? ' active' : ''}`} onClick={() => setView('gantt')}>
              Gantt
            </button>
          </div>
          <button className="btn-primary" onClick={openNew}>+ New Task</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            placeholder="Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>&times;</button>
          )}
        </div>

        <select
          className="filter-select"
          value={filterAssignee}
          onChange={e => setFilterAssignee(e.target.value)}
        >
          <option value="">All Assignees</option>
          <option value="null">Unassigned</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {hasFilters && (
          <button
            className="btn-secondary filter-clear"
            onClick={() => { setSearch(''); setFilterAssignee(''); setFilterPriority(''); }}
          >
            Clear filters
          </button>
        )}

        <span className="filter-count">
          {filtered.length} / {tasks.length} tasks
        </span>
      </div>

      {view === 'kanban' && (
        <div className="columns">
          {STATUS_ORDER.map(status => (
            <div key={status} className={`column column-${status}`}>
              <div className="column-title">
                {STATUS_LABELS[status]}
                <span className="count">{grouped[status].length}</span>
              </div>
              {grouped[status].map(task => {
                const taskLabels = task.labels ? task.labels.split(',').filter(Boolean) : [];
                const overdue = isOverdue(task.due_date, task.status);
                return (
                  <div
                    key={task.id}
                    className={`task-card${overdue ? ' overdue' : ''}`}
                    onClick={() => openEdit(task)}
                  >
                    {/* Priority + Labels row */}
                    <div className="card-top-row">
                      <span
                        className="priority-badge"
                        style={{ color: PRIORITY_COLORS[task.priority], background: PRIORITY_COLORS[task.priority] + '18' }}
                        title={task.priority}
                      >
                        {PRIORITY_ICONS[task.priority]} {task.priority}
                      </span>
                      {taskLabels.slice(0, 2).map(l => (
                        <span
                          key={l}
                          className="label-chip-sm"
                          style={{ background: labelColor(l) + '20', color: labelColor(l) }}
                        >{l}</span>
                      ))}
                      {taskLabels.length > 2 && (
                        <span className="label-chip-sm label-chip-more">+{taskLabels.length - 2}</span>
                      )}
                    </div>

                    <div className="task-title">{task.title}</div>
                    {task.description && <div className="task-desc">{task.description}</div>}

                    <div className="task-footer">
                      <div className="task-meta-left">
                        {(task.start_date || task.due_date) && (
                          <span className={`due-date${overdue ? ' overdue-text' : ''}`}>
                            {task.start_date && task.due_date
                              ? `${formatDate(task.start_date)} → ${formatDate(task.due_date)}`
                              : task.start_date
                                ? `Start: ${formatDate(task.start_date)}`
                                : `Due: ${formatDate(task.due_date)}`}
                          </span>
                        )}
                      </div>
                      <div className="task-meta-right">
                        {task.assignee_name && (
                          <Avatar name={task.assignee_name} color={task.assignee_color} size={22} />
                        )}
                        <button
                          className="delete-btn"
                          onClick={e => { e.stopPropagation(); deleteTask(task.id); }}
                          title="Delete task"
                        >&times;</button>
                      </div>
                    </div>

                    {/* Time progress bar */}
                    {task.estimated_hours > 0 && (
                      <div className="time-progress" title={`${task.logged_hours || 0}h / ${task.estimated_hours}h`}>
                        <div
                          className="time-progress-fill"
                          style={{
                            width: `${Math.min(100, ((task.logged_hours || 0) / task.estimated_hours) * 100)}%`,
                            background: (task.logged_hours || 0) > task.estimated_hours ? '#ef4444' : '#4a9eff',
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view === 'gantt' && (
        <GanttChart
          project={project}
          tasks={tasks}
          onEditTask={openEdit}
          refreshKey={ganttRefresh}
        />
      )}

      {modalOpen && (
        <TaskModal
          task={editingTask}
          projectTasks={tasks}
          users={users}
          currentUser={currentUser}
          onSave={saveTask}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
