import OpenAI from 'openai';
import config from '../../config.js';
import type { ParsedSource } from '../../types/index.js';

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25 MB API limit

/**
 * Transcribe an audio buffer using OpenAI Whisper API.
 * For files over 25 MB the buffer is split into ≤24 MB chunks and
 * each chunk is transcribed separately, then concatenated.
 */
export async function parseAudioBuffer(
  buffer: Buffer,
  filename?: string,
): Promise<ParsedSource> {
  const apiKey = config.llm.openaiApiKey;
  if (!apiKey) {
    throw new Error(
      'Audio transcription requires an OpenAI API key. Set OPENAI_API_KEY in your environment.',
    );
  }

  const client = new OpenAI({ apiKey });
  const fallbackTitle = filename
    ? extractTitleFromFilename(filename)
    : 'Untitled Audio';

  let transcript: string;

  if (buffer.length <= WHISPER_MAX_BYTES) {
    transcript = await transcribeChunk(client, buffer, filename ?? 'audio.mp3');
  } else {
    // Split into chunks just under the limit and transcribe sequentially
    // (sequential to preserve ordering)
    const chunks = splitBuffer(buffer, WHISPER_MAX_BYTES - 1024 * 1024); // 24 MB chunks
    const parts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const ext = filename ? filename.split('.').pop() : 'mp3';
      const chunkName = `chunk_${i}.${ext}`;
      console.log(
        `[audio] Transcribing chunk ${i + 1}/${chunks.length} (${(chunks[i].length / 1024 / 1024).toFixed(1)} MB)`,
      );
      const part = await transcribeChunk(client, chunks[i], chunkName);
      parts.push(part);
    }

    transcript = parts.join('\n\n');
  }

  if (!transcript.trim()) {
    throw new Error(
      `Could not extract speech from audio${filename ? ` "${filename}"` : ''}. ` +
        'The file may be silent, corrupted, or in an unsupported format.',
    );
  }

  return {
    title: fallbackTitle,
    content: transcript.trim(),
    sourceType: 'text',
  };
}

async function transcribeChunk(
  client: OpenAI,
  chunk: Buffer,
  filename: string,
): Promise<string> {
  const file = new File([new Uint8Array(chunk)], filename, {
    type: mimeFromFilename(filename),
  });

  const response = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    response_format: 'text',
  });

  return String(response);
}

function splitBuffer(buffer: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

function extractTitleFromFilename(filename: string): string {
  return filename
    .replace(/\.\w+$/, '')
    .replace(/[-_]/g, ' ');
}

function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    webm: 'audio/webm',
    mp4: 'audio/mp4',
    mpeg: 'audio/mpeg',
  };
  return map[ext ?? ''] ?? 'audio/mpeg';
}
