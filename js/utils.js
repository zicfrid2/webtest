export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function gaussian2D(dx, dy, sigmaX, sigmaY) {
  const sx = Math.max(1e-6, sigmaX);
  const sy = Math.max(1e-6, sigmaY);
  return Math.exp(-0.5 * ((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy)));
}

export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function bilinearSample(src, sw, sh, x, y) {
  x = clamp(x, 0, sw - 1);
  y = clamp(y, 0, sh - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, sw - 1);
  const y1 = Math.min(y0 + 1, sh - 1);

  const dx = x - x0;
  const dy = y - y0;

  const i00 = (y0 * sw + x0) * 4;
  const i10 = (y0 * sw + x1) * 4;
  const i01 = (y1 * sw + x0) * 4;
  const i11 = (y1 * sw + x1) * 4;

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = src[i00 + c];
    const v10 = src[i10 + c];
    const v01 = src[i01 + c];
    const v11 = src[i11 + c];
    const v0 = v00 + (v10 - v00) * dx;
    const v1 = v01 + (v11 - v01) * dx;
    out[c] = v0 + (v1 - v0) * dy;
  }
  return out;
}
