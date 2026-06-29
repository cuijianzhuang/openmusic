/** 将封面 CDN 地址转为指定边长的缩略图 URL（服务端 meting 重定向用） */
export function resizeCoverForThumb(url, px) {
  if (!url || !px || px <= 0) return url;

  let next = url;

  if (/music\.126\.net|126\.net/i.test(next)) {
    if (/param=\d+y\d+/i.test(next)) {
      next = next.replace(/param=\d+y\d+/gi, `param=${px}y${px}`);
    } else {
      next = appendSearchParam(next, 'param', `${px}y${px}`);
    }
    return next;
  }

  if (/\.gtimg\.com\/music\/photo_new\//i.test(next) || /y\.qq\.com\/music\/photo_new\//i.test(next)) {
    const code = px <= 58 ? 'T001R' : px <= 300 ? 'T002R' : 'T003R';
    if (/T00\dR/i.test(next)) return next.replace(/T00\dR/i, code);
    if (/\d+x\d+/.test(next)) return next.replace(/\d+x\d+/g, `${px}x${px}`);
    return next;
  }

  if (/kugou\.com/i.test(next)) {
    const bucket = px <= 64 ? 64 : px <= 120 ? 120 : px <= 240 ? 240 : 400;
    const resized = next.replace(/\/(\d+)\//, `/${bucket}/`);
    if (resized !== next) return resized;
  }

  if (/param=\d+y\d+/i.test(next)) {
    return next.replace(/param=\d+y\d+/gi, `param=${px}y${px}`);
  }

  if (/thumbnail=\d+/i.test(next)) {
    return next.replace(/thumbnail=\d+/gi, `thumbnail=${px}`);
  }

  return next;
}

function appendSearchParam(url, key, value) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const [base, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    params.set(key, value);
    const next = params.toString();
    return next ? `${base}?${next}` : `${base}?${key}=${encodeURIComponent(value)}`;
  }
}
