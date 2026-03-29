import {
  TARGET_W, TARGET_H, FACE_OVAL,
  LEFT_EYE_TOP, LEFT_EYE_BOTTOM, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM,
  LEFT_EYE_OUTER, LEFT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_EYE_INNER
} from "./constants.js";
import { clamp } from "./utils.js";
import { getLm } from "./landmarks.js";

export function buildFaceMask(state, dom) {
  const { maskCtx, tempCtx } = dom.ctx;

  maskCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  maskCtx.fillStyle = "black";
  maskCtx.fillRect(0, 0, TARGET_W, TARGET_H);

  tempCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  tempCtx.fillStyle = "black";
  tempCtx.fillRect(0, 0, TARGET_W, TARGET_H);

  tempCtx.save();
  tempCtx.beginPath();

  let minX = TARGET_W, minY = TARGET_H, maxX = 0, maxY = 0;
  for (let i = 0; i < FACE_OVAL.length; i++) {
    const p = getLm(state, FACE_OVAL[i]);
    if (i === 0) tempCtx.moveTo(p.x, p.y);
    else tempCtx.lineTo(p.x, p.y);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  tempCtx.closePath();
  tempCtx.fillStyle = "white";
  tempCtx.fill();
  tempCtx.restore();

  const feather = 24;
  maskCtx.save();
  maskCtx.filter = `blur(${feather}px)`;
  maskCtx.drawImage(dom.canvas.tempCanvas, 0, 0);
  maskCtx.restore();

  return {
    left: Math.floor(clamp(minX - 40, 0, TARGET_W - 1)),
    top: Math.floor(clamp(minY - 60, 0, TARGET_H - 1)),
    right: Math.floor(clamp(maxX + 40, 0, TARGET_W - 1)),
    bottom: Math.floor(clamp(maxY + 60, 0, TARGET_H - 1))
  };
}

export function buildPolygonMask(state, dom, indices, blurPx = 10) {
  const { regionCtx, regionCtx2 } = dom.ctx;
  regionCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  regionCtx.fillStyle = "black";
  regionCtx.fillRect(0, 0, TARGET_W, TARGET_H);

  regionCtx2.clearRect(0, 0, TARGET_W, TARGET_H);
  regionCtx2.fillStyle = "black";
  regionCtx2.fillRect(0, 0, TARGET_W, TARGET_H);

  regionCtx.beginPath();
  for (let i = 0; i < indices.length; i++) {
    const p = getLm(state, indices[i]);
    if (i === 0) regionCtx.moveTo(p.x, p.y);
    else regionCtx.lineTo(p.x, p.y);
  }
  regionCtx.closePath();
  regionCtx.fillStyle = "white";
  regionCtx.fill();

  regionCtx2.save();
  regionCtx2.filter = `blur(${blurPx}px)`;
  regionCtx2.drawImage(dom.canvas.regionCanvas, 0, 0);
  regionCtx2.restore();

  return regionCtx2.getImageData(0, 0, TARGET_W, TARGET_H);
}

export function buildEyeEllipseMask(state, dom, isLeft, extraScale = 1.0, blurPx = 10) {
  const { regionCtx, regionCtx2 } = dom.ctx;
  regionCtx.clearRect(0, 0, TARGET_W, TARGET_H);
  regionCtx.fillStyle = "black";
  regionCtx.fillRect(0, 0, TARGET_W, TARGET_H);
  regionCtx2.clearRect(0, 0, TARGET_W, TARGET_H);

  const top = getLm(state, isLeft ? LEFT_EYE_TOP : RIGHT_EYE_TOP);
  const bottom = getLm(state, isLeft ? LEFT_EYE_BOTTOM : RIGHT_EYE_BOTTOM);
  const outer = getLm(state, isLeft ? LEFT_EYE_OUTER : RIGHT_EYE_OUTER);
  const inner = getLm(state, isLeft ? LEFT_EYE_INNER : RIGHT_EYE_INNER);

  const cx = (outer.x + inner.x) * 0.5;
  const cy = (top.y + bottom.y) * 0.5;
  const rx = Math.abs(outer.x - inner.x) * 0.62 * extraScale;
  const ry = Math.max(8, Math.abs(top.y - bottom.y) * 1.8 * extraScale);

  regionCtx.beginPath();
  regionCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  regionCtx.fillStyle = "white";
  regionCtx.fill();

  regionCtx2.save();
  regionCtx2.filter = `blur(${blurPx}px)`;
  regionCtx2.drawImage(dom.canvas.regionCanvas, 0, 0);
  regionCtx2.restore();

  return regionCtx2.getImageData(0, 0, TARGET_W, TARGET_H);
}
