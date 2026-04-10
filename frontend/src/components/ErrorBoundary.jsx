import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || 'Unexpected error' };
  }

  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: '12px',
          color: '#ef4444', fontFamily: 'sans-serif',
        }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px', borderRadius: '6px', border: 'none',
              background: '#4a9eff', color: '#fff', cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
