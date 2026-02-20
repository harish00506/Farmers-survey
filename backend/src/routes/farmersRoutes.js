import express from 'express';
import { listFarmers, getFarmerByPhone, deleteFarmerByPhone } from '../services/farmerService.js';

const router = express.Router();

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
