import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');

for (const file of ['README.md', 'ARCHITECTURE.md']) {
  rmSync(resolve(pkgDir, file), { force: true });
  console.log(`removed packages/entitlements/${file}`);
}
