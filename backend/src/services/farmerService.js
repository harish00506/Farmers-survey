/**
 * Simple farmer data service for listing and fetching farmer details
 */
import { getModelByCollection } from '../models/index.js';

const getCollection = (name) => getModelByCollection(name).collection;
const DEFAULT_SURVEY_ID = 'survey1';

const toMapKey = (phone, surveyId) => `${String(phone || '').trim()}::${String(surveyId || DEFAULT_SURVEY_ID).trim() || DEFAULT_SURVEY_ID}`;

export async function listFarmers(db, ownerUserId = null) {
    const farmersColl = getCollection('farmers');
    const answersColl = getCollection('answers');
    const questionsColl = getCollection('questions');

    const pipeline = [
        ...(ownerUserId ? [{ $match: { ownerUserId } }] : []),
        // Lookup the most recent session for this farmer (if any)
        {
            $lookup: {
                from: 'surveySessions',
                let: { phone: '$phoneNumber' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$phoneNumber', '$$phone'] },
                                    ...(ownerUserId ? [{ $eq: ['$ownerUserId', ownerUserId] }] : []),
                                ],
                            },
                        },
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1 },
                ],
                as: 'sessions',
            },
        },
        // Lookup answers for this farmer to compute questions answered
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
                                    ...(ownerUserId ? [{ $eq: ['$ownerUserId', ownerUserId] }] : []),
                                ],
                            },
                        },
                    },
                    { $count: 'count' },
                ],
                as: 'answerCount',
            },
        },
        {
            $addFields: {
                questionsAnswered: { $ifNull: [{ $arrayElemAt: ['$answerCount.count', 0] }, 0] },
                session: { $arrayElemAt: ['$sessions', 0] },
            },
        },
        {
            $project: {
                _id: 0,
                phone: '$phoneNumber',
                region: 1,
                language: '$preferredLanguage',
                status: 1,
                sessionStatus: '$session.status',
                completionDate: '$session.completedAt',
                sessionId: '$session.id',
                surveyId: { $ifNull: ['$session.surveyId', DEFAULT_SURVEY_ID] },
                startedAt: '$session.startedAt',
                lastActivityAt: '$session.updatedAt',
            },
        },
        { $sort: { phone: 1 } },
    ];

    const baseResults = await farmersColl.aggregate(pipeline).toArray();
    if (baseResults.length === 0) return [];

    const phones = Array.from(new Set(baseResults.map((item) => item.phone).filter(Boolean)));
    const surveyIds = Array.from(new Set(baseResults.map((item) => item.surveyId || DEFAULT_SURVEY_ID)));

    const [answerGroups, questionGroups] = await Promise.all([
        answersColl.aggregate([
            {
                $match: {
                    phoneNumber: { $in: phones },
                    ...(ownerUserId ? { ownerUserId } : {}),
                },
            },
            {
                $group: {
                    _id: {
                        phoneNumber: '$phoneNumber',
                        surveyId: { $ifNull: ['$surveyId', DEFAULT_SURVEY_ID] },
                        questionId: '$questionId',
                    },
                },
            },
            {
                $group: {
                    _id: {
                        phoneNumber: '$_id.phoneNumber',
                        surveyId: '$_id.surveyId',
                    },
                    count: { $sum: 1 },
                },
            },
        ]).toArray(),
        questionsColl.aggregate([
            {
                $match: {
                    surveyId: { $in: surveyIds },
                    ...(ownerUserId ? { ownerUserId } : {}),
                    $or: [
                        { archived: { $exists: false } },
                        { archived: { $ne: true } },
                    ],
                },
            },
            {
                $group: {
                    _id: '$surveyId',
                    total: { $sum: 1 },
                },
            },
        ]).toArray(),
    ]);

    const answersByPhoneSurvey = new Map(
        answerGroups.map((item) => [toMapKey(item?._id?.phoneNumber, item?._id?.surveyId), Number(item?.count || 0)])
    );
    const questionsBySurvey = new Map(
        questionGroups.map((item) => [String(item?._id || DEFAULT_SURVEY_ID), Number(item?.total || 0)])
    );

    return baseResults.map((item) => {
        const surveyId = String(item.surveyId || DEFAULT_SURVEY_ID).trim() || DEFAULT_SURVEY_ID;
        const questionsAnswered = answersByPhoneSurvey.get(toMapKey(item.phone, surveyId)) || 0;
        const totalQuestions = questionsBySurvey.get(surveyId) || 0;

        return {
            ...item,
            surveyId,
            questionsAnswered,
            totalQuestions,
        };
    });
}

export async function getFarmerByPhone(db, phone, ownerUserId = null) {
    const farmers = getCollection('farmers');
    const sessions = getCollection('surveySessions');
    const answers = getCollection('answers');
    const questions = getCollection('questions');

    const farmer = await farmers.findOne({ phoneNumber: phone, ...(ownerUserId ? { ownerUserId } : {}) });
    if (!farmer) return null;

    const session = await sessions.findOne(
        { phoneNumber: phone, ...(ownerUserId ? { ownerUserId } : {}) },
        { sort: { createdAt: -1 } }
    );

    const surveyId = String(session?.surveyId || DEFAULT_SURVEY_ID).trim() || DEFAULT_SURVEY_ID;
    const answerDocs = await answers
        .find({
            phoneNumber: phone,
            surveyId,
            ...(ownerUserId ? { ownerUserId } : {}),
        })
        .sort({ createdAt: 1 })
        .toArray();

    const uniqueAnsweredQuestionCount = new Set(
        answerDocs
            .map((item) => String(item?.questionId || '').trim())
            .filter(Boolean)
    ).size;

    const totalQuestions = await questions.countDocuments({
        surveyId,
        ...(ownerUserId ? { ownerUserId } : {}),
        $or: [
            { archived: { $exists: false } },
            { archived: { $ne: true } },
        ],
    });

    return {
        phone: farmer.phoneNumber,
        region: farmer.region,
        language: farmer.preferredLanguage,
        status: farmer.status,
        session: session ?? null,
        surveyId,
        answers: answerDocs,
        questionsAnswered: uniqueAnsweredQuestionCount,
        totalQuestions,
    };
}

export async function deleteFarmerByPhone(db, phone, ownerUserId = null) {
    const farmers = getCollection('farmers');
    const sessions = getCollection('surveySessions');
    const answers = getCollection('answers');
    const audio = getCollection('audio');
    const regions = getCollection('regions');

    const filter = { phoneNumber: phone, ...(ownerUserId ? { ownerUserId } : {}) };

    const [farmerResult, sessionsResult, answersResult, audioResult, regionsResult] = await Promise.all([
        farmers.deleteOne(filter),
        sessions.deleteMany(filter),
        answers.deleteMany(filter),
        audio.deleteMany(filter),
        regions.deleteMany(filter),
    ]);

    return {
        found: farmerResult.deletedCount > 0,
        deletedFarmerCount: farmerResult.deletedCount,
        deletedSessionCount: sessionsResult.deletedCount,
        deletedAnswerCount: answersResult.deletedCount,
        deletedAudioCount: audioResult.deletedCount,
        deletedRegionCount: regionsResult.deletedCount,
    };
}
