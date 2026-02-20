#!/usr/bin/env node
/*
  run_tts_generate.js

  Ensures Python & required pip packages are installed and runs the TTS generator.
  Usage: node tools/run_tts_generate.js [--force] [--dry-run] [--question-ids id1,id2]

  It forwards all args to the Python script.
*/
import { spawn } from 'child_process';
import { access } from 'fs/promises';

const PY_DEPS = ['python-dotenv', 'pymongo', 'requests'];
const PY_SCRIPT = './tools/generate_question_tts.py';

async function findPython() {
  return new Promise((resolve) => {
    const candidates = ['python', 'python3'];
    const tryNext = (i) => {
      if (i >= candidates.length) return resolve(null);
      const cmd = candidates[i];
      const p = spawn(cmd, ['--version']);
      p.on('error', () => tryNext(i + 1));
      p.on('exit', (code) => {
        if (code === 0) return resolve(cmd);
        tryNext(i + 1);
      });
    };
    tryNext(0);
  });
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...options });
    p.on('error', (err) => reject(err));
    p.on('exit', (code) => (code === 0 ? resolve(0) : reject(new Error(`Command ${cmd} ${args.join(' ')} exited with ${code}`))));
  });
}

(async () => {
  try {
    const python = await findPython();
    if (!python) {
      console.error('No python executable found in PATH. Please install Python 3 and ensure "python" or "python3" is available.');
      process.exit(1);
    }

    // Ensure the Python script exists
    try {
      await access('./tools/generate_question_tts.py');
    } catch (err) {
      console.error('Python TTS generator script not found at ./tools/generate_question_tts.py');
      process.exit(1);
    }

    console.log('Using python:', python);

    // Install / upgrade required pip packages
    console.log('Ensuring Python dependencies:', PY_DEPS.join(', '));
    await runCommand(python, ['-m', 'pip', 'install', '--upgrade', ...PY_DEPS]);

    // Run the generator and forward args
    const forwarded = process.argv.slice(2);
    console.log('Running generator with args:', forwarded.join(' '));
    await runCommand(python, [PY_SCRIPT, ...forwarded], { shell: false });

    console.log('TTS generation complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error running TTS generate helper:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
