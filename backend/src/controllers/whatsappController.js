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
import { storeAudioFile, storeUploadedFile, transcribeAudio } from '../services/audioService.js';
import { synthesizeText, checkTtsEndpoint } from '../services/ttsService.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

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

// ── Localized common messages used throughout the survey flow ──
const SURVEY_MESSAGES = {
  surveyComplete: {
    telugu: '✅ సర్వే పూర్తయింది! మీ సమాధానాలకు ధన్యవాదాలు. మేము విశ్లేషించి త్వరలో అంతర్దృష్టులను పంచుకుంటాము.',
    hindi: '✅ सर्वे पूरा हो गया! आपके उत्तरों के लिए धन्यवाद। हम विश्लेषण करके जल्द ही जानकारी साझा करेंगे।',
    kannada: '✅ ಸಮೀಕ್ಷೆ ಪೂರ್ಣಗೊಂಡಿದೆ! ನಿಮ್ಮ ಉತ್ತರಗಳಿಗೆ ಧನ್ಯವಾದಗಳು. ನಾವು ವಿಶ್ಲೇಷಿಸಿ ಶೀಘ್ರದಲ್ಲಿ ಒಳನೋಟಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳುತ್ತೇವೆ.',
    english: '✅ Survey completed! Thank you for your responses. We will analyze and share insights soon.',
  },
  surveyCompleteTts: {
    telugu: 'ధన్యవాదాలు! సర్వే ఇప్పుడు పూర్తయింది. మేము మీ సమాధానాలను విశ్లేషించి త్వరలో అంతర్దృష్టులను పంచుకుంటాము.',
    hindi: 'धन्यवाद! सर्वे अब पूरा हो गया है। हम आपके उत्तरों का विश्लेषण करके जल्द ही जानकारी साझा करेंगे।',
    kannada: 'ಧನ್ಯವಾದಗಳು! ಸಮೀಕ್ಷೆ ಈಗ ಪೂರ್ಣಗೊಂಡಿದೆ. ನಾವು ನಿಮ್ಮ ಉತ್ತರಗಳನ್ನು ವಿಶ್ಲೇಷಿಸಿ ಶೀಘ್ರದಲ್ಲಿ ಒಳನೋಟಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳುತ್ತೇವೆ.',
    english: 'Thank you! The survey is now complete. We will analyze your responses and share insights soon.',
  },
  errorProcessing: {
    telugu: '❌ మీ సమాధానాన్ని ప్రాసెస్ చేస్తూ లోపం వచ్చింది. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ आपका उत्तर प्रोसेस करते समय त्रुटि हुई। कृपया फिर प्रयास करें।',
    kannada: '❌ ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುವಾಗ ದೋಷ ಉಂಟಾಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Error processing response. Please try again.',
  },
  invalidOption: {
    telugu: '❌ చెల్లని ఎంపిక. దయచేసి 1-{n} నుండి ఎంచుకోండి.',
    hindi: '❌ अमान्य विकल्प। कृपया 1-{n} में से चुनें।',
    kannada: '❌ ಅಮಾನ್ಯ ಆಯ್ಕೆ. ದಯವಿಟ್ಟು 1-{n} ರಿಂದ ಆಯ್ಕೆ ಮಾಡಿ.',
    english: '❌ Invalid option. Please choose 1-{n}',
  },
  voiceReceived: {
    telugu: '✅ వాయిస్ నోట్ అందింది. దయచేసి మీ సమాధానాన్ని నిర్ధారించడానికి ఎంపిక సంఖ్యతో రిప్లై చేయండి.',
    hindi: '✅ वॉइस नोट प्राप्त। कृपया विकल्प संख्या भेजकर अपना उत्तर पुष्टि करें।',
    kannada: '✅ ವಾಯ್ಸ್ ನೋಟ್ ಸ್ವೀಕರಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಆಯ್ಕೆ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ ದೃಢೀಕರಿಸಿ.',
    english: '✅ Voice note received. Please reply with the option number to confirm your answer.',
  },
  errorVoice: {
    telugu: '❌ వాయిస్ నోట్ ప్రాసెస్ చేయడంలో లోపం. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ वॉइस नोट प्रोसेस करने में त्रुटि। कृपया फिर प्रयास करें।',
    kannada: '❌ ವಾಯ್ಸ್ ನೋಟ್ ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುವಲ್ಲಿ ದೋಷ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Error processing voice note. Please try again.',
  },
  answerConfirm: {
    telugu: '✅ మీ సమాధానం: {answer}',
    hindi: '✅ आपका उत्तर: {answer}',
    kannada: '✅ ನಿಮ್ಮ ಉತ್ತರ: {answer}',
    english: '✅ Your answer: {answer}',
  },
  audioNoMediaId: {
    telugu: '⚠️ ఆడియో మీడియా ID లేకుండా వచ్చింది. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '⚠️ ऑडियो बिना मीडिया ID के प्राप्त हुआ। कृपया फिर प्रयास करें।',
    kannada: '⚠️ ಆಡಿಯೋ ಮಾಧ್ಯಮ ID ಇಲ್ಲದೆ ಬಂದಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '⚠️ Audio received without media ID. Please try again.',
  },
  noActiveSession: {
    telugu: '⚠️ యాక్టివ్ సెషన్ లేదు. సర్వే ప్రారంభించడానికి "START" ను రిప్లై చేయండి.',
    hindi: '⚠️ कोई सक्रिय सत्र नहीं। सर्वे शुरू करने के लिए "START" उत्तर दें।',
    kannada: '⚠️ ಸಕ್ರಿಯ ಸೆಷನ್ ಇಲ್ಲ. ಸರ್ವೇ ಪ್ರಾರಂಭಿಸಲು "START" ಗೆ ಉತ್ತರಿಸಿ.',
    english: '⚠️ No active session. Reply "START" to begin survey.',
  },
  noActiveQuestion: {
    telugu: '⚠️ ఏక్రియ ప్రశ్న కనపడలేదు. సర్వే ప్రారంభించడానికి "START" ను రిప్లై చేయండి.',
    hindi: '⚠️ कोई सक्रिय प्रश्न नहीं मिला। सर्वे शुरू करने के लिए "START" उत्तर दें।',
    kannada: '⚠️ ಯಾವುದೇ ಸಕ್ರಿಯ ಪ್ರಶ್ನೆ ಕಂಡುಬಂದಿಲ್ಲ. ಸರ್ವೇ ಪ್ರಾರಂಭಿಸಲು "START" ಗೆ ಉತ್ತರಿಸಿ.',
    english: '⚠️ No active question found. Reply "START" to begin survey.',
  },
  errorStarting: {
    telugu: '❌ సర్వే ప్రారంభించడంలో లోపం. దయచేసి "START" తో మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ सर्वे शुरू करने में त्रुटि। कृपया "START" से फिर प्रयास करें।',
    kannada: '❌ ಸರ್ವೇ ಪ್ರಾರಂಭಿಸುವಲ್ಲಿ ದೋಷ. ದಯವಿಟ್ಟು "START" ನೊಂದಿಗೆ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Error starting survey. Please try "START" again.',
  },
  errorSendingQuestion: {
    telugu: '❌ ప్రస్తుత ప్రశ్నను పంపడంలో లోపం. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ वर्तमान प्रश्न भेजने में त्रुटि। कृपया फिर प्रयास करें।',
    kannada: '❌ ಪ್ರಸ್ತುತ ಪ್ರಶ್ನೆ ಕಳುಹಿಸುವಲ್ಲಿ ದೋಷ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Error sending the current question. Please try again.',
  },
  errorOnboarding: {
    telugu: '❌ ఆన్‌బోర్డింగ్ సమయంలో లోపం. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ ऑनबोर्डिंग के दौरान त्रुटि। कृपया फिर प्रयास करें।',
    kannada: '❌ ಆನ್‌ಬೋರ್ಡಿಂಗ್ ಸಮಯದಲ್ಲಿ ದೋಷ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Error during onboarding. Please try again.',
  },
  errorSelection: {
    telugu: '❌ ఎంపిక ప్రాసెస్ చేయడంలో లోపం. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ चयन प्रोसेस करने में त्रुटि। कृपया फिर प्रयास करें।',
    kannada: '❌ ಆಯ್ಕೆ ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುವಲ್ಲಿ ದೋಷ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Error processing selection. Please try again.',
  },
  errorPreference: {
    telugu: '❌ ప్రాధాన్యత సెట్ చేయడంలో విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    hindi: '❌ प्राथमिकता सेट करने में विफल। कृपया फिर प्रयास करें।',
    kannada: '❌ ಆದ್ಯತೆ ಹೊಂದಿಸಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    english: '❌ Failed to set preference. Please try again.',
  },
};

const getLocalizedSurveyMessage = (key, lang = 'english', replacements = {}) => {
  const langNorm = String(lang || 'english').toLowerCase();
  const msgs = SURVEY_MESSAGES[key];
  if (!msgs) return '';
  let msg = msgs[langNorm] || msgs.english || '';
  for (const [k, v] of Object.entries(replacements)) {
    msg = msg.replace(`{${k}}`, v);
  }
  return msg;
};

const SECTION_TITLE = {
  telugu: 'ఎంపికలు',
  hindi: 'विकल्प',
  kannada: 'ಆಯ್ಕೆಗಳು',
  english: 'Options',
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
let warnedLegacyTemplateEnvKey = false;

const TWILIO_API_BASE_URL = process.env.TWILIO_API_BASE_URL || 'https://api.twilio.com';

const getTwilioConfig = () => ({
  accountSid: String(process.env.TWILIO_ACCOUNT_SID || '').trim(),
  authToken: String(process.env.TWILIO_AUTH_TOKEN || '').trim(),
  fromNumber: String(process.env.TWILIO_PHONE_NUMBER || '').trim(),
  voiceWebhookBaseUrl: String(
    process.env.TWILIO_VOICE_WEBHOOK_BASE_URL
    || process.env.WHATSAPP_WEBHOOK_URL
    || process.env.SERVER_PUBLIC_BASE_URL
    || ''
  ).trim(),
});

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

const buildTwilioVoiceWebhookUrl = (step, phoneNumber, surveyId = DEFAULT_SURVEY_ID) => {
  const config = getTwilioConfig();
  const base = normalizeBaseUrl(config.voiceWebhookBaseUrl);
  if (!base) return '';

  const url = new URL(`${base}/voice/twilio/${step}`);
  url.searchParams.set('phone', String(phoneNumber || ''));
  url.searchParams.set('surveyId', normalizeSurveyId(surveyId));
  return url.toString();
};

const xmlEscape = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const getTwilioLanguage = (preferredLanguage = 'english') => {
  const lang = String(preferredLanguage || 'english').toLowerCase();
  const map = {
    english: 'en-IN',
    hindi: 'hi-IN',
    telugu: 'te-IN',
    kannada: 'kn-IN',
  };
  return map[lang] || 'en-IN';
};

// Twilio's built-in <Gather speech> STT works reliably only for some languages.
// For unreliable languages, we use DTMF-only Gather and fall through to <Record>
// where server-side Sarvam/Groq STT handles speech transcription accurately.
const TWILIO_SPEECH_RELIABLE = {
  hindi: false,
  english: false,
  telugu: false,
  kannada: false,
};

const isTwilioSpeechReliable = (preferredLanguage = 'english') => {
  const lang = String(preferredLanguage || 'english').toLowerCase();
  return TWILIO_SPEECH_RELIABLE[lang] ?? false;
};

const getTwilioCallMessages = (preferredLanguage = 'english') => {
  const lang = String(preferredLanguage || 'english').toLowerCase();
  const map = {
    english: {
      retry: 'Sorry, I did not understand. Could you please repeat your answer once more.',
      complete: 'Thank you. You have completed the survey. Goodbye.',
      noQuestion: 'No active quiz question found for this call right now. Please try again in a moment. Goodbye.',
      invalidPhone: 'Invalid phone number for this quiz call. Goodbye.',
      recordPrompt: 'Please say your answer now.',
      recordTimeout: 'No voice response detected. Let us try the question again.',
      processError: 'An error occurred while processing your answer. Goodbye.',
      confirm: (optionText) => `You selected: ${optionText}.`,
    },
    hindi: {
      retry: 'क्षमा करें, मैं समझ नहीं पाया। कृपया अपना उत्तर एक बार फिर बताइए।',
      complete: 'धन्यवाद। आपने सर्वे पूरा कर लिया है। अलविदा।',
      noQuestion: 'इस कॉल के लिए अभी कोई सक्रिय प्रश्न नहीं मिला। कृपया थोड़ी देर बाद फिर प्रयास करें।',
      invalidPhone: 'इस कॉल के लिए फोन नंबर अमान्य है। अलविदा।',
      recordPrompt: 'कृपया अब अपना उत्तर बोलें।',
      recordTimeout: 'कोई आवाज़ नहीं मिली। हम प्रश्न फिर से पूछते हैं।',
      processError: 'आपके उत्तर को संसाधित करते समय त्रुटि हुई। अलविदा।',
      confirm: (optionText) => `आपने चुना: ${optionText}।`,
    },
    kannada: {
      retry: 'ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಮತ್ತೊಮ್ಮೆ ಹೇಳಬಹುದೇ.',
      complete: 'ಧನ್ಯವಾದಗಳು. ನೀವು ಸಮೀಕ್ಷೆಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಿದ್ದೀರಿ. ವಿದಾಯ.',
      noQuestion: 'ಈ ಕರೆಗಾಗಿ ಈಗ ಸಕ್ರಿಯ ಪ್ರಶ್ನೆ ದೊರಕಿಲ್ಲ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      invalidPhone: 'ಈ ಕರೆಗಾಗಿ ಫೋನ್ ಸಂಖ್ಯೆ ಅಮಾನ್ಯವಾಗಿದೆ. ವಿದಾಯ.',
      recordPrompt: 'ದಯವಿಟ್ಟು ಈಗ ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಹೇಳಿ.',
      recordTimeout: 'ಧ್ವನಿ ಪ್ರತಿಕ್ರಿಯೆ ಸಿಗಲಿಲ್ಲ. ಪ್ರಶ್ನೆಯನ್ನು ಮತ್ತೆ ಕೇಳೋಣ.',
      processError: 'ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುವಾಗ ದೋಷ ಉಂಟಾಯಿತು. ವಿದಾಯ.',
      confirm: (optionText) => `ನೀವು ಆಯ್ಕೆ ಮಾಡಿದುದು: ${optionText}.`,
    },
    telugu: {
      retry: 'క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను. దయచేసి మీ సమాధానాన్ని మరోసారి చెప్పగలరా.',
      complete: 'ధన్యవాదాలు. మీరు సర్వే పూర్తి చేశారు. వీడ్కోలు.',
      noQuestion: 'ఈ కాల్ కోసం ప్రస్తుతం యాక్టివ్ ప్రశ్న లేదు. దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.',
      invalidPhone: 'ఈ కాల్ కోసం ఫోన్ నంబర్ చెల్లదు. వీడ్కోలు.',
      recordPrompt: 'దయచేసి ఇప్పుడు మీ సమాధానం చెప్పండి.',
      recordTimeout: 'వాయిస్ స్పందన రాలేదు. ప్రశ్నను మళ్లీ అడుగుదాం.',
      processError: 'మీ సమాధానాన్ని ప్రాసెస్ చేస్తూ లోపం వచ్చింది. వీడ్కోలు.',
      confirm: (optionText) => `మీరు ఎంపిక చేసినది: ${optionText}.`,
    },
  };

  return map[lang] || map.english;
};

const buildTwilioAudioFileUrl = (audioId) => {
  const config = getTwilioConfig();
  const base = normalizeBaseUrl(config.voiceWebhookBaseUrl);
  if (!base || !audioId) return '';
  return `${base}/voice/twilio/audio/${encodeURIComponent(String(audioId))}`;
};

const isTwilioPlayableMime = (mimeType = '') => {
  const mime = String(mimeType || '').toLowerCase();
  return mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/mpeg' || mime === 'audio/mp3';
};

const createTwilioPromptAudioUrl = async (db, promptText, preferredLanguage = 'english') => {
  const twilioFormat = String(process.env.TWILIO_PROMPT_AUDIO_FORMAT || process.env.TWILIO_QUESTION_AUDIO_FORMAT || 'wav').toLowerCase();
  const result = await synthesizeText(promptText, { lang: preferredLanguage, format: twilioFormat });
  const audioCollection = getModelByCollection('audio').collection;

  await audioCollection.insertOne({
    id: result.audioId,
    fileName: result.fileName,
    filePath: result.filePath,
    mimeType: result.mimeType,
    fileSize: result.fileSize,
    source: 'twilio_tts',
    sourceText: promptText,
    lang: preferredLanguage,
    createdAt: new Date(),
    transcriptionStatus: 'not_requested',
  });

  return buildTwilioAudioFileUrl(result.audioId);
};

const resolvePreRecordedQuestionAudioUrl = async (db, question, preferredLanguage = 'english') => {
  try {
    if (!question?.id) return '';

    const lang = String(preferredLanguage || 'english').toLowerCase();
    const audioCollection = getCollection(db, 'audio');
    const existing = await audioCollection.findOne(
      { source: 'twilio_tts_question', questionId: question.id, lang },
      { sort: { createdAt: -1 } }
    );

    if (existing?.id && existing?.filePath && fs.existsSync(existing.filePath) && isTwilioPlayableMime(existing?.mimeType)) {
      return buildTwilioAudioFileUrl(existing.id);
    }

    const { prompt } = getQuestionPromptForCall(question, lang);
    const format = process.env.TWILIO_QUESTION_AUDIO_FORMAT || process.env.TWILIO_PROMPT_AUDIO_FORMAT || 'wav';
    const timeoutMs = getTwilioPromptTtsTimeoutMs();
    const result = await withTimeout(
      synthesizeText(prompt, { lang, format }),
      timeoutMs,
      `Twilio question pre-record timed out after ${timeoutMs}ms`
    );

    await audioCollection.insertOne({
      id: result.audioId,
      fileName: result.fileName,
      filePath: result.filePath,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
      source: 'twilio_tts_question',
      sourceText: prompt,
      lang,
      questionId: question.id,
      createdAt: new Date(),
      transcriptionStatus: 'not_requested',
    });

    return buildTwilioAudioFileUrl(result.audioId);
  } catch (error) {
    console.warn('⚠️ Twilio question pre-record unavailable; falling back to live or <Say>:', error?.message || error);
    return '';
  }
};

const buildTwilioQuestionPrompt = (question, preferredLanguage = 'english') => {
  const { prompt } = getQuestionPromptForCall(question, preferredLanguage);
  return prompt;
};

const ensureTwilioQuestionAudioCached = async (db, question, preferredLanguage = 'english', ownerUserId = null, surveyId = DEFAULT_SURVEY_ID) => {
  if (!question?.id) return null;

  const lang = String(preferredLanguage || 'english').toLowerCase();
  const audioCollection = getCollection(db, 'audio');

  const existing = await audioCollection.findOne(
    { source: 'twilio_tts_question', questionId: question.id, lang, ...(ownerUserId ? { ownerUserId } : {}), ...buildSurveyMatch(surveyId) },
    { sort: { createdAt: -1 } }
  );

  if (existing?.id && existing?.filePath && fs.existsSync(existing.filePath) && isTwilioPlayableMime(existing?.mimeType)) {
    return existing.id;
  }

  const format = process.env.TWILIO_QUESTION_AUDIO_FORMAT || process.env.TWILIO_PROMPT_AUDIO_FORMAT || 'wav';
  const timeoutMs = Number(process.env.TWILIO_PREWARM_TTS_TIMEOUT_MS || 30000);
  const prompt = buildTwilioQuestionPrompt(question, lang);

  const result = await withTimeout(
    synthesizeText(prompt, { lang, format }),
    timeoutMs,
    `Twilio question prewarm timed out after ${timeoutMs}ms`
  );

  await audioCollection.insertOne({
    id: result.audioId,
    fileName: result.fileName,
    filePath: result.filePath,
    mimeType: result.mimeType,
    fileSize: result.fileSize,
    source: 'twilio_tts_question',
    sourceText: prompt,
    lang,
    questionId: question.id,
    ...(ownerUserId ? { ownerUserId } : {}),
    surveyId: normalizeSurveyId(surveyId),
    createdAt: new Date(),
    transcriptionStatus: 'not_requested',
  });

  return result.audioId;
};

const prewarmTwilioQuestionAudioCache = async (db, surveyId = DEFAULT_SURVEY_ID, ownerUserId = null, preferredLanguage = 'english') => {
  try {
    const normalizedSurveyId = normalizeSurveyId(surveyId);
    const lang = String(preferredLanguage || 'english').toLowerCase();
    const maxQuestions = Math.max(1, Math.min(Number(process.env.TWILIO_PREWARM_MAX_QUESTIONS || 25), 100));
    const questions = getCollection(db, 'questions');

    let docs = await questions
      .find({ ...(ownerUserId ? { ownerUserId } : {}), ...buildSurveyMatch(normalizedSurveyId) })
      .sort({ sequence: 1 })
      .limit(maxQuestions)
      .toArray();

    if ((!docs || docs.length === 0) && ownerUserId) {
      docs = await questions
        .find({ ...buildSurveyMatch(normalizedSurveyId) })
        .sort({ sequence: 1 })
        .limit(maxQuestions)
        .toArray();
    }

    if (!docs || docs.length === 0) {
      console.warn(`⚠️ Twilio prewarm skipped: no questions found for survey=${normalizedSurveyId}`);
      return;
    }

    for (const question of docs) {
      try {
        await ensureTwilioQuestionAudioCached(db, question, lang, ownerUserId, normalizedSurveyId);
      } catch (err) {
        console.warn(`⚠️ Twilio prewarm failed for question=${question?.id}:`, err?.message || err);
      }
    }

    console.log(`✅ Twilio question audio prewarm completed for survey=${normalizedSurveyId} lang=${lang} count=${docs.length}`);
  } catch (error) {
    console.warn('⚠️ Twilio prewarm failed:', error?.message || error);
  }
};

const getTwilioPromptTtsTimeoutMs = () => Number(process.env.TWILIO_PROMPT_TTS_TIMEOUT_MS || 7000);
const getTwilioRecordSttTimeoutMs = () => Number(process.env.TWILIO_RECORD_STT_TIMEOUT_MS || 15000);

const withTimeout = (promise, timeoutMs, timeoutMessage = 'operation timeout') => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  promise
    .then((value) => {
      clearTimeout(timer);
      resolve(value);
    })
    .catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
});

const safeCreateTwilioPromptAudioUrl = async (db, promptText, preferredLanguage = 'english') => {
  try {
    const timeoutMs = getTwilioPromptTtsTimeoutMs();
    return await withTimeout(
      createTwilioPromptAudioUrl(db, promptText, preferredLanguage),
      timeoutMs,
      `Twilio prompt TTS timed out after ${timeoutMs}ms`
    );
  } catch (ttsErr) {
    console.warn('⚠️ Twilio prompt TTS unavailable; using <Say> fallback:', ttsErr?.message || ttsErr);
    return '';
  }
};

const fetchTwilioRecordingBuffer = async (recordingUrl) => {
  const config = getTwilioConfig();
  const safeUrl = String(recordingUrl || '').trim();
  if (!safeUrl) throw new Error('Missing Twilio RecordingUrl');
  const url = safeUrl.endsWith('.wav') ? safeUrl : `${safeUrl}.wav`;

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    auth: {
      username: config.accountSid,
      password: config.authToken,
    },
    timeout: 60000,
  });

  return Buffer.from(response.data || []);
};

const getLocalizedNumberWord = (lang = 'english', index = 0) => {
  const words = {
    telugu: ['ఒకటి', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిది', 'తొమ్మిది', 'పది'],
    hindi: ['एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ', 'नौ', 'दस'],
    kannada: ['ಒಂದು', 'ಎರಡು', 'ಮೂರು', 'ನಾಲ್ಕು', 'ಐದು', 'ಆರು', 'ಏಳು', 'ಎಂಟು', 'ಒಂಬತ್ತು', 'ಹತ್ತು'],
    english: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
  };

  const list = words[String(lang || 'english').toLowerCase()] || words.english;
  return list[index] || String(index + 1);
};

// ── TTS Prompt sanitizer ──
// Converts number ranges (1-2, 3-5) to spoken forms, removes brackets, cleans slashes
const RANGE_WORDS = {
  telugu: { to: 'నుండి', moreThan: 'కంటే ఎక్కువ', orMore: 'లేదా అంతకంటే ఎక్కువ', or: 'లేదా' },
  hindi: { to: 'से', moreThan: 'से अधिक', orMore: 'या इससे अधिक', or: 'या' },
  kannada: { to: 'ರಿಂದ', moreThan: 'ಕ್ಕಿಂತ ಹೆಚ್ಚು', orMore: 'ಅಥವಾ ಹೆಚ್ಚು', or: 'ಅಥವಾ' },
  english: { to: 'to', moreThan: 'more than', orMore: 'or more', or: 'or' },
};

const digitToLocalWord = (num, lang) => {
  const words = {
    telugu: ['సున్నా', 'ఒకటి', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిది', 'తొమ్మిది', 'పది'],
    hindi: ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ', 'नौ', 'दस'],
    kannada: ['ಸೊನ್ನೆ', 'ಒಂದು', 'ಎರಡು', 'ಮೂರು', 'ನಾಲ್ಕು', 'ಐದು', 'ಆರು', 'ಏಳು', 'ಎಂಟು', 'ಒಂಬತ್ತು', 'ಹತ್ತು'],
    english: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
  };
  const list = words[lang] || words.english;
  const n = Number(num);
  return (n >= 0 && n < list.length) ? list[n] : String(num);
};

const sanitizeTtsText = (text, lang = 'english') => {
  let s = String(text || '');
  // Remove square brackets: [Brand X] → Brand X
  s = s.replace(/\[([^\]]+)\]/g, '$1');
  // Replace forward-slash separators with localized "or"
  const orWord = (RANGE_WORDS[lang] || RANGE_WORDS.english).or;
  s = s.replace(/\//g, ` ${orWord} `);
  // Convert number ranges: "1-2" → "ఒకటి నుండి రెండు" etc.
  const rw = RANGE_WORDS[lang] || RANGE_WORDS.english;
  s = s.replace(/(\d+)\s*[-–—]\s*(\d+)/g, (_, a, b) => {
    return `${digitToLocalWord(a, lang)} ${rw.to} ${digitToLocalWord(b, lang)}`;
  });
  // Clean up multiple spaces
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
};

const buildBilingualQuestionText = (question, preferredLanguage = 'english') => {
  const lang = String(preferredLanguage || 'english').toLowerCase();
  const localText = String(question?.[`text_${lang}`] || '').trim();
  const englishText = String(question?.text || question?.text_english || '').trim();

  if (lang === 'english') return englishText || localText;
  // Return native language text only; fall back to English if native text is missing
  return localText || englishText;
};

const getLocalizedOptionWord = (lang = 'english') => {
  const map = {
    telugu: 'ఎంపిక',
    hindi: 'विकल्प',
    kannada: 'ಆಯ್ಕೆ',
    english: 'Option',
  };
  return map[String(lang || 'english').toLowerCase()] || map.english;
};

const getLocalizedCallInstruction = (lang = 'english') => {
  const map = {
    telugu: 'దయచేసి ఎంపిక నంబర్ నొక్కండి, లేదా మీ సమాధానం చెప్పండి.',
    hindi: 'कृपया विकल्प संख्या दबाएं, या अपना उत्तर बोलें.',
    kannada: 'ದಯವಿಟ್ಟು ಆಯ್ಕೆ ಸಂಖ್ಯೆಯನ್ನು ಒತ್ತಿ, ಅಥವಾ ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಹೇಳಿ.',
    english: 'Please press the option number, or say your answer.',
  };
  return map[String(lang || 'english').toLowerCase()] || map.english;
};

const buildBilingualOptionsForSpeech = (question, preferredLanguage = 'english') => {
  const lang = String(preferredLanguage || 'english').toLowerCase();
  const localizedOptions = Array.isArray(question?.[`options_${lang}`]) && question[`options_${lang}`].length > 0
    ? question[`options_${lang}`]
    : (Array.isArray(question?.options) ? question.options : []);

  const optionWord = getLocalizedOptionWord(lang);
  return localizedOptions.map((localOption, index) => {
    // Sanitize option text for TTS pronunciation
    const localOptionText = sanitizeTtsText(String(localOption || '').trim(), lang);
    const num = index + 1;
    const localNumWord = getLocalizedNumberWord(lang, index);

    if (lang === 'english') {
      return `${optionWord} ${num}, ${localOptionText}`;
    }

    // Speak entirely in the selected native language (no English words)
    return `${optionWord} ${localNumWord}, ${localOptionText}`;
  });
};

const getQuestionPromptForCall = (question, preferredLanguage = 'english') => {
  const lang = (preferredLanguage || 'english').toLowerCase();
  // Sanitize question text for TTS
  const questionText = sanitizeTtsText(buildBilingualQuestionText(question, lang), lang);
  const options = Array.isArray(question?.[`options_${lang}`]) && question[`options_${lang}`].length > 0
    ? question[`options_${lang}`]
    : (Array.isArray(question?.options) ? question.options : []);

  const optionSpeech = buildBilingualOptionsForSpeech(question, lang).join('. ');
  const instruction = getLocalizedCallInstruction(lang);
  const prompt = `${questionText}. ${optionSpeech}. ${instruction}`;

  // Build speech hints with both English and localized options for better Twilio recognition
  const englishOptions = Array.isArray(question?.options) ? question.options : [];
  const localizedOpts = Array.isArray(question?.[`options_${lang}`]) && question[`options_${lang}`].length > 0
    ? question[`options_${lang}`]
    : englishOptions;
  const hintParts = [];
  for (let i = 0; i < Math.max(englishOptions.length, localizedOpts.length); i++) {
    hintParts.push(String(i + 1));
    if (localizedOpts[i]) hintParts.push(String(localizedOpts[i]).trim());
    if (englishOptions[i] && englishOptions[i] !== localizedOpts[i]) hintParts.push(String(englishOptions[i]).trim());
    // Add localized number words as hints (e.g., "ek", "do" for Hindi)
    const numWord = getLocalizedNumberWord(lang, i);
    if (numWord) hintParts.push(numWord);
  }
  const speechHints = hintParts.join(', ');
  return { prompt, options: localizedOpts, speechHints };
};

const renderGatherTwiml = ({
  questionPrompt,
  actionUrl,
  recordUrl,
  promptAudioUrl = '',
  confirmationMessage = '',
  fallbackNoInputMessage = 'We did not receive your answer. Let us try once more.',
  language = 'en-IN',
  speechHints = '',
  optionCount = 0,
  speechReliable = true,
}) => {
  const langAttr = ` language="${xmlEscape(language)}"`;
  const intro = confirmationMessage ? `  <Say${langAttr}>${xmlEscape(confirmationMessage)}</Say>\n  <Pause length="1"/>\n` : '';
  const promptNode = promptAudioUrl
    ? `    <Play>${xmlEscape(promptAudioUrl)}</Play>`
    : `    <Say${langAttr}>${xmlEscape(questionPrompt)}</Say>`;

  // When Twilio speech STT is unreliable for this language, use DTMF-only Gather
  // with a shorter timeout, then fall through to <Record> for server-side STT
  const gatherInput = speechReliable ? 'dtmf speech' : 'dtmf';
  const gatherTimeout = speechReliable ? 8 : 2;
  const hintsAttr = (speechReliable && speechHints) ? ` hints="${xmlEscape(speechHints)}"` : '';
  const speechTimeoutAttr = speechReliable ? ' speechTimeout="5"' : '';
  // Dynamic numDigits: 1 for ≤9 options, 2 for 10+ — eliminates the 7-second DTMF timeout delay
  const numDigitsAttr = optionCount > 0 ? ` numDigits="${optionCount <= 9 ? 1 : 2}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${intro}  <Gather input="${gatherInput}" timeout="${gatherTimeout}"${speechTimeoutAttr} language="${xmlEscape(language)}" action="${xmlEscape(actionUrl)}" method="POST"${hintsAttr}${numDigitsAttr}>\n${promptNode}\n  </Gather>\n  <Say${langAttr}>${xmlEscape(fallbackNoInputMessage)}</Say>\n  <Redirect method="POST">${xmlEscape(recordUrl)}</Redirect>\n</Response>`;
};

const renderRecordTwiml = ({ actionUrl, recordPrompt = 'Please say your answer now.', noRecordingMessage = 'Sorry, no recording was captured.', language = 'en-IN' }) => {
  const langAttr = ` language="${xmlEscape(language)}"`;
  // The farmer already heard the question in the <Gather> TwiML — only say the record prompt here
  // timeout=5 (seconds of silence before auto-stop), maxLength=10 (max recording duration)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say${langAttr}>${xmlEscape(recordPrompt)}</Say>\n  <Record action="${xmlEscape(actionUrl)}" method="POST" playBeep="true" timeout="5" maxLength="10" recordingStatusCallbackEvent="completed"/>\n  <Say${langAttr}>${xmlEscape(noRecordingMessage)}</Say>\n  <Redirect method="POST">${xmlEscape(actionUrl.replace('/record?', '/answer?'))}</Redirect>\n</Response>`;
};

const renderSayTwiml = (message, language = 'en-IN') => {
  const langAttr = ` language="${xmlEscape(language)}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say${langAttr}>${xmlEscape(message)}</Say>\n</Response>`;
};

const renderCompletionTwiml = (message, language = 'en-IN') => {
  const langAttr = ` language="${xmlEscape(language)}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say${langAttr}>${xmlEscape(message)}</Say>\n  <Hangup/>\n</Response>`;
};

const processTwilioSelectedAnswer = async ({
  db,
  phoneNumber,
  surveyId,
  activeSession,
  currentQuestion,
  selectedOptionIndex,
  preferredLanguage,
  confirmationMessage = '',
}) => {
  const messages = getTwilioCallMessages(preferredLanguage);
  const { sessionId, ownerUserId } = activeSession;
  await saveAnswer(db, phoneNumber, sessionId, currentQuestion.id, selectedOptionIndex, ownerUserId || null, surveyId);

  if (currentQuestion.id === 'Q_LOCATION') {
    try {
      const selectedRegionText = currentQuestion.options[selectedOptionIndex] || '';
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
    } catch (regionErr) {
      console.warn('⚠️ Failed to update region from call response:', regionErr?.message || regionErr);
    }
  }

  const nextQuestion = await getNextQuestion(db, currentQuestion.id, selectedOptionIndex, ownerUserId || null, surveyId);
  if (!nextQuestion) {
    await completeSession(db, phoneNumber, sessionId);
    return renderCompletionTwiml(messages.complete, getTwilioLanguage(preferredLanguage));
  }

  const gatherActionUrl = buildTwilioVoiceWebhookUrl('gather', phoneNumber, surveyId);
  const recordActionUrl = buildTwilioVoiceWebhookUrl('record', phoneNumber, surveyId);
  const { prompt, speechHints: speechHintsStr } = getQuestionPromptForCall(nextQuestion, preferredLanguage);

  let promptAudioUrl = await resolvePreRecordedQuestionAudioUrl(db, nextQuestion, preferredLanguage);
  if (!promptAudioUrl) {
    promptAudioUrl = await safeCreateTwilioPromptAudioUrl(db, prompt, preferredLanguage);
  }

  return renderGatherTwiml({
    questionPrompt: prompt,
    actionUrl: gatherActionUrl,
    recordUrl: recordActionUrl,
    promptAudioUrl,
    confirmationMessage,
    fallbackNoInputMessage: messages.recordTimeout,
    language: getTwilioLanguage(preferredLanguage),
    speechHints: speechHintsStr,
    optionCount: nextQuestion.options?.length || 0,
    speechReliable: isTwilioSpeechReliable(preferredLanguage),
  });
};

const initiateTwilioQuizCall = async (phoneNumber, surveyId = DEFAULT_SURVEY_ID) => {
  const config = getTwilioConfig();
  const to = normalizePhoneNumber(phoneNumber);
  const answerUrl = buildTwilioVoiceWebhookUrl('answer', to, surveyId);

  if (!to) {
    throw new AppError('Invalid destination phone number for Twilio call', 400);
  }

  if (!config.accountSid || !config.authToken || !config.fromNumber || !answerUrl) {
    throw new AppError('Twilio is not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and TWILIO_VOICE_WEBHOOK_BASE_URL.', 400);
  }

  const endpoint = `${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${config.accountSid}/Calls.json`;
  const payload = new URLSearchParams({
    To: to,
    From: config.fromNumber,
    Url: answerUrl,
    Method: 'POST',
  });

  const response = await axios.post(endpoint, payload.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    auth: {
      username: config.accountSid,
      password: config.authToken,
    },
    timeout: 15000,
  });

  return {
    callSid: response.data?.sid || null,
    status: response.data?.status || 'queued',
  };
};

const getInviteTemplateName = () => {
  const primary = String(process.env.WHATSAPP_INVITE_TEMPLATE_NAME || '').trim();
  if (primary) return primary;

  const legacyTypoKey = String(process.env.WHATSAPP_INVITE_TEEMPLATE_NAME || '').trim();
  if (legacyTypoKey) {
    if (!warnedLegacyTemplateEnvKey) {
      console.warn('⚠️ Detected legacy env key WHATSAPP_INVITE_TEEMPLATE_NAME. Please rename to WHATSAPP_INVITE_TEMPLATE_NAME.');
      warnedLegacyTemplateEnvKey = true;
    }
    return legacyTypoKey;
  }

  return '';
};

const getInviteTemplateLang = () => String(process.env.WHATSAPP_INVITE_TEMPLATE_LANG || 'en_US').trim() || 'en_US';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const createInviteJobId = () => `invite_job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const isReEngagementError = (error) => {
  const code = Number(error?.response?.data?.error?.code || 0);
  const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
  return isReEngagementErrorCode(code, message);
};

const recordTemplateRecovery = async (db, phoneNumber, templateResult) => {
  const farmers = getCollection(db, 'farmers');
  if (templateResult?.sent) {
    await farmers.updateOne(
      { phoneNumber },
      {
        $set: {
          lastInviteRecovery: 'template_fallback_sent',
          lastInviteRecoveryAt: new Date(),
          lastInviteRecoveryTemplate: templateResult.templateName || null,
          lastInviteRecoveryMessageId: templateResult.messageId || null,
        },
      },
      { upsert: true }
    );
    return;
  }

  await farmers.updateOne(
    { phoneNumber },
    {
      $set: {
        lastInviteRecovery: `template_fallback_skipped:${templateResult?.reason || 'unknown'}`,
        lastInviteRecoveryAt: new Date(),
      },
    },
    { upsert: true }
  );
};

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
      if (isReEngagementError(err)) {
        const templateResult = await sendInviteTemplateMessage(targetPhone);
        await recordTemplateRecovery(db, targetPhone, templateResult);

        if (templateResult?.sent) {
          return {
            success: true,
            phoneNumber: targetPhone,
            message: 'Invite sent using approved template (recipient outside 24-hour window).',
          };
        }

        throw new AppError(
          'Invite failed: recipient is outside WhatsApp 24-hour window and no approved template fallback is configured. Set WHATSAPP_INVITE_TEMPLATE_NAME in backend/.env.',
          400
        );
      }

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
        if (isReEngagementError(err)) {
          const templateResult = await sendInviteTemplateMessage(targetPhone);
          await recordTemplateRecovery(db, targetPhone, templateResult);

          if (templateResult?.sent) {
            return {
              success: true,
              phoneNumber: targetPhone,
              message: 'Invite sent using approved template (recipient outside 24-hour window).',
            };
          }

          throw new AppError(
            'Invite failed: recipient is outside WhatsApp 24-hour window and no approved template fallback is configured. Set WHATSAPP_INVITE_TEMPLATE_NAME in backend/.env.',
            400
          );
        }

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
          return res.status(200).json({ success: true });
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
            return res.status(200).json({ success: true });
          }

          // Support numeric fallback for language selection (1=Telugu,2=Hindi,3=Kannada,4=English)
          if (/^[1-4]$/.test(rawText)) {
            const mapping = { '1': 'telugu', '2': 'hindi', '3': 'kannada', '4': 'english' };
            const langToken = mapping[rawText];
            if (langToken) {
              await handleLanguageSelection(db, phoneNumber, langToken);
              return res.status(200).json({ success: true });
            }
          }

          await sendIntroductionMessage(phoneNumber);
          return res.status(200).json({ success: true });
        }

        // Accept typed mode selection keywords from returning farmers (e.g., "audio", "voice", "text")
        const lower = rawText.trim().toLowerCase();
        if (lower.includes('audio') || lower.includes('voice')) {
          await handleModeSelection(db, phoneNumber, 'audio');
          return res.status(200).json({ success: true });
        }
        if (lower.includes('text') || lower.includes('type')) {
          await handleModeSelection(db, phoneNumber, 'text');
          return res.status(200).json({ success: true });
        }
        if (lower.includes('call') || lower.includes('phone call')) {
          await handleQuizChannelSelection(db, phoneNumber, 'call');
          return res.status(200).json({ success: true });
        }
        if (lower.includes('whatsapp') || lower.includes('chat')) {
          await handleQuizChannelSelection(db, phoneNumber, 'whatsapp');
          return res.status(200).json({ success: true });
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
        return res.status(200).json({ success: true });
      }

      // Language selection replies have ids like 'lang_telugu', 'lang_hindi'
      if (replyId.startsWith('lang_')) {
        const langToken = replyId.replace('lang_', '');
        await handleLanguageSelection(db, phoneNumber, langToken);
        return res.status(200).json({ success: true });
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

// Normalize option text for fuzzy matching: remove brackets, extra spaces, lowercase
// Note: slashes are preserved initially so we can split compound options (Brand X/Y/Z) later
const normalizeForMatching = (text) => {
  return String(text || '')
    .replace(/\[|\]/g, '')       // remove brackets
    .replace(/[-–—]/g, ' ')       // dashes → space
    .replace(/\s+/g, ' ')         // collapse whitespace
    .trim()
    .toLowerCase();
};

/**
 * Split compound options containing / into individual alternatives.
 * E.g., "Brand X/Y/Z" → ["brand x", "brand y", "brand z", "brand x/y/z"]
 * E.g., "Urea / DAP" → ["urea", "dap", "urea / dap"]
 */
const expandSlashAlternatives = (optionText) => {
  const normalized = normalizeForMatching(optionText);
  const alternatives = [normalized.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim()]; // the full option with slashes as spaces

  // Also add the original as-is (with slashes removed)
  if (normalized.includes('/')) {
    const parts = normalized.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      // Find the common prefix before the slash-separated part
      // E.g., "brand x/y/z" → prefix could be "brand " if parts are "brand x", "y", "z"
      // Simple heuristic: if first part has spaces and others don't, extract prefix
      const firstWords = parts[0].split(/\s+/);
      if (firstWords.length > 1 && parts.slice(1).every(p => !p.includes(' '))) {
        // "brand x", "y", "z" → prefix "brand", suffix alternatives: "x", "y", "z"
        const prefix = firstWords.slice(0, -1).join(' ');
        const firstSuffix = firstWords[firstWords.length - 1];
        alternatives.push(...[firstSuffix, ...parts.slice(1)].map(s => `${prefix} ${s}`));
        // Also add bare suffixes for matching (e.g., just "x", "y", "z")
        alternatives.push(firstSuffix, ...parts.slice(1));
      } else {
        // Each part is a full alternative, e.g., "urea / dap"
        alternatives.push(...parts);
      }
    }
  }
  return [...new Set(alternatives)].filter(Boolean);
};

const resolveCallOptionIndex = (question, speechResult, digits, preferredLanguage = 'english') => {
  const options = Array.isArray(question?.options) ? question.options : [];
  if (options.length === 0) return -1;

  // Resolve localized options too for speech matching
  const lang = (preferredLanguage || 'english').toLowerCase();
  const localizedOptions = Array.isArray(question?.[`options_${lang}`]) && question[`options_${lang}`].length > 0
    ? question[`options_${lang}`]
    : options;

  const rawDigits = String(digits || '').trim();
  if (/^\d+$/.test(rawDigits)) {
    const selected = Number(rawDigits);
    if (selected >= 1 && selected <= options.length) {
      return selected - 1;
    }
  }

  const spoken = String(speechResult || '').trim();
  if (!spoken) return -1;

  const numeric = extractNumericOptionFromTranscript(spoken, preferredLanguage, options.length);
  if (numeric && numeric >= 1 && numeric <= options.length) {
    return numeric - 1;
  }

  const normalizedSpeech = normalizeForMatching(spoken);
  const normalizedSpeechNoSlash = normalizedSpeech.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();

  // Check localized options first (native language) — exact substring match with slash expansion
  for (let index = 0; index < localizedOptions.length; index += 1) {
    const alts = expandSlashAlternatives(localizedOptions[index]);
    if (alts.some(alt => alt && normalizedSpeechNoSlash.includes(alt))) {
      return index;
    }
    // Also check if speech is contained within any alternative (for when speech is short, e.g., just "brand x")
    if (alts.some(alt => alt && alt.length > 2 && normalizedSpeechNoSlash.includes(alt))) {
      return index;
    }
  }

  // Also check English options as fallback — exact substring match with slash expansion
  if (localizedOptions !== options) {
    for (let index = 0; index < options.length; index += 1) {
      const alts = expandSlashAlternatives(options[index]);
      if (alts.some(alt => alt && normalizedSpeechNoSlash.includes(alt))) {
        return index;
      }
    }
  }

  // Fuzzy match: convert number ranges in options to words and re-check speech
  // e.g., option "1-2 ఎకరాలు" → "ఒకటి నుండి రెండు ఎకరాలు" and see if speech contains it
  for (let index = 0; index < localizedOptions.length; index += 1) {
    const sanitized = sanitizeTtsText(String(localizedOptions[index] || ''), lang).toLowerCase();
    if (sanitized && normalizedSpeechNoSlash.includes(sanitized)) {
      return index;
    }
  }

  // Reverse fuzzy: sanitize the speech and match against raw normalized options
  const sanitizedSpeech = sanitizeTtsText(normalizedSpeechNoSlash, lang);
  for (let index = 0; index < localizedOptions.length; index += 1) {
    const alts = expandSlashAlternatives(localizedOptions[index]);
    if (alts.some(alt => alt && sanitizedSpeech.includes(alt))) {
      return index;
    }
  }

  // Partial keyword match: check if key words from the option appear in the speech
  for (let index = 0; index < localizedOptions.length; index += 1) {
    const fullText = normalizeForMatching(localizedOptions[index]).replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
    const keywords = fullText.split(/\s+/).filter(w => w.length > 2);
    if (keywords.length > 0) {
      const matchCount = keywords.filter(kw => normalizedSpeechNoSlash.includes(kw)).length;
      if (matchCount >= Math.ceil(keywords.length * 0.5)) {
        return index;
      }
    }
  }

  // Last resort: check each English option's slash-expanded alternatives against localized speech
  if (localizedOptions !== options) {
    for (let index = 0; index < options.length; index += 1) {
      const fullText = normalizeForMatching(options[index]).replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
      const keywords = fullText.split(/\s+/).filter(w => w.length > 2);
      if (keywords.length > 0) {
        const matchCount = keywords.filter(kw => normalizedSpeechNoSlash.includes(kw)).length;
        if (matchCount >= Math.ceil(keywords.length * 0.5)) {
          return index;
        }
      }
    }
  }

  return -1;
};

export const twilioVoiceAnswer = async (req, res) => {
  const db = req.app.locals.mongoDb;

  try {
    const phoneNumber = normalizePhoneNumber(req.query.phone || req.body?.To || req.body?.Caller || req.body?.CallTo);
    const surveyId = normalizeSurveyId(req.query.surveyId || DEFAULT_SURVEY_ID);

    if (!phoneNumber) {
      res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').invalidPhone, 'en-IN'));
      return;
    }

    const farmer = await getFarmerByPhone(db, phoneNumber);
    const ownerUserId = farmer?.ownerUserId || null;
    const preferredLanguage = farmer?.preferredLanguage || 'english';
    const twilioLang = getTwilioLanguage(preferredLanguage);

    await createSessionForFarmer(db, phoneNumber, surveyId, ownerUserId);
    const activeSession = await getActiveSession(db, phoneNumber, surveyId);
    const currentQuestion = activeSession?.currentQuestion;
    const messages = getTwilioCallMessages(preferredLanguage);

    if (!activeSession || !currentQuestion) {
      res.type('text/xml').status(200).send(renderCompletionTwiml(messages.noQuestion, twilioLang));
      return;
    }

    const gatherActionUrl = buildTwilioVoiceWebhookUrl('gather', phoneNumber, surveyId);
    const recordActionUrl = buildTwilioVoiceWebhookUrl('record', phoneNumber, surveyId);
    const { prompt, speechHints: speechHintsStr } = getQuestionPromptForCall(currentQuestion, preferredLanguage);

    let promptAudioUrl = await resolvePreRecordedQuestionAudioUrl(db, currentQuestion, preferredLanguage);
    if (!promptAudioUrl) {
      promptAudioUrl = await safeCreateTwilioPromptAudioUrl(db, prompt, preferredLanguage);
    }

    const speechReliable = isTwilioSpeechReliable(preferredLanguage);
    console.log(`📞 Twilio voice answer: phone=${phoneNumber} lang=${preferredLanguage} speechReliable=${speechReliable}`);

    res.type('text/xml').status(200).send(
      renderGatherTwiml({
        questionPrompt: prompt,
        actionUrl: gatherActionUrl,
        recordUrl: recordActionUrl,
        promptAudioUrl,
        fallbackNoInputMessage: messages.recordTimeout,
        language: getTwilioLanguage(preferredLanguage),
        speechHints: speechHintsStr,
        optionCount: currentQuestion.options?.length || 0,
        speechReliable,
      })
    );
  } catch (error) {
    console.error('❌ Twilio voice answer handler failed:', error?.message || error);
    res.type('text/xml').status(200).send(renderCompletionTwiml('An error occurred while starting your quiz call. Please try again later.', 'en-IN'));
  }
};

export const twilioVoiceGather = async (req, res) => {
  const db = req.app.locals.mongoDb;

  try {
    const phoneNumber = normalizePhoneNumber(req.query.phone || req.body?.To || req.body?.Caller || req.body?.CallTo);
    const surveyId = normalizeSurveyId(req.query.surveyId || DEFAULT_SURVEY_ID);
    const digits = req.body?.Digits || '';
    const speechResult = req.body?.SpeechResult || '';

    console.log(`📞 Twilio gather received: phone=${phoneNumber} digits="${digits}" speech="${speechResult}" confidence=${req.body?.Confidence || 'N/A'}`);

    if (!phoneNumber) {
      res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').invalidPhone, 'en-IN'));
      return;
    }

    const activeSession = await getActiveSession(db, phoneNumber, surveyId);
    const currentQuestion = activeSession?.currentQuestion;

    if (!activeSession || !currentQuestion) {
      res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').noQuestion, 'en-IN'));
      return;
    }

    const farmer = await getFarmerByPhone(db, phoneNumber);
    const preferredLanguage = farmer?.preferredLanguage || 'english';
    const twilioLang = getTwilioLanguage(preferredLanguage);
    const messages = getTwilioCallMessages(preferredLanguage);
    const selectedOptionIndex = resolveCallOptionIndex(currentQuestion, speechResult, digits, preferredLanguage);

    if (selectedOptionIndex < 0 || selectedOptionIndex >= (currentQuestion.options?.length || 0)) {
      const retryUrl = buildTwilioVoiceWebhookUrl('answer', phoneNumber, surveyId);
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="${xmlEscape(twilioLang)}">${xmlEscape(messages.retry)}</Say>\n  <Redirect method="POST">${xmlEscape(retryUrl)}</Redirect>\n</Response>`;
      res.type('text/xml').status(200).send(twiml);
      return;
    }

    // Skip confirmation announcement — move directly to the next question for a smoother flow
    const twiml = await processTwilioSelectedAnswer({
      db,
      phoneNumber,
      surveyId,
      activeSession,
      currentQuestion,
      selectedOptionIndex,
      preferredLanguage,
      confirmationMessage: '',
    });

    res.type('text/xml').status(200).send(twiml);
  } catch (error) {
    console.error('❌ Twilio voice gather handler failed:', error?.message || error);
    res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').processError, 'en-IN'));
  }
};

