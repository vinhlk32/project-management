import React, { useState, useEffect } from 'react';
import ProjectList from './components/ProjectList';
import TaskList from './components/TaskList';
import Dashboard from './components/Dashboard';
import UserAdmin from './components/UserAdmin';

const AVATAR_COLORS = [
  '#4a9eff', '#8b5cf6', '#ec4899', '#06b6d4',
  '#22c55e', '#f97316', '#f59e0b', '#ef4444',
];

function Avatar({ name, color, size = 28 }) {
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

function TeamPanel({ users, onAdd, onDelete, currentUser, onSetCurrentUser, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [colorIdx, setColorIdx] = useState(0);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), email: email.trim(), role, avatar_color: AVATAR_COLORS[colorIdx] });
    setName(''); setEmail(''); setRole('member');
    setColorIdx(c => (c + 1) % AVATAR_COLORS.length);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Team Members</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {/* Current user picker */}
        <div className="current-user-section">
          <div className="section-label">You are working as:</div>
          <div className="user-picker-row">
            <select
              value={currentUser?.id || ''}
              onChange={e => {
                const u = users.find(u => String(u.id) === e.target.value);
                onSetCurrentUser(u || null);
              }}
              className="user-picker-select"
            >
              <option value="">— Anonymous —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {currentUser && <Avatar name={currentUser.name} color={currentUser.avatar_color} />}
          </div>
        </div>

        {/* Member list */}
        <div className="member-list">
          {users.length === 0 && <div className="card-empty">No team members yet.</div>}
          {users.map(u => (
            <div key={u.id} className={`member-row${currentUser?.id === u.id ? ' member-active' : ''}`}>
              <Avatar name={u.name} color={u.avatar_color} />
              <div className="member-info">
                <div className="member-name">{u.name}</div>
                <div className="member-meta">
                  <span className="member-role">{u.role}</span>
                  {u.email && <span className="member-email">{u.email}</span>}
                </div>
              </div>
              <button
                className="delete-btn"
                style={{ opacity: 1 }}
                onClick={() => onDelete(u.id)}
                title="Remove member"
              >&times;</button>
            </div>
          ))}
        </div>

        {/* Add member form */}
        <div className="add-member-form">
          <div className="section-label" style={{ marginBottom: 10 }}>Add Member</div>
          <form onSubmit={submit}>
            <div className="form-row">
              <div className="form-field">
                <label>Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" required />
              </div>
              <div className="form-field">
                <label>Role</label>
                <select value={role} onChange={e => setRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="lead">Lead</option>
                  <option value="manager">Manager</option>
                  <option value="designer">Designer</option>
                  <option value="developer">Developer</option>
                </select>
              </div>
            </div>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" type="email" />
            <label>Avatar Color</label>
            <div className="color-picker">
              {AVATAR_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch${colorIdx === i ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColorIdx(i)}
                />
              ))}
              <Avatar name={name || '?'} color={AVATAR_COLORS[colorIdx]} size={30} />
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn-primary">Add Member</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [view, setView] = useState('board'); // 'board' | 'dashboard' | 'admin'
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [teamOpen, setTeamOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => r.ok ? r.json() : []),
      fetch('/api/users').then(r => r.ok ? r.json() : []),
    ]).then(([projectsData, usersData]) => {
      setProjects(projectsData);
      setUsers(usersData);
      if (projectsData.length > 0) setSelectedProject(projectsData[0]);
    }).catch(err => console.error('Failed to load initial data:', err));
  }, []);

  const addProject = async (name) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { console.error('Failed to create project'); return; }
    const project = await res.json();
    setProjects(prev => [project, ...prev]);
    setSelectedProject(project);
    setView('board');
  };

  const deleteProject = async (id) => {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) { console.error('Failed to delete project'); return; }
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProject?.id === id) {
      setSelectedProject(projects.find(p => p.id !== id) || null);
    }
  };

  const addUser = async (data) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { console.error('Failed to create user'); return; }
    const user = await res.json();
    setUsers(prev => [...prev, user]);
  };

  const deleteUser = async (id) => {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) { console.error('Failed to delete user'); return; }
    setUsers(prev => prev.filter(u => u.id !== id));
    if (currentUser?.id === id) setCurrentUser(null);
  };

  const updateUser = async (id, data) => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { console.error('Failed to update user'); return; }
    const updated = await res.json();
    setUsers(prev => prev.map(u => u.id === id ? updated : u));
    if (currentUser?.id === id) setCurrentUser(updated);
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
          <button
            className={`nav-btn${view === 'admin' ? ' active' : ''}`}
            onClick={() => setView('admin')}
          >
            Admin
          </button>
        </nav>
        <div className="header-right">
          <button className="team-btn" onClick={() => setTeamOpen(true)}>
            <div className="avatar-stack">
              {users.slice(0, 3).map(u => (
                <Avatar key={u.id} name={u.name} color={u.avatar_color} size={26} />
              ))}
            </div>
            <span className="team-label">
              {currentUser ? currentUser.name : 'Team'} ({users.length})
            </span>
          </button>
        </div>
      </header>

      <div className="app-body">
        <ProjectList
          projects={projects}
          selectedProject={selectedProject}
          onSelect={handleSelectProject}
          onAdd={addProject}
          onDelete={deleteProject}
        />
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
        </main>
      </div>

      {teamOpen && (
        <TeamPanel
          users={users}
          onAdd={addUser}
          onDelete={deleteUser}
          currentUser={currentUser}
          onSetCurrentUser={setCurrentUser}
          onClose={() => setTeamOpen(false)}
        />
      )}
    </div>
  );
}
