import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';

(async function(){
  try{
    const res = await axios.post('http://localhost:3000/api/admin/tts', { enabled: true }, { timeout: 10000 });
    console.log('Server response:', res.data);
  }catch(err){
    console.error('Error calling server:', err.response?.data || err.message);
  }
})();