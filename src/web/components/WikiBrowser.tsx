import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getPages } from '../api';

interface Page {
  slug: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  date_modified: string;
}

const TYPE_LABELS: Record<string, string> = {
  concepts: 'Concepts',
  entities: 'Entities',
  sources: 'Sources',
  syntheses: 'Syntheses',
  outputs: 'Outputs',
};

const TYPE_COLORS: Record<string, string> = {
  concepts: 'bg-emerald-100 text-emerald-700',
  entities: 'bg-purple-100 text-purple-700',
  sources: 'bg-amber-100 text-amber-700',
  syntheses: 'bg-blue-100 text-blue-700',
  outputs: 'bg-rose-100 text-rose-700',
};

export default function WikiBrowser() {
  const [pages, setPages] = useState<Page[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    getPages().then(setPages).catch((e) => setError(e.message));
  }, []);

  const filtered = filter === 'all' ? pages : pages.filter((p) => p.type === filter);
  const grouped = new Map<string, Page[]>();
  for (const page of filtered) {
    const list = grouped.get(page.type) ?? [];
    list.push(page);
    grouped.set(page.type, list);
  }

  if (error) {
    return <div className="text-red-600">{error}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Browse Wiki</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 text-sm rounded-full ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            All ({pages.length})
          </button>
          {Object.entries(TYPE_LABELS).map(([key, label]) => {
            const count = pages.filter((p) => p.type === key).length;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1 text-sm rounded-full ${filter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
          <p className="text-lg mb-2">No wiki pages yet</p>
          <p className="text-sm">
            <Link to="/ingest" className="text-blue-600 underline">Ingest a source</Link> to get started.
          </p>
        </div>
      ) : (
        [...grouped.entries()].map(([type, typePages]) => (
          <div key={type} className="mb-8">
            <h2 className="text-lg font-semibold mb-3">{TYPE_LABELS[type] || type}</h2>
            <div className="grid gap-3">
              {typePages.map((page) => (
                <Link
                  key={`${page.type}-${page.slug}`}
                  to={`/browse/${page.type}/${page.slug}`}
                  className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow block"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900">{page.title}</h3>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{page.summary}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${TYPE_COLORS[page.type] || 'bg-gray-100 text-gray-700'}`}>
                      {page.type}
                    </span>
                  </div>
                  {page.tags?.length > 0 && (
                    <div className="flex gap-1.5 mt-2">
                      {page.tags.slice(0, 5).map((tag) => (
                        <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
