# LLM Knowledge Base

An AI-powered personal knowledge base that ingests source material (URLs, PDFs, text, documents), uses an LLM to extract concepts and entities, and compiles everything into a searchable, interlinked wiki. Comes with a React web UI for browsing, querying, and managing your knowledge base.

## Quick Start

```bash
# 1. Clone and set up
git clone <repo-url> my-kb
cd my-kb
./create-kb.sh          # runs npm install + interactive setup

# 2. Add your API key
#    Edit .env and set ANTHROPIC_API_KEY or OPENAI_API_KEY

# 3. Run
docker compose up --build    # recommended (includes ChromaDB)
# OR
npm run dev                  # requires ChromaDB running separately
```

Open [http://localhost:3000](http://localhost:3000) (Docker) or [http://localhost:5173](http://localhost:5173) (dev mode).

## How It Works

```
Source Material           LLM Processing              Wiki
─────────────           ───────────────              ────
URL / PDF / text  ──>   Extract concepts,   ──>   Interlinked markdown
  .docx / .pptx         entities, summaries        pages with frontmatter
  .xlsx / .csv                                     + ChromaDB vector index
```

1. **Ingest** -- Drop a file into `data/raw/`, paste a URL, or upload through the web UI. The app parses the content, sends it to the LLM, and writes structured wiki pages (source summaries, concepts, entities) with `[[wikilinks]]` between them.
2. **Search** -- All pages are indexed in ChromaDB for semantic search.
3. **Query** -- Ask a question in natural language. The app retrieves relevant pages via semantic search, then uses the LLM to synthesize an answer with citations. Answers stream back in real time.
4. **Lint** -- Run a health check to find broken links, orphan pages, missing frontmatter, and stale content.

## Storage Backends

The app supports two storage backends, controlled by the `STORAGE_BACKEND` env var:

### Filesystem (default)

All data lives in a local `data/` directory as markdown files, JSON indexes, and binary uploads. No external dependencies beyond ChromaDB. Good for local development and single-machine deployments with persistent disk.

### Database (Postgres + S3)

Wiki pages, metadata, and auth users live in **PostgreSQL**. Original uploaded files (PDFs, docs) live in **AWS S3**. Designed for ephemeral environments (containers, serverless) where the local filesystem isn't persistent.

```bash
# Switch to database backend
STORAGE_BACKEND=database
DATABASE_URL=postgres://user:pass@localhost:5433/llmkb
AWS_BUCKET=my-kb-uploads

# Run migrations (local dev)
npm run migrate

# Or just docker compose up — migrations run automatically
docker compose up --build
```

The two backends are interchangeable — the app uses a `StorageBackend` interface that abstracts all I/O. Switching backends doesn't require any code changes.

### Migrating Existing Data

If you already have data in `data/` and want to move to the database backend:

```bash
# 1. Ensure DATABASE_URL and AWS_BUCKET are set in .env
# 2. Run schema migrations
npm run migrate

# 3. Migrate data from data/ into Postgres + S3 + re-index ChromaDB
npm run migrate-data

# 4. Switch backend
#    Set STORAGE_BACKEND=database in .env and restart
```

The migration script is idempotent — it upserts into Postgres and S3, so running it multiple times is safe.

### Re-indexing ChromaDB

If the ChromaDB vector index is lost or out of sync, rebuild it from the storage backend:

```bash
# Via API
curl -X POST http://localhost:3000/api/search/reindex
```

This reads all wiki pages from whichever storage backend is active and re-indexes them into ChromaDB.

## Setup

### Prerequisites

- **Node.js** >= 20
- **Docker** (recommended, runs ChromaDB automatically)
- An API key for **Claude** (Anthropic) or **OpenAI**

### Interactive Setup

```bash
npm run setup
```

Prompts you for a KB name, topic, description, and LLM focus instruction. Writes `kb.config.json` and generates `CLAUDE.md` from the template.

### Create a New KB From This Template

```bash
# Into a new directory (clones via degit)
./create-kb.sh my-cooking-kb

# With explicit repo URL
./create-kb.sh my-cooking-kb https://github.com/you/your-template
```

## Configuration

### Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| **LLM** | | |
| `LLM_PROVIDER` | `claude` | `claude` or `openai` |
| `ANTHROPIC_API_KEY` | -- | Required if provider is `claude` |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Any Claude model ID |
| `OPENAI_API_KEY` | -- | Required if provider is `openai` |
| `OPENAI_MODEL` | `gpt-4o` | Any OpenAI model ID |
| **ChromaDB** | | |
| `CHROMA_URL` | `http://localhost:8930` | ChromaDB endpoint |
| `CHROMA_PORT` | `8930` | Host port for ChromaDB container |
| `CHROMA_TOKEN` | -- | Auth token for remote/cloud ChromaDB (omit for local) |
| `CHROMA_TOKEN_HEADER` | `AUTHORIZATION` | `AUTHORIZATION` or `X_CHROMA_TOKEN` (Chroma Cloud) |
| **Storage** | | |
| `STORAGE_BACKEND` | `filesystem` | `filesystem` (local files) or `database` (Postgres + S3) |
| `DATA_DIR` | `./data` | Path to data directory (filesystem backend) |
| `DATABASE_URL` | -- | Postgres connection string (required for database backend) |
| `AWS_BUCKET` | `llmkb-uploads` | S3 bucket for uploaded source files (database backend) |
| `AWS_REGION` | `us-east-1` | AWS region |
| `AWS_ACCESS_KEY_ID` | -- | AWS credentials (optional — falls back to IAM roles) |
| `AWS_SECRET_ACCESS_KEY` | -- | AWS credentials (optional — falls back to IAM roles) |
| **Server** | | |
| `PORT` | `3000` | Server port |
| `WATCH_RAW` | `true` | Auto-ingest files dropped in `data/raw/` (filesystem backend only) |
| **Auth** | | |
| `AUTH_ENABLED` | `false` | Set to `true` to require Google OAuth for ingestion |
| `GOOGLE_CLIENT_ID` | -- | Google OAuth client ID (required when auth enabled) |
| `GOOGLE_CLIENT_SECRET` | -- | Google OAuth client secret (required when auth enabled) |
| `JWT_SECRET` | -- | Secret for signing session tokens (required when auth enabled) |
| `HOST` | `http://localhost:<PORT>` | Base URL for OAuth callbacks |

### KB Config (`kb.config.json`)

```json
{
  "name": "My Wiki",
  "topic": "Cooking techniques",
  "description": "Covers knife skills, heat control, fermentation, and plating.",
  "focusPrompt": "Focus on practical techniques and the science behind them"
}
```

The `focusPrompt` guides what the LLM extracts from every source you ingest.

## Authentication (Optional)

By default, the KB is open — anyone can search, query, and ingest. To restrict ingestion to authorized users:

### 1. Set up Google OAuth

Create an OAuth 2.0 client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with the authorized redirect URI set to `<HOST>/auth/callback/google` (e.g., `http://localhost:3000/auth/callback/google`).

### 2. Configure environment

```bash
AUTH_ENABLED=true
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
HOST=http://localhost:3000   # or your production URL
```

### 3. Add authorized users

```bash
npm run add-user -- alice@gmail.com "Alice"
npm run add-user -- bob@example.com "Bob"
```

With the filesystem backend, users are stored in `data/auth/users.json`. With the database backend, users are stored in the `users` table in Postgres.

### How it works

- **Auth off** (default): full access for everyone, no login UI
- **Auth on, not signed in**: read-only access (search, query, browse); ingest UI is hidden; API returns 401 on ingest endpoints
- **Auth on, signed in**: full access including ingestion

A user icon appears in the top-right corner (next to the theme toggle) when auth is enabled. Clicking it opens a login page where users authenticate via Google. Only whitelisted emails can sign in. Sessions last 30 days via a signed JWT stored in an HttpOnly cookie.

## Project Structure

```
src/
  config.ts            # Centralized env-var config (postgres, aws, storage, auth, etc.)
  libs/
    aws.ts             # S3 factory — upload, download, delete, stream with backoff
  database/
    database.ts        # Kysely + pg Pool, lazy Proxy pattern, smart SSL detection
    types.ts           # Kysely table type definitions
    migrate.ts         # Migration runner (npm run migrate)
    migrations/        # Numbered migration files (001_initial.ts, ...)
  core/
    storage/
      types.ts         # StorageBackend interface
      filesystem.ts    # FileSystemStorage — local data/ directory
      database.ts      # DatabaseStorage — Postgres + S3
      index.ts         # Factory: picks backend from STORAGE_BACKEND env var
    ingest.ts          # Source parsing + LLM extraction + wiki page writing
    query.ts           # Semantic search + LLM-synthesized answers
    search.ts          # ChromaDB vector search wrapper
    keyword-search.ts  # Keyword-based search across wiki pages
    intent.ts          # LLM-based intent classification for the unified input
    lint.ts            # Wiki health checks (broken links, orphans, stale pages)
    auth.ts            # UserStore — delegates to StorageBackend
    config.ts          # Loads kb.config.json
    llm/
      factory.ts       # Creates Claude or OpenAI provider from env
      claude.ts        # Anthropic SDK wrapper
      openai.ts        # OpenAI SDK wrapper
    parser/
      url.ts           # Fetches + extracts text from web pages (cheerio)
      pdf.ts           # PDF text extraction (pdf-parse)
      text.ts          # Plain text / markdown files
      document.ts      # .docx / .doc (mammoth, word-extractor)
      presentation.ts  # .pptx (pptx-parser, officeparser)
      spreadsheet.ts   # .xlsx / .csv (xlsx)
  server/
    index.ts           # Express server, storage init, file watcher, static serving
    routes/            # REST API endpoints (ingest, query, search, wiki, lint, config, intent)
    middleware/         # Auth + error handler
  web/
    App.tsx            # React app — dashboard, unified input, wiki browser
    api.ts             # Frontend API client (fetch + SSE streaming)
    components/        # Dashboard, search, query, ingest, wiki page views
    contexts/          # Ingest progress context
scripts/
  docker-entrypoint.sh # Runs migrations (if database mode) then starts server
  setup.ts             # Interactive KB config wizard
  add-user.ts          # Add an authorized user via CLI
data/                  # (filesystem backend only)
  raw/                 # Drop source files here (articles/, papers/, text/)
  wiki/                # Generated wiki pages
    index.md           # Master index
    log.md             # Append-only changelog
    concepts/          # One page per concept
    entities/          # People, orgs, tools
    sources/           # One summary per ingested source
    syntheses/         # Cross-cutting analysis
    outputs/           # Saved query answers + lint reports
  uploads/             # Original source files preserved for download
```

## npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start server + Vite dev server concurrently |
| `npm run build` | Build the React frontend |
| `npm start` | Production server (serves built frontend) |
| `npm run setup` | Interactive KB configuration wizard |
| `npm run migrate` | Run Postgres schema migrations (database backend) |
| `npm run migrate-data` | Migrate data from `data/` into Postgres + S3 |
| `npm run add-user -- <email> [name]` | Add an authorized user (when auth enabled) |
| `npm run create` | Bootstrap a new KB (`create-kb.sh`) |
| `npm test` | Run tests (vitest) |
| `npm run docker:up` | Build and start with Docker Compose |
| `npm run docker:down` | Stop Docker Compose services |
| `npm run docker:test` | Run tests inside Docker (with ChromaDB) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (returns provider + model) |
| `GET` | `/api/config` | KB name, topic, description, auth state |
| `GET` | `/auth/login/google` | Initiate Google OAuth flow |
| `GET` | `/auth/callback/google` | OAuth callback (internal) |
| `POST` | `/auth/logout` | Clear session |
| `GET` | `/auth/me` | Current authenticated user |
| `GET` | `/api/wiki/stats` | Page counts + recent activity |
| `GET` | `/api/wiki/pages` | List all wiki pages with metadata |
| `GET` | `/api/wiki/page/:type/:slug` | Read a single wiki page |
| `GET` | `/api/wiki/index` | Read the master index |
| `GET` | `/api/wiki/download/:path` | Download original source file |
| `POST` | `/api/ingest/url` | Ingest a URL |
| `POST` | `/api/ingest/text` | Ingest raw text |
| `POST` | `/api/ingest/files` | Upload files (SSE progress stream) |
| `POST` | `/api/query` | Ask a question (JSON response) |
| `POST` | `/api/query/stream` | Ask a question (SSE streaming response) |
| `POST` | `/api/search` | Semantic search |
| `POST` | `/api/search/reindex` | Rebuild ChromaDB index from storage backend |
| `POST` | `/api/intent` | Classify user input intent |
| `POST` | `/api/lint` | Run wiki health check |

## Supported File Formats

- **Web pages** -- paste a URL
- **PDF** -- `.pdf`
- **Documents** -- `.docx`, `.doc`
- **Presentations** -- `.pptx`
- **Spreadsheets** -- `.xlsx`, `.csv`
- **Text** -- `.txt`, `.md`, and other plain text

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

If you modify this software and make it available over a network, you must release your source code under the same license. For commercial licensing options, contact the author.
