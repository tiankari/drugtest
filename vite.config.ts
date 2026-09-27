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

// GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig(({ mode }) => ({
  base,
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
