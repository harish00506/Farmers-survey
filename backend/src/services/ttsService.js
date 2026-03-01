import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';

const getAudioStoragePath = () => process.env.AUDIO_STORAGE_PATH || './audio_storage';

const makeAudioId = (prefix = 'tts') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeLanguage = (raw = '') => {
  const lang = String(raw || '').trim().toLowerCase();
  const map = {
    en: 'english',
    'en-in': 'english',
    hi: 'hindi',
    kn: 'kannada',
    te: 'telugu',
  };
  return map[lang] || lang || 'telugu';
};

const resolveMmsModelByLanguage = (langRaw = '', isLocal = false) => {
  const lang = normalizeLanguage(langRaw);

  const defaults = {
    telugu: 'facebook/mms-tts-tel',
    hindi: 'facebook/mms-tts-hin',
    kannada: 'facebook/mms-tts-kan',
    english: 'facebook/mms-tts-eng',
  };

  if (isLocal) {
    const localByLang = {
      telugu: process.env.TTS_LOCAL_MODEL_TELUGU,
      hindi: process.env.TTS_LOCAL_MODEL_HINDI,
      kannada: process.env.TTS_LOCAL_MODEL_KANNADA,
      english: process.env.TTS_LOCAL_MODEL_ENGLISH,
    };
    return localByLang[lang] || process.env.TTS_LOCAL_MODEL || defaults[lang] || defaults.telugu;
  }

  const hfByLang = {
    telugu: process.env.TTS_HF_MODEL_TELUGU,
    hindi: process.env.TTS_HF_MODEL_HINDI,
    kannada: process.env.TTS_HF_MODEL_KANNADA,
    english: process.env.TTS_HF_MODEL_ENGLISH,
  };
  return hfByLang[lang] || process.env.TTS_HF_MODEL || process.env.HUGGINGFACE_TTS_MODEL || defaults[lang] || defaults.telugu;
};

const pickAudioExtension = (requestedFormat = '', contentType = '') => {
  const preferred = String(requestedFormat || '').trim().toLowerCase();
  if (preferred) return preferred;

  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('flac')) return 'flac';
  return 'wav';
};

const getHfModelEndpoint = (model) => {
  const base = String(process.env.TTS_HF_API_BASE || 'https://router.huggingface.co/hf-inference/models')
    .trim()
    .replace(/\/$/, '');
  return `${base}/${encodeURIComponent(model)}`;
};

const runCommand = (command, args = []) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
  }

  child.on('error', (err) => reject(err));
  child.on('close', (code) => {
    if (code === 0) return resolve({ ok: true });
    return reject(new Error(stderr.trim() || `Command failed with code ${code}`));
  });
});

const getMimeTypeForExtension = (ext = 'wav') => {
  const normalized = String(ext || 'wav').toLowerCase();
  if (normalized === 'mp3') return 'audio/mpeg';
  if (normalized === 'opus') return 'audio/opus';
  if (normalized === 'ogg') return 'audio/ogg';
  return `audio/${normalized}`;
};

const resolveLocalMmsFormat = (requestedFormat = '') => {
  const normalized = String(requestedFormat || '').trim().toLowerCase();
  if (normalized === 'wav' || normalized === 'ogg' || normalized === 'opus') return normalized;
  return 'opus';
};

