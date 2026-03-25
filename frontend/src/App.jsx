import React, { useState, useEffect } from 'react';
import ProjectList from './components/ProjectList';
import TaskList from './components/TaskList';

export default function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => {
        setProjects(data);
        if (data.length > 0) setSelectedProject(data[0]);
      });
  }, []);

  const addProject = async (name) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const project = await res.json();
    setProjects(prev => [project, ...prev]);
    setSelectedProject(project);
  };

  const deleteProject = async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProject?.id === id) {
      setSelectedProject(projects.find(p => p.id !== id) || null);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Project Manager</h1>
      </header>
      <div className="app-body">
        <ProjectList
          projects={projects}
          selectedProject={selectedProject}
          onSelect={setSelectedProject}
          onAdd={addProject}
          onDelete={deleteProject}
        />
        <main className="main-content">
          {selectedProject
            ? <TaskList project={selectedProject} />
            : <div className="empty-state">Select or create a project to get started.</div>
          }
        </main>
      </div>
    </div>
  );
}
