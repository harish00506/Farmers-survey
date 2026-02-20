import ExcelJS from 'exceljs';
import { getModelByCollection } from '../models/index.js';

/**
 * Analytics Service (Phase 3)
 * Generates insights from survey data
 * Key features:
 * - Aggregations by crop, seed, fertilizer, region
 * - Flattened CSV/Excel export
 * - Summary statistics
 */

const getCollection = (_db, name) => getModelByCollection(name).collection;
const buildOwnerFilter = (ownerUserId) => (ownerUserId ? { ownerUserId } : {});
const DEFAULT_SURVEY_ID = 'survey1';
const normalizeSurveyScope = (surveyId) => {
  if (!surveyId || String(surveyId).trim().toLowerCase() === 'all') return 'all';
  return String(surveyId).trim();
};
const buildSurveyFilter = (surveyId, field = 'surveyId') => {
  const scope = normalizeSurveyScope(surveyId);
  if (scope === 'all') return {};
  if (scope === DEFAULT_SURVEY_ID) {
    return {
      $or: [
        { [field]: DEFAULT_SURVEY_ID },
        { [field]: { $exists: false } },
      ],
    };
  }

  return { [field]: scope };
};

const METRIC_QUESTION_HINTS = {
  crop: {
    fallbackIds: ['Q1'],
    keywords: ['crop', 'crops', 'primary crop', 'main crop', 'cultivat'],
    excludeKeywords: ['seed', 'fertilizer', 'fertiliser', 'irrigation', 'income', 'earning', 'revenue'],
  },
  seed: {
    fallbackIds: ['Q3'],
    keywords: ['seed', 'seeds'],
    excludeKeywords: ['income', 'earning', 'revenue'],
  },
  fertilizer: {
    fallbackIds: ['Q5'],
    keywords: ['fertilizer', 'fertiliser', 'manure'],
    excludeKeywords: ['income', 'earning', 'revenue'],
  },
  irrigation: {
    fallbackIds: ['Q6'],
    keywords: ['irrigation', 'water source', 'water'],
    excludeKeywords: ['income', 'earning', 'revenue'],
  },
  income: {
    fallbackIds: ['Q8'],
    keywords: ['income', 'earnings', 'revenue'],
    excludeKeywords: [],
  },
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const uniqueNonEmpty = (items = []) => Array.from(new Set(items.filter(Boolean).map((value) => String(value).trim())));

const collectMetricQuestionIds = (questions = [], metricHint) => {
  const keywords = metricHint?.keywords || [];
  const fallbackIds = metricHint?.fallbackIds || [];
  const excludeKeywords = metricHint?.excludeKeywords || [];

  const matchesByText = questions
    .filter((question) => {
      const text = normalizeText(question?.text);
      if (!text) return false;
      const matchesKeyword = keywords.some((keyword) => text.includes(keyword));
      const hasExcludedKeyword = excludeKeywords.some((keyword) => text.includes(keyword));
      return matchesKeyword && !hasExcludedKeyword;
    })
    .sort((a, b) => Number(a?.sequence ?? 0) - Number(b?.sequence ?? 0))
    .map((question) => question?.id);

  if (matchesByText.length > 0) {
    return uniqueNonEmpty(matchesByText);
  }

  const fallbackMatches = questions
    .filter((question) => fallbackIds.includes(String(question?.id || '').trim()))
    .sort((a, b) => Number(a?.sequence ?? 0) - Number(b?.sequence ?? 0))
    .map((question) => question?.id);

  return uniqueNonEmpty(fallbackMatches);
};

const resolveAnalyticsQuestionIds = async (db, ownerUserId = null, surveyId = 'all') => {
  const questions = getCollection(db, 'questions');
  const query = { ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) };

  let docs = await questions
    .find(query, { projection: { _id: 0, id: 1, text: 1, sequence: 1 } })
    .sort({ sequence: 1 })
    .toArray();

  if (docs.length === 0 && ownerUserId) {
    docs = await questions
      .find(buildSurveyFilter(surveyId), { projection: { _id: 0, id: 1, text: 1, sequence: 1 } })
      .sort({ sequence: 1 })
      .toArray();
  }

  const cropIds = collectMetricQuestionIds(docs, METRIC_QUESTION_HINTS.crop);
  const seedIds = collectMetricQuestionIds(docs, METRIC_QUESTION_HINTS.seed);
  const fertilizerIds = collectMetricQuestionIds(docs, METRIC_QUESTION_HINTS.fertilizer);
  const irrigationIds = collectMetricQuestionIds(docs, METRIC_QUESTION_HINTS.irrigation);
  const incomeIds = collectMetricQuestionIds(docs, METRIC_QUESTION_HINTS.income);

  return {
    cropIds,
    seedIds,
    fertilizerIds,
    irrigationIds,
    incomeIds,
    allMetricIds: uniqueNonEmpty([...seedIds, ...fertilizerIds, ...irrigationIds, ...incomeIds]),
  };
};

