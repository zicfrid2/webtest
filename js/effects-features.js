import {
  TARGET_W, TARGET_H, LEFT_IRIS, RIGHT_IRIS, OUTER_LIPS, INNER_LIPS,
  UPPER_LIP_CENTER, LOWER_LIP_CENTER, LIP_LEFT, LIP_RIGHT,
  LEFT_EYEBROW, RIGHT_EYEBROW,
  NOSE_BRIDGE_UP, NOSE_BRIDGE_MID, NOSE_TIP, NOSE_BASE, NOSE_LEFT_WING, NOSE_RIGHT_WING,
  LEFT_EYE_TOP, LEFT_EYE_BOTTOM, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM,
  LEFT_EYE_OUTER, LEFT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_EYE_INNER
} from "./constants.js";
import { clamp, gaussian2D, lerp, luminance } from "./utils.js";
import { getAveragePoint, getLm } from "./landmarks.js";
import { buildPolygonMask, buildEyeEllipseMask } from "./masks.js";

export function applyNoseDepth(state, dom, data) {
    if (data.noseDepth <= 0) return;

    const img = dom.ctx.workCtx.getImageData(0, 0, TARGET_W, TARGET_H);
    const px = img.data;

    const bridgeUp = getLm(state, NOSE_BRIDGE_UP);
    const bridgeMid = getLm(state, NOSE_BRIDGE_MID);
    const tip = getLm(state, NOSE_TIP);
    const base = getLm(state, NOSE_BASE);
    const leftWing = getLm(state, NOSE_LEFT_WING);
    const rightWing = getLm(state, NOSE_RIGHT_WING);

    const noseWidth = Math.max(1, Math.abs(rightWing.x - leftWing.x));
    const noseHeight = Math.max(1, Math.abs(base.y - bridgeUp.y));

    const cxTop = bridgeUp.x;
    const cyTop = bridgeUp.y;
    const cxMid = bridgeMid.x;
    const cyMid = bridgeMid.y;
    const cxTip = tip.x;
    const cyTip = tip.y;

    const centerX = (bridgeUp.x + bridgeMid.x + tip.x) / 3;
    const centerY = (bridgeUp.y + base.y) * 0.5;

    const sideOffsetTop = noseWidth * 0.18;
    const sideOffsetMid = noseWidth * 0.22;
    const sideOffsetTip = noseWidth * 0.28;

    const sxCenterTop = Math.max(7, noseWidth * 0.10);
    const sxCenterMid = Math.max(9, noseWidth * 0.12);
    const sxCenterTip = Math.max(11, noseWidth * 0.16);

    const syCenterTop = Math.max(18, noseHeight * 0.16);
    const syCenterMid = Math.max(26, noseHeight * 0.22);
    const syCenterTip = Math.max(20, noseHeight * 0.18);

    const sxShadowTop = Math.max(10, noseWidth * 0.18);
    const sxShadowMid = Math.max(12, noseWidth * 0.22);
    const sxShadowTip = Math.max(14, noseWidth * 0.26);

    const syShadowTop = Math.max(24, noseHeight * 0.20);
    const syShadowMid = Math.max(34, noseHeight * 0.28);
    const syShadowTip = Math.max(26, noseHeight * 0.22);

    const wingShadowSX = Math.max(14, noseWidth * 0.20);
    const wingShadowSY = Math.max(16, noseHeight * 0.16);

    const leftWingLiftX = leftWing.x + noseWidth * 0.04;
    const rightWingLiftX = rightWing.x - noseWidth * 0.04;
    const wingY = (tip.y + base.y + leftWing.y + rightWing.y) * 0.25 - noseHeight * 0.02;

    const yStart = Math.max(0, Math.floor(bridgeUp.y - noseHeight * 0.32));
    const yEnd = Math.min(TARGET_H, Math.ceil(base.y + noseHeight * 0.28));
    const xStart = Math.max(0, Math.floor(Math.min(leftWing.x, bridgeUp.x, bridgeMid.x, tip.x) - noseWidth * 0.85));
    const xEnd = Math.min(TARGET_W, Math.ceil(Math.max(rightWing.x, bridgeUp.x, bridgeMid.x, tip.x) + noseWidth * 0.85));

    for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
            const i = (y * TARGET_W + x) * 4;

            // 콧대 중심 하이라이트: 미간 -> 중간 -> 코끝
            const gCenterTop = gaussian2D(x - cxTop, y - cyTop, sxCenterTop, syCenterTop);
            const gCenterMid = gaussian2D(x - cxMid, y - cyMid, sxCenterMid, syCenterMid);
            const gCenterTip = gaussian2D(x - cxTip, y - cyTip, sxCenterTip, syCenterTip);

            const centerLine =
                gCenterTop * 0.90 +
                gCenterMid * 1.15 +
                gCenterTip * 0.70;

            // 콧대 양옆 그림자: 위/중간/아래로 길게 이어지게
            const gLeftTop = gaussian2D(
                x - (cxTop - sideOffsetTop),
                y - cyTop,
                sxShadowTop,
                syShadowTop
            );
            const gRightTop = gaussian2D(
                x - (cxTop + sideOffsetTop),
                y - cyTop,
                sxShadowTop,
                syShadowTop
            );

            const gLeftMid = gaussian2D(
                x - (cxMid - sideOffsetMid),
                y - cyMid,
                sxShadowMid,
                syShadowMid
            );
            const gRightMid = gaussian2D(
                x - (cxMid + sideOffsetMid),
                y - cyMid,
                sxShadowMid,
                syShadowMid
            );

            const gLeftTip = gaussian2D(
                x - (cxTip - sideOffsetTip),
                y - (cyTip + noseHeight * 0.02),
                sxShadowTip,
                syShadowTip
            );
            const gRightTip = gaussian2D(
                x - (cxTip + sideOffsetTip),
                y - (cyTip + noseHeight * 0.02),
                sxShadowTip,
                syShadowTip
            );

            const sideShadow =
                (gLeftTop + gRightTop) * 0.34 +
                (gLeftMid + gRightMid) * 0.52 +
                (gLeftTip + gRightTip) * 0.44;

            // 콧볼 위쪽/근처 음영
            const gWingLeft = gaussian2D(
                x - leftWingLiftX,
                y - wingY,
                wingShadowSX,
                wingShadowSY
            );
            const gWingRight = gaussian2D(
                x - rightWingLiftX,
                y - wingY,
                wingShadowSX,
                wingShadowSY
            );

            const wingShadow = (gWingLeft + gWingRight) * 0.42;

            // 코 아래쪽 너무 번들거리지 않게 하단 감쇠
            const lowerFade = 1.0 - clamp((y - tip.y) / Math.max(8, noseHeight * 0.55), 0, 1) * 0.28;

            // 미간 쪽은 약간 더 선명하게
            const upperBoost = 1.0 + clamp((bridgeMid.y - y) / Math.max(8, noseHeight * 0.45), 0, 1) * 0.18;

            const effect =
                (centerLine * 1.08 - sideShadow * 0.92 - wingShadow) *
                data.noseDepth *
                lowerFade *
                upperBoost;

            px[i] = clamp(px[i] + effect * 34, 0, 255);
            px[i + 1] = clamp(px[i + 1] + effect * 29, 0, 255);
            px[i + 2] = clamp(px[i + 2] + effect * 24, 0, 255);
        }
    }

    dom.ctx.workCtx.putImageData(img, 0, 0);
}

