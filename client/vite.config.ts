import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applySeoToHtml,
  buildRobotsTxt,
  buildSitemapXml,
  resolveDevSiteOrigin,
  resolvePrimarySiteOrigin,
} from '../server/seoFiles.js';
import { buildAppVersionMeta, writeVersionJson } from '../scripts/app-version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appVersionMeta = buildAppVersionMeta();
const shouldPrecompress = process.env.OPENMUSIC_PRECOMPRESS === 'true';

/** 构建期规范主域：优先 SITE_CANONICAL_URL，否则 CLIENT_URL 首项 */
const BUILD_SITE_ORIGIN = resolvePrimarySiteOrigin(
  process.env.CLIENT_URL || '',
  process.env.SITE_CANONICAL_URL || '',
) || 'https://qqovo.top';

function seoDevMiddleware() {
  return {
    name: 'openmusic-seo-dev',
    enforce: 'pre' as const,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0];
        if (pathname !== '/sitemap.xml' && pathname !== '/robots.txt') {
          next();
          return;
        }

        const origin = resolveDevSiteOrigin(req);
        const body = pathname === '/robots.txt' ? buildRobotsTxt(origin) : buildSitemapXml(origin);
        res.setHeader('Content-Type', pathname === '/robots.txt' ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8');
        res.end(body);
      });
    },
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string, ctx: { server?: unknown }) {
        // 仅开发服务器替换；生产构建交给 seoBuildPlugin，避免写成 localhost
        if (!ctx.server) return html;
        return applySeoToHtml(html, {
          siteOrigin: resolveDevSiteOrigin({ headers: { host: 'localhost:5173' } }),
          baiduVerification: process.env.SITE_BAIDU_VERIFICATION || '',
        });
      },
    },
  };
}

/** 构建产物写入 version.json，供 /api/app-version 与更新检测使用 */
function appVersionPlugin(): Plugin {
  return {
    name: 'openmusic-app-version',
    apply: 'build',
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir || path.join(__dirname, 'dist');
      const filePath = writeVersionJson(outDir, appVersionMeta);
      console.log(`[app-version] ${appVersionMeta.buildId} → ${filePath}`);
      console.log(`  forcePrompt: ${appVersionMeta.forcePrompt ? 'yes' : 'no'}`);
      if (appVersionMeta.notes.length) {
        for (const note of appVersionMeta.notes) {
          console.log(`  - ${note}`);
        }
      }
    },
  };
}

/** 生产构建：绝对 URL 注入 + 静态 robots/sitemap 托底 */
function seoBuildPlugin(): Plugin {
  return {
    name: 'openmusic-seo-build',
    apply: 'build',
    transformIndexHtml(html) {
      console.log(`[seo] site origin → ${BUILD_SITE_ORIGIN}`);
      const withSeo = applySeoToHtml(html, {
        siteOrigin: BUILD_SITE_ORIGIN,
        baiduVerification: process.env.SITE_BAIDU_VERIFICATION || '',
      });
      return withSeo;
    },
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir || path.join(__dirname, 'dist');
      fs.writeFileSync(path.join(outDir, 'robots.txt'), buildRobotsTxt(BUILD_SITE_ORIGIN), 'utf8');
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemapXml(BUILD_SITE_ORIGIN), 'utf8');
      console.log(`[seo] wrote robots.txt & sitemap.xml → ${BUILD_SITE_ORIGIN}`);
    },
  };
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(appVersionMeta.buildId),
    __APP_VERSION_NOTES__: JSON.stringify(appVersionMeta.notes),
  },
  plugins: [
    react(),
    seoDevMiddleware(),
    seoBuildPlugin(),
    appVersionPlugin(),
    ...(shouldPrecompress
      ? [compression({
          threshold: 1024,
          algorithms: ['gzip', 'brotliCompress'],
          skipIfLargerOrEqual: true,
        })]
      : []),
  ],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            if (
              id.includes('/components/Chat')
              || id.includes('/components/Sticker')
              || id.includes('/components/UserSticker')
              || id.includes('/lib/chat')
              || id.includes('/lib/qface')
              || id.includes('/stores/chat')
            ) {
              return 'chat-ui';
            }
            if (id.includes('/components/queue/') || id.includes('/components/QueuePanel')) {
              return 'queue-ui';
            }
            return;
          }
          if (id.includes('antd') || id.includes('@ant-design')) {
            return 'antd-vendor';
          }
          if (id.includes('three') || id.includes('@react-three') || id.includes('@mediapipe')) {
            return;
          }
          if (id.includes('socket.io-client')) {
            return 'socket-vendor';
          }
          if (id.includes('lucide-react')) {
            return 'icons-vendor';
          }
          if (id.includes('zustand')) {
            return 'zustand-vendor';
          }
          if (id.includes('react-window')) {
            return 'window-vendor';
          }
          if (
            id.includes('react-dom')
            || id.includes('react-router')
            || /[/\\]react[/\\]/.test(id)
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  esbuild: {
    drop: ['debugger'],
    legalComments: 'none',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/wx-proxy': { target: 'http://localhost:4000', changeOrigin: false },
      '/cgi-bin': { target: 'http://localhost:4000', changeOrigin: false },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