const firstAnswerForIdsExpr = (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return null;
  }

  return {
    $let: {
      vars: {
        a: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$answers',
                as: 'a',
                cond: { $in: ['$$a._id', ids] },
              },
            },
            0,
          ],
        },
      },
      in: { $ifNull: ['$$a.answer', null] },
    },
  };
};

/**
 * Get survey summary statistics
 */
export const getSurveySummary = async (db, ownerUserId = null, surveyId = 'all') => {
  const farmers = getCollection(db, 'farmers');
  const sessions = getCollection(db, 'surveySessions');
  const ownerFilter = buildOwnerFilter(ownerUserId);
  const surveyFilter = buildSurveyFilter(surveyId);

  const totalFarmersPromise = normalizeSurveyScope(surveyId) === 'all'
    ? farmers.countDocuments(ownerFilter)
    : sessions.distinct('phoneNumber', { ...ownerFilter, ...surveyFilter }).then((phones) => phones.length);

  const [totalFarmers, completedSessions, inProgressSessions] = await Promise.all([
    totalFarmersPromise,
    sessions.countDocuments({ status: 'completed', ...ownerFilter, ...surveyFilter }),
    sessions.countDocuments({ status: 'in_progress', ...ownerFilter, ...surveyFilter }),
  ]);

  return {
    totalFarmers,
    completedSessions,
    inProgressSessions,
  };
};

/**
 * Get crop distribution
 */
export const getCropDistribution = async (db, ownerUserId = null, surveyId = 'all') => {
  const { cropIds } = await resolveAnalyticsQuestionIds(db, ownerUserId, surveyId);
  if (cropIds.length === 0) return [];

  const answers = getCollection(db, 'answers');
  const pipeline = [
    { $match: { questionId: { $in: cropIds }, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) } },
    { $group: { _id: '$selectedOption', count: { $sum: 1 } } },
    { $project: { _id: 0, crop: '$_id', count: 1 } },
    { $sort: { count: -1 } },
  ];

  return answers.aggregate(pipeline).toArray();
};

/**
 * Get response distribution for a specific question
 */
