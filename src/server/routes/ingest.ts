import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import type { IngestRequest, IngestResult } from '../../types/index.js';
import { IngestService, DuplicateSourceError } from '../../core/ingest.js';
import { parseSpreadsheetBuffer } from '../../core/parser/spreadsheet.js';
import { parseDocxBuffer, parseDocBuffer } from '../../core/parser/document.js';
import { parsePresentationBuffer } from '../../core/parser/presentation.js';
import { parseAudioBuffer } from '../../core/parser/audio.js';
import { parseVideoBuffer } from '../../core/parser/video.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

type FileType = 'pdf' | 'spreadsheet' | 'doc' | 'docx' | 'presentation' | 'audio' | 'video' | 'text';

const EXT_MAP: Record<string, FileType> = {
  '.pdf': 'pdf',
  '.csv': 'spreadsheet',
  '.xls': 'spreadsheet',
  '.xlsx': 'spreadsheet',
  '.doc': 'doc',
  '.docx': 'docx',
  '.ppt': 'presentation',
  '.pptx': 'presentation',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.webm': 'audio',
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.txt': 'text',
  '.md': 'text',
  '.text': 'text',
};

function detectFileType(file: Express.Multer.File): FileType {
  const ext = path.extname(file.originalname).toLowerCase();
  return EXT_MAP[ext] ?? 'text';
}

async function fileToIngestRequest(file: Express.Multer.File): Promise<IngestRequest> {
  const fileType = detectFileType(file);
  const originalBuffer = file.buffer;
  const originalFilename = file.originalname;

  switch (fileType) {
    case 'pdf':
      return {
        sourceType: 'pdf',
        content: file.buffer.toString('base64'),
        filename: file.originalname,
        originalBuffer,
        originalFilename,
      };

    case 'spreadsheet': {
      const parsed = parseSpreadsheetBuffer(file.buffer, file.originalname);
      return { sourceType: 'text', content: parsed.content, title: parsed.title, originalBuffer, originalFilename };
    }

    case 'docx': {
      const parsed = await parseDocxBuffer(file.buffer, file.originalname);
      return { sourceType: 'text', content: parsed.content, title: parsed.title, originalBuffer, originalFilename };
    }

    case 'doc': {
      const parsed = await parseDocBuffer(file.buffer, file.originalname);
      return { sourceType: 'text', content: parsed.content, title: parsed.title, originalBuffer, originalFilename };
    }

    case 'presentation': {
      const parsed = await parsePresentationBuffer(file.buffer, file.originalname);
      return { sourceType: 'text', content: parsed.content, title: parsed.title, originalBuffer, originalFilename };
    }

    case 'audio': {
      const parsed = await parseAudioBuffer(file.buffer, file.originalname);
      return { sourceType: 'text', content: parsed.content, title: parsed.title, originalBuffer, originalFilename };
    }

    case 'video': {
      const parsed = await parseVideoBuffer(file.buffer, file.originalname);
      return { sourceType: 'text', content: parsed.content, title: parsed.title, originalBuffer, originalFilename };
    }

    default:
      return {
        sourceType: 'text',
        content: file.buffer.toString('utf-8'),
        filename: file.originalname,
        originalBuffer,
        originalFilename,
      };
  }
}

/** Send a Server-Sent Event — silently ignores write errors (client disconnected). */
function sendSSE(res: import('express').Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected — swallow error, processing continues
  }
}

