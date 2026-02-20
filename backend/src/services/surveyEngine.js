import { getModelByCollection } from '../models/index.js';

const getCollection = (_db, name) => getModelByCollection(name).collection;
const buildOwnerFilter = (ownerUserId) => (ownerUserId ? { ownerUserId } : {});
const DEFAULT_SURVEY_ID = 'survey1';
const normalizeSurveyId = (surveyId) => String(surveyId || DEFAULT_SURVEY_ID).trim();
const generateQuestionBackendId = () => `qb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const buildSurveyFilter = (surveyId) => {
  const normalized = normalizeSurveyId(surveyId);
  if (!normalized) return {};
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

export const validateQuestionnaire = (questions) => {
  const issues = [];
  if (!Array.isArray(questions) || questions.length === 0) {
    issues.push('No questions provided');
    return { ok: false, issues };
  }

  const ids = new Set();
  const seqs = new Set();
  for (const q of questions) {
    if (!q.id) issues.push(`Question missing id: ${JSON.stringify(q).slice(0, 40)}`);
    if (ids.has(q.id)) issues.push(`Duplicate question id: ${q.id}`); else ids.add(q.id);
    if (typeof q.sequence !== 'number') issues.push(`Missing or invalid sequence on ${q.id}`);
    else if (seqs.has(q.sequence)) issues.push(`Duplicate sequence ${q.sequence} on ${q.id}`); else seqs.add(q.sequence);
  }

  // check sequences are contiguous starting from 0
  const seqArr = Array.from(seqs).sort((a, b) => a - b);
  for (let i = 0; i < seqArr.length; ++i) {
    if (seqArr[i] !== i) { issues.push(`Non-contiguous sequence values; expected ${i} but found ${seqArr[i]}`); break; }
  }

  // validate nextId and nextIfOption targets
  for (const q of questions) {
    if (q.nextId && !ids.has(q.nextId)) issues.push(`nextId for ${q.id} references unknown id: ${q.nextId}`);
    if (q.nextIfOption && typeof q.nextIfOption === 'object') {
      for (const [rawIdx, target] of Object.entries(q.nextIfOption)) {
        const idx = Number(rawIdx);
        if (Number.isNaN(idx) || idx < 0 || idx >= (q.options || []).length) issues.push(`Invalid nextIfOption index for ${q.id}: ${rawIdx}`);
        if (!ids.has(target)) issues.push(`nextIfOption for ${q.id} references unknown id: ${target}`);
      }
    }
  }

  // build adjacency for reachability check
  const bySeq = Object.fromEntries(questions.map((q) => [q.sequence, q]));
  const edges = [];
  for (const q of questions) {
    const defaultNext = q.nextId || (bySeq[q.sequence + 1] && bySeq[q.sequence + 1].id) || null;
    if (defaultNext) edges.push([q.id, defaultNext]);
    if (q.nextIfOption) {
      for (const [, target] of Object.entries(q.nextIfOption || {})) if (target) edges.push([q.id, target]);
    }
  }

  const adj = {};
  for (const [a, b] of edges) {
    adj[a] = adj[a] || [];
    adj[a].push(b);
  }

  const start = bySeq[0] ? bySeq[0].id : questions[0].id;
  const reachable = new Set();
  const queue = start ? [start] : [];
  while (queue.length) {
    const cur = queue.shift();
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const neigh of (adj[cur] || [])) if (!reachable.has(neigh)) queue.push(neigh);
  }

  const unreachable = questions.map((q) => q.id).filter((id) => !reachable.has(id));
  if (unreachable.length) issues.push(`Unreachable questions from start (${start}): ${unreachable.join(', ')}`);

  return { ok: issues.length === 0, issues, unreachable, start };
};

export const serializeQuestionNode = (doc) => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
};

/**
 * Initialize survey schema/indexes in MongoDB.
 * NOTE: This no longer seeds any hardcoded questionnaire.
 * All WhatsApp survey questions are read from database-managed records only.
 */
export const initializeSurveySchema = async (db) => {
  try {
    console.log('📝 Initializing survey schema in MongoDB...');

    const questions = getCollection(db, 'questions');
    const transitions = getCollection(db, 'questionTransitions');

    try {
      const indexes = await questions.indexes();
      if (indexes.some((idx) => idx.name === 'id_1')) {
        await questions.dropIndex('id_1');
      }
      if (indexes.some((idx) => idx.name === 'owner_question_id_unique')) {
        await questions.dropIndex('owner_question_id_unique');
      }
    } catch (err) {
      console.warn('⚠️ Could not migrate old questions id_1 index:', err.message);
    }

    await Promise.all([
      questions.createIndex({ ownerUserId: 1, surveyId: 1, id: 1 }, { unique: true, name: 'owner_survey_question_id_unique' }),
      questions.createIndex({ backendId: 1 }, { unique: true, sparse: true, name: 'question_backend_id_unique' }),
      questions.createIndex({ ownerUserId: 1, sequence: 1 }, { name: 'owner_sequence_idx' }),
      questions.createIndex({ ownerUserId: 1, surveyId: 1, sequence: 1 }, { name: 'owner_survey_sequence_idx' }),
      transitions.createIndex({ ownerUserId: 1, fromId: 1, type: 1, optionIndex: 1 }, { name: 'owner_transition_idx' }),
      transitions.createIndex({ ownerUserId: 1, surveyId: 1, fromId: 1, type: 1, optionIndex: 1 }, { name: 'owner_survey_transition_idx' }),
    ]);

    try {
      await questions.updateMany(
        {
          $or: [
            { backendId: { $exists: false } },
            { backendId: null },
            { backendId: '' },
          ],
        },
        [
          {
            $set: {
              backendId: { $concat: ['qb_', { $toString: '$_id' }] },
            },
          },
        ]
      );
    } catch (err) {
      console.warn('⚠️ Could not backfill question backendId values:', err.message);
    }

    console.log('✅ Survey schema initialized (indexes only; no hardcoded question seeding)');
  } catch (error) {
    console.error('❌ Failed to initialize survey schema:', error.message);
    throw error;
  }
};

/**
 * Get first question in survey
 */
export const getFirstQuestion = async (db, ownerUserId = null, surveyId = null) => {
  const questions = getCollection(db, 'questions');
  const doc = await questions.findOne(
    { ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) },
    { sort: { sequence: 1 } }
  );
  return serializeQuestionNode(doc);
};

/**
 * Get question by ID
 */
export const getQuestionById = async (db, questionId, ownerUserId = null, surveyId = null) => {
  const questions = getCollection(db, 'questions');
  const doc = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) });
  return serializeQuestionNode(doc);
};

/**
 * Get next question based on current answer
 * Implements conditional logic:
 * 1. If specific option has NEXT_IF_OPTION relationship, follow it
 * 2. Otherwise, follow default NEXT relationship
 */
export const getNextQuestion = async (db, currentQuestionId, selectedOptionIndex, ownerUserId = null, surveyId = null) => {
  const transitions = getCollection(db, 'questionTransitions');
  const questions = getCollection(db, 'questions');
  const surveyFilter = buildSurveyFilter(surveyId);
  const ownerFilter = buildOwnerFilter(ownerUserId);

  const conditional = await transitions.findOne({
    fromId: currentQuestionId,
    type: 'next_if_option',
    optionIndex: selectedOptionIndex,
    ...ownerFilter,
    ...surveyFilter,
  });

  if (conditional?.toId) {
    const doc = await questions.findOne({ id: conditional.toId, ...ownerFilter, ...surveyFilter });
    return serializeQuestionNode(doc);
  }

  const fallback = await transitions.findOne({ fromId: currentQuestionId, type: 'next', ...ownerFilter, ...surveyFilter });
  if (fallback?.toId) {
    const doc = await questions.findOne({ id: fallback.toId, ...ownerFilter, ...surveyFilter });
    return serializeQuestionNode(doc);
  }

  // If no explicit transition exists, follow sequence as a safe fallback.
  const current = await questions.findOne({ id: currentQuestionId, ...ownerFilter, ...surveyFilter });
  if (!current || typeof current.sequence !== 'number') {
    return null;
  }

  const nextBySequence = await questions.findOne(
    { sequence: current.sequence + 1, ...ownerFilter, ...surveyFilter },
    { sort: { sequence: 1 } }
  );
  return serializeQuestionNode(nextBySequence);
};

/**
 * Save farmer's response to MongoDB
 */
export const saveAnswer = async (db, phoneNumber, sessionId, questionId, selectedOptionIndex, ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  const normalizedSurveyId = normalizeSurveyId(surveyId);
  const answerId = `ans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const questions = getCollection(db, 'questions');
    const answers = getCollection(db, 'answers');
    const question = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(normalizedSurveyId) });
    const selectedOption = question?.options?.[selectedOptionIndex] ?? null;

    await answers.insertOne({
      id: answerId,
      phoneNumber,
      sessionId,
      surveyId: normalizedSurveyId,
      questionId,
      questionBackendId: question?.backendId || null,
      ...(ownerUserId ? { ownerUserId } : {}),
      selectedOptionIndex: Number(selectedOptionIndex),
      selectedOption,
      responseMode: 'text',
      confidence: 1.0,
      createdAt: new Date(),
    });

    return { success: true, answerId };
  } catch (error) {
    console.error('❌ Failed to save answer:', error.message);
    throw error;
  }
};

