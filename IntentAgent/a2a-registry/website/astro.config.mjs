import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

const outDir = process.env.ASTRO_OUT_DIR || '../docs';

/** Subpath when served behind Caddy at https://host/a2a-registry/ */
function astroBase() {
  const raw = process.env.PUBLIC_SITE_BASE?.trim();
  if (!raw || raw === '/') return '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/$/, '') || '/';
}

const basePath = astroBase();

/** Parsed public URL for dev behind HTTPS (VITE_DEV_ORIGIN). */
function viteDevPublicUrl() {
  const raw = process.env.VITE_DEV_ORIGIN?.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

const devPublic = viteDevPublicUrl();

export default defineConfig({
  site: 'https://a2aregistry.org',
  base: basePath,
  outDir,
  trailingSlash: 'ignore',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    sitemap({ filter: (page) => !page.includes('/admin') }),
  ],
  build: {
    assets: 'assets',
    inlineStylesheets: 'auto',
  },
  vite: {
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
    server: {
      host: '0.0.0.0',
      // When running behind Caddy at https://start5g-1.cs.uit.no/a2a-registry/,
      // Vite will reject the Host header unless explicitly allowed.
      allowedHosts: ['start5g-1.cs.uit.no'],
      // Ensure websocket/HMR works when the browser connects via HTTPS+proxy.
      ...(devPublic
        ? {
            hmr: {
              protocol: devPublic.protocol === 'https:' ? 'wss' : 'ws',
              host: devPublic.hostname,
              clientPort: devPublic.port
                ? Number(devPublic.port)
                : devPublic.protocol === 'https:'
                  ? 443
                  : 80,
            },
          }
        : {}),
    },
  },
});