export const twilioVoiceRecord = async (req, res) => {
  const db = req.app.locals.mongoDb;

  try {
    const phoneNumber = normalizePhoneNumber(req.query.phone || req.body?.To || req.body?.Caller || req.body?.CallTo);
    const surveyId = normalizeSurveyId(req.query.surveyId || DEFAULT_SURVEY_ID);

    if (!phoneNumber) {
      res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').invalidPhone, 'en-IN'));
      return;
    }

    const activeSession = await getActiveSession(db, phoneNumber, surveyId);
    const currentQuestion = activeSession?.currentQuestion;
    if (!activeSession || !currentQuestion) {
      res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').noQuestion, 'en-IN'));
      return;
    }

    const farmer = await getFarmerByPhone(db, phoneNumber);
    const preferredLanguage = farmer?.preferredLanguage || 'english';
    const twilioLang = getTwilioLanguage(preferredLanguage);
    const messages = getTwilioCallMessages(preferredLanguage);
    const recordActionUrl = buildTwilioVoiceWebhookUrl('record', phoneNumber, surveyId);
    const retryUrl = buildTwilioVoiceWebhookUrl('answer', phoneNumber, surveyId);
    const recordingUrl = String(req.body?.RecordingUrl || '').trim();

    if (!recordingUrl) {
      // No need to replay the question — farmer already heard it in the <Gather> TwiML
      res.type('text/xml').status(200).send(
        renderRecordTwiml({
          actionUrl: recordActionUrl,
          recordPrompt: messages.recordPrompt,
          noRecordingMessage: messages.recordTimeout,
          language: twilioLang,
        })
      );
      return;
    }

    const sttProvider = String(process.env.STT_PROVIDER || 'sarvam').toLowerCase();
    if (sttProvider !== 'groq' && sttProvider !== 'sarvam') {
      throw new Error('Twilio call STT requires STT_PROVIDER=groq or STT_PROVIDER=sarvam');
    }

    const audioBuffer = await fetchTwilioRecordingBuffer(recordingUrl);
    const upload = await storeUploadedFile(
      db,
      audioBuffer,
      `twilio_call_${req.body?.CallSid || Date.now()}.wav`,
      'audio/wav',
      {
        phoneNumber,
        sessionId: activeSession.sessionId,
        questionId: currentQuestion.id,
        source: 'twilio_call',
        twilioCallSid: req.body?.CallSid || null,
      }
    );

    // Pass the farmer's preferred language to STT for accurate transcription
    const transcriptionResult = await withTimeout(
      transcribeAudio(db, upload.audioId, preferredLanguage),
      getTwilioRecordSttTimeoutMs(),
      `Twilio record STT timed out after ${getTwilioRecordSttTimeoutMs()}ms`
    );
    const transcriptText = String(transcriptionResult?.text || '').trim();

    // Try text-based matching first
    let selectedOptionIndex = resolveCallOptionIndex(currentQuestion, transcriptText, '', preferredLanguage);

    // If text-based matching failed, try AI-based matching
    if (selectedOptionIndex < 0 || selectedOptionIndex >= (currentQuestion.options?.length || 0)) {
      if (transcriptText) {
        try {
          console.log(`🤖 Attempting AI match for call recording: "${transcriptText}"`);
          const aiMatch = await matchVoiceToOption(transcriptText, currentQuestion);
          if (aiMatch && aiMatch.index >= 0 && aiMatch.confidence >= Number(process.env.TRANSCRIPTION_CONFIDENCE_THRESHOLD || 0.6)) {
            selectedOptionIndex = aiMatch.index;
            console.log(`✅ AI match succeeded: option=${selectedOptionIndex} confidence=${aiMatch.confidence}`);
          }
        } catch (aiErr) {
          console.warn('⚠️ AI matching failed for call recording:', aiErr?.message || aiErr);
        }
      }
    }

    if (selectedOptionIndex < 0 || selectedOptionIndex >= (currentQuestion.options?.length || 0)) {
      // Could not understand — ask to repeat in the selected language
      const didntUnderstandMsgs = {
        telugu: 'క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను. దయచేసి మీ సమాధానాన్ని మరోసారి చెప్పగలరా.',
        hindi: 'क्षमा करें, मैं समझ नहीं पाया। कृपया अपना उत्तर एक बार फिर बताइए।',
        kannada: 'ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಮತ್ತೊಮ್ಮೆ ಹೇಳಬಹುದೇ.',
        english: 'Sorry, I did not understand. Could you please repeat your answer once more.',
      };
      const retryMsg = didntUnderstandMsgs[preferredLanguage.toLowerCase()] || didntUnderstandMsgs.english;
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="${xmlEscape(twilioLang)}">${xmlEscape(retryMsg)}</Say>\n  <Redirect method="POST">${xmlEscape(retryUrl)}</Redirect>\n</Response>`;
      res.type('text/xml').status(200).send(twiml);
      return;
    }

    // Skip confirmation announcement — move directly to the next question for a smoother flow
    const twiml = await processTwilioSelectedAnswer({
      db,
      phoneNumber,
      surveyId,
      activeSession,
      currentQuestion,
      selectedOptionIndex,
      preferredLanguage,
      confirmationMessage: '',
    });

    res.type('text/xml').status(200).send(twiml);
  } catch (error) {
    console.error('❌ Twilio voice record handler failed:', error?.message || error);
    res.type('text/xml').status(200).send(renderCompletionTwiml(getTwilioCallMessages('english').processError, 'en-IN'));
  }
};

export const twilioVoiceAudioFile = async (req, res) => {
  try {
    const db = req.app.locals.mongoDb;
    const audioId = String(req.params.audioId || '').trim();
    if (!audioId) {
      return res.status(404).send('Audio not found');
    }

    const audio = await getCollection(db, 'audio').findOne({ id: audioId });
    if (!audio || !audio.filePath) {
      return res.status(404).send('Audio not found');
    }

    if (!fs.existsSync(audio.filePath)) {
      return res.status(404).send('Audio file missing');
    }

    res.setHeader('Content-Type', audio.mimeType || 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${audio.fileName || `${audioId}.wav`}"`);
    const stream = fs.createReadStream(audio.filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('❌ Twilio audio stream handler failed:', error?.message || error);
    if (!res.headersSent) res.status(500).send('Unable to stream audio');
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
      const langConfirmMsgs = {
        telugu: '✅ భాష తెలుగుకు సెట్ చేయబడింది. తెలుగులో కొనసాగుతున్నాము.',
        hindi: '✅ भाषा हिंदी में सेट की गयी। हिंदी में जारी रखते हैं।',
        kannada: '✅ ಭಾಷೆ ಕನ್ನಡಕ್ಕೆ ಹೊಂದಿಸಲಾಗಿದೆ. ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತೇವೆ.',
        english: `✅ Language set to ${explicitLanguage}. Continuing in ${explicitLanguage}.`,
      };
      await sendMessage(phoneNumber, langConfirmMsgs[preferredLanguage] || langConfirmMsgs.english);
    }

    await startSurvey(db, phoneNumber, farmer, farmer?.region, preferredLanguage, !!explicitLanguage, targetSurveyId);
  } catch (error) {
    console.error('❌ Error handling START message:', error.message);
    const errLangOnboard = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorOnboarding', errLangOnboard));
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
  setTimeout(() => {
    startNewSession(db, phoneNumber, targetSurveyId).catch((err) => {
      console.error(`❌ startNewSession failed for ${phoneNumber}:`, err.message || err);
    });
  }, 1000);
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
    const errLangStart = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorStarting', errLangStart));
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
    const errLangQ = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorSendingQuestion', errLangQ));
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
        const farmerLangNoSession = (await getFarmerByPhone(db, phoneNumber))?.preferredLanguage || 'english';
        await sendMessage(phoneNumber, getLocalizedSurveyMessage('noActiveSession', farmerLangNoSession));
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
        const farmerLangNoQ = (await getFarmerByPhone(db, phoneNumber))?.preferredLanguage || 'english';
        await sendMessage(phoneNumber, getLocalizedSurveyMessage('noActiveQuestion', farmerLangNoQ));
        return;
      }
    }

    // Validate option is within range
    if (selectedOption < 1 || selectedOption > currentQ.options.length) {
      const farmerLang = (await getFarmerByPhone(db, phoneNumber))?.preferredLanguage || 'english';
      await sendMessage(
        phoneNumber,
        getLocalizedSurveyMessage('invalidOption', farmerLang, { n: currentQ.options.length })
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

    // Send short confirmation message in the selected language
    const farmerLangForConfirm = (await getFarmerByPhone(db, phoneNumber))?.preferredLanguage || 'english';
    const confirmLang = farmerLangForConfirm.toLowerCase();
    const localizedOptsForConfirm = Array.isArray(currentQ?.[`options_${confirmLang}`]) && currentQ[`options_${confirmLang}`].length > 0
      ? currentQ[`options_${confirmLang}`]
      : currentQ.options;
    const localizedSelectedText = localizedOptsForConfirm[selectedIdx] || selectedText;
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('answerConfirm', farmerLangForConfirm, { answer: localizedSelectedText }));

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
      // Small delay so the confirmation message arrives before the next question
      await new Promise(resolve => setTimeout(resolve, 800));
      // Send next question
      const farmer = await getFarmerByPhone(db, phoneNumber);
      const preferredLanguage = farmer?.preferredLanguage || 'english';
      await sendQuestionMessage(db, phoneNumber, nextQ, preferredLanguage);
      console.log(`📝 Sent next question: ${nextQ.id} (lang=${preferredLanguage})`);
    } else {
      // Survey completed
      await completeSession(db, phoneNumber, sessionId);
      const completeLang = (await getFarmerByPhone(db, phoneNumber))?.preferredLanguage || 'english';
      await sendMessage(
        phoneNumber,
        getLocalizedSurveyMessage('surveyComplete', completeLang)
      );
    }
  } catch (error) {
    console.error('❌ Error handling MCQ response:', error.message);
    const errLang = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorProcessing', errLang));
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
      const farmerLangAudio = (await getFarmerByPhone(db, phoneNumber))?.preferredLanguage || 'english';
      await sendMessage(phoneNumber, getLocalizedSurveyMessage('audioNoMediaId', farmerLangAudio));
      return;
    }

    // Determine response mode early
    const farmer = await getFarmerByPhone(db, phoneNumber);
    const responseMode = farmer?.responseMode || 'text';
    const preferredLanguage = (farmer?.preferredLanguage || 'english').toLowerCase();

    // Store the audio file — skip background auto-transcription since we handle it here
    const audioMeta = await storeAudioFile(db, mediaId, {
      phoneNumber,
      sessionId,
      questionId: currentQuestion.id,
      timestamp: message.timestamp,
    }, { skipAutoTranscription: true });

    // ── Always transcribe the voice note (both text and audio mode) ──
    const processingMsgs = {
      telugu: '🔄 మీ వాయిస్ నోట్‌ను ప్రాసెస్ చేయడం...',
      hindi: '🔄 आपका वॉइस नोट प्रॉसेस किया जा रहा है...',
      kannada: '🔄 ನಿಮ್ಮ ವಾಯ್ಸ್ ನೋಟನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಲಾಗುತ್ತಿದೆ...',
      english: '🔄 Processing your voice note...',
    };
    const processingMsg = processingMsgs[preferredLanguage] || processingMsgs.english;
    await sendMessage(phoneNumber, processingMsg);

    let transcriptText = null;
    let matchFromTranscription = null;
    try {
      const { transcribeAudio: transcribeAudioFn } = await import('../services/audioService.js');
      // Pass the farmer's preferred language for accurate STT transcription
      const result = await transcribeAudioFn(db, audioMeta.audioId, preferredLanguage);
      transcriptText = result?.text || null;
      matchFromTranscription = result?.match || null;
    } catch (err) {
      console.error('❌ STT transcription failed:', err.message || err);
    }

    if (!transcriptText && !matchFromTranscription) {
      // Transcription failed — save a pending voice answer and ask user to retry or type number
      await saveVoiceAnswer(db, phoneNumber, sessionId, currentQuestion.id, audioMeta.audioId, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);
      const failedMsgs = {
        telugu: '⚠️ క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను. దయచేసి మీ సమాధానాన్ని మరోసారి చెప్పగలరా, లేదా ఎంపిక సంఖ్యతో జవాబు చెప్పండి.',
        hindi: '⚠️ क्षमा करें, मैं समझ नहीं पाया। कृपया अपना उत्तर एक बार फिर से बताइए, या विकल्प संख्या भेजें।',
        kannada: '⚠️ ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಮತ್ತೊಮ್ಮೆ ಹೇಳಬಹುದೇ, ಅಥವಾ ಆಯ್ಕೆ ಸಂಖ್ಯೆಗಳನ್ನು ಕಳುಹಿಸಿ.',
        english: '⚠️ Sorry, I didn\'t understand. Could you please repeat your answer once more, or reply with the option number.',
      };
      const fm = failedMsgs[preferredLanguage] || failedMsgs.english;
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
        preferredLanguage,
        currentQuestion.options.length
      );
      if (numericOption && (matchedIdx < 0 || matchConfidence < confidenceThreshold)) {
        matchedIdx = numericOption - 1;
        matchConfidence = 1.0;
        console.log(`🔢 Numeric fallback matched option ${numericOption} from transcript`);
      }
    }

    if (matchedIdx < 0 || matchConfidence < confidenceThreshold) {
      // Low confidence — save a pending voice answer and ask to repeat in selected language
      await saveVoiceAnswer(db, phoneNumber, sessionId, currentQuestion.id, audioMeta.audioId, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);
      const lang = preferredLanguage.toLowerCase();
      const localizedOpts = Array.isArray(currentQuestion?.[`options_${lang}`]) && currentQuestion[`options_${lang}`].length > 0
        ? currentQuestion[`options_${lang}`]
        : currentQuestion.options;
      const optionsList = localizedOpts.map((o, i) => `${i + 1}. ${o}`).join('\n');
      const retryMsgs = {
        telugu: `⚠️ క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను. దయచేసి మీ సమాధానాన్ని మరోసారి చెప్పగలరా, లేదా సంఖ్యతో జవాబు ఇవ్వండి:\n${optionsList}`,
        hindi: `⚠️ क्षमा करें, मैं समझ नहीं पाया। कृपया अपना उत्तर एक बार फिर से बताइए, या संख्या से जवाब दें:\n${optionsList}`,
        kannada: `⚠️ ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಮತ್ತೊಮ್ಮೆ ಹೇಳಬಹುದೇ, ಅಥವಾ ಸಂಖ್ಯೆಯಿಂದ ಉತ್ತರಿಸಿ:\n${optionsList}`,
        english: `⚠️ Sorry, I didn’t understand. Could you please repeat your answer once more, or reply with the option number:\n${optionsList}`,
      };
      await sendMessage(phoneNumber, retryMsgs[preferredLanguage] || retryMsgs.english);
      return;
    }

    // High confidence match — save ONE confirmed answer (no duplicate VOICE_PENDING)
    const selectedOption = currentQuestion.options[matchedIdx];
    // Use localized option text for the confirmation message
    const voiceLang = preferredLanguage.toLowerCase();
    const localizedOptsVoice = Array.isArray(currentQuestion?.[`options_${voiceLang}`]) && currentQuestion[`options_${voiceLang}`].length > 0
      ? currentQuestion[`options_${voiceLang}`]
      : currentQuestion.options;
    const localizedSelectedOption = localizedOptsVoice[matchedIdx] || selectedOption;
    await saveAnswer(db, phoneNumber, sessionId, currentQuestion.id, matchedIdx, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);

    // Also store audioId link on the answer for QC/traceability
    try {
      const latestAnswer = await getCollection(db, 'answers').findOne(
        { phoneNumber, sessionId, questionId: currentQuestion.id, selectedOptionIndex: matchedIdx },
        { sort: { createdAt: -1 } }
      );
      if (latestAnswer) {
        await getCollection(db, 'answers').updateOne(
          { id: latestAnswer.id },
          { $set: { audioId: audioMeta.audioId, responseMode: 'voice', confidence: matchConfidence } }
        );
      }
    } catch (err) {
      console.warn('⚠️ Failed to link audioId to confirmed answer:', err.message);
    }

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
      getLocalizedSurveyMessage('answerConfirm', preferredLanguage, { answer: localizedSelectedOption })
    );

    console.log(`✅ Voice answer auto-confirmed: ${phoneNumber} -> ${currentQuestion.id} = ${selectedOption} (confidence: ${matchConfidence.toFixed(2)})`);

    // Advance to next question
    const nextQ = await getNextQuestion(db, currentQuestion.id, matchedIdx, ownerUserId || null, surveyId || DEFAULT_SURVEY_ID);

    if (nextQ) {
      // Small delay so the confirmation message arrives before the next question
      await new Promise(resolve => setTimeout(resolve, 800));
      await sendQuestionMessage(db, phoneNumber, nextQ, preferredLanguage);
      console.log(`📝 Sent next question (voice): ${nextQ.id}`);
    } else {
      // Survey completed
      await completeSession(db, phoneNumber, sessionId);

      // Send completion as voice note too (in audio mode)
      if (responseMode === 'audio') {
        const completionText = getLocalizedSurveyMessage('surveyCompleteTts', preferredLanguage);
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
          await sendMessage(phoneNumber, getLocalizedSurveyMessage('surveyComplete', preferredLanguage));
        }
      } else {
        await sendMessage(phoneNumber, getLocalizedSurveyMessage('surveyComplete', preferredLanguage));
      }
    }
  } catch (error) {
    console.error('❌ Error handling audio response:', error.message);
    const errLangAudio = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorVoice', errLangAudio));
  }
};

