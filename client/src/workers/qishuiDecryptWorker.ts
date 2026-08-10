const MAX_SOURCE_BYTES = 96 * 1024 * 1024;

type Box = { size: number; offset: number; data: Uint8Array };

function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
}

function text(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function box(data: Uint8Array, wanted: string, start = 0, end = data.length): Box | null {
  let offset = start;
  while (offset + 8 <= end) {
    const size = u32(data, offset);
    if (size < 8 || offset + size > end) return null;
    if (text(data.subarray(offset + 4, offset + 8)) === wanted) {
      return { size, offset, data: data.subarray(offset + 8, offset + size) };
    }
    offset += size;
  }
  return null;
}

function bitCount(input: number): number {
  let value = input;
  value -= (value >> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
  return (((value + (value >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function decodeSpadeA(value: string): string {
  const source = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (source.length < 3) return '';
  const padding = (source[0] ^ source[1] ^ source[2]) - 48;
  if (padding < 0 || source.length < padding + 2) return '';
  const input = source.subarray(1, source.length - padding);
  const working = new Uint8Array(input.length + 2);
  working.set([0xfa, 0x55]);
  working.set(input, 2);
  const decoded = new Uint8Array(input.length);
  for (let index = 0; index < decoded.length; index += 1) {
    let byte = (input[index] ^ working[index]) - bitCount(index) - 21;
    while (byte < 0) byte += 0xff;
    decoded[index] = byte & 0xff;
  }
  const first = decoded[0];
  const skip = first >= 48 && first <= 57 ? first - 48 : first >= 97 && first <= 122 ? first - 87 : 255;
  const end = 1 + source.length - padding - 2 - skip;
  return end > 1 && end <= decoded.length ? text(decoded.subarray(1, end)) : '';
}

function resolveKey(value: string): Uint8Array {
  const raw = value.trim();
  const hex = /^[0-9a-f]{32}$/i.test(raw) ? raw : decodeSpadeA(raw);
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('汽水音频密钥无效');
  return Uint8Array.from(hex.match(/../g)!, (part) => parseInt(part, 16));
}

/** 仅拷贝视图自身字节，避免 new Uint8Array(view).buffer 在已独立 buffer 上再复制一次。 */
function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value.buffer as ArrayBuffer;
  }
  return value.slice().buffer as ArrayBuffer;
}

async function readResponse(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) throw new Error('汽水音频文件过大');
  if (!response.body) {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.length > MAX_SOURCE_BYTES) throw new Error('汽水音频文件过大');
    return value;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error('汽水音频文件过大');
    }
    chunks.push(result.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  return output;
}

function sampleSizes(stsz: Box): Uint32Array {
  const fixed = u32(stsz.data, 4);
  const count = u32(stsz.data, 8);
  if (count > 200_000 || (!fixed && 12 + count * 4 > stsz.data.length)) throw new Error('汽水音频样本数据无效');
  if (fixed) return new Uint32Array(count).fill(fixed);
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) sizes[i] = u32(stsz.data, 12 + i * 4);
  return sizes;
}

function findFlacMetadata(stsd: Box): Uint8Array | null {
  const marker = new TextEncoder().encode('dfLa');
  for (let index = 4; index + 4 <= stsd.data.length; index += 1) {
    if (stsd.data[index] !== marker[0] || stsd.data[index + 1] !== marker[1]
      || stsd.data[index + 2] !== marker[2] || stsd.data[index + 3] !== marker[3]) continue;
    const size = u32(stsd.data, index - 4);
    if (size >= 8 && index - 4 + size <= stsd.data.length) return stsd.data.subarray(index + 4, index - 4 + size);
  }
  return null;
}

async function decryptAudio(data: Uint8Array, rawKey: string): Promise<{ data: Uint8Array; contentType: string }> {
  const moov = box(data, 'moov');
  if (!moov) throw new Error('汽水音频缺少 moov');
  const trak = box(data, 'trak', moov.offset + 8, moov.offset + moov.size);
  const mdia = trak && box(data, 'mdia', trak.offset + 8, trak.offset + trak.size);
  const minf = mdia && box(data, 'minf', mdia.offset + 8, mdia.offset + mdia.size);
  const stbl = minf && box(data, 'stbl', minf.offset + 8, minf.offset + minf.size);
  const stsd = stbl && box(data, 'stsd', stbl.offset + 8, stbl.offset + stbl.size);
  const stsz = stbl && box(data, 'stsz', stbl.offset + 8, stbl.offset + stbl.size);
  let senc = stbl && box(data, 'senc', stbl.offset + 8, stbl.offset + stbl.size);
  if (!senc) senc = box(data, 'senc', moov.offset + 8, moov.offset + moov.size);
  const mdat = box(data, 'mdat');
  if (!trak || !mdia || !minf || !stbl || !stsd || !stsz || !senc || !mdat) throw new Error('汽水音频容器不完整');

  const sizes = sampleSizes(stsz);
  const ivCount = u32(senc.data, 4);
  if (ivCount > 200_000 || 8 + ivCount * 8 > senc.data.length) throw new Error('汽水音频 IV 数据无效');
  if (sizes.length !== ivCount) throw new Error('汽水音频样本范围无效');

  let samplesBytes = 0;
  for (let i = 0; i < sizes.length; i += 1) samplesBytes += sizes[i];
  if (samplesBytes > mdat.data.length) throw new Error('汽水音频样本范围无效');

  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(resolveKey(rawKey)),
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  );
  const metadata = findFlacMetadata(stsd);
  // 复用 16 字节 counter，避免为每个 sample 分配独立 IV Uint8Array（高采样数时对象开销巨大）
  const counter = new Uint8Array(16);
  let mdatOffset = mdat.offset + 8;

  if (metadata) {
    const header = new TextEncoder().encode('fLaC');
    const output = new Uint8Array(header.length + metadata.length + samplesBytes);
    output.set(header, 0);
    output.set(metadata, header.length);
    let writeAt = header.length + metadata.length;
    for (let index = 0; index < sizes.length; index += 1) {
      const size = sizes[index];
      counter.fill(0);
      counter.set(senc.data.subarray(8 + index * 8, 16 + index * 8));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: toArrayBuffer(counter), length: 64 },
        key,
        toArrayBuffer(data.subarray(mdatOffset, mdatOffset + size)),
      );
      output.set(new Uint8Array(decrypted), writeAt);
      writeAt += size;
      mdatOffset += size;
    }
    return { data: output, contentType: 'audio/flac' };
  }

  // MP4：就地解密到拷贝上，避免「密文 + 明文 samples 数组 + concat」三倍峰值
  const output = data.slice();
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    counter.fill(0);
    counter.set(senc.data.subarray(8 + index * 8, 16 + index * 8));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: toArrayBuffer(counter), length: 64 },
      key,
      toArrayBuffer(data.subarray(mdatOffset, mdatOffset + size)),
    );
    output.set(new Uint8Array(decrypted), mdatOffset);
    mdatOffset += size;
  }
  const enca = new TextEncoder().encode('enca');
  const mp4a = new TextEncoder().encode('mp4a');
  for (let index = stsd.offset; index + 4 <= stsd.offset + stsd.size; index += 1) {
    if (output[index] === enca[0] && output[index + 1] === enca[1] && output[index + 2] === enca[2] && output[index + 3] === enca[3]) {
      output.set(mp4a, index);
      break;
    }
  }
  return { data: output, contentType: 'audio/mp4' };
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; url: string; auth: string }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = async (event: MessageEvent<{ id: number; url: string; auth: string }>) => {
  const { id, url, auth } = event.data;
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`汽水 CDN 请求失败: ${response.status}`);
    const encrypted = await readResponse(response);
    const decrypted = await decryptAudio(encrypted, auth);
    const transferable = toArrayBuffer(decrypted.data);
    workerScope.postMessage({ id, data: transferable, contentType: decrypted.contentType }, [transferable]);
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : '汽水本地解密失败' });
  }
};

export {};
