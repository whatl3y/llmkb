import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import UnifiedView from './components/UnifiedView';
import WikiPage from './components/WikiPage';
import FileExplorer from './components/FileExplorer';
import LoginPage from './components/LoginPage';
import { IngestProvider } from './contexts/IngestContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';

function RequireReadAuth({ children }: { children: ReactNode }) {
  const { authReadEnabled, user, loading } = useAuth();
  if (loading) return null;
  if (authReadEnabled && !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <IngestProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<RequireReadAuth><UnifiedView /></RequireReadAuth>} />
            <Route path="login" element={<LoginPage />} />
            <Route path="sources" element={<RequireReadAuth><FileExplorer /></RequireReadAuth>} />
            <Route path="browse/:type/:slug" element={<RequireReadAuth><WikiPage /></RequireReadAuth>} />
          </Route>
        </Routes>
      </IngestProvider>
    </AuthProvider>
  );
}
