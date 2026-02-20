import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const ENV_PATH = path.resolve(process.cwd(), '.env');
let _ttsEnabled = typeof process.env.TTS_ENABLED !== 'undefined' ? String(process.env.TTS_ENABLED).toLowerCase() === 'true' : true;

export const isTtsEnabled = () => {
  // Always prefer reading .env file first (so manual edits take immediate effect)
  try {
    const content = fsSync.readFileSync(ENV_PATH, { encoding: 'utf8' });
    const match = content.match(/^\s*TTS_ENABLED\s*=\s*(.+)\s*$/m);
    if (match) {
      return String(match[1]).trim().toLowerCase() === 'true';
    }
  } catch (err) {
    // ignore reads
  }

  // Next, fall back to process.env if present
  if (typeof process.env.TTS_ENABLED !== 'undefined') {
    return String(process.env.TTS_ENABLED).toLowerCase() === 'true';
  }

  return _ttsEnabled;
};

// Persist an env var into .env file (creates file if missing)
const writeEnvVar = async (key, value) => {
  try {
    let content = '';
    try {
      content = await fs.readFile(ENV_PATH, { encoding: 'utf8' });
    } catch (err) {
      // no .env yet — we'll create it
      content = '';
    }

    const lines = content.split(/\r?\n/);
    let found = false;
    const newLines = lines.map((line) => {
      const m = line.match(/^\s*([^=\s]+)\s*=\s*(.*)$/);
      if (m && m[1] === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    }).filter(Boolean);

    if (!found) {
      newLines.push(`${key}=${value}`);
    }

    await fs.writeFile(ENV_PATH, newLines.join('\n'), { encoding: 'utf8' });
    return true;
  } catch (err) {
    console.error('❌ Failed to write .env:', err.message || err);
    throw err;
  }
};

export const setTtsEnabled = async (enabled) => {
  _ttsEnabled = Boolean(enabled);
  // persist to .env so it survives restarts
  try {
    await writeEnvVar('TTS_ENABLED', _ttsEnabled ? 'true' : 'false');
  } catch (err) {
    console.warn('⚠️ Could not persist TTS_ENABLED to .env:', err.message || err);
  }
};

export const setEnvVar = async (key, value) => {
  try {
    await writeEnvVar(key, String(value));
  } catch (err) {
    throw err;
  }
};

// Allow runtime reload (if someone edits .env manually)
export const reloadFlagsFromEnv = () => {
  _ttsEnabled = process.env.TTS_ENABLED ? String(process.env.TTS_ENABLED).toLowerCase() === 'true' : _ttsEnabled;
};
