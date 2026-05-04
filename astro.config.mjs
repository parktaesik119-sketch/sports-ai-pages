import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 본인의 도메인 주소로 수정하세요
  site: 'https://pick79.com', 
  integrations: [sitemap()],
});