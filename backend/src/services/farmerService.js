/**
 * Simple farmer data service for listing and fetching farmer details
 */
import { getModelByCollection } from '../models/index.js';

const getCollection = (name) => getModelByCollection(name).collection;
const DEFAULT_SURVEY_ID = 'survey1';

const toMapKey = (phone, surveyId) => `${String(phone || '').trim()}::${String(surveyId || DEFAULT_SURVEY_ID).trim() || DEFAULT_SURVEY_ID}`;
const normalizeSurveyId = (surveyId) => String(surveyId || DEFAULT_SURVEY_ID).trim() || DEFAULT_SURVEY_ID;

const normalizePhoneNumber = (input) => {
    if (input === null || input === undefined) return null;

    let value = String(input).trim();
    if (!value) return null;

    value = value.replace(/[\u200E\u200F\u202A-\u202E\s\-().]/g, '');
    if (value.startsWith('00')) {
        value = `+${value.slice(2)}`;
    }

    const hasPlusPrefix = value.startsWith('+');
    const digitsOnly = value.replace(/\D/g, '');

    if (!digitsOnly) return null;

    if (hasPlusPrefix) {
        return `+${digitsOnly}`;
    }

    if (digitsOnly.length >= 10) {
        return `+${digitsOnly}`;
    }

    return null;
};

const parseCsvLine = (line) => {
    const values = [];
    let currentValue = '';
    let insideQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];

        if (character === '"') {
            if (insideQuotes && line[index + 1] === '"') {
                currentValue += '"';
                index += 1;
            } else {
                insideQuotes = !insideQuotes;
            }
            continue;
        }

        if (character === ',' && !insideQuotes) {
            values.push(currentValue.trim());
            currentValue = '';
            continue;
        }

        currentValue += character;
    }

    values.push(currentValue.trim());
    return values;
};

const parseFarmersFromCsv = (rawCsv = '') => {
    const lines = String(rawCsv || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return [];

    const headerColumns = parseCsvLine(lines[0]).map((value) => value.toLowerCase().trim());
    const hasHeader = headerColumns.some((column) => ['phone', 'phone_number', 'phonenumber', 'mobile', 'number', 'language', 'region'].includes(column));

    const phoneColumnIndex = hasHeader
        ? headerColumns.findIndex((column) => ['phone', 'phone_number', 'phonenumber', 'mobile', 'number'].includes(column))
        : -1;
    const languageColumnIndex = hasHeader
        ? headerColumns.findIndex((column) => ['language', 'preferredlanguage', 'preferred_language'].includes(column))
        : -1;
    const regionColumnIndex = hasHeader
        ? headerColumns.findIndex((column) => ['region', 'state', 'district', 'location'].includes(column))
        : -1;

    const startRow = hasHeader ? 1 : 0;
    const rows = [];

    for (let lineIndex = startRow; lineIndex < lines.length; lineIndex += 1) {
        const row = parseCsvLine(lines[lineIndex]);
        if (row.length === 0) continue;

        const rawPhone = phoneColumnIndex >= 0 ? row[phoneColumnIndex] : row[0];
        const phoneNumber = normalizePhoneNumber(rawPhone);
        if (!phoneNumber) continue;

        const preferredLanguage = languageColumnIndex >= 0 ? String(row[languageColumnIndex] || '').trim().toLowerCase() : '';
        const region = regionColumnIndex >= 0 ? String(row[regionColumnIndex] || '').trim().toLowerCase() : '';

        rows.push({
            phoneNumber,
            ...(preferredLanguage ? { preferredLanguage } : {}),
            ...(region ? { region } : {}),
        });
    }

    return rows;
};

const buildSurveyMatch = (surveyId) => {
    const normalizedSurveyId = normalizeSurveyId(surveyId);
    if (normalizedSurveyId === DEFAULT_SURVEY_ID) {
        return {
            $or: [
                { surveyId: DEFAULT_SURVEY_ID },
                { surveyId: { $exists: false } },
            ],
        };
    }

    return { surveyId: normalizedSurveyId };
};

const normalizeSelectedOption = (selectedOption) => {
    if (typeof selectedOption !== 'string') return null;
    const normalized = selectedOption.trim().toLowerCase();
    return normalized || null;
};

const parseSelectedOptionIndex = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.trunc(parsed);
};