export function applyEyeLineEnhance(state, dom, data) {
  if (data.eyeLine <= 0 && data.irisDeepen <= 0) return;

  const img = dom.ctx.workCtx.getImageData(0, 0, TARGET_W, TARGET_H);
  const px = img.data;

  const leftMask = buildEyeEllipseMask(state, dom, true, 1.1, 10).data;
  const rightMask = buildEyeEllipseMask(state, dom, false, 1.1, 10).data;
  const leftCenter = getAveragePoint(state, LEFT_IRIS);
  const rightCenter = getAveragePoint(state, RIGHT_IRIS);

  const lTop = getLm(state, LEFT_EYE_TOP);
  const lBottom = getLm(state, LEFT_EYE_BOTTOM);
  const rTop = getLm(state, RIGHT_EYE_TOP);
  const rBottom = getLm(state, RIGHT_EYE_BOTTOM);

  for (let y = 0; y < TARGET_H; y++) {
    for (let x = 0; x < TARGET_W; x++) {
      const i = (y * TARGET_W + x) * 4;
      const m = Math.max(leftMask[i], rightMask[i]) / 255;
      if (m <= 0.001) continue;

      const gUpperLeft = gaussian2D(x - lTop.x, y - lTop.y, 85, 20);
      const gUpperRight = gaussian2D(x - rTop.x, y - rTop.y, 85, 20);
      const gLowerLeft = gaussian2D(x - lBottom.x, y - lBottom.y, 90, 24);
      const gLowerRight = gaussian2D(x - rBottom.x, y - rBottom.y, 90, 24);

      const upperLine = Math.max(gUpperLeft, gUpperRight) * data.eyeLine;
      const lowerSoft = Math.max(gLowerLeft, gLowerRight) * data.eyeLine * 0.35;
      const irisEffect = Math.max(
        gaussian2D(x - leftCenter.x, y - leftCenter.y, 24, 24),
        gaussian2D(x - rightCenter.x, y - rightCenter.y, 24, 24)
      ) * data.irisDeepen;

      const darken = upperLine * 18 + irisEffect * 26;
      const brighten = lowerSoft * 7;

      px[i] = clamp(px[i] - darken + brighten, 0, 255);
      px[i + 1] = clamp(px[i + 1] - darken + brighten, 0, 255);
      px[i + 2] = clamp(px[i + 2] - darken + brighten, 0, 255);
    }
  }

  dom.ctx.workCtx.putImageData(img, 0, 0);
}

