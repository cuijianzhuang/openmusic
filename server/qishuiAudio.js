import crypto from 'node:crypto';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const audioCache = new Map();
const inflightLoads = new Map();
let cacheBytes = 0;

function cacheKeyForUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const supplied = String(url.searchParams.get('k') || '').trim();
    if (supplied) return supplied;
    url.searchParams.delete('t');
    return crypto.createHash('sha1').update(url.toString()).digest('hex');
  } catch {
    return crypto.createHash('sha1').update(String(rawUrl || '')).digest('hex');
  }
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of audioCache) {
    if (now - entry.at > CACHE_TTL_MS) {
      audioCache.delete(key);
      cacheBytes -= entry.buffer.length;
    }
  }
  if (cacheBytes <= MAX_CACHE_BYTES) return;
  const oldest = [...audioCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [key, entry] of oldest) {
    if (cacheBytes <= MAX_CACHE_BYTES) break;
    audioCache.delete(key);
    cacheBytes -= entry.buffer.length;
  }
}

const cacheCleanupTimer = setInterval(pruneCache, 10 * 60 * 1000);
cacheCleanupTimer.unref?.();

function readCache(key) {
  const entry = audioCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    audioCache.delete(key);
    cacheBytes -= entry.buffer.length;
    return null;
  }
  entry.at = Date.now();
  return { ...entry, cacheHit: true };
}

function writeCache(key, value) {
  const existing = audioCache.get(key);
  if (existing) cacheBytes -= existing.buffer.length;
  audioCache.set(key, { ...value, at: Date.now() });
  cacheBytes += value.buffer.length;
  pruneCache();
}

export async function loadQishuiAudioCached(rawUrl, fetchRaw) {
  const key = cacheKeyForUrl(rawUrl);
  const cached = readCache(key);
  if (cached) return { ...cached, cacheKey: key };
  if (inflightLoads.has(key)) return { ...(await inflightLoads.get(key)), cacheHit: true, cacheKey: key };

  const task = (async () => {
    const upstream = await fetchRaw();
    if (!upstream.ok) throw new Error(`汽水原始音频请求失败: ${upstream.status}`);
    const auth = String(upstream.headers.get('x-qishui-auth') || '').trim();
    if (!auth) throw new Error('汽水音频密钥缺失');
    const decrypted = decryptQishuiAudio(Buffer.from(await upstream.arrayBuffer()), auth);
    writeCache(key, decrypted);
    return { ...decrypted, cacheHit: false, cacheKey: key };
  })();
  inflightLoads.set(key, task);
  try {
    return await task;
  } finally {
    inflightLoads.delete(key);
  }
}

function bitCount(input) {
  let value = input;
  value -= (value >> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
  return (((value + (value >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function decodeSpadeA(value) {
  const source = Buffer.from(String(value || ''), 'base64');
  if (source.length < 3) return '';
  const padding = (source[0] ^ source[1] ^ source[2]) - 48;
  if (padding < 0 || source.length < padding + 2) return '';
  const input = source.subarray(1, source.length - padding);
  const working = Buffer.alloc(input.length + 2);
  working[0] = 0xfa;
  working[1] = 0x55;
  input.copy(working, 2);
  const decoded = Buffer.alloc(input.length);
  for (let index = 0; index < decoded.length; index += 1) {
    let byte = (input[index] ^ working[index]) - bitCount(index) - 21;
    while (byte < 0) byte += 0xff;
    decoded[index] = byte & 0xff;
  }
  const first = decoded[0];
  const skip = first >= 48 && first <= 57 ? first - 48 : first >= 97 && first <= 122 ? first - 87 : 255;
  const end = 1 + source.length - padding - 2 - skip;
  return end > 1 && end <= decoded.length ? decoded.subarray(1, end).toString('utf8') : '';
}

function emptyBox() {
  return { size: 0, offset: 0, data: Buffer.alloc(0) };
}

function findBox(buffer, wanted, start = 0, end = buffer.length) {
  let offset = start;
  while (offset + 8 <= end) {
    const size = buffer.readUInt32BE(offset);
    if (size < 8 || offset + size > end) break;
    if (buffer.subarray(offset + 4, offset + 8).toString('ascii') === wanted) {
      return { size, offset, data: buffer.subarray(offset + 8, offset + size) };
    }
    offset += size;
  }
  return emptyBox();
}

function parseSampleSizes(data) {
  const size = data.readUInt32BE(4);
  const count = data.readUInt32BE(8);
  if (size) return Array.from({ length: count }, () => size);
  return Array.from({ length: count }, (_, index) => data.readUInt32BE(12 + index * 4));
}

function parseIvs(data) {
  const count = data.readUInt32BE(4);
  return Array.from({ length: count }, (_, index) => {
    const iv = Buffer.alloc(16);
    data.copy(iv, 0, 8 + index * 8, 16 + index * 8);
    return iv;
  });
}

function flacMetadata(stsd) {
  const index = stsd.data.indexOf(Buffer.from('dfLa'));
  if (index < 4) return Buffer.alloc(0);
  const size = stsd.data.readUInt32BE(index - 4);
  return stsd.data.subarray(index + 8, Math.min(index - 4 + size, stsd.data.length));
}

export function decryptQishuiAudio(source, spadeA) {
  const encrypted = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const keyHex = /^[0-9a-f]+$/i.test(String(spadeA || '')) ? String(spadeA) : decodeSpadeA(spadeA);
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 16) throw new Error('汽水音频密钥无效');

  const moov = findBox(encrypted, 'moov');
  const trak = findBox(encrypted, 'trak', moov.offset + 8, moov.offset + moov.size);
  const mdia = findBox(encrypted, 'mdia', trak.offset + 8, trak.offset + trak.size);
  const minf = findBox(encrypted, 'minf', mdia.offset + 8, mdia.offset + mdia.size);
  const stbl = findBox(encrypted, 'stbl', minf.offset + 8, minf.offset + minf.size);
  const stsd = findBox(encrypted, 'stsd', stbl.offset + 8, stbl.offset + stbl.size);
  const stsz = findBox(encrypted, 'stsz', stbl.offset + 8, stbl.offset + stbl.size);
  let senc = findBox(encrypted, 'senc', moov.offset + 8, moov.offset + moov.size);
  if (!senc.size) senc = findBox(encrypted, 'senc', stbl.offset + 8, stbl.offset + stbl.size);
  const mdat = findBox(encrypted, 'mdat');
  if (![moov, trak, mdia, minf, stbl, stsd, stsz, senc, mdat].every((box) => box.size)) {
    throw new Error('汽水音频容器缺少必要 MP4 box');
  }

  const sizes = parseSampleSizes(stsz.data);
  const ivs = parseIvs(senc.data);
  if (sizes.length !== ivs.length) throw new Error('汽水音频样本与 IV 数量不一致');
  const samples = [];
  let offset = mdat.offset + 8;
  for (let index = 0; index < sizes.length; index += 1) {
    const decipher = crypto.createDecipheriv('aes-128-ctr', key, ivs[index]);
    samples.push(Buffer.concat([decipher.update(encrypted.subarray(offset, offset + sizes[index])), decipher.final()]));
    offset += sizes[index];
  }

  const metadata = flacMetadata(stsd);
  if (metadata.length) return { buffer: Buffer.concat([Buffer.from('fLaC'), metadata, ...samples]), contentType: 'audio/flac' };
  const output = Buffer.from(encrypted);
  let writeAt = mdat.offset + 8;
  samples.forEach((sample) => { sample.copy(output, writeAt); writeAt += sample.length; });
  const marker = output.indexOf(Buffer.from('enca'), stsd.offset);
  if (marker >= stsd.offset && marker < stsd.offset + stsd.size) Buffer.from('mp4a').copy(output, marker);
  return { buffer: output, contentType: 'audio/mp4' };
}

export function isQishuiPlayUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.pathname.endsWith('/audio/qishui') && Boolean(url.searchParams.get('t'));
  } catch {
    return false;
  }
}
