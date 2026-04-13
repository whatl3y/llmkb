import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Wiki pages — stores full markdown (frontmatter + body) as raw text
  await db.schema
    .createTable('wiki_pages')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('type', 'varchar(50)', (col) => col.notNull())
    .addColumn('slug', 'varchar(500)', (col) => col.notNull())
    .addColumn('raw', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull(),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull(),
    )
    .execute();

  await db.schema
    .createIndex('idx_wiki_pages_type_slug')
    .on('wiki_pages')
    .columns(['type', 'slug'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_wiki_pages_type')
    .on('wiki_pages')
    .column('type')
    .execute();

  // Hash index — SHA-256 deduplication for ingested sources
  await db.schema
    .createTable('hash_index')
    .ifNotExists()
    .addColumn('hash', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('slug', 'varchar(500)', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('ingested_at', 'timestamp', (col) => col.notNull())
    .execute();

  // Users — auth whitelist
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('email', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.defaultTo('').notNull())
    .addColumn('added_at', 'varchar(20)', (col) => col.notNull())
    .execute();

  // Wiki log — append-only operation log
  await db.schema
    .createTable('wiki_log')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('date', 'varchar(20)', (col) => col.notNull())
    .addColumn('operation', 'varchar(50)', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('details', 'jsonb', (col) => col.defaultTo('[]').notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull(),
    )
    .execute();

  await db.schema
    .createIndex('idx_wiki_log_date')
    .on('wiki_log')
    .column('date')
    .execute();

  // Uploads — tracks original source files stored in S3
  await db.schema
    .createTable('uploads')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('slug', 'varchar(500)', (col) => col.notNull())
    .addColumn('filename', 'varchar(500)', (col) => col.notNull())
    .addColumn('s3_key', 'text', (col) => col.notNull())
    .addColumn('content_type', 'varchar(100)')
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull(),
    )
    .execute();

  await db.schema
    .createIndex('idx_uploads_slug_filename')
    .on('uploads')
    .columns(['slug', 'filename'])
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('uploads').execute();
  await db.schema.dropTable('wiki_log').execute();
  await db.schema.dropTable('users').execute();
  await db.schema.dropTable('hash_index').execute();
  await db.schema.dropTable('wiki_pages').execute();
}