export function applyEyeOpenHighlight(state, dom, data) {
  if (data.eyeOpenAuto <= 0) return;

  const img = dom.ctx.workCtx.getImageData(0, 0, TARGET_W, TARGET_H);
  const px = img.data;

  const leftEyeCenter = getAveragePoint(state, [LEFT_EYE_TOP, LEFT_EYE_BOTTOM, LEFT_EYE_OUTER, LEFT_EYE_INNER]);
  const rightEyeCenter = getAveragePoint(state, [RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM, RIGHT_EYE_OUTER, RIGHT_EYE_INNER]);

  const leftBoost = clamp((0.18 - data.leftEyeOpenRatio) / 0.08, 0, 1) * data.eyeOpenAuto;
  const rightBoost = clamp((0.18 - data.rightEyeOpenRatio) / 0.08, 0, 1) * data.eyeOpenAuto;
  if (leftBoost <= 0 && rightBoost <= 0) return;

  for (let y = 0; y < TARGET_H; y++) {
    for (let x = 0; x < TARGET_W; x++) {
      const i = (y * TARGET_W + x) * 4;
      const gL = gaussian2D(x - leftEyeCenter.x, y - (leftEyeCenter.y - 8), 60, 28) * leftBoost;
      const gR = gaussian2D(x - rightEyeCenter.x, y - (rightEyeCenter.y - 8), 60, 28) * rightBoost;
      const g = Math.max(gL, gR);
      if (g <= 0.001) continue;

      px[i] = clamp(px[i] + g * 10, 0, 255);
      px[i + 1] = clamp(px[i + 1] + g * 9, 0, 255);
      px[i + 2] = clamp(px[i + 2] + g * 8, 0, 255);
    }
  }

  dom.ctx.workCtx.putImageData(img, 0, 0);
}

