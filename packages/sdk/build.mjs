import { build } from 'esbuild';
import { watch } from 'fs';
import { existsSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');

if (!existsSync('dist')) mkdirSync('dist');

const buildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'chrome80', 'firefox80', 'safari13'],
  outfile: 'dist/engageiq.min.js',
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (isWatch) {
  const ctx = await build({ ...buildOptions, metafile: false });
  console.log('[sdk] watching for changes...');
  watch('src', { recursive: true }, async () => {
    try {
      await build(buildOptions);
      console.log('[sdk] rebuilt');
    } catch (e) {
      console.error('[sdk] build error:', e.message);
    }
  });
} else {
  const result = await build({ ...buildOptions, metafile: true });
  const outputs = Object.keys(result.metafile.outputs);
  for (const out of outputs) {
    const { bytes } = result.metafile.outputs[out];
    console.log(`[sdk] ${out} — ${(bytes / 1024).toFixed(2)} KB`);
  }
}
