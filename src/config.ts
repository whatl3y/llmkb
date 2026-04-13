export default {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || `http://localhost:${process.env.PORT || '3000'}`,
  },

  postgres: {
    url: process.env.DATABASE_URL,
  },

  aws: {
    bucket: process.env.AWS_BUCKET || 'llmkb-uploads',
    region: process.env.AWS_REGION || 'us-east-1',
    accessKey: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },

  chroma: {
    // Local/self-hosted
    url: process.env.CHROMA_URL || 'http://localhost:8930',
    token: process.env.CHROMA_TOKEN,
    // Cloud — when apiKey + tenant are set, CloudClient is used
    apiKey: process.env.CHROMA_API_KEY,
    tenant: process.env.CHROMA_TENANT,
    database: process.env.CHROMA_DATABASE,
  },

  llm: {
    provider: (process.env.LLM_PROVIDER || 'claude') as 'claude' | 'openai',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || '',
  },

  auth: {
    enabled: process.env.AUTH_ENABLED === 'true',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    jwtSecret: process.env.JWT_SECRET || '',
  },

  storage: {
    /** "filesystem" (default) or "database" (Postgres + S3) */
    backend: (process.env.STORAGE_BACKEND || 'filesystem') as 'filesystem' | 'database',
    /** Local data directory — used by filesystem backend and as fallback */
    dataDir: process.env.DATA_DIR || './data',
  },

  watchRaw: process.env.WATCH_RAW !== 'false',
};
