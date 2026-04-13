import { useState } from 'react';
import { ingestUrl, ingestText, ingestFiles, type FileProgress, type FileIngestResult } from '../api';

type Tab = 'url' | 'file' | 'text';

const ACCEPTED_EXTENSIONS = '.pdf,.csv,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.mp3,.wav,.m4a,.ogg,.flac,.webm,.mp4,.mov,.avi,.mkv,.txt,.md,.text';

const STATUS_LABELS: Record<string, string> = {
  parsing: 'Parsing file...',
  transcribing: 'Transcribing audio...',
  processing: 'Processing video...',
  llm: 'Analyzing with LLM...',
  writing: 'Writing wiki pages...',
  done: 'Complete',
  duplicate: 'Duplicate — skipped',
  error: 'Failed',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-200',
  parsing: 'bg-blue-400 animate-pulse',
  transcribing: 'bg-violet-400 animate-pulse',
  processing: 'bg-indigo-400 animate-pulse',
  llm: 'bg-amber-400 animate-pulse',
  writing: 'bg-blue-400 animate-pulse',
  done: 'bg-emerald-500',
  duplicate: 'bg-amber-500',
  error: 'bg-red-500',
};

interface FileStatus {
  filename: string;
  status: 'pending' | 'parsing' | 'transcribing' | 'processing' | 'llm' | 'writing' | 'done' | 'duplicate' | 'error';
  message: string;
}

export default function IngestView() {
  const [tab, setTab] = useState<Tab>('url');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [finalResult, setFinalResult] = useState<FileIngestResult | null>(null);

  // URL state
  const [url, setUrl] = useState('');

  // Text state
  const [text, setText] = useState('');
  const [textTitle, setTextTitle] = useState('');

  // File state
  const [files, setFiles] = useState<File[]>([]);

  const reset = () => {
    setSuccess('');
    setError('');
    setFileStatuses([]);
    setFinalResult(null);
  };

  const handleUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    reset();
    setLoading(true);
    try {
      await ingestUrl(url.trim());
      setSuccess(`Successfully ingested: ${url}`);
      setUrl('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    reset();
    setLoading(true);
    try {
      await ingestText(text.trim(), textTitle.trim() || undefined);
      setSuccess('Successfully ingested text content');
      setText('');
      setTextTitle('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFiles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    reset();
    setLoading(true);

    // Initialize all file statuses as pending
    setFileStatuses(files.map((f) => ({ filename: f.name, status: 'pending', message: 'Waiting...' })));

    try {
      const data = await ingestFiles(files, (progress: FileProgress) => {
        setFileStatuses((prev) => {
          const updated = [...prev];
          updated[progress.index] = {
            filename: progress.filename,
            status: progress.status,
            message: progress.message,
          };
          return updated;
        });
      });

      setFinalResult(data);
      if (data.errors.length === 0) {
        setSuccess(`Successfully ingested ${data.results.length} file${data.results.length > 1 ? 's' : ''}`);
      }
      setFiles([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const completedCount = fileStatuses.filter((s) => s.status === 'done').length;
  const totalCount = fileStatuses.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const currentFile = fileStatuses.find((s) => s.status !== 'pending' && s.status !== 'done' && s.status !== 'error');

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'url', label: 'URL' },
    { key: 'file', label: 'File Upload' },
    { key: 'text', label: 'Paste Text' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Ingest Source</h1>
      <p className="text-gray-500 text-sm mb-6">
        Add sources to your knowledge base. They will be analyzed, compiled into wiki pages, and indexed for search.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { if (!loading) { setTab(key); reset(); } }}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              tab === key ? 'bg-white shadow-sm font-medium' : 'text-gray-600 hover:text-gray-900'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Success */}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4 text-emerald-700 text-sm">
          {success}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700 text-sm">{error}</div>
      )}

      {/* File ingestion progress */}
      {fileStatuses.length > 0 && loading && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          {/* Overall progress bar */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Processing {completedCount} of {totalCount} files
            </span>
            <span className="text-sm text-gray-500">{progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Current activity */}
          {currentFile && (
            <div className="bg-blue-50 border border-blue-100 rounded px-3 py-2 mb-3 text-sm text-blue-700">
              <span className="font-medium">{currentFile.filename}</span>: {currentFile.message}
            </div>
          )}

          {/* Per-file status list */}
          <ul className="space-y-1.5">
            {fileStatuses.map((fs, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[fs.status]}`} />
                <span className="truncate flex-1 text-gray-700">{fs.filename}</span>
                <span className={`text-xs flex-shrink-0 ${
                  fs.status === 'done' ? 'text-emerald-600' :
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

      {/* Final results with errors */}
      {finalResult && finalResult.errors.length > 0 && (
        <div className="mb-4 space-y-2">
          {finalResult.results.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-700 text-sm">
              {finalResult.results.length} file{finalResult.results.length > 1 ? 's' : ''} ingested successfully
            </div>
          )}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            {finalResult.errors.length} file{finalResult.errors.length > 1 ? 's' : ''} failed:
            <ul className="mt-1 list-disc pl-5">
              {finalResult.errors.map((e, i) => <li key={i}><strong>{e.filename}</strong>: {e.error}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* URL loading indicator */}
      {loading && tab === 'url' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-700">
          Fetching and analyzing URL... This may take 15-30 seconds.
        </div>
      )}

      {/* Text loading indicator */}
      {loading && tab === 'text' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-700">
          Analyzing text content... This may take 15-30 seconds.
        </div>
      )}

      {/* URL form */}
      {tab === 'url' && (
        <form onSubmit={handleUrl} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Web Article URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article-about-llm-apis"
              className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Ingest URL'}
          </button>
        </form>
      )}

      {/* File upload form */}
      {tab === 'file' && (
        <form onSubmit={handleFiles} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Upload Files</label>
            <p className="text-xs text-gray-400 mb-2">
              Supports PDF, CSV, XLS, XLSX, DOC, DOCX, PPT, PPTX, TXT, MD
            </p>
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                multiple
                disabled={loading}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  setFiles((prev) => [...prev, ...selected]);
                  e.target.value = '';
                }}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Selected files list */}
          {files.length > 0 && !loading && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-700 mb-2">{files.length} file{files.length > 1 ? 's' : ''} selected</p>
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 truncate">{f.name} <span className="text-gray-400">({(f.size / 1024).toFixed(0)} KB)</span></span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-red-500 hover:text-red-700 text-xs ml-3 flex-shrink-0"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || files.length === 0}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : `Upload & Ingest${files.length > 1 ? ` (${files.length} files)` : ''}`}
          </button>
        </form>
      )}

      {/* Text paste form */}
      {tab === 'text' && (
        <form onSubmit={handleText} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title (optional)</label>
            <input
              type="text"
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              placeholder="Article title"
              className="w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the article content here..."
              rows={12}
              className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
              disabled={loading}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Ingest Text'}
          </button>
        </form>
      )}
    </div>
  );
}
