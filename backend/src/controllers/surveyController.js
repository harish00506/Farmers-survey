import * as surveyEngine from '../services/surveyEngine.js';
import * as translationService from '../services/translationService.js';
import { getModelByCollection } from '../models/index.js';
import { synthesizeText } from '../services/ttsService.js';

const SUPPORTED_LANGS = ['telugu', 'hindi', 'kannada', 'marathi', 'tamil'];
const DEFAULT_SURVEY_ID = 'survey1';
const normalizeSurveyId = (surveyId) => String(surveyId || DEFAULT_SURVEY_ID).trim();
const getCollection = (name) => getModelByCollection(name).collection;

const ensureDefaultSurvey = async (db, ownerUserId) => {
  const surveys = getCollection('surveys');
  await surveys.updateOne(
    { id: DEFAULT_SURVEY_ID, ownerUserId },
    {
      $setOnInsert: {
        id: DEFAULT_SURVEY_ID,
        name: 'Survey 1',
        status: 'active',
        createdAt: new Date(),
      },
      $set: {
        ownerUserId,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
};

export const listSurveysHandler = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    const db = req.app.locals.mongoDb;
    await ensureDefaultSurvey(db, ownerUserId);

    const surveys = getCollection('surveys');
    const docs = await surveys.find({ ownerUserId }).sort({ createdAt: 1 }).toArray();
    res.json({ success: true, surveys: docs.map((doc) => ({ ...doc, _id: undefined })) });
  } catch (err) {
    console.error('❌ listSurveys error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createSurveyHandler = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    const db = req.app.locals.mongoDb;
    const surveys = getCollection('surveys');
    const id = normalizeSurveyId(req.body?.id);
    const name = String(req.body?.name || id).trim();

    if (!id) {
      return res.status(400).json({ success: false, error: 'Survey id is required' });
    }

    const existing = await surveys.findOne({ id, ownerUserId });
    if (existing) {
      return res.status(409).json({ success: false, error: `Survey already exists: ${id}` });
    }

    await surveys.insertOne({
      id,
      name,
      status: req.body?.status || 'active',
      ownerUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({ success: true, survey: { id, name, status: req.body?.status || 'active' } });
  } catch (err) {
    console.error('❌ createSurvey error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const updateSurveyHandler = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    const db = req.app.locals.mongoDb;
    const surveys = getCollection('surveys');
    const id = normalizeSurveyId(req.params.id);
    const updates = {};

    if (typeof req.body?.name === 'string') updates.name = req.body.name.trim();
    if (typeof req.body?.status === 'string') updates.status = req.body.status.trim();
    updates.updatedAt = new Date();

    const result = await surveys.findOneAndUpdate(
      { id, ownerUserId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ success: false, error: 'Survey not found' });
    }

    res.json({ success: true, survey: { ...result.value, _id: undefined } });
  } catch (err) {
    console.error('❌ updateSurvey error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const deleteSurveyHandler = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    const surveyId = normalizeSurveyId(req.params.id);

    if (!surveyId) {
      return res.status(400).json({ success: false, error: 'Survey id is required' });
    }

    if (surveyId === DEFAULT_SURVEY_ID) {
      return res.status(400).json({ success: false, error: `Cannot delete default survey: ${DEFAULT_SURVEY_ID}` });
    }

    const surveys = getCollection('surveys');
    const questions = getCollection('questions');
    const transitions = getCollection('questionTransitions');
    const answers = getCollection('answers');
    const sessions = getCollection('surveySessions');
    const farmers = getCollection('farmers');

    const existing = await surveys.findOne({ id: surveyId, ownerUserId });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Survey not found' });
    }

    await Promise.all([
      surveys.deleteOne({ id: surveyId, ownerUserId }),
      questions.deleteMany({ surveyId, ownerUserId }),
      transitions.deleteMany({ surveyId, ownerUserId }),
      answers.deleteMany({ surveyId, ownerUserId }),
      sessions.deleteMany({ surveyId, ownerUserId }),
      farmers.updateMany(
        { ownerUserId, lastInvitedSurveyId: surveyId },
        { $set: { lastInvitedSurveyId: DEFAULT_SURVEY_ID, updatedAt: new Date() } }
      ),
    ]);

    return res.json({ success: true, deletedSurveyId: surveyId });
  } catch (err) {
    console.error('❌ deleteSurvey error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
};

export const listQuestionsHandler = async (req, res) => {
  try {
    const { skip, limit, includeArchived, surveyId } = req.query;
    const ownerUserId = req.user?.id;
    const docs = await surveyEngine.listQuestions(
      req.app.locals.mongoDb,
      { skip, limit, includeArchived: includeArchived === 'true', surveyId: surveyId || DEFAULT_SURVEY_ID },
      ownerUserId
    );
    res.json({ success: true, questions: docs });
  } catch (err) {
    console.error('❌ listQuestions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getQuestionHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const surveyId = req.query.surveyId || DEFAULT_SURVEY_ID;
    const ownerUserId = req.user?.id;
    const doc = await surveyEngine.getQuestionById(req.app.locals.mongoDb, id, ownerUserId, surveyId);
    if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, question: doc });
  } catch (err) {
    console.error('❌ getQuestion error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createQuestionHandler = async (req, res) => {
  try {
    const payload = { ...req.body, surveyId: req.body?.surveyId || DEFAULT_SURVEY_ID };
    const ownerUserId = req.user?.id;
    const created = await surveyEngine.createQuestion(req.app.locals.mongoDb, payload, ownerUserId);

    // Auto-translate on create (default behaviour)
    const langs = SUPPORTED_LANGS;
    let translations = {};
    try {
      translations = await translationService.translateQuestion(req.app.locals.mongoDb, created.id, langs, ownerUserId, payload.surveyId);
    } catch (tErr) {
      console.warn('⚠️ Translation on create failed:', tErr.message);
    }

    const question = await surveyEngine.getQuestionById(req.app.locals.mongoDb, created.id, ownerUserId, payload.surveyId);

    res.status(201).json({ success: true, question: question || created, translations });
  } catch (err) {
    console.error('❌ createQuestion error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const updateQuestionHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const surveyId = req.query.surveyId || req.body?.surveyId || DEFAULT_SURVEY_ID;
    const updates = req.body;
    const ownerUserId = req.user?.id;
    await surveyEngine.updateQuestion(req.app.locals.mongoDb, id, updates, ownerUserId, surveyId);

    // Auto retranslate on edit unless disabled with query param ?retranslate=false
    const retranslate = req.query.retranslate !== 'false';
    let translations = {};
    if (retranslate) {
      try {
        translations = await translationService.translateQuestion(req.app.locals.mongoDb, id, SUPPORTED_LANGS, ownerUserId, surveyId);
      } catch (tErr) {
        console.warn('⚠️ Translation on update failed:', tErr.message);
      }
    }

    // Invalidate all TTS cache for this question (text/options likely changed)
    try {
      const audio = getCollection('audio');
      const del = await audio.deleteMany({
        questionId: id,
        source: { $in: ['twilio_tts_question', 'tts'] },
      });
      if (del.deletedCount > 0) {
        console.log(`🗑️ Deleted ${del.deletedCount} stale TTS entries after question update for ${id}`);
      }
    } catch (err) {
      console.warn('⚠️ Failed to clear TTS cache after question update:', err.message);
    }

    const updated = await surveyEngine.getQuestionById(req.app.locals.mongoDb, id, ownerUserId, surveyId);

    res.json({ success: true, question: updated, translations });
  } catch (err) {
    console.error('❌ updateQuestion error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const deleteQuestionHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const surveyId = req.query.surveyId || DEFAULT_SURVEY_ID;
    const ownerUserId = req.user?.id;
    await surveyEngine.deleteQuestion(req.app.locals.mongoDb, id, ownerUserId, surveyId);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ deleteQuestion error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const translateQuestionHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const languages = Array.isArray(req.body.languages) && req.body.languages.length > 0 ? req.body.languages : SUPPORTED_LANGS;
    const surveyId = req.query.surveyId || req.body?.surveyId || DEFAULT_SURVEY_ID;
    const ownerUserId = req.user?.id;
    const result = await translationService.translateQuestion(req.app.locals.mongoDb, id, languages, ownerUserId, surveyId);

    // Invalidate stale TTS cache for the re-translated languages
    const changedLangs = languages.map(l => l.trim().toLowerCase()).filter(l => l && l !== 'english');
    if (changedLangs.length > 0) {
      try {
        const audio = getCollection('audio');
        const del = await audio.deleteMany({
          questionId: id,
          lang: { $in: changedLangs },
          source: { $in: ['twilio_tts_question', 'tts'] },
        });
        if (del.deletedCount > 0) {
          console.log(`🗑️ Deleted ${del.deletedCount} stale TTS entries after AI translate for question ${id}`);
        }
      } catch (err) {
        console.warn('⚠️ Failed to clear TTS cache after AI translate:', err.message);
      }
    }

    res.json({ success: true, translations: result });
  } catch (err) {
    console.error('❌ translateQuestion error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

/**
 * Manually update (correct) translations for a question.
 * Accepts body: { translations: { <lang>: { text, options } } }
 * Does NOT trigger auto-retranslation.
 */
export const updateTranslationsHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const surveyId = req.query.surveyId || req.body?.surveyId || DEFAULT_SURVEY_ID;
    const ownerUserId = req.user?.id;
    const translations = req.body?.translations;

    if (!translations || typeof translations !== 'object') {
      return res.status(400).json({ success: false, error: 'translations object is required' });
    }

    const questions = getCollection('questions');
    const normalizedSurveyId = normalizeSurveyId(surveyId);
    const buildSurveyFilter = (sid) => {
      if (sid === DEFAULT_SURVEY_ID) {
        return { $or: [{ surveyId: DEFAULT_SURVEY_ID }, { surveyId: { $exists: false } }] };
      }
      return { surveyId: sid };
    };
    const ownerFilter = ownerUserId ? { ownerUserId } : {};
    const existing = await questions.findOne({ id, ...ownerFilter, ...buildSurveyFilter(normalizedSurveyId) });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Question not found' });
    }

    const $set = { updatedAt: new Date() };
    for (const [lang, data] of Object.entries(translations)) {
      const normalizedLang = String(lang || '').trim().toLowerCase();
      if (!normalizedLang || normalizedLang === 'english') continue;
      if (!SUPPORTED_LANGS.includes(normalizedLang)) continue;

      if (data.text !== undefined) {
        $set[`text_${normalizedLang}`] = String(data.text || '').trim();
      }
      if (Array.isArray(data.options)) {
        $set[`options_${normalizedLang}`] = data.options.map((o) => String(o ?? '').trim());
      }
      $set[`manualTranslation.${normalizedLang}`] = { by: 'user', timestamp: new Date() };
    }

    await questions.updateOne(
      { id, ...ownerFilter, ...buildSurveyFilter(normalizedSurveyId) },
      { $set }
    );

    const updated = await questions.findOne({ id, ...ownerFilter, ...buildSurveyFilter(normalizedSurveyId) });

    // ── Invalidate & regenerate TTS for every language whose text changed ──
    const changedLangs = Object.keys(translations)
      .map(l => l.trim().toLowerCase())
      .filter(l => l && l !== 'english' && SUPPORTED_LANGS.includes(l));

    if (changedLangs.length > 0 && updated) {
      const audio = getCollection('audio');

      // Delete old cached TTS entries for the changed languages
      try {
        const deleteResult = await audio.deleteMany({
          questionId: id,
          lang: { $in: changedLangs },
          source: { $in: ['twilio_tts_question', 'tts'] },
        });
        if (deleteResult.deletedCount > 0) {
          console.log(`🗑️ Deleted ${deleteResult.deletedCount} stale TTS cache entries for question ${id} langs=[${changedLangs}]`);
        }
      } catch (err) {
        console.warn('⚠️ Failed to delete stale TTS cache:', err.message);
      }

      // Regenerate TTS in the background (don't block the response)
      setImmediate(async () => {
        for (const lang of changedLangs) {
          try {
            const questionText = updated[`text_${lang}`] || updated.text || '';
            const localizedOpts = Array.isArray(updated[`options_${lang}`]) ? updated[`options_${lang}`] : (updated.options || []);
            const optionsScript = localizedOpts.map((opt, i) => `${i + 1}. ${opt}`).join('. ');
            const spokenScript = `${questionText}. ${optionsScript}.`;

            const format = process.env.TTS_FORMAT || 'mp3';
            const result = await synthesizeText(spokenScript, { lang, format });
            if (result) {
              await audio.insertOne({
                id: result.audioId,
                fileName: result.fileName,
                filePath: result.filePath,
                mimeType: result.mimeType,
                fileSize: result.fileSize,
                source: 'tts',
                sourceText: spokenScript,
                lang,
                questionId: id,
                surveyId: normalizedSurveyId,
                createdAt: new Date(),
                transcriptionStatus: 'not_requested',
              });
              console.log(`🔊 Regenerated TTS for question ${id} lang=${lang}`);
            }
          } catch (err) {
            console.warn(`⚠️ TTS regen failed for question ${id} lang=${lang}:`, err.message);
          }
        }
      });
    }

    res.json({ success: true, question: updated });
  } catch (err) {
    console.error('❌ updateTranslations error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

// Transitions: minimal CRUD
export const createTransitionHandler = async (req, res) => {
  try {
    const payload = req.body;
    const ownerUserId = req.user?.id;
    const transitions = getCollection('questionTransitions');
    const surveyId = payload.surveyId || DEFAULT_SURVEY_ID;
    await transitions.updateOne(
      { fromId: payload.fromId, type: payload.type, optionIndex: payload.optionIndex, surveyId, ownerUserId },
      { $set: { ...payload, surveyId, ownerUserId } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('❌ createTransition error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const listTransitionsHandler = async (req, res) => {
  try {
    const ownerUserId = req.user?.id;
    const surveyId = req.query.surveyId || DEFAULT_SURVEY_ID;
    const transitions = getCollection('questionTransitions');
    const docs = await transitions.find({ ownerUserId, surveyId }).toArray();
    res.json({ success: true, transitions: docs });
  } catch (err) {
    console.error('❌ listTransitions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteTransitionHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const ownerUserId = req.user?.id;
    const transitions = getCollection('questionTransitions');
    await transitions.deleteOne({ _id: id, ownerUserId });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ deleteTransition error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

export const resequenceHandler = async (req, res) => {
  try {
    const orderedIds = req.body.orderedIds;
    const surveyId = req.body?.surveyId || req.query?.surveyId || DEFAULT_SURVEY_ID;
    const ownerUserId = req.user?.id;
    await surveyEngine.resequenceQuestions(req.app.locals.mongoDb, orderedIds, ownerUserId, surveyId);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ resequence error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};