export const getQuestionDistribution = async (db, ownerUserId = null, surveyId = 'all', questionId = '') => {
  const normalizedQuestionId = String(questionId || '').trim();
  if (!normalizedQuestionId) {
    throw new Error('questionId is required');
  }

  const questions = getCollection(db, 'questions');
  const answers = getCollection(db, 'answers');
  const ownerFilter = buildOwnerFilter(ownerUserId);
  const surveyFilter = buildSurveyFilter(surveyId);

  let question = await questions.findOne(
    { id: normalizedQuestionId, ...ownerFilter, ...surveyFilter },
    { projection: { _id: 0, id: 1, text: 1, options: 1 } }
  );

  if (!question && ownerUserId) {
    question = await questions.findOne(
      { id: normalizedQuestionId, ...surveyFilter },
      { projection: { _id: 0, id: 1, text: 1, options: 1 } }
    );
  }

  if (!question) {
    throw new Error(`Question not found: ${normalizedQuestionId}`);
  }

  const grouped = await answers.aggregate([
    {
      $match: {
        questionId: normalizedQuestionId,
        ...ownerFilter,
        ...surveyFilter,
      },
    },
    {
      $group: {
        _id: '$selectedOption',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        option: '$_id',
        count: 1,
      },
    },
    { $sort: { count: -1 } },
  ]).toArray();

  const groupedMap = new Map(grouped.map((item) => [String(item.option ?? ''), Number(item.count || 0)]));
  const configuredOptions = Array.isArray(question.options) ? question.options.map((option) => String(option ?? '')) : [];

  const responses = configuredOptions.map((option) => ({
    option,
    count: groupedMap.get(option) || 0,
  }));

  for (const item of grouped) {
    const option = String(item.option ?? '');
    if (!configuredOptions.includes(option)) {
      responses.push({ option, count: Number(item.count || 0) });
    }
  }

  const totalResponses = responses.reduce((sum, item) => sum + Number(item.count || 0), 0);

  return {
    questionId: question.id,
    questionText: question.text || question.id,
    responses,
    totalResponses,
  };
};

/**
 * Get region-wise statistics
 */
export const getRegionStats = async (db, ownerUserId = null, surveyId = 'all') => {
  const farmers = getCollection(db, 'farmers');
  const ownerFilter = buildOwnerFilter(ownerUserId);
  const surveyScope = normalizeSurveyScope(surveyId);
  const surveyExpr = surveyScope === 'all'
    ? []
    : surveyScope === DEFAULT_SURVEY_ID
      ? [{ $or: [{ $eq: ['$surveyId', DEFAULT_SURVEY_ID] }, { $eq: [{ $type: '$surveyId' }, 'missing'] }] }]
      : [{ $eq: ['$surveyId', surveyScope] }];
  const pipeline = [
    { $match: ownerFilter },
    // normalize region text: replace underscores, trim and lowercase so variants collapse
    { $project: { phoneNumber: 1, regionRaw: { $ifNull: ['$region', 'unknown'] } } },
    {
      $addFields: {
        region: {
          $trim: {
            input: { $toLower: { $replaceAll: { input: '$regionRaw', find: '_', replacement: ' ' } } },
          },
        },
      },
    },
    {
      $lookup: {
        from: 'surveySessions',
        let: { farmerPhone: '$phoneNumber' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$phoneNumber', '$$farmerPhone'] },
                  { $eq: ['$ownerUserId', ownerUserId] },
                  ...surveyExpr,
                ],
              },
            },
          },
        ],
        as: 'sessions',
      },
    },
    { $unwind: { path: '$sessions', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { region: '$region', farmer: '$phoneNumber' },
        completedFlag: {
          $max: {
            $cond: [{ $eq: ['$sessions.status', 'completed'] }, 1, 0],
          },
        },
      },
    },
    {
      $group: {
        _id: '$_id.region',
        farmerCount: { $sum: 1 },
        completedSessions: { $sum: '$completedFlag' },
      },
    },
    // compute completion percentage server-side to ensure consistent numbers
    {
      $addFields: {
        completionPct: {
          $cond: [
            { $gt: ['$farmerCount', 0] },
            { $round: [{ $multiply: [{ $divide: ['$completedSessions', '$farmerCount'] }, 100] }, 0] },
            0,
          ],
        },
      },
    },
    { $project: { _id: 0, region: '$_id', farmerCount: 1, completedSessions: 1, completionPct: 1 } },
    { $sort: { farmerCount: -1 } },
  ];

  return farmers.aggregate(pipeline).toArray();
};

/**
 * Get seed usage distribution
 */
export const getSeedUsage = async (db, ownerUserId = null, surveyId = 'all') => {
  const { seedIds } = await resolveAnalyticsQuestionIds(db, ownerUserId, surveyId);
  if (seedIds.length === 0) return [];

  const answers = getCollection(db, 'answers');
  const pipeline = [
    { $match: { questionId: { $in: seedIds }, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) } },
    { $group: { _id: '$selectedOption', count: { $sum: 1 } } },
    { $project: { _id: 0, response: '$_id', count: 1 } },
    { $sort: { count: -1 } },
  ];

  return answers.aggregate(pipeline).toArray();
};

