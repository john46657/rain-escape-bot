/**
 * Gemeinsames Build-Script fuer Bot und API.
 *
 * Die internen Pakete (@nexus/*) werden als "source-only packages" eingebunden:
 * TypeScript loest sie ueber tsconfig-Paths auf, esbuild bundelt sie mit.
 * Dadurch entfaellt eine langsame, mehrstufige tsc-Build-Kette im Monorepo.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [entry, outfile] = process.argv.slice(2);

if (!entry || !outfile) {
  console.error('Verwendung: node scripts/build.mjs <entry> <outfile>');
  process.exit(1);
}

const base = JSON.parse(readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8'));
const alias = Object.fromEntries(
  Object.entries(base.compilerOptions.paths)
    .filter(([key]) => !key.includes('*'))
    .map(([key, [value]]) => [key, resolve(root, value)]),
);

await build({
  entryPoints: [resolve(root, entry)],
  outfile: resolve(root, outfile),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  alias,
  // Native/optionale Abhaengigkeiten bleiben extern.
  external: ['@prisma/client', '.prisma/client', 'ioredis', 'bufferutil', 'utf-8-validate', 'zlib-sync'],
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});

console.log(`[build] ${entry} -> ${outfile}`);
