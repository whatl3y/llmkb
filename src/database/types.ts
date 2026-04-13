import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface Database {
  wiki_pages: WikiPagesTable;
  hash_index: HashIndexTable;
  users: UsersTable;
  wiki_log: WikiLogTable;
  uploads: UploadsTable;
}

// --- Wiki Pages ---

export interface WikiPagesTable {
  id: Generated<number>;
  /** concept, entity, source, synthesis, output */
  type: string;
  slug: string;
  /** Full markdown content including YAML frontmatter */
  raw: string;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type WikiPage = Selectable<WikiPagesTable>;
export type NewWikiPage = Insertable<WikiPagesTable>;
export type WikiPageUpdate = Updateable<WikiPagesTable>;

// --- Hash Index (deduplication) ---

export interface HashIndexTable {
  hash: string;
  slug: string;
  title: string;
  ingested_at: ColumnType<Date, Date | string, never>;
}

export type HashEntry = Selectable<HashIndexTable>;
export type NewHashEntry = Insertable<HashIndexTable>;

// --- Users (auth whitelist) ---

export interface UsersTable {
  email: string;
  name: ColumnType<string, string | undefined, string>;
  added_at: ColumnType<string, string, never>;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

// --- Wiki Log ---

export interface WikiLogTable {
  id: Generated<number>;
  date: string;
  operation: string;
  title: string;
  details: ColumnType<string[], string[] | undefined, string[]>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export type WikiLogEntry = Selectable<WikiLogTable>;
export type NewWikiLogEntry = Insertable<WikiLogTable>;

// --- Uploads (original source files in S3) ---

export interface UploadsTable {
  id: Generated<number>;
  slug: string;
  filename: string;
  s3_key: string;
  content_type: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export type Upload = Selectable<UploadsTable>;
export type NewUpload = Insertable<UploadsTable>;