/**
 * Get fertilizer usage distribution
 */
export const getFertilizerUsage = async (db, ownerUserId = null, surveyId = 'all') => {
  const { fertilizerIds } = await resolveAnalyticsQuestionIds(db, ownerUserId, surveyId);
  if (fertilizerIds.length === 0) return [];

  const answers = getCollection(db, 'answers');
  const pipeline = [
    { $match: { questionId: { $in: fertilizerIds }, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) } },
    { $group: { _id: '$selectedOption', count: { $sum: 1 } } },
    { $project: { _id: 0, response: '$_id', count: 1 } },
    { $sort: { count: -1 } },
  ];

  return answers.aggregate(pipeline).toArray();
};

/**
 * Input usage avg income (Yes vs No)
 * Uses dynamically resolved question ids for seeds/fertilizer/irrigation and income.
 */
export const getInputUsageAvgIncome = async (db, ownerUserId = null, surveyId = 'all') => {
  const {
    seedIds,
    fertilizerIds,
    irrigationIds,
    incomeIds,
    allMetricIds,
  } = await resolveAnalyticsQuestionIds(db, ownerUserId, surveyId);

  if (allMetricIds.length === 0) {
    return {
      improvedSeeds: { avgIncomeYes: null, avgIncomeNo: null },
      fertilizer: { avgIncomeYes: null, avgIncomeNo: null },
      irrigation: { avgIncomeYes: null, avgIncomeNo: null },
    };
  }

  const farmers = getCollection(db, 'farmers');
  const surveyScope = normalizeSurveyScope(surveyId);
  const surveyExpr = surveyScope === 'all'
    ? []
    : surveyScope === DEFAULT_SURVEY_ID
      ? [{ $or: [{ $eq: ['$surveyId', DEFAULT_SURVEY_ID] }, { $eq: [{ $type: '$surveyId' }, 'missing'] }] }]
      : [{ $eq: ['$surveyId', surveyScope] }];

  const pipeline = [
    { $match: buildOwnerFilter(ownerUserId) },
    { $project: { phoneNumber: 1 } },
    {
      $lookup: {
        from: 'answers',
        let: { phone: '$phoneNumber' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$phoneNumber', '$$phone'] },
                  { $eq: ['$ownerUserId', ownerUserId] },
                  { $in: ['$questionId', allMetricIds] },
                  ...surveyExpr,
                ],
              },
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$questionId',
              answer: { $first: '$selectedOption' },
            },
          },
        ],
        as: 'answers',
      },
    },
    {
      $addFields: {
        improvedSeeds: firstAnswerForIdsExpr(seedIds),
        fertilizer: firstAnswerForIdsExpr(fertilizerIds),
        irrigation: firstAnswerForIdsExpr(irrigationIds),
        incomeRaw: firstAnswerForIdsExpr(incomeIds),
      },
    },
    {
      $addFields: {
        improvedFlag: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$improvedSeeds', ''] } }, ['yes', 'y', 'true', '1']] }, 1, 0] },
        fertilizerFlag: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$fertilizer', ''] } }, ['yes', 'y', 'true', '1']] }, 1, 0] },
        irrigationFlag: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$irrigation', ''] } }, ['none', 'no', 'n', 'unknown']] }, 0, 1] },
        incomeNumeric: {
          $let: {
            vars: { matched: { $regexFind: { input: { $ifNull: ['$incomeRaw', ''] }, regex: /\d+(?:\.\d+)?/ } } },
            in: { $cond: [{ $ifNull: ['$$matched', false] }, { $toDouble: '$$matched.match' }, null] },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        // improved seeds
        improvedYesAvg: { $avg: { $cond: [{ $eq: ['$improvedFlag', 1] }, '$incomeNumeric', null] } },
        improvedNoAvg: { $avg: { $cond: [{ $eq: ['$improvedFlag', 0] }, '$incomeNumeric', null] } },
        // fertilizer
        fertYesAvg: { $avg: { $cond: [{ $eq: ['$fertilizerFlag', 1] }, '$incomeNumeric', null] } },
        fertNoAvg: { $avg: { $cond: [{ $eq: ['$fertilizerFlag', 0] }, '$incomeNumeric', null] } },
        // irrigation
        irrigYesAvg: { $avg: { $cond: [{ $eq: ['$irrigationFlag', 1] }, '$incomeNumeric', null] } },
        irrigNoAvg: { $avg: { $cond: [{ $eq: ['$irrigationFlag', 0] }, '$incomeNumeric', null] } },
      },
    },
    {
      $project: {
        _id: 0,
        improvedSeeds: { avgIncomeYes: { $round: ['$improvedYesAvg', 2] }, avgIncomeNo: { $round: ['$improvedNoAvg', 2] } },
        fertilizer: { avgIncomeYes: { $round: ['$fertYesAvg', 2] }, avgIncomeNo: { $round: ['$fertNoAvg', 2] } },
        irrigation: { avgIncomeYes: { $round: ['$irrigYesAvg', 2] }, avgIncomeNo: { $round: ['$irrigNoAvg', 2] } },
      },
    },
  ];

  const res = await farmers.aggregate(pipeline).toArray();
  return res[0] || { improvedSeeds: { avgIncomeYes: null, avgIncomeNo: null }, fertilizer: { avgIncomeYes: null, avgIncomeNo: null }, irrigation: { avgIncomeYes: null, avgIncomeNo: null } };
};

