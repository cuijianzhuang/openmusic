/** 头像上传处理：裁剪居中正方形、缩放到固定尺寸后转 base64 data URL */

const AVATAR_SIZE = 128;
/** 与服务端 MAX_AVATAR_DATA_URL_LENGTH 保持一致 */
const MAX_DATA_URL_LENGTH = 200 * 1024;

export function isSupportedAvatarFile(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png';
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持图片处理');

    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    // PNG 保留透明通道；JPG 有损压缩控制体积
    const dataUrl = file.type === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.85);

    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      // 128px 图正常不会超限，兜底再压一档
      const fallback = canvas.toDataURL('image/jpeg', 0.7);
      if (fallback.length > MAX_DATA_URL_LENGTH) throw new Error('图片过大，请换一张');
      return fallback;
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
