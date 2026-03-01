import express from 'express';
import multer from 'multer';
import {
    listFarmers,
    getFarmerByPhone,
    deleteFarmerByPhone,
    importFarmersFromCsv,
    filterFarmersByAnswer,
} from '../services/farmerService.js';
import { sendSurveyInvite } from '../controllers/whatsappController.js';

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
});

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
};

const tryParseJson = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

// POST /api/farmers/import/csv - import farmers from CSV content or uploaded CSV file
router.post('/import/csv', upload.single('file'), async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const ownerUserId = req.user?.id;
        const csvFromBody = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
        const csvFromFile = req.file?.buffer ? req.file.buffer.toString('utf8') : '';
        const csvText = csvFromBody || csvFromFile;

        if (!csvText || !csvText.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 400, message: 'CSV content is required. Send csvText or upload file.' },
            });
        }

        const summary = await importFarmersFromCsv(db, csvText, ownerUserId);
        return res.status(201).json({ success: true, ...summary });
    } catch (err) {
        next(err);
    }
});

// GET /api/farmers/filter - filter farmers by answered question/option
router.get('/filter', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const ownerUserId = req.user?.id;
        const parsedFilters = tryParseJson(req.query.filters);

        const result = await filterFarmersByAnswer(
            db,
            parsedFilters && Array.isArray(parsedFilters)
                ? {
                    filters: parsedFilters,
                    mode: req.query.mode,
                    limit: req.query.limit,
                }
                : {
                    sourceSurveyId: req.query.sourceSurveyId || req.query.surveyId,
                    sourceQuestionId: req.query.sourceQuestionId || req.query.questionId,
                    selectedOption: req.query.selectedOption,
                    selectedOptionIndex: req.query.selectedOptionIndex,
                    limit: req.query.limit,
                    mode: req.query.mode,
                },
            ownerUserId
        );

        return res.json({ success: true, ...result });
    } catch (err) {
        next(err);
    }
});

// POST /api/farmers/filter/query - query farmers using multi-level filters from request body
router.post('/filter/query', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const ownerUserId = req.user?.id;

        const result = await filterFarmersByAnswer(
            db,
            {
                filters: Array.isArray(req.body?.filters) ? req.body.filters : undefined,
                sourceSurveyId: req.body?.sourceSurveyId || req.body?.surveyId,
                sourceQuestionId: req.body?.sourceQuestionId || req.body?.questionId,
                selectedOption: req.body?.selectedOption,
                selectedOptionIndex: req.body?.selectedOptionIndex,
                mode: req.body?.mode,
                limit: req.body?.limit,
            },
            ownerUserId
        );

        return res.json({ success: true, ...result });
    } catch (err) {
        next(err);
    }
});

// POST /api/farmers/filter/send-survey - send another survey to filtered farmers
router.post('/filter/send-survey', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const ownerUserId = req.user?.id;
        const targetSurveyId = String(req.body?.targetSurveyId || '').trim();

        if (!targetSurveyId) {
            return res.status(400).json({
                success: false,
                error: { code: 400, message: 'targetSurveyId is required' },
            });
        }

        const filterResult = await filterFarmersByAnswer(
            db,
            {
                filters: Array.isArray(req.body?.filters) ? req.body.filters : undefined,
                sourceSurveyId: req.body?.sourceSurveyId || req.body?.surveyId,
                sourceQuestionId: req.body?.sourceQuestionId || req.body?.questionId,
                selectedOption: req.body?.selectedOption,
                selectedOptionIndex: req.body?.selectedOptionIndex,
                mode: req.body?.mode,
                limit: req.body?.limit,
            },
            ownerUserId
        );

        if (!Array.isArray(filterResult.phoneNumbers) || filterResult.phoneNumbers.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No matching farmers found for this filter.',
                totalMatched: 0,
                invited: false,
            });
        }

        if (toBoolean(req.body?.dryRun)) {
            return res.status(200).json({
                success: true,
                message: 'Dry run complete. Matching farmers found.',
                totalMatched: filterResult.phoneNumbers.length,
                invited: false,
                phoneNumbers: filterResult.phoneNumbers,
            });
        }

        req.body = {
            ...(req.body || {}),
            channel: 'phone',
            async: req.body?.async !== undefined ? req.body.async : true,
            surveyId: targetSurveyId,
            phoneNumbers: filterResult.phoneNumbers,
        };

        return sendSurveyInvite(req, res, next);
    } catch (err) {
        next(err);
    }
});

// GET /api/farmers - list summary info for all farmers
router.get('/', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const ownerUserId = req.user?.id;
        const farmers = await listFarmers(db, ownerUserId);
        res.json({ farmers });
    } catch (err) {
        next(err);
    }
});

// GET /api/farmers/:phone - get farmer details by phone number
router.get('/:phone', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const phone = req.params.phone;
        const ownerUserId = req.user?.id;
        const farmer = await getFarmerByPhone(db, phone, ownerUserId);
        if (!farmer) return res.status(404).json({ error: { code: 404, message: 'Farmer not found' } });
        res.json({ farmer });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/farmers/:phone - delete farmer and related records by phone number
router.delete('/:phone', async (req, res, next) => {
    try {
        const db = req.app.locals.mongoDb;
        const phone = req.params.phone;
        const ownerUserId = req.user?.id;
        const result = await deleteFarmerByPhone(db, phone, ownerUserId);

        if (!result.found) {
            return res.status(404).json({ error: { code: 404, message: 'Farmer not found' } });
        }

        return res.json({
            success: true,
            message: `Deleted farmer ${phone}`,
            deleted: {
                farmer: result.deletedFarmerCount,
                sessions: result.deletedSessionCount,
                answers: result.deletedAnswerCount,
                audio: result.deletedAudioCount,
                regions: result.deletedRegionCount,
            },
        });
    } catch (err) {
        next(err);
    }
});

export default router;
