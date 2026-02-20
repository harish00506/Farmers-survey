import express from 'express';
import fs from 'fs';
import { getAudioById, getAudioQcList } from '../services/audioService.js';
import { getModelByCollection } from '../models/index.js';

const router = express.Router();

/**
 * GET /api/qc/audio
 * Query params: phoneNumber, sessionId, questionId, limit, offset
 */
router.get('/audio', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const list = await getAudioQcList(db, {
            phoneNumber: req.query.phoneNumber,
            sessionId: req.query.sessionId,
            questionId: req.query.questionId,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        res.json({ items: list });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/qc/audio/:audioId/file
 * Streams audio file for QC playback
 */
router.get('/audio/:audioId/file', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const audio = await getAudioById(db, req.params.audioId);

        if (!audio || !audio.filePath) {
            return res.status(404).json({ error: { message: 'Audio not found' } });
        }

        if (!fs.existsSync(audio.filePath)) {
            return res.status(404).json({ error: { message: 'Audio file missing on disk' } });
        }

        res.setHeader('Content-Type', audio.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${audio.fileName || 'audio.bin'}"`);

        const stream = fs.createReadStream(audio.filePath);
        stream.on('error', next);
        stream.pipe(res);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/qc/audio/:audioId/tag
 * Body: { status: 'approved'|'rejected', notes: string }
 */
router.post('/audio/:audioId/tag', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const { status, notes } = req.body;
        const audio = await getAudioById(db, req.params.audioId);
        if (!audio) return res.status(404).json({ error: { message: 'Audio not found' } });

        const audioCollection = getModelByCollection('audio').collection;
        await audioCollection.updateOne({ id: req.params.audioId }, { $set: { qc: { status, notes: notes || '', updatedAt: new Date() } } });

        res.json({ success: true, audioId: req.params.audioId });
    } catch (error) {
        next(error);
    }
});

export default router;
