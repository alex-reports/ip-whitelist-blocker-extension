#!/usr/bin/env node
// generate-icons.js
// Generates PNG icons at 4 sizes from an inline SVG design.
// Run: npm run icons
// Requires: npm install sharp (dev dependency)

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// ─── SVG design ──────────────────────────────────────────────────────────────
// Shield shape with an IP lock icon — dark security aesthetic
// Uses the same accent blue (#3b82f6) from the extension design system

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <!-- Background circle -->
  <circle cx="64" cy="64" r="64" fill="#0d1117"/>

  <!-- Shield body -->
  <path d="M64 18 L96 30 L96 64 C96 84 80 100 64 108 C48 100 32 84 32 64 L32 30 Z"
        fill="#161b22" stroke="#3b82f6" stroke-width="3"/>

  <!-- Lock shackle -->
  <path d="M52 58 L52 50 C52 41 76 41 76 50 L76 58"
        fill="none" stroke="#3b82f6" stroke-width="5" stroke-linecap="round"/>

  <!-- Lock body -->
  <rect x="46" y="57" width="36" height="26" rx="5" fill="#3b82f6"/>

  <!-- Keyhole -->
  <circle cx="64" cy="68" r="4" fill="#0d1117"/>
  <rect x="61" y="68" width="6" height="8" rx="2" fill="#0d1117"/>
</svg>`;

// ─── Sizes to generate ────────────────────────────────────────────────────────

const SIZES = [16, 32, 48, 128];

async function main() {
  const iconsDir = path.join(__dirname, 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir);
    console.log('Created icons/ directory');
  }

  for (const size of SIZES) {
    const outPath = path.join(iconsDir, `icon${size}.png`);
    await sharp(Buffer.from(SVG))
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`✓ Generated ${outPath}`);
  }

  console.log('\nAll icons generated successfully!');
  console.log('Icons are referenced in manifest.json under "icons" and "action.default_icon".');
}

main().catch(err => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
