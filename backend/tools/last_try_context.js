import fs from 'fs';
const file = 'src/controllers/whatsappController.js';
const txt = fs.readFileSync(file,'utf8');
const idx = txt.lastIndexOf('try {');
console.log('last try index:', idx);
console.log(txt.slice(Math.max(0,idx-200), Math.min(txt.length, idx+800)));