const normalizeFilterCondition = (raw = {}) => {
    const sourceSurveyId = normalizeSurveyId(raw.sourceSurveyId || raw.surveyId || DEFAULT_SURVEY_ID);
    const sourceQuestionId = String(raw.sourceQuestionId || raw.questionId || '').trim();

    if (!sourceQuestionId) return null;

    return {
        sourceSurveyId,
        sourceQuestionId,
        selectedOption: normalizeSelectedOption(raw.selectedOption),
        selectedOptionIndex: parseSelectedOptionIndex(raw.selectedOptionIndex),
    };
};

const normalizeFilterConditions = (filters = {}) => {
    const rawConditions = Array.isArray(filters.filters) && filters.filters.length > 0
        ? filters.filters
        : [filters];

    const conditions = rawConditions
        .map((condition) => normalizeFilterCondition(condition))
        .filter(Boolean);

    return conditions;
};

const findMatchedPhonesForCondition = async (answersCollection, condition, ownerUserId, candidatePhoneSet = null, limit = 500) => {
    const queryLimit = Math.max(200, Math.min(limit * 40, 20000));

    const answerDocs = await answersCollection
        .find({
            questionId: condition.sourceQuestionId,
            ...(ownerUserId ? { ownerUserId } : {}),
            ...buildSurveyMatch(condition.sourceSurveyId),
            ...(candidatePhoneSet && candidatePhoneSet.size > 0 ? { phoneNumber: { $in: Array.from(candidatePhoneSet) } } : {}),
        })
        .sort({ createdAt: -1 })
        .limit(queryLimit)
        .toArray();

    const latestByPhone = new Map();
    for (const answerDoc of answerDocs) {
        const phoneNumber = String(answerDoc?.phoneNumber || '').trim();
        if (!phoneNumber || latestByPhone.has(phoneNumber)) continue;
        latestByPhone.set(phoneNumber, answerDoc);
    }

    const matchedByPhone = new Map();
    for (const [phoneNumber, answerDoc] of latestByPhone.entries()) {
        const normalizedAnswerOption = normalizeSelectedOption(answerDoc?.selectedOption || answerDoc?.answerText || '');
        const optionMatches = condition.selectedOption ? normalizedAnswerOption === condition.selectedOption : true;
        const indexMatches = Number.isInteger(condition.selectedOptionIndex)
            ? Number(answerDoc?.selectedOptionIndex) === Number(condition.selectedOptionIndex)
            : true;

        if (!optionMatches || !indexMatches) continue;
        matchedByPhone.set(phoneNumber, answerDoc);
    }

    return matchedByPhone;
};

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

