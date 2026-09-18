import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/auth/me')
        .then((res) => setUser(res.data))
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const register = async (name, email, password, organizationName) => {
    const res = await api.post('/auth/register', { name, email, password, organizationName });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const acceptInvite = async (token, name, password) => {
    const res = await api.post('/auth/accept-invite', { token, name, password });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const switchOrganization = async (organizationId) => {
    const res = await api.post('/auth/switch-organization', { organizationId });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const forgotPassword = async (email) => {
    const res = await api.post('/auth/forgot-password', { email });
    return res.data;
  };

  const resetPassword = async (token, password) => {
    const res = await api.post('/auth/reset-password', { token, password });
    if (res.data.token) {
      localStorage.setItem('token', res.data.token);
      setUser(res.data.user);
    }
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  // Re-reads /auth/me without touching the token — used after onboarding
  // completes so the owner's onboardingStatus flips to 'completed' and the
  // ProtectedRoute redirect stops firing, without forcing a re-login.
  const refreshUser = async () => {
    const res = await api.get('/auth/me');
    setUser(res.data);
    return res.data;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, acceptInvite, switchOrganization, forgotPassword, resetPassword, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
