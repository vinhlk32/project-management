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
    const res = await authFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { console.error('Failed to create project'); return; }
    const project = await res.json();
    setProjects(prev => [project, ...prev]);
    setSelectedProject(project);
    setView('board');
  };

  const deleteProject = async (id) => {
    const res = await authFetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) { console.error('Failed to delete project'); return; }
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProject?.id === id) {
      setSelectedProject(projects.find(p => p.id !== id) || null);
    }
  };

  const addUser = async (data) => {
    const res = await authFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) { console.error('Failed to create user'); return; }
    const user = await res.json();
    setUsers(prev => [...prev, user]);
  };

  const deleteUser = async (id) => {
    const res = await authFetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) { console.error('Failed to delete user'); return; }
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  const updateUser = async (id, data) => {
    const res = await authFetch(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!res.ok) { console.error('Failed to update user'); return; }
    const updated = await res.json();
    setUsers(prev => prev.map(u => u.id === id ? updated : u));
  };

  const handleSelectProject = (project) => {
    setSelectedProject(project);
    setView('board');
  };

  return (
    <div className="app">
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
