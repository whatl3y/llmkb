import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { getConfig, logout as apiLogout } from '../api';

interface AuthUser {
  email: string;
  name: string;
}

interface AuthContextValue {
  authEnabled: boolean;
  user: AuthUser | null;
  loading: boolean;
  canIngest: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  authEnabled: false,
  user: null,
  loading: true,
  canIngest: true,
  login: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setAuthEnabled(cfg.authEnabled ?? false);
        setUser(cfg.user ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const canIngest = !authEnabled || user !== null;

  const login = useCallback(() => {
    window.location.href = '/auth/login/google';
  }, []);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ authEnabled, user, loading, canIngest, login, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
