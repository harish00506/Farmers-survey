import fs from 'fs';
import path from 'path';

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const full = path.join(dir, f);
    const stats = fs.statSync(full);
    if (stats.isDirectory()) return scanDir(full);
    if (!full.endsWith('.js') && !full.endsWith('.mjs')) return;
    const txt = fs.readFileSync(full, 'utf8');
    const tries = (txt.match(/\btry\s*\{/g) || []).length;
    const catches = (txt.match(/\bcatch\s*\(/g) || []).length;
    const finals = (txt.match(/\bfinally\s*\{/g) || []).length;
    if (tries !== (catches + finals)) {
      console.log(`${full}: try=${tries}, catch=${catches}, finally=${finals}`);
    }
  });
}

scanDir(path.join('.', 'src'));
