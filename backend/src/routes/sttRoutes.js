import express from 'express';
import multer from 'multer';
import { getAudioById, storeUploadedFile, transcribeAudio } from '../services/audioService.js';
import { getModelByCollection } from '../models/index.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/stt/transcribe
 * Body: { audioId }
 * Marks the audio as pending transcription. Implementations should run an async worker to do the actual transcribe.
 */
router.post('/transcribe', async (req, res, next) => {
    try {
        const { audioId } = req.body;
        if (!audioId) return res.status(400).json({ error: { message: 'audioId is required' } });

        const db = req.app.locals.mongoDb;
        const audio = await getAudioById(db, audioId);
        if (!audio) return res.status(404).json({ error: { message: 'Audio not found' } });

        await getModelByCollection('audio').collection.updateOne({ id: audioId }, { $set: { transcriptionStatus: 'pending', transcriptionRequestedAt: new Date() } });

        // TODO: enqueue background job to call STT provider (groq) and update audio.transcript

        res.json({ success: true, audioId, status: 'pending' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/stt/debug
 * Multipart form upload: 'file' => audio file
 * Transcribes the uploaded file immediately (useful for local debugging with a file like voice.ogg)
 */
router.post('/debug', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) return res.status(400).json({ error: { message: 'file is required' } });

        const db = req.app.locals.mongoDb;
        // Persist uploaded file as an audio doc and run transcription immediately
        const saved = await storeUploadedFile(db, req.file.buffer, req.file.originalname || 'debug.ogg', req.file.mimetype || 'audio/ogg', { debug: true });

        let transcript = null;
        let match = null;
        try {
            const result = await transcribeAudio(db, saved.audioId);
            transcript = result?.text || null;
            match = result?.match || null;
        } catch (err) {
            console.error('❌ Debug transcription failed:', err.message || err);
            // If provider returned a body, include it for troubleshooting
            const providerErr = err.response?.data || err.message || 'Unknown error';
            return res.status(500).json({ success: false, message: 'Transcription failed', error: providerErr });
        }

        return res.json({ success: true, audioId: saved.audioId, transcript, match });
    } catch (error) {
        next(error);
    }
});

export default router;
