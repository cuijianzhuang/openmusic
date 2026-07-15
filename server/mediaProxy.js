import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export const DEFAULT_MEDIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function hostnameOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isKugouHost(host) {
  return Boolean(
    host
    && (host.includes('kugou') || host.includes('kgimg') || /\.kg(cdn|img)?\./i.test(host)),
  );
}

/**
 * 按 CDN 域名选 Referer（酷狗 CDN 对 Referer 不敏感，但其它源可能需要）。
 */
export function refererForMediaUrl(rawUrl) {
  const host = hostnameOf(rawUrl);
  if (isKugouHost(host)) return 'https://www.kugou.com/';
  if (
    host.includes('gtimg')
    || host.includes('qq.com')
    || host.includes('tencentmusic')
    || host.includes('y.qq')
  ) {
    return 'https://y.qq.com/';
  }
  if (host.includes('126.net') || host.includes('163.com') || host.includes('netease')) {
    return 'https://music.163.com/';
  }
  return 'https://music.163.com/';
}

/**
 * 部分 CDN 可用 https；酷狗 youthandroid 等节点证书不可靠，禁止升协议（升了会 502/反复重试表现为卡顿）。
 */
export function preferHttpsMediaUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url.toLowerCase().startsWith('http://')) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (isKugouHost(host)) return url;
    const canUpgrade =
      host.includes('126.net')
      || host.includes('163.com')
      || host.includes('gtimg')
      || host.includes('qq.com')
      || host.includes('tencentmusic');
    if (!canUpgrade) return url;
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeAudioContentType(contentType) {
  if (!contentType) return contentType;
  // 部分浏览器对 audio/x-flac 支持更差
  if (/^audio\/x-flac\b/i.test(contentType)) return 'audio/flac';
  return contentType;
}

function shouldBufferResponse(contentType, options) {
  if (options.forceBuffer) return true;
  if (options.thumbPx > 0) return true;
  if (contentType && /^image\//i.test(contentType)) return true;
  return false;
}

function isAudioStream(contentType, range) {
  if (range) return true;
  return Boolean(contentType && /^(audio|video|application\/octet-stream)\b/i.test(contentType));
}

/**
 * 从上游拉取媒体并返回给客户端。
 * 图片/缩略图整包缓冲；音频 Range 流式转发（勿中途 abort body）。
 */
export async function serveUpstreamMedia(rawUrl, res, fetchWithTimeout, options = {}) {
  const fetchUrl = preferHttpsMediaUrl(rawUrl);
  const headers = {
    'User-Agent': DEFAULT_MEDIA_UA,
    Accept: '*/*',
    // 避免上游错误地压缩音频流
    'Accept-Encoding': 'identity',
    Referer: options.referer || refererForMediaUrl(fetchUrl),
    ...(options.headers || {}),
  };

  const range = String(options.range || '').trim();
  if (range) headers.Range = range;

  let response;
  try {
    // timeout 只约束建连+响应头；fetch resolve 后会清除 abort，body 可持续流
    response = await fetchWithTimeout(
      fetchUrl,
      { headers, redirect: 'follow' },
      options.timeoutMs || 20000,
    );
  } catch {
    if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
    return false;
  }

  if (!response.ok && response.status !== 206) {
    if (!res.headersSent) res.status(response.status).json({ error: '上游媒体请求失败' });
    return false;
  }

  const rawType = response.headers.get('content-type') || '';
  const contentType = normalizeAudioContentType(rawType);
  const useBuffer = shouldBufferResponse(rawType, options) && !isAudioStream(rawType, range);

  res.set('Cache-Control', 'public, max-age=3600');
  res.set('X-OpenMusic-Proxy', '1');

  if (useBuffer) {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (res.writableEnded || res.destroyed) return false;
      if (contentType) res.set('Content-Type', contentType);
      res.status(200).send(buffer);
      return true;
    } catch {
      if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
      return false;
    }
  }

  if (contentType) res.set('Content-Type', contentType);
  for (const header of ['accept-ranges', 'content-length', 'content-range']) {
    const value = response.headers.get(header);
    if (value) res.set(header, value);
  }

  if (!response.body) {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.status(response.status).send(buffer);
      return true;
    } catch {
      if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
      return false;
    }
  }

  const stream = Readable.fromWeb(response.body);
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
    stream.destroy();
  });

  res.status(response.status);
  try {
    await pipeline(stream, res);
    return true;
  } catch {
    if (clientGone) return false;
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
    return false;
  }
}

/** @deprecated 使用 serveUpstreamMedia */
export const pipeUpstreamMedia = serveUpstreamMedia;