/**
 * AI-match a transcript string to question options using Groq LLM
 * Returns { index, confidence, note }
 */
// Singleton Groq client — lazily initialized once
let _groqClient = null;
const getGroqClient = async () => {
  if (!_groqClient) {
    const Groq = (await import('groq-sdk')).default;
    _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groqClient;
};

const matchVoiceToOption = async (transcript, question) => {
  const client = await getGroqClient();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  // Build a comprehensive option list including English and all available localized names
  const allLangs = ['telugu', 'hindi', 'kannada', 'marathi', 'tamil'];
  const localizedBlock = allLangs
    .filter(lang => Array.isArray(question[`options_${lang}`]) && question[`options_${lang}`].length > 0)
    .map(lang => `  ${lang}: ${JSON.stringify(question[`options_${lang}`])}`)
    .join('\n');

  const prompt = `You are a strict option classifier for a farmer survey conducted in India.

The farmer was asked: "${question.text}"
The available options (English): ${JSON.stringify(question.options)}
${localizedBlock ? `Localized option names:\n${localizedBlock}` : ''}
The farmer replied (voice transcription, may be in any Indian language or mixed language): "${transcript}"

IMPORTANT RULES:
- Brand names, product names, and proper nouns may be transliterated, misspelled, or spoken in a mix of English and local language. For example "బ్రాండ్ ఎక్స్" = "Brand X", "ब्रांड वाई" = "Brand Y".
- Consider phonetic similarity: the transcription is from speech recognition and may have errors, especially for brand names or English words spoken with Indian language accents.
- Slashes (/) in option names like "Brand X/Y/Z" mean the farmer could say any one of them.
- Match partial keywords — if the farmer says just one brand name from a compound option, that counts.
- Consider synonyms, abbreviations, and colloquial forms in Telugu, Hindi, Kannada, Tamil, Marathi, and English.
If the transcript clearly matches an option, return high confidence.
If it is ambiguous, return lower confidence.
If no option matches at all, return index -1.

Respond ONLY with valid JSON: {"index": <number>, "confidence": <0-1>, "note": "<brief reason>"}
where index is zero-based.`;

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
        currentQuestion = await getQuestionByIdWithFallback(db, lastAnswer.questionId, sessionSurveyId, sessionOwnerUserId);
      } else {
        currentQuestion = await getNextQuestion(db, lastAnswer.questionId, selectedIdx, sessionOwnerUserId, sessionSurveyId);
        if (!currentQuestion && sessionOwnerUserId) {
          currentQuestion = await getNextQuestion(db, lastAnswer.questionId, selectedIdx, null, sessionSurveyId);
        }
      }
    } else {
      currentQuestion = await getFirstQuestionWithFallback(db, sessionSurveyId, sessionOwnerUserId);
    }

    // Defensive fallback: if question lookup fails for any reason, restart from first.
    if (!currentQuestion) {
      currentQuestion = await getFirstQuestionWithFallback(db, sessionSurveyId, sessionOwnerUserId);
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

  const templateName = getInviteTemplateName();
  if (!templateName) {
    return { sent: false, reason: 'missing_template_name' };
  }

  const templateLang = getInviteTemplateLang();

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
      language: { code: templateLang },
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

const sendQuizChannelSelectionButtons = async (phoneNumber, preferredLanguage = 'english') => {
  try {
    const to = normalizePhoneNumber(phoneNumber);
    if (!to) {
      console.error('❌ Cannot send channel selection: invalid phone number', phoneNumber);
      return { fallback: true };
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';

    if (!phoneId || !accessToken) {
      return { fallback: true };
    }

    const endpoint = `${apiBase}/${apiVersion}/${phoneId}/messages`;
    const lang = (preferredLanguage || 'english').toLowerCase();
    const bodyByLang = {
      telugu: 'మీరు క్విజ్‌ను ఎలా కొనసాగించాలనుకుంటున్నారు? WhatsApp లోనా లేక Phone Call లోనా?',
      hindi: 'आप क्विज़ कैसे लेना चाहते हैं? व्हाट्सऐप पर या फोन कॉल पर?',
      kannada: 'ನೀವು ಕ್ವಿಜ್ ಅನ್ನು ಹೇಗೆ ತೆಗೆದುಕೊಳ್ಳಲು ಬಯಸುತ್ತೀರಿ? WhatsApp ಅಥವಾ Phone Call?',
      english: 'How would you like to take the quiz? On WhatsApp or on a phone call?',
    };

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyByLang[lang] || bodyByLang.english },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'action_channel_whatsapp', title: 'WhatsApp Quiz' } },
            { type: 'reply', reply: { id: 'action_channel_call', title: 'Phone Call Quiz' } },
          ],
        },
      },
    };

    await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    return { fallback: false };
  } catch (error) {
    if (isPermissionError(error)) {
      await sendMessage(phoneNumber, 'Reply with WHATSAPP to take quiz on WhatsApp, or CALL to take quiz by phone call.');
      return { fallback: true };
    }

    throw error;
  }
};

