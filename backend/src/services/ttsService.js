import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';

const getAudioStoragePath = () => process.env.AUDIO_STORAGE_PATH || './audio_storage';

const makeAudioId = (prefix = 'tts') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Synthesize text using selected provider (elevenlabs)
 * Returns { audioId, fileName, filePath, mimeType }
 */
export const synthesizeText = async (text, opts = {}) => {
  const provider = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();

  if (provider === 'elevenlabs') {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    // Accept lang, language, or model (for backward compatibility)
    let lang = (opts.lang || opts.language || opts.model || '').toString().toLowerCase();

    // Accept short language codes and normalize to canonical names used in env vars
    const LANG_CANON = { hi: 'hindi', en: 'english', te: 'telugu', kn: 'kannada', ta: 'tamil', mr: 'marathi' };
    if (LANG_CANON[lang]) lang = LANG_CANON[lang];
    // allow per-language voice overrides via env (e.g., ELEVENLABS_VOICE_ID_TELUGU)
    const perLangVoice = lang ? process.env[`ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`] : '';
    const voice = perLangVoice || process.env.ELEVENLABS_VOICE_ID || opts.voice || 'eleven_monolingual_v1';

    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

    const buildEndpoint = (v) => `https://api.elevenlabs.io/v1/text-to-speech/${v}`;

    const tryPost = async (v) => {
      const ep = buildEndpoint(v);
      return axios.post(ep, { text }, {
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: Number(process.env.TTS_TIMEOUT_MS || 60000),
      });
    };

    let response = null;
    let attemptedVoices = [];

    // Primary attempt (per-language or configured voice)
    try {
      attemptedVoices.push(voice);
      response = await tryPost(voice);
    } catch (errPrimary) {
      // If we tried a per-language voice and it failed, retry with generic configured voice(s)
      const fallbackVoices = [process.env.ELEVENLABS_VOICE_ID, opts.voice, 'eleven_monolingual_v1'].filter(Boolean);
      let retried = false;

      for (const fb of fallbackVoices) {
        // skip if same as primary
        if (fb === voice) continue;
        try {
          attemptedVoices.push(fb);
          response = await tryPost(fb);
          retried = true;
          console.warn(`⚠️ ElevenLabs voice '${voice}' failed; retried with fallback voice '${fb}'.`);
          break;
        } catch (errFallback) {
          // continue trying other fallbacks
          console.warn(`⚠️ ElevenLabs fallback voice '${fb}' also failed:`, errFallback.response?.data || errFallback.message || errFallback);
        }
      }

      if (!retried) {
        // none of the voices worked — surface the original error for visibility
        throw new Error(`ElevenLabs TTS request failed (voices tried: ${attemptedVoices.join(', ')}): ${errPrimary.response?.data || errPrimary.message}`);
      }
    }

    if (!response || !response.data) throw new Error(`Empty response from ElevenLabs (voices tried: ${attemptedVoices.join(', ')})`);

    const buffer = Buffer.from(response.data);
    const resolvedStorage = path.resolve(getAudioStoragePath());
    await fs.mkdir(resolvedStorage, { recursive: true });

    const audioId = makeAudioId('eleven');
    const ext = opts.format || 'mp3';
    const fileName = `${audioId}.${ext}`;
    const filePath = path.join(resolvedStorage, fileName);

    await fs.writeFile(filePath, buffer);

    return {
      audioId,
      fileName,
      filePath,
      mimeType: `audio/${ext === 'mp3' ? 'mpeg' : ext}`,
      fileSize: buffer.length,
    };
  }

  // No TTS provider configured
  throw new Error('No TTS provider configured (set TTS_PROVIDER to "elevenlabs" and provide ELEVENLABS_API_KEY)');
};

/**
 * Perform a quick health check on the configured TTS endpoint/provider
 */
export const checkTtsEndpoint = async (timeoutMs = 5000) => {
  const provider = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();

  if (provider === 'elevenlabs') {
    if (!process.env.ELEVENLABS_API_KEY) return { ok: false, error: 'ELEVENLABS_API_KEY not set' };
    const voice = process.env.ELEVENLABS_VOICE_ID || 'eleven_monolingual_v1';
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
    try {
      const res = await axios.post(endpoint, { text: 'health check' }, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, responseType: 'arraybuffer', timeout: Number(timeoutMs) });
      if (res && res.data && res.data.byteLength && res.data.byteLength > 0) return { ok: true };
      return { ok: false, error: 'empty response' };
    } catch (err) {
      return { ok: false, error: err.response?.data || err.message };
    }
  }

  return { ok: false, error: 'No TTS provider configured' };
};
