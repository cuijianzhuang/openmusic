import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression2';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRobotsTxt, buildSitemapXml, resolveDevSiteOrigin } from '../server/seoFiles.js';
import { buildAppVersionMeta, writeVersionJson } from '../scripts/app-version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appVersionMeta = buildAppVersionMeta();
const shouldPrecompress = process.env.OPENMUSIC_PRECOMPRESS === 'true';

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

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(appVersionMeta.buildId),
    __APP_VERSION_NOTES__: JSON.stringify(appVersionMeta.notes),
  },
  plugins: [
    react(),
    seoDevMiddleware(),
    appVersionPlugin(),
    // Nginx already performs gzip compression in the recommended deployment.
    // Precompressing every asset (especially Brotli) can appear to hang on
    // low-memory deployment hosts, so keep it available as an explicit opt-in.
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
    // Avoid recompressing every generated chunk only to print size statistics.
    // This does not change the output; Nginx handles response compression.
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        // 带 content hash，避免 EdgeOne/CDN 长期缓存同名旧包
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            // 聊天相关拆出，避免塞进 Room 主包
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
      // changeOrigin 必须为 false：保留 Host: localhost:5173，
      // 服务端管理接口按 Origin 与 Host 同源放行本地调试请求
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