export function createIngestRouter(ingestService: IngestService): Router {
  const router = Router();

  /**
   * POST /api/ingest/url — ingest from a web URL
   * Body: { url: string, force?: boolean }
   */
  router.post('/url', async (req, res, next) => {
    try {
      const { url, force } = req.body;
      if (!url || typeof url !== 'string') {
        res.status(400).json({ success: false, error: 'url is required' });
        return;
      }

      const request: IngestRequest = { sourceType: 'url', content: url };
      const result = await ingestService.process(request, !!force);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof DuplicateSourceError) {
        res.status(409).json({
          success: false,
          error: err.message,
          duplicate: { slug: err.existingSlug, title: err.existingTitle, ingestedAt: err.ingestedAt },
        });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/ingest/text — ingest plain text content
   * Body: { content: string, title?: string, force?: boolean }
   */
  router.post('/text', async (req, res, next) => {
    try {
      const { content, title, force } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json({ success: false, error: 'content is required' });
        return;
      }

      const request: IngestRequest = { sourceType: 'text', content, title };
      const result = await ingestService.process(request, !!force);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof DuplicateSourceError) {
        res.status(409).json({
          success: false,
          error: err.message,
          duplicate: { slug: err.existingSlug, title: err.existingTitle, ingestedAt: err.ingestedAt },
        });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/ingest/files — upload and ingest one or more files (SSE stream)
   * Query: ?force=true to skip duplicate checking
   *
   * Streams progress back to the client as Server-Sent Events:
   *   event: progress  — { index, total, filename, status: "parsing"|"llm"|"writing"|"done"|"duplicate"|"error", message?, duplicate? }
   *   event: complete   — { results: [...], errors: [...], duplicates: [...] }
   */
  router.post('/files', upload.array('files', 20), async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: 'At least one file is required' });
      return;
    }

    const force = req.query.force === 'true';

    // Track client connection — processing continues regardless.
    // Listen on res (not req) because req 'close' fires when the upload body
    // is fully consumed, which is before SSE streaming even starts.
    let clientConnected = true;
    res.on('close', () => { clientConnected = false; });

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const total = files.length;
    const results: Array<{ filename: string; result: IngestResult }> = [];
    const errors: Array<{ filename: string; error: string }> = [];
    const duplicates: Array<{ filename: string; existingSlug: string; existingTitle: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filename = file.originalname;

      try {
        // Phase 1: parsing / transcribing / processing
        const fileType = detectFileType(file);
        const status = fileType === 'video' ? 'processing'
          : fileType === 'audio' ? 'transcribing'
          : 'parsing';
        const statusMsg = fileType === 'video' ? `Processing ${filename} (extracting audio, analyzing frames)...`
          : fileType === 'audio' ? `Transcribing ${filename}...`
          : `Parsing ${filename}...`;
        if (clientConnected) {
          sendSSE(res, 'progress', {
            index: i, total, filename,
            status,
            message: statusMsg,
          });
        }

        const request = await fileToIngestRequest(file);

        // Phase 2: LLM analysis
        if (clientConnected) {
          sendSSE(res, 'progress', {
            index: i, total, filename,
            status: 'llm',
            message: `Analyzing with LLM...`,
          });
        }

        const result = await ingestService.process(request, force);

        // Phase 3: done
        if (clientConnected) {
          sendSSE(res, 'progress', {
            index: i, total, filename,
            status: 'done',
            message: `Created ${result.concepts.length} concepts, ${result.entities.length} entities`,
          });
        }

        results.push({ filename, result });
      } catch (err) {
        if (err instanceof DuplicateSourceError) {
          if (clientConnected) {
            sendSSE(res, 'progress', {
              index: i, total, filename,
              status: 'duplicate',
              message: `Skipped — already ingested as "${err.existingTitle}"`,
              duplicate: { slug: err.existingSlug, title: err.existingTitle, ingestedAt: err.ingestedAt },
            });
          }
          duplicates.push({ filename, existingSlug: err.existingSlug, existingTitle: err.existingTitle });
        } else {
          const errorMessage = (err as Error).message;
          if (clientConnected) {
            sendSSE(res, 'progress', {
              index: i, total, filename,
              status: 'error',
              message: errorMessage,
            });
          }
          errors.push({ filename, error: errorMessage });
        }
      }
    }

    // Final summary event
    if (clientConnected) {
      sendSSE(res, 'complete', { results, errors, duplicates });
      res.end();
    }

    console.log(`[ingest/files] Completed: ${results.length} succeeded, ${duplicates.length} duplicates skipped, ${errors.length} failed (client ${clientConnected ? 'connected' : 'disconnected'})`);
  });

  return router;
}
