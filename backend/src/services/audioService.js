import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { updateAnswerSelection } from './surveyEngine.js';
import { getModelByCollection } from '../models/index.js';

const getCollection = (_db, name) => getModelByCollection(name).collection;

/**
 * Audio Service (Phase 2)
 * Handles:
 * - Audio file storage
 * - Metadata tagging
 * - Quality control tracking
 *
 * Note: No transcription is performed by default to avoid any inference.
 */

const getAudioStoragePath = () => {
  return process.env.AUDIO_STORAGE_PATH || './audio_storage';
};

export const ensureAudioStorageDir = async () => {
  const storagePath = getAudioStoragePath();
  await fs.mkdir(storagePath, { recursive: true });
  return storagePath;
};

const getWhatsAppMediaMeta = async (mediaId) => {
  const url = `https://graph.facebook.com/v24.0/${mediaId}?fields=url,mime_type,sha256,file_size`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    },
  });
  return response.data;
};

const downloadWhatsAppMedia = async (mediaUrl) => {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    },
  });
  return Buffer.from(response.data);
};

/**
 * Store audio file from WhatsApp and create Audio node
 */
export const storeAudioFile = async (db, mediaId, metadata = {}, { skipAutoTranscription = false } = {}) => {
  const storagePath = await ensureAudioStorageDir();
  const audioId = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const mediaMeta = await getWhatsAppMediaMeta(mediaId);
  const fileExt = mediaMeta.mime_type?.includes('ogg') ? 'ogg' : 'bin';
  const fileName = `${audioId}.${fileExt}`;
  const filePath = path.join(storagePath, fileName);

  const audioBuffer = await downloadWhatsAppMedia(mediaMeta.url);
  await fs.writeFile(filePath, audioBuffer);

  const audio = {
    id: audioId,
    mediaId,
    fileName,
    filePath,
    mimeType: mediaMeta.mime_type || 'application/octet-stream',
    fileSize: mediaMeta.file_size || audioBuffer.length,
    sha256: mediaMeta.sha256 || null,
    phoneNumber: metadata.phoneNumber || null,
    sessionId: metadata.sessionId || null,
    questionId: metadata.questionId || null,
    metadata: metadata || {},
    transcriptionStatus: process.env.ENABLE_TRANSCRIPTION === 'true' ? 'pending' : 'not_requested',
    createdAt: new Date(),
  };

  const audioCollection = getCollection(db, 'audio');
  await audioCollection.insertOne(audio);

  // If transcription is enabled AND the caller isn't handling transcription itself,
  // kick off transcription asynchronously
  if (process.env.ENABLE_TRANSCRIPTION === 'true' && !skipAutoTranscription) {
    transcribeAudio(db, audio.id).catch((err) => console.error('❌ Transcription job failed:', err.message));
  }

  return {
    audioId,
    fileName,
    filePath,
    mimeType: mediaMeta.mime_type,
    fileSize: mediaMeta.file_size,
  };
};

/**
 * Transcribe an audio file using configured STT provider (groq by default)
 * Updates audio.transcript and transcriptionStatus on success/failure
 */
