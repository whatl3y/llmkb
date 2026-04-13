import { Router } from 'express';
import { LintService } from '../../core/lint.js';

export function createLintRouter(lintService: LintService): Router {
  const router = Router();

  /**
   * POST /api/lint — run a wiki health check
   */
  router.post('/', async (_req, res, next) => {
    try {
      const report = await lintService.run();
      res.json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