/**
 * Get recent activity (latest answers)
 */
export const getRecentActivity = async (db, limit = 10, ownerUserId = null, surveyId = 'all') => {
  const answers = getCollection(db, 'answers');
  const surveyScope = normalizeSurveyScope(surveyId);
  const surveyExpr = surveyScope === 'all'
    ? []
    : surveyScope === DEFAULT_SURVEY_ID
      ? [{ $or: [{ $eq: ['$surveyId', DEFAULT_SURVEY_ID] }, { $eq: [{ $type: '$surveyId' }, 'missing'] }] }]
      : [{ $eq: ['$surveyId', surveyScope] }];
  const pipeline = [
    { $match: { ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) } },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'questions',
        let: { qid: '$questionId' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$id', '$$qid'] }, { $eq: ['$ownerUserId', ownerUserId] }] } } },
        ],
        as: 'question',
      },
    },
    { $unwind: { path: '$question', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'surveySessions',
        let: { sid: '$sessionId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$id', '$$sid'] },
                  { $eq: ['$ownerUserId', ownerUserId] },
                  ...surveyExpr,
                ],
              },
            },
          },
        ],
        as: 'session',
      },
    },
    { $unwind: { path: '$session', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        farmerPhone: '$phoneNumber',
        questionId: '$question.id',
        questionText: '$question.text',
        answer: '$selectedOption',
        respondedAt: {
          $dateToString: {
            date: '$createdAt',
            format: '%Y-%m-%dT%H:%M:%S.%LZ',
            timezone: 'UTC',
          },
        },
        sessionStatus: '$session.status',
      },
    },
  ];

  return answers.aggregate(pipeline).toArray();
};

/**
 * Get KPI metrics for the specified range (daily | weekly | monthly)
 * Returns current and previous period counts with percent change and trend
 */
