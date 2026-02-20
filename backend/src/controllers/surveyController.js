import * as surveyEngine from '../services/surveyEngine.js';
import * as translationService from '../services/translationService.js';
import { getModelByCollection } from '../models/index.js';

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
    res.json({ success: true, translations: result });
  } catch (err) {
    console.error('❌ translateQuestion error:', err.message);
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
