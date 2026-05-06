export default {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || `http://localhost:${process.env.PORT || '3000'}`,
  },

  postgres: {
    url: process.env.DATABASE_URL,
  },

  aws: {
    bucket: process.env.AWS_BUCKET || process.env.BUCKET_NAME || 'llmkb-uploads',
    region: process.env.AWS_REGION || 'us-east-1',
    accessKey: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    /** S3-compatible endpoint (e.g. Fly Tigris, Cloudflare R2, MinIO) */
    endpoint: process.env.AWS_ENDPOINT_URL_S3 || '',
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
    /**
     * Vision model overrides. Used for per-image and per-frame analysis
     * (image ingestion, video keyframe description) — kept separate from the
     * main reasoning model since these run many times per source and benefit
     * from a cheaper/faster tier by default.
     */
    claudeVisionModel: process.env.CLAUDE_VISION_MODEL || 'claude-haiku-4-5-20251001',
    openaiVisionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
    /**
     * Overview model overrides. Used to regenerate the homepage "what this KB
     * covers" summary after wiki writes. Defaults to a cheap tier — this runs
     * once per debounced batch of writes.
     */
    claudeOverviewModel: process.env.CLAUDE_OVERVIEW_MODEL || 'claude-haiku-4-5-20251001',
    openaiOverviewModel: process.env.OPENAI_OVERVIEW_MODEL || 'gpt-4o-mini',
  },

  auth: {
    enabled: process.env.AUTH_ENABLED === 'true',
    readEnabled: process.env.AUTH_READ_ENABLED === 'true',
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
