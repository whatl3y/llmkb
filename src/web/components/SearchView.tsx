import { useState } from 'react';
import { Link } from 'react-router-dom';
import { search } from '../api';

interface SearchResult {
  page: string;
  slug: string;
  excerpt: string;
  score: number;
}

export default function SearchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    try {
      const data = await search(query.trim());
      setResults(data);
      setSearched(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  function guessType(pagePath: string): string {
    if (pagePath.includes('concepts')) return 'concepts';
    if (pagePath.includes('entities')) return 'entities';
    if (pagePath.includes('sources')) return 'sources';
    if (pagePath.includes('syntheses')) return 'syntheses';
    if (pagePath.includes('outputs')) return 'outputs';
    return 'concepts';
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Search</h1>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across your wiki..."
            className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700 text-sm">{error}</div>
      )}

      {searched && results.length === 0 && (
        <p className="text-gray-500 text-sm">No results found for &quot;{query}&quot;</p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 mb-3">{results.length} results</p>
          {results.map((result) => (
            <Link
              key={result.slug}
              to={`/browse/${guessType(result.page)}/${result.slug}`}
              className="block bg-white border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900">{result.slug}</h3>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{result.excerpt}</p>
                  <p className="text-xs text-gray-400 mt-1">{result.page}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
