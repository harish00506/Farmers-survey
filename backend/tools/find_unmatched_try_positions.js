import fs from 'fs';
const file = 'src/controllers/whatsappController.js';
const txt = fs.readFileSync(file,'utf8');
let idx = 0;
let problems = [];
while (true) {
  const t = txt.indexOf('try {', idx);
  if (t === -1) break;
  // find matching closing brace for the try block
  let pos = t + 4; // position after 'try'
  // find the opening brace '{'
  pos = txt.indexOf('{', t);
  if (pos === -1) break;
  let depth = 1;
  let i = pos + 1;
  for (; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0) break;
  }
  const endPos = i; // end of try block
  // search for 'catch' or 'finally' after endPos within next 200 chars
  const next = txt.slice(endPos+1, endPos + 500);
  const hasCatch = /\bcatch\b/.test(next);
  const hasFinally = /\bfinally\b/.test(next);
  if (!hasCatch && !hasFinally) {
    problems.push({pos:t, context: txt.slice(Math.max(0,t-100), Math.min(txt.length,t+300))});
  }
  idx = endPos+1;
}
console.log('problems:', problems.length);
for(const p of problems){
  console.log('\n---\n', p.context);
}
