import { Readable } from 'stream';
import { db } from '../../database/database.js';
import Aws from '../../libs/aws.js';
import { today } from '../../utils/frontmatter.js';
import type { AuthUser } from '../../types/index.js';
import type { StorageBackend, HashEntry } from './types.js';

/**
 * Database-backed storage — Postgres for structured data, S3 for binary uploads.
 * Replaces the filesystem backend for ephemeral deployment environments.
 */
export class DatabaseStorage implements StorageBackend {
  private aws: ReturnType<typeof Aws>;

  constructor() {
    this.aws = Aws();
  }

  async initialize(_topic: string): Promise<void> {
    // Tables are created by migrations (npm run migrate).
    // S3 bucket must be created externally (e.g. via Terraform/CloudFormation).
    // Nothing to do at runtime.
  }

  // --- Wiki Pages ---

  async readPage(type: string, slug: string): Promise<string | null> {
    const row = await db
      .selectFrom('wiki_pages')
      .select('raw')
      .where('type', '=', type)
      .where('slug', '=', slug)
      .executeTakeFirst();
    return row?.raw ?? null;
  }

  async writePage(type: string, slug: string, content: string): Promise<void> {
    const existing = await db
      .selectFrom('wiki_pages')
      .select('id')
      .where('type', '=', type)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable('wiki_pages')
        .set({ raw: content, updated_at: new Date() })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db
        .insertInto('wiki_pages')
        .values({ type, slug, raw: content })
        .execute();
    }
  }

  async appendToPage(type: string, slug: string, appendContent: string): Promise<void> {
    const existing = await this.readPage(type, slug);
    if (existing) {
      await this.writePage(type, slug, existing + appendContent);
    }
  }

  async pageExists(type: string, slug: string): Promise<boolean> {
    const row = await db
      .selectFrom('wiki_pages')
      .select('id')
      .where('type', '=', type)
      .where('slug', '=', slug)
      .executeTakeFirst();
    return !!row;
  }

  async listPageSlugs(type: string): Promise<string[]> {
    const rows = await db
      .selectFrom('wiki_pages')
      .select('slug')
      .where('type', '=', type)
      .execute();
    return rows.map((r) => r.slug);
  }

  async listPagesWithContent(type: string): Promise<Array<{ slug: string; raw: string }>> {
    return await db
      .selectFrom('wiki_pages')
      .select(['slug', 'raw'])
      .where('type', '=', type)
      .execute();
  }

  async listAllPagesWithContent(): Promise<Array<{ type: string; slug: string; raw: string }>> {
    return await db
      .selectFrom('wiki_pages')
      .select(['type', 'slug', 'raw'])
      .execute();
  }

  // --- Index & Log ---
  // Stored as special wiki_pages with type='_system'

  async readIndex(): Promise<string> {
    const row = await db
      .selectFrom('wiki_pages')
      .select('raw')
      .where('type', '=', '_system')
      .where('slug', '=', 'index')
      .executeTakeFirst();
    return row?.raw ?? '';
  }

  async writeIndex(content: string): Promise<void> {
    await this.writePage('_system', 'index', content);
  }

  async readLog(): Promise<string> {
    // Reconstruct log from wiki_log table entries
    const entries = await db
      .selectFrom('wiki_log')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();

    if (entries.length === 0) return '# Wiki Log\n';

    let log = '# Wiki Log\n';
    for (const entry of entries) {
      const details = (entry.details as string[])
        .map((d) => `- ${d}`)
        .join('\n');
      log += `\n## [${entry.date}] ${entry.operation} | ${entry.title}\n${details}\n`;
    }
    return log;
  }

  async writeLog(content: string): Promise<void> {
    // Parse the log content and extract the last entry to insert.
    // This is called after appendLog, which appends a new entry to the full log string.
    // We extract and insert only new entries.
    const entryRegex = /^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$/gm;
    let match: RegExpExecArray | null;
    const entries: Array<{ date: string; operation: string; title: string; details: string[] }> = [];

    while ((match = entryRegex.exec(content)) !== null) {
      const restStart = match.index + match[0].length;
      const nextEntry = content.indexOf('\n## [', restStart);
      const detailBlock = content.slice(restStart, nextEntry === -1 ? undefined : nextEntry).trim();
      const details = detailBlock
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2));

      entries.push({
        date: match[1],
        operation: match[2],
        title: match[3],
        details,
      });
    }

    if (entries.length === 0) return;

    // Insert the last entry (the one just appended)
    const last = entries[entries.length - 1];
    await db
      .insertInto('wiki_log')
      .values({
        date: last.date,
        operation: last.operation,
        title: last.title,
        details: JSON.stringify(last.details) as any,
      })
      .execute();
  }

  // --- Hash Index ---

  async getHashEntry(hash: string): Promise<HashEntry | null> {
    const row = await db
      .selectFrom('hash_index')
      .selectAll()
      .where('hash', '=', hash)
      .executeTakeFirst();

    if (!row) return null;
    return {
      slug: row.slug,
      title: row.title,
      ingestedAt: row.ingested_at instanceof Date
        ? row.ingested_at.toISOString()
        : String(row.ingested_at),
    };
  }

  async setHashEntry(hash: string, entry: HashEntry): Promise<void> {
    await db
      .insertInto('hash_index')
      .values({
        hash,
        slug: entry.slug,
        title: entry.title,
        ingested_at: entry.ingestedAt,
      })
      .onConflict((oc) =>
        oc.column('hash').doUpdateSet({
          slug: entry.slug,
          title: entry.title,
        }),
      )
      .execute();
  }

  // --- Uploads (S3) ---

  private uploadKey(slug: string, filename: string): string {
    return `uploads/${slug}/${filename}`;
  }

  async saveUpload(slug: string, filename: string, data: Buffer): Promise<void> {
    const s3Key = this.uploadKey(slug, filename);
    await this.aws.writeFile({ filename: s3Key, data });

    // Track in DB for listing/querying
    await db
      .insertInto('uploads')
      .values({ slug, filename, s3_key: s3Key })
      .onConflict((oc) =>
        oc.columns(['slug', 'filename']).doUpdateSet({ s3_key: s3Key }),
      )
      .execute();
  }

  async getUploadStream(slug: string, filename: string): Promise<Readable | null> {
    const s3Key = this.uploadKey(slug, filename);
    try {
      const response = await this.aws.getFile({ filename: s3Key });
      return response.Body as Readable;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async uploadExists(slug: string, filename: string): Promise<boolean> {
    return this.aws.doesFileExist({ filename: this.uploadKey(slug, filename) });
  }

  // --- Users ---

  async getUsers(): Promise<AuthUser[]> {
    const rows = await db.selectFrom('users').selectAll().execute();
    return rows.map((r) => ({
      email: r.email,
      name: r.name,
      addedAt: r.added_at,
    }));
  }

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const row = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();

    if (!row) return null;
    return { email: row.email, name: row.name, addedAt: row.added_at };
  }

  async addUser(email: string, name: string): Promise<AuthUser> {
    const needle = email.toLowerCase();
    const existing = await this.findUserByEmail(needle);
    if (existing) return existing;

    const addedAt = today();
    await db
      .insertInto('users')
      .values({ email: needle, name: name ?? '', added_at: addedAt })
      .execute();

    return { email: needle, name: name ?? '', addedAt };
  }

  async removeUser(email: string): Promise<boolean> {
    const result = await db
      .deleteFrom('users')
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();
    return BigInt(result.numDeletedRows) > 0n;
  }
}
