import dotenv from 'dotenv';
dotenv.config();

(async function(){
  try{
    const { checkTtsEndpoint } = await import('../src/services/ttsService.js');
    const res = await checkTtsEndpoint(5000);
    console.log('TTS check result:', JSON.stringify(res, null, 2));
  }catch(err){
    console.error('Error running TTS check:', err.response?.data || err.message || err);
  }
})();