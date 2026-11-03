import { defineConfig } from 'vite';

// Render sets RENDER during its builds and serves the app from the root. Everywhere
// else it's the Cloudflare build at zhangzhan.work/locked-letters/, whose Worker
// strips that prefix again.
const site = process.env.RENDER
  ? { base: '/', email: 'zhang.zhan@akqa.com' }
  : { base: '/locked-letters/', email: 'hi@zhangzhan.work' };

export default defineConfig({
  base: site.base,
  plugins: [
    {
      name: 'contact-email',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('%CONTACT_EMAIL%', site.email),
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      [`${site.base}api`]: 'http://127.0.0.1:8787',
    },
  },
});
