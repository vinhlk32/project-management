import React, { useState } from 'react';

export default function ProjectList({ projects, selectedProject, onSelect, onAdd, onDelete }) {
  const [newName, setNewName] = useState('');

  const handleAdd = (e) => {
    e.preventDefault();
    if (newName.trim()) {
      onAdd(newName.trim());
      setNewName('');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Projects</h2>
      </div>
      <form className="add-form" onSubmit={handleAdd}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New project..."
        />
        <button type="submit">+</button>
      </form>
      <ul className="project-list">
        {projects.map(p => (
          <li
            key={p.id}
            className={`project-item ${selectedProject?.id === p.id ? 'active' : ''}`}
            onClick={() => onSelect(p)}
          >
            <span className="project-name">{p.name}</span>
            <button
              className="delete-btn"
              onClick={e => { e.stopPropagation(); onDelete(p.id); }}
              title="Delete project"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
