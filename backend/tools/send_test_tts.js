import dotenv from 'dotenv';
dotenv.config();

(async function(){
  try {
    const { synthesizeText } = await import('../src/services/ttsService.js');
    const { sendWhatsAppAudio } = await import('../src/controllers/whatsappController.js');
    const phone = process.env.WHATSAPP_TEST_PHONE_NUMBER || process.env.WHATSAPP_BUSINESS_NUMBER;
    if (!phone) throw new Error('No test phone configured');

    const t = await synthesizeText('This is a test of the ElevenLabs voice.', { format: 'mp3' });
    console.log('synth result:', t);
    const id = await sendWhatsAppAudio(phone, t.filePath, t.mimeType);
    console.log('sent audio, media id:', id);
  } catch (err) {
    console.error('Error sending test TTS:');
    console.error(err.stack || err.response?.data || err.message || err);
  }
})();