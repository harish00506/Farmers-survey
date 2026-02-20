import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import whatsappRoutes, { whatsappWebhookRouter } from './routes/whatsappRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import qcRoutes from './routes/qcRoutes.js';
import farmersRoutes from './routes/farmersRoutes.js';
import surveyRoutes from './routes/surveyRoutes.js';
import ttsRoutes from './routes/ttsRoutes.js';
import audioRoutes from './routes/audioRoutes.js';
import sttRoutes from './routes/sttRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requireAuth } from './middleware/requireAuth.js';
import { initializeMongo } from './config/mongoConfig.js';
import { initializeSurveySchema } from './services/surveyEngine.js';
import { ensureAudioStorageDir } from './services/audioService.js';
import { ensureUsersIndexes } from './services/authService.js';
import { getModelByCollection } from './models/index.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_WEBHOOK_PATH = '/api/whatsapp/webhook';

const cleanWebhookPath = (value) => {
  if (!value) {
    return DEFAULT_WEBHOOK_PATH;
  }

  let candidate = value.trim();
  if (!candidate) {
    return DEFAULT_WEBHOOK_PATH;
  }

  if (!candidate.startsWith('/')) {
    candidate = `/${candidate}`;
  }

  while (candidate.length > 1 && candidate.endsWith('/')) {
    candidate = candidate.slice(0, -1);
  }

  return candidate;
};

const resolveWebhookPath = () => {
  const envValue = process.env.WHATSAPP_WEBHOOK_URL?.trim();
  if (!envValue) {
    return DEFAULT_WEBHOOK_PATH;
  }

  try {
    const { pathname } = new URL(envValue);
    return cleanWebhookPath(pathname);
  } catch (error) {
    return cleanWebhookPath(envValue);
  }
};

const whatsappWebhookPath = resolveWebhookPath();
const whatsappWebhookLogUrl =
  process.env.WHATSAPP_WEBHOOK_URL?.trim() || `http://localhost:${PORT}${whatsappWebhookPath}`;

const ensureTtlIndex = async (collection, keySpec, options) => {
  const indexes = await collection.indexes();
  const targetKey = JSON.stringify(keySpec);
  const existing = indexes.find((index) => JSON.stringify(index.key) === targetKey);

  if (existing) {
    const hasMatchingTtl = Number(existing.expireAfterSeconds) === Number(options.expireAfterSeconds);
    if (hasMatchingTtl) {
      return;
    }

    if (existing.name && existing.name !== '_id_') {
      await collection.dropIndex(existing.name);
    }
  }

  await collection.createIndex(keySpec, options);
};

const logSurveyQuestionCoverage = async (db) => {
  try {
    const surveysCollection = getModelByCollection('surveys').collection;
    const questionsCollection = getModelByCollection('questions').collection;

    const surveys = await surveysCollection
      .find({}, { projection: { _id: 0, id: 1, name: 1, ownerUserId: 1 } })
      .toArray();

    let warned = 0;
    for (const survey of surveys) {
      const surveyId = String(survey?.id || '').trim();
      if (!surveyId) continue;

      const ownerUserId = survey?.ownerUserId || null;
      const questionFilter = {
        surveyId,
        ...(ownerUserId ? { ownerUserId } : {}),
      };

      const questionCount = await questionsCollection.countDocuments(questionFilter);
      if (questionCount === 0) {
        warned += 1;
        console.warn(
          `⚠️ Survey has no questions in DB: id=${surveyId}${ownerUserId ? ` owner=${ownerUserId}` : ''}. ` +
          'Add questions in Survey Editor before starting WhatsApp flow.'
        );
      }
    }

    if (surveys.length === 0) {
      console.warn('⚠️ No surveys found in DB. Create a survey and questions in Survey Editor before WhatsApp invites.');
      return;
    }

    if (warned === 0) {
      console.log('✅ Survey question coverage check passed (all surveys have at least one question).');
    }
  } catch (err) {
    console.warn('⚠️ Failed to run startup survey coverage check:', err.message || err);
  }
};

// Verify WhatsApp configuration at startup so missing env vars are obvious
const verifyWhatsAppConfig = () => {
  const missing = [];
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');

  if (missing.length > 0) {
    console.warn('⚠️ WhatsApp configuration incomplete. Missing env vars:', missing.join(', '));
    console.warn('   - Add the following to your .env or environment:');
    console.warn('       WHATSAPP_PHONE_NUMBER_ID=<phone_number_id> (e.g., 927337227138030)');
    console.warn('       WHATSAPP_ACCESS_TOKEN=<access_token> (WhatsApp Cloud API token)');
    console.warn('   The app will run in simulated mode and skip actual API calls until these are provided.');
    return false;
  }

  console.log('✅ WhatsApp configuration found. Phone number ID:', process.env.WHATSAPP_PHONE_NUMBER_ID);
  return true;
};

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.use(requestLogger);

