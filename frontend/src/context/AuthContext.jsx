import { createContext, useContext, useState, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const csrfTokenRef = useRef(null);

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    setCurrentUser(data.user);
    setAccessToken(data.accessToken);
    csrfTokenRef.current = data.csrfToken;
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfTokenRef.current, 'Authorization': `Bearer ${accessToken}` },
        credentials: 'include'
      });
    } finally {
      setCurrentUser(null);
      setAccessToken(null);
      csrfTokenRef.current = null;
    }
  }, [accessToken]);

  const refresh = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) { setCurrentUser(null); setAccessToken(null); throw new Error('Session expired'); }
    const data = await res.json();
    setAccessToken(data.accessToken);
    csrfTokenRef.current = data.csrfToken;
    return data.accessToken;
  }, []);

  const authFetch = useCallback(async (url, options = {}) => {
    const doFetch = (token) => fetch(`${API_BASE}${url}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'X-CSRF-Token': csrfTokenRef.current
      }
    });

    let res = await doFetch(accessToken);
    if (res.status === 401) {
      try {
        const newToken = await refresh();
        res = await doFetch(newToken);
      } catch {
        setCurrentUser(null);
        setAccessToken(null);
        return res;
      }
    }
    return res;
  }, [accessToken, refresh]);

  return (
    <AuthContext.Provider value={{ currentUser, accessToken, login, logout, refresh, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
