const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

const mergeEditorConfig = {
  entryPoints: ['src/webviews/mergeEditor/index.tsx'],
  bundle: true,
  outfile: 'dist/webviews/mergeEditor/index.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  loader: { '.wasm': 'binary' },
  logLevel: 'info',
};

const gitGraphConfig = {
  entryPoints: ['src/webviews/gitGraph/index.tsx'],
  bundle: true,
  outfile: 'dist/webviews/gitGraph/index.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

const rebaseConfig = {
  entryPoints: ['src/webviews/rebase/index.tsx'],
  bundle: true,
  outfile: 'dist/webviews/rebase/index.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

const hunkPickerConfig = {
  entryPoints: ['src/webviews/hunkPicker/index.tsx'],
  bundle: true,
  outfile: 'dist/webviews/hunkPicker/index.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

const configs = [extensionConfig, mergeEditorConfig, gitGraphConfig, rebaseConfig, hunkPickerConfig];

(async () => {
  try {
    if (watch) {
      const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
      await Promise.all(ctxs.map((c) => c.watch()));
      console.log('[forge] watching...');
    } else {
      await Promise.all(configs.map((c) => esbuild.build(c)));
      console.log('[forge] build complete');
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
