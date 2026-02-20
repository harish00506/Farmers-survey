#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();
import { synthesizeText } from '../src/services/ttsService.js';

(async () => {
  try {
    const r = await synthesizeText('Direct test from tts-test', { format: 'wav' });
    console.log('synthesizeText result:', r);
  } catch (err) {
    console.error('synthesizeText error:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