/**
 * Find a pending voice answer for the current question
 */
export const getPendingVoiceAnswer = async (db, sessionId, questionId) => {
  const answers = getCollection(db, 'answers');
  return answers.findOne(
    {
      sessionId,
      questionId,
      responseMode: 'voice',
      selectedOptionIndex: -1,
    },
    { sort: { createdAt: -1 } }
  );
};

/**
 * Save a voice answer placeholder linked to an audio file
 */
export const saveVoiceAnswer = async (
  db,
  phoneNumber,
  sessionId,
  questionId,
  audioId,
  ownerUserId = null,
  surveyId = DEFAULT_SURVEY_ID
) => {
  const normalizedSurveyId = normalizeSurveyId(surveyId);
  const answerId = `ans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const questions = getCollection(db, 'questions');
    const answers = getCollection(db, 'answers');
    const question = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(normalizedSurveyId) });

    await answers.insertOne({
      id: answerId,
      phoneNumber,
      sessionId,
      surveyId: normalizedSurveyId,
      questionId,
      questionBackendId: question?.backendId || null,
      ...(ownerUserId ? { ownerUserId } : {}),
      audioId,
      selectedOptionIndex: -1,
      selectedOption: 'VOICE_PENDING',
      responseMode: 'voice',
      confidence: 0.0,
      createdAt: new Date(),
    });

    return { success: true, answerId };
  } catch (error) {
    console.error('❌ Failed to save voice answer:', error.message);
    throw error;
  }
};

/**
 * Update an existing answer with numeric selection
 */
export const updateAnswerSelection = async (db, answerId, selectedOptionIndex) => {
  try {
    const answers = getCollection(db, 'answers');
    const answer = await answers.findOne({ id: answerId });
    if (!answer) {
      throw new Error(`Answer not found: ${answerId}`);
    }

    const questions = getCollection(db, 'questions');
    const ownerFilter = buildOwnerFilter(answer?.ownerUserId || null);
    const surveyFilter = buildSurveyFilter(answer?.surveyId || DEFAULT_SURVEY_ID);
    const question = answer?.questionBackendId
      ? await questions.findOne({ backendId: answer.questionBackendId, ...ownerFilter, ...surveyFilter })
      : await questions.findOne({ id: answer.questionId, ...ownerFilter, ...surveyFilter });
    const selectedOption = question?.options?.[selectedOptionIndex] ?? null;

    await answers.updateOne(
      { id: answerId },
      {
        $set: {
          selectedOptionIndex: Number(selectedOptionIndex),
          selectedOption,
          confirmedByText: true,
          updatedAt: new Date(),
        },
      }
    );

    return { success: true, answerId };
  } catch (error) {
    console.error('❌ Failed to update answer:', error.message);
    throw error;
  }
};

/**
 * Get all answers for a farmer's session
 */
export const getSessionAnswers = async (db, sessionId) => {
  const answers = getCollection(db, 'answers');
  const questions = getCollection(db, 'questions');
  const answerDocs = await answers.find({ sessionId }).sort({ createdAt: 1 }).toArray();

  const resolved = await Promise.all(
    answerDocs.map(async (answer) => {
      const ownerFilter = buildOwnerFilter(answer?.ownerUserId || null);
      const surveyFilter = buildSurveyFilter(answer?.surveyId || DEFAULT_SURVEY_ID);
      const question = answer?.questionBackendId
        ? await questions.findOne({ backendId: answer.questionBackendId, ...ownerFilter, ...surveyFilter })
        : await questions.findOne({ id: answer.questionId, ...ownerFilter, ...surveyFilter });

      return {
        answerId: answer.id,
        questionId: question?.id || answer.questionId,
        questionText: question?.text || null,
        selectedOption: answer.selectedOption,
        createdAt: answer.createdAt,
      };
    })
  );

  return resolved;
};

// ===================== Question Management (Admin) =====================

/**
 * List questions, supports optional filter and pagination
 */
export const listQuestions = async (db, { skip = 0, limit = 100, includeArchived = false, surveyId = null } = {}, ownerUserId = null) => {
  const questions = getCollection(db, 'questions');
  const query = includeArchived
    ? { ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) }
    : { archivedAt: { $exists: false }, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) };
  const docs = await questions.find(query).sort({ sequence: 1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  return docs.map(serializeQuestionNode);
};

/**
 * Helper: Upsert transitions for a question based on nextIfOption mapping and defaultNextId
 */
// Helper: detect cycles in directed graph of transitions
const detectCycleInTransitions = (edges = []) => {
  const adj = {};
  for (const e of edges) {
    if (!e.fromId || !e.toId) continue;
    adj[e.fromId] = adj[e.fromId] || [];
    adj[e.fromId].push(e.toId);
  }

  const visited = new Set();
  const inStack = new Set();

  const dfs = (node) => {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neigh of (adj[node] || [])) {
      if (dfs(neigh)) return true;
    }
    inStack.delete(node);
    return false;
  };

  for (const node of Object.keys(adj)) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
};

const upsertQuestionTransitions = async (db, questionId, nextIfOption = {}, defaultNextId = null, ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  const transitions = getCollection(db, 'questionTransitions');
  const questions = getCollection(db, 'questions');
  const scopedSurveyId = normalizeSurveyId(surveyId);

  // Validate default target exists
  if (defaultNextId) {
    const target = await questions.findOne({ id: defaultNextId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });
    if (!target) throw new Error(`Invalid default next target: ${defaultNextId}`);
  }

  // Validate conditional targets and indices
  const srcQuestion = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });
  const sourceSurveyId = normalizeSurveyId(srcQuestion?.surveyId || scopedSurveyId);
  const optionsLen = (srcQuestion?.options || []).length;
  if (nextIfOption && typeof nextIfOption === 'object') {
    for (const [rawIdx, targetId] of Object.entries(nextIfOption)) {
      const idx = Number.parseInt(rawIdx, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= optionsLen) {
        throw new Error(`Invalid option index in nextIfOption: ${rawIdx}`);
      }
      const target = await questions.findOne({ id: targetId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(sourceSurveyId) });
      if (!target) throw new Error(`Invalid target question id in nextIfOption: ${targetId}`);
    }
  }

  // Build candidate transition set (existing transitions, with this question's transitions replaced by the new ones)
  let allTransitions = await transitions.find({ ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(sourceSurveyId) }).toArray();
  allTransitions = allTransitions.filter((t) => t.fromId !== questionId);

  if (defaultNextId) {
    allTransitions.push({ fromId: questionId, toId: defaultNextId, type: 'next' });
  }
  if (nextIfOption && typeof nextIfOption === 'object') {
    for (const [rawIdx, targetId] of Object.entries(nextIfOption)) {
      allTransitions.push({ fromId: questionId, toId: targetId, type: 'next_if_option', optionIndex: Number(rawIdx) });
    }
  }

  // Detect cycles — prevent saving transitions that would create loops
  if (detectCycleInTransitions(allTransitions)) {
    throw new Error('Cycle detected in transitions (would create a loop). Please remove the circular reference.');
  }

  // Upsert conditional option transitions (safe now)
  if (nextIfOption && typeof nextIfOption === 'object') {
    for (const [optionIndexRaw, targetQId] of Object.entries(nextIfOption)) {
      const optionIndex = Number.parseInt(optionIndexRaw, 10);
      await transitions.updateOne(
        { fromId: questionId, type: 'next_if_option', optionIndex, ...buildSurveyFilter(sourceSurveyId) },
        { $set: { surveyId: sourceSurveyId, fromId: questionId, type: 'next_if_option', optionIndex, toId: targetQId, ...(ownerUserId ? { ownerUserId } : {}) } },
        { upsert: true }
      );
    }

    // Remove any conditional transitions that are no longer present
    const existing = await transitions.find({ fromId: questionId, type: 'next_if_option', ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(sourceSurveyId) }).toArray();
    for (const ex of existing) {
      if (!Object.prototype.hasOwnProperty.call(nextIfOption, String(ex.optionIndex))) {
        await transitions.deleteOne({ _id: ex._id });
      }
    }
  }

  // Upsert default next transition if provided
  if (defaultNextId) {
    await transitions.updateOne(
      { fromId: questionId, type: 'next', ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(sourceSurveyId) },
      { $set: { surveyId: sourceSurveyId, fromId: questionId, type: 'next', toId: defaultNextId, ...(ownerUserId ? { ownerUserId } : {}) } },
      { upsert: true }
    );
  }
};

/**
 * Create a new question
 */
export const createQuestion = async (db, payload, ownerUserId = null) => {
  const questions = getCollection(db, 'questions');
  const surveyId = normalizeSurveyId(payload?.surveyId);

  if (!payload || !payload.id) {
    throw new Error('Question id is required');
  }

  // Prevent self-referential default next on create
  if (payload.nextId && payload.nextId === payload.id) {
    throw new Error('nextId cannot refer to the question itself');
  }

  const existing = await questions.findOne({ id: payload.id, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) });
  if (existing) {
    throw new Error(`Question with id ${payload.id} already exists in survey ${surveyId}`);
  }

  const doc = {
    ...payload,
    backendId: payload?.backendId || generateQuestionBackendId(),
    surveyId,
    ...(ownerUserId ? { ownerUserId } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await questions.insertOne(doc);

  // If payload includes nextIfOption or sequence, create transitions accordingly
  try {
    const nextIfOption = payload.nextIfOption || {};
    let defaultNextId = payload.nextId || null;

    // If no explicit nextId, infer default next by sequence
    if (!defaultNextId && typeof payload.sequence === 'number') {
      const nextDoc = await questions.findOne({ sequence: payload.sequence + 1, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) });
      if (nextDoc) defaultNextId = nextDoc.id;
    }

    await upsertQuestionTransitions(db, payload.id, nextIfOption, defaultNextId, ownerUserId, surveyId);

    // normalize stored question document to reflect computed defaultNextId
    if (defaultNextId) {
      await questions.updateOne({ id: payload.id, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) }, { $set: { nextId: defaultNextId, updatedAt: new Date() } });
    } else {
      await questions.updateOne({ id: payload.id, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) }, { $unset: { nextId: '' }, $set: { updatedAt: new Date() } });
    }
  } catch (err) {
    // rollback inserted question so we don't leave an inconsistent state
    await questions.deleteOne({ id: payload.id, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) });
    throw err;
  }

  const inserted = await questions.findOne({ id: payload.id, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(surveyId) });
  return serializeQuestionNode(inserted);
};

/**
 * Update an existing question
 */
export const updateQuestion = async (db, questionId, updates, ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  const questions = getCollection(db, 'questions');
  const scopedSurveyId = normalizeSurveyId(surveyId || updates?.surveyId || DEFAULT_SURVEY_ID);
  const existing = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });
  if (!existing) {
    throw new Error(`Question not found: ${questionId}`);
  }

  // Prevent saving a self-referential default next
  if (Object.prototype.hasOwnProperty.call(updates, 'nextId') && updates.nextId && updates.nextId === questionId) {
    throw new Error('nextId cannot refer to the question itself');
  }

  const allowed = { ...updates, updatedAt: new Date() };
  await questions.updateOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) }, { $set: { ...allowed, surveyId: scopedSurveyId } });
  const updated = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });

  // Update transitions if nextIfOption or nextId or sequence changed
  try {
    const nextIfOption = updates.nextIfOption ?? existing.nextIfOption ?? {};
    let defaultNextId = updates.nextId ?? null;

    // If sequence changed (or defaultNextId not provided), infer default next based on updated.sequence
    const seq = updates.sequence ?? existing.sequence;
    if (!defaultNextId && typeof seq === 'number') {
      const nextDoc = await questions.findOne({ sequence: seq + 1, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });
      if (nextDoc) defaultNextId = nextDoc.id;
    }

    await upsertQuestionTransitions(db, questionId, nextIfOption, defaultNextId, ownerUserId, scopedSurveyId);

    // Normalize stored question.nextId to reflect computed defaultNextId (remove stale self-references)
    if (defaultNextId) {
      await questions.updateOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) }, { $set: { nextId: defaultNextId, updatedAt: new Date() } });
    } else {
      await questions.updateOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) }, { $unset: { nextId: '' }, $set: { updatedAt: new Date() } });
    }
  } catch (err) {
    // restore previous document on failure to keep data consistent
    await questions.updateOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) }, { $set: existing });
    throw err;
  }

  const final = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });
  return serializeQuestionNode(final);
};

/**
 * Permanently delete a question
 */
export const deleteQuestion = async (db, questionId, ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  const questions = getCollection(db, 'questions');
  const scopedSurveyId = normalizeSurveyId(surveyId);
  const existing = await questions.findOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });
  if (!existing) {
    throw new Error(`Question not found: ${questionId}`);
  }

  await questions.deleteOne({ id: questionId, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) });

  // Remove any transitions that originate from this question or point to it
  try {
    const transitions = getCollection(db, 'questionTransitions');
    await transitions.deleteMany({
      $and: [
        { ...buildOwnerFilter(ownerUserId) },
        { ...buildSurveyFilter(scopedSurveyId) },
        { $or: [{ fromId: questionId }, { toId: questionId }] },
      ],
    });
  } catch (err) {
    console.warn('⚠️ Failed to clean transitions on delete:', err.message);
  }

  return { success: true };
};

/**
 * Resequence questions: accepts an ordered array of question ids and sets sequence values accordingly
 */
export const resequenceQuestions = async (db, orderedIds = [], ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array of question ids');
  const questions = getCollection(db, 'questions');
  const scopedSurveyId = normalizeSurveyId(surveyId);

  const ops = orderedIds.map((id, idx) => ({ updateOne: { filter: { id, ...buildOwnerFilter(ownerUserId), ...buildSurveyFilter(scopedSurveyId) }, update: { $set: { sequence: idx, updatedAt: new Date() } } } }));
  if (ops.length > 0) {
    await questions.bulkWrite(ops);
  }
  return { success: true };
};


