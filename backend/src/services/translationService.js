import Groq from 'groq-sdk';
import { getModelByCollection } from '../models/index.js';

const getCollection = (_db, name) => getModelByCollection(name).collection;
const buildOwnerFilter = (ownerUserId) => (ownerUserId ? { ownerUserId } : {});
const DEFAULT_SURVEY_ID = 'survey1';
const normalizeSurveyId = (surveyId) => String(surveyId || DEFAULT_SURVEY_ID).trim();
const buildSurveyFilter = (surveyId) => {
  const normalized = normalizeSurveyId(surveyId);
  if (normalized === DEFAULT_SURVEY_ID) {
    return {
      $or: [
        { surveyId: DEFAULT_SURVEY_ID },
        { surveyId: { $exists: false } },
      ],
    };
  }

  return { surveyId: normalized };
};

const TRANSLATION_SYSTEM_PROMPT = `You are a precise translation assistant. You are given a question text in English and an array of options. Return a strict JSON object with two fields: "text" containing the translated question text, and "options" containing an array of translated options in the same order. Respond ONLY with valid JSON. Do not add commentary, do not change option order, do not add or remove options, and preserve punctuation.`;

const parseJsonSafe = (content) => {
  try {
    // Try to find a JSON substring if model returns text
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = content.slice(start, end + 1);
      return JSON.parse(candidate);
    }
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
};

export const translateText = async (sourceText, sourceOptions, targetLang) => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const temperature = Number(process.env.GROQ_TEMPERATURE || 0);
  const maxTokens = Number(process.env.GROQ_MAX_TOKENS || 1024);

  const normalizedTargetLang = String(targetLang || '').trim().toLowerCase();
  if (!normalizedTargetLang) {
    throw new Error('Target language is required');
  }

  const userPrompt = `Translate to ${normalizedTargetLang}.

Question: ${sourceText}

Options: ${JSON.stringify(sourceOptions)}\n\nRespond with JSON as specified.`;

  const completion = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = completion.choices?.[0]?.message?.content || '';
  const parsed = parseJsonSafe(content);
  if (!parsed || !parsed.text || !Array.isArray(parsed.options)) {
    throw new Error('Failed to parse translation response');
  }

  if (parsed.options.length !== sourceOptions.length) {
    throw new Error('Translation response has mismatched options length');
  }

  return {
    text: String(parsed.text || '').trim(),
    options: parsed.options.map((item) => String(item ?? '').trim()),
  };
};

export const translateQuestion = async (db, questionId, languages = [], ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  const questions = getCollection(db, 'questions');
  const surveyFilter = buildSurveyFilter(surveyId);
  const question = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...surveyFilter });
  if (!question) throw new Error(`Question not found: ${questionId}`);

  const sourceText = question.text;
  const sourceOptions = question.options || [];

  const results = {};
  for (const lang of languages) {
    const normalizedLang = String(lang || '').trim().toLowerCase();
    if (!normalizedLang || normalizedLang === 'english') {
      continue;
    }

    try {
      const translated = await translateText(sourceText, sourceOptions, normalizedLang);

      // store using existing pattern: text_<lang> and options_<lang>
      const textField = `text_${normalizedLang}`;
      const optionsField = `options_${normalizedLang}`;

      await questions.updateOne(
        { id: questionId, ...buildOwnerFilter(ownerUserId), ...surveyFilter },
        {
          $set: {
            [textField]: translated.text,
            [optionsField]: translated.options,
            [`autoTranslated.${normalizedLang}`]: { by: 'groq', timestamp: new Date(), source: 'en' },
          },
        },
      );

      results[normalizedLang] = { success: true, text: translated.text };
    } catch (err) {
      console.error(`❌ Translation failed for ${normalizedLang}:`, err.message);
      results[normalizedLang] = { success: false, error: err.message };
    }
  }

  return results;
};
