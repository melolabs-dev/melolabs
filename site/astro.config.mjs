import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL vem do ambiente de build (Cloudflare Pages); sem ele usa um valor provisório.
const site = process.env.SITE_URL || 'https://melolabs.net';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