export const transcribeAudio = async (db, audioId, language = null) => {
  const audio = await getAudioById(db, audioId);
  if (!audio) throw new Error('Audio not found: ' + audioId);
  if (!audio.filePath) throw new Error('Audio file missing path: ' + audioId);

  // mark pending
  await getCollection(db, 'audio').updateOne({ id: audioId }, { $set: { transcriptionStatus: 'pending', transcriptionRequestedAt: new Date() } });

  try {
    const provider = process.env.STT_PROVIDER || 'sarvam';

    // ── Sarvam AI (Saaras v3) STT provider ──
    if (provider === 'sarvam') {
      const FormData = (await import('form-data')).default;
      const fsNode = await import('fs');
      const form = new FormData();
      form.append('file', fsNode.createReadStream(audio.filePath));
      form.append('model', process.env.SARVAM_STT_MODEL || 'saaras:v3');
      form.append('mode', 'transcribe');

      // Map canonical language names → Sarvam BCP-47 codes
      const SARVAM_LANG_MAP = {
        telugu: 'te-IN',
        hindi: 'hi-IN',
        kannada: 'kn-IN',
        tamil: 'ta-IN',
        marathi: 'mr-IN',
        english: 'en-IN',
        bengali: 'bn-IN',
        gujarati: 'gu-IN',
        malayalam: 'ml-IN',
        odia: 'od-IN',
        punjabi: 'pa-IN',
      };
      if (language) {
        const langCode = SARVAM_LANG_MAP[language.toLowerCase()] || language;
        form.append('language_code', langCode);
      } else {
        form.append('language_code', 'unknown');
      }

      const sarvamKey = process.env.SARVAM_API_KEY;
      if (!sarvamKey) throw new Error('SARVAM_API_KEY is not configured');

      const sttUrl = process.env.SARVAM_STT_API_URL || 'https://api.sarvam.ai/speech-to-text';
      const headers = { 'api-subscription-key': sarvamKey, ...form.getHeaders() };
      const res = await axios.post(sttUrl, form, { headers, timeout: 120000 });
      const transcriptText = res.data?.transcript || res.data?.text || null;

      if (!transcriptText) {
        throw new Error('Sarvam STT returned no transcript');
      }

      const detectedLang = res.data?.language_code || null;
      const langProb = res.data?.language_probability || null;
      console.log(`🔉 Sarvam STT (audioId=${audioId}, detectedLang=${detectedLang}, prob=${langProb}):`, transcriptText);

      const transcriptDoc = { text: transcriptText, engine: 'sarvam', createdAt: new Date(), language: language || detectedLang || null };
      await getCollection(db, 'audio').updateOne({ id: audioId }, { $set: { transcript: transcriptDoc, transcriptionStatus: 'completed' } });

      let matchResult = null;
      try {
        matchResult = await matchTranscriptToOptions(db, audioId);
        if (matchResult) console.log(`🔍 Match result (audioId=${audioId}):`, matchResult);
      } catch (err) {
        console.warn('⚠️ Failed to match transcript to options:', err.message);
      }

      return { ...transcriptDoc, match: matchResult };
    }

    // ── Groq (Whisper) STT provider ──
    if (provider === 'groq') {
      // call groq/openai-style transcription endpoint
      const FormData = (await import('form-data')).default;
      const fsNode = await import('fs');
      const form = new FormData();
      form.append('file', fsNode.createReadStream(audio.filePath));
      form.append('model', process.env.STT_MODEL || 'whisper-large-v3-turbo');
      // If a language was provided, pass it to the STT provider when supported
      // Use provider-supported language short codes (groq whisper expects two-letter codes like 'kn', 'te', etc.)
      const LANGUAGE_CODE_MAP = {
        telugu: 'te',
        hindi: 'hi',
        kannada: 'kn',
        tamil: 'ta',
        marathi: 'mr',
        english: 'en',
      };
      if (language) {
        const langCode = LANGUAGE_CODE_MAP[language.toLowerCase()] || language;
        form.append('language', langCode);
      }

      const headers = { Authorization: `Bearer ${process.env.STT_API_KEY}`, ...form.getHeaders() };
      const res = await axios.post(process.env.STT_API_URL, form, { headers, timeout: 120000 });
      const transcriptText = res.data?.text || res.data?.transcript || (res.data?.choices?.[0]?.text) || null;

      if (!transcriptText) {
        throw new Error('STT provider returned no transcript');
      }

      const transcriptDoc = { text: transcriptText, engine: provider, createdAt: new Date(), language: language || null };

      await getCollection(db, 'audio').updateOne({ id: audioId }, { $set: { transcript: transcriptDoc, transcriptionStatus: 'completed' } });

      // Log transcript for debugging
      try {
        console.log(`🔉 Transcription (audioId=${audioId}):`, transcriptText);
      } catch (err) {
        // ignore logging errors
      }

      // Attempt to match transcript to options and update answer if high confidence
      let matchResult = null;
      try {
        matchResult = await matchTranscriptToOptions(db, audioId);
        if (matchResult) console.log(`🔍 Match result (audioId=${audioId}):`, matchResult);
      } catch (err) {
        console.warn('⚠️ Failed to match transcript to options:', err.message);
      }

      return { ...transcriptDoc, match: matchResult };
    }

    throw new Error('Unsupported STT_PROVIDER: ' + provider);
  } catch (err) {
    // Log detailed provider error (status code and response body when available) for debugging
    try {
      console.error('❌ STT provider error:', err.response?.status, err.response?.data || err.message);
    } catch (logErr) {
      console.error('❌ STT provider error (fallback):', err.message || err);
    }

    await getCollection(db, 'audio').updateOne({ id: audioId }, { $set: { transcriptionStatus: 'failed', transcriptionError: err.message } });
    throw err;
  }
};

