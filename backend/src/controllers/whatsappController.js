import { AppError } from '../middleware/errorHandler.js';
import { getModelByCollection } from '../models/index.js';
import {
  initializeSurveySchema,
  getFirstQuestion,
  getQuestionById,
  getNextQuestion,
  saveAnswer,
  getPendingVoiceAnswer,
  saveVoiceAnswer,
  updateAnswerSelection,
} from '../services/surveyEngine.js';
import { storeAudioFile } from '../services/audioService.js';
import { synthesizeText, checkTtsEndpoint } from '../services/ttsService.js';
import axios from 'axios';

const getCollection = (_db, name) => getModelByCollection(name).collection;
const DEFAULT_SURVEY_ID = 'survey1';
const normalizeSurveyId = (surveyId) => String(surveyId || DEFAULT_SURVEY_ID).trim();
const getFirstQuestionWithFallback = async (db, surveyId, ownerUserId = null) => {
  const normalizedSurveyId = normalizeSurveyId(surveyId);
  let question = await getFirstQuestion(db, ownerUserId, normalizedSurveyId);
  if (!question && ownerUserId) {
    question = await getFirstQuestion(db, null, normalizedSurveyId);
  }
  return question;
};

const getQuestionByIdWithFallback = async (db, questionId, surveyId, ownerUserId = null) => {
  const normalizedSurveyId = normalizeSurveyId(surveyId);
  let question = await getQuestionById(db, questionId, ownerUserId, normalizedSurveyId);
  if (!question && ownerUserId) {
    question = await getQuestionById(db, questionId, null, normalizedSurveyId);
  }
  return question;
};

const buildSurveyMatch = (surveyId) => {
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

// Language detection mapping
const REGION_LANGUAGE_MAP = {
  telangana: 'telugu',
  karnataka: 'kannada',
  andhra_pradesh: 'telugu',
  maharashtra: 'marathi',
  tamil_nadu: 'tamil',
};

const REGION_DISPLAY_NAMES = {
  telangana: 'Telangana',
  karnataka: 'Karnataka',
  andhra_pradesh: 'Andhra Pradesh',
  maharashtra: 'Maharashtra',
  tamil_nadu: 'Tamil Nadu',
};

const LANGUAGE_PROMPTS = {
  telugu: 'మేము తెలుగులో కొనసాగుతాము. కొనసాగాలని చెప్పండి.',
  hindi: 'हम हिंदी में आगे बढ़ेंगे. जारी रखने के लिए कोई भी नंबर भेजें.',
  kannada: 'ನಾವು ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತೇವೆ. ಮುಂದುವರಿಯಲು ಸಂಖ್ಯೆ ಒದಗಿಸಿ.',
  default: 'We will continue in English. Reply 1 to continue.',
};

// Localized messages for mode selection
const MODE_PROMPTS = {
  telugu: 'మీరు ఆడియో (వాయిస్ నోట్స్) లేదా టెక్స్ట్ (టైప్ చేయబడిన) ద్వారా కొనసాగించాలనుకుంటున్నారా? ఆడియో కోసం "Audio", టెక్స్ట్ కోసం "Text" ను ఎంచుకోండి.',
  hindi: 'क्या आप ऑडियो (वॉइस नोट) या टेक्स्ट (टाइप उत्तर) में जारी रखना चाहेंगे? ऑडियो के लिए "Audio", टेक्स्ट के लिए "Text" चुनें।',
  kannada: 'ನೀವು ಧ್ವನಿ (ವಾಯ್ಸ್ ನೋಟ್) ಅಥವಾ ಪಠ್ಯ (ಟೈಪ್ ಮಾಡಲಾಗಿರುವ) ಮೂಲಕ ಮುಂದುವರೆಯಲು ಬಯಸುತ್ತೀರಾ? ಧ್ವನಿಗಾಗಿ "Audio", ಪಠ್ಯಕ್ಕಾಗಿ "Text" ಆಯ್ಕೆ ಮಾಡಿ.',
  english: 'Would you like to continue in Audio (voice notes) or Text (typed replies)?',
};

// Build a multilingual invite body that includes short instruction lines in each supported language
const buildInviteLanguageBody = () => {
  return (
    `📬 You have been invited to the Farmer Survey! Please choose your language to begin, or reply START.\n\n` +
    `తెలుగు: క్రింద నుండి మీ భాషను ఎంచుకోండి.\n` +
    `हिन्दी: कृपया अपनी भाषा चुनें।\n` +
    `ಕನ್ನಡ: ದಯವಿಟ್ಟು ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.\n` +
    `English: Please choose your language.`
  );
};

const WHATSAPP_BUSINESS_NUMBER = process.env.WHATSAPP_BUSINESS_NUMBER || '919876543210';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v24.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_API_BASE_URL = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';
const BULK_ASYNC_THRESHOLD = Number(process.env.BULK_INVITE_ASYNC_THRESHOLD || 50);
const BULK_MAX_SIZE = Number(process.env.BULK_INVITE_MAX_SIZE || 1000);
const BULK_BATCH_SIZE = Number(process.env.BULK_INVITE_BATCH_SIZE || 20);
const INVITE_TEMPLATE_NAME = process.env.WHATSAPP_INVITE_TEMPLATE_NAME || '';
const INVITE_TEMPLATE_LANG = process.env.WHATSAPP_INVITE_TEMPLATE_LANG || 'en_US';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const createInviteJobId = () => `invite_job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const parsePhoneNumbersFromCsv = (rawCsv = '') => {
  const lines = String(rawCsv || '').split(/\r?\n/);
  const phones = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed
      .split(/[,;\t]/)
      .map((part) => part.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);

    if (parts.length === 0) continue;

    let picked = null;
    for (const part of parts) {
      const normalized = normalizePhoneNumber(part);
      if (normalized) {
        picked = normalized;
        break;
      }
    }

    if (!picked) continue;
    phones.push(picked);
  }

  return Array.from(new Set(phones));
};

const inviteSinglePhone = async (db, ownerUserId, targetPhone, targetSurveyId = DEFAULT_SURVEY_ID) => {
  const normalizedTargetSurveyId = normalizeSurveyId(targetSurveyId);
  const farmer = await getFarmerByPhone(db, targetPhone);
  const farmers = getCollection(db, 'farmers');

  await farmers.updateOne(
    { phoneNumber: targetPhone },
    {
      $set: {
        invitedAt: new Date(),
        lastInvitedSurveyId: normalizedTargetSurveyId,
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  let usedFallback = false;

  const activeSessionForTargetSurvey = await getActiveSession(db, targetPhone, normalizedTargetSurveyId);

  if (!farmer || !farmer.preferredLanguage || !activeSessionForTargetSurvey) {
    try {
      const body = buildInviteLanguageBody();
      const result = await sendLanguageSelectionList(targetPhone, body);
      if (result && result.fallback) usedFallback = true;
    } catch (err) {
      console.warn('❌ Failed to send language selection on invite:', err.message);
      await farmers.updateOne({ phoneNumber: targetPhone }, { $set: { lastInviteError: err.message, inviteFailedAt: new Date() } }, { upsert: true });
      throw err;
    }
  } else {
    try {
      const result = await sendContinueOrChangeButtons(targetPhone, farmer.preferredLanguage);
      if (result && result.fallback) usedFallback = true;
    } catch (err) {
      console.warn('❌ Failed to send continue/change on invite:', err.message);
      try {
        if (isPermissionError(err)) {
          const lang = (farmer?.preferredLanguage || 'english').toLowerCase();
          const fallbackText = MODE_PROMPTS[lang] || MODE_PROMPTS.english;
          await sendMessage(targetPhone, `${fallbackText}\nReply with "Audio" or "Text".`);
          usedFallback = true;
          console.log('ℹ️ Fallback continue/change sent as plain text due to permission error (invite)');
        } else {
          await farmers.updateOne({ phoneNumber: targetPhone }, { $set: { lastInviteError: err.message, inviteFailedAt: new Date() } }, { upsert: true });
          throw err;
        }
      } catch (fallbackErr) {
        console.warn('❌ Failed to send fallback continue/change text on invite:', fallbackErr.message || fallbackErr);
        await farmers.updateOne({ phoneNumber: targetPhone }, { $set: { lastInviteError: err.message, inviteFailedAt: new Date() } }, { upsert: true });
        throw err;
      }
    }
  }

  return {
    success: true,
    phoneNumber: targetPhone,
    message: usedFallback
      ? 'Invite sent (text fallback used due to WhatsApp permissions).'
      : 'Invite sent. The farmer will receive a language selection or continue prompt.',
  };
};

const runBulkInviteJob = async (db, ownerUserId, jobId, phones, targetSurveyId = DEFAULT_SURVEY_ID) => {
  const inviteJobs = getCollection(db, 'inviteJobs');

  await inviteJobs.updateOne(
    { id: jobId, ...(ownerUserId ? { ownerUserId } : {}) },
    { $set: { status: 'running', startedAt: new Date(), updatedAt: new Date() } }
  );

  try {
    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    for (let start = 0; start < phones.length; start += BULK_BATCH_SIZE) {
      const batch = phones.slice(start, start + BULK_BATCH_SIZE);
      const settled = await Promise.allSettled(batch.map((phone) => inviteSinglePhone(db, ownerUserId, phone, targetSurveyId)));

      settled.forEach((result, idx) => {
        const phone = batch[idx];
        if (result.status === 'fulfilled') {
          successCount += 1;
        } else {
          failureCount += 1;
          failures.push({ phoneNumber: phone, error: result.reason?.message || 'Invite failed' });
        }
      });

      await inviteJobs.updateOne(
        { id: jobId, ...(ownerUserId ? { ownerUserId } : {}) },
        {
          $set: {
            successCount,
            failureCount,
            processedCount: successCount + failureCount,
            updatedAt: new Date(),
          },
        }
      );

      await sleep(300);
    }

    await inviteJobs.updateOne(
      { id: jobId, ...(ownerUserId ? { ownerUserId } : {}) },
      {
        $set: {
          status: 'completed',
          successCount,
          failureCount,
          processedCount: successCount + failureCount,
          failures,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
  } catch (error) {
    await inviteJobs.updateOne(
      { id: jobId, ...(ownerUserId ? { ownerUserId } : {}) },
      {
        $set: {
          status: 'failed',
          error: error.message || 'Bulk invite job failed',
          updatedAt: new Date(),
        },
      }
    );
  }
};

const handleWhatsAppStatuses = async (db, statuses = []) => {
  if (!db || !Array.isArray(statuses) || statuses.length === 0) return;

  const farmers = getCollection(db, 'farmers');
  const webhookEvents = getCollection(db, 'webhookEvents');
  const inviteJobs = getCollection(db, 'inviteJobs');

  for (const statusItem of statuses) {
    const statusId = String(statusItem?.id || '').trim();
    const deliveryState = String(statusItem?.status || '').trim().toLowerCase();
    const recipientId = statusItem?.recipient_id;
    const phoneNumber = normalizePhoneNumber(recipientId) || String(recipientId || '').trim();
    const errorObj = Array.isArray(statusItem?.errors) && statusItem.errors.length > 0 ? statusItem.errors[0] : null;
    const errorCode = Number(errorObj?.code || 0);
    const errorMessage = String(errorObj?.message || errorObj?.title || '').trim();

    const dedupeKey = statusId && deliveryState ? `${statusId}:${deliveryState}` : null;
    if (dedupeKey) {
      const existing = await webhookEvents.findOne({ statusKey: dedupeKey });
      if (existing) continue;
      await webhookEvents.insertOne({ statusKey: dedupeKey, createdAt: new Date() });
    }

    if (!phoneNumber) continue;

    const updateDoc = {
      lastInviteDeliveryStatus: deliveryState || 'unknown',
      lastInviteDeliveryAt: new Date(),
      lastInviteMessageId: statusId || null,
    };

    if (deliveryState === 'failed') {
      updateDoc.lastInviteError = errorMessage || 'Invite delivery failed';
      updateDoc.lastInviteErrorCode = errorCode || null;
      updateDoc.inviteFailedAt = new Date();
      console.warn(`⚠️ WhatsApp delivery failed for ${phoneNumber}. code=${errorCode || 'n/a'} message=${errorMessage || 'n/a'}`);

      try {
        const linkedJob = await inviteJobs.findOne(
          {
            requestedPhones: phoneNumber,
            status: { $in: ['queued', 'running', 'completed'] },
          },
          { sort: { createdAt: -1 } }
        );

        if (linkedJob) {
          const existingFailures = Array.isArray(linkedJob.failures) ? linkedJob.failures : [];
          const alreadyTracked = existingFailures.some((item) => item?.messageId && item.messageId === statusId);

          if (!alreadyTracked) {
            const nextFailures = [
              ...existingFailures,
              {
                phoneNumber,
                error: errorMessage || 'Invite delivery failed',
                errorCode: errorCode || null,
                messageId: statusId || null,
                deliveryStatus: deliveryState,
                updatedAt: new Date(),
              },
            ];

            await inviteJobs.updateOne(
              { _id: linkedJob._id },
              {
                $set: {
                  failures: nextFailures,
                  failureCount: nextFailures.length,
                  successCount: Math.max(0, Number(linkedJob.successCount || 0) - 1),
                  updatedAt: new Date(),
                },
              }
            );
          }
        }
      } catch (jobUpdateError) {
        console.warn('⚠️ Failed to update invite job with delivery failure:', jobUpdateError?.message || jobUpdateError);
      }
    }

    await farmers.updateOne(
      { phoneNumber },
      { $set: updateDoc, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    if (deliveryState === 'failed' && isReEngagementErrorCode(errorCode, errorMessage)) {
      try {
        const templateResult = await sendInviteTemplateMessage(phoneNumber);
        if (templateResult.sent) {
          await farmers.updateOne(
            { phoneNumber },
            {
              $set: {
                lastInviteRecovery: 'template_fallback_sent',
                lastInviteRecoveryAt: new Date(),
                lastInviteRecoveryTemplate: templateResult.templateName || null,
                lastInviteRecoveryMessageId: templateResult.messageId || null,
              },
            }
          );
        } else {
          await farmers.updateOne(
            { phoneNumber },
            {
              $set: {
                lastInviteRecovery: `template_fallback_skipped:${templateResult.reason || 'unknown'}`,
                lastInviteRecoveryAt: new Date(),
              },
            }
          );
          if (templateResult.reason === 'missing_template_name') {
            console.warn('⚠️ Re-engagement delivery failed but template fallback is not configured. Set WHATSAPP_INVITE_TEMPLATE_NAME in backend/.env');
          }
        }
      } catch (templateErr) {
        console.error('❌ Failed to send template fallback after re-engagement error:', templateErr?.message || templateErr);
        await farmers.updateOne(
          { phoneNumber },
          {
            $set: {
              lastInviteRecovery: 'template_fallback_error',
              lastInviteRecoveryAt: new Date(),
              lastInviteRecoveryError: templateErr?.message || 'Template fallback failed',
            },
          }
        );
      }
    }
  }
};

/**
 * Auto-detect language from region or message
 * Priority: 1. Region -> 2. Message text -> 3. English (default)
 */
const detectLanguage = (region = null, messageText = '', profileName = '') => {
  // Priority 1: Region-based detection
  if (region && REGION_LANGUAGE_MAP[region.toLowerCase()]) {
    return REGION_LANGUAGE_MAP[region.toLowerCase()];
  }

  // Combine profile name and message text for script-based heuristics
  const combined = `${profileName || ''} ${messageText || ''}`.trim();
  const textLower = combined.toLowerCase();

  // Priority 2: Profile/name and message text script detection
  if (textLower.includes('telugu') || /\p{Script=Telugu}/u.test(combined)) return 'telugu';
  if (textLower.includes('hindi') || /\p{Script=Devanagari}/u.test(combined)) return 'hindi';
  if (textLower.includes('kannada') || /\p{Script=Kannada}/u.test(combined)) return 'kannada';

  // Fallback to English
  return 'english';
};

// Map language tokens (from user input) to normalized language keys used by the system
const LANG_TOKEN_MAP = {
  TELUGU: 'telugu',
  TELUGUU: 'telugu',
  తెలుగు: 'telugu',
  HINDI: 'hindi',
  हिंदी: 'hindi',
  KANNADA: 'kannada',
  ಕನ್ನಡ: 'kannada',
  ENGLISH: 'english',
  DEFAULT: 'english',
};

const parseRequestedLanguage = (token) => {
  if (!token) return null;
  const cleaned = token.trim().toUpperCase();
  return LANG_TOKEN_MAP[cleaned] || null;
};

/**
 * WhatsApp webhook receiver
 * Validates webhook and processes messages
 */
export const webhookVerify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed');
    res.sendStatus(403);
  }
};

/**
 * Handle incoming WhatsApp messages
 * Routes: START, numeric MCQ responses, voice, text, etc.
 */
export const handleIncomingMessage = async (req, res, next) => {
  console.log('🔔 handleIncomingMessage invoked', { path: req.path, ip: req.ip, time: new Date().toISOString() });
  try {
    const db = req.app.locals.mongoDb;

    const { entry } = req.body;
    if (!entry || !entry[0]) {
      return res.status(200).json({ success: false });
    }

    // Store raw webhook payload for debugging and observability
    try {
      if (!db) throw new Error('mongoDb not available on app.locals');
      const debugColl = getCollection(db, 'webhookDebug');
      const debugDoc = {
        kind: 'raw',
        payload: req.body,
        headers: req.headers,
        ip: req.ip,
        path: req.path,
        receivedAt: new Date(),
      };
      const r = await debugColl.insertOne(debugDoc);
      console.log(`🧾 Webhook debug saved: ${r.insertedId} from ${req.ip}`);
    } catch (err) {
      console.warn('⚠️ Failed to save webhook debug document:', err.message || err);
    }

    const changeValue = entry?.[0]?.changes?.[0]?.value || {};
    const statuses = Array.isArray(changeValue.statuses) ? changeValue.statuses : [];
    if (statuses.length > 0) {
      await handleWhatsAppStatuses(db, statuses);
    }

    const messages = changeValue.messages;
    if (!messages || messages.length === 0) {
      return res.status(200).json({ success: true });
    }

    const message = messages[0];
    const phoneNumberRaw = message.from;
    const phoneNumber = normalizePhoneNumber(phoneNumberRaw) || phoneNumberRaw;

    // Store last incoming message on app context for quick inspection in admin panel
    try {
      req.app.locals.lastIncoming = {
        phoneNumberRaw,
        phoneNumber,
        type: message.type || null,
        interactive: message.interactive || null,
        text: message.text?.body || null,
        raw: message,
        receivedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('⚠️ Failed to set lastIncoming on app.locals:', err.message || err);
    }

    // Deduplicate processing for the same incoming message ID (WhatsApp may deliver duplicates)
    const msgId = message.id || message.message_id || '';
    if (msgId) {
      try {
        // Persistent dedupe: store webhook message id in DB with TTL so duplicates across restarts are ignored
        const webhookColl = getCollection(db, 'webhookEvents');
        const existing = await webhookColl.findOne({ messageId: msgId });
        if (existing) {
          console.log(`⚠️ Duplicate message ignored (db): ${msgId}`);
          return res.status(200).json({ success: true, duplicate: true });
        }
        await webhookColl.insertOne({ messageId: msgId, createdAt: new Date() });
      } catch (err) {
        console.warn('⚠️ Failed to write webhook dedupe entry (continuing with in-memory fallback):', err.message || err);
      }

      // In-memory short-term dedupe (keeps behavior fast for burst duplicates)
      if (!global.recentWhatsAppMessageIds) global.recentWhatsAppMessageIds = new Map();
      const now = Date.now();
      // cleanup old entries (>30s)
      for (const [k, ts] of global.recentWhatsAppMessageIds) {
        if (now - ts > 30000) global.recentWhatsAppMessageIds.delete(k);
      }
      if (global.recentWhatsAppMessageIds.has(msgId)) {
        console.log(`⚠️ Duplicate message ignored (mem): ${msgId}`);
        return res.status(200).json({ success: true, duplicate: true });
      }
      global.recentWhatsAppMessageIds.set(msgId, now);
    }

    console.log(`📞 Message from ${phoneNumberRaw} (normalized: ${phoneNumber}): ${JSON.stringify(message)}`);

    // Route based on message type
    if (message.type === 'text') {
      const rawText = message.text.body.trim();
      const text = rawText.toUpperCase();

      const startMatch = text.match(/^START(?:\s+(.+))?$/);
      if (startMatch) {
        // If user said `START <LANG>`, parse language token
        const langToken = startMatch[1] ? startMatch[1].trim() : null;
        const explicitLang = parseRequestedLanguage(langToken);
        if (langToken && !explicitLang) {
          await sendMessage(phoneNumber, '⚠️ Unknown language option. Please say START, or START followed by TELUGU/HINDI/KANNADA/ENGLISH.');
          return;
        }
        await handleStartMessage(db, phoneNumber, message, explicitLang);
      } else if (/^\d+$/.test(text)) {
        // Numeric MCQ response
        await handleMCQResponse(db, phoneNumber, parseInt(text));
      } else {
        // If farmer doesn't exist yet, treat language text as a selection, otherwise show intro
        const farmer = await getFarmerByPhone(db, phoneNumber);
        if (!farmer) {
          // If user replied with a language name (e.g., Telugu, Hindi), accept it as selection
          const langFromText = parseRequestedLanguage(rawText);
          if (langFromText) {
            await handleLanguageSelection(db, phoneNumber, langFromText);
            return;
          }

          // Support numeric fallback for language selection (1=Telugu,2=Hindi,3=Kannada,4=English)
          if (/^[1-4]$/.test(rawText)) {
            const mapping = { '1': 'telugu', '2': 'hindi', '3': 'kannada', '4': 'english' };
            const langToken = mapping[rawText];
            if (langToken) {
              await handleLanguageSelection(db, phoneNumber, langToken);
              return;
            }
          }

          await sendIntroductionMessage(phoneNumber);
          return;
        }

        // Accept typed mode selection keywords from returning farmers (e.g., "audio", "voice", "text")
        const lower = rawText.trim().toLowerCase();
        if (lower.includes('audio') || lower.includes('voice')) {
          await handleModeSelection(db, phoneNumber, 'audio');
          return;
        }
        if (lower.includes('text') || lower.includes('type')) {
          await handleModeSelection(db, phoneNumber, 'text');
          return;
        }

        // Other text from an existing farmer
        await sendMessage(phoneNumber, '❓ I didn\'t understand that. Please reply with a number (1-6) or say "START" to begin.');
      }
    } else if (message.type === 'interactive') {
      const replyId =
        message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';

      // Extra debug: store interactive-specific short document and log farmer/session state
      try {
        const debugColl = getCollection(db, 'webhookDebug');
        const short = { type: 'interactive', phoneNumber, replyId, message: message.interactive, receivedAt: new Date() };
        const rr = await debugColl.insertOne(short);
        console.log(`🧾 Stored interactive debug id=${rr.insertedId} replyId=${replyId} phone=${phoneNumber}`);
      } catch (err) {
        console.warn('⚠️ Failed to store interactive debug:', err.message || err);
      }

      // Log whether a farmer record or an active session exists for this number (helps reason why no session was found)
      try {
        const farmerExists = Boolean(await getFarmerByPhone(db, phoneNumber));
        const activeSessionExists = Boolean(await getActiveSession(db, phoneNumber));
        console.log(`🔔 Interactive reply id=${replyId} from ${phoneNumber} (farmerExists=${farmerExists}, activeSession=${activeSessionExists})`);
      } catch (err) {
        console.warn('⚠️ Failed to determine farmer/session existence for interactive:', err.message || err);
      }

      // Action replies (continue / change language)
      if (replyId.startsWith('action_')) {
        await handleActionReply(db, phoneNumber, replyId);
        return;
      }

      // Language selection replies have ids like 'lang_telugu', 'lang_hindi'
      if (replyId.startsWith('lang_')) {
        const langToken = replyId.replace('lang_', '');
        await handleLanguageSelection(db, phoneNumber, langToken);
        return;
      }

      if (replyId.startsWith('opt_')) {
        const selectedOption = parseInt(replyId.replace('opt_', ''), 10);
        if (!Number.isNaN(selectedOption)) {
          await handleMCQResponse(db, phoneNumber, selectedOption);
        } else {
          await sendMessage(phoneNumber, '⚠️ Invalid selection. Please reply with the option number.');
        }
      } else {
        await sendMessage(phoneNumber, '⚠️ Unsupported interactive reply. Please reply with the option number.');
      }
    } else if (message.type === 'audio') {
      await handleAudioResponse(db, phoneNumber, message);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message);
    next(error);
  }
};

export const sendSurveyInvite = async (req, res, next) => {
  try {
    const { phoneNumber, phoneNumbers, channel = 'phone', async: asyncRequested = false, surveyId = DEFAULT_SURVEY_ID } = req.body;
    const normalizedTargetSurveyId = normalizeSurveyId(surveyId);
    const normalizedPhone = phoneNumber ? normalizePhoneNumber(phoneNumber) : null;
    const normalizedPhones = Array.isArray(phoneNumbers)
      ? phoneNumbers.map((item) => normalizePhoneNumber(item)).filter(Boolean)
      : [];
    const ownerUserId = req.user?.id;
    const db = req.app.locals.mongoDb;

    if (channel === 'qr') {
      // Validate that a WhatsApp business number is configured before generating a QR invite
      const rawBusinessNumber = process.env.WHATSAPP_BUSINESS_NUMBER?.trim() || '';
      if (!rawBusinessNumber) {
        throw new AppError('WHATSAPP_BUSINESS_NUMBER is not configured. Set WHATSAPP_BUSINESS_NUMBER in your .env to the WhatsApp-registered phone number (international format).', 400);
      }

      const payload = buildInviteQrPayload();
      return res.status(200).json({
        success: true,
        inviteType: 'qr',
        qrLink: payload.link,
        qrImageUrl: payload.imageUrl,
        instructions: payload.instructions,
      });
    }

    if (!normalizedPhone) {
      if (normalizedPhones.length === 0) {
        throw new AppError('phoneNumber is required when inviting by phone', 400);
      }
    }

    try {
      if (normalizedPhones.length > 0) {
        const uniquePhones = Array.from(new Set(normalizedPhones));
        if (uniquePhones.length > BULK_MAX_SIZE) {
          throw new AppError(`Bulk invite limit exceeded. Max allowed is ${BULK_MAX_SIZE} numbers per request.`, 400);
        }

        const useAsync = Boolean(asyncRequested) || uniquePhones.length >= BULK_ASYNC_THRESHOLD;
        if (useAsync) {
          const inviteJobs = getCollection(db, 'inviteJobs');
          const jobId = createInviteJobId();
          await inviteJobs.insertOne({
            id: jobId,
            ownerUserId: ownerUserId || null,
            surveyId: normalizedTargetSurveyId,
            requestedPhones: uniquePhones,
            status: 'queued',
            totalCount: uniquePhones.length,
            processedCount: 0,
            successCount: 0,
            failureCount: 0,
            failures: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          setImmediate(() => {
            runBulkInviteJob(db, ownerUserId || null, jobId, uniquePhones, normalizedTargetSurveyId).catch((err) => {
              console.error('❌ Bulk invite job crashed:', err.message || err);
            });
          });

          return res.status(202).json({
            success: true,
            inviteType: 'bulk_async',
            jobId,
            totalCount: uniquePhones.length,
            message: `Bulk invite queued for ${uniquePhones.length} users.`,
          });
        }

        const successes = [];
        const failures = [];

        for (const phone of uniquePhones) {
          try {
            const item = await inviteSinglePhone(db, ownerUserId, phone, normalizedTargetSurveyId);
            successes.push(item);
          } catch (err) {
            failures.push({ phoneNumber: phone, error: err.message || 'Invite failed' });
          }
        }

        const summaryMessage = `Bulk invite complete. Success: ${successes.length}, Failed: ${failures.length}.`;
        return res.status(failures.length > 0 ? 207 : 200).json({
          success: failures.length === 0,
          inviteType: 'bulk',
          message: summaryMessage,
          successes,
          failures,
        });
      }

      const singleResult = await inviteSinglePhone(db, ownerUserId, normalizedPhone, normalizedTargetSurveyId);
      return res.status(200).json({
        success: true,
        inviteType: 'phone',
        phoneNumber: singleResult.phoneNumber,
        surveyId: normalizedTargetSurveyId,
        message: singleResult.message,
      });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  } catch (error) {
    next(error);
  }
};

export const sendSurveyInviteUpload = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      throw new AppError('CSV file is required. Upload a file with phone numbers.', 400);
    }

    const csvText = file.buffer.toString('utf8');
    const phoneNumbers = parsePhoneNumbersFromCsv(csvText);

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      throw new AppError('No valid phone numbers found in uploaded file.', 400);
    }

    req.body = {
      ...(req.body || {}),
      channel: 'phone',
      async: true,
      phoneNumbers,
    };

    return sendSurveyInvite(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const getInviteJobStatus = async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id;
    const jobId = req.params.jobId;
    const inviteJobs = getCollection(db, 'inviteJobs');

    const job = await inviteJobs.findOne({ id: jobId, ownerUserId: ownerUserId || null });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Invite job not found' });
    }

    return res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        totalCount: job.totalCount || 0,
        processedCount: job.processedCount || 0,
        successCount: job.successCount || 0,
        failureCount: job.failureCount || 0,
        failures: Array.isArray(job.failures) ? job.failures : [],
        error: job.error || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const triggerFollowupSurvey = async (req, res, next) => {
  try {
    const db = req.app.locals.mongoDb;
    const ownerUserId = req.user?.id || null;
    const {
      sourceSurveyId = DEFAULT_SURVEY_ID,
      sourceQuestionId = 'Q1',
      sourceOption = 'Rice',
      sourceOptionIndex,
      targetSurveyId,
      forceRetrigger = false,
      limit = 500,
      dryRun = false,
    } = req.body || {};

    if (!targetSurveyId || !String(targetSurveyId).trim()) {
      throw new AppError('targetSurveyId is required', 400);
    }

    const normalizedSourceSurvey = normalizeSurveyId(sourceSurveyId);
    const normalizedTargetSurvey = normalizeSurveyId(targetSurveyId);
    const maxLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));

    const targetFirstQuestion = await getFirstQuestionWithFallback(db, normalizedTargetSurvey, ownerUserId);
    if (!targetFirstQuestion) {
      throw new AppError(`No questions found for target survey: ${normalizedTargetSurvey}`, 400);
    }

    const answers = getCollection(db, 'answers');
    const baseFilter = {
      questionId: sourceQuestionId,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...buildSurveyMatch(normalizedSourceSurvey),
    };

    const sourceAnswers = await answers
      .find(baseFilter)
      .sort({ createdAt: -1 })
      .limit(maxLimit * 10)
      .toArray();

    const latestByPhone = new Map();
    for (const answer of sourceAnswers) {
      if (!answer?.phoneNumber) continue;
      if (!latestByPhone.has(answer.phoneNumber)) {
        latestByPhone.set(answer.phoneNumber, answer);
      }
      if (latestByPhone.size >= maxLimit) break;
    }

    const normalizedSourceOption = typeof sourceOption === 'string' ? sourceOption.trim().toLowerCase() : null;
    const eligiblePhones = [];
    for (const [phoneNumber, answer] of latestByPhone.entries()) {
      const answerText = String(answer?.selectedOption || '').trim().toLowerCase();
      const textMatch = normalizedSourceOption ? answerText === normalizedSourceOption : true;
      const indexMatch = Number.isInteger(sourceOptionIndex)
        ? Number(answer?.selectedOptionIndex) === Number(sourceOptionIndex)
        : true;

      if (textMatch && indexMatch) {
        eligiblePhones.push(phoneNumber);
      }
    }

    let started = 0;
    let skippedActive = 0;
    let skippedExistingTarget = 0;
    let failed = 0;
    const errors = [];

    for (const phoneNumber of eligiblePhones) {
      try {
        const active = await getActiveSession(db, phoneNumber);
        if (active) {
          skippedActive += 1;
          continue;
        }

        if (!forceRetrigger) {
          const alreadyInTarget = await answers.findOne({
            phoneNumber,
            ...(ownerUserId ? { ownerUserId } : {}),
            ...buildSurveyMatch(normalizedTargetSurvey),
          });

          if (alreadyInTarget) {
            skippedExistingTarget += 1;
            continue;
          }
        }

        if (dryRun) {
          started += 1;
          continue;
        }

        await createSessionForFarmer(db, phoneNumber, normalizedTargetSurvey, ownerUserId);
        await startNewSession(db, phoneNumber, normalizedTargetSurvey, true);
        started += 1;
      } catch (err) {
        failed += 1;
        errors.push({ phoneNumber, error: err.message || 'Failed to trigger follow-up survey' });
      }
    }

    return res.json({
      success: failed === 0,
      sourceSurveyId: normalizedSourceSurvey,
      targetSurveyId: normalizedTargetSurvey,
      sourceQuestionId,
      sourceOption: normalizedSourceOption || null,
      sourceOptionIndex: Number.isInteger(sourceOptionIndex) ? Number(sourceOptionIndex) : null,
      eligibleCount: eligiblePhones.length,
      started,
      skippedActive,
      skippedExistingTarget,
      failed,
      dryRun: Boolean(dryRun),
      forceRetrigger: Boolean(forceRetrigger),
      errors,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle "START" message from farmer
 * Flow: 1. Detect language 2. Confirm language 3. Create farmer 4. Start survey
 */
const handleStartMessage = async (db, phoneNumber, message = {}, explicitLanguage = null) => {
  try {
    await initializeSurveySchema(db);
    const farmer = await getFarmerByPhone(db, phoneNumber);
    const targetSurveyId = normalizeSurveyId(farmer?.lastInvitedSurveyId || DEFAULT_SURVEY_ID);
    const activeSessionForTargetSurvey = await getActiveSession(db, phoneNumber, targetSurveyId);

    // Try to detect language from profile name or incoming text (metadata-aware)
    const profileName = message?.contacts?.[0]?.profile?.name || '';
    const incomingText = message?.text?.body || '';

    // If user explicitly provided a language token (e.g., "START TELUGU") use it.
    // Otherwise, for new users ask to choose a language; for returning users offer to continue or change language.
    if (!explicitLanguage) {
      if (!farmer || !farmer.preferredLanguage || !activeSessionForTargetSurvey) {
        // New user: ask to choose language
        await sendLanguageSelectionList(phoneNumber, '👋 Welcome! Please choose your language to continue.');
        return;
      } else {
        // Returning user: offer to continue in preferred language or change language
        await sendContinueOrChangeButtons(phoneNumber, farmer.preferredLanguage);
        return;
      }
    }

    // Determine preferred language: explicit token, then stored preference, then English
    const preferredLanguage = explicitLanguage || farmer?.preferredLanguage || 'english';

    console.log(`🔤 Detected/preferred language: ${preferredLanguage} (profileName="${profileName}" explicit=${explicitLanguage})`);

    if (explicitLanguage) {
      await sendMessage(phoneNumber, `✅ Language set to ${explicitLanguage}. Continuing in ${explicitLanguage}.`);
    }

    await startSurvey(db, phoneNumber, farmer, farmer?.region, preferredLanguage, !!explicitLanguage, targetSurveyId);
  } catch (error) {
    console.error('❌ Error handling START message:', error.message);
    await sendMessage(phoneNumber, '❌ Error during onboarding. Please try again.');
  }
};

const startSurvey = async (db, phoneNumber, farmer, regionHint = 'telangana', preferredLanguageOverride = null, explicitProvided = false, surveyId = DEFAULT_SURVEY_ID) => {
  const normalizedRegion = normalizeRegionLabel(farmer?.region || regionHint || 'telangana');
  // Behavior: if explicit language provided, use it; otherwise default to English (do not inherit farmer preference)
  const preferredLanguage = preferredLanguageOverride || 'english';

  if (!farmer) {
    const farmers = getCollection(db, 'farmers');
    await farmers.insertOne({
      phoneNumber,
      preferredLanguage,
      createdAt: new Date(),
      region: normalizedRegion,
      status: 'in_progress',
      responseMode: 'text',
    });

    // Ensure region node is present and linked for this farmer
    try {
      await ensureFarmerRegion(db, phoneNumber, normalizedRegion);
    } catch (err) {
      console.warn('⚠️ Failed to ensure farmer region:', err.message);
    }

    // Re-check for an active session to avoid race conditions where multiple requests
    // could create duplicate sessions or duplicate outgoing messages.
    const maybeActive = await getActiveSession(db, phoneNumber);
    if (maybeActive) {
      await sendCurrentQuestion(db, phoneNumber, maybeActive.sessionId);
      return;
    }
  } else {
    // Only persist override if the user explicitly provided a language (START <LANG>)
    if (explicitProvided && preferredLanguageOverride && farmer.preferredLanguage !== preferredLanguageOverride) {
      try {
        const farmers = getCollection(db, 'farmers');
        await farmers.updateOne(
          { phoneNumber },
          { $set: { preferredLanguage: preferredLanguageOverride } }
        );
        console.log(`🔄 Updated preferred language for ${phoneNumber} -> ${preferredLanguageOverride}`);
      } catch (err) {
        console.warn('⚠️ Failed to update farmer preferred language:', err.message);
      }
    }

    const activeSession = await getActiveSession(db, phoneNumber, surveyId);
    if (activeSession) {
      await sendCurrentQuestion(db, phoneNumber, activeSession.sessionId);
      return;
    }
  }

  const targetSurveyId = normalizeSurveyId(surveyId);
  await createSessionForFarmer(db, phoneNumber, targetSurveyId);
  await sendLanguagePrompt(phoneNumber, preferredLanguage);
  setTimeout(() => startNewSession(db, phoneNumber, targetSurveyId), 1000);
};

/**
 * Start new survey session and send first question
 */
const startNewSession = async (db, phoneNumber, surveyId = DEFAULT_SURVEY_ID, forceDirectStart = false) => {
  try {
    const existingSession = await getActiveSession(db, phoneNumber, surveyId);
    const sessionOwnerUserId = existingSession?.ownerUserId || null;
    const targetSurveyId = normalizeSurveyId(existingSession?.surveyId || surveyId);

    // Get first question (initialize schema if missing)
    let firstQ = await getFirstQuestionWithFallback(db, targetSurveyId, sessionOwnerUserId);
    if (!firstQ) {
      await initializeSurveySchema(db);
      firstQ = await getFirstQuestionWithFallback(db, targetSurveyId, sessionOwnerUserId);
    }
    if (!firstQ) {
      throw new Error(`No questions found in survey ${targetSurveyId}`);
    }

    // Determine farmer preferred language and whether their region is set
    const farmer = await getFarmerByPhone(db, phoneNumber);
    const preferredLanguage = farmer?.preferredLanguage || 'english';

    // Choose which question to send first
    let toSendQ = firstQ;

    // If farmer has no region and hasn't chosen a response mode, ask whether they want to continue in Audio or Text first
    if (!forceDirectStart && targetSurveyId === DEFAULT_SURVEY_ID && (!farmer || (!farmer.region && !farmer.responseMode))) {
      try {
        // Ask the farmer whether they'd like audio (voice notes) or text answers before sending the location question
        await sendModeSelectionButtons(phoneNumber, preferredLanguage, true);
        console.log(`📝 Sent mode selection (audio/text) to ${phoneNumber} (lang=${preferredLanguage})`);
        return; // wait for user's choice before sending Q_LOCATION
      } catch (err) {
        console.warn('⚠️ Failed to send mode selection; falling back to sending location question');
        try {
          const locationQ = await getQuestionByIdWithFallback(db, 'Q_LOCATION', targetSurveyId, sessionOwnerUserId);
          if (locationQ) {
            toSendQ = locationQ;
          }
        } catch (innerErr) {
          console.warn('⚠️ Q_LOCATION not found; sending default first question instead');
        }
      }
    } else if (!forceDirectStart && targetSurveyId === DEFAULT_SURVEY_ID && farmer.region && farmer.regionConfirmed) {
      // Only skip Q_LOCATION if the farmer has explicitly answered it before (regionConfirmed)
      try {
        if (firstQ && firstQ.id === 'Q_LOCATION') {
          // Find the option index that matches the farmer's stored region
          const regionOptions = (firstQ.options || []).map(o => o.toString().trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
          let regionIdx = regionOptions.indexOf(farmer.region);
          if (regionIdx === -1) regionIdx = 0; // fallback to first option

          // Save a synthetic answer for Q_LOCATION so getActiveSession correctly derives Q1 as next
          if (existingSession) {
            const answers = getCollection(db, 'answers');
            const alreadyAnswered = await answers.findOne({ sessionId: existingSession.sessionId, questionId: 'Q_LOCATION' });
            if (!alreadyAnswered) {
              await saveAnswer(db, phoneNumber, existingSession.sessionId, 'Q_LOCATION', regionIdx, existingSession.ownerUserId || null, targetSurveyId);
              console.log(`📝 Saved synthetic Q_LOCATION answer for ${phoneNumber} (region=${farmer.region}, idx=${regionIdx})`);
            }
          }

          const nextQ = await getNextQuestion(db, firstQ.id, regionIdx, existingSession?.ownerUserId || null, targetSurveyId);
          if (nextQ) toSendQ = nextQ;
        }
      } catch (err) {
        console.warn('⚠️ Failed to compute next question after Q_LOCATION; falling back to first question', err.message);
      }
    }

    await sendQuestionMessage(db, phoneNumber, toSendQ, preferredLanguage);
    console.log(`📝 Sent first question: ${toSendQ.id} (lang=${preferredLanguage})`);
  } catch (error) {
    console.error('❌ Error starting session:', error.message);
    await sendMessage(phoneNumber, '❌ Error starting survey. Please try "START" again.');
  }
};

/**
 * Send the current question for an active session
 */
const sendCurrentQuestion = async (db, phoneNumber, sessionId) => {
  try {
    const session = await getActiveSession(db, phoneNumber);
    if (!session || !session.currentQuestion) {
      await startNewSession(db, phoneNumber);
      return;
    }

    const q = session.currentQuestion;
    const farmer = await getFarmerByPhone(db, phoneNumber);
    const preferredLanguage = farmer?.preferredLanguage || 'english';
    await sendQuestionMessage(db, phoneNumber, q, preferredLanguage);
  } catch (error) {
    console.error('❌ Error sending current question:', error.message);
    await sendMessage(phoneNumber, '❌ Error sending the current question. Please try again.');
  }
};

/**
 * Handle numeric MCQ response (1, 2, 3, etc.)
 */
const handleMCQResponse = async (db, phoneNumber, selectedOption) => {
  try {
    // Get farmer's active session
    let session = await getActiveSession(db, phoneNumber);
    if (!session) {
      const farmer = await getFarmerByPhone(db, phoneNumber);
      const targetSurveyId = normalizeSurveyId(farmer?.lastInvitedSurveyId || DEFAULT_SURVEY_ID);

      if (farmer) {
        await createSessionForFarmer(db, phoneNumber, targetSurveyId, farmer?.ownerUserId || null);
        session = await getActiveSession(db, phoneNumber, targetSurveyId) || await getActiveSession(db, phoneNumber);
      }

      if (!session) {
        await sendMessage(phoneNumber, '⚠️ No active session. Reply "START" to begin survey.');
        return;
      }

      console.log(`🟢 Recovered active session for ${phoneNumber} during MCQ handling`);
    }

    const { sessionId, currentQuestion, ownerUserId, surveyId } = session;

    // If current question is missing, attempt to start/refresh the session and retry
    let currentQ = currentQuestion;
    if (!currentQ) {
      try {
        await startNewSession(db, phoneNumber, surveyId || DEFAULT_SURVEY_ID);
      } catch (err) {
        console.warn('⚠️ startNewSession retry failed in MCQ handler:', err.message || err);
      }
      const refreshed = await getActiveSession(db, phoneNumber, surveyId || DEFAULT_SURVEY_ID) || await getActiveSession(db, phoneNumber);
      currentQ = refreshed?.currentQuestion || null;
      if (!currentQ) {
        await sendMessage(phoneNumber, '⚠️ No active question found. Reply "START" to begin survey.');
        return;
      }
    }

    // Validate option is within range
    if (selectedOption < 1 || selectedOption > currentQ.options.length) {
      await sendMessage(
        phoneNumber,
        `❌ Invalid option. Please choose 1-${currentQ.options.length}`
      );
      return;
    }

    // Save answer (update pending voice answer if exists)
    const selectedIdx = selectedOption - 1; // Convert 1-indexed to 0-indexed
    const pendingVoice = await getPendingVoiceAnswer(db, sessionId, currentQ.id);
    if (pendingVoice) {
      await updateAnswerSelection(db, pendingVoice.id, selectedIdx);
    } else {
      await saveAnswer(db, phoneNumber, sessionId, currentQ.id, selectedIdx, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);
    }
    const selectedText = currentQ.options[selectedIdx];
    console.log(
      `✅ Answer saved: ${phoneNumber} -> Q${currentQ.id} = ${selectedText}`
    );

    // Send short confirmation message in requested style
    await sendMessage(phoneNumber, `Your answer is ${selectedText}`);

    // If this was the location question, update the Farmer.region and link to Region node
    try {
      if (currentQ.id === 'Q_LOCATION') {
        const selectedRegionText = currentQ.options[selectedIdx] || '';
        const normalizedRegion = selectedRegionText
          .toString()
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
        const regionLang = REGION_LANGUAGE_MAP[normalizedRegion] || null;

        const regions = getCollection(db, 'regions');
        const farmers = getCollection(db, 'farmers');

        await regions.updateOne(
          { name: normalizedRegion },
          {
            $setOnInsert: {
              name: normalizedRegion,
              language: regionLang || null,
              area: 'Unknown area',
            },
          },
          { upsert: true }
        );

        await farmers.updateOne(
          { phoneNumber },
          { $set: { region: normalizedRegion, regionConfirmed: true } },
          { upsert: true }
        );

        console.log(`🔄 Updated farmer region for ${phoneNumber} -> ${normalizedRegion}`);
      }
    } catch (err) {
      console.warn('⚠️ Failed to update farmer region after location answer:', err.message);
    }

    // Get next question
    const nextQ = await getNextQuestion(db, currentQ.id, selectedIdx, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);

    if (nextQ) {
      // Send next question
      const farmer = await getFarmerByPhone(db, phoneNumber);
      const preferredLanguage = farmer?.preferredLanguage || 'english';
      await sendQuestionMessage(db, phoneNumber, nextQ, preferredLanguage);
      console.log(`📝 Sent next question: ${nextQ.id} (lang=${preferredLanguage})`);
    } else {
      // Survey completed
      await completeSession(db, phoneNumber, sessionId);
      await sendMessage(
        phoneNumber,
        '✅ Survey completed! Thank you for your responses. We will analyze and share insights soon.'
      );
    }
  } catch (error) {
    console.error('❌ Error handling MCQ response:', error.message);
    await sendMessage(phoneNumber, '❌ Error processing response. Please try again.');
  }
};

/**
 * Handle audio response
 * In audio mode: transcribe → AI-match to options → auto-save → advance to next question
 * In text mode: store audio and ask farmer to confirm with a number
 */
const handleAudioResponse = async (db, phoneNumber, message) => {
  try {
    let session = await getActiveSession(db, phoneNumber);

    if (!session) {
      // Create session and try to start it so incoming audio can be processed immediately
      await createSessionForFarmer(db, phoneNumber, DEFAULT_SURVEY_ID);
      console.log(`🟢 Auto-created session for ${phoneNumber} on incoming audio`);
      try {
        await startNewSession(db, phoneNumber);
      } catch (err) {
        console.warn('⚠️ Failed to start session on incoming audio:', err.message || err);
      }
      // re-fetch
      session = await getActiveSession(db, phoneNumber);
    }

    let { sessionId, currentQuestion, ownerUserId, surveyId } = session || {};

    if (!currentQuestion) {
      // Try once more to start the session flow and fetch current question
      try {
        await startNewSession(db, phoneNumber);
      } catch (err) {
        console.warn('⚠️ startNewSession retry failed on incoming audio:', err.message || err);
      }
      session = await getActiveSession(db, phoneNumber);
      currentQuestion = session?.currentQuestion || null;
    }

    if (!currentQuestion) {
      // Localized no-active-question message
      const farmer = await getFarmerByPhone(db, phoneNumber);
      const msgs = {
        telugu: '⚠️ ఏక్రియ ప్రశ్న కనపడలేదు. సర్వే ప్రారంభించడానికి "START" ను రిప్లై చేయండి.',
        hindi: '⚠️ कोई सक्रिय प्रश्न नहीं मिला। सर्वे शुरू करने के लिए "START" उत्तर दें।',
        kannada: '⚠️ ಯಾವುದೇ ಸಕ್ರಿಯ ಪ್ರಶ್ನೆ ಕಂಡುಬಂದಿಲ್ಲ. ಸರ್ವೇ ಪ್ರಾರಂಭಿಸಲು "START"ಗೆ ಉತ್ತರಿಸಿ.',
        english: '⚠️ No active question found. Reply "START" to begin survey.',
      };
      const lang = (farmer?.preferredLanguage || 'english').toLowerCase();
      const msg = msgs[lang] || msgs.english;
      await sendMessage(phoneNumber, msg);
      return;
    }

    const mediaId = message.audio?.id;
    if (!mediaId) {
      await sendMessage(phoneNumber, '⚠️ Audio received without media ID. Please try again.');
      return;
    }

    // Store the audio file
    const audioMeta = await storeAudioFile(db, mediaId, {
      phoneNumber,
      sessionId,
      questionId: currentQuestion.id,
      timestamp: message.timestamp,
    });

    // Save a pending voice answer
    await saveVoiceAnswer(db, phoneNumber, sessionId, currentQuestion.id, audioMeta.audioId, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);

    // Determine response mode
    const farmer = await getFarmerByPhone(db, phoneNumber);
    const responseMode = farmer?.responseMode || 'text';

    if (responseMode !== 'audio') {
      // Text-mode: still require manual numeric confirmation
      await sendMessage(
        phoneNumber,
        '✅ Voice note received. Please reply with the option number to confirm your answer.'
      );
      return;
    }

    // ── Audio mode: auto-transcribe and match ──
    const processingMsgs = {
      telugu: '🔄 మీ వాయిస్ నోట్‌ను ప్రాసెస్ చేయడం...',
      hindi: '🔄 आपका वॉइस नोट प्रॉसेस किया जा रहा है...',
      kannada: '🔄 ನಿಮ್ಮ ವಾಯ್ಸ್ ನೋಟನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಲಾಗುತ್ತಿದೆ...',
      english: '🔄 Processing your voice note...',
    };
    const processingMsg = processingMsgs[(farmer?.preferredLanguage || 'english').toLowerCase()] || processingMsgs.english;
    await sendMessage(phoneNumber, processingMsg);

    let transcriptText = null;
    let matchFromTranscription = null;
    try {
      const { transcribeAudio: transcribeAudioFn } = await import('../services/audioService.js');
      const preferredLang = farmer?.preferredLanguage || 'english';
      const result = await transcribeAudioFn(db, audioMeta.audioId, preferredLang);
      transcriptText = result?.text || null;
      matchFromTranscription = result?.match || null;
    } catch (err) {
      console.error('❌ STT transcription failed:', err.message || err);
    }

    if (!transcriptText && !matchFromTranscription) {
      // Transcription failed — ask user to try again with voice or fall back to number
      const failedMsgs = {
        telugu: '⚠️ మాఫ్ చేయండి, మీ వాయిస్ నోట్‌ను అర్థం చేసుకోలేకపోయాను. దయచేసి క్లియర్ రికార్డింగ్‌తో మళ్ళీ ప్రయత్నించండి, లేదా ఎంపిక సంఖ్యతో జవాబు చెప్పండి.',
        hindi: '⚠️ क्षमा करें, मैं आपका वॉइस नोट समझ नहीं पाया। कृपया साफ़ रिकॉर्डिंग के साथ फिर से प्रयास करें, या विकल्प संख्या भेजें।',
        kannada: '⚠️ ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ವಾಯ್ಸ್ ನೋಟನ್ನು ನಾನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸ್ಪಷ್ಟ ದಾಖಲನೊಂದಿಗೆ ಪುನಃ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಆಯ್ಕೆ ಸಂಖ್ಯೆಗಳನ್ನು ಕಳುಹಿಸಿ.',
        english: '⚠️ Sorry, I could not understand your voice note. Please try again with a clearer recording, or reply with the option number.',
      };
      const fm = failedMsgs[(farmer?.preferredLanguage || 'english').toLowerCase()] || failedMsgs.english;
      await sendMessage(phoneNumber, fm);
      return;
    }

    // AI-match transcript to question options (prefer match from transcription if available)
    let matchedIdx = -1;
    let matchConfidence = 0;
    try {
      if (matchFromTranscription && typeof matchFromTranscription.index === 'number') {
        matchedIdx = matchFromTranscription.index;
        matchConfidence = matchFromTranscription.confidence || 0;
      } else if (transcriptText) {
        const matchResult = await matchVoiceToOption(transcriptText, currentQuestion);
        matchedIdx = matchResult.index;
        matchConfidence = matchResult.confidence;
      }
    } catch (err) {
      console.error('❌ AI option matching failed:', err.message);
    }

    const confidenceThreshold = Number(process.env.TRANSCRIPTION_CONFIDENCE_THRESHOLD || 0.6);

    // Numeric fallback: detect a spoken/recognized option number (e.g., 1/2/3)
    if (transcriptText) {
      const numericOption = extractNumericOptionFromTranscript(
        transcriptText,
        farmer?.preferredLanguage,
        currentQuestion.options.length
      );
      if (numericOption && (matchedIdx < 0 || matchConfidence < confidenceThreshold)) {
        matchedIdx = numericOption - 1;
        matchConfidence = 1.0;
        console.log(`🔢 Numeric fallback matched option ${numericOption} from transcript`);
      }
    }

    if (matchedIdx < 0 || matchConfidence < confidenceThreshold) {
      // Low confidence — ask to retry
      const preferredLanguage = farmer?.preferredLanguage || 'english';
      const optionsList = currentQuestion.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
      await sendMessage(
        phoneNumber,
        `⚠️ I heard: "${transcriptText}" but could not confidently match it to an option.\n\nPlease send another voice note or reply with the number:\n${optionsList}`
      );
      return;
    }

    // High confidence match — auto-confirm the answer
    const selectedOption = currentQuestion.options[matchedIdx];
    await updateAnswerSelection(db, `ans_${audioMeta.audioId}`, matchedIdx).catch(async () => {
      // If the pending answer ID doesn't match, find it by audioId
      const pending = await getCollection(db, 'answers').findOne({ audioId: audioMeta.audioId });
      if (pending) await updateAnswerSelection(db, pending.id, matchedIdx);
    });

    // Save the confirmed answer properly
    await saveAnswer(db, phoneNumber, sessionId, currentQuestion.id, matchedIdx, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);

    // If this was Q_LOCATION, update farmer region (same logic as MCQ handler)
    try {
      if (currentQuestion.id === 'Q_LOCATION') {
        const selectedRegionText = currentQuestion.options[matchedIdx] || '';
        const normalizedRegion = selectedRegionText
          .toString().trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const regionLang = REGION_LANGUAGE_MAP[normalizedRegion] || null;

        await getCollection(db, 'regions').updateOne(
          { name: normalizedRegion },
          { $setOnInsert: { name: normalizedRegion, language: regionLang || null, area: 'Unknown area' } },
          { upsert: true }
        );
        await getCollection(db, 'farmers').updateOne(
          { phoneNumber },
          { $set: { region: normalizedRegion, regionConfirmed: true } },
          { upsert: true }
        );
        console.log(`🔄 Updated farmer region (voice): ${phoneNumber} -> ${normalizedRegion}`);
      }
    } catch (err) {
      console.warn('⚠️ Failed to update farmer region after voice answer:', err.message);
    }

    await sendMessage(
      phoneNumber,
      `Your answer is ${selectedOption}`
    );

    console.log(`✅ Voice answer auto-confirmed: ${phoneNumber} -> ${currentQuestion.id} = ${selectedOption} (confidence: ${matchConfidence.toFixed(2)})`);

    // Advance to next question
    const nextQ = await getNextQuestion(db, currentQuestion.id, matchedIdx, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);
    const preferredLanguage = farmer?.preferredLanguage || 'english';

    if (nextQ) {
      // Small delay so the confirmation message arrives before the next question
      await new Promise(resolve => setTimeout(resolve, 800));
      await sendQuestionMessage(db, phoneNumber, nextQ, preferredLanguage);
      console.log(`📝 Sent next question (audio): ${nextQ.id}`);
    } else {
      // Survey completed
      await completeSession(db, phoneNumber, sessionId);

      // Send completion as voice note too
      const completionText = 'Thank you! The survey is now complete. We will analyze your responses and share insights soon.';
      let sentCompletionAudio = false;
      try {
        const ttsResult = await synthesizeText(completionText, { lang: preferredLanguage, format: process.env.TTS_FORMAT || 'mp3' });
        if (ttsResult) {
          await sendWhatsAppAudio(phoneNumber, ttsResult.filePath, ttsResult.mimeType);
          sentCompletionAudio = true;
        }
      } catch (err) {
        // fallback to text
      }
      if (!sentCompletionAudio) {
        await sendMessage(
          phoneNumber,
          '✅ Survey completed! Thank you for your responses. We will analyze and share insights soon.'
        );
      }
    }
  } catch (error) {
    console.error('❌ Error handling audio response:', error.message);
    await sendMessage(phoneNumber, '❌ Error processing voice note. Please try again.');
  }
};

/**
 * AI-match a transcript string to question options using Groq LLM
 * Returns { index, confidence, note }
 */
const matchVoiceToOption = async (transcript, question) => {
  const Groq = (await import('groq-sdk')).default;
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  const prompt = `You are a strict option classifier for a farmer survey.

The farmer was asked: "${question.text}"
The available options are: ${JSON.stringify(question.options)}
The farmer replied (voice transcription): "${transcript}"

Based on the transcription, determine which option (zero-based index) the farmer intended to select.
Consider partial matches, synonyms, and the local language context.
If the transcript clearly matches an option, return high confidence.
If it is ambiguous, return lower confidence.
If no option matches at all, return index -1.

Respond ONLY with valid JSON: {"index": <number>, "confidence": <0-1>, "note": "<brief reason>"}`;

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });

  const content = completion.choices?.[0]?.message?.content || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return { index: -1, confidence: 0, note: 'Failed to parse AI response' };
  }

  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    return {
      index: typeof parsed.index === 'number' ? parsed.index : -1,
      confidence: Number(parsed.confidence || 0),
      note: parsed.note || '',
    };
  } catch {
    return { index: -1, confidence: 0, note: 'JSON parse error' };
  }
};

/**
 * Get farmer's active survey session with current question
 */
const getActiveSession = async (db, phoneNumber, surveyId = null) => {
  try {
    const sessions = getCollection(db, 'surveySessions');
    const answers = getCollection(db, 'answers');
    const farmers = getCollection(db, 'farmers');

    const farmer = await farmers.findOne({ phoneNumber });
    const ownerUserId = farmer?.ownerUserId || null;

    const surveyFilter = surveyId ? buildSurveyMatch(surveyId) : {};
    const loadLatestSession = async (candidatePhone) => {
      if (!candidatePhone) return null;

      let matched = null;
      if (ownerUserId) {
        matched = await sessions.findOne(
          { phoneNumber: candidatePhone, status: 'in_progress', ...surveyFilter, ownerUserId },
          { sort: { createdAt: -1 } }
        );
      }

      if (!matched) {
        matched = await sessions.findOne(
          { phoneNumber: candidatePhone, status: 'in_progress', ...surveyFilter },
          { sort: { createdAt: -1 } }
        );
      }

      return matched;
    };

    let session = await loadLatestSession(phoneNumber);
    if (!session) {
      // Try alternate phone formats (with or without leading '+') to handle legacy or inconsistent storage
      try {
        const altPhone = phoneNumber.startsWith('+') ? phoneNumber.replace(/^\+/, '') : `+${phoneNumber}`;
        session = await loadLatestSession(altPhone);
      } catch (err) {
        // ignore and fall through
      }
      if (!session) return null;
    }

    const sessionId = session.id;
    const sessionSurveyId = normalizeSurveyId(session.surveyId || DEFAULT_SURVEY_ID);
    const sessionOwnerUserId = session?.ownerUserId || ownerUserId || null;

    if (ownerUserId && session?.ownerUserId && ownerUserId !== session.ownerUserId) {
      console.log(`⚠️ Owner mismatch for active session lookup phone=${phoneNumber} farmerOwner=${ownerUserId} sessionOwner=${session.ownerUserId}`);
    }

    const lastAnswer = await answers.findOne(
      { sessionId },
      { sort: { createdAt: -1 } }
    );

    let currentQuestion = null;
    if (lastAnswer) {
      const selectedIdx = lastAnswer.selectedOptionIndex;
      const isNumericIdx = typeof selectedIdx === 'number' && Number.isFinite(selectedIdx);

      // Pending voice answers are stored with selectedOptionIndex = -1.
      // Treat them as “still on the same question” so the session doesn't advance prematurely.
      if (!isNumericIdx || selectedIdx === -1) {
        currentQuestion = await getQuestionById(db, lastAnswer.questionId, sessionOwnerUserId, sessionSurveyId);
      } else {
        currentQuestion = await getNextQuestion(db, lastAnswer.questionId, selectedIdx, sessionOwnerUserId, sessionSurveyId);
      }
    } else {
      currentQuestion = await getFirstQuestion(db, sessionOwnerUserId, sessionSurveyId);
    }

    // Defensive fallback: if question lookup fails for any reason, restart from first.
    if (!currentQuestion) {
      currentQuestion = await getFirstQuestion(db, sessionOwnerUserId, sessionSurveyId);
    }

    return { sessionId, currentQuestion, ownerUserId: sessionOwnerUserId, surveyId: sessionSurveyId };
  } catch (error) {
    console.error('❌ Error getting active session:', error.message);
    return null;
  }
};

const getFarmerByPhone = async (db, phoneNumber) => {
  const farmers = getCollection(db, 'farmers');
  const farmer = await farmers.findOne(
    { phoneNumber },
    { projection: { _id: 0, preferredLanguage: 1, region: 1, responseMode: 1, ownerUserId: 1, regionConfirmed: 1, lastInvitedSurveyId: 1 } }
  );
  return farmer || null;
};

const createSessionForFarmer = async (db, phoneNumber, surveyId = DEFAULT_SURVEY_ID, ownerUserIdOverride = null) => {
  // Ensure only one in-progress session exists per phoneNumber using an atomic upsert
  const sessions = getCollection(db, 'surveySessions');
  const farmers = getCollection(db, 'farmers');
  const farmer = await farmers.findOne({ phoneNumber }, { projection: { ownerUserId: 1 } });
  const ownerUserId = ownerUserIdOverride || farmer?.ownerUserId || null;
  const normalizedSurveyId = normalizeSurveyId(surveyId);

  const existing = await sessions.findOne(
    { phoneNumber, status: 'in_progress', ...buildSurveyMatch(normalizedSurveyId), ...(ownerUserId ? { ownerUserId } : {}) },
    { sort: { createdAt: -1 } }
  );
  if (existing?.id) {
    return existing.id;
  }

  const sessionId = `session_${phoneNumber}_${Date.now()}`;

  const result = await sessions.findOneAndUpdate(
    { phoneNumber, status: 'in_progress', ...buildSurveyMatch(normalizedSurveyId), ...(ownerUserId ? { ownerUserId } : {}) },
    {
      $setOnInsert: {
        id: sessionId,
        phoneNumber,
        surveyId: normalizedSurveyId,
        ...(ownerUserId ? { ownerUserId } : {}),
        status: 'in_progress',
        createdAt: new Date(),
        completedAt: null,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  await farmers.updateOne(
    { phoneNumber },
    { $set: { lastInvitedSurveyId: normalizedSurveyId } },
    { upsert: true }
  );

  // Return the existing or newly-created session id
  return result.value?.id || sessionId;
};

const REPLY_PROMPT = {
  telugu: 'సంఖ్య (1-{n}) తో సమాధానమివ్వండి',
  hindi: 'कृपया संख्या (1-{n}) के साथ उत्तर दें',
  kannada: 'ಸಂಖ್ಯೆ (1-{n}) ನೊಂದಿಗೆ ಉತ್ತರಿಸಿ',
  english: 'Reply with number (1-{n})',
};

const LIST_BUTTON_TEXT = {
  telugu: 'ఎంచుకోండి',
  hindi: 'चुनें',
  kannada: 'ಆಯ್ಕೆಮಾಡಿ',
  english: 'Choose',
};

/**
 * Send an introductory message with language selection (list message)
 */
const sendIntroductionMessage = async (phoneNumber) => {
  const body = `👋 Welcome to the Farmer Survey!

Tap a language to continue, or reply START to begin.`;
  try {
    await sendLanguageSelectionList(phoneNumber, body);

    // Offer response mode selection (Audio vs Text) as a follow-up
    try {
      await sendModeSelectionButtons(phoneNumber, 'english');
    } catch (err) {
      // Non-fatal: if mode buttons fail, continue silently
      console.warn('⚠️ Failed to send mode selection buttons:', err.message);
    }
  } catch (err) {
    console.error('❌ Failed to send introduction:', err.message);
    await sendMessage(phoneNumber, '👋 Welcome to the Farmer Survey! Reply START to begin.');
  }
};

/**
 * Send a language selection list with fixed ids like 'lang_telugu'
 */
const isPermissionError = (err) => {
  const code = err?.response?.data?.error?.code;
  const msg = err?.response?.data?.error?.message || '';
  return code === 10 || /permission/i.test(msg);
};

const isReEngagementErrorCode = (code, message = '') => {
  const normalizedCode = Number(code || 0);
  const normalizedMessage = String(message || '').toLowerCase();
  return normalizedCode === 131047 || normalizedMessage.includes('24 hours') || normalizedMessage.includes('re-engagement');
};

const parseTemplateComponents = () => {
  const raw = process.env.WHATSAPP_INVITE_TEMPLATE_COMPONENTS_JSON;
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (err) {
    console.warn('⚠️ Invalid WHATSAPP_INVITE_TEMPLATE_COMPONENTS_JSON. Expected a JSON array.');
    return undefined;
  }
};

const sendInviteTemplateMessage = async (phoneNumber) => {
  const to = normalizePhoneNumber(phoneNumber);
  if (!to) {
    return { sent: false, reason: 'invalid_phone' };
  }

  const templateName = String(INVITE_TEMPLATE_NAME || '').trim();
  if (!templateName) {
    return { sent: false, reason: 'missing_template_name' };
  }

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
  const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

  if (!phoneId || !accessToken) {
    return { sent: false, reason: 'missing_whatsapp_config' };
  }

  const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: INVITE_TEMPLATE_LANG },
    },
  };

  const components = parseTemplateComponents();
  if (components && components.length > 0) {
    payload.template.components = components;
  }

  const response = await axios.post(endpoint, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  const messageId = response.data?.messages?.[0]?.id || null;
  console.log(`✅ Invite template sent: ${to} (template=${templateName}, id: ${messageId || 'unknown'})`);
  return { sent: true, templateName, messageId };
};

const sendLanguageSelectionList = async (phoneNumber, bodyText = 'Choose language') => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send WhatsApp message: invalid phone number', phoneNumber);
      return { fallback: false };
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      console.warn('⚠️ WhatsApp configuration is incomplete. Missing:', missing.join(', '));
      console.log('   Simulated language selection =>', { to, bodyText });
      return { fallback: true };
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;
    const rows = [
      { id: 'lang_telugu', title: 'తెలుగు' },
      { id: 'lang_hindi', title: 'हिंदी' },
      { id: 'lang_kannada', title: 'ಕನ್ನಡ' },
      { id: 'lang_english', title: 'English' },
    ];

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: (LIST_BUTTON_TEXT.english || 'Choose').slice(0, 20),
          sections: [
            {
              title: 'Languages',
              rows,
            },
          ],
        },
      },
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ Language selection sent: ${to} (id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
    return { fallback: false };
  } catch (error) {
    console.error('❌ Error sending language selection message:');
    console.error('   error:', error.response?.data || error.message);
    const errCode = error?.response?.data?.error?.code;

    if (errCode === 131030) {
      // Recipient not in allowed list — surface a friendly, actionable error
      throw new AppError('WhatsApp error: recipient phone number not in allowed list. Add the recipient phone number to your WhatsApp Business allowed list (or use a verified test number).', 400);
    }

    // If the error indicates the app lacks permission for interactive/list messages, fallback to a plain text prompt
    if (isPermissionError(error)) {
      try {
        const fallbackText = `Please select your preferred language by replying with the number:\n1. Telugu\n2. Hindi\n3. Kannada\n4. English`;
        await sendMessage(phoneNumber, fallbackText);
        console.log('ℹ️ Fallback language selection sent as plain text due to permission error');
        return { fallback: true };
      } catch (err2) {
        console.error('❌ Failed to send fallback language text:', err2.message || err2);
        throw new AppError('Failed to send language selection message: ' + (error?.response?.data?.error?.message || error.message), 500);
      }
    }

    throw new AppError('Failed to send language selection message: ' + (error?.response?.data?.error?.message || error.message), 500);
  }
};

/**
 * Send a small two-button interactive message to let returning users continue or change language
 */
const sendContinueOrChangeButtons = async (phoneNumber, preferredLanguage) => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send WhatsApp message: invalid phone number', phoneNumber);
      return { fallback: true };
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      console.warn('⚠️ WhatsApp configuration is incomplete. Missing:', missing.join(', '));
      console.log('   Simulated continue/change =>', { to, preferredLanguage });
      return { fallback: true };
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;

    // Build buttons depending on feature flag (omit audio if disabled)
    let buttons = [
      {
        type: 'reply',
        reply: { id: `action_continue`, title: `Continue in ${preferredLanguage.charAt(0).toUpperCase() + preferredLanguage.slice(1)}` },
      },
      {
        type: 'reply',
        reply: { id: `action_change_lang`, title: 'Choose language' },
      },
    ];

    let bodyText = `Welcome back! Continue in ${preferredLanguage} or select another language.`;

    try {
      const { isTtsEnabled } = await import('../config/featureFlags.js');
      if (isTtsEnabled()) {
        buttons.push({ type: 'reply', reply: { id: 'action_mode_audio', title: 'Use Audio' } });
        bodyText = `Welcome back! Continue in ${preferredLanguage} or select another language. You can also choose audio replies.`;
      } else {
        console.log('ℹ️ TTS disabled by feature flag — omitting audio button for returning user', to);
      }
    } catch (err) {
      // If flag check fails, include audio button as a fallback
      buttons.push({ type: 'reply', reply: { id: 'action_mode_audio', title: 'Use Audio' } });
      bodyText = `Welcome back! Continue in ${preferredLanguage} or select another language. You can also choose audio replies.`;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons },
      },
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ Continue/change buttons sent: ${to} (id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
    return { fallback: false };
  } catch (error) {
    console.error('❌ Error sending continue/change buttons:');
    console.error('   error:', error.response?.data || error.message);
    const errCode = error?.response?.data?.error?.code;
    // Recipient not in allowed list — bubble as before
    if (errCode === 131030) {
      throw new AppError('WhatsApp error: recipient phone number not in allowed list. Add the recipient phone number to your WhatsApp Business allowed list (or use a verified test number).', 400);
    }

    if (isPermissionError(error)) {
      try {
        const fallback = `Welcome back! Continue by replying 'Continue' to keep your language or reply 'Change' to select another language.`;
        await sendMessage(phoneNumber, fallback);
        console.log('ℹ️ Fallback continue/change sent as plain text due to permission error');
        return { fallback: true };
      } catch (err2) {
        console.error('❌ Failed to send fallback continue/change text:', err2.message || err2);
        throw new AppError('Failed to send continue/change buttons: ' + (error?.response?.data?.error?.message || error.message), 500);
      }
    }

    throw new AppError('Failed to send continue/change buttons: ' + (error?.response?.data?.error?.message || error.message), 500);
  }
};

/**
 * Send a small two-button interactive message to let new or location-less users choose how they want to continue
 * Options: Audio (voice notes) or Text (typed replies)
 */
const sendModeSelectionButtons = async (phoneNumber, preferredLanguage, onboarding = false) => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send WhatsApp message: invalid phone number', phoneNumber);
      return;
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      console.warn('⚠️ WhatsApp configuration is incomplete. Missing:', missing.join(', '));
      console.log('   Simulated mode selection =>', { to, preferredLanguage });
      return;
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;

    // Localize body text based on preferred language
    const lang = (preferredLanguage || 'english').toLowerCase();
    let bodyText = MODE_PROMPTS[lang] || MODE_PROMPTS.english;

    // Onboarding flow: show simple Audio / Text choice. For returning users, show Continue / Change buttons plus optional audio.
    let buttons = [
      { type: 'reply', reply: { id: 'action_mode_audio', title: 'Audio' } },
      { type: 'reply', reply: { id: 'action_mode_text', title: 'Text' } },
    ];

    if (!onboarding) {
      // Returning user: offer Continue / Change language and optional Audio depending on TTS flag
      buttons = [
        { type: 'reply', reply: { id: `action_continue`, title: `Continue` } },
        { type: 'reply', reply: { id: `action_change_lang`, title: 'Choose language' } },
      ];
      try {
        const { isTtsEnabled } = await import('../config/featureFlags.js');
        if (isTtsEnabled()) {
          buttons.push({ type: 'reply', reply: { id: 'action_mode_audio', title: 'Use Audio' } });
        }
      } catch (err) {
        buttons.push({ type: 'reply', reply: { id: 'action_mode_audio', title: 'Use Audio' } });
      }
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons },
      },
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ Mode selection buttons sent: ${to} (id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
    return { fallback: false };
  } catch (error) {
    console.error('❌ Error sending mode selection buttons:');
    console.error('   error:', error.response?.data || error.message);
    const errCode = error?.response?.data?.error?.code;
    if (errCode === 131030) {
      throw new AppError('WhatsApp error: recipient phone number not in allowed list. Add the recipient phone number to your WhatsApp Business allowed list (or use a verified test number).', 400);
    }

    if (isPermissionError(error)) {
      try {
        const lang = (preferredLanguage || 'english').toLowerCase();
        const fallback = MODE_PROMPTS[lang] || MODE_PROMPTS.english;
        await sendMessage(phoneNumber, fallback + '\nReply with "Audio" or "Text".');
        console.log('ℹ️ Fallback mode selection sent as plain text due to permission error');
        return { fallback: true };
      } catch (err2) {
        console.error('❌ Failed to send fallback mode text:', err2.message || err2);
        throw new AppError('Failed to send mode selection buttons: ' + (error?.response?.data?.error?.message || error.message), 500);
      }
    }

    throw new AppError('Failed to send mode selection buttons: ' + (error?.response?.data?.error?.message || error.message), 500);
  }
};

/**
 * Handle action replies from continue/change message
 */
const handleActionReply = async (db, phoneNumber, replyId) => {
  try {
    console.log(`🔔 Action reply received: ${replyId} from ${phoneNumber}`);

    if (replyId === 'action_continue') {
      const farmer = await getFarmerByPhone(db, phoneNumber);
      const preferredLanguage = farmer?.preferredLanguage || 'english';
      const targetSurveyId = normalizeSurveyId(farmer?.lastInvitedSurveyId || DEFAULT_SURVEY_ID);
      await sendMessage(phoneNumber, `🚀 Continuing in ${preferredLanguage}.`);
      await startSurvey(db, phoneNumber, farmer, farmer?.region, preferredLanguage, false, targetSurveyId);
      return;
    }

    if (replyId === 'action_mode_audio' || replyId === 'action_mode_text') {
      const mode = replyId === 'action_mode_audio' ? 'audio' : 'text';
      await handleModeSelection(db, phoneNumber, mode);
      return;
    }

    if (replyId === 'action_change_lang') {
      await sendLanguageSelectionList(phoneNumber, 'Please select your preferred language:');
      return;
    }

    await sendMessage(phoneNumber, '⚠️ Unsupported action. Please reply START to begin.');
  } catch (error) {
    console.error('❌ Error handling action reply:', error.message);
    await sendMessage(phoneNumber, '❌ Error processing selection. Please try again.');
  }
};

/**
 * Handle mode selection change (audio | text)
 */
const handleModeSelection = async (db, phoneNumber, mode) => {
  try {
    console.log(`🔄 Setting response mode for ${phoneNumber} => ${mode}`);
    const farmers = getCollection(db, 'farmers');
    await farmers.updateOne({ phoneNumber }, { $set: { responseMode: mode } }, { upsert: true });

    // Ensure a session exists before confirming preference to avoid race conditions
    const farmerContext = await getFarmerByPhone(db, phoneNumber);
    const targetSurveyId = normalizeSurveyId(farmerContext?.lastInvitedSurveyId || DEFAULT_SURVEY_ID);

    const existing = await getActiveSession(db, phoneNumber, targetSurveyId);
    if (!existing) {
      await createSessionForFarmer(db, phoneNumber, targetSurveyId);
      console.log(`🟢 Created new session for ${phoneNumber} during mode selection`);
    }

    // Localized confirmations
    const MODE_CONFIRMATIONS = {
      telugu: {
        audio: 'పరంపర సెట్ చేయబడింది. మీరు ఈ సెషన్‌లో ఆడియో (వాయిస్ నోట్లు) ద్వారా కొనసాగుతారు. ప్రతిప్రశ్నకి వాయిస్ నోట్ పంపుతాను — సమాధానం ఇవ్వడానికి వాయిస్ నోట్‌ను రిప్లై చేయండి.',
        text: 'ప్రాధాన్యత సేవ్ చేయబడింది. మీరు ఈ సెషన్‌లో పాఠ్య (టైప్ చేసిన) ద్వారా కొనసాగుతారు.'
      },
      hindi: {
        audio: 'प्राथमिकता सहेज ली गयी। आप इस सत्र में ऑडियो (वॉइस नोट) के रूप में जारी रखेंगे। हर प्रश्न पर वॉइस नोट भेजा जाएगा — उत्तर देने के लिए वॉइस नोट भेजें।',
        text: 'प्राथमिकता सहेज ली गयी। आप इस सत्र में टेक्स्ट के रूप में जारी रखेंगे।'
      },
      kannada: {
        audio: 'ಆದ್ಯತೆ ಉಳಿಸಲಾಗಿದೆ. ನೀವು ಈ ಸೆಷನ್‌ನಲ್ಲಿ ಆಡಿಯೋ (ವಾಯ್ಸ್ ನೋಟ್ಸ್) ಮೂಲಕ ಮುಂದುವರಿಯುತ್ತೀರಿ. ಪ್ರತಿಯೊಂದು ಪ್ರಶ್ನೆಯನ್ನೂ ವಾಯ್ಸ್ ನೋಟ್ನಲ್ಲಿ ಕಳುಹಿಸಲಾಗುವುದು — ಉತ್ತರಿಸಲು ವಾಯ್ಸ್ ನೋಟನ್ನು ರಿಪ್ಲೈ ಮಾಡಿ.',
        text: 'ಆದ್ಯತೆ ಉಳಿಸಲಾಗಿದೆ. ನೀವು ಈ ಸೆಷನ್‌ನಲ್ಲಿ ಪಠ್ಯ (ಟೈಪ್) ಮೂಲಕ ಮುಂದುವರಿಯುತ್ತೀರಿ.'
      },
      english: {
        audio: '✅ Preference saved. You will continue in Audio (voice notes) for this session. I will send you each question as a voice note — just reply with a voice note to answer! 🎙️',
        text: '✅ Preference saved. You will continue in Text for this session.'
      }
    };

    // After we persisted the response mode, re-fetch farmer to determine preferredLanguage
    const farmerAfter = await getFarmerByPhone(db, phoneNumber);
    const lang = (farmerAfter?.preferredLanguage || 'english').toLowerCase();

    if (mode === 'audio') {
      // If feature-flag disables TTS, refuse and inform user
      try {
        const { isTtsEnabled } = await import('../config/featureFlags.js');
        if (!isTtsEnabled()) {
          await farmers.updateOne({ phoneNumber }, { $set: { responseMode: 'text' } }, { upsert: true });
          const msg = (MODE_CONFIRMATIONS[lang]?.text) || MODE_CONFIRMATIONS.english.text;
          await sendMessage(phoneNumber, '⚠️ Voice replies are currently disabled by the system administrator. ' + msg);
          return;
        }
      } catch (err) {
        console.warn('⚠️ Could not read TTS feature flag:', err.message || err);
      }

      const confirmMsg = (MODE_CONFIRMATIONS[lang]?.audio) || MODE_CONFIRMATIONS.english.audio;
      await sendMessage(phoneNumber, confirmMsg);

      // Check that TTS is available before attempting to send an audio question
      try {
        const ttsHealth = await checkTtsEndpoint(3000);
        if (!ttsHealth.ok) {
          console.warn('⚠️ TTS service not healthy:', ttsHealth.error || 'unknown');
          // Revert to text mode and inform the farmer
          await farmers.updateOne({ phoneNumber }, { $set: { responseMode: 'text' } }, { upsert: true });
          const msg = (MODE_CONFIRMATIONS[lang]?.text) || MODE_CONFIRMATIONS.english.text;
          await sendMessage(phoneNumber, '⚠️ Voice replies are currently unavailable. ' + msg);
        }
      } catch (err) {
        console.warn('⚠️ TTS health check failed:', err.message || err);
        await farmers.updateOne({ phoneNumber }, { $set: { responseMode: 'text' } }, { upsert: true });
        const msg = (MODE_CONFIRMATIONS[lang]?.text) || MODE_CONFIRMATIONS.english.text;
        await sendMessage(phoneNumber, '⚠️ Voice replies are currently unavailable. ' + msg);
      }

    } else {
      const confirmMsg = (MODE_CONFIRMATIONS[lang]?.text) || MODE_CONFIRMATIONS.english.text;
      await sendMessage(phoneNumber, confirmMsg);
    }

    // If an active session doesn't exist yet, progress onboarding.
    // If farmer already has region set, skip Q_LOCATION and start the normal session flow.
    try {
      const farmer = await getFarmerByPhone(db, phoneNumber);
      const preferredLanguage = farmer?.preferredLanguage || 'english';
      const locationQ = await getQuestionById(db, 'Q_LOCATION');

      // Ensure there's an active session so replies (voice or text) are accepted immediately
      const existing = await getActiveSession(db, phoneNumber, targetSurveyId);
      if (!existing) {
        await createSessionForFarmer(db, phoneNumber, targetSurveyId);
        console.log(`🟢 Created new session for ${phoneNumber} after mode selection (mode=${mode})`);
      }

      // Start or continue the survey flow — let startNewSession decide what to send next
      await new Promise(resolve => setTimeout(resolve, 500));
      await startNewSession(db, phoneNumber, targetSurveyId);
    } catch (err) {
      console.warn('⚠️ Failed to send location question after mode selection:', err.message);
      await sendMessage(phoneNumber, '⚠️ Failed to send the next question. Please reply START to continue.');
    }

  } catch (err) {
    console.error('❌ Error handling mode selection:', err.message);
    await sendMessage(phoneNumber, '❌ Failed to set preference. Please try again.');
  }
};

/**
 * Handle language selection interactive reply (id like 'lang_telugu')
 */
const handleLanguageSelection = async (db, phoneNumber, langToken) => {
  try {
    const normalized = parseRequestedLanguage(langToken) || langToken;

    // Ensure farmer exists, set preferred language and start survey
    const farmer = await getFarmerByPhone(db, phoneNumber);
    const alreadySet = farmer && farmer.preferredLanguage === normalized;

    if (!farmer) {
      const farmers = getCollection(db, 'farmers');
      await farmers.insertOne({
        phoneNumber,
        preferredLanguage: normalized,
        createdAt: new Date(),
        region: null,
        regionConfirmed: false,
        status: 'in_progress',
        responseMode: 'text',
      });
    } else if (!alreadySet) {
      // Persist choice only if different
      const farmers = getCollection(db, 'farmers');
      await farmers.updateOne(
        { phoneNumber },
        { $set: { preferredLanguage: normalized } }
      );
      console.log(`🔄 Updated preferred language for ${phoneNumber} -> ${normalized}`);
    }

    if (alreadySet) {
      await sendMessage(phoneNumber, `✅ Language already set to ${normalized}.`);
    } else {
      // Send a localized confirmation message for the selected language
      const confirmations = {
        telugu: 'భాష ఎంపిక జరిగింది: తెలుగు.',
        hindi: 'भाषा चयन हो गया: हिन्दी।',
        kannada: 'ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಲಾಗಿದೆ: ಕನ್ನಡ.',
        english: 'Language selected: English.',
      };
      const msg = confirmations[normalized] || `Language set to ${normalized}.`;
      await sendMessage(phoneNumber, `✅ ${msg}`);
    }

    // After language is set, ask the user whether they want Audio or Text (onboarding flow)
    try {
      await sendModeSelectionButtons(phoneNumber, normalized, true);
    } catch (err) {
      console.error('❌ Failed to send mode selection after language selection:', err.message || err);
      await sendMessage(phoneNumber, '⚠️ Failed to send mode selection. Please reply with Audio or Text to continue.');
    }
  } catch (error) {
    console.error('❌ Error handling language selection:', error.message);
    await sendMessage(phoneNumber, '❌ Error setting language. Please reply START or try again.');
  }
};

const DIGIT_MAP = {
  telugu: ['౧', '౨', '౩', '౪', '౫', '౬', '౭', '౮', '౯', '౧౦'],
  hindi: ['१', '२', '३', '४', '५', '६', '७', '८', '९', '१०'],
  kannada: ['೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯', '೧೦'],
  english: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
};

const EN_NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const extractNumericOptionFromTranscript = (transcript, language, maxOption) => {
  if (!transcript) return null;
  const text = String(transcript);
  const lower = text.toLowerCase();

  const asciiMatch = lower.match(/\b(10|[1-9])\b/);
  if (asciiMatch) {
    const n = Number(asciiMatch[1]);
    if (n >= 1 && n <= maxOption) return n;
  }

  // Check localized digits (current language first, then all maps)
  const langKey = (language || 'english').toLowerCase();
  const maps = [DIGIT_MAP[langKey], ...Object.values(DIGIT_MAP)].filter(Boolean);
  for (const digits of maps) {
    for (let i = 0; i < digits.length; i += 1) {
      if (text.includes(digits[i])) {
        const n = i + 1;
        if (n >= 1 && n <= maxOption) return n;
      }
    }
  }

  for (const [word, num] of Object.entries(EN_NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower) && num <= maxOption) {
      return num;
    }
  }

  return null;
};

const getLocalizedIndex = (index, language) => {
  const lang = (language || 'english').toLowerCase();
  const digits = DIGIT_MAP[lang] || DIGIT_MAP.english;
  return digits[index] || String(index + 1);
};

const sendLanguagePrompt = async (phoneNumber, language) => {
  const normalized = (language || 'english').toLowerCase();
  const message = LANGUAGE_PROMPTS[normalized] || LANGUAGE_PROMPTS.default;
  await sendMessage(phoneNumber, message);
};

const buildQuestionPayload = (q, language) => {
  const lang = (language || 'english').toLowerCase();
  const text = q[`text_${lang}`] || q.text || q['text_telugu'] || q['text_hindi'];
  const options = q[`options_${lang}`] && q[`options_${lang}`].length ? q[`options_${lang}`] : q.options;
  const reply = (REPLY_PROMPT[lang] || REPLY_PROMPT.english).replace('{n}', options.length);

  return { text, options, reply, language: lang };
};

const formatQuestionForLanguage = (q, language) => {
  const { text, options, reply } = buildQuestionPayload(q, language);
  return `${text}\n\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}\n\n${reply}`;
};

const MAX_BUTTONS = 3;
const MAX_LIST_ROWS = 10;

const buildButtonTitle = (optionText, index, language) => {
  const maxLen = 20;
  const prefix = `${getLocalizedIndex(index, language)}. `;
  let title = `${prefix}${optionText}`.trim();
  if (title.length > maxLen) {
    title = title.slice(0, maxLen);
  }
  return title || `${index + 1}`;
};

const buildListRowTitle = (optionText, index, language) => {
  const maxLen = 24;
  const prefix = `${getLocalizedIndex(index, language)}. `;
  let title = `${prefix}${optionText}`.trim();
  if (title.length > maxLen) {
    title = title.slice(0, maxLen);
  }
  return title || `${index + 1}`;
};

const sendQuestionMessage = async (db, phoneNumber, q, language) => {
  const { text, options, reply, language: lang } = buildQuestionPayload(q, language);

  // Check farmer preference for response mode (audio or text)
  let responseMode = 'text';
  try {
    const f = await getFarmerByPhone(db, phoneNumber);
    responseMode = f?.responseMode || 'text';
  } catch (err) {
    // ignore
  }

  // ── Audio mode: send ONLY a TTS voice note (no text form/buttons) ──
  if (responseMode === 'audio') {
    // If TTS was disabled by feature flag, fall back to text immediately
    try {
      const { isTtsEnabled } = await import('../config/featureFlags.js');
      if (!isTtsEnabled()) {
        const fallbackBodyDisabled = `🔊 ${text}\n\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}\n\n🎙️ Voice replies are currently disabled by the system. Reply with a voice note when enabled or reply with the number to answer.`;
        console.log('ℹ️ TTS is disabled via feature flag; sending text fallback');
        await sendMessage(phoneNumber, fallbackBodyDisabled);
        return;
      }
    } catch (err) {
      console.warn('⚠️ Could not read TTS feature flag:', err.message || err);
    }

    const spokenOptions = options.map((opt, idx) => `${idx + 1}. ${opt}`).join('. ');
    const spokenScript = `${text}. ${spokenOptions}`;

    let ttsResult = null;
    try {
      ttsResult = await synthesizeText(spokenScript, { lang, format: process.env.TTS_FORMAT || 'mp3' });
    } catch (err) {
      console.error('❌ TTS synthesis failed:', err.response?.data || err.message || err);
    }

    if (ttsResult) {
      // Persist TTS audio record
      try {
        const audioCollection = getCollection(db, 'audio');
        await audioCollection.insertOne({
          id: ttsResult.audioId,
          fileName: ttsResult.fileName,
          filePath: ttsResult.filePath,
          mimeType: ttsResult.mimeType,
          fileSize: ttsResult.fileSize,
          source: 'tts',
          sourceText: spokenScript,
          lang: lang || null,
          createdAt: new Date(),
          transcriptionStatus: 'not_requested',
        });
      } catch (err) {
        console.warn('⚠️ Failed to persist TTS audio record:', err.message);
      }

      // Send TTS audio to farmer via WhatsApp
      try {
        await sendWhatsAppAudio(phoneNumber, ttsResult.filePath, ttsResult.mimeType);
        // Do not send an extra text prompt; the audio itself is the question
        return;
      } catch (err) {
        const code = err?.response?.data?.error?.code;
        const msg = err?.response?.data?.error?.message || err.message;
        console.error('❌ Failed to send TTS audio to WhatsApp:', {
          code,
          message: msg,
          status: err?.response?.status,
          data: err?.response?.data,
        });
        // Fall through to text fallback below
      }
    }

    // TTS fallback: if synthesis or send failed, send a plain-text version (no buttons)
    const fallbackBody = `🔊 ${text}\n\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}\n\n🎙️ Reply with a voice note to answer.`;
    await sendMessage(phoneNumber, fallbackBody);
    return;
  }

  // ── Text mode: send interactive buttons / list / plain text ──
  if (options.length > 0 && options.length <= MAX_BUTTONS) {
    await sendInteractiveButtons(phoneNumber, text, options, reply, lang);
    return;
  }

  if (options.length > MAX_BUTTONS && options.length <= MAX_LIST_ROWS) {
    await sendListMessage(phoneNumber, text, options, reply, lang);
    return;
  }

  const body = `${text}\n\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}\n\n${reply}`;
  await sendMessage(phoneNumber, body);
};

const completeSession = async (db, phoneNumber, sessionId) => {
  try {
    const sessions = getCollection(db, 'surveySessions');
    await sessions.updateOne(
      { id: sessionId },
      { $set: { status: 'completed', completedAt: new Date() } }
    );

    console.log(`✅ Session completed: ${sessionId}`);
  } catch (error) {
    console.error('❌ Error completing session:', error.message);
  }
};

const sendMessage = async (phoneNumber, text) => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send WhatsApp message: invalid phone number', phoneNumber);
      return;
    }

    // Read env vars at call time (dotenv may be loaded after module imports)
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      console.warn('⚠️ WhatsApp configuration is incomplete. Missing:', missing.join(', '));
      console.log('   Simulated send =>', { to, preview: text.substring(0, 250) });
      return;
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: text,
      },
    };

    // https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#text
    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ Message sent: ${to} (id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
  } catch (error) {
    console.error('❌ Error sending message:');
    console.error('   endpoint:', `${WHATSAPP_API_BASE_URL}/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`);
    console.error('   error:', error.response?.data || error.message);
  }
};

const sendInteractiveButtons = async (phoneNumber, bodyText, options, footerText = '', language = 'english') => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send WhatsApp message: invalid phone number', phoneNumber);
      return;
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      console.warn('⚠️ WhatsApp configuration is incomplete. Missing:', missing.join(', '));
      console.log('   Simulated interactive send =>', { to, bodyText, options });
      return;
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;
    const buttons = options.slice(0, MAX_BUTTONS).map((option, idx) => ({
      type: 'reply',
      reply: {
        id: `opt_${idx + 1}`,
        title: buildButtonTitle(option, idx, language),
      },
    }));

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: bodyText,
        },
        action: {
          buttons,
        },
      },
    };

    if (footerText) {
      payload.interactive.footer = { text: footerText.slice(0, 60) };
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ Interactive message sent: ${to} (id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
  } catch (error) {
    console.error('❌ Error sending interactive message:');
    console.error('   error:', error.response?.data || error.message);
  }
};

/**
 * Upload a local audio file to WhatsApp media endpoint and return media id
 */
const uploadMediaToWhatsApp = async (filePath, mimeType) => {
  const fs = await import('fs');
  const FormData = (await import('form-data')).default;
  const path = await import('path');

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
  const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

  if (!phoneId || !accessToken) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not configured');
  }

  const endpoint = `${apiBase}/${apiVersion}/${phoneId}/media`;
  const form = new FormData();
  const resolvedMime = mimeType || 'audio/mpeg';
  const fileName = path.basename(filePath);
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    console.error('❌ WhatsApp media upload: file missing/unreadable:', filePath);
    throw err;
  }

  console.log('📎 Uploading media to WhatsApp:', { filePath, fileName, bytes: stat?.size || null, mimeType: resolvedMime });

  form.append('file', fs.createReadStream(filePath), {
    filename: fileName,
    contentType: resolvedMime,
  });
  form.append('type', resolvedMime);
  // Required by the WhatsApp Cloud API for media uploads
  form.append('messaging_product', 'whatsapp');

  const headers = { Authorization: `Bearer ${accessToken}`, ...form.getHeaders() };
  try {
    const res = await axios.post(endpoint, form, {
      headers,
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return res.data?.id || null;
  } catch (err) {
    console.error('❌ WhatsApp media upload failed:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    throw err;
  }
};

/**
 * Send an audio message using an already uploaded media id or a local file
 */
const sendWhatsAppAudio = async (phoneNumber, filePath, mimeType) => {
  const to = normalizePhoneNumber(phoneNumber);
  if (!to) throw new Error('Invalid phone number');

  let mediaId = null;
  // Upload file to WhatsApp media
  mediaId = await uploadMediaToWhatsApp(filePath, mimeType);
  if (!mediaId) throw new Error('Failed to upload media to WhatsApp');

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
  const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';
  const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: { id: mediaId },
  };

  try {
    console.log('📤 Sending WhatsApp audio message payload:', { to, mediaId, mimeType });
    const response = await axios.post(endpoint, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    console.log(`✅ Audio message sent: ${to} (mediaId: ${mediaId} id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
    return mediaId;
  } catch (err) {
    console.error('❌ WhatsApp message send failed:', err.response?.data || err.message || err);
    throw err;
  }
};

