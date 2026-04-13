import { vi } from 'vitest';

// Set test environment variables
process.env.LLM_PROVIDER = 'claude';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.CHROMA_URL = 'http://localhost:8000';
process.env.DATA_DIR = '/tmp/llm-kb-test';

// Suppress console output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
