import express from 'express';
import { chatWithData } from '../services/aiChatService.js';
import { checkTtsEndpoint } from '../services/ttsService.js';

const router = express.Router();

/**
 * GET /api/ai/tts/health - check TTS provider availability
 */
router.get('/tts/health', async (req, res, next) => {
  try {
    const result = await checkTtsEndpoint(5000);
    if (result.ok) return res.json({ ok: true });
    return res.status(502).json({ ok: false, error: result.error });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/chat
 * Chat with survey data
 * Body: { question: string }
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: { message: 'Question is required.' } });
    }

    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const result = await chatWithData(db, question, ownerUserId);

    if (!result.success) {
      return res.status(500).json({ error: { message: result.error || 'AI chat failed.' } });
    }

    res.json({
      message: result.response,
      dataPoints: result.dataPoints,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