/**
 * Match an audio transcript to question options using Groq LLM and update the answer if confident
 */
export const matchTranscriptToOptions = async (db, audioId) => {
  const audio = await getAudioById(db, audioId);
  if (!audio) throw new Error('Audio not found');
  if (!audio.transcript || !audio.transcript.text) return null;

  const answer = await getCollection(db, 'answers').findOne({ audioId });
  if (!answer) return null;

  const ownerFilter = answer?.ownerUserId ? { ownerUserId: answer.ownerUserId } : {};
  const question = answer?.questionBackendId
    ? await getCollection(db, 'questions').findOne({ backendId: answer.questionBackendId, ...ownerFilter, surveyId: answer.surveyId || 'survey1' })
    : await getCollection(db, 'questions').findOne({ id: answer.questionId, ...ownerFilter, surveyId: answer.surveyId || 'survey1' });
  if (!question) return null;

  const client = new (await import('groq-sdk')).default({ apiKey: process.env.GROQ_API_KEY });
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  const userPrompt = `You are a strict classifier. Given the transcript: ${JSON.stringify(audio.transcript.text)} and the following options: ${JSON.stringify(question.options)}. Choose the zero-based index of the best matching option and return JSON: {"index": <number or -1>, "confidence": <0-1>, "note":"reason"}. Respond ONLY with JSON.`;

  const completion = await client.chat.completions.create({ model, messages: [{ role: 'user', content: userPrompt }], temperature: 0 });
  const content = completion.choices?.[0]?.message?.content || '';

  let parsed = null;
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      parsed = JSON.parse(content.slice(start, end + 1));
    }
  } catch (err) {
    // ignore parse errors
  }

  if (!parsed || typeof parsed.index !== 'number') return null;

  const idx = parsed.index;
  const confidence = Number(parsed.confidence || 0);

  // Persist match metadata
  await getCollection(db, 'audio').updateOne({ id: audioId }, { $set: { matchedOptionIndex: idx, matchedConfidence: confidence } });

  const threshold = Number(process.env.TRANSCRIPTION_CONFIDENCE_THRESHOLD || 0.7);
  if (idx >= 0 && confidence >= threshold) {
    // Auto-confirm the selection for the pending voice answer
    const pending = await getCollection(db, 'answers').findOne({ audioId });
    if (pending) {
      await updateAnswerSelection(db, pending.id, idx);
      await getCollection(db, 'audio').updateOne({ id: audioId }, { $set: { autoConfirmed: true } });

      // Do NOT notify via WhatsApp directly here to avoid duplicate/conflicting messages.
      // Let the controller responsible for the session decide how/when to message the farmer.
      console.log(`🔔 Auto-confirmed answer (audioId=${audioId}) option=${idx} confidence=${confidence}`);
    }
  }

  return { index: idx, confidence };
};

/**
 * Store an uploaded audio file (from web/mobile) and create audio node
 * Accepts a Buffer or a file path reference (buffer preferred when using multer memoryStorage)
 */
