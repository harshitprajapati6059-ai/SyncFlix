/**
 * Build script — bundles each extension entry point with esbuild and copies
 * static assets into dist/. Load dist/ as an unpacked extension in Chrome.
 * A production build also zips dist/ into the website's public/downloads/
 * folder so the site can offer it as a direct download.
 *
 *   node build.mjs           one-shot production build (+ zip)
 *   node build.mjs --watch   rebuild on change (development, no zip)
 */

import { build, context } from 'esbuild';
import { cpSync, mkdirSync, createWriteStream } from 'node:fs';
import { ZipArchive } from 'archiver';

const watch = process.argv.includes('--watch');
const ZIP_OUTPUT = '../public/downloads/syncflix-extension.zip';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: 'src/background.ts',
    bridge: 'src/bridge.ts',
    player: 'src/player.ts',
    'netflix-page': 'src/netflix-page.ts',
    popup: 'src/popup.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife', // content scripts and the service worker run as classic scripts
  target: 'chrome111', // manifest minimum_chrome_version — MAIN-world content scripts need 111
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

mkdirSync('dist', { recursive: true });
cpSync('manifest.json', 'dist/manifest.json');
cpSync('public/popup.html', 'dist/popup.html');
cpSync('public/icons', 'dist/icons', { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  await zipDist();
}

async function zipDist() {
  mkdirSync('../public/downloads', { recursive: true });
  await new Promise((resolve, reject) => {
    const output = createWriteStream(ZIP_OUTPUT);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory('dist', false);
    archive.finalize();
  });
  console.log(`zipped dist/ -> ${ZIP_OUTPUT}`);
}
