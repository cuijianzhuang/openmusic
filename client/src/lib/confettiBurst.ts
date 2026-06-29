/** 贵宾进房欢迎礼花 — 轻量 canvas，限定在指定容器内 */
export function fireWelcomeConfetti(container: HTMLElement, durationMs = 2200) {
  if (typeof document === 'undefined' || !container) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return;

  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20';
  container.appendChild(canvas);

  const colors = ['#f6d365', '#fb7185', '#67e8f9', '#c4b5fd', '#6ee7b7', '#fbbf24', '#fff'];
  const particles = Array.from({ length: 56 }, () => ({
    x: width * (0.35 + Math.random() * 0.3),
    y: height * (0.25 + Math.random() * 0.15),
    vx: (Math.random() - 0.5) * 8,
    vy: -5 - Math.random() * 7,
    size: 3 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.25,
    gravity: 0.2 + Math.random() * 0.08,
  }));

  const start = performance.now();
  let raf = 0;

  const tick = (now: number) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rot += p.vr;
      p.vx *= 0.99;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / durationMs);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    if (elapsed < durationMs) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };

  raf = requestAnimationFrame(tick);
}
