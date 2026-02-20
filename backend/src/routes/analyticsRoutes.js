import express from 'express';
import {
  getSurveySummary,
  getCropDistribution,
  getRegionStats,
  getSeedUsage,
  getFertilizerUsage,
  getRecentActivity,
  exportToExcelBuffer,
  getKPIs,
  getInputUsageAvgIncome,
  getQuestionDistribution,
} from '../services/analyticsService.js';

const router = express.Router();

/**
 * GET /api/analytics/summary
 * Get survey summary statistics
 */
router.get('/summary', async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const surveyId = req.query.surveyId || 'all';
    const summary = await getSurveySummary(db, ownerUserId, surveyId);
    const cropDistribution = await getCropDistribution(db, ownerUserId, surveyId);
    const regionStats = await getRegionStats(db, ownerUserId, surveyId);
    const seedUsage = await getSeedUsage(db, ownerUserId, surveyId);
    const fertilizerUsage = await getFertilizerUsage(db, ownerUserId, surveyId);

    res.json({
      summary,
      cropDistribution,
      regionStats,
      seedUsage,
      fertilizerUsage,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/recent
 * Get recent activity (latest answers)
 */
router.get('/recent', async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const surveyId = req.query.surveyId || 'all';

    // Validate and coerce limit query parameter to a non-negative integer
    const rawLimit = req.query.limit;
    let limit = 10;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ error: { code: 400, message: 'Invalid limit: must be a non-negative number' } });
      }
      limit = Math.trunc(parsed);
    }

    const recent = await getRecentActivity(db, limit, ownerUserId, surveyId);
    res.json({ recent });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/export
 * Export survey data to Excel
 */
router.get('/export', async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const surveyId = req.query.surveyId || 'all';
    const buffer = await exportToExcelBuffer(db, ownerUserId, surveyId);

    const fileName = `survey_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/kpis
 * Return top KPI cards (range: daily|weekly|monthly)
 */
router.get('/kpis', async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const range = req.query.range || 'weekly';
    const surveyId = req.query.surveyId || 'all';
    const kpis = await getKPIs(db, range, ownerUserId, surveyId);
    res.json(kpis);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/inputs/avg-income
 */
router.get('/inputs/avg-income', async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const surveyId = req.query.surveyId || 'all';
    const data = await getInputUsageAvgIncome(db, ownerUserId, surveyId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/questions/distribution
 */
router.get('/questions/distribution', async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const surveyId = req.query.surveyId || 'all';
    const questionId = req.query.questionId;

    if (!questionId || !String(questionId).trim()) {
      return res.status(400).json({ error: { code: 400, message: 'questionId is required' } });
    }

    const data = await getQuestionDistribution(db, ownerUserId, surveyId, questionId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
