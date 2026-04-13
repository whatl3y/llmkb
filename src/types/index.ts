// --- KB Config Types ---

export interface KBConfig {
  name: string;
  topic: string;
  description: string;
  focusPrompt: string;
}

// --- LLM Provider Types ---

export interface CompletionParams {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(params: CompletionParams): Promise<CompletionResult>;
  stream(params: CompletionParams): AsyncIterable<string>;
}

// --- Wiki Page Types ---

export type PageType = 'concept' | 'entity' | 'source' | 'synthesis' | 'output';
export type PageStatus = 'draft' | 'review' | 'final';
export type Confidence = 'established' | 'emerging' | 'speculative';

export interface PageFrontmatter {
  title: string;
  date_created: string;
  date_modified: string;
  summary: string;
  tags: string[];
  type: PageType;
  status: PageStatus;
  source_url?: string;
  source_file?: string;
  authors?: string[];
  related?: string[];
  source_count?: number;
  confidence?: Confidence;
}

export interface WikiPage {
  path: string;
  slug: string;
  frontmatter: PageFrontmatter;
  content: string;
  raw: string;
}

// --- Ingestion Types ---

export type SourceType = 'url' | 'pdf' | 'text';

export interface ParsedSource {
  title: string;
  content: string;
  sourceType: SourceType;
  sourceUrl?: string;
  authors?: string[];
  rawContent?: string;
}

export interface IngestRequest {
  sourceType: SourceType;
  content: string;       // raw text, URL string, or base64 PDF
  title?: string;        // optional override
  filename?: string;     // original filename for uploads
  originalBuffer?: Buffer;     // raw file bytes for storage
  originalFilename?: string;   // original filename (e.g., "report.docx")
}

export interface ExtractedConcept {
  name: string;
  slug: string;
  description: string;
  relatedConcepts: string[];
}

export interface ExtractedEntity {
  name: string;
  slug: string;
  description: string;
  entityType: 'person' | 'organization' | 'tool' | 'framework' | 'service';
}

export interface IngestResult {
  sourceSummary: {
    title: string;
    slug: string;
    summary: string;
    tags: string[];
    authors: string[];
    sourceUrl: string;
    sourceFile?: string;
    fullArticle: string;
  };
  concepts: ExtractedConcept[];
  entities: ExtractedEntity[];
}

// --- Query Types ---

export interface QueryRequest {
  question: string;
}

export interface Citation {
  page: string;
  excerpt: string;
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
  slug: string;
}

// --- Search Types ---

export interface SearchRequest {
  query: string;
  limit?: number;
}

export interface SearchResult {
  page: string;
  slug: string;
  excerpt: string;
  score: number;
}

// --- Lint Types ---

export interface LintIssue {
  type: 'contradiction' | 'orphan' | 'missing_page' | 'broken_link' | 'incomplete_metadata' | 'stale';
  severity: 'error' | 'warning' | 'info';
  page?: string;
  message: string;
  autoFixed: boolean;
}

export interface LintReport {
  date: string;
  issues: LintIssue[];
  fixedCount: number;
  suggestedQuestions: string[];
}

// --- Auth Types ---

export interface AuthUser {
  email: string;
  name: string;
  addedAt: string;
}

export interface AuthConfig {
  enabled: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  jwtSecret?: string;
  host?: string;
}

// --- API Response Types ---

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface WikiStats {
  totalPages: number;
  concepts: number;
  entities: number;
  sources: number;
  syntheses: number;
  outputs: number;
  recentActivity: LogEntry[];
}

export interface LogEntry {
  date: string;
  operation: 'ingest' | 'query' | 'lint' | 'compile';
  title: string;
  details: string[];
}
