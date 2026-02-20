import fs from 'fs';
import path from 'path';
const file = 'src/controllers/whatsappController.js';
const txt = fs.readFileSync(file,'utf8');

function skipSpaceAndComments(s, i) {
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (s.startsWith('//', i)) { i = s.indexOf('\n', i + 2); if (i === -1) return s.length; continue; }
    if (s.startsWith('/*', i)) { const end = s.indexOf('*/', i+2); if (end === -1) return s.length; i = end + 2; continue; }
    break;
  }
  return i;
}

let idx = 0;
let problems = [];
while (true) {
  const t = txt.indexOf('try', idx);
  if (t === -1) break;
  // ensure 'try' is a standalone word and followed by space and '{'
  const after = t + 3;
  const between = txt.slice(t, after+5);
  const bracePos = txt.indexOf('{', after);
  if (bracePos === -1) break;
  // find matching closing brace
  let depth = 1; let i = bracePos + 1;
  for (; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0) break;
  }
  if (i >= txt.length) { problems.push({pos:t, reason:'unclosed try block', context: txt.slice(Math.max(0,t-50), Math.min(txt.length, t+200))}); idx = t + 3; continue; }
  // skip spaces/comments after i
  let j = skipSpaceAndComments(txt, i+1);
  const nextToken = txt.slice(j, j+10);
  if (!/^(catch\b|finally\b)/.test(nextToken)) {
    problems.push({pos:t, reason:'no catch/finally after try', context: txt.slice(Math.max(0,t-50), Math.min(txt.length, t+200)), nextToken: nextToken.slice(0,80)});
  }
  idx = i + 1;
}
console.log('problems:', problems.length);
for(const p of problems) console.log('\n---\n', p);
