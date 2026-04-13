import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import config from '../../config.js';
import { parseAudioBuffer } from './audio.js';
import type { ParsedSource } from '../../types/index.js';

const execFileAsync = promisify(execFile);

/** Maximum number of frames to extract and describe. */
const MAX_FRAMES = 20;
/** Default interval between extracted frames (seconds). */
const DEFAULT_FRAME_INTERVAL = 30;
/** Max concurrent vision API calls for frame description. */
const VISION_CONCURRENCY = 3;

interface FrameDescription {
  timestamp: string;
  seconds: number;
  description: string;
}

/**
 * Parse a video buffer by extracting and transcribing its audio track
 * and describing keyframes with a vision model.
 *
 * Requires ffmpeg/ffprobe installed on the system.
 * Requires an OpenAI API key (for Whisper transcription).
 * Requires an Anthropic or OpenAI API key (for vision frame description).
 */
export async function parseVideoBuffer(
  buffer: Buffer,
  filename?: string,
): Promise<ParsedSource> {
  // Fail fast: check all prerequisites before doing any expensive work
  await ensureFfmpeg();
  ensureVideoApiKeys();

  const tmpDir = path.join(os.tmpdir(), `llmkb-video-${crypto.randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const videoPath = path.join(tmpDir, filename ?? 'input.mp4');
    await fs.writeFile(videoPath, buffer);

    const duration = await getVideoDuration(videoPath);
    console.log(`[video] Duration: ${formatTimestamp(duration)}, processing...`);

    // Extract audio + keyframes in parallel
    const [transcript, frameDescriptions] = await Promise.all([
      extractAndTranscribeAudio(videoPath, tmpDir).catch((err) => {
        console.warn(`[video] Audio extraction failed (video may have no audio track): ${(err as Error).message}`);
        return null;
      }),
      extractAndDescribeFrames(videoPath, tmpDir, duration).catch((err) => {
        console.warn(`[video] Frame description failed: ${(err as Error).message}`);
        return [] as FrameDescription[];
      }),
    ]);

    const fallbackTitle = filename
      ? extractTitleFromFilename(filename)
      : 'Untitled Video';

    // Build structured content
    const sections: string[] = [];

    if (transcript) {
      sections.push(`## Transcript\n\n${transcript}`);
    }

    if (frameDescriptions.length > 0) {
      const lines = frameDescriptions
        .map((f) => `**[${f.timestamp}]** ${f.description}`)
        .join('\n\n');
      sections.push(`## Visual Descriptions\n\n${lines}`);
    }

    if (sections.length === 0) {
      throw new Error(
        `Could not extract any content from video${filename ? ` "${filename}"` : ''}. ` +
          'The file may be corrupted or in an unsupported format.',
      );
    }

    return {
      title: fallbackTitle,
      content: sections.join('\n\n---\n\n'),
      sourceType: 'text',
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

async function ensureFfmpeg(): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error(
      'Video processing requires ffmpeg. Install it:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Docker:  add ffmpeg to your Dockerfile',
    );
  }
}

function ensureVideoApiKeys(): void {
  const missing: string[] = [];

  if (!config.llm.openaiApiKey) {
    missing.push('OPENAI_API_KEY (required for audio transcription via Whisper)');
  }
  if (!config.llm.anthropicApiKey && !config.llm.openaiApiKey) {
    missing.push('ANTHROPIC_API_KEY or OPENAI_API_KEY (required for visual frame description)');
  }

  if (missing.length > 0) {
    throw new Error(
      'Video processing requires the following API keys:\n  ' +
        missing.join('\n  '),
    );
  }
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    videoPath,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

// ---------------------------------------------------------------------------
// Audio extraction + transcription
// ---------------------------------------------------------------------------

async function extractAndTranscribeAudio(
  videoPath: string,
  tmpDir: string,
): Promise<string> {
  const audioPath = path.join(tmpDir, 'audio.mp3');

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn',                  // strip video
    '-acodec', 'libmp3lame',
    '-q:a', '4',            // reasonable quality, smaller file
    '-y',                   // overwrite
    audioPath,
  ], { timeout: 120_000 });

  const audioBuffer = await fs.readFile(audioPath);
  if (audioBuffer.length === 0) {
    throw new Error('Extracted audio track is empty');
  }

  console.log(`[video] Audio extracted (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB), transcribing...`);
  const parsed = await parseAudioBuffer(audioBuffer, 'audio.mp3');
  return parsed.content;
}

// ---------------------------------------------------------------------------
// Frame extraction + vision description
// ---------------------------------------------------------------------------

async function extractAndDescribeFrames(
  videoPath: string,
  tmpDir: string,
  duration: number,
): Promise<FrameDescription[]> {
  if (duration <= 0) return [];

  // Calculate interval so we stay within MAX_FRAMES
  const interval =
    duration <= MAX_FRAMES * DEFAULT_FRAME_INTERVAL
      ? DEFAULT_FRAME_INTERVAL
      : Math.ceil(duration / MAX_FRAMES);

  const framesDir = path.join(tmpDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vf', `fps=1/${interval}`,
    '-q:v', '2',
    '-y',
    path.join(framesDir, 'frame_%04d.jpg'),
  ], { timeout: 120_000 });

  const frameFiles = (await fs.readdir(framesDir))
    .filter((f) => f.endsWith('.jpg'))
    .sort();

  if (frameFiles.length === 0) return [];

  console.log(`[video] Extracted ${frameFiles.length} frames, describing with vision model...`);

  // Process frames in batches to limit concurrency
  const descriptions: FrameDescription[] = [];

  for (let i = 0; i < frameFiles.length; i += VISION_CONCURRENCY) {
    const batch = frameFiles.slice(i, i + VISION_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (file, batchIdx) => {
        const frameIdx = i + batchIdx;
        const seconds = frameIdx * interval;
        const framePath = path.join(framesDir, file);
        const imageBuffer = await fs.readFile(framePath);
        const description = await describeFrame(imageBuffer, seconds, duration);
        return { timestamp: formatTimestamp(seconds), seconds, description };
      }),
    );
    descriptions.push(...results);
  }

  return descriptions;
}

// ---------------------------------------------------------------------------
// Vision API — frame description
// ---------------------------------------------------------------------------

async function describeFrame(
  imageBuffer: Buffer,
  seconds: number,
  totalDuration: number,
): Promise<string> {
  const base64 = imageBuffer.toString('base64');
  const ts = formatTimestamp(seconds);
  const total = formatTimestamp(totalDuration);
  const prompt =
    `Describe this video frame captured at ${ts} of a ${total} video. ` +
    'Focus on: what is shown (people, objects, text on screen, slides, diagrams), ' +
    'any visible text content, and the setting/context. Be concise (2-3 sentences).';

  if (config.llm.anthropicApiKey) {
    return describeWithAnthropic(base64, prompt);
  }
  if (config.llm.openaiApiKey) {
    return describeWithOpenAI(base64, prompt);
  }
  throw new Error(
    'Video frame description requires an Anthropic or OpenAI API key for vision capabilities.',
  );
}

async function describeWithAnthropic(base64: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

async function describeWithOpenAI(base64: string, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.llm.openaiApiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function extractTitleFromFilename(filename: string): string {
  return filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' ');
}
