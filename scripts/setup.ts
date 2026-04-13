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
    console.log('  Created .env from .env.example — edit it to add your API keys');
  }

  // 4. Bootstrap storage
  const storageBackend = process.env.STORAGE_BACKEND || 'filesystem';

  if (storageBackend === 'database') {
    console.log('\n  Storage backend: database (Postgres + S3)');
    console.log('  Skipping local directory creation — data lives in Postgres/S3.');

    if (!process.env.DATABASE_URL) {
      console.log('  ⚠  DATABASE_URL is not set — add it to .env (e.g. postgres://llmkb:llmkb@localhost:5433/llmkb)');
    } else {
      console.log('  ✓  DATABASE_URL detected');
    }

    if (!process.env.AWS_BUCKET) {
      console.log('  ⚠  AWS_BUCKET is not set — add it to .env for upload storage');
    } else {
      console.log('  ✓  AWS_BUCKET detected');
    }

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

  // 5. Validate LLM provider config
  const llmProvider = process.env.LLM_PROVIDER || 'claude';
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  console.log(`\n  LLM provider: ${llmProvider}`);
  if (llmProvider === 'claude' && !hasAnthropicKey) {
    console.log('  ⚠  ANTHROPIC_API_KEY is not set — add it to .env before starting');
  } else if (llmProvider === 'openai' && !hasOpenAIKey) {
    console.log('  ⚠  OPENAI_API_KEY is not set — add it to .env before starting');
  } else {
    console.log('  ✓  API key detected');
  }

  // 6. Validate ChromaDB config
  const chromaApiKey = process.env.CHROMA_API_KEY;
  const chromaTenant = process.env.CHROMA_TENANT;
  const chromaUrl = process.env.CHROMA_URL;

  console.log('\n  ChromaDB (required for embeddings/search):');
  if (chromaApiKey && chromaTenant) {
    console.log('  ✓  Chroma Cloud credentials detected (API key + tenant)');
  } else if (chromaUrl) {
    console.log(`  ✓  Local/self-hosted Chroma at ${chromaUrl}`);
    console.log('     Make sure ChromaDB is running, or use "docker compose up" which starts it automatically');
  } else {
    console.log('  ⚠  No Chroma config detected — set CHROMA_URL for local, or CHROMA_API_KEY + CHROMA_TENANT for Cloud');
    console.log('     "docker compose up" starts a local instance automatically (mapped to port 8930)');
    console.log('     For standalone local dev, set CHROMA_URL=http://localhost:8930 in .env');
  }

  console.log('\nSetup complete! Run "docker compose up --build" or "npm run dev" to start.\n');
  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