export const getKPIs = async (db, range = 'weekly', ownerUserId = null, surveyId = 'all') => {
  const sessions = getCollection(db, 'surveySessions');
  const farmers = getCollection(db, 'farmers');
  const ownerFilter = buildOwnerFilter(ownerUserId);
  const surveyFilter = buildSurveyFilter(surveyId);

  const rangeKey = ['daily', 'weekly', 'monthly', 'all'].includes(String(range)) ? String(range) : 'weekly';
  const now = new Date();
  let days = 7;
  if (rangeKey === 'daily') days = 1;
  if (rangeKey === 'monthly') days = 30;

  const periodEnd = now;
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevPeriodEnd = new Date(periodStart.getTime());
  const prevPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);

  // Helper to compute change
  const build = (current, previous) => {
    const prev = previous || 0;
    const change = prev === 0 ? (current === 0 ? 0 : 100) : ((current - prev) / prev) * 100;
    const trend = current > previous ? 'up' : current < previous ? 'down' : 'flat';
    let color = 'green';
    if (trend === 'down' && change < -10) color = 'red';
    if (trend === 'down' && change >= -10) color = 'orange';
    return {
      current,
      previous: prev,
      changePercent: Math.round(change),
      trend,
      color,
    };
  };

  const buildAbsolute = (current) => ({
    current,
    previous: 0,
    changePercent: 0,
    trend: 'flat',
    color: 'green',
  });

  if (rangeKey === 'all') {
    const [completedNow, inProgressNow, dropoutsNow] = await Promise.all([
      sessions.countDocuments({ status: 'completed', ...ownerFilter, ...surveyFilter }),
      sessions.countDocuments({ status: 'in_progress', ...ownerFilter, ...surveyFilter }),
      sessions.countDocuments({ status: 'dropped', ...ownerFilter, ...surveyFilter }),
    ]);

    const totalNow = normalizeSurveyScope(surveyId) === 'all'
      ? await farmers.countDocuments(ownerFilter)
      : (await sessions.distinct('phoneNumber', { ...ownerFilter, ...surveyFilter })).length;

    return {
      range: rangeKey,
      period: null,
      kpis: {
        totalFarmers: buildAbsolute(totalNow),
        completedSurveys: buildAbsolute(completedNow),
        inProgress: buildAbsolute(inProgressNow),
        dropouts: buildAbsolute(dropoutsNow),
      },
    };
  }

  // Completed surveys (sessions completed within this period)
  const completedNow = await sessions.countDocuments({ status: 'completed', completedAt: { $gte: periodStart, $lte: periodEnd }, ...ownerFilter, ...surveyFilter });
  const completedPrev = await sessions.countDocuments({ status: 'completed', completedAt: { $gte: prevPeriodStart, $lte: prevPeriodEnd }, ...ownerFilter, ...surveyFilter });

  // In progress (sessions still in_progress, created within this period)
  const inProgressNow = await sessions.countDocuments({ status: 'in_progress', createdAt: { $gte: periodStart, $lte: periodEnd }, ...ownerFilter, ...surveyFilter });
  const inProgressPrev = await sessions.countDocuments({ status: 'in_progress', createdAt: { $gte: prevPeriodStart, $lte: prevPeriodEnd }, ...ownerFilter, ...surveyFilter });

  // Dropouts (sessions marked dropped within this period)
  const dropoutsNow = await sessions.countDocuments({ status: 'dropped', createdAt: { $gte: periodStart, $lte: periodEnd }, ...ownerFilter, ...surveyFilter });
  const dropoutsPrev = await sessions.countDocuments({ status: 'dropped', createdAt: { $gte: prevPeriodStart, $lte: prevPeriodEnd }, ...ownerFilter, ...surveyFilter });

  // Total farmers = absolute count from the farmers collection (not time-filtered)
  const totalNow = normalizeSurveyScope(surveyId) === 'all'
    ? await farmers.countDocuments(ownerFilter)
    : (await sessions.distinct('phoneNumber', { ...ownerFilter, ...surveyFilter })).length;
  const totalPrev = normalizeSurveyScope(surveyId) === 'all'
    ? await farmers.countDocuments({ createdAt: { $lte: prevPeriodEnd }, ...ownerFilter })
    : (await sessions.distinct('phoneNumber', { createdAt: { $lte: prevPeriodEnd }, ...ownerFilter, ...surveyFilter })).length;

  return {
    range: rangeKey,
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    kpis: {
      totalFarmers: build(totalNow, totalPrev),
      completedSurveys: build(completedNow, completedPrev),
      inProgress: build(inProgressNow, inProgressPrev),
      dropouts: build(dropoutsNow, dropoutsPrev),
    },
  };
};

