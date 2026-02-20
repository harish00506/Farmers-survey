import express from 'express';
import { synthesizeText } from '../services/ttsService.js';
import { requireAdminApiKey } from '../middleware/adminAuth.js';
import { getModelByCollection } from '../models/index.js';

const router = express.Router();

/**
 * POST /api/tts/synthesize
 * Body: { text, lang, voice, format }
 * Admin-only endpoint to preview and create a TTS audio file
 */
router.post('/synthesize', requireAdminApiKey, async (req, res, next) => {
    try {
        const { isTtsEnabled } = await import('../config/featureFlags.js');
        if (!isTtsEnabled()) {
            return res.status(400).json({ success: false, message: 'TTS is currently disabled' });
        }

        const { text, lang, voice, format } = req.body;
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: { message: 'text is required' } });
        }

        const result = await synthesizeText(text, { lang, voice, format });

        // Persist a record in the audio collection for tracking
        const audioCollection = getModelByCollection('audio').collection;
        const audioDoc = {
            id: result.audioId,
            fileName: result.fileName,
            filePath: result.filePath,
            mimeType: result.mimeType,
            fileSize: result.fileSize,
            source: 'tts',
            sourceText: text,
            lang: lang || null,
            createdAt: new Date(),
            transcriptionStatus: 'not_requested',
        };

        await audioCollection.insertOne(audioDoc);

        // Return an endpoint that can stream the file
        const fileUrl = `/api/qc/audio/${result.audioId}/file`;

        res.json({ success: true, audioId: result.audioId, fileUrl });
    } catch (error) {
        next(error);
    }
});

export default router;
