import dotenv from 'dotenv';
dotenv.config();

(async function(){
  try{
    await import('../src/controllers/whatsappController.js');
    console.log('Whatsapp controller imported ok');
  }catch(err){
    console.error('Import failed:', err.stack || err.message || err);
  }
})();