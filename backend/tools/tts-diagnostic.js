#!/usr/bin/env node
/*
 TTS diagnostic script (deprecated)
 This tool was previously used to probe Coqui endpoints. Project now uses ElevenLabs for TTS and admin endpoints for health checks.
 Usage: Use the admin UI or POST /api/admin/tts/key to set an API key and then GET /api/admin/tts to check provider availability.
*/
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
    i++;
  }
}

const providerBase = args.provider || process.env.TTS_PROVIDER || 'elevenlabs'; // provider base (deprecated --coqui flag supported for backward compat)
const backendBase = args.backend || 'http://localhost:3000';

const endpoints = ['/synthesize', '/api/tts', '/api/tts/synthesize', '/api/synthesize'];

const outDir = path.resolve(new URL(import.meta.url).pathname.replace(/^\//, ''), '..', 'tools-out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const timeoutMs = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryPost(url) {
  const attempt = async (opts) => {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), timeoutMs);
    try {
      const res = await fetch(opts.url, opts.fetchOpts);
      clearTimeout(id);
      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, status: res.status, contentType: ct, bodyPreview: txt.slice(0, 2000) };
      }
      if (ct.includes('audio') || ct.includes('octet-stream')) {
        const buf = Buffer.from(await res.arrayBuffer());
        const candidateName = opts.saveName || opts.url;
        const cleanName = String(candidateName).replace(/https?:\/\//, '').replace(/[:/?#]/g, '_');
        const outFile = path.join(outDir, `tts_response_${cleanName}.wav`);
        fs.writeFileSync(outFile, buf);
        return { ok: true, status: res.status, contentType: ct, saved: outFile, size: buf.length };
      }
      const txt = await res.text();
      return { ok: true, status: res.status, contentType: ct, bodyPreview: txt.slice(0, 2000) };
    } catch (err) {
      clearTimeout(id);
      return { ok: false, error: err.message || String(err) };
    }
  };

  // 1) JSON body (historical)
  let r = await attempt({ url, fetchOpts: { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: '*/*' }, body: JSON.stringify({ text: 'Health check from tts-diagnostic', format: 'wav' }) }, saveName: url });
  if (r.ok) return r;

  // 2) Header-based (some providers accept 'text' header)
  r = await attempt({ url, fetchOpts: { method: 'POST', headers: { text: 'Health check from tts-diagnostic', Accept: '*/*' } }, saveName: url + '_hdr' });
  if (r.ok) return r;

  // 3) Query param
  const urlWithQuery = `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent('Health check from tts-diagnostic')}`;
  r = await attempt({ url: urlWithQuery, fetchOpts: { method: 'POST', headers: { Accept: '*/*' } }, saveName: url + '_q' });
  if (r.ok) return r;

  // 4) Try the /process compatibility endpoint (form-encoded)
  try {
    const base = url.replace(/\/(synthesize|api\/tts|api\/tts\/synthesize|api\/synthesize)?$/, '');
    const processUrl = `${base}/process`;
    r = await attempt({ url: processUrl, fetchOpts: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' }, body: `INPUT_TEXT=${encodeURIComponent('Health check from tts-diagnostic')}` }, saveName: processUrl + '_process' });
    if (r.ok) return r;
  } catch (err) {
    /* ignore */
  }

  // Return the last error
  return r;
}

async function run() {
  console.log('TTS diagnostic: Coqui-specific checks removed. Use admin endpoints to check ElevenLabs status.');
  console.log('Backend base:', backendBase);
  console.log('\nTesting backend /api/ai/tts/health endpoint...');

  for (const ep of endpoints) {
    const url = providerBase.replace(/\/$/, '') + ep;
    process.stdout.write(`- POST ${url} ... `);
    try {
      const r = await tryPost(url);
      if (r.ok && r.saved) console.log(`OK -> saved ${r.saved} (${r.size} bytes)`);
      else if (r.ok) console.log(`OK -> ${r.status} ${r.contentType} - preview: ${r.bodyPreview ? r.bodyPreview.slice(0,200) : ''}`);
      else console.log(`ERR -> ${r.status || ''} ${r.error || ''} ${r.contentType || ''} ${r.bodyPreview ? r.bodyPreview.slice(0,200) : ''}`);
    } catch (err) {
      console.log('ERR ->', err.message || err);
    }
    await sleep(200);
  }

  console.log('\nTesting provider root GET / ...');
  try {
    const res = await fetch(providerBase.replace(/\/$/, '') + '/');
    console.log(`- GET / -> ${res.status} ${res.headers.get('content-type') || ''}`);
    const t = await res.text();
    console.log('  Body preview:', t.slice(0, 800));
  } catch (err) {
    console.log('- GET / -> err', err.message || err);
  }

  console.log('\nTesting our backend health route /api/ai/tts/health ...');
  try {
    const res = await fetch(backendBase.replace(/\/$/, '') + '/api/ai/tts/health');
    const json = await res.text();
    console.log(`- GET backend health -> ${res.status} ${res.headers.get('content-type') || ''}`);
    console.log('  Body preview:', json.slice(0, 2000));
  } catch (err) {
    console.log('- GET backend health -> err', err.message || err);
  }

  console.log(`\nSaved diagnostic files (if any) under: ${outDir}`);
  console.log('Done.');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
