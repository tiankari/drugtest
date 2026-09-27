import { execSync } from 'node:child_process';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { serviceWorkerPlugin } from './build/sw-plugin.ts';

function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'uncommitted';
  }
}

// GitHub Pages serves this repo (github.com/tiankari/drugtest) at /drugtest/.
// Production builds and `vite preview` use that path; the dev server stays at /.
// BASE_PATH overrides it (e.g. for a fork under another name).
const PAGES_BASE = '/drugtest/';

export default defineConfig(({ command, mode }) => ({
  base: process.env.BASE_PATH ?? (command === 'serve' && mode !== 'production' ? '/' : PAGES_BASE),
  plugins: [
    // Local HTTPS with a self-signed certificate so a phone on the LAN can use
    // the camera (`npm run dev:https`). Service workers will not register on a
    // self-signed origin; test offline on the GitHub Pages build instead.
    ...(mode === 'https' ? [basicSsl()] : []),
    serviceWorkerPlugin('src/sw/sw.js'),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  server: { host: mode === 'https' ? true : undefined },
}));
