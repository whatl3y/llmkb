import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import UnifiedView from './components/UnifiedView';
import WikiPage from './components/WikiPage';
import FileExplorer from './components/FileExplorer';
import LoginPage from './components/LoginPage';
import { IngestProvider } from './contexts/IngestContext';
import { AuthProvider } from './contexts/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <IngestProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<UnifiedView />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="sources" element={<FileExplorer />} />
            <Route path="browse/:type/:slug" element={<WikiPage />} />
          </Route>
        </Routes>
      </IngestProvider>
    </AuthProvider>
  );
}
