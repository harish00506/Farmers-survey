import express from 'express';
import multer from 'multer';
import { storeUploadedFile, getAudioById } from '../services/audioService.js';
import { saveVoiceAnswer } from '../services/surveyEngine.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

/**
 * POST /api/survey/:sessionId/audio
 * Multipart: file (audio), fields: phoneNumber, questionId, lat, lon
 */
router.post('/:sessionId/audio', upload.single('audio'), async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const { sessionId } = req.params;
        const { phoneNumber, questionId, lat, lon } = req.body;

        if (!req.file) return res.status(400).json({ error: { message: 'audio file is required' } });
        if (!phoneNumber || !questionId) return res.status(400).json({ error: { message: 'phoneNumber and questionId are required' } });

        const metadata = { phoneNumber, questionId, geo: lat && lon ? { lat: Number(lat), lon: Number(lon) } : undefined };

        const stored = await storeUploadedFile(db, req.file.buffer, req.file.originalname, req.file.mimetype, metadata);

        // Create a voice answer placeholder for this session/question
        await saveVoiceAnswer(db, phoneNumber, sessionId, questionId, stored.audioId);

        res.json({ success: true, audioId: stored.audioId });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/audio/:audioId/transcript
 */
router.get('/:audioId/transcript', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const audio = await getAudioById(db, req.params.audioId);
        if (!audio) return res.status(404).json({ error: { message: 'Audio not found' } });
        res.json({ transcript: audio.transcript || null, transcriptionStatus: audio.transcriptionStatus || 'not_requested' });
    } catch (error) {
        next(error);
    }
});

export default router;
