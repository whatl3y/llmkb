import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { queryWiki } from '../api';

export default function QueryView() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{
    answer: string;
    citations: Array<{ page: string; excerpt: string }>;
    slug: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError('');
    setAnswer(null);
    try {
      const result = await queryWiki(question.trim());
      setAnswer(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Convert [[wikilinks]] for rendering
  const processAnswer = (text: string) =>
    text.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target, display) => `[${display || target}](/browse/concepts/${target})`
    );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Query</h1>
      <p className="text-gray-500 text-sm mb-6">
        Ask a question and get an AI-synthesized answer from your wiki content.
      </p>

      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What would you like to know? e.g., 'How do I add streaming support to my LLM integration?'"
          rows={3}
          className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-3 bg-emerald-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Researching...' : 'Ask Question'}
        </button>
      </form>

      {loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
          Searching wiki and synthesizing an answer... This may take a moment.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {answer && (
        <div>
          <div className="bg-white border rounded-lg p-6 wiki-content">
            <ReactMarkdown>{processAnswer(answer.answer)}</ReactMarkdown>
          </div>

          {answer.citations.length > 0 && (
            <div className="mt-4 bg-gray-50 border rounded-lg p-4">
              <h3 className="font-medium text-sm mb-2">Citations</h3>
              <ul className="space-y-2">
                {answer.citations.map((c, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-mono text-blue-600">{c.page}</span>
                    <span className="text-gray-400 mx-2">-</span>
                    <span className="text-gray-600 italic">{c.excerpt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-3">
            Answer saved to wiki/outputs/{answer.slug}.md
          </p>
        </div>
      )}
    </div>
  );
}
