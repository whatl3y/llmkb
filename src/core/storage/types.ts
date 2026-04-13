import type { Readable } from 'stream';
import type { AuthUser } from '../../types/index.js';

export interface HashEntry {
  slug: string;
  title: string;
  ingestedAt: string;
}

export interface StorageBackend {
  /** Bootstrap directories/tables/buckets as needed. */
  initialize(topic: string): Promise<void>;

  // --- Wiki Pages (full markdown with frontmatter) ---

  readPage(type: string, slug: string): Promise<string | null>;
  writePage(type: string, slug: string, content: string): Promise<void>;
  appendToPage(type: string, slug: string, appendContent: string): Promise<void>;
  pageExists(type: string, slug: string): Promise<boolean>;
  /** List slugs in a wiki subdirectory (e.g. "concepts"). */
  listPageSlugs(type: string): Promise<string[]>;
  /** List pages with their full raw markdown content. */
  listPagesWithContent(type: string): Promise<Array<{ slug: string; raw: string }>>;
  /** List all wiki pages across all types. */
  listAllPagesWithContent(): Promise<Array<{ type: string; slug: string; raw: string }>>;

  // --- Index & Log (special wiki-level files) ---

  readIndex(): Promise<string>;
  writeIndex(content: string): Promise<void>;
  readLog(): Promise<string>;
  writeLog(content: string): Promise<void>;

  // --- Hash Index (dedup) ---

  getHashEntry(hash: string): Promise<HashEntry | null>;
  setHashEntry(hash: string, entry: HashEntry): Promise<void>;

  // --- Uploads (original source files) ---

  saveUpload(slug: string, filename: string, data: Buffer): Promise<void>;
  getUploadStream(slug: string, filename: string): Promise<Readable | null>;
  uploadExists(slug: string, filename: string): Promise<boolean>;

  // --- Users (auth whitelist) ---

  getUsers(): Promise<AuthUser[]>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  addUser(email: string, name: string): Promise<AuthUser>;
  removeUser(email: string): Promise<boolean>;
}
