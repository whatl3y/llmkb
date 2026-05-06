import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import config from '../../config.js';
import type { ParsedSource } from '../../types/index.js';

/**
 * Image media types that both Anthropic and OpenAI vision APIs accept directly.
 * These are also the most widely supported image formats on the web.
 */
const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

const EXT_TO_MEDIA_TYPE: Record<string, SupportedMediaType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

interface ImageAnalysis {
  description: string;
  ocrText: string;
  sentiment: string;
  tags: string[];
}

/**
 * Parse an image buffer by sending it to a vision LLM for description,
 * OCR text extraction, and sentiment/tone analysis in a single call.
 *
 * Requires an Anthropic or OpenAI API key.
 */
export async function parseImageBuffer(
  buffer: Buffer,
  filename?: string,
): Promise<ParsedSource> {
  ensureVisionApiKeys();

  const mediaType = detectMediaType(buffer, filename);
  const analysis = await analyzeImage(buffer, mediaType);

  const fallbackTitle = filename
    ? extractTitleFromFilename(filename)
    : 'Untitled Image';

  const sections: string[] = [];

  if (analysis.description.trim()) {
    sections.push(`## Description\n\n${analysis.description.trim()}`);
  }

  if (analysis.ocrText.trim()) {
    sections.push(`## Extracted Text (OCR)\n\n${analysis.ocrText.trim()}`);
  }

  if (analysis.sentiment.trim()) {
    sections.push(`## Sentiment & Tone\n\n${analysis.sentiment.trim()}`);
  }

  if (analysis.tags.length > 0) {
    sections.push(`## Visual Tags\n\n${analysis.tags.map((t) => `- ${t}`).join('\n')}`);
  }

  if (sections.length === 0) {
    throw new Error(
      `Could not extract any content from image${filename ? ` "${filename}"` : ''}.`,
    );
  }

  return {
    title: fallbackTitle,
    content: sections.join('\n\n---\n\n'),
    sourceType: 'text',
  };
}

function ensureVisionApiKeys(): void {
  if (!config.llm.anthropicApiKey && !config.llm.openaiApiKey) {
    throw new Error(
      'Image analysis requires an Anthropic or OpenAI API key (vision capability). ' +
        'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.',
    );
  }
}

function detectMediaType(buffer: Buffer, filename?: string): SupportedMediaType {
  // Prefer magic-byte sniffing (filename can lie or be missing) and
  // fall back to extension if the bytes are inconclusive.
  const sniffed = sniffMediaType(buffer);
  if (sniffed) return sniffed;

  if (filename) {
    const ext = path.extname(filename).toLowerCase().slice(1);
    const fromExt = EXT_TO_MEDIA_TYPE[ext];
    if (fromExt) return fromExt;
  }

  throw new Error(
    `Unsupported image format${filename ? ` for "${filename}"` : ''}. ` +
      'Supported formats: JPEG, PNG, GIF, WebP.',
  );
}

/**
 * Detect image media type from magic bytes for the four formats accepted
 * by Anthropic and OpenAI vision APIs.
 */
function sniffMediaType(buffer: Buffer): SupportedMediaType | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

async function analyzeImage(
  buffer: Buffer,
  mediaType: SupportedMediaType,
): Promise<ImageAnalysis> {
  const base64 = buffer.toString('base64');
  const prompt = buildAnalysisPrompt();

  const raw = config.llm.anthropicApiKey
    ? await analyzeWithAnthropic(base64, mediaType, prompt)
    : await analyzeWithOpenAI(base64, mediaType, prompt);

  return parseAnalysisResponse(raw);
}

function buildAnalysisPrompt(): string {
  return `Analyze this image and respond with ONLY valid JSON — no markdown fences, no commentary.

The JSON must have this exact structure:
{
  "description": "string — a thorough 2-5 sentence description of what the image depicts: subjects, objects, setting, composition, notable visual elements, and overall context",
  "ocrText": "string — ALL text visible in the image, transcribed verbatim and preserving line breaks where reasonable. Include text from signs, labels, captions, slides, screenshots, handwriting, watermarks, etc. If the image contains no text, return an empty string",
  "sentiment": "string — 1-3 sentences describing the mood, tone, and emotional quality of the image (e.g., cheerful, somber, professional, playful, tense, peaceful). Comment on what visual cues drive that impression",
  "tags": ["string array of 3-10 short kebab-case tags describing the image content (e.g., 'whiteboard-diagram', 'outdoor-landscape', 'product-photo', 'screenshot', 'handwritten-notes')"]
}

Be precise. Do not invent text that is not actually visible.`;
}

async function analyzeWithAnthropic(
  base64: string,
  mediaType: SupportedMediaType,
  prompt: string,
): Promise<string> {
  const client = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  const response = await client.messages.create({
    model: config.llm.claudeVisionModel,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  const block = response.content[0];
  return block?.type === 'text' ? block.text : '';
}

async function analyzeWithOpenAI(
  base64: string,
  mediaType: SupportedMediaType,
  prompt: string,
): Promise<string> {
  const client = new OpenAI({ apiKey: config.llm.openaiApiKey });
  const response = await client.chat.completions.create({
    model: config.llm.openaiVisionModel,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

function parseAnalysisResponse(raw: string): ImageAnalysis {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed: Partial<ImageAnalysis>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Vision LLM returned invalid JSON: ${(err as Error).message}\n\nRaw response:\n${raw.slice(0, 500)}`,
    );
  }

  return {
    description: typeof parsed.description === 'string' ? parsed.description : '',
    ocrText: typeof parsed.ocrText === 'string' ? parsed.ocrText : '',
    sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : '',
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

function extractTitleFromFilename(filename: string): string {
  return filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' ');
}
