import Groq from 'groq-sdk';
import { getModelByCollection } from '../models/index.js';

const getCollection = (_db, name) => getModelByCollection(name).collection;
const buildOwnerFilter = (ownerUserId) => (ownerUserId ? { ownerUserId } : {});

/**
 * AI Chat Service (Phase 4)
 * Powers "Chat with Survey Data" feature
 * 
 * SAFETY RULES:
 * - AI only sees filtered, aggregated survey data
 * - AI NEVER generates missing answers
 * - AI NEVER infers farmer behavior
 * - AI is ONLY used for summarization and insight generation
 */

/**
 * System prompt that enforces safety guardrails
 */
const SYSTEM_PROMPT = `You are an agricultural data analyst. Your job is to help interpret farmer survey data.

IMPORTANT RULES:
1. You ONLY analyze data that is provided to you. Do NOT make up statistics.
2. You NEVER infer or guess missing data.
3. You NEVER fill in gaps with external information.
4. You ONLY provide summaries, trends, and insights based on actual collected responses.
5. Be clear about the number of responses you're analyzing.
6. If data is limited, say so explicitly.
7. Provide insights in simple, non-technical language suitable for policymakers.

You have access to farmer survey responses. Answer questions based ONLY on this data.`;

/**
 * Parse user intent and extract data filters
 * Example: "Show seed usage by region" -> { question: 'Q4', aggregateBy: 'region' }
 */
export const parseUserIntent = async (userQuestion) => {
  // TODO: Implement in Phase 4 with Groq
  // For MVP, use simple pattern matching
  const lower = userQuestion.toLowerCase();

  const intent = {
    type: 'unknown', // summary, compare, region, question_specific
    filters: {},
  };

  if (lower.includes('seed') || lower.includes('Q4')) {
    intent.filters.questionId = 'Q4';
  }
  if (lower.includes('fertilizer') || lower.includes('Q5')) {
    intent.filters.questionId = 'Q5';
  }
  if (lower.includes('crop') || lower.includes('Q1')) {
    intent.filters.questionId = 'Q1';
  }
  if (lower.includes('region') || lower.includes('telangana') || lower.includes('karnataka')) {
    intent.aggregateBy = 'region';
  }

  return intent;
};

/**
 * Fetch filtered survey data based on intent
 */
export const fetchSurveyData = async (db, intent, ownerUserId = null) => {
  const questionId = intent.filters?.questionId || null;
  const answers = getCollection(db, 'answers');

  if (intent.aggregateBy === 'region') {
    const pipeline = [
      { $match: { ...(questionId ? { questionId } : {}), ...buildOwnerFilter(ownerUserId) } },
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
      {
        $group: {
          _id: { region: { $ifNull: ['$farmer.region', 'Unknown'] }, answer: '$selectedOption' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          region: '$_id.region',
          answer: '$_id.answer',
          count: 1,
        },
      },
      { $sort: { count: -1 } },
      { $limit: 200 },
    ];

    return answers.aggregate(pipeline).toArray();
  }

  const pipeline = [
    { $match: { ...(questionId ? { questionId } : {}), ...buildOwnerFilter(ownerUserId) } },
    { $sort: { createdAt: -1 } },
    { $limit: 200 },
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
    {
      $project: {
        _id: 0,
        question: '$question.text',
        answer: '$selectedOption',
        region: { $ifNull: ['$farmer.region', 'Unknown'] },
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
 * Call Groq LLM to analyze survey data and answer user question
 * TODO: Implement in Phase 4
 */
export const callGroqLLM = async (userQuestion, surveyData) => {
  if (!process.env.GROQ_API_KEY) {
    return 'Groq API key is not configured. Please set GROQ_API_KEY in .env.';
  }

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const temperature = Number(process.env.GROQ_TEMPERATURE || 0);
  const maxTokens = Number(process.env.GROQ_MAX_TOKENS || 1024);

  const dataPreview = JSON.stringify(surveyData, null, 2);
  const userPrompt = `User question: ${userQuestion}\n\nSurvey data (JSON):\n${dataPreview}`;

  const completion = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = completion.choices?.[0]?.message?.content || 'No response from AI.';
  return content.trim();
};

/**
 * Chat endpoint: User question -> MongoDB data -> Groq analysis
 */
export const chatWithData = async (db, userQuestion, ownerUserId = null) => {
  try {
    // Step 1: Parse intent
    const intent = await parseUserIntent(userQuestion);

    // Step 2: Fetch filtered data
    const surveyData = await fetchSurveyData(db, intent, ownerUserId);

    // Step 3: Call Groq with data context
    const response = await callGroqLLM(userQuestion, surveyData);

    return {
      success: true,
      userQuestion,
      dataPoints: surveyData.length,
      response,
    };
  } catch (error) {
    console.error('❌ Chat error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

