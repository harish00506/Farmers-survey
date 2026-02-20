import express from 'express';
import axios from 'axios';
import { requireAdminApiKey } from '../middleware/adminAuth.js';
import { isTtsEnabled, setTtsEnabled } from '../config/featureFlags.js';
import { checkTtsEndpoint } from '../services/ttsService.js';
import { getModelByCollection } from '../models/index.js';

const router = express.Router();

// GET /api/admin/tts -> { enabled: boolean, provider: string, ttsAvailable: boolean }
router.get('/tts', requireAdminApiKey, async (req, res) => {
  try {
    const enabled = isTtsEnabled();
    const provider = process.env.TTS_PROVIDER || null;
    // prefer explicit app locals flag
    const ttsAvailable = req.app.locals.ttsAvailable || false;
    res.json({ success: true, enabled, provider, ttsAvailable });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/last-incoming -> returns last webhook message the server saw (helpful for debugging)
router.get('/last-incoming', requireAdminApiKey, async (req, res) => {
  try {
    const last = req.app.locals.lastIncoming || null;
    res.json({ success: true, last });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/tts { enabled: true|false }
router.post('/tts', requireAdminApiKey, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled must be boolean' });

    await setTtsEnabled(enabled);

    // If enabling, perform a quick health check
    if (enabled) {
      const ttsCheck = await checkTtsEndpoint(3000);
      req.app.locals.ttsAvailable = ttsCheck.ok;
      if (!ttsCheck.ok) {
        return res.status(200).json({ success: true, enabled: true, ttsAvailable: false, message: 'TTS enabled but health check failed' });
      }
    } else {
      req.app.locals.ttsAvailable = false;
    }

    res.json({ success: true, enabled, ttsAvailable: req.app.locals.ttsAvailable });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/tts/key { key:"ELEVENLABS_API_KEY", value:"..." }
router.post('/tts/key', requireAdminApiKey, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || typeof value === 'undefined') return res.status(400).json({ success: false, message: 'key and value required' });

    const { setEnvVar } = await import('../config/featureFlags.js');
    await setEnvVar(key, value);

    // Update runtime env
    process.env[key] = String(value);

    // Re-run health check if it's an API key
    if (key === 'ELEVENLABS_API_KEY') {
      const { checkTtsEndpoint } = await import('../services/ttsService.js');
      const ttsCheck = await checkTtsEndpoint(3000);
      req.app.locals.ttsAvailable = ttsCheck.ok;
      return res.json({ success: true, key, ttsAvailable: req.app.locals.ttsAvailable });
    }

    // If setting the voice ID re-run health check
    if (key === 'ELEVENLABS_VOICE_ID') {
      const { checkTtsEndpoint } = await import('../services/ttsService.js');
      const ttsCheck = await checkTtsEndpoint(3000);
      req.app.locals.ttsAvailable = ttsCheck.ok;
      return res.json({ success: true, key, ttsAvailable: req.app.locals.ttsAvailable });
    }

    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/tts/voices -> list available ElevenLabs voices
router.get('/tts/voices', requireAdminApiKey, async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) return res.status(400).json({ success: false, message: 'ELEVENLABS_API_KEY not set' });
    const resp = await axios.get('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, timeout: 5000 });
    return res.json({ success: true, voices: resp.data?.voices || resp.data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.response?.data || err.message });
  }
});

// GET /api/admin/sessions?phone=<phone>
router.get('/sessions', requireAdminApiKey, async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ success: false, message: 'phone query param required' });
    const sessions = await getModelByCollection('surveySessions').collection.find({ $or: [{ phoneNumber: phone }, { phoneNumber: `+${phone.replace(/^\+/, '')}` }, { phoneNumber: phone.replace(/^\+/, '') }], status: 'in_progress' }).toArray();
    return res.json({ success: true, sessions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/tts/voice { voiceId: '...' }
router.post('/tts/voice', requireAdminApiKey, async (req, res) => {
  try {
    const { voiceId } = req.body;
    if (!voiceId) return res.status(400).json({ success: false, message: 'voiceId required' });

    const { setEnvVar } = await import('../config/featureFlags.js');
    await setEnvVar('ELEVENLABS_VOICE_ID', voiceId);
    process.env.ELEVENLABS_VOICE_ID = String(voiceId);

    const { checkTtsEndpoint } = await import('../services/ttsService.js');
    const ttsCheck = await checkTtsEndpoint(3000);
    req.app.locals.ttsAvailable = ttsCheck.ok;

    res.json({ success: true, voiceId, ttsAvailable: req.app.locals.ttsAvailable });
  } catch (err) {
    res.status(500).json({ success: false, message: err.response?.data || err.message });
  }
});

export default router;