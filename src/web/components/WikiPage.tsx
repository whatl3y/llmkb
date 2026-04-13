import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getPage, getDownloadUrl } from '../api';
import { useWikilinks } from '../hooks/useWikilinks';
import { formatDate } from '../formatDate';

export default function WikiPage() {
  const processWikilinks = useWikilinks();
  const { type, slug } = useParams<{ type: string; slug: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<{
    slug: string;
    type: string;
    frontmatter: Record<string, unknown>;
    content: string;
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!type || !slug) return;
    setPage(null);
    setError('');
    getPage(type, slug).then(setPage).catch((e) => setError(e.message));
  }, [type, slug]);

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-700 dark:text-red-300 font-medium">Page not found</p>
        <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
        <button onClick={() => navigate(-1)} className="text-sm text-blue-600 dark:text-blue-400 underline mt-2">
          Go back
        </button>
      </div>
    );
  }

  if (!page) {
    return <p className="text-gray-500 dark:text-gray-400">Loading...</p>;
  }

  const fm = page.frontmatter as Record<string, string | string[]>;

  // Convert [[wikilinks]] to clickable links for rendering
  const processedContent = processWikilinks(page.content);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 mb-4">
        <Link to="/sources" className="hover:text-gray-600 dark:hover:text-gray-300">{type}</Link>
        <span>/</span>
        <span className="text-gray-700 dark:text-gray-300">{slug}</span>
      </div>

      {/* Frontmatter metadata */}
      {fm && Object.keys(fm).length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-700 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {fm.status && (
              <div>
                <span className="text-gray-400 dark:text-gray-500 text-xs uppercase">Status</span>
                <p className="font-medium capitalize">{String(fm.status)}</p>
              </div>
            )}
            {fm.type && (
              <div>
                <span className="text-gray-400 dark:text-gray-500 text-xs uppercase">Type</span>
                <p className="font-medium capitalize">{String(fm.type)}</p>
              </div>
            )}
            {fm.date_created && (
              <div>
                <span className="text-gray-400 dark:text-gray-500 text-xs uppercase">Created</span>
                <p className="font-medium">{formatDate(String(fm.date_created))}</p>
              </div>
            )}
            {fm.date_modified && (
              <div>
                <span className="text-gray-400 dark:text-gray-500 text-xs uppercase">Modified</span>
                <p className="font-medium">{formatDate(String(fm.date_modified))}</p>
              </div>
            )}
          </div>
          {fm.tags && Array.isArray(fm.tags) && fm.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3">
              {(fm.tags as string[]).map((tag) => (
                <span key={tag} className="text-xs bg-white dark:bg-gray-700 border dark:border-gray-600 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {(fm.source_url || fm.source_file) && (
            <div className="mt-3 flex items-center gap-4">
              {fm.source_url && (
                <a
                  href={String(fm.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 underline"
                >
                  Original source
                </a>
              )}
              {fm.source_file && (
                <a
                  href={getDownloadUrl(String(fm.source_file))}
                  download
                  className="text-sm text-blue-600 dark:text-blue-400 underline inline-flex items-center gap-1"
                >
                  Download original file
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Page content */}
      <div className="wiki-content bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-6">
        <ReactMarkdown>{processedContent}</ReactMarkdown>
      </div>
    </div>
  );
}
