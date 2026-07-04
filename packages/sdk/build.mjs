import { build } from 'esbuild';
import { watch } from 'fs';
import { existsSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');

if (!existsSync('dist')) mkdirSync('dist');

const shared = {
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'chrome80', 'firefox80', 'safari13'],
  define: { 'process.env.NODE_ENV': '"production"' },
};

// Two outputs: the storefront tracking SDK, and the Web Push service worker (lane:push).
// The service worker must be served from the storefront origin (see routes/push).
const targets = [
  { ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/engageiq.min.js' },
  { ...shared, entryPoints: ['src/service-worker.ts'], outfile: 'dist/eiq-sw.js' },
];

async function buildAll(withMeta = false) {
  const results = [];
  for (const opts of targets) {
    results.push(await build({ ...opts, metafile: withMeta }));
  }
  return results;
}

if (isWatch) {
  await buildAll(false);
  console.log('[sdk] watching for changes...');
  watch('src', { recursive: true }, async () => {
    try {
      await buildAll(false);
      console.log('[sdk] rebuilt');
    } catch (e) {
      console.error('[sdk] build error:', e.message);
    }
  });
} else {
  const results = await buildAll(true);
  for (const result of results) {
    for (const out of Object.keys(result.metafile.outputs)) {
      const { bytes } = result.metafile.outputs[out];
      console.log(`[sdk] ${out} — ${(bytes / 1024).toFixed(2)} KB`);
    }
  }
}
