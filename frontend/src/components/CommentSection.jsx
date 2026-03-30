import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

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

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function CommentSection({ taskId, users, currentUser: currentUserProp }) {
  const { authFetch, currentUser: authCurrentUser } = useAuth();
  const currentUser = currentUserProp || authCurrentUser;
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!taskId) return;
    authFetch(`/api/tasks/${taskId}/comments`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setComments)
      .catch(err => console.error('Failed to load comments:', err));
  }, [taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    const res = await authFetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: currentUser?.id || null,
        author_name: currentUser?.name || 'Anonymous',
        content: text.trim(),
      }),
    });
    if (res.ok) {
      const comment = await res.json();
      setComments(prev => [...prev, comment]);
      setText('');
    }
    setSubmitting(false);
  };

  const deleteComment = async (id) => {
    const res = await authFetch(`/api/comments/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setComments(prev => prev.filter(c => c.id !== id));
    } else {
      console.error('Failed to delete comment');
    }
  };

  return (
    <div className="comment-section">
      <div className="comment-list">
        {comments.length === 0 && (
          <div className="comment-empty">No comments yet. Be the first!</div>
        )}
        {comments.map(c => {
          const name = c.user_name || c.author_name || 'Anonymous';
          const color = c.user_color || '#8892a4';
          const isOwn = currentUser && c.user_id === currentUser.id;
          return (
            <div key={c.id} className="comment-item">
              <Avatar name={name} color={color} size={28} />
              <div className="comment-body">
                <div className="comment-header">
                  <span className="comment-author">{name}</span>
                  <span className="comment-time">{formatTime(c.created_at)}</span>
                  {(isOwn || !currentUser) && (
                    <button
                      className="comment-delete"
                      onClick={() => deleteComment(c.id)}
                      title="Delete comment"
                    >&times;</button>
                  )}
                </div>
                <div className="comment-content">{c.content}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="comment-form" onSubmit={submit}>
        {currentUser && (
          <Avatar name={currentUser.name} color={currentUser.avatar_color} size={28} />
        )}
        <div className="comment-input-wrap">
          <textarea
            className="comment-input"
            placeholder={currentUser ? `Comment as ${currentUser.name}…` : 'Add a comment…'}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <button type="submit" className="btn-primary comment-submit" disabled={!text.trim() || submitting}>
            Post
          </button>
        </div>
      </form>
    </div>
  );
}
