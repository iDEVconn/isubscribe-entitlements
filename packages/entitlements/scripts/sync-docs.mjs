import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const repoRoot = resolve(pkgDir, '..', '..');

const files = ['README.md', 'ARCHITECTURE.md'];
for (const file of files) {
  copyFileSync(resolve(repoRoot, file), resolve(pkgDir, file));
  console.log(`copied ${file} -> packages/entitlements/${file}`);
}
