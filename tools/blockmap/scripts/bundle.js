// Writes the board as a standalone folder that runs anywhere static files are served: the page,
// the browser modules, and a snapshot of the board (with sample files for the simulated crew) at
// demo/board.json. With no board server behind it, the page runs the simulated crew.
//
//   node tools/blockmap/scripts/bundle.js --out <dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, findBoardDir } from '../core/store.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME = ['core/palette.js', 'core/storeKit.js', 'core/colormaps.js', 'core/themeVars.js', 'core/appTheme.js', 'core/nativeAccent.js', 'theme.css', 'controls.css', 'kit.css', 'controls.js', 'index.js'].map((f) => `ui/theme/${f}`);
const BROWSER = ['ui/app.js', 'ui/dom.js', 'ui/dnd.js', 'ui/inspector.js', 'ui/map.js', 'ui/sim.js', 'ui/source.js', 'ui/tethers.js', 'ui/timeline.js', 'ui/windows.js', 'ui/worktrees.js', 'ui/styles.css', ...THEME, 'core/model.js', 'core/glob.js', 'core/merges.js'];

export function bundle(out) {
  const store = openStore(findBoardDir());
  const board = store.board({ items: true, files: true, samples: 14 });
  fs.mkdirSync(path.join(out, 'demo'), { recursive: true });
  for (const rel of BROWSER) {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.copyFileSync(path.join(HERE, rel), path.join(out, rel));
  }
  const page = fs.readFileSync(path.join(HERE, 'ui', 'index.html'), 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${board.name} Blockmap</title>`);
  fs.writeFileSync(path.join(out, 'index.html'), page);
  fs.writeFileSync(path.join(out, 'demo', 'board.json'), JSON.stringify(board));
  return { out, files: ['index.html', 'demo/board.json', ...BROWSER] };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--out');
  const out = path.resolve(i > 0 ? process.argv[i + 1] : 'blockmap-standalone');
  const res = bundle(out);
  console.log(`Wrote ${res.files.length} files to ${res.out}. Serve the folder (any static server) and open index.html.`);
}
