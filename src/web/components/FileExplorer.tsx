import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getPages } from '../api';
import { formatDate } from '../formatDate';

interface Page {
  slug: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  date_modified: string;
}

const TYPE_ORDER = ['sources', 'concepts', 'entities', 'syntheses', 'outputs'];

const TYPE_LABELS: Record<string, string> = {
  sources: 'Sources',
  concepts: 'Concepts',
  entities: 'Entities',
  syntheses: 'Syntheses',
  outputs: 'Outputs',
};

export default function FileExplorer() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ entities: true, outputs: true });

  useEffect(() => {
    getPages()
      .then(setPages)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const grouped = new Map<string, Page[]>();
  for (const page of pages) {
    const list = grouped.get(page.type) ?? [];
    list.push(page);
    grouped.set(page.type, list);
  }

  const toggle = (type: string) => {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  if (loading) return <p className="text-gray-400 dark:text-gray-500 text-sm">Loading...</p>;

  if (error) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Files</h1>
        <span className="text-xs text-gray-400 dark:text-gray-500">{pages.length} pages</span>
      </div>

      {pages.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No pages yet. <Link to="/" className="text-gray-500 dark:text-gray-400 underline">Add some sources</Link> to get started.
        </p>
      ) : (
        <div className="space-y-1">
          {TYPE_ORDER.filter((t) => grouped.has(t)).map((type) => {
            const typePages = grouped.get(type)!;
            const isCollapsed = collapsed[type];
            return (
              <div key={type}>
                <button
                  onClick={() => toggle(type)}
                  className="w-full flex items-center gap-2 py-2 text-left text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  <span className="text-xs font-mono w-4 text-gray-300 dark:text-gray-600">{isCollapsed ? '+' : '-'}</span>
                  <span className="font-medium">{TYPE_LABELS[type] || type}</span>
                  <span className="text-xs text-gray-300 dark:text-gray-600">{typePages.length}</span>
                </button>
                {!isCollapsed && (
                  <ul className="ml-6 border-l border-gray-100 dark:border-gray-800">
                    {typePages.map((page) => (
                      <li key={`${page.type}-${page.slug}`}>
                        <Link
                          to={`/browse/${page.type}/${page.slug}`}
                          className="flex items-baseline gap-2 py-1.5 pl-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-r"
                        >
                          <span className="text-gray-700 dark:text-gray-300 truncate">{page.title}</span>
                          {page.date_modified && (
                            <span className="text-xs text-gray-300 dark:text-gray-600 flex-shrink-0">{formatDate(page.date_modified)}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
