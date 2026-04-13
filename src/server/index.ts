import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';

import config from '../config.js';
import { createProviderFromEnv } from '../core/llm/factory.js';
import { SearchService, type ChromaAuthOptions, type ChromaCloudOptions } from '../core/search.js';
import { IngestService } from '../core/ingest.js';
import { QueryService } from '../core/query.js';
import { IntentService } from '../core/intent.js';
import { LintService } from '../core/lint.js';
import { loadConfig } from '../core/config.js';
import { UserStore } from '../core/auth.js';
import { createStorageBackend } from '../core/storage/index.js';

import { createWikiRouter } from './routes/wiki.js';
import { createIngestRouter } from './routes/ingest.js';
import { createQueryRouter } from './routes/query.js';
import { createSearchRouter } from './routes/search.js';
import { createLintRouter } from './routes/lint.js';
import { createConfigRouter } from './routes/config.js';
import { createIntentRouter } from './routes/intent.js';
import { createAuthRouter } from './routes/auth.js';
import { createRequireIngestAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Load KB config
  const kbConfig = loadConfig();

  // Create the storage backend (filesystem or database+S3)
  const storage = await createStorageBackend();
  await storage.initialize(kbConfig.topic);

  console.log(`[init] Storage backend: ${config.storage.backend}`);

  // Validate auth config if enabled
  if (config.auth.enabled) {
    const missing: string[] = [];
    if (!config.auth.googleClientId) missing.push('GOOGLE_CLIENT_ID');
    if (!config.auth.googleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    if (!config.auth.jwtSecret) missing.push('JWT_SECRET');
    if (missing.length > 0) {
      console.error(`[auth] AUTH_ENABLED=true but missing required env vars: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  // Initialize auth user store
  const userStore = config.auth.enabled ? new UserStore(storage) : null;

  // Initialize services
  const llm = createProviderFromEnv();
  const chromaAuth: ChromaAuthOptions | undefined = config.chroma.token
    ? { provider: 'token', credentials: config.chroma.token }
    : undefined;
  const chromaCloud: ChromaCloudOptions | undefined = config.chroma.apiKey && config.chroma.tenant
    ? { apiKey: config.chroma.apiKey, tenant: config.chroma.tenant, database: config.chroma.database }
    : undefined;
  const search = new SearchService(config.chroma.url, 'wiki', chromaAuth, chromaCloud);
  const ingest = llm ? new IngestService(llm, search, storage, kbConfig) : null;
  const query = llm ? new QueryService(llm, search, storage, kbConfig) : null;
  const intent = llm ? new IntentService(llm) : null;
  const lint = new LintService(storage, kbConfig);

  console.log(`[init] KB: ${kbConfig.name} — ${kbConfig.topic}`);
  console.log(`[init] LLM provider: ${llm ? `${llm.name} (${llm.model})` : 'NONE — set an API key to enable ingest/query'}`);
  console.log(`[init] ChromaDB: ${chromaCloud ? `Cloud (tenant=${config.chroma.tenant}, db=${config.chroma.database})` : config.chroma.url}`);
  console.log(`[init] Auth: ${config.auth.enabled ? 'enabled' : 'disabled'}`);

  // Create Express app
  const app = express();
  app.use(cors({ credentials: true, origin: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '50mb' }));

  // Auth routes (mounted before API routes — no auth middleware on these)
  if (config.auth.enabled && userStore) {
    app.use('/auth', createAuthRouter({
      googleClientId: config.auth.googleClientId,
      googleClientSecret: config.auth.googleClientSecret,
      jwtSecret: config.auth.jwtSecret,
      host: config.server.host,
      userStore,
    }));
  }

  // Auth middleware for ingest routes
  const requireIngestAuth = createRequireIngestAuth(config.auth.enabled, config.auth.jwtSecret, userStore);

  // Middleware that rejects requests when LLM is not configured
  const requireLLM: express.RequestHandler = (_req, res, next) => {
    if (!llm) {
      res.status(503).json({ success: false, error: 'LLM provider not configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY' });
      return;
    }
    next();
  };

  // API routes
  app.use('/api/config', createConfigRouter({ config: kbConfig, authEnabled: config.auth.enabled, jwtSecret: config.auth.jwtSecret, userStore }));
  app.use('/api/wiki', createWikiRouter(storage));
  app.use('/api/ingest', requireLLM, requireIngestAuth, createIngestRouter(ingest!));
  app.use('/api/query', requireLLM, createQueryRouter(query!, llm!));
  app.use('/api/search', createSearchRouter(search, storage));
  app.use('/api/intent', requireLLM, createIntentRouter(intent!));
  app.use('/api/lint', createLintRouter(lint));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', provider: llm?.name ?? null, model: llm?.model ?? null, storage: config.storage.backend } });
  });

  // Serve frontend if the built files exist (production / Docker)
  // In development, Vite dev server handles the frontend instead
  const staticDir = path.join(__dirname, '../../dist/web');
  const indexHtml = path.join(staticDir, 'index.html');
  try {
    const { statSync } = await import('fs');
    if (statSync(indexHtml).isFile()) {
      app.use(express.static(staticDir));
      app.get('*', (_req, res) => {
        res.sendFile(indexHtml);
      });
    }
  } catch {
    // dist/web not built yet — frontend served by Vite dev server
  }

  // Error handler
  app.use(errorHandler);

  // Start file watcher for auto-ingestion (filesystem backend only, requires LLM)
  if (config.watchRaw && config.storage.backend === 'filesystem' && ingest) {
    const rawDir = path.join(path.resolve(config.storage.dataDir), 'raw');
    const watcher = chokidar.watch(rawDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
      ignored: /(^|[/\\])\../, // ignore dotfiles
    });

    watcher.on('add', async (filePath) => {
      if (filePath.endsWith('.gitkeep')) return;
      console.log(`[watcher] New file detected: ${filePath}`);
      try {
        await ingest.processFile(filePath);
        console.log(`[watcher] Successfully ingested: ${filePath}`);
      } catch (err) {
        console.error(`[watcher] Failed to ingest ${filePath}:`, (err as Error).message);
      }
    });

    console.log(`[init] Watching ${rawDir} for new files`);
  }

  app.listen(config.server.port, () => {
    console.log(`[init] Server running at http://localhost:${config.server.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
