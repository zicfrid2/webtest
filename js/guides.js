import {
  OUTER_LIPS, LEFT_EYEBROW, RIGHT_EYEBROW,
  LEFT_EYE_TOP, RIGHT_EYE_TOP,
  NOSE_LEFT, NOSE_RIGHT, NOSE_LEFT_WING, NOSE_RIGHT_WING, JAW_LEFT, JAW_RIGHT
} from "./constants.js";
import { getLm } from "./landmarks.js";

function drawPoint(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPolygon(state, ctx, indices, color) {
  ctx.beginPath();
  for (let i = 0; i < indices.length; i++) {
    const p = getLm(state, indices[i]);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawGuides(state, dom, data, faceBox) {
  if (!state.showGuides) return;
  const ctx = dom.ctx.previewCtx;
  ctx.save();

  ctx.strokeStyle = "rgba(255,255,0,0.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(data.roi.left, data.roi.top, data.roi.right - data.roi.left, data.roi.bottom - data.roi.top);

  if (faceBox) {
    ctx.strokeStyle = "rgba(0,255,128,0.65)";
    ctx.strokeRect(faceBox.left, faceBox.top, faceBox.right - faceBox.left, faceBox.bottom - faceBox.top);
  }

  drawPoint(ctx, data.leftCorner.x, data.leftCorner.y, 7, "#00e5ff");
  drawPoint(ctx, data.rightCorner.x, data.rightCorner.y, 7, "#00e5ff");

  const lEyeTop = getLm(state, LEFT_EYE_TOP);
  const rEyeTop = getLm(state, RIGHT_EYE_TOP);
  const noseL = getLm(state, NOSE_LEFT);
  const noseR = getLm(state, NOSE_RIGHT);
  const wingL = getLm(state, NOSE_LEFT_WING);
  const wingR = getLm(state, NOSE_RIGHT_WING);
  const jawL = getLm(state, JAW_LEFT);
  const jawR = getLm(state, JAW_RIGHT);

  drawPoint(ctx, lEyeTop.x, lEyeTop.y, 5, "#ffcc00");
  drawPoint(ctx, rEyeTop.x, rEyeTop.y, 5, "#ffcc00");
  drawPoint(ctx, noseL.x, noseL.y, 5, "#ff66aa");
  drawPoint(ctx, noseR.x, noseR.y, 5, "#ff66aa");
  drawPoint(ctx, wingL.x, wingL.y, 7, "#ff3b30");
  drawPoint(ctx, wingR.x, wingR.y, 7, "#ff3b30");
  drawPoint(ctx, jawL.x, jawL.y, 5, "#66ffcc");
  drawPoint(ctx, jawR.x, jawR.y, 5, "#66ffcc");

  drawPolygon(state, ctx, OUTER_LIPS, "rgba(255,90,160,0.72)");
  drawPolygon(state, ctx, LEFT_EYEBROW, "rgba(255,255,255,0.55)");
  drawPolygon(state, ctx, RIGHT_EYEBROW, "rgba(255,255,255,0.55)");

  ctx.restore();
}