const sendListMessage = async (phoneNumber, bodyText, options, footerText = '', language = 'english') => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send WhatsApp message: invalid phone number', phoneNumber);
      return;
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');

    if (missing.length > 0) {
      console.warn('⚠️ WhatsApp configuration is incomplete. Missing:', missing.join(', '));
      console.log('   Simulated list send =>', { to, bodyText, options });
      return;
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;
    const rows = options.slice(0, MAX_LIST_ROWS).map((option, idx) => ({
      id: `opt_${idx + 1}`,
      title: buildListRowTitle(option, idx, language),
    }));

    const buttonText = (LIST_BUTTON_TEXT[language] || LIST_BUTTON_TEXT.english).slice(0, 20);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: bodyText,
        },
        action: {
          button: buttonText,
          sections: [
            {
              title: 'Options',
              rows,
            },
          ],
        },
      },
    };

    if (footerText) {
      payload.interactive.footer = { text: footerText.slice(0, 60) };
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ List message sent: ${to} (id: ${response.data.messages?.[0]?.id ?? 'unknown'})`);
  } catch (error) {
    console.error('❌ Error sending list message:');
    console.error('   error:', error.response?.data || error.message);
  }
};

/**
 * WhatsApp credentials & permissions health-check
 * Returns token validity, phoneId accessibility and any permission hints (useful to debug code 10 errors)
 */
export const whatsappHealth = async (req, res, next) => {
  try {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    const missing = [];
    if (!phoneId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (missing.length > 0) {
      return res.status(400).json({ success: false, missing, message: 'Missing WhatsApp configuration' });
    }

    const diagnostics = { tokenOk: false, phoneIdAccessible: false, details: {}, permissionError: null };

    // Validate token by calling /me (harmless read)
    try {
      const meRes = await axios.get(`${apiBase}/${apiVersion}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      diagnostics.tokenOk = true;
      diagnostics.details.me = meRes.data;
    } catch (err) {
      diagnostics.permissionError = err.response?.data || err.message;
      // return early with diagnostics so admin can see token issue
      return res.status(200).json({ success: true, diagnostics });
    }

    // Validate phone id access
    try {
      const phoneRes = await axios.get(`${apiBase}/${apiVersion}/${phoneId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      diagnostics.phoneIdAccessible = true;
      diagnostics.details.phone = phoneRes.data;
    } catch (err) {
      diagnostics.permissionError = err.response?.data || err.message;
    }

    // Detect common permission hint (code 10)
    const code = diagnostics.permissionError?.error?.code;
    const msg = diagnostics.permissionError?.error?.message || '';
    if (code === 10 || /permission/i.test(msg)) {
      diagnostics.permissionHint = 'Permission error (code 10): verify the access token scopes and that your app/phone number are allowed to send interactive messages. Check Business Manager and token source.';
    }

    return res.status(200).json({ success: true, diagnostics });
  } catch (err) {
    next(err);
  }
};

function normalizePhoneNumber(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
}

const normalizeRegionLabel = (value) => {
  if (!value) return 'Unknown';
  const key = value.toString().trim().toLowerCase();
  return REGION_DISPLAY_NAMES[key] || value.charAt(0).toUpperCase() + value.slice(1);
};

const ensureFarmerRegion = async (db, phoneNumber, regionValue) => {
  if (!regionValue) return;
  const normalized = normalizeRegionLabel(regionValue);

  const farmers = getCollection(db, 'farmers');
  const regions = getCollection(db, 'regions');

  await regions.updateOne(
    { name: normalized },
    { $setOnInsert: { name: normalized } },
    { upsert: true }
  );

  await farmers.updateOne(
    { phoneNumber },
    { $set: { region: normalized } },
    { upsert: true }
  );
};

function buildInviteQrPayload() {
  const link = buildWhatsAppInviteLink('START');
  if (!link) {
    // Defensive: if link couldn't be built, surface a clear error
    throw new AppError('Cannot generate QR invite: WHATSAPP_BUSINESS_NUMBER is not configured.', 500);
  }

  const instructions =
    'Scan to open WhatsApp, reply with START, then tap the option number to answer the questions.';

  return {
    link,
    imageUrl: createQRCodeUrl(link),
    instructions,
  };
}

function buildWhatsAppInviteLink(text = 'START') {
  // Prefer reading env at call time in case .env is loaded later
  const rawNumber = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, '') || '';
  if (!rawNumber) return null;
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${rawNumber}?text=${encodedText}`;
}

function createQRCodeUrl(link) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    link
  )}&bgcolor=ffffff&color=333333`;
}

// Export helper used by tools/tests
export { sendWhatsAppAudio };


