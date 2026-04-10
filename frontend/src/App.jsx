import React, { useState, useEffect } from 'react';
import ProjectList from './components/ProjectList';
import TaskList from './components/TaskList';
import Dashboard from './components/Dashboard';
import UserAdmin from './components/UserAdmin';
import AuditLog from './components/AuditLog';
import LoginPage from './components/LoginPage';
import { useAuth } from './context/AuthContext';

export default function App() {
  const { currentUser, authFetch, logout } = useAuth();

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [view, setView] = useState('board'); // 'board' | 'dashboard' | 'admin' | 'audit'
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  // Load data after login — must be declared before any early return
  useEffect(() => {
    if (!currentUser) return;
    Promise.all([
      authFetch('/api/projects').then(r => r.ok ? r.json() : []),
      authFetch('/api/users').then(r => r.ok ? r.json() : []),
    ]).then(([projectsData, usersData]) => {
      setProjects(projectsData);
      setUsers(usersData);
      if (projectsData.length > 0) setSelectedProject(projectsData[0]);
    }).catch(err => console.error('Failed to load initial data:', err));
  }, [currentUser]);

  // Show login page if not authenticated
  if (!currentUser) {
    return <LoginPage />;
  }

  const addProject = async (name) => {
    setLoading(true);
    try {
      const res = await authFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
      if (!res.ok) { const e = await res.json(); showError(e.error || 'Failed to create project'); return; }
      const project = await res.json();
      setProjects(prev => [project, ...prev]);
      setSelectedProject(project);
      setView('board');
    } finally { setLoading(false); }
  };

  const deleteProject = async (id) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) { showError('Failed to delete project'); return; }
      setProjects(prev => prev.filter(p => p.id !== id));
      if (selectedProject?.id === id) setSelectedProject(projects.find(p => p.id !== id) || null);
    } finally { setLoading(false); }
  };

  const addUser = async (data) => {
    setLoading(true);
    try {
      const res = await authFetch('/api/users', { method: 'POST', body: JSON.stringify(data) });
      if (!res.ok) { const e = await res.json(); showError(e.error || 'Failed to create user'); return; }
      const user = await res.json();
      setUsers(prev => [...prev, user]);
    } finally { setLoading(false); }
  };

  const deleteUser = async (id) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) { showError('Failed to delete user'); return; }
      setUsers(prev => prev.filter(u => u.id !== id));
    } finally { setLoading(false); }
  };

  const updateUser = async (id, data) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      if (!res.ok) { const e = await res.json(); showError(e.error || 'Failed to update user'); return; }
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === id ? updated : u));
    } finally { setLoading(false); }
  };

  const handleSelectProject = (project) => {
    setSelectedProject(project);
    setView('board');
  };

  return (
    <div className="app">
      {error && (
        <div style={{
          position: 'fixed', top: '16px', right: '16px', zIndex: 9999,
          background: '#ef4444', color: '#fff', padding: '10px 18px',
          borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          fontSize: '14px', maxWidth: '360px',
        }}>
          {error}
        </div>
      )}
      {loading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: '3px',
          background: '#4a9eff', zIndex: 9998, animation: 'none',
        }} />
      )}
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">⬡</span>
          <h1>Project Manager</h1>
        </div>
        <nav className="header-nav">
          <button
            className={`nav-btn${view === 'dashboard' ? ' active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`nav-btn${view === 'board' ? ' active' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          {currentUser.role === 'admin' && (
            <button
              className={`nav-btn${view === 'admin' ? ' active' : ''}`}
              onClick={() => setView('admin')}
            >
              Admin
            </button>
          )}
          {currentUser.role === 'admin' && (
            <button
              className={`nav-btn${view === 'audit' ? ' active' : ''}`}
              onClick={() => setView('audit')}
            >
              Audit
            </button>
          )}
        </nav>
        <div className="header-right">
          <span className="current-user-display">
            {currentUser.name}
          </span>
          <button className="btn-secondary logout-btn" onClick={logout}>
            Log Out
          </button>
        </div>
      </header>

      <div className="app-body">
        {view !== 'admin' && view !== 'audit' && (
          <ProjectList
            projects={projects}
            selectedProject={selectedProject}
            onSelect={handleSelectProject}
            onAdd={addProject}
            onDelete={deleteProject}
          />
        )}
        <main className="main-content">
          {view === 'dashboard' && (
            <Dashboard project={selectedProject} users={users} />
          )}
          {view === 'board' && (
            selectedProject
              ? <TaskList
                  project={selectedProject}
                  users={users}
                  currentUser={currentUser}
                />
              : <div className="empty-state">Select or create a project to get started.</div>
          )}
          {view === 'admin' && (
            <UserAdmin
              users={users}
              onAdd={addUser}
              onUpdate={updateUser}
              onDelete={deleteUser}
            />
          )}
          {view === 'audit' && currentUser.role === 'admin' && (
            <AuditLog />
          )}
        </main>
      </div>
    </div>
  );
}
