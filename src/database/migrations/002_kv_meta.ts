import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('kv_meta')
    .ifNotExists()
    .addColumn('key', 'varchar(200)', (col) => col.primaryKey())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('updated_at', 'timestamp', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull(),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('kv_meta').execute();
}
