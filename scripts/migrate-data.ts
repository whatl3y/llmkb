/**
 * Migrate data from the filesystem backend (data/) into Postgres + S3.
 *
 * Usage:
 *   npm run migrate-data
 *
 * Prerequisites:
 *   - DATABASE_URL set in .env
 *   - AWS_BUCKET set in .env (if uploads exist)
 *   - Database migrations already run (npm run migrate)
 *   - ChromaDB running (for re-indexing)
 *
 * This script is idempotent — it upserts into Postgres and S3, so running
 * it multiple times won't create duplicates.
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from '../src/database/types.js';
import { getPoolConfig } from '../src/database/database.js';
import Aws from '../src/libs/aws.js';
import { SearchService, type ChromaAuthOptions, type ChromaCloudOptions } from '../src/core/search.js';
import config from '../src/config.js';

const DATA_DIR = path.resolve(config.storage.dataDir);
const WIKI_TYPES = ['concepts', 'entities', 'sources', 'syntheses', 'outputs'] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required. Set it in .env');
    process.exit(1);
  }

  console.log(`[migrate-data] Source: ${DATA_DIR}`);
  console.log(`[migrate-data] Target: Postgres + S3 (${config.aws.bucket})`);
  console.log('');

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool(getPoolConfig(databaseUrl)),
    }),
  });

  const aws = Aws();

  const chromaAuth: ChromaAuthOptions | undefined = config.chroma.token
    ? { provider: 'token', credentials: config.chroma.token }
    : undefined;
  const chromaCloud: ChromaCloudOptions | undefined = config.chroma.apiKey && config.chroma.tenant
    ? { apiKey: config.chroma.apiKey, tenant: config.chroma.tenant, database: config.chroma.database }
    : undefined;
  const search = new SearchService(config.chroma.url, 'wiki', chromaAuth, chromaCloud);

  let totalPages = 0;
  let totalHashes = 0;
  let totalUsers = 0;
  let totalLogs = 0;
  let totalUploads = 0;

  // --- 1. Wiki pages ---
  console.log('[migrate-data] Migrating wiki pages...');
  const pagesForIndexing: Array<{ slug: string; content: string; metadata: Record<string, string> }> = [];

  for (const type of WIKI_TYPES) {
    const dir = path.join(DATA_DIR, 'wiki', type);
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md') && f !== '.gitkeep');
    } catch {
      continue;
    }

    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      const raw = await fs.readFile(path.join(dir, file), 'utf-8');

      await db
        .insertInto('wiki_pages')
        .values({ type, slug, raw })
        .onConflict((oc) =>
          oc.columns(['type', 'slug']).doUpdateSet({ raw, updated_at: new Date() }),
        )
        .execute();

      // Prepare for ChromaDB indexing
      const { content } = matter(raw);
      pagesForIndexing.push({
        slug,
        content,
        metadata: { type, path: `wiki/${type}/${slug}.md`, title: slug },
      });

      totalPages++;
    }
  }
  console.log(`  ${totalPages} pages`);

  // --- 2. Index page ---
  console.log('[migrate-data] Migrating index.md...');
  try {
    const indexRaw = await fs.readFile(path.join(DATA_DIR, 'wiki', 'index.md'), 'utf-8');
    await db
      .insertInto('wiki_pages')
      .values({ type: '_system', slug: 'index', raw: indexRaw })
      .onConflict((oc) =>
        oc.columns(['type', 'slug']).doUpdateSet({ raw: indexRaw, updated_at: new Date() }),
      )
      .execute();
    console.log('  index.md');
  } catch {
    console.log('  (no index.md found, skipping)');
  }

  // --- 3. Log entries ---
  console.log('[migrate-data] Migrating log.md...');
  try {
    const logRaw = await fs.readFile(path.join(DATA_DIR, 'wiki', 'log.md'), 'utf-8');
    const entryRegex = /^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(logRaw)) !== null) {
      const restStart = match.index + match[0].length;
      const nextEntry = logRaw.indexOf('\n## [', restStart);
      const detailBlock = logRaw.slice(restStart, nextEntry === -1 ? undefined : nextEntry).trim();
      const details = detailBlock
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2));

      await db
        .insertInto('wiki_log')
        .values({
          date: match[1],
          operation: match[2],
          title: match[3],
          details: JSON.stringify(details) as any,
        })
        .execute();
      totalLogs++;
    }
    console.log(`  ${totalLogs} log entries`);
  } catch {
    console.log('  (no log.md found, skipping)');
  }

  // --- 4. Hash index ---
  console.log('[migrate-data] Migrating hashes.json...');
  try {
    const hashRaw = await fs.readFile(path.join(DATA_DIR, 'hashes.json'), 'utf-8');
    const hashIndex: Record<string, { slug: string; title: string; ingestedAt: string }> = JSON.parse(hashRaw);

    for (const [hash, entry] of Object.entries(hashIndex)) {
      await db
        .insertInto('hash_index')
        .values({
          hash,
          slug: entry.slug,
          title: entry.title,
          ingested_at: entry.ingestedAt,
        })
        .onConflict((oc) =>
          oc.column('hash').doUpdateSet({ slug: entry.slug, title: entry.title }),
        )
        .execute();
      totalHashes++;
    }
    console.log(`  ${totalHashes} hashes`);
  } catch {
    console.log('  (no hashes.json found, skipping)');
  }

  // --- 5. Users ---
  console.log('[migrate-data] Migrating users.json...');
  try {
    const usersRaw = await fs.readFile(path.join(DATA_DIR, 'auth', 'users.json'), 'utf-8');
    const users: Array<{ email: string; name: string; addedAt: string }> = JSON.parse(usersRaw);

    for (const user of users) {
      await db
        .insertInto('users')
        .values({ email: user.email, name: user.name || '', added_at: user.addedAt })
        .onConflict((oc) =>
          oc.column('email').doUpdateSet({ name: user.name || '' }),
        )
        .execute();
      totalUsers++;
    }
    console.log(`  ${totalUsers} users`);
  } catch {
    console.log('  (no users.json found, skipping)');
  }

  // --- 6. Uploads → S3 ---
  console.log('[migrate-data] Migrating uploads to S3...');
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  try {
    const slugDirs = await fs.readdir(uploadsDir);
    for (const slug of slugDirs) {
      const slugPath = path.join(uploadsDir, slug);
      const stat = await fs.stat(slugPath);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(slugPath);
      for (const filename of files) {
        if (filename === '.gitkeep') continue;
        const filePath = path.join(slugPath, filename);
        const data = await fs.readFile(filePath);
        const s3Key = `uploads/${slug}/${filename}`;

        await aws.writeFile({ filename: s3Key, data });
        await db
          .insertInto('uploads')
          .values({ slug, filename, s3_key: s3Key })
          .onConflict((oc) =>
            oc.columns(['slug', 'filename']).doUpdateSet({ s3_key: s3Key }),
          )
          .execute();
        totalUploads++;
      }
    }
    console.log(`  ${totalUploads} files`);
  } catch {
    console.log('  (no uploads directory found, skipping)');
  }

  // --- 7. Re-index ChromaDB ---
  console.log('[migrate-data] Re-indexing ChromaDB...');
  await search.reset();
  // Batch in chunks of 50 to avoid overwhelming ChromaDB
  for (let i = 0; i < pagesForIndexing.length; i += 50) {
    const batch = pagesForIndexing.slice(i, i + 50);
    await search.indexPages(batch);
  }
  console.log(`  ${pagesForIndexing.length} pages indexed`);

  // --- Done ---
  console.log('');
  console.log('[migrate-data] Complete!');
  console.log(`  Pages:   ${totalPages}`);
  console.log(`  Hashes:  ${totalHashes}`);
  console.log(`  Users:   ${totalUsers}`);
  console.log(`  Logs:    ${totalLogs}`);
  console.log(`  Uploads: ${totalUploads}`);
  console.log(`  Indexed: ${pagesForIndexing.length}`);
  console.log('');
  console.log('You can now set STORAGE_BACKEND=database in .env and restart.');

  await db.destroy();
}

main().catch((err) => {
  console.error('[migrate-data] Failed:', err);
  process.exit(1);
});
