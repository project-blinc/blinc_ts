// Compile-time CSS: the Vite plugin compiles .css imports with the native
// engine, exports the bytes and frozen names, writes .d.css.ts declarations,
// and fails the build at an error's file, line and column.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createBuilder } from 'vite';
import { blinc, blincCss } from '../dist/vite.js';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';

const fixtures = new URL('../.test-fixtures/', import.meta.url);
await mkdir(fixtures, { recursive: true });
const dir = await mkdtemp(fileURLToPath(new URL('vite-css-', fixtures)));
const bundle = (entry, outDir) =>
  build({
    configFile: false,
    logLevel: 'silent',
    plugins: [blincCss()],
    build: {
      outDir,
      lib: { entry, formats: ['es'], fileName: () => 'out.mjs' },
      rollupOptions: { external: [/^node:/] },
    },
  });
try {
  await writeFile(join(dir, 'tokens.css'), ':root { --accent: #3d7eff; }\n');
  await writeFile(
    join(dir, 'card.css'),
    [
      "@import './tokens.css';",
      '.card { width: 120px; height: 40px; background: var(--accent); }',
      '.title { font-size: 20px; }',
      '@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'entry.mjs'),
    "export { default as sheet, classes, vars, keyframes } from './card.css';\n",
  );
  await bundle(join(dir, 'entry.mjs'), join(dir, 'out'));
  const mod = await import(pathToFileURL(join(dir, 'out', 'out.mjs')).href);
  assert(mod.sheet instanceof Uint8Array && mod.sheet.length > 16);
  assert.deepEqual(mod.classes, { card: 'card', title: 'title' });
  assert(Object.isFrozen(mod.classes) && Object.isFrozen(mod.vars));
  assert.deepEqual(mod.vars, { accent: '--accent' }, 'Variables from an import');
  assert.deepEqual(mod.keyframes, { pulse: 'pulse' });

  // The compiled bytes style a host with no parsing at run time.
  const host = Host.create(loadNative());
  host.layout.addStyleSheet(mod.sheet);
  const card = host.root.appendChild(host.createElement('div'));
  card.className = mod.classes.card;
  host.compute(300, 200);
  assert.deepEqual(card.bounds(), [0, 0, 120, 40]);
  host.dispose();

  // Declarations for TypeScript: a misspelt class name is a compile error.
  const types = await readFile(join(dir, 'card.d.css.ts'), 'utf8');
  assert.match(types, /readonly "card": "card"/);
  await writeFile(
    join(dir, 'use.ts'),
    "import sheet, { classes } from './card.css';\nconst a: Uint8Array = sheet;\nconst b: 'card' = classes.card;\nconst c = classes.titel;\nexport { a, b, c };\n",
  );
  const tsc = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
      '--noEmit',
      '--strict',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      '--allowArbitraryExtensions',
      '--skipLibCheck',
      '--ignoreConfig',
      join(dir, 'use.ts'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(tsc.status, 2, tsc.stdout + tsc.stderr);
  assert.match(tsc.stdout, /use\.ts\(4,19\): error TS2551: .*titel.*Did you mean 'title'/);
  assert.doesNotMatch(tsc.stdout, /use\.ts\([123],/);

  // An error fails the build at its file, line and column.
  await writeFile(join(dir, 'broken.css'), '.ok { width: 10px; }\n.bad { color: red\n');
  await writeFile(join(dir, 'broken.mjs'), "export { default } from './broken.css';\n");
  await assert.rejects(bundle(join(dir, 'broken.mjs'), join(dir, 'out2')), (error) => {
    assert.match(error.message, /not closed/);
    // The bundler reports where: the sheet's path, then line and column.
    const at = new RegExp(
      `${join(dir, 'broken.css').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`,
    ).exec(error.message);
    assert(at, error.message);
    assert(Number(at[1]) >= 2, error.message);
    return true;
  });

  // A TypeScript resolver, as rollup's TypeScript plugin is, answers './card.css' with the
  // declarations beside it; the sheet is what is compiled all the same.
  const plugin = blincCss();
  const resolvedTo = (id) =>
    plugin.resolveId.call(
      { resolve: async () => ({ id, external: false }) },
      './card.css',
      join(dir, 'entry.mjs'),
    );
  assert.equal(
    await resolvedTo(join(dir, 'card.d.css.ts')),
    `\0blinc-css:${join(dir, 'card.css')}.js`,
    'the sheet, not its types',
  );
  assert.equal(await resolvedTo(join(dir, 'card.css')), `\0blinc-css:${join(dir, 'card.css')}.js`);

  // An app built in the Blinc environment: in the app's own outDir, with the SDK left to load
  // its addon from where it is installed, and it runs.
  await writeFile(
    join(dir, 'app.mjs'),
    [
      "import { loadNative } from 'blinc_ts/native';",
      "import { Host } from 'blinc_ts/native/host';",
      "import sheet, { classes } from './card.css';",
      'const host = Host.create(loadNative());',
      'host.layout.addStyleSheet(sheet);',
      "const card = host.root.appendChild(host.createElement('div'));",
      'card.className = classes.card;',
      'host.compute(300, 200);',
      'console.log(card.bounds().join(","));',
      'host.dispose();',
      '',
    ].join('\n'),
  );
  const builder = await createBuilder({
    root: dir,
    configFile: false,
    logLevel: 'silent',
    plugins: [blinc(), blincCss({ declarations: false })],
    environments: {
      blinc: {
        build: { outDir: join(dir, 'app-out'), rollupOptions: { input: join(dir, 'app.mjs') } },
      },
    },
  });
  await builder.build(builder.environments.blinc);
  const built = await readFile(join(dir, 'app-out', 'app.js'), 'utf8');
  assert.match(built, /from "blinc_ts\/native"/, 'the SDK is imported, not bundled');
  assert.doesNotMatch(built, /createRequire/, 'none of its loader is in the bundle');
  const run = spawnSync(process.execPath, [join(dir, 'app-out', 'app.js')], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '0,0,120,40', 'and the built app runs');
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log('Vite CSS: compiled imports, frozen names, declarations and build errors passed');
