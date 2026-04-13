import { Router } from 'express';
import { IntentService } from '../../core/intent.js';

export function createIntentRouter(intentService: IntentService): Router {
  const router = Router();

  /**
   * POST /api/intent — classify user input into an action intent
   */
  router.post('/', async (req, res, next) => {
    try {
      const { input } = req.body;
      if (!input || typeof input !== 'string') {
        res.status(400).json({ success: false, error: 'input is required' });
        return;
      }

      const result = await intentService.classify(input);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
