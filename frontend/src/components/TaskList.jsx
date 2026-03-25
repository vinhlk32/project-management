import React, { useState, useEffect } from 'react';
import TaskModal from './TaskModal';
import GanttChart from './GanttChart';

const STATUS_LABELS = { todo: 'Todo', 'in-progress': 'In Progress', done: 'Done' };
const STATUS_ORDER  = ['todo', 'in-progress', 'done'];

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(due_date, status) {
  return due_date && status !== 'done' && new Date(due_date) < new Date().setHours(0, 0, 0, 0);
}

export default function TaskList({ project }) {
  const [tasks,       setTasks]       = useState([]);
  const [view,        setView]        = useState('kanban');   // 'kanban' | 'gantt'
  const [modalOpen,   setModalOpen]   = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [ganttRefresh, setGanttRefresh] = useState(0);       // bumped on modal close → re-fetches deps

  useEffect(() => {
    fetch(`/api/projects/${project.id}/tasks`)
      .then(r => r.json())
      .then(setTasks);
  }, [project.id]);

  const applyAffected = (affected) => {
    if (!affected?.length) return;
    setTasks(prev => prev.map(t => affected.find(a => a.id === t.id) || t));
  };

  const saveTask = async (data) => {
    if (editingTask) {
      const res = await fetch(`/api/tasks/${editingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const { task: updated, affected } = await res.json();
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
      applyAffected(affected);
    } else {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, project_id: project.id }),
      });
      const created = await res.json();
      setTasks(prev => [created, ...prev]);
    }
    closeModal();
  };

  saveTask.__affectedUpdate = applyAffected;

  const deleteTask = async (id) => {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const openEdit = (task) => { setEditingTask(task); setModalOpen(true); };
  const openNew  = ()     => { setEditingTask(null);  setModalOpen(true); };
  const closeModal = ()   => {
    setModalOpen(false);
    setEditingTask(null);
    setGanttRefresh(n => n + 1);   // tell GanttChart to re-fetch deps
  };

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s);
    return acc;
  }, {});

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

      {view === 'kanban' && (
        <div className="columns">
          {STATUS_ORDER.map(status => (
            <div key={status} className={`column column-${status}`}>
              <div className="column-title">
                {STATUS_LABELS[status]}
                <span className="count">{grouped[status].length}</span>
              </div>
              {grouped[status].map(task => (
                <div
                  key={task.id}
                  className={`task-card${isOverdue(task.due_date, task.status) ? ' overdue' : ''}`}
                  onClick={() => openEdit(task)}
                >
                  <div className="task-title">{task.title}</div>
                  {task.description && <div className="task-desc">{task.description}</div>}
                  <div className="task-footer">
                    <div className="task-dates">
                      {(task.start_date || task.due_date) && (
                        <span className={`due-date${isOverdue(task.due_date, task.status) ? ' overdue-text' : ''}`}>
                          {task.start_date && task.due_date
                            ? `${formatDate(task.start_date)} → ${formatDate(task.due_date)}`
                            : task.start_date
                              ? `Start: ${formatDate(task.start_date)}`
                              : `Due: ${formatDate(task.due_date)}`}
                        </span>
                      )}
                    </div>
                    <button
                      className="delete-btn"
                      onClick={e => { e.stopPropagation(); deleteTask(task.id); }}
                      title="Delete task"
                    >&times;</button>
                  </div>
                </div>
              ))}
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
          onSave={saveTask}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