export function applyEyebrowCleanup(state, dom, data) {
  if (data.eyebrowCleanup <= 0 && data.eyebrowTailTrim <= 0) return;

  const img = dom.ctx.workCtx.getImageData(0, 0, TARGET_W, TARGET_H);
  const px = img.data;
  const original = dom.ctx.srcCtx.getImageData(0, 0, TARGET_W, TARGET_H).data;

  const lBrowCenter = getAveragePoint(state, LEFT_EYEBROW);
  const rBrowCenter = getAveragePoint(state, RIGHT_EYEBROW);
  const lEye = getAveragePoint(state, [LEFT_EYE_TOP, LEFT_EYE_BOTTOM, LEFT_EYE_OUTER, LEFT_EYE_INNER]);
  const rEye = getAveragePoint(state, [RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM, RIGHT_EYE_OUTER, RIGHT_EYE_INNER]);
  const lOuter = getLm(state, LEFT_EYEBROW[0]);
  const rOuter = getLm(state, RIGHT_EYEBROW[0]);

  for (let y = 0; y < TARGET_H; y++) {
    for (let x = 0; x < TARGET_W; x++) {
      const i = (y * TARGET_W + x) * 4;

      const gBrow = Math.max(
        gaussian2D(x - lBrowCenter.x, y - lBrowCenter.y, 95, 36),
        gaussian2D(x - rBrowCenter.x, y - rBrowCenter.y, 95, 36)
      );
      const eyeProtect = Math.max(
        gaussian2D(x - lEye.x, y - lEye.y, 90, 40),
        gaussian2D(x - rEye.x, y - rEye.y, 90, 40)
      );
      const tailMask = Math.max(
        gaussian2D(x - (lOuter.x - 18), y - (lOuter.y - 2), 42, 18),
        gaussian2D(x - (rOuter.x + 18), y - (rOuter.y - 2), 42, 18)
      );

      const lum = luminance(px[i], px[i + 1], px[i + 2]);
      const originalLum = luminance(original[i], original[i + 1], original[i + 2]);

      let alpha = 0;
      if (gBrow > 0.08 && eyeProtect < 0.55 && lum < 110 && originalLum < 120) {
        alpha += data.eyebrowCleanup * gBrow * 0.22;
      }
      if (tailMask > 0.05 && lum < 130) {
        alpha += data.eyebrowTailTrim * tailMask * 0.4;
      }

      alpha = clamp(alpha, 0, 0.75);
      if (alpha <= 0.001) continue;

      const skinR = clamp(original[i] + 18, 0, 255);
      const skinG = clamp(original[i + 1] + 12, 0, 255);
      const skinB = clamp(original[i + 2] + 10, 0, 255);

      px[i] = lerp(px[i], skinR, alpha);
      px[i + 1] = lerp(px[i + 1], skinG, alpha);
      px[i + 2] = lerp(px[i + 2], skinB, alpha);
    }
  }

  dom.ctx.workCtx.putImageData(img, 0, 0);
}

export function applyLipEnhancement(state, dom, data) {
  if (data.lipSaturation <= 0 && data.lipBrightness <= 0 && data.lipCenterGlow <= 0) return;

  const img = dom.ctx.workCtx.getImageData(0, 0, TARGET_W, TARGET_H);
  const px = img.data;

  const lipMask = buildPolygonMask(state, dom, OUTER_LIPS, 12).data;
  const innerMask = buildPolygonMask(state, dom, INNER_LIPS, 10).data;

  const left = getLm(state, LIP_LEFT);
  const right = getLm(state, LIP_RIGHT);
  const upper = getLm(state, UPPER_LIP_CENTER);
  const lower = getLm(state, LOWER_LIP_CENTER);

  const cx = (left.x + right.x) * 0.5;
  const cy = (upper.y + lower.y) * 0.5;
  const sx = Math.max(20, Math.abs(right.x - left.x) * 0.22);
  const sy = Math.max(12, Math.abs(lower.y - upper.y) * 1.25);

  for (let i = 0; i < px.length; i += 4) {
    const outerA = lipMask[i] / 255;
    if (outerA <= 0.001) continue;

    const idx = i / 4;
    const x = idx % TARGET_W;
    const y = Math.floor(idx / TARGET_W);

    const innerA = innerMask[i] / 255;
    const centerGlow = gaussian2D(x - cx, y - cy, sx, sy) * data.lipCenterGlow;

    let r = px[i];
    let g = px[i + 1];
    let b = px[i + 2];

    const avg = (r + g + b) / 3;
    const satBoost = 1 + data.lipSaturation * (0.45 + innerA * 0.15);
    const brightnessBoost = data.lipBrightness * (12 + (avg < 110 ? 10 : 0));
    const centerBoost = centerGlow * 18;

    r = avg + (r - avg) * satBoost + brightnessBoost + centerBoost;
    g = avg + (g - avg) * (1 + data.lipSaturation * 0.14) + brightnessBoost * 0.25 + centerBoost * 0.3;
    b = avg + (b - avg) * (1 + data.lipSaturation * 0.10) + brightnessBoost * 0.18 + centerBoost * 0.25;

    px[i] = clamp(lerp(px[i], r, outerA), 0, 255);
    px[i + 1] = clamp(lerp(px[i + 1], g, outerA), 0, 255);
    px[i + 2] = clamp(lerp(px[i + 2], b, outerA), 0, 255);
  }

  dom.ctx.workCtx.putImageData(img, 0, 0);
}
