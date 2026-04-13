import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';

interface KBConfig {
  name: string;
  topic: string;
  description: string;
  focusPrompt: string;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${suffix}: `, (answer) => resolve(answer.trim() || defaultValue || ''));
  });
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value || value.length < 8) return value;
  return value.slice(0, 4) + '...' + value.slice(-4);
}

/** Update .env file with the given key-value pairs. Uncomments lines if needed. */
function updateEnvFile(updates: Record<string, string>) {
  const envPath = '.env';
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, 'utf-8');
  for (const [key, value] of Object.entries(updates)) {
    // Match both commented (#KEY=...) and uncommented (KEY=...) lines
    const regex = new RegExp(`^#?${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `${key}=${value}\n`;
    }
  }
  fs.writeFileSync(envPath, content);
}

async function main() {
  console.log('\n--- Knowledge Base Setup ---\n');

  // Load existing config as defaults if present
  let defaults: Partial<KBConfig> = {};
  try {
    defaults = JSON.parse(fs.readFileSync('kb.config.json', 'utf-8'));
  } catch {
    // No existing config — start fresh
  }

  const name = await ask('KB display name', defaults.name);
  const topic = await ask('Topic this KB covers', defaults.topic);
  const description = await ask('One-line description of scope', defaults.description);
  const focusPrompt = await ask(
    'LLM focus instruction (guides what the AI extracts from sources)',
    defaults.focusPrompt || `Focus on information relevant to ${topic}`
  );

  const config: KBConfig = { name, topic, description, focusPrompt };

  // 1. Write kb.config.json
  fs.writeFileSync('kb.config.json', JSON.stringify(config, null, 2) + '\n');
  console.log('\n  Created kb.config.json');

  // 2. Generate CLAUDE.md from template
  const templatePath = 'CLAUDE.md.template';
  if (fs.existsSync(templatePath)) {
    let template = fs.readFileSync(templatePath, 'utf-8');
    template = template
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{topic\}\}/g, topic)
      .replace(/\{\{description\}\}/g, description);
    fs.writeFileSync('CLAUDE.md', template);
    console.log('  Generated CLAUDE.md from template');
  }

  // 3. Create .env from .env.example if .env doesn't exist
  if (!fs.existsSync('.env') && fs.existsSync('.env.example')) {
    fs.copyFileSync('.env.example', '.env');
    console.log('  Created .env from .env.example');
  }

  // 4. Interactive .env configuration
  const envUpdates: Record<string, string> = {};

  // --- LLM Provider ---
  console.log('\n--- LLM Configuration ---\n');
  const llmProvider = await ask('LLM provider (claude or openai)', process.env.LLM_PROVIDER || 'claude');
  envUpdates.LLM_PROVIDER = llmProvider;

  if (llmProvider === 'claude') {
    const existingKey = process.env.ANTHROPIC_API_KEY;
    const apiKey = await ask('Anthropic API key', maskSecret(existingKey));
    // Only write if user entered a real key (not the masked version)
    if (apiKey && apiKey !== maskSecret(existingKey)) {
      envUpdates.ANTHROPIC_API_KEY = apiKey;
    } else if (existingKey) {
      console.log('  (keeping existing key)');
    }
  } else if (llmProvider === 'openai') {
    const existingKey = process.env.OPENAI_API_KEY;
    const apiKey = await ask('OpenAI API key', maskSecret(existingKey));
    if (apiKey && apiKey !== maskSecret(existingKey)) {
      envUpdates.OPENAI_API_KEY = apiKey;
    } else if (existingKey) {
      console.log('  (keeping existing key)');
    }
  }

  // --- Storage Backend ---
  console.log('\n--- Storage Backend ---\n');
  const storageBackend = await ask(
    'Storage backend (filesystem or database)',
    process.env.STORAGE_BACKEND || 'filesystem'
  );
  envUpdates.STORAGE_BACKEND = storageBackend;

  if (storageBackend === 'database') {
    const dbUrl = await ask(
      'PostgreSQL URL',
      process.env.DATABASE_URL || 'postgres://llmkb:llmkb@localhost:5433/llmkb'
    );
    envUpdates.DATABASE_URL = dbUrl;

    const bucket = await ask('AWS S3 bucket name', process.env.AWS_BUCKET || 'llmkb-uploads');
    envUpdates.AWS_BUCKET = bucket;

    const region = await ask('AWS region', process.env.AWS_REGION || 'us-east-1');
    envUpdates.AWS_REGION = region;

    console.log('  Note: AWS credentials fall back to IAM roles if not set in .env');
  }

  // --- ChromaDB ---
  console.log('\n--- ChromaDB (vector search) ---\n');
  const existingChromaApiKey = process.env.CHROMA_API_KEY;
  const useChromaCloud = await ask(
    'Use Chroma Cloud? (y/n)',
    existingChromaApiKey ? 'y' : 'n'
  );

  if (useChromaCloud.toLowerCase() === 'y') {
    const chromaApiKey = await ask('Chroma API key', maskSecret(existingChromaApiKey));
    if (chromaApiKey && chromaApiKey !== maskSecret(existingChromaApiKey)) {
      envUpdates.CHROMA_API_KEY = chromaApiKey;
    }
    const chromaTenant = await ask('Chroma tenant', process.env.CHROMA_TENANT);
    if (chromaTenant) envUpdates.CHROMA_TENANT = chromaTenant;
    const chromaDb = await ask('Chroma database', process.env.CHROMA_DATABASE || 'default');
    if (chromaDb) envUpdates.CHROMA_DATABASE = chromaDb;
  } else {
    const chromaUrl = await ask(
      'ChromaDB URL (docker compose starts one automatically)',
      process.env.CHROMA_URL || 'http://localhost:8930'
    );
    envUpdates.CHROMA_URL = chromaUrl;
  }

  // --- Auth ---
  console.log('\n--- Authentication (optional) ---\n');
  const enableAuth = await ask(
    'Enable Google OAuth authentication? (y/n)',
    process.env.AUTH_ENABLED === 'true' ? 'y' : 'n'
  );

  if (enableAuth.toLowerCase() === 'y') {
    envUpdates.AUTH_ENABLED = 'true';

    const existingClientId = process.env.GOOGLE_CLIENT_ID;
    const clientId = await ask('Google OAuth client ID', maskSecret(existingClientId));
    if (clientId && clientId !== maskSecret(existingClientId)) {
      envUpdates.GOOGLE_CLIENT_ID = clientId;
    }

    const existingClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const clientSecret = await ask('Google OAuth client secret', maskSecret(existingClientSecret));
    if (clientSecret && clientSecret !== maskSecret(existingClientSecret)) {
      envUpdates.GOOGLE_CLIENT_SECRET = clientSecret;
    }

    if (!process.env.JWT_SECRET) {
      const { randomBytes } = await import('crypto');
      const jwtSecret = randomBytes(32).toString('hex');
      envUpdates.JWT_SECRET = jwtSecret;
      console.log('  Generated JWT_SECRET automatically');
    }

    const host = await ask('Public URL (for OAuth callback)', process.env.HOST || 'http://localhost:3000');
    envUpdates.HOST = host;
  } else {
    envUpdates.AUTH_ENABLED = 'false';
  }

  // Write all env updates
  updateEnvFile(envUpdates);
  console.log('\n  Updated .env');

  // 5. Bootstrap storage
  if (storageBackend === 'database') {
    console.log('\n  Storage backend: database (Postgres + S3)');
    console.log('  Skipping local directory creation — data lives in Postgres/S3.');
    console.log('  Run: npm run migrate');
  } else {
    // Ensure data directory structure exists
    const dirs = [
      'data/raw/articles',
      'data/raw/papers',
      'data/raw/text',
      'data/wiki/concepts',
      'data/wiki/entities',
      'data/wiki/sources',
      'data/wiki/syntheses',
      'data/wiki/outputs',
      'data/uploads',
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
    console.log('  Created data directory structure');

    // Create initial wiki files if they don't exist
    const today = new Date().toISOString().split('T')[0];

    const indexPath = 'data/wiki/index.md';
    if (!fs.existsSync(indexPath)) {
      const indexContent = [
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
      ].join('\n');
      fs.writeFileSync(indexPath, indexContent);
      console.log('  Created data/wiki/index.md');
    }

    const logPath = 'data/wiki/log.md';
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '# Wiki Log\n');
      console.log('  Created data/wiki/log.md');
    }
  }

  console.log('\nSetup complete! Run "docker compose up --build" or "npm run dev" to start.\n');
  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
