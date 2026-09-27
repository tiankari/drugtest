// Vite plugin: after the build is written, list every file in dist/ and emit
// dist/sw.js with that precache list and a content-derived cache version.
// Avoids a Workbox dependency; the service worker template is src/sw/sw.js.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

export function serviceWorkerPlugin(templatePath: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'fdtc-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const outDir = config.build.outDir;
      const files = listFiles(outDir)
        .map((p) => relative(outDir, p).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const version = hash.digest('hex').slice(0, 16);
      const template = readFileSync(templatePath, 'utf8');
      const sw = template
        .replace('__PRECACHE_FILES__', JSON.stringify(['./', ...files], null, 2))
        .replace('__CACHE_VERSION__', JSON.stringify(version));
      writeFileSync(join(outDir, 'sw.js'), sw);
      config.logger.info(`[sw] precache ${files.length + 1} entries, version ${version}`);
    },
  };
}