const handleQuizChannelSelection = async (db, phoneNumber, channel) => {
  const normalizedChannel = String(channel || '').trim().toLowerCase();
  const farmers = getCollection(db, 'farmers');
  const farmer = await getFarmerByPhone(db, phoneNumber);
  const preferredLanguage = farmer?.preferredLanguage || 'english';
  const targetSurveyId = normalizeSurveyId(farmer?.lastInvitedSurveyId || DEFAULT_SURVEY_ID);

  await farmers.updateOne(
    { phoneNumber },
    {
      $set: {
        preferredChannel: normalizedChannel === 'call' ? 'call' : 'whatsapp',
        ...(normalizedChannel === 'call' ? { responseMode: 'call' } : {}),
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  if (normalizedChannel === 'call') {
    await createSessionForFarmer(db, phoneNumber, targetSurveyId, farmer?.ownerUserId || null);

    setImmediate(() => {
      prewarmTwilioQuestionAudioCache(
        db,
        targetSurveyId,
        farmer?.ownerUserId || null,
        preferredLanguage || 'english'
      ).catch((err) => {
        console.warn('⚠️ Twilio prewarm background task failed:', err?.message || err);
      });
    });

    setImmediate(async () => {
      try {
        const callResult = await initiateTwilioQuizCall(phoneNumber, targetSurveyId);
        await sendMessage(phoneNumber, '📞 We are calling you now for the quiz. You can answer by speaking or using keypad numbers.');
        console.log(`📞 Twilio call initiated for ${phoneNumber}: sid=${callResult.callSid || 'n/a'}`);
      } catch (callErr) {
        console.error(`❌ Failed to initiate Twilio call for ${phoneNumber}:`, callErr?.message || callErr);
        try {
          await sendMessage(phoneNumber, '⚠️ We could not place the call right now. Please try again in a moment or continue on WhatsApp.');
        } catch (notifyErr) {
          console.warn('⚠️ Failed to notify farmer about call initiation failure:', notifyErr?.message || notifyErr);
        }
      }
    });

    return;
  }

  await sendModeSelectionButtons(phoneNumber, preferredLanguage, true);
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
      const continueMsgs = {
        telugu: '🚀 తెలుగులో కొనసాగుతున్నాము.',
        hindi: '🚀 हिंदी में जारी रखते हैं।',
        kannada: '🚀 ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತೇವೆ.',
        english: `🚀 Continuing in ${preferredLanguage}.`,
      };
      await sendMessage(phoneNumber, continueMsgs[preferredLanguage] || continueMsgs.english);
      await sendQuizChannelSelectionButtons(phoneNumber, preferredLanguage);
      return;
    }

    if (replyId === 'action_channel_whatsapp') {
      await handleQuizChannelSelection(db, phoneNumber, 'whatsapp');
      return;
    }

    if (replyId === 'action_channel_call') {
      await handleQuizChannelSelection(db, phoneNumber, 'call');
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
    const errLangAction = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorSelection', errLangAction));
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
      const fallbackLang = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
      await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorStarting', fallbackLang));
    }

  } catch (err) {
    console.error('❌ Error handling mode selection:', err.message);
    const errLangMode = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorPreference', errLangMode));
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
      const alreadySetMsgs = {
        telugu: '✅ భాష ఇప్పటికే తెలుగుకు సెట్ అయింది.',
        hindi: '✅ भाषा पहले से हिंदी पर सेट है।',
        kannada: '✅ ಭಾಷೆ ಈಗಾಗಲೇ ಕನ್ನಡಕ್ಕೆ ಹೊಂದಿಸಲಾಗಿದೆ.',
        english: `✅ Language already set to ${normalized}.`,
      };
      await sendMessage(phoneNumber, alreadySetMsgs[normalized] || alreadySetMsgs.english);
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

    // After language is set, ask how they want to take the quiz (WhatsApp or Phone Call)
    try {
      await sendQuizChannelSelectionButtons(phoneNumber, normalized);
    } catch (err) {
      console.error('❌ Failed to send channel selection after language selection:', err.message || err);
      const channelFailMsgs = {
        telugu: '⚠️ చానల్ ఎంపిక పంపడంలో విఫలమైంది. WHATSAPP లేదా CALL తో రిప్లై ఇవ్వండి.',
        hindi: '⚠️ चैनल चयन भेजने में विफल। WHATSAPP या CALL से उत्तर दें।',
        kannada: '⚠️ ಚಾನಲ್ ಆಯ್ಕೆ ಕಳುಹಿಸಲು ವಿಫಲವಾಗಿದೆ. WHATSAPP ಅಥವಾ CALL ಎಂದು ಉತ್ತರಿಸಿ.',
        english: '⚠️ Failed to send channel choice. Please reply with WHATSAPP or CALL to continue.',
      };
      await sendMessage(phoneNumber, channelFailMsgs[normalized] || channelFailMsgs.english);
    }
  } catch (error) {
    console.error('❌ Error handling language selection:', error.message);
    const errLangSel = (await getFarmerByPhone(db, phoneNumber).catch(() => null))?.preferredLanguage || 'english';
    await sendMessage(phoneNumber, getLocalizedSurveyMessage('errorSelection', errLangSel));
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

// Localized number words for option matching from STT transcripts
const LOCALIZED_NUMBER_WORDS = {
  hindi: {
    'एक': 1, 'ek': 1, 'दो': 2, 'do': 2, 'तीन': 3, 'teen': 3, 'चार': 4, 'char': 4,
    'पांच': 5, 'paanch': 5, 'panch': 5, 'छह': 6, 'chhah': 6, 'chhe': 6,
    'सात': 7, 'saat': 7, 'आठ': 8, 'aath': 8, 'नौ': 9, 'nau': 9, 'दस': 10, 'das': 10,
  },
  telugu: {
    'ఒకటి': 1, 'okati': 1, 'రెండు': 2, 'rendu': 2, 'మూడు': 3, 'moodu': 3, 'నాలుగు': 4, 'nalugu': 4,
    'ఐదు': 5, 'aidu': 5, 'ఆరు': 6, 'aaru': 6, 'ఏడు': 7, 'edu': 7, 'ఎనిమిది': 8, 'enimidi': 8,
    'తొమ్మిది': 9, 'tommidi': 9, 'పది': 10, 'padi': 10,
  },
  kannada: {
    'ಒಂದು': 1, 'ondu': 1, 'ಎರಡು': 2, 'eradu': 2, 'ಮೂರು': 3, 'mooru': 3, 'ನಾಲ್ಕು': 4, 'nalku': 4,
    'ಐದು': 5, 'aidu': 5, 'ಆರು': 6, 'aaru': 6, 'ಏಳು': 7, 'elu': 7, 'ಎಂಟು': 8, 'entu': 8,
    'ಒಂಬತ್ತು': 9, 'ombattu': 9, 'ಹತ್ತು': 10, 'hattu': 10,
  },
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

  // Check localized number words (e.g., "ek", "do", "rendu", "ondu", etc.)
  const langMaps = [LOCALIZED_NUMBER_WORDS[langKey], ...Object.values(LOCALIZED_NUMBER_WORDS)].filter(Boolean);
  for (const wordMap of langMaps) {
    for (const [word, num] of Object.entries(wordMap)) {
      if (text.includes(word) && num <= maxOption) {
        return num;
      }
    }
  }

  return null;
};

const getLocalizedIndex = (index) => {
  return String(index + 1);
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

const buildWhatsAppAudioSpokenScript = (question, preferredLanguage = 'english') => {
  const lang = String(preferredLanguage || 'english').toLowerCase();
  const questionText = sanitizeTtsText(buildBilingualQuestionText(question, lang), lang);
  const optionSpeech = buildBilingualOptionsForSpeech(question, lang).join('. ');
  return `${questionText}. ${optionSpeech}.`;
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
        const ttsDisabledHint = {
          telugu: '🎙️ వాయిస్ రిప్లైలు ప్రస్తుతం నిష్క్రియం చేయబడ్డాయి. దయచేసి సంఖ్యతో సమాధానం ఇవ్వండి.',
          hindi: '🎙️ वॉइस रिप्लाई वर्तमान में अक्षम हैं। कृपया संख्या से उत्तर दें।',
          kannada: '🎙️ ಧ್ವನಿ ಉತ್ತರಗಳು ಇದೀಗ ನಿಷ್ಕ್ರಿಯಗೆಯಾಗಿವೆ. ದಯವಿಟ್ಟು ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ.',
          english: '🎙️ Voice replies are currently disabled by the system. Reply with the number to answer.',
        };
        const fallbackBodyDisabled = `🔊 ${text}\n\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}\n\n${ttsDisabledHint[lang] || ttsDisabledHint.english}`;
        console.log('ℹ️ TTS is disabled via feature flag; sending text fallback');
        await sendMessage(phoneNumber, fallbackBodyDisabled);
        return;
      }
    } catch (err) {
      console.warn('⚠️ Could not read TTS feature flag:', err.message || err);
    }

    const spokenScript = buildWhatsAppAudioSpokenScript(q, lang);

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
    const voiceHint = {
      telugu: '🎙️ సమాధానం ఇవ్వడానికి వాయిస్ నోట్ పంపండి.',
      hindi: '🎙️ उत्तर देने के लिए वॉइस नोट भेजें।',
      kannada: '🎙️ ಉತ್ತರಿಸಲು ವಾಯ್ಸ್ ನೋಟ್ ಕಳುಹಿಸಿ.',
      english: '🎙️ Reply with a voice note to answer.',
    };
    const fallbackBody = `🔊 ${text}\n\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}\n\n${voiceHint[lang] || voiceHint.english}`;
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
  const FormData = (await import('form-data')).default;

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
              title: SECTION_TITLE[language] || SECTION_TITLE.english,
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
  if (!value) return 'unknown';
  // Always store regions as lowercase snake_case for consistency
  return value.toString().trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
};

const getRegionDisplayName = (key) => {
  if (!key) return 'Unknown';
  const normalized = key.toString().trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return REGION_DISPLAY_NAMES[normalized] || key.charAt(0).toUpperCase() + key.slice(1);
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