/**
 * Export all survey data to flattened format
 * Returns array of objects (one row per farmer's survey)
 */
export const exportSurveyData = async (db, ownerUserId = null, surveyId = 'all') => {
  const answers = getCollection(db, 'answers');
  const pipeline = [
    { $match: { ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) } },
    {
      $lookup: {
        from: 'questions',
        let: { qid: '$questionId' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$id', '$$qid'] }, { $eq: ['$ownerUserId', ownerUserId] }] } } },
        ],
        as: 'question',
      },
    },
    { $unwind: { path: '$question', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'farmers',
        let: { phone: '$phoneNumber' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$phoneNumber', '$$phone'] }, { $eq: ['$ownerUserId', ownerUserId] }] } } },
        ],
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    { $sort: { phoneNumber: 1, createdAt: 1 } },
    {
      $project: {
        _id: 0,
        farmerPhone: '$phoneNumber',
        region: { $ifNull: ['$farmer.region', 'Unknown'] },
        language: '$farmer.preferredLanguage',
        sessionId: '$sessionId',
        questionId: '$question.id',
        questionText: '$question.text',
        answer: '$selectedOption',
        respondedAt: {
          $dateToString: {
            date: '$createdAt',
            format: '%Y-%m-%dT%H:%M:%S.%LZ',
            timezone: 'UTC',
          },
        },
      },
    },
  ];

  return answers.aggregate(pipeline).toArray();
};

/**
 * Export to Excel (.xlsx)
 * TODO: Implement in Phase 3
 */
export const exportToExcelBuffer = async (db, ownerUserId = null, surveyId = 'all') => {
  const rows = await exportSurveyData(db, ownerUserId, surveyId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Farmer Survey Platform';
  workbook.created = new Date();

  const dataSheet = workbook.addWorksheet('Survey Data');
  dataSheet.columns = [
    { header: 'Farmer Phone', key: 'farmerPhone', width: 18 },
    { header: 'Region', key: 'region', width: 16 },
    { header: 'Language', key: 'language', width: 14 },
    { header: 'Session ID', key: 'sessionId', width: 28 },
    { header: 'Question ID', key: 'questionId', width: 10 },
    { header: 'Question Text', key: 'questionText', width: 40 },
    { header: 'Answer', key: 'answer', width: 18 },
    { header: 'Responded At', key: 'respondedAt', width: 22 },
  ];

  rows.forEach((row) => dataSheet.addRow(row));

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 24 },
    { header: 'Value', key: 'value', width: 18 },
  ];

  const summary = await getSurveySummary(db, ownerUserId, surveyId);
  summarySheet.addRow({ metric: 'Total Farmers', value: summary.totalFarmers || 0 });
  summarySheet.addRow({ metric: 'Completed Sessions', value: summary.completedSessions || 0 });
  summarySheet.addRow({ metric: 'In Progress Sessions', value: summary.inProgressSessions || 0 });

  const cropDist = await getCropDistribution(db, ownerUserId, surveyId);
  summarySheet.addRow({ metric: '--- Crop Distribution ---', value: '' });
  cropDist.forEach((item) => summarySheet.addRow({ metric: item.crop, value: item.count }));

  const seedUsage = await getSeedUsage(db, ownerUserId, surveyId);
  summarySheet.addRow({ metric: '--- Seed Usage ---', value: '' });
  seedUsage.forEach((item) => summarySheet.addRow({ metric: item.response, value: item.count }));

  const fertUsage = await getFertilizerUsage(db, ownerUserId, surveyId);
  summarySheet.addRow({ metric: '--- Fertilizer Usage ---', value: '' });
  fertUsage.forEach((item) => summarySheet.addRow({ metric: item.response, value: item.count }));

  const regionStats = await getRegionStats(db, ownerUserId, surveyId);
  summarySheet.addRow({ metric: '--- Region Stats ---', value: '' });
  regionStats.forEach((item) =>
    summarySheet.addRow({ metric: item.region, value: item.farmerCount })
  );

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

