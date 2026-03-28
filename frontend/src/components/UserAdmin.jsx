import React, { useState } from 'react';

const AVATAR_COLORS = [
  '#4a9eff', '#8b5cf6', '#ec4899', '#06b6d4',
  '#22c55e', '#f97316', '#f59e0b', '#ef4444',
];

const ROLES = ['member', 'admin', 'lead', 'manager', 'designer', 'developer'];

const ROLE_COLORS = {
  admin:     { bg: '#fef3c7', color: '#d97706' },
  lead:      { bg: '#ede9fe', color: '#7c3aed' },
  manager:   { bg: '#dbeafe', color: '#1d4ed8' },
  designer:  { bg: '#fce7f3', color: '#be185d' },
  developer: { bg: '#d1fae5', color: '#065f46' },
  member:    { bg: '#f1f5f9', color: '#475569' },
};

function Avatar({ name, color, size = 36 }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  return (
    <div
      className="avatar"
      style={{ background: color || '#4a9eff', width: size, height: size, fontSize: size * 0.38, flexShrink: 0 }}
      title={name}
    >
      {initials}
    </div>
  );
}

function RoleBadge({ role }) {
  const s = ROLE_COLORS[role] || ROLE_COLORS.member;
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 700, borderRadius: 4,
      padding: '2px 8px', textTransform: 'capitalize', letterSpacing: '0.04em',
    }}>
      {role}
    </span>
  );
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Edit Modal ──────────────────────────────────────────────────────────── */
function EditModal({ user, onSave, onClose }) {
  const [name,  setName]  = useState(user.name);
  const [email, setEmail] = useState(user.email || '');
  const [role,  setRole]  = useState(user.role || 'member');
  const [colorIdx, setColorIdx] = useState(
    AVATAR_COLORS.indexOf(user.avatar_color) >= 0
      ? AVATAR_COLORS.indexOf(user.avatar_color)
      : 0
  );

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), email: email.trim(), role, avatar_color: AVATAR_COLORS[colorIdx] });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Member</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="form-field">
              <label>Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" required />
            </div>
            <div className="form-field">
              <label>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <label>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" type="email" />
          <label>Avatar Color</label>
          <div className="color-picker" style={{ marginTop: 6 }}>
            {AVATAR_COLORS.map((c, i) => (
              <button
                key={c} type="button"
                className={`color-swatch${colorIdx === i ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColorIdx(i)}
              />
            ))}
            <Avatar name={name || '?'} color={AVATAR_COLORS[colorIdx]} size={30} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function UserAdmin({ users, onAdd, onUpdate, onDelete }) {
  const [search,     setSearch]     = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [editUser,   setEditUser]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  // Add form state
  const [newName,     setNewName]     = useState('');
  const [newEmail,    setNewEmail]    = useState('');
  const [newRole,     setNewRole]     = useState('member');
  const [newColorIdx, setNewColorIdx] = useState(0);
  const [addError,    setAddError]    = useState('');

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    if (q && !u.name.toLowerCase().includes(q) && !(u.email || '').toLowerCase().includes(q)) return false;
    if (filterRole && u.role !== filterRole) return false;
    return true;
  });

  const handleAdd = (e) => {
    e.preventDefault();
    setAddError('');
    if (!newName.trim()) { setAddError('Name is required'); return; }
    onAdd({ name: newName.trim(), email: newEmail.trim(), role: newRole, avatar_color: AVATAR_COLORS[newColorIdx] });
    setNewName(''); setNewEmail(''); setNewRole('member');
    setNewColorIdx(c => (c + 1) % AVATAR_COLORS.length);
  };

  const handleSaveEdit = (data) => {
    onUpdate(editUser.id, data);
    setEditUser(null);
  };

  const handleConfirmDelete = () => {
    onDelete(confirmDel.id);
    setConfirmDel(null);
  };

  // Stats
  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r] = users.filter(u => u.role === r).length;
    return acc;
  }, {});

  return (
    <div className="user-admin">

      {/* ── Header ── */}
      <div className="ua-header">
        <div>
          <h2 className="ua-title">User Administration</h2>
          <p className="ua-subtitle">{users.length} team member{users.length !== 1 ? 's' : ''} total</p>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="ua-stats">
        {ROLES.filter(r => roleCounts[r] > 0).map(r => {
          const s = ROLE_COLORS[r];
          return (
            <div key={r} className="ua-stat-chip" style={{ background: s.bg, color: s.color }}>
              <span className="ua-stat-count">{roleCounts[r]}</span>
              <span className="ua-stat-label">{r}</span>
            </div>
          );
        })}
        {users.length === 0 && <span style={{ color: '#8892a4', fontSize: 13 }}>No members yet</span>}
      </div>

      <div className="ua-body">

        {/* ── Left: Add User Form ── */}
        <div className="ua-form-panel">
          <div className="ua-panel-title">Add New Member</div>
          <form onSubmit={handleAdd} className="ua-add-form">
            <div className="ua-field">
              <label>Name *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="ua-field">
              <label>Email</label>
              <input
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
              />
            </div>
            <div className="ua-field">
              <label>Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div className="ua-field">
              <label>Avatar Color</label>
              <div className="color-picker" style={{ marginTop: 6 }}>
                {AVATAR_COLORS.map((c, i) => (
                  <button
                    key={c} type="button"
                    className={`color-swatch${newColorIdx === i ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setNewColorIdx(i)}
                  />
                ))}
                <Avatar name={newName || '?'} color={AVATAR_COLORS[newColorIdx]} size={28} />
              </div>
            </div>
            {addError && <div className="ua-error">{addError}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }}>
              + Add Member
            </button>
          </form>
        </div>

        {/* ── Right: User Table ── */}
        <div className="ua-table-panel">
          {/* Search & Filter */}
          <div className="ua-toolbar">
            <div className="search-wrap">
              <span className="search-icon">⌕</span>
              <input
                className="search-input"
                placeholder="Search by name or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: 220 }}
              />
              {search && <button className="search-clear" onClick={() => setSearch('')}>&times;</button>}
            </div>
            <select
              className="filter-select"
              value={filterRole}
              onChange={e => setFilterRole(e.target.value)}
            >
              <option value="">All Roles</option>
              {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            {(search || filterRole) && (
              <button className="btn-secondary filter-clear" onClick={() => { setSearch(''); setFilterRole(''); }}>
                Clear
              </button>
            )}
            <span className="filter-count">{filtered.length} / {users.length}</span>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="ua-empty">
              {users.length === 0 ? 'No team members yet. Add one →' : 'No members match your search.'}
            </div>
          ) : (
            <div className="ua-table-wrap">
              <table className="ua-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className="ua-row">
                      <td>
                        <div className="ua-member-cell">
                          <Avatar name={u.name} color={u.avatar_color} size={34} />
                          <span className="ua-member-name">{u.name}</span>
                        </div>
                      </td>
                      <td className="ua-email">{u.email || <span style={{ color: '#c0c9d6' }}>—</span>}</td>
                      <td><RoleBadge role={u.role} /></td>
                      <td className="ua-date">{formatDate(u.created_at)}</td>
                      <td>
                        <div className="ua-actions">
                          <button
                            className="ua-edit-btn"
                            onClick={() => setEditUser(u)}
                            title="Edit member"
                          >✏️</button>
                          <button
                            className="ua-del-btn"
                            onClick={() => setConfirmDel(u)}
                            title="Remove member"
                          >&times;</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editUser && (
        <EditModal user={editUser} onSave={handleSaveEdit} onClose={() => setEditUser(null)} />
      )}

      {/* ── Delete Confirmation ── */}
      {confirmDel && (
        <div className="modal-overlay" onClick={() => setConfirmDel(null)}>
          <div className="modal" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Remove Member</h3>
              <button className="close-btn" onClick={() => setConfirmDel(null)}>&times;</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <Avatar name={confirmDel.name} color={confirmDel.avatar_color} size={40} />
              <div>
                <div style={{ fontWeight: 600 }}>{confirmDel.name}</div>
                <div style={{ fontSize: 13, color: '#6b7a8d' }}>{confirmDel.email || confirmDel.role}</div>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#4a5568', marginBottom: 20 }}>
              Are you sure you want to remove <strong>{confirmDel.name}</strong> from the team?
              Any tasks assigned to them will become unassigned.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ background: '#ef4444' }}
                onClick={handleConfirmDelete}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