const parseProviderError = (responseData, fallbackMessage) => {
  if (!responseData) return fallbackMessage;
  if (Buffer.isBuffer(responseData)) {
    try {
      const txt = responseData.toString('utf8');
      const parsed = JSON.parse(txt);
      return parsed?.error || parsed?.message || txt || fallbackMessage;
    } catch {
      const txt = responseData.toString('utf8');
      return txt || fallbackMessage;
    }
  }
  if (typeof responseData === 'object') {
    return responseData.error || responseData.message || fallbackMessage;
  }
  return String(responseData || fallbackMessage);
};

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

  if (provider === 'mms-tts-tel' || provider === 'huggingface' || provider === 'hf') {
    const apiKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || '';
    const model = resolveMmsModelByLanguage(opts.lang || opts.language || opts.model || 'telugu', false);
    const endpoint = getHfModelEndpoint(model);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'audio/*,application/octet-stream,application/json',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let response;
    try {
      response = await axios.post(endpoint, { inputs: text }, {
        headers,
        responseType: 'arraybuffer',
        timeout: Number(process.env.TTS_TIMEOUT_MS || 60000),
      });
    } catch (err) {
      throw new Error(`Hugging Face TTS request failed for model '${model}': ${parseProviderError(err.response?.data, err.message)}`);
    }

    const contentType = String(response?.headers?.['content-type'] || '').toLowerCase();
    const buffer = Buffer.from(response?.data || []);

    if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
      throw new Error(`Hugging Face model '${model}' returned non-audio response: ${parseProviderError(buffer, 'unexpected content type')}`);
    }

    if (!buffer || buffer.length === 0) {
      throw new Error(`Empty response from Hugging Face model '${model}'`);
    }

    const ext = pickAudioExtension(opts.format, contentType);
    const resolvedStorage = path.resolve(getAudioStoragePath());
    await fs.mkdir(resolvedStorage, { recursive: true });

    const audioId = makeAudioId('mms');
    const fileName = `${audioId}.${ext}`;
    const filePath = path.join(resolvedStorage, fileName);
    await fs.writeFile(filePath, buffer);

    return {
      audioId,
      fileName,
      filePath,
      mimeType: getMimeTypeForExtension(ext),
      fileSize: buffer.length,
    };
  }

  if (provider === 'mms-tts-tel-local' || provider === 'local-mms-tts-tel') {
    const lang = normalizeLanguage(opts.lang || opts.language || opts.model || 'telugu');
    const model = resolveMmsModelByLanguage(lang, true);
    const pythonBin = process.env.TTS_LOCAL_PYTHON_BIN || 'python';
    const scriptPath = process.env.TTS_LOCAL_SCRIPT_PATH || path.resolve(process.cwd(), 'tools', 'mms_tts_local_run.py');
    const ext = resolveLocalMmsFormat(opts.format || process.env.TTS_FORMAT || 'opus');

    if (!fsSync.existsSync(scriptPath)) {
      throw new Error(`Local MMS TTS script not found at ${scriptPath}`);
    }

    const resolvedStorage = path.resolve(getAudioStoragePath());
    await fs.mkdir(resolvedStorage, { recursive: true });

    const audioId = makeAudioId('mmslocal');
    const fileName = `${audioId}.${ext}`;
    const filePath = path.join(resolvedStorage, fileName);

    await runCommand(pythonBin, [
      scriptPath,
      '--model', model,
      '--lang', lang,
      '--format', ext,
      '--text', String(text || ''),
      '--out', filePath,
    ]);

    if (!fsSync.existsSync(filePath)) {
      throw new Error(`Local MMS TTS did not create output file: ${filePath}`);
    }

    const stats = await fs.stat(filePath);
    return {
      audioId,
      fileName,
      filePath,
      mimeType: getMimeTypeForExtension(ext),
      fileSize: Number(stats.size || 0),
    };
  }

  // ── Sarvam AI (Bulbul v3) TTS provider ──
  if (provider === 'sarvam') {
    const sarvamKey = process.env.SARVAM_API_KEY;
    if (!sarvamKey) throw new Error('SARVAM_API_KEY is not configured');

    const lang = normalizeLanguage(opts.lang || opts.language || opts.model || 'telugu');

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
    const targetLangCode = SARVAM_LANG_MAP[lang] || 'te-IN';

    // Per-language speaker overrides via env (e.g., SARVAM_TTS_SPEAKER_TELUGU=Kavitha)
    const perLangSpeaker = process.env[`SARVAM_TTS_SPEAKER_${lang.toUpperCase()}`] || '';
    const speaker = (perLangSpeaker || process.env.SARVAM_TTS_SPEAKER || 'kavitha').toLowerCase();
    const model = process.env.SARVAM_TTS_MODEL || 'bulbul:v3';
    const pace = Number(process.env.SARVAM_TTS_PACE || 1.0);

    // Determine desired sample rate: 8000 for Twilio (telephony), 24000 default
    const sampleRate = opts.sampleRate || Number(process.env.SARVAM_TTS_SAMPLE_RATE || 24000);

    const ttsUrl = process.env.SARVAM_TTS_API_URL || 'https://api.sarvam.ai/text-to-speech';

    const body = {
      text: String(text || ''),
      target_language_code: targetLangCode,
      model,
      speaker,
      pace,
      speech_sample_rate: sampleRate,
    };

    let response;
    try {
      response = await axios.post(ttsUrl, body, {
        headers: {
          'api-subscription-key': sarvamKey,
          'Content-Type': 'application/json',
        },
        timeout: Number(process.env.TTS_TIMEOUT_MS || 60000),
      });
    } catch (err) {
      throw new Error(`Sarvam TTS request failed: ${parseProviderError(err.response?.data, err.message)}`);
    }

    const audios = response.data?.audios;
    if (!Array.isArray(audios) || audios.length === 0 || !audios[0]) {
      throw new Error('Sarvam TTS returned no audio data');
    }

    // Decode base64 audio → buffer
    const audioBase64 = audios[0];
    const buffer = Buffer.from(audioBase64, 'base64');
    if (!buffer || buffer.length === 0) {
      throw new Error('Sarvam TTS returned empty audio buffer');
    }

    // Determine output format: wav by default, or based on opts.format
    const requestedFormat = String(opts.format || 'wav').toLowerCase();
    const ext = requestedFormat === 'opus' || requestedFormat === 'ogg' ? requestedFormat : 'wav';

    const resolvedStorage = path.resolve(getAudioStoragePath());
    await fs.mkdir(resolvedStorage, { recursive: true });

    const audioId = makeAudioId('sarvam');
    const fileName = `${audioId}.${ext}`;
    const filePath = path.join(resolvedStorage, fileName);

    // If user requested opus/ogg and we have wav from Sarvam, convert using ffmpeg if available
    if ((ext === 'opus' || ext === 'ogg') && buffer.length > 0) {
      const tmpWav = path.join(resolvedStorage, `${audioId}_tmp.wav`);
      await fs.writeFile(tmpWav, buffer);
      try {
        await runCommand('ffmpeg', ['-y', '-i', tmpWav, '-c:a', 'libopus', '-b:a', '32k', filePath]);
        await fs.unlink(tmpWav).catch(() => { });
      } catch (ffmpegErr) {
        // ffmpeg not available — save as wav instead
        console.warn('⚠️ ffmpeg not available for opus conversion, saving as wav:', ffmpegErr.message);
        const wavPath = path.join(resolvedStorage, `${audioId}.wav`);
        await fs.rename(tmpWav, wavPath);
        return {
          audioId,
          fileName: `${audioId}.wav`,
          filePath: wavPath,
          mimeType: 'audio/wav',
          fileSize: buffer.length,
        };
      }
    } else {
      await fs.writeFile(filePath, buffer);
    }

    const stats = await fs.stat(filePath);
    return {
      audioId,
      fileName,
      filePath,
      mimeType: getMimeTypeForExtension(ext),
      fileSize: Number(stats.size || 0),
    };
  }

  // No TTS provider configured
  throw new Error('No TTS provider configured (set TTS_PROVIDER to "sarvam", "elevenlabs", "mms-tts-tel", or "mms-tts-tel-local")');
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

  if (provider === 'mms-tts-tel' || provider === 'huggingface' || provider === 'hf') {
    const apiKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || '';
    const model = resolveMmsModelByLanguage('telugu', false);
    const endpoint = getHfModelEndpoint(model);

    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'audio/*,application/octet-stream,application/json',
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await axios.post(endpoint, { inputs: 'health check' }, {
        headers,
        responseType: 'arraybuffer',
        timeout: Number(timeoutMs),
      });

      const contentType = String(res?.headers?.['content-type'] || '').toLowerCase();
      const size = res?.data?.byteLength || 0;
      if ((contentType.includes('audio') || contentType.includes('octet-stream')) && size > 0) {
        return { ok: true };
      }
      return { ok: false, error: `non-audio response (${contentType || 'unknown content-type'})` };
    } catch (err) {
      return { ok: false, error: parseProviderError(err.response?.data, err.message) };
    }
  }

  if (provider === 'mms-tts-tel-local' || provider === 'local-mms-tts-tel') {
    const model = resolveMmsModelByLanguage('telugu', true);
    const pythonBin = process.env.TTS_LOCAL_PYTHON_BIN || 'python';
    const scriptPath = process.env.TTS_LOCAL_SCRIPT_PATH || path.resolve(process.cwd(), 'tools', 'mms_tts_local_run.py');
    const resolvedStorage = path.resolve(getAudioStoragePath());

    try {
      await fs.mkdir(resolvedStorage, { recursive: true });
      const healthFile = path.join(resolvedStorage, `${makeAudioId('mmslocal_health')}.wav`);

      await runCommand(pythonBin, [
        scriptPath,
        '--model', model,
        '--lang', 'telugu',
        '--text', 'నమస్కారం రైతు సర్వే ఆరోగ్య పరీక్ష',
        '--out', healthFile,
      ]);

      const exists = fsSync.existsSync(healthFile);
      if (!exists) return { ok: false, error: 'local script completed but no output file found' };

      const stats = await fs.stat(healthFile);
      try {
        await fs.unlink(healthFile);
      } catch {
        // ignore cleanup failure
      }

      if (Number(stats.size || 0) > 0) return { ok: true };
      return { ok: false, error: 'generated file is empty' };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  if (provider === 'sarvam') {
    const sarvamKey = process.env.SARVAM_API_KEY;
    if (!sarvamKey) return { ok: false, error: 'SARVAM_API_KEY not set' };
    const ttsUrl = process.env.SARVAM_TTS_API_URL || 'https://api.sarvam.ai/text-to-speech';
    try {
      const res = await axios.post(ttsUrl, {
        text: 'నమస్కారం',
        target_language_code: 'te-IN',
        model: process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
        speaker: (process.env.SARVAM_TTS_SPEAKER || 'kavitha').toLowerCase(),
      }, {
        headers: { 'api-subscription-key': sarvamKey, 'Content-Type': 'application/json' },
        timeout: Number(timeoutMs),
      });
      if (res.data?.audios?.length > 0 && res.data.audios[0]) return { ok: true };
      return { ok: false, error: 'empty audios array' };
    } catch (err) {
      return { ok: false, error: parseProviderError(err.response?.data, err.message) };
    }
  }

  return { ok: false, error: 'No TTS provider configured' };
};
