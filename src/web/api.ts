const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data;
}

// Config
export const getConfig = () =>
  request<{
    name: string;
    topic: string;
    description: string;
    authEnabled?: boolean;
    user?: { email: string; name: string } | null;
  }>('/config');

// Auth
export const logout = () =>
  fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(() => {});

// Wiki
export const getStats = () => request<{
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
}>('/wiki/stats');

export const getPages = () => request<Array<{
  slug: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  date_modified: string;
}>>('/wiki/pages');

export const getPage = (type: string, slug: string) => request<{
  slug: string;
  type: string;
  frontmatter: Record<string, unknown>;
  content: string;
}>(`/wiki/page/${type}/${slug}`);

export const getIndex = () => request<{
  frontmatter: Record<string, unknown>;
  content: string;
}>('/wiki/index');

// Search
export const search = (query: string, limit = 10) =>
  request<Array<{ page: string; slug: string; excerpt: string; score: number }>>(
    '/search',
    { method: 'POST', body: JSON.stringify({ query, limit }) }
  );

// Query
export const queryWiki = (question: string) =>
  request<{ answer: string; citations: Array<{ page: string; excerpt: string }>; slug: string }>(
    '/query',
    { method: 'POST', body: JSON.stringify({ question }) }
  );

// Ingest
export const ingestUrl = (url: string, force = false) =>
  request('/ingest/url', { method: 'POST', body: JSON.stringify({ url, force }) });

export const ingestText = (content: string, title?: string, force = false) =>
  request('/ingest/text', { method: 'POST', body: JSON.stringify({ content, title, force }) });

export interface FileProgress {
  index: number;
  total: number;
  filename: string;
  status: 'parsing' | 'transcribing' | 'processing' | 'llm' | 'writing' | 'done' | 'duplicate' | 'error';
  message: string;
  duplicate?: { slug: string; title: string; ingestedAt: string };
}

export interface FileIngestResult {
  results: Array<{ filename: string; result: unknown }>;
  errors: Array<{ filename: string; error: string }>;
  duplicates: Array<{ filename: string; existingSlug: string; existingTitle: string }>;
}

/**
 * Upload files and stream progress via SSE.
 * Calls onProgress for each file status update, returns final result.
 * Set force=true to skip duplicate checking.
 */
export async function ingestFiles(
  files: File[],
  onProgress?: (progress: FileProgress) => void,
  force = false
): Promise<FileIngestResult> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const url = force ? `${BASE}/ingest/files?force=true` : `${BASE}/ingest/files`;
  const res = await fetch(url, { method: 'POST', body: formData });

  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.error || 'Upload failed');
    } catch {
      throw new Error(text || `Upload failed: ${res.status}`);
    }
  }

  return new Promise((resolve, reject) => {
    const reader = res.body?.getReader();
    if (!reader) {
      reject(new Error('No response body'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    function processLines() {
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === 'progress' && onProgress) {
            onProgress(data);
          } else if (currentEvent === 'complete') {
            resolve(data);
          }
        }
      }
    }

    function read(): void {
      reader!.read().then(({ done, value }) => {
        if (done) {
          if (buffer) processLines();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        processLines();
        read();
      }).catch(reject);
    }

    read();
  });
}

// Query (streaming)
export async function queryWikiStream(
  question: string,
  onChunk: (text: string) => void,
  onDone?: (meta: { slug: string }) => void
): Promise<void> {
  const res = await fetch(`${BASE}/query/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    let error = `Query failed: ${res.status}`;
    try {
      const json = await res.json();
      error = json.error || error;
    } catch {}
    throw new Error(error);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        if (currentEvent === 'chunk') {
          onChunk(data.text);
        } else if (currentEvent === 'done') {
          onDone?.(data);
        } else if (currentEvent === 'error') {
          throw new Error(data.error || 'Streaming error');
        }
      }
    }
  }
}

// Intent classification
export const classifyIntent = (input: string) =>
  request<{ intent: string; params: Record<string, unknown> }>(
    '/intent',
    { method: 'POST', body: JSON.stringify({ input }) }
  );

// Download original source file
export const getDownloadUrl = (sourceFile: string) =>
  `${BASE}/wiki/download/${sourceFile}`;

// Lint
export const runLint = () =>
  request<{
    date: string;
    issues: Array<{ type: string; severity: string; page?: string; message: string; autoFixed: boolean }>;
    fixedCount: number;
    suggestedQuestions: string[];
  }>('/lint', { method: 'POST' });