export async function importFarmersFromCsv(db, csvText, ownerUserId = null) {
    const farmers = getCollection('farmers');
    const entries = parseFarmersFromCsv(csvText);

    if (entries.length === 0) {
        return {
            importedCount: 0,
            createdCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            farmers: [],
        };
    }

    const uniqueByPhone = new Map();
    for (const entry of entries) {
        uniqueByPhone.set(entry.phoneNumber, entry);
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const entry of uniqueByPhone.values()) {
        const existing = await farmers.findOne({ phoneNumber: entry.phoneNumber, ...(ownerUserId ? { ownerUserId } : {}) });
        await farmers.updateOne(
            { phoneNumber: entry.phoneNumber, ...(ownerUserId ? { ownerUserId } : {}) },
            {
                $set: {
                    phoneNumber: entry.phoneNumber,
                    ...(entry.preferredLanguage ? { preferredLanguage: entry.preferredLanguage } : {}),
                    ...(entry.region ? { region: entry.region } : {}),
                    status: existing?.status || 'in_progress',
                    ...(ownerUserId ? { ownerUserId } : {}),
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );

        if (existing) {
            updatedCount += 1;
        } else {
            createdCount += 1;
        }
    }

    return {
        importedCount: uniqueByPhone.size,
        createdCount,
        updatedCount,
        skippedCount: Math.max(entries.length - uniqueByPhone.size, 0),
        farmers: Array.from(uniqueByPhone.values()).map((item) => item.phoneNumber),
    };
}

export async function filterFarmersByAnswer(db, filters = {}, ownerUserId = null) {
    const answers = getCollection('answers');
    const farmers = getCollection('farmers');

    const mode = String(filters.mode || 'all').trim().toLowerCase() === 'any' ? 'any' : 'all';
    const conditions = normalizeFilterConditions(filters);
    const limit = Math.max(1, Math.min(Number(filters.limit) || 500, 5000));

    if (conditions.length === 0) {
        throw new Error('At least one valid filter condition is required');
    }

    const matchedByCondition = [];
    let candidatePhonesForAllMode = null;

    for (const condition of conditions) {
        const matchedForCondition = await findMatchedPhonesForCondition(
            answers,
            condition,
            ownerUserId,
            mode === 'all' ? candidatePhonesForAllMode : null,
            limit
        );

        matchedByCondition.push({ condition, matchedForCondition });

        if (mode === 'all') {
            candidatePhonesForAllMode = new Set(matchedForCondition.keys());
            if (candidatePhonesForAllMode.size === 0) break;
        }
    }

    let combinedPhones = [];
    if (mode === 'all') {
        const [first, ...rest] = matchedByCondition;
        const seed = new Set(first ? Array.from(first.matchedForCondition.keys()) : []);

        for (const item of rest) {
            const nextSet = new Set(item.matchedForCondition.keys());
            for (const phoneNumber of Array.from(seed)) {
                if (!nextSet.has(phoneNumber)) {
                    seed.delete(phoneNumber);
                }
            }
        }

        combinedPhones = Array.from(seed);
    } else {
        const union = new Set();
        for (const item of matchedByCondition) {
            for (const phoneNumber of item.matchedForCondition.keys()) {
                union.add(phoneNumber);
            }
        }
        combinedPhones = Array.from(union);
    }

    if (combinedPhones.length > limit) {
        combinedPhones = combinedPhones.slice(0, limit);
    }

    if (combinedPhones.length === 0) {
        return {
            mode,
            conditions,
            totalMatched: 0,
            farmers: [],
            phoneNumbers: [],
        };
    }

    const farmerDocs = await farmers.find({ phoneNumber: { $in: combinedPhones }, ...(ownerUserId ? { ownerUserId } : {}) }).toArray();
    const farmerByPhone = new Map(farmerDocs.map((item) => [String(item.phoneNumber || '').trim(), item]));

    const farmerResults = combinedPhones.map((phoneNumber) => {
        const farmer = farmerByPhone.get(phoneNumber) || null;
        const matchedConditions = matchedByCondition
            .map((item, index) => {
                const answerDoc = item.matchedForCondition.get(phoneNumber);
                if (!answerDoc) return null;

                return {
                    index,
                    questionId: item.condition.sourceQuestionId,
                    surveyId: item.condition.sourceSurveyId,
                    selectedOption: answerDoc.selectedOption || null,
                    selectedOptionIndex: Number.isInteger(Number(answerDoc.selectedOptionIndex))
                        ? Number(answerDoc.selectedOptionIndex)
                        : null,
                    answerText: answerDoc.answerText || null,
                    answeredAt: answerDoc.createdAt || null,
                };
            })
            .filter(Boolean);

        return {
            phoneNumber,
            preferredLanguage: farmer?.preferredLanguage || null,
            region: farmer?.region || null,
            status: farmer?.status || null,
            matchedConditions,
            matchedAnswer: matchedConditions[0] || null,
        };
    });

    const firstCondition = conditions[0] || null;
    return {
        mode,
        conditions,
        sourceSurveyId: firstCondition?.sourceSurveyId || null,
        sourceQuestionId: firstCondition?.sourceQuestionId || null,
        selectedOption: firstCondition?.selectedOption || null,
        selectedOptionIndex: firstCondition?.selectedOptionIndex ?? null,
        totalMatched: farmerResults.length,
        farmers: farmerResults,
        phoneNumbers: farmerResults.map((item) => item.phoneNumber),
    };
}
