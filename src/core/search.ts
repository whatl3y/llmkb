import { ChromaClient, CloudClient, type Collection } from 'chromadb';
import matter from 'gray-matter';
import type { SearchResult } from '../types/index.js';
import type { StorageBackend } from './storage/types.js';

/** Matches chromadb's internal AuthOptions (not exported from the package). */
export interface ChromaAuthOptions {
  provider: 'token' | 'basic';
  credentials: string;
}

export interface ChromaCloudOptions {
  apiKey: string;
  tenant: string;
  database?: string;
}

export class SearchService {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private collectionName: string;

  constructor(chromaUrl: string, collectionName = 'wiki', auth?: ChromaAuthOptions, cloud?: ChromaCloudOptions) {
    if (cloud) {
      this.client = new CloudClient({
        apiKey: cloud.apiKey,
        tenant: cloud.tenant,
        database: cloud.database,
      });
    } else {
      this.client = new ChromaClient({
        path: chromaUrl,
        ...(auth && { auth }),
      });
    }
    this.collectionName = collectionName;
  }

  private async getCollection(): Promise<Collection> {
    if (!this.collection) {
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
      });
    }
    return this.collection;
  }

  /**
   * Index a wiki page for semantic search.
   * ChromaDB handles embedding generation server-side.
   */
  async indexPage(slug: string, content: string, metadata: Record<string, string>): Promise<void> {
    const collection = await this.getCollection();

    // Upsert so re-indexing the same page overwrites
    await collection.upsert({
      ids: [slug],
      documents: [content],
      metadatas: [metadata],
    });
  }

  /**
   * Index multiple pages in a single batch.
   */
  async indexPages(
    pages: Array<{ slug: string; content: string; metadata: Record<string, string> }>
  ): Promise<void> {
    if (pages.length === 0) return;
    const collection = await this.getCollection();

    await collection.upsert({
      ids: pages.map((p) => p.slug),
      documents: pages.map((p) => p.content),
      metadatas: pages.map((p) => p.metadata),
    });
  }

  /**
   * Semantic search across all indexed wiki pages.
   */
  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const collection = await this.getCollection();

    const results = await collection.query({
      queryTexts: [query],
      nResults: limit,
    });

    if (!results.ids[0]) return [];

    return results.ids[0].map((id, i) => ({
      page: (results.metadatas?.[0]?.[i]?.path as string) ?? id,
      slug: id,
      excerpt: (results.documents?.[0]?.[i] ?? '').slice(0, 200),
      score: results.distances?.[0]?.[i] ?? 0,
    }));
  }

  /**
   * Remove a page from the search index.
   */
  async removePage(slug: string): Promise<void> {
    const collection = await this.getCollection();
    await collection.delete({ ids: [slug] });
  }

  /**
   * Reset the entire collection (useful for re-indexing).
   */
  async reset(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.collectionName });
    } catch {
      // Collection may not exist
    }
    this.collection = null;
  }

  /**
   * Rebuild the entire ChromaDB index from the storage backend.
   * Resets the collection, reads all wiki pages, and re-indexes them.
   * Returns the number of pages indexed.
   */
  async reindex(storage: StorageBackend): Promise<number> {
    await this.reset();

    const allPages = await storage.listAllPagesWithContent();
    const batch: Array<{ slug: string; content: string; metadata: Record<string, string> }> = [];

    for (const { type, slug, raw } of allPages) {
      const { content } = matter(raw);
      batch.push({
        slug,
        content,
        metadata: { type, path: `wiki/${type}/${slug}.md`, title: slug },
      });
    }

    // Index in chunks of 50
    for (let i = 0; i < batch.length; i += 50) {
      await this.indexPages(batch.slice(i, i + 50));
    }

    return batch.length;
  }
}
