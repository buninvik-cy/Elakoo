import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('./config/elakoo.config.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: config.siteUrl || 'https://elakoo.com',
  trailingSlash: 'always',
  output: 'static',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
});
