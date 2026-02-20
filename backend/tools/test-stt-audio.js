#!/usr/bin/env node
/**
 * Test STT transcription with audio files
 * 
 * Usage: node tools/test-stt-audio.js [language] [audio-file-path]
 * Example: node tools/test-stt-audio.js kannada ./samples/kannada-sample.ogg
 * 
 * If no arguments provided, lists available test files in audio_storage
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';

dotenv.config();

const SUPPORTED_LANGUAGES = ['telugu', 'hindi', 'kannada', 'tamil', 'marathi', 'english'];

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_AUDIO_DIR = process.env.AUDIO_STORAGE_PATH || path.join(__dirname, '..', 'audio_storage');

async function testAudioFile(language, audioFilePath) {
  console.log('\n🎤 Testing STT Transcription...\n');
  console.log(`Language: ${language}`);
  console.log(`Audio file: ${audioFilePath}\n`);
  
  // Resolve audio file path: support absolute/relative paths or filename inside audio storage
  const candidates = [];
  if (path.isAbsolute(audioFilePath)) candidates.push(audioFilePath);
  else {
    // relative to current working dir
    candidates.push(path.resolve(audioFilePath));
    // try as a filename inside backend/audio_storage
    candidates.push(path.join(DEFAULT_AUDIO_DIR, audioFilePath));
  }

  let resolved = null;
  for (const p of candidates) {
    try {
      await fs.access(p);
      resolved = p;
      break;
    } catch (e) {
      // continue
    }
  }

  if (!resolved) {
    console.error(`❌ Audio file not found: ${audioFilePath}`);
    try {
      const files = await fs.readdir(DEFAULT_AUDIO_DIR);
      const audioFiles = files.filter(f => f.endsWith('.ogg') || f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a'));
      console.error(`\nAvailable files in ${DEFAULT_AUDIO_DIR}:`);
      audioFiles.slice(0, 10).forEach(f => console.error(`  - ${f}`));
      if (audioFiles.length === 0) console.error('  (none found)');
      if (audioFiles.length > 10) console.error(`  ...and ${audioFiles.length - 10} more`);
      if (audioFiles.length > 0) {
        console.error(`\nTry: node tools/test-stt-audio.js ${language} ${path.join('audio_storage', audioFiles[0])}`);
      } else {
        console.error(`\nTry uploading audio files into ${DEFAULT_AUDIO_DIR} or set AUDIO_STORAGE_PATH in your .env`);
      }
    } catch (err) {
      console.error(`  (could not list audio dir: ${DEFAULT_AUDIO_DIR})`);
    }
    process.exit(1);
  }
  
  // Import after env is loaded
  const { transcribeAudio } = await import('../src/services/audioService.js');
  const { MongoClient } = await import('mongodb');
  
  // Connect to MongoDB
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  try {
    // Store the audio file temporarily
    const { storeUploadedFile } = await import('../src/services/audioService.js');
    const buffer = await fs.readFile(resolved);
    const fileName = path.basename(resolved);
    const mimeType = fileName.endsWith('.ogg') ? 'audio/ogg' : 
                     fileName.endsWith('.mp3') ? 'audio/mpeg' :
                     fileName.endsWith('.wav') ? 'audio/wav' : 'audio/ogg';
    
    console.log('Storing audio file...');
    const audioMeta = await storeUploadedFile(db, buffer, fileName, mimeType, {
      source: 'test',
      testLanguage: language,
    });
    
    console.log(`✓ Stored as: ${audioMeta.audioId}\n`);
    
    // Transcribe
    console.log('Transcribing...');
    const startTime = Date.now();
    const result = await transcribeAudio(db, audioMeta.audioId, language);
    const elapsed = Date.now() - startTime;
    
    // Show results
    console.log(`\n✅ Transcription successful (${elapsed}ms)\n`);
    console.log('Results:');
    console.log(`  Text: "${result.text}"`);
    console.log(`  Language: ${result.language || 'not specified'}`);
    console.log(`  Engine: ${result.engine}`);
    
    if (result.match) {
      console.log(`\n  Match Result:`);
      console.log(`    Index: ${result.match.index}`);
      console.log(`    Confidence: ${result.match.confidence}`);
    }
    
  } catch (err) {
    console.error('\n❌ Transcription failed:');
    console.error(err.message);
    if (err.response) {
      console.error('Provider response:', err.response.data);
    }
  } finally {
    await client.close();
  }
}

async function listAudioFiles() {
  const audioDir = process.env.AUDIO_STORAGE_PATH || './audio_storage';
  
  console.log('\n📁 Audio files in storage:\n');
  
  try {
    const files = await fs.readdir(audioDir);
    const audioFiles = files.filter(f => 
      f.endsWith('.ogg') || f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')
    );
    
    if (audioFiles.length === 0) {
      console.log('  No audio files found.\n');
      console.log('💡 You can test with uploaded farmer audio by running:');
      console.log('   node tools/test-stt-audio.js kannada ./audio_storage/<filename>');
    } else {
      audioFiles.forEach(f => {
        console.log(`  - ${f}`);
      });
      console.log(`\n  Total: ${audioFiles.length} files\n`);
      console.log('To test a file, run:');
      console.log(`  node tools/test-stt-audio.js <language> ${audioDir}/<filename>`);
    }
  } catch (err) {
    console.log(`  Directory not found: ${audioDir}`);
  }
  
  console.log('\nSupported languages:', SUPPORTED_LANGUAGES.join(', '));
  console.log('');
}

async function main() {
  const [,, language, audioFile] = process.argv;
  
  console.log('════════════════════════════════════════════════════');
  console.log('  STT Audio Transcription Test');
  console.log('════════════════════════════════════════════════════');
  
  if (!language || !audioFile) {
    await listAudioFiles();
    return;
  }
  
  if (!SUPPORTED_LANGUAGES.includes(language.toLowerCase())) {
    console.error(`\n❌ Unsupported language: ${language}`);
    console.error(`   Supported: ${SUPPORTED_LANGUAGES.join(', ')}\n`);
    process.exit(1);
  }
  
  await testAudioFile(language.toLowerCase(), audioFile);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
