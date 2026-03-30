import React, { useState, useEffect } from 'react';

export default function UserList() {
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', email: '', role: 'user' });
  const [editingUser, setEditingUser] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const res = await fetch('/api/users');
    const data = await res.json();
    setUsers(data);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.email.trim()) return;
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    });
    if (res.ok) {
      const user = await res.json();
      setUsers(prev => [user, ...prev]);
      setNewUser({ username: '', email: '', role: 'user' });
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editingUser.username.trim() || !editingUser.email.trim()) return;
    const res = await fetch(`/api/users/${editingUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingUser),
    });
    if (res.ok) {
      const updatedUser = await res.json();
      setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
      setEditingUser(null);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <div className="user-admin">
      <h2>User Administration</h2>

      <form className="add-form" onSubmit={editingUser ? handleEdit : handleAdd}>
        <input
          value={editingUser ? editingUser.username : newUser.username}
          onChange={e => editingUser
            ? setEditingUser({ ...editingUser, username: e.target.value })
            : setNewUser({ ...newUser, username: e.target.value })
          }
          placeholder="Username"
          required
        />
        <input
          type="email"
          value={editingUser ? editingUser.email : newUser.email}
          onChange={e => editingUser
            ? setEditingUser({ ...editingUser, email: e.target.value })
            : setNewUser({ ...newUser, email: e.target.value })
          }
          placeholder="Email"
          required
        />
        <select
          value={editingUser ? editingUser.role : newUser.role}
          onChange={e => editingUser
            ? setEditingUser({ ...editingUser, role: e.target.value })
            : setNewUser({ ...newUser, role: e.target.value })
          }
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">{editingUser ? 'Update' : 'Add'} User</button>
        {editingUser && <button type="button" onClick={() => setEditingUser(null)}>Cancel</button>}
      </form>

      <ul className="user-list">
        {users.map(user => (
          <li key={user.id} className="user-item">
            <div className="user-info">
              <strong>{user.username}</strong> ({user.email}) - {user.role}
            </div>
            <div className="user-actions">
              <button onClick={() => setEditingUser(user)}>Edit</button>
              <button onClick={() => handleDelete(user.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}