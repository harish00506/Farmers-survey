#!/usr/bin/env node
/**
 * Test TTS and STT support for all configured languages
 * 
 * Usage: node tools/test-language-support.js
 * 
 * This script validates:
 * - TTS synthesis works for each language
 * - Language-specific voice IDs are used when configured
 * - STT language codes are mapped correctly
 */

import dotenv from 'dotenv';
dotenv.config();

const SUPPORTED_LANGUAGES = ['telugu', 'hindi', 'kannada', 'tamil', 'marathi', 'english'];

const TEST_PHRASES = {
  telugu: 'మీ ప్రధాన పంట ఏది?',
  hindi: 'आपकी प्राथमिक फसल क्या है?',
  kannada: 'ನಿಮ್ಮ ಮುಖ್ಯ ಬೆಳೆ ಯಾವುದು?',
  tamil: 'உங்கள் முதன்மை பயிர் என்ன?',
  marathi: 'तुमचे प्राथमिक पीक काय आहे?',
  english: 'What is your primary crop?',
};

const STT_LANGUAGE_CODES = {
  telugu: 'te-IN',
  hindi: 'hi-IN',
  kannada: 'kn-IN',
  tamil: 'ta-IN',
  marathi: 'mr-IN',
  english: 'en-US',
};

async function testTTS() {
  console.log('\n🔊 Testing TTS (Text-to-Speech)...\n');
  
  const { synthesizeText } = await import('../src/services/ttsService.js');
  
  const results = [];
  
  for (const lang of SUPPORTED_LANGUAGES) {
    const phrase = TEST_PHRASES[lang];
    const voiceEnvKey = `ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`;
    const voiceId = process.env[voiceEnvKey] || process.env.ELEVENLABS_VOICE_ID;
    
    console.log(`Testing ${lang}:`);
    console.log(`  Phrase: ${phrase}`);
    console.log(`  Voice: ${voiceId} ${process.env[voiceEnvKey] ? '(language-specific)' : '(default)'}`);
    
    try {
      const result = await synthesizeText(phrase, { lang, format: 'mp3' });
      console.log(`  ✅ Success: ${result.fileName} (${result.fileSize} bytes)`);
      results.push({ lang, success: true, file: result.fileName });
    } catch (err) {
      console.log(`  ❌ Failed: ${err.message}`);
      results.push({ lang, success: false, error: err.message });
    }
    console.log('');
  }
  
  return results;
}

async function testSTT() {
  console.log('\n🎤 Testing STT (Speech-to-Text) Configuration...\n');
  
  console.log('Language Code Mappings:');
  for (const lang of SUPPORTED_LANGUAGES) {
    const code = STT_LANGUAGE_CODES[lang];
    console.log(`  ${lang.padEnd(10)} → ${code}`);
  }
  
  console.log('\nSTT Provider Configuration:');
  console.log(`  Provider: ${process.env.STT_PROVIDER || 'groq'}`);
  console.log(`  Model: ${process.env.STT_MODEL || 'whisper-large-v3-turbo'}`);
  console.log(`  API URL: ${process.env.STT_API_URL || 'not set'}`);
  console.log(`  API Key: ${process.env.STT_API_KEY ? '✓ configured' : '✗ missing'}`);
  
  return true;
}

async function testVoiceConfiguration() {
  console.log('\n🎙️ Voice Configuration Status...\n');
  
  const defaultVoice = process.env.ELEVENLABS_VOICE_ID;
  console.log(`Default Voice: ${defaultVoice || '✗ not set'}\n`);
  
  console.log('Language-Specific Voices:');
  for (const lang of SUPPORTED_LANGUAGES) {
    const voiceEnvKey = `ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`;
    const voiceId = process.env[voiceEnvKey];
    const status = voiceId ? `✓ ${voiceId}` : '✗ not set (will use default)';
    console.log(`  ${lang.padEnd(10)}: ${status}`);
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('  Language Support Test for TTS & STT');
  console.log('════════════════════════════════════════════════════');
  
  // Check TTS provider
  if (process.env.TTS_PROVIDER !== 'elevenlabs') {
    console.log('\n⚠️  TTS_PROVIDER is not set to "elevenlabs". TTS tests will fail.');
    console.log('   Set TTS_PROVIDER=elevenlabs in your .env file\n');
  }
  
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('\n⚠️  ELEVENLABS_API_KEY is not set. TTS tests will fail.');
    console.log('   Set ELEVENLABS_API_KEY in your .env file\n');
  }
  
  // Test voice configuration
  await testVoiceConfiguration();
  
  // Test STT configuration
  await testSTT();
  
  // Test TTS
  const ttsResults = await testTTS();
  
  // Summary
  console.log('\n════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('════════════════════════════════════════════════════\n');
  
  const ttsSuccess = ttsResults.filter(r => r.success).length;
  const ttsTotal = ttsResults.length;
  
  console.log(`TTS: ${ttsSuccess}/${ttsTotal} languages successful`);
  
  if (ttsSuccess < ttsTotal) {
    console.log('\nFailed languages:');
    ttsResults.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.lang}: ${r.error}`);
    });
  }
  
  console.log('\n💡 Recommendations:');
  console.log('   1. Set language-specific voice IDs for better quality:');
  console.log('      ELEVENLABS_VOICE_ID_TELUGU=<voice-id>');
  console.log('      ELEVENLABS_VOICE_ID_KANNADA=<voice-id>');
  console.log('      etc.');
  console.log('   2. Test STT with actual audio files using: node tools/test-stt-audio.js');
  console.log('   3. Monitor transcription accuracy in production logs');
  
  console.log('\n');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
