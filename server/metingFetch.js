import https from 'node:https';
import http from 'node:http';

// 支持逗号分隔的多上游（与 metingUpstream.js 的解析保持一致）
const metingHosts = new Set(
  String(process.env.METING_API_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((base) => {
      try {
        return new URL(base).hostname;
      } catch {
        return '';
      }
    })
    .filter(Boolean),
);

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function isMetingUrl(url) {
  if (metingHosts.size === 0) return false;
  try {
    return metingHosts.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function requestOnce(url, options = {}, timeoutMs = 10000) {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent: isHttps && isMetingUrl(url) ? insecureHttpsAgent : undefined,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const text = () => body.toString('utf8');
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          headers: {
            get: (name) => res.headers[String(name).toLowerCase()] ?? null,
          },
          text: async () => text(),
          json: async () => JSON.parse(text()),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Meting 请求超时'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Meting 镜像站证书链在 Node 下常无法校验，浏览器可访问但 fetch 会失败 */
export async function fetchMeting(url, options = {}, timeoutMs = 10000) {
  return requestOnce(url, options, timeoutMs);
}

export function formatMetingFetchError(err) {
  const cause = err?.cause;
  if (cause?.code) return `${err?.message || 'fetch failed'} (${cause.code})`;
  if (cause?.message) return `${err?.message || 'fetch failed'} (${cause.message})`;
  return err?.message || 'fetch failed';
}
