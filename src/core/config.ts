import fs from 'fs';
import path from 'path';
import type { KBConfig } from '../types/index.js';

const DEFAULTS: KBConfig = {
  name: 'Knowledge Base',
  topic: 'General knowledge',
  description: 'A personal knowledge base.',
  focusPrompt: 'Focus on the most relevant information from the source material',
};

export function loadConfig(rootDir?: string): KBConfig {
  const configPath = path.resolve(rootDir ?? process.cwd(), 'kb.config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}
