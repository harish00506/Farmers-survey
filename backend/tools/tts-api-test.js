#!/usr/bin/env node
import dotenv from 'dotenv'; dotenv.config();
import fetch from 'node-fetch';

(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello from API test' }),
    });
    const text = await res.text();
    console.log('status', res.status, 'body', text.slice(0, 2000));
  } catch (err) {
    console.error('error', err.stack || err);
  }
})();
