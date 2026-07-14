/**
 * Build script — bundles each extension entry point with esbuild and copies
 * static assets into dist/. Load dist/ as an unpacked extension in Chrome.
 *
 *   node build.mjs           one-shot production build
 *   node build.mjs --watch   rebuild on change (development)
 */

import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: 'src/background.ts',
    bridge: 'src/bridge.ts',
    player: 'src/player.ts',
    popup: 'src/popup.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife', // content scripts and the service worker run as classic scripts
  target: 'chrome110',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

mkdirSync('dist', { recursive: true });
cpSync('manifest.json', 'dist/manifest.json');
cpSync('public/popup.html', 'dist/popup.html');

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