// ============ ROUTE HANDLERS ============
app.use(whatsappWebhookPath, whatsappWebhookRouter);
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/farmers', farmersRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/qc', qcRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/stt', sttRoutes);
// Admin endpoints (require JWT; optional ADMIN_API_KEY still applies inside route)
app.use('/api/admin', adminRoutes);

// Mount audio upload routes under /api/survey (POST /api/survey/:sessionId/audio)
app.use('/api/survey', audioRoutes);
// Also expose audio-related public endpoints under /api/audio
app.use('/api/audio', audioRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ ERROR HANDLING ============
app.use(errorHandler);

// ============ SERVER STARTUP ============
const startServer = async () => {
  try {
    console.log('🔌 Initializing MongoDB connection...');
    const { client, db } = await initializeMongo();

    // Store db in app context for use in routes
    app.locals.mongoClient = client;
    app.locals.mongoDb = db;
    console.log('✅ MongoDB connection established');

    await ensureUsersIndexes(db);
    console.log('✅ Users indexes ensured');

    await ensureAudioStorageDir();
    console.log('✅ Audio storage directory ready');

    // Try to initialize/update survey schema (non-fatal)
    try {
      await initializeSurveySchema(db);
      console.log('✅ Survey schema ensured on startup');
      await logSurveyQuestionCoverage(db);
    } catch (err) {
      console.warn('⚠️ Could not initialize survey schema on startup:', err.message);
    }

    // Verify WhatsApp config and expose status on app.locals
    app.locals.whatsappConfigured = verifyWhatsAppConfig();

    // Ensure webhook dedupe collection has TTL index so old entries auto-expire
    try {
      const webhookColl = getModelByCollection('webhookEvents').collection;
      await ensureTtlIndex(webhookColl, { createdAt: 1 }, {
        name: 'webhookEvents_createdAt_ttl',
        expireAfterSeconds: 86400,
      }); // 24 hours
      console.log('✅ webhookEvents TTL index ensured (24h)');
    } catch (err) {
      console.warn('⚠️ Failed to ensure webhookEvents TTL index:', err.message || err);
    }

    // Create a short-lived debug collection for incoming webhooks to help debugging interactive replies
    try {
      const debugColl = getModelByCollection('webhookDebug').collection;
      await ensureTtlIndex(debugColl, { receivedAt: 1 }, {
        name: 'webhookDebug_receivedAt_ttl',
        expireAfterSeconds: 7 * 24 * 3600,
      }); // 7 days
      console.log('✅ webhookDebug TTL index ensured (7d)');
    } catch (err) {
      console.warn('⚠️ Failed to ensure webhookDebug TTL index:', err.message || err);
    }

    // Check configured TTS provider and expose availability as app.locals.ttsAvailable
    try {
      const provider = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();
      if (!provider || provider === 'none') {
        app.locals.ttsAvailable = false;
        console.log('ℹ️ No TTS provider configured. Outgoing audio disabled.');
      } else {
        const { checkTtsEndpoint } = await import('./services/ttsService.js');
        const ttsCheck = await checkTtsEndpoint(5000);
        app.locals.ttsAvailable = Boolean(ttsCheck && ttsCheck.ok);
        console.log(`📣 TTS provider: ${provider} — available: ${app.locals.ttsAvailable}`);
        if (!app.locals.ttsAvailable) console.warn('⚠️ TTS provider check failed:', ttsCheck.error);
      }

      // Respect the TTS_ENABLED flag at startup (explicit disable)
      if (typeof process.env.TTS_ENABLED !== 'undefined' && String(process.env.TTS_ENABLED).toLowerCase() === 'false') {
        app.locals.ttsAvailable = false;
        console.log('ℹ️ Outgoing TTS disabled via TTS_ENABLED=false');
      }
    } catch (err) {
      app.locals.ttsAvailable = false;
      console.warn('⚠️ Failed to check TTS provider endpoint:', err.message || err);
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📬 WhatsApp webhook endpoint: ${whatsappWebhookLogUrl}`);
      console.log(`📡 WhatsApp configured: ${app.locals.whatsappConfigured}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
