import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  classifyIntent,
  getPages,
  getStats,
  getConfig,
  search,
  queryWikiStream,
  ingestUrl,
  ingestText,
} from '../api';
import { useIngest, type FileStatus } from '../contexts/IngestContext';
import { useAuth } from '../contexts/AuthContext';
import { getCached, setCached } from '../queryCache';
import { useWikilinks } from '../hooks/useWikilinks';

/* ── Result types ───────────────────────────────────────── */

interface BrowseResult {
  kind: 'browse';
  pages: Array<{ slug: string; type: string; title: string; summary: string; tags: string[]; date_modified: string }>;
  filter: string;
  topic: string;
}

interface SearchResult {
  kind: 'search';
  results: Array<{ page: string; slug: string; excerpt: string; score: number }>;
  query: string;
}

interface QueryResult {
  kind: 'query';
  answer: string;
  citations: Array<{ page: string; excerpt: string }>;
  slug: string;
}

interface IngestResult {
  kind: 'ingest';
  message: string;
}

type ResultState = BrowseResult | SearchResult | QueryResult | IngestResult;

/* ── Constants ──────────────────────────────────────────── */

const ACCEPTED_EXTENSIONS = '.pdf,.csv,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.txt,.md,.text';

const TYPE_LABELS: Record<string, string> = {
  concepts: 'Concepts',
  entities: 'Entities',
  sources: 'Sources',
  syntheses: 'Syntheses',
  outputs: 'Outputs',
};

