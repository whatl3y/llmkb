import fs from 'fs/promises';
import { createReadStream } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { AuthUser } from '../../types/index.js';
import type { StorageBackend, HashEntry } from './types.js';

type HashIndex = Record<string, HashEntry>;

/**
 * Filesystem-backed storage — the original behavior.
 * All data lives under `dataDir/` as markdown files, JSON files, and binary uploads.
 */
export class FileSystemStorage implements StorageBackend {
  constructor(private dataDir: string) {}

  async initialize(topic: string): Promise<void> {
    const dirs = [
      'raw/articles', 'raw/papers', 'raw/text',
      'wiki/concepts', 'wiki/entities', 'wiki/sources',
      'wiki/syntheses', 'wiki/outputs',
      'uploads',
      'auth',
    ];
    for (const dir of dirs) {
      fsSync.mkdirSync(path.join(this.dataDir, dir), { recursive: true });
    }

    const indexPath = path.join(this.dataDir, 'wiki', 'index.md');
    if (!fsSync.existsSync(indexPath)) {
      const today = new Date().toISOString().split('T')[0];
      fsSync.writeFileSync(indexPath, [
        '---',
        'title: "Wiki Index"',
        `date_modified: ${today}`,
        'total_articles: 0',
        '---',
        '',
        '# Wiki Index',
        '',
        '## Overview',
        `Personal knowledge base on ${topic}.`,
        '',
        '## Concepts',
        '',
        '## Entities',
        '',
        '## Source Summaries',
        '',
        '## Recently Added',
        '',
      ].join('\n'));
    }

    const logPath = path.join(this.dataDir, 'wiki', 'log.md');
    if (!fsSync.existsSync(logPath)) {
      fsSync.writeFileSync(logPath, '# Wiki Log\n');
    }

    // Ensure auth seed file
    const usersPath = path.join(this.dataDir, 'auth', 'users.json');
    if (!fsSync.existsSync(usersPath)) {
      fsSync.writeFileSync(usersPath, '[]', 'utf-8');
    }
  }

  // --- Wiki Pages ---

  async readPage(type: string, slug: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.dataDir, 'wiki', type, `${slug}.md`), 'utf-8');
    } catch {
      return null;
    }
  }

  async writePage(type: string, slug: string, content: string): Promise<void> {
    await fs.mkdir(path.join(this.dataDir, 'wiki', type), { recursive: true });
    await fs.writeFile(path.join(this.dataDir, 'wiki', type, `${slug}.md`), content, 'utf-8');
  }

  async appendToPage(type: string, slug: string, appendContent: string): Promise<void> {
    const filePath = path.join(this.dataDir, 'wiki', type, `${slug}.md`);
    const existing = await fs.readFile(filePath, 'utf-8');
    await fs.writeFile(filePath, existing + appendContent, 'utf-8');
  }

  async pageExists(type: string, slug: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.dataDir, 'wiki', type, `${slug}.md`));
      return true;
    } catch {
      return false;
    }
  }

  async listPageSlugs(type: string): Promise<string[]> {
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'wiki', type));
      return files
        .filter((f) => f.endsWith('.md') && f !== '.gitkeep')
        .map((f) => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  async listPagesWithContent(type: string): Promise<Array<{ slug: string; raw: string }>> {
    const dir = path.join(this.dataDir, 'wiki', type);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const pages: Array<{ slug: string; raw: string }> = [];
    for (const file of files) {
      if (!file.endsWith('.md') || file === '.gitkeep') continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        pages.push({ slug: file.replace(/\.md$/, ''), raw });
      } catch {
        // skip malformed
      }
    }
    return pages;
  }

  async listAllPagesWithContent(): Promise<Array<{ type: string; slug: string; raw: string }>> {
    const types = ['concepts', 'entities', 'sources', 'syntheses', 'outputs'];
    const results: Array<{ type: string; slug: string; raw: string }> = [];

    for (const type of types) {
      const pages = await this.listPagesWithContent(type);
      for (const p of pages) {
        results.push({ type, ...p });
      }
    }

    return results;
  }

  // --- Index & Log ---

  async readIndex(): Promise<string> {
    try {
      return await fs.readFile(path.join(this.dataDir, 'wiki', 'index.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  async writeIndex(content: string): Promise<void> {
    await fs.writeFile(path.join(this.dataDir, 'wiki', 'index.md'), content, 'utf-8');
  }

  async readLog(): Promise<string> {
    try {
      return await fs.readFile(path.join(this.dataDir, 'wiki', 'log.md'), 'utf-8');
    } catch {
      return '# Wiki Log\n';
    }
  }

  async writeLog(content: string): Promise<void> {
    await fs.writeFile(path.join(this.dataDir, 'wiki', 'log.md'), content, 'utf-8');
  }

  // --- Hash Index ---

  async getHashEntry(hash: string): Promise<HashEntry | null> {
    const index = await this.loadHashIndex();
    return index[hash] ?? null;
  }

  async setHashEntry(hash: string, entry: HashEntry): Promise<void> {
    const index = await this.loadHashIndex();
    index[hash] = entry;
    await fs.writeFile(
      path.join(this.dataDir, 'hashes.json'),
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }

  private async loadHashIndex(): Promise<HashIndex> {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'hashes.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  // --- Uploads ---

  async saveUpload(slug: string, filename: string, data: Buffer): Promise<void> {
    const uploadDir = path.join(this.dataDir, 'uploads', slug);
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, filename), data);
  }

  async getUploadStream(slug: string, filename: string): Promise<Readable | null> {
    const filePath = path.join(this.dataDir, 'uploads', slug, filename);
    try {
      await fs.access(filePath);
      return createReadStream(filePath);
    } catch {
      return null;
    }
  }

  async uploadExists(slug: string, filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.dataDir, 'uploads', slug, filename));
      return true;
    } catch {
      return false;
    }
  }

  // --- Users ---

  private get usersPath(): string {
    return path.join(this.dataDir, 'auth', 'users.json');
  }

  async getUsers(): Promise<AuthUser[]> {
    try {
      const raw = await fs.readFile(this.usersPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const users = await this.getUsers();
    const needle = email.toLowerCase();
    return users.find((u) => u.email.toLowerCase() === needle) ?? null;
  }

  async addUser(email: string, name: string): Promise<AuthUser> {
    const users = await this.getUsers();
    const needle = email.toLowerCase();
    const existing = users.find((u) => u.email.toLowerCase() === needle);
    if (existing) return existing;

    const user: AuthUser = {
      email: needle,
      name: name ?? '',
      addedAt: new Date().toISOString().split('T')[0],
    };
    users.push(user);
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), 'utf-8');
    return user;
  }

  async removeUser(email: string): Promise<boolean> {
    const users = await this.getUsers();
    const needle = email.toLowerCase();
    const filtered = users.filter((u) => u.email.toLowerCase() !== needle);
    if (filtered.length === users.length) return false;
    await fs.writeFile(this.usersPath, JSON.stringify(filtered, null, 2), 'utf-8');
    return true;
  }
}