export const storeUploadedFile = async (db, fileBuffer, originalName, mimeType, metadata = {}) => {
  const storagePath = await ensureAudioStorageDir();
  const audioId = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Derive a safe extension from the provided mimeType or original filename
  const extFromMime = mimeType && mimeType.split('/')?.[1] ? mimeType.split('/')?.[1].split(';')[0].split('+')[0] : null;
  // Prefer mime-derived ext, but avoid 'octet-stream' (fallback to original filename ext)
  let ext = extFromMime || path.extname(originalName).replace('.', '') || 'wav';
  if (!ext || ext === 'octet-stream' || ext.length > 6 || /[^a-z0-9]/i.test(ext)) {
    const alt = path.extname(originalName).replace('.', '') || 'wav';
    ext = (alt || 'wav');
  }
  ext = ext.toLowerCase();

  const fileName = `${audioId}.${ext}`;
  const filePath = path.join(storagePath, fileName);

  await fs.writeFile(filePath, fileBuffer);
  // Log saved file details for debugging STT provider issues
  try { console.log(`💾 Saved uploaded audio: ${filePath} (mime=${mimeType}, ext=${ext})`); } catch (err) { }

  const audio = {
    id: audioId,
    fileName,
    filePath,
    mimeType: mimeType || 'application/octet-stream',
    fileSize: fileBuffer.length,
    originalName: originalName || null,
    metadata: metadata || {},
    transcriptionStatus: process.env.ENABLE_TRANSCRIPTION === 'true' ? 'pending' : 'not_requested',
    createdAt: new Date(),
  };

  const audioCollection = getCollection(db, 'audio');
  await audioCollection.insertOne(audio);

  return {
    audioId,
    fileName,
    filePath,
    mimeType: audio.mimeType,
    fileSize: audio.fileSize,
    transcriptionStatus: audio.transcriptionStatus,
  };
};

/**
 * Optional transcription (disabled by default)
 * NOTE: For now this is a stub that records pending status. Implementations should
 * integrate with a provider (groq/whisper) and update the `audio.transcript` field.
 */
export const generateTranscript = async (audioFilePath) => {
  if (process.env.ENABLE_TRANSCRIPTION !== 'true') {
    return null;
  }

  // TODO: enqueue or call STT provider here
  return null;
};

/**
 * Link audio to survey answer
 */
export const linkAudioToAnswer = async (db, answerId, audioId) => {
  const answers = getCollection(db, 'answers');
  await answers.updateOne({ id: answerId }, { $set: { audioId } });
};

/**
 * Get audio QC list with optional filters
 */
export const getAudioQcList = async (db, filters = {}) => {
  const limit = Number(filters.limit || 50);
  const offset = Number(filters.offset || 0);
  const audio = getCollection(db, 'audio');

  const matchFilters = {};
  if (filters.phoneNumber) matchFilters['answer.phoneNumber'] = filters.phoneNumber;
  if (filters.sessionId) matchFilters['answer.sessionId'] = filters.sessionId;
  if (filters.questionId) matchFilters['answer.questionId'] = filters.questionId;

  const pipeline = [
    {
      $lookup: {
        from: 'answers',
        localField: 'id',
        foreignField: 'audioId',
        as: 'answer',
      },
    },
    { $unwind: { path: '$answer', preserveNullAndEmptyArrays: false } },
    {
      $lookup: {
        from: 'questions',
        localField: 'answer.questionId',
        foreignField: 'id',
        as: 'question',
      },
    },
    { $unwind: { path: '$question', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'surveySessions',
        localField: 'answer.sessionId',
        foreignField: 'id',
        as: 'session',
      },
    },
    { $unwind: { path: '$session', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'farmers',
        localField: 'answer.phoneNumber',
        foreignField: 'phoneNumber',
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    ...(Object.keys(matchFilters).length ? [{ $match: matchFilters }] : []),
    { $sort: { createdAt: -1 } },
    { $skip: offset },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        audioId: '$id',
        fileName: '$fileName',
        filePath: '$filePath',
        mimeType: '$mimeType',
        createdAt: '$createdAt',
        answerId: '$answer.id',
        responseMode: '$answer.responseMode',
        questionId: '$question.id',
        questionText: '$question.text',
        sessionId: '$session.id',
        farmerPhone: '$answer.phoneNumber',
        region: { $ifNull: ['$farmer.region', 'Unknown'] },
      },
    },
  ];

  return audio.aggregate(pipeline).toArray();
};

/**
 * Get audio node by id
 */
export const getAudioById = async (db, audioId) => {
  const audio = getCollection(db, 'audio');
  return audio.findOne({ id: audioId });
};