const TYPE_COLORS: Record<string, string> = {
  concepts: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  entities: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  sources: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  syntheses: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  outputs: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

const STATUS_LABELS: Record<string, string> = {
  parsing: 'Parsing file...',
  llm: 'Analyzing with LLM...',
  writing: 'Writing wiki pages...',
  done: 'Complete',
  duplicate: 'Duplicate — skipped',
  error: 'Failed',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-200 dark:bg-gray-600',
  parsing: 'bg-blue-400 animate-pulse',
  llm: 'bg-amber-400 animate-pulse',
  writing: 'bg-blue-400 animate-pulse',
  done: 'bg-emerald-500',
  duplicate: 'bg-amber-500',
  error: 'bg-red-500',
};

const LOADING_MESSAGES: Record<string, string> = {
  classifying: 'Understanding your request...',
  browse: 'Loading pages...',
  search: 'Searching...',
  query: 'Searching wiki and synthesizing an answer... This may take a moment.',
  ingest_url: 'Fetching and analyzing URL... This may take 15-30 seconds.',
  ingest_text: 'Analyzing text content...',
};

/* ── Helpers ────────────────────────────────────────────── */

function guessType(pagePath: string): string {
  if (pagePath.includes('concepts')) return 'concepts';
  if (pagePath.includes('entities')) return 'entities';
  if (pagePath.includes('sources')) return 'sources';
  if (pagePath.includes('syntheses')) return 'syntheses';
  if (pagePath.includes('outputs')) return 'outputs';
  return 'concepts';
}

/* ── Component ──────────────────────────────────────────── */

export default function UnifiedView() {
  const processWikilinks = useWikilinks();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canIngest, authEnabled, user, login } = useAuth();

  // KB config
  const [kbName, setKbName] = useState('');

  // Stats
  const [stats, setStats] = useState<{ totalPages: number; concepts: number; entities: number; sources: number } | null>(null);

  // Initialize from URL + cache on mount
  const [input, setInput] = useState(() => searchParams.get('q') || '');
  const [phase, setPhase] = useState<'idle' | 'classifying' | 'executing'>('idle');
  const [executingIntent, setExecutingIntent] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultState | null>(() => {
    const q = searchParams.get('q');
    if (!q) return null;
    return (getCached(q)?.result as ResultState) ?? null;
  });
  const [browseFilter, setBrowseFilter] = useState(() => {
    const q = searchParams.get('q');
    if (!q) return 'all';
    return getCached(q)?.browseFilter ?? 'all';
  });

  // Streaming state
  const [streaming, setStreaming] = useState(false);

  // Track which query we set to avoid re-triggering on our own URL changes
  const activeQueryRef = useRef(searchParams.get('q') || '');

  // Load config + stats on mount
  useEffect(() => {
    getConfig().then((cfg) => setKbName(cfg.name)).catch(() => {});
    getStats().then((s) => setStats({ totalPages: s.totalPages, concepts: s.concepts, entities: s.entities, sources: s.sources })).catch(() => {});
  }, []);

  // Restore from cache on back/forward navigation
  useEffect(() => {
    const q = searchParams.get('q') || '';
    if (q === activeQueryRef.current) return;
    activeQueryRef.current = q;

    if (!q) {
      setInput('');
      setResult(null);
      setError('');
      return;
    }

    const cached = getCached(q);
    if (cached) {
      setInput(q);
      setResult(cached.result as ResultState);
      setBrowseFilter(cached.browseFilter);
      setError('');
    } else {
      setInput(q);
      setResult(null);
      setError('');
    }
  }, [searchParams]);

  // File upload state (persisted in context across navigation)
  const {
    files,
    fileStatuses,
    fileResult,
    uploadLoading,
    uploadSuccess,
    uploadError,
    addFiles,
    removeFile,
    startUpload,
  } = useIngest();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase !== 'idle' || streaming;
  const loadingMessage = phase === 'classifying'
    ? LOADING_MESSAGES.classifying
    : LOADING_MESSAGES[executingIntent] || 'Processing...';

  /* ── Text submission ──────────────────────────── */

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    // Check cache first — instant restore, no LLM call
    const cached = getCached(trimmed);
    if (cached) {
      setResult(cached.result as ResultState);
      setBrowseFilter(cached.browseFilter);
      setError('');
      activeQueryRef.current = trimmed;
      setSearchParams({ q: trimmed });
      return;
    }

    setPhase('classifying');
    setError('');
    setResult(null);

    try {
      const intent = await classifyIntent(trimmed);
      const isIngest = intent.intent === 'ingest_url' || intent.intent === 'ingest_text';

      // Push query to URL for non-ingest intents (enables back button)
      if (!isIngest) {
        activeQueryRef.current = trimmed;
        setSearchParams({ q: trimmed });
      }

      setExecutingIntent(intent.intent);
      setPhase('executing');

      switch (intent.intent) {
        case 'browse': {
          const type = (intent.params.type as string) || 'all';
          const topic = (intent.params.topic as string) || '';
          let pages = await getPages();

          if (topic) {
            const searchResults = await search(topic, 25);
            const matchingSlugs = new Set(searchResults.map((r) => r.slug));
            pages = pages.filter((p) => matchingSlugs.has(p.slug));
          }

          const browseResult: BrowseResult = { kind: 'browse', pages, filter: type, topic };
          setBrowseFilter(type);
          setResult(browseResult);
          setCached(trimmed, browseResult, type);
          break;
        }
        case 'search': {
          const query = (intent.params.query as string) || trimmed;
          const results = await search(query);
          const searchResult: SearchResult = { kind: 'search', results, query };
          setResult(searchResult);
          setCached(trimmed, searchResult);
          break;
        }
        case 'query':
        default: {
          const question = (intent.params.question as string) || trimmed;
          // Switch to streaming mode — phase goes idle, streaming flag takes over
          setResult({ kind: 'query', answer: '', citations: [], slug: '' });
          setPhase('idle');
          setExecutingIntent('');
          setStreaming(true);
          let fullAnswer = '';
          let finalSlug = '';
          try {
            await queryWikiStream(
              question,
              (chunk) => {
                fullAnswer += chunk;
                setResult((prev) => {
                  if (!prev || prev.kind !== 'query') return prev;
                  return { ...prev, answer: prev.answer + chunk };
                });
              },
              (meta) => {
                finalSlug = meta.slug;
                setResult((prev) => {
                  if (!prev || prev.kind !== 'query') return prev;
                  return { ...prev, slug: meta.slug };
                });
              }
            );
            // Stream complete — cache the final result
            setCached(trimmed, { kind: 'query', answer: fullAnswer, citations: [], slug: finalSlug });
          } catch (streamErr) {
            setError((streamErr as Error).message);
          } finally {
            setStreaming(false);
          }
          break;
        }
        case 'ingest_url': {
          if (!canIngest) {
            setError('Sign in to add content to this knowledge base.');
            break;
          }
          const url = (intent.params.url as string) || trimmed;
          await ingestUrl(url);
          setResult({ kind: 'ingest', message: `Successfully ingested: ${url}` });
          setInput('');
          break;
        }
        case 'ingest_text': {
          if (!canIngest) {
            setError('Sign in to add content to this knowledge base.');
            break;
          }
          await ingestText(
            (intent.params.content as string) || trimmed,
            (intent.params.title as string) || undefined
          );
          setResult({ kind: 'ingest', message: 'Successfully ingested text content' });
          setInput('');
          break;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase('idle');
      setExecutingIntent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /* ── File upload helpers ───────────────────────── */

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) addFiles(dropped);
  };

  const completedFiles = fileStatuses.filter((s) => s.status === 'done' || s.status === 'duplicate').length;
  const totalFiles = fileStatuses.length;
  const progressPercent = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;
  const currentFile = fileStatuses.find((s) => !['pending', 'done', 'duplicate', 'error'].includes(s.status));

  /* ── Browse filter helper ─────────────────────── */

  const filteredBrowsePages = result?.kind === 'browse'
    ? (browseFilter === 'all' ? result.pages : result.pages.filter((p) => p.type === browseFilter))
    : [];

  const groupedBrowsePages = new Map<string, typeof filteredBrowsePages>();
  for (const page of filteredBrowsePages) {
    const list = groupedBrowsePages.get(page.type) ?? [];
    list.push(page);
    groupedBrowsePages.set(page.type, list);
  }

  /* ── Render ───────────────────────────────────── */

  return (
    <div>
      {/* ── Header with stats ──────────────────── */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">{kbName || 'Knowledge Base'}</h1>
        <div className="flex items-center text-xs text-gray-400 dark:text-gray-500">
          {stats && (
            <div className="flex items-center gap-4">
              <span>{stats.totalPages} pages</span>
              <span>{stats.concepts} concepts</span>
              <span>{stats.entities} entities</span>
              <span>{stats.sources} sources</span>
            </div>
          )}
          <Link to="/sources" className="ml-auto text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors flex items-center gap-1">
            Browse files
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* ── Text input ──────────────────────────── */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={canIngest ? 'Ask a question, search, browse, or paste a URL to ingest...' : 'Search the knowledge base or ask a question...'}
            rows={2}
            disabled={busy}
            className="block w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-4 py-3 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 focus:border-transparent resize-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="absolute right-3 bottom-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-1.5 rounded-md text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-300 disabled:opacity-30 transition-colors"
          >
            {busy ? '...' : 'Send'}
          </button>
        </div>
        <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Enter to send, Shift+Enter for new line</p>
      </form>

      {/* ── File upload zone (hidden when auth is on and user is not signed in) ── */}
      {canIngest && (
      <div className="mb-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border border-dashed rounded-lg px-4 py-3 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-gray-400 bg-gray-50 dark:border-gray-500 dark:bg-gray-800'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Drop files here or click to upload
          </p>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-0.5">
            PDF, CSV, XLS, XLSX, DOC, DOCX, PPT, PPTX, TXT, MD
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              addFiles(selected);
              e.target.value = '';
            }}
          />
        </div>

        {/* Selected files list */}
        {files.length > 0 && !uploadLoading && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {files.length} file{files.length > 1 ? 's' : ''} selected
              </p>
              <button
                onClick={startUpload}
                className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-1.5 rounded-md text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-300 transition-colors"
              >
                Upload &amp; Ingest
              </button>
            </div>
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400 truncate">
                    {f.name} <span className="text-gray-400 dark:text-gray-500">({(f.size / 1024).toFixed(0)} KB)</span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="text-red-500 hover:text-red-700 text-xs ml-3 flex-shrink-0"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* File upload progress */}
        {fileStatuses.length > 0 && uploadLoading && (
          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Processing {completedFiles} of {totalFiles} files
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">{progressPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-3">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {currentFile && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded px-3 py-2 mb-3 text-sm text-blue-700 dark:text-blue-300">
                <span className="font-medium">{currentFile.filename}</span>: {currentFile.message}
              </div>
            )}
            <ul className="space-y-1.5">
              {fileStatuses.map((fs, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[fs.status]}`} />
                  <span className="truncate flex-1 text-gray-700 dark:text-gray-300">{fs.filename}</span>
                  <span className={`text-xs flex-shrink-0 ${
                    fs.status === 'done' ? 'text-emerald-600' :
                    fs.status === 'duplicate' ? 'text-amber-600' :
                    fs.status === 'error' ? 'text-red-600' :
                    fs.status === 'pending' ? 'text-gray-400' :
                    'text-blue-600'
                  }`}>
                    {fs.status === 'pending' ? 'Waiting' : STATUS_LABELS[fs.status] || fs.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* File upload success/error */}
        {uploadSuccess && (
          <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 mt-2 text-emerald-700 dark:text-emerald-300 text-sm">
            {uploadSuccess}
          </div>
        )}
        {uploadError && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 mt-2 text-red-700 dark:text-red-300 text-sm">
            {uploadError}
          </div>
        )}
        {fileResult && (fileResult.errors.length > 0 || fileResult.duplicates?.length > 0) && (
          <div className="mt-2 space-y-2">
            {fileResult.results.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-emerald-700 dark:text-emerald-300 text-sm">
                {fileResult.results.length} file{fileResult.results.length > 1 ? 's' : ''} ingested successfully
              </div>
            )}
            {fileResult.duplicates?.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-amber-700 dark:text-amber-300 text-sm">
                {fileResult.duplicates.length} duplicate{fileResult.duplicates.length > 1 ? 's' : ''} skipped:
                <ul className="mt-1 list-disc pl-5">
                  {fileResult.duplicates.map((d, i) => <li key={i}><strong>{d.filename}</strong>: already ingested as &quot;{d.existingTitle}&quot;</li>)}
                </ul>
              </div>
            )}
            {fileResult.errors.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-300 text-sm">
                {fileResult.errors.length} file{fileResult.errors.length > 1 ? 's' : ''} failed:
                <ul className="mt-1 list-disc pl-5">
                  {fileResult.errors.map((e, i) => <li key={i}><strong>{e.filename}</strong>: {e.error}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── Loading indicator ───────────────────── */}
      {busy && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4 text-sm text-blue-700 dark:text-blue-300">
          {loadingMessage}
        </div>
      )}

      {/* ── Error ───────────────────────────────── */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {/* ── Results: Browse ─────────────────────── */}
      {result?.kind === 'browse' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {result.topic ? <>Pages matching &quot;{result.topic}&quot;</> : 'Wiki Pages'}
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setBrowseFilter('all')}
                className={`px-3 py-1 text-sm rounded-full ${browseFilter === 'all' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
              >
                All ({result.pages.length})
              </button>
              {Object.entries(TYPE_LABELS).map(([key, label]) => {
                const count = result.pages.filter((p) => p.type === key).length;
                if (count === 0) return null;
                return (
                  <button
                    key={key}
                    onClick={() => setBrowseFilter(key)}
                    className={`px-3 py-1 text-sm rounded-full ${browseFilter === key ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {result.pages.length === 0 ? (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-8 text-center text-gray-500 dark:text-gray-400">
              <p className="text-lg mb-2">
                {result.topic ? <>No pages found for &quot;{result.topic}&quot;</> : 'No wiki pages yet'}
              </p>
              <p className="text-sm">
                {result.topic
                  ? 'Try a different search or add more sources.'
                  : 'Upload a file or paste a URL above to get started.'}
              </p>
            </div>
          ) : (
            [...groupedBrowsePages.entries()].map(([type, typePages]) => (
              <div key={type} className="mb-6">
                <h3 className="text-base font-semibold mb-2">{TYPE_LABELS[type] || type}</h3>
                <div className="grid gap-3">
                  {typePages.map((page) => (
                    <Link
                      key={`${page.type}-${page.slug}`}
                      to={`/browse/${page.type}/${page.slug}`}
                      className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 hover:shadow-md dark:hover:border-gray-600 transition-shadow block"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-gray-100">{page.title}</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{page.summary}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${TYPE_COLORS[page.type] || 'bg-gray-100 text-gray-700'}`}>
                          {page.type}
                        </span>
                      </div>
                      {page.tags?.length > 0 && (
                        <div className="flex gap-1.5 mt-2">
                          {page.tags.slice(0, 5).map((tag) => (
                            <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
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
      )}

      {/* ── Results: Search ─────────────────────── */}
      {result?.kind === 'search' && (
        <div>
          {result.results.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No results found for &quot;{result.query}&quot;</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">{result.results.length} results for &quot;{result.query}&quot;</p>
              {result.results.map((r) => (
                <Link
                  key={r.slug}
                  to={`/browse/${guessType(r.page)}/${r.slug}`}
                  className="block bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 hover:shadow-md dark:hover:border-gray-600 transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{r.slug}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{r.excerpt}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{r.page}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Results: Query ──────────────────────── */}
      {result?.kind === 'query' && (
        <div>
          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-6 wiki-content">
            {result.answer ? (
              <>
                <ReactMarkdown>{processWikilinks(result.answer)}</ReactMarkdown>
                {streaming && (
                  <span className="inline-block w-2 h-5 bg-blue-500 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                )}
              </>
            ) : streaming ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <span className="inline-block w-2 h-5 bg-blue-500 animate-pulse rounded-sm" />
                Thinking...
              </div>
            ) : null}
          </div>

          {!streaming && result.slug && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              Answer saved to wiki/outputs/{result.slug}.md
            </p>
          )}
        </div>
      )}

      {/* ── Results: Ingest ─────────────────────── */}
      {result?.kind === 'ingest' && (
        <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 text-emerald-700 dark:text-emerald-300 text-sm">
          {result.message}
        </div>
      )}
    </div>
  );
}
