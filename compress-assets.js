/**
 * compress-assets.js
 * Compresses PNG assets for the Yupi AR game.
 * Run: node compress-assets.js
 * Requires: npm install sharp
 */
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const ASSETS_DIR = path.join(__dirname, 'assets');

// Config: [filename, maxWidth, maxHeight, quality]
const targets = [
  // stadium used only as a distant sprite — 800px wide WebP is plenty
  { file: 'stadium.png', w: 800,  h: 300,  q: 72 },
  // keeper overlaid as a sprite at ~2.2x2.8 units — 512 wide is crisp enough
  { file: 'keeper.png',  w: 512,  h: 700,  q: 78 },
  // ball.png used on the start screen (small on mobile)
  { file: 'ball.png',    w: 400,  h: 400,  q: 78 },
  // logo used in several screens but never very large
  { file: 'logo.png',   w: 400,  h: 200,  q: 80 },
];

(async () => {
  for (const { file, w, h, q } of targets) {
    const src  = path.join(ASSETS_DIR, file);
    const dest = path.join(ASSETS_DIR, file); // overwrite in-place (backup first)

    if (!fs.existsSync(src)) { console.warn(`SKIP (not found): ${file}`); continue; }

    const before = fs.statSync(src).size;

    // Backup original
    const bak = src + '.orig';
    if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);

    await sharp(src)
      .resize(w, h, { fit: 'inside', withoutEnlargement: true })
      .png({ quality: q, compressionLevel: 9, palette: false })
      .toFile(dest + '.tmp');

    fs.renameSync(dest + '.tmp', dest);

    const after = fs.statSync(dest).size;
    const pct   = (100 * (before - after) / before).toFixed(0);
    console.log(`✓ ${file}: ${(before/1024).toFixed(0)} KB → ${(after/1024).toFixed(0)} KB  (-${pct}%)`);
  }
  console.log('\nDone! Originals saved as *.orig in assets/');
})();
