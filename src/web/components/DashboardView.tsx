import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getStats } from '../api';
import { formatDate } from '../formatDate';

interface Stats {
  totalPages: number;
  concepts: number;
  entities: number;
  sources: number;
  syntheses: number;
  outputs: number;
  recentActivity: Array<{
    date: string;
    operation: string;
    title: string;
    details: string[];
  }>;
}

/** Extract type/slug from a detail line like "Created: wiki/sources/foo.md" */
function parseWikiPath(detail: string): { prefix: string; type: string; slug: string } | null {
  const match = detail.match(/^(Created|Created\/Updated|Filed):\s*wiki\/(\w+)\/(.+)\.md$/);
  if (!match) return null;
  return { prefix: match[1], type: match[2], slug: match[3] };
}

/** Determine the primary page link for an activity entry's title */
function getTitleLink(operation: string, details: string[]): { type: string; slug: string } | null {
  if (operation === 'ingest') {
    for (const d of details) {
      const match = d.match(/^Created:\s*wiki\/(\w+)\/(.+)\.md$/);
      if (match) return { type: match[1], slug: match[2] };
    }
  } else if (operation === 'query') {
    for (const d of details) {
      const match = d.match(/^Filed:\s*wiki\/(\w+)\/(.+)\.md$/);
      if (match) return { type: match[1], slug: match[2] };
    }
  }
  return null;
}

export default function DashboardView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-medium">Could not load wiki stats</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return <p className="text-gray-500">Loading...</p>;
  }

  const cards = [
    { label: 'Total Pages', value: stats.totalPages, color: 'bg-blue-500' },
    { label: 'Concepts', value: stats.concepts, color: 'bg-emerald-500' },
    { label: 'Entities', value: stats.entities, color: 'bg-purple-500' },
    { label: 'Sources', value: stats.sources, color: 'bg-amber-500' },
    { label: 'Outputs', value: stats.outputs, color: 'bg-rose-500' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {cards.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border p-4">
            <div className={`w-2 h-2 rounded-full ${color} mb-2`} />
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Quick action */}
      <div className="mb-8">
        <Link
          to="/ask"
          className="block bg-blue-50 border border-blue-200 rounded-lg p-4 hover:bg-blue-100 transition-colors"
        >
          <p className="font-medium text-blue-800">&gt; Ask, Search, Browse, or Ingest</p>
          <p className="text-sm text-blue-600 mt-1">Do everything from one place — ask questions, search, browse pages, or add sources</p>
        </Link>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Recent Activity</h2>
        </div>
        {stats.recentActivity.length === 0 ? (
          <p className="p-4 text-gray-500 text-sm">
            No activity yet. Start by <Link to="/ask" className="text-blue-600 underline">adding a source</Link>.
          </p>
        ) : (
          <ul className="divide-y">
            {stats.recentActivity.map((entry, i) => {
              const titleLink = getTitleLink(entry.operation, entry.details);
              return (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400 w-24">{formatDate(entry.date)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                      entry.operation === 'ingest' ? 'bg-blue-100 text-blue-700' :
                      entry.operation === 'query' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>{entry.operation}</span>
                    {titleLink ? (
                      <Link
                        to={`/browse/${titleLink.type}/${titleLink.slug}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate"
                      >
                        {entry.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium truncate">{entry.title}</span>
                    )}
                  </div>
                  {entry.details.length > 0 && (
                    <ul className="mt-1 ml-24 text-xs text-gray-500 space-y-0.5">
                      {entry.details.slice(0, 3).map((d, j) => {
                        const parsed = parseWikiPath(d);
                        if (parsed) {
                          return (
                            <li key={j}>
                              {parsed.prefix}:{' '}
                              <Link
                                to={`/browse/${parsed.type}/${parsed.slug}`}
                                className="text-blue-500 hover:text-blue-700 hover:underline"
                              >
                                {parsed.type}/{parsed.slug}
                              </Link>
                            </li>
                          );
                        }
                        return <li key={j}>{d}</li>;
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
