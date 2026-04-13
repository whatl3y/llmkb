import { Router } from 'express';
import type { LLMProvider } from '../../types/index.js';
import { QueryService } from '../../core/query.js';

export function createQueryRouter(queryService: QueryService, llm: LLMProvider): Router {
  const router = Router();

  /**
   * POST /api/query — ask a question against the wiki (non-streaming)
   */
  router.post('/', async (req, res, next) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== 'string') {
        res.status(400).json({ success: false, error: 'question is required' });
        return;
      }

      const result = await queryService.query(question);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/query/stream — ask a question with SSE-streamed response
   */
  router.post('/stream', async (req, res) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== 'string') {
        res.status(400).json({ success: false, error: 'question is required' });
        return;
      }

      // Prepare context (search wiki, build prompt)
      const prepared = await queryService.prepareQuery(question);

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Stream LLM response
      let fullAnswer = '';
      for await (const chunk of llm.stream({
        prompt: prepared.prompt,
        systemPrompt: prepared.systemPrompt,
        maxTokens: 4096,
        temperature: 0.3,
      })) {
        fullAnswer += chunk;
        res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      // Save output page asynchronously
      queryService
        .saveOutput(prepared.slug, question, fullAnswer, [])
        .catch((err) => console.error('[query/stream] Failed to save output:', err));

      res.write(`event: done\ndata: ${JSON.stringify({ slug: prepared.slug })}\n\n`);
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: (err as Error).message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
        res.end();
      }
    }
  });

  return router;
}
