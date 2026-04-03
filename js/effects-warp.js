/* ===============================
  입 꼬리 조정 + 치아 패치 오버레이
================================= */

import {
    TARGET_W, TARGET_H,
    LEFT_EYE_OUTER, LEFT_EYE_INNER,
    RIGHT_EYE_OUTER, RIGHT_EYE_INNER,
    NOSE_LEFT, NOSE_RIGHT, NOSE_LEFT_WING, NOSE_RIGHT_WING,
    JAW_LEFT, JAW_RIGHT
} from "./constants.js";

import { bilinearSample, clamp, gaussian2D } from "./utils.js";
import { getLm } from "./landmarks.js";

/* ===============================
   Eye upper eyelid landmarks only
================================= */
function getEyeUpperPoints(state, isLeft) {
    return isLeft
        ? [33, 160, 159, 158, 157, 173, 133].map(i => getLm(state, i))
        : [362, 385, 386, 387, 388, 466, 263].map(i => getLm(state, i));
}

function getEyeCorners(state, isLeft) {
    const outer = getLm(state, isLeft ? LEFT_EYE_OUTER : RIGHT_EYE_OUTER);
    const inner = getLm(state, isLeft ? LEFT_EYE_INNER : RIGHT_EYE_INNER);
    return { outer, inner };
}

function getEyeWidth(state, isLeft) {
    const { outer, inner } = getEyeCorners(state, isLeft);
    return Math.max(1, Math.abs(inner.x - outer.x));
}

function getAveragePoint(state, indices) {
    let x = 0;
    let y = 0;
    for (const idx of indices) {
        const p = getLm(state, idx);
        x += p.x;
        y += p.y;
    }
    return {
        x: x / indices.length,
        y: y / indices.length
    };
}

/* ===============================
   RGB -> HSV
================================= */
function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (d > 0) {
        if (max === r) {
            h = ((g - b) / d) % 6;
        } else if (max === g) {
            h = (b - r) / d + 2;
        } else {
            h = (r - g) / d + 4;
        }
        h *= 60;
        if (h < 0) h += 360;
    }

    return { h, s, v };
}

function isToothLikePixel(r, g, b) {
    const { s, v } = rgbToHsv(r, g, b);
    const brightness = (r + g + b) / 3 / 255;
    const spread = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

    return (
        v >= 0.52 &&
        brightness >= 0.50 &&
        s <= 0.28 &&
        spread <= 0.20
    );
}

/* ===============================
   아래로 100px 스캔해서
   치아 시작/끝 y 찾고 midY 반환
   -> 프레임당 좌/우 딱 1번씩만 호출
================================= */
function findToothMidpointY(src, width, height, centerX, baseY, maxScanPx = 100, scanHalfWidth = 8) {
    const x0 = Math.max(0, Math.floor(centerX - scanHalfWidth));
    const x1 = Math.min(width - 1, Math.ceil(centerX + scanHalfWidth));

    const startY = Math.max(0, Math.floor(baseY));
    const endY = Math.min(height - 1, Math.floor(baseY + maxScanPx));

    let toothStartY = -1;
    let toothEndY = -1;

    for (let y = startY; y <= endY; y++) {
        let hitCount = 0;
        let total = 0;

        for (let x = x0; x <= x1; x++) {
            const i = (y * width + x) * 4;
            const a = src[i + 3];
            if (a < 8) continue;

            total++;

            const r = src[i];
            const g = src[i + 1];
            const b = src[i + 2];

            if (isToothLikePixel(r, g, b)) {
                hitCount++;
            }
        }

        if (total <= 0) continue;

        const rowRatio = hitCount / total;
        const isToothRow = rowRatio >= 0.28 && hitCount >= 3;

        if (isToothRow) {
            if (toothStartY < 0) toothStartY = y;
            toothEndY = y;
        } else if (toothStartY >= 0) {
            break;
        }
    }

    if (toothStartY < 0 || toothEndY < toothStartY) {
        return null;
    }

    return {
        startY: toothStartY,
        endY: toothEndY,
        midY: (toothStartY + toothEndY) * 0.5
    };
}

/* ===============================
   프레임당 딱 1번 캐시 준비
   - 입 벌림 여부
   - 윗입술 중앙 2점
   - tooth mid anchor 좌/우
   - 좌우 둘 다 있으면 midY 평균으로 정렬 통일
================================= */
function prepareSmileScanCache(state, data, src, width, height) {
    const upperInner = getLm(state, 13);
    const lowerInner = getLm(state, 14);
    const mouthOpenDist = Math.abs(lowerInner.y - upperInner.y);

    const OPEN_THRESHOLD = 6;
    const isMouthOpen = mouthOpenDist > OPEN_THRESHOLD;

    const upperLipMidLeft = getAveragePoint(state, [40, 39, 37]);
    const upperLipMidRight = getAveragePoint(state, [267, 269, 270]);

    let toothLeft = null;
    let toothRight = null;

    if (isMouthOpen && src) {
        const sigmaX = Math.max(12, data.sigmaX || 26);
        const scanDownPx = 100;
        const scanHalfWidth = Math.max(6, Math.round(sigmaX * 0.28));

        const toothLeftInfo = findToothMidpointY(
            src,
            width,
            height,
            upperLipMidLeft.x,
            upperLipMidLeft.y,
            scanDownPx,
            scanHalfWidth
        );

        const toothRightInfo = findToothMidpointY(
            src,
            width,
            height,
            upperLipMidRight.x,
            upperLipMidRight.y,
            scanDownPx,
            scanHalfWidth
        );

        if (toothLeftInfo) {
            toothLeft = {
                x: upperLipMidLeft.x,
                y: toothLeftInfo.midY,
                startY: toothLeftInfo.startY,
                endY: toothLeftInfo.endY
            };
        }

        if (toothRightInfo) {
            toothRight = {
                x: upperLipMidRight.x,
                y: toothRightInfo.midY,
                startY: toothRightInfo.startY,
                endY: toothRightInfo.endY
            };
        }

        // 좌우 둘 다 잡히면 같은 y로 통일
        if (toothLeft && toothRight) {
            const unifiedMidY = (toothLeft.y + toothRight.y) * 0.5;
            toothLeft.y = unifiedMidY;
            toothRight.y = unifiedMidY;
        }
    }

    return {
        isMouthOpen,
        mouthOpenDist,
        upperLipMidLeft,
        upperLipMidRight,
        toothLeft,
        toothRight
    };
}

/* ===============================
   Build smooth upper-lid lift profile
================================= */
function computeEyeUpperLift(state, x, y, isLeft, strength) {
    const pts = getEyeUpperPoints(state, isLeft);
    const eyeWidth = getEyeWidth(state, isLeft);

    const xs = pts.map(p => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const width = Math.max(1, maxX - minX);

    let dy = 0;
    let influence = 0;

    const sigmaXBase = Math.max(10, eyeWidth * 0.12);
    const sigmaYBase = Math.max(8, eyeWidth * 0.10);

    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const t = (p.x - minX) / width;

        const centerWeight = 1.0 - Math.pow(Math.abs(t - 0.5) / 0.5, 1.6);
        const w = clamp(centerWeight, 0, 1);

        const liftAmount = strength * (8 + 26 * w);
        const gyCenter = p.y - sigmaYBase * 0.45;

        const g = gaussian2D(
            x - p.x,
            y - gyCenter,
            sigmaXBase,
            sigmaYBase
        );

        dy -= liftAmount * g;
        influence = Math.max(influence, g);
    }

    return { dy, influence };
}

/* ===============================
   Mouth corner smile warp
================================= */
function computeSmileCornerWarp(state, x, y, data, cache) {
    let dx = 0;
    let dy = 0;
    let influence = 0;

    const sigmaX = Math.max(12, data.sigmaX || 26);
    const sigmaY = Math.max(10, data.sigmaY || 20);

    const leftCorner = data.leftCorner;
    const rightCorner = data.rightCorner;
    if (!leftCorner || !rightCorner) {
        return { dx: 0, dy: 0, influence: 0 };
    }

    const rawLeft = data.leftLift || 0;
    const rawRight = data.rightLift || 0;

    const mean = (rawLeft + rawRight) * 0.5;
    const balance = 0.72;
    const leftAmount = rawLeft * (1 - balance) + mean * balance;
    const rightAmount = rawRight * (1 - balance) + mean * balance;

    const SCALE = 1.15;
    const H = 0.34;
    const V = 0.6;

    const gL = gaussian2D(
        x - leftCorner.x,
        y - (leftCorner.y - 15),
        sigmaX,
        sigmaY
    );
    const gR = gaussian2D(
        x - rightCorner.x,
        y - (rightCorner.y - 15),
        sigmaX,
        sigmaY
    );

    const gL2 = gaussian2D(
        x - leftCorner.x,
        y - (leftCorner.y - 15),
        sigmaX * 0.7,
        sigmaY * 0.7
    );
    const gR2 = gaussian2D(
        x - rightCorner.x,
        y - (rightCorner.y - 15),
        sigmaX * 0.7,
        sigmaY * 0.7
    );

    const cheekOffsetX = sigmaX * 0.95;
    const cheekOffsetY = sigmaY * 0.75;

    const gLCheek = gaussian2D(
        x - (leftCorner.x - cheekOffsetX),
        y - (leftCorner.y - cheekOffsetY),
        sigmaX * 1.15,
        sigmaY * 1.05
    );

    const gRCheek = gaussian2D(
        x - (rightCorner.x + cheekOffsetX),
        y - (rightCorner.y - cheekOffsetY),
        sigmaX * 1.15,
        sigmaY * 1.05
    );

    const belowFadeL = clamp((leftCorner.y - y + sigmaY * 0.35) / (sigmaY * 1.35), 0, 1);
    const belowFadeR = clamp((rightCorner.y - y + sigmaY * 0.35) / (sigmaY * 1.35), 0, 1);

    dx += (-SCALE * H) * leftAmount * gL * belowFadeL;
    dy += (-SCALE * V) * leftAmount * gL * belowFadeL;

    dx += (-SCALE * H) * leftAmount * 0.7 * gL2 * belowFadeL;
    dy += (-SCALE * V) * leftAmount * 0.7 * gL2 * belowFadeL;

    dx += (+SCALE * H) * rightAmount * gR * belowFadeR;
    dy += (-SCALE * V) * rightAmount * gR * belowFadeR;

    dx += (+SCALE * H) * rightAmount * 0.7 * gR2 * belowFadeR;
    dy += (-SCALE * V) * rightAmount * 0.7 * gR2 * belowFadeR;

    dx += (-0.28) * leftAmount * gLCheek;
    dy += (-0.36) * leftAmount * gLCheek;

    dx += (+0.28) * rightAmount * gRCheek;
    dy += (-0.36) * rightAmount * gRCheek;

    let gAssistLeft = 0;
    let gAssistRight = 0;

    if (cache?.isMouthOpen) {
        const upperLipLiftOffset = 25;

        const assistLeft = {
            x: cache.upperLipMidLeft.x,
            y: cache.upperLipMidLeft.y - upperLipLiftOffset
        };

        const assistRight = {
            x: cache.upperLipMidRight.x,
            y: cache.upperLipMidRight.y - upperLipLiftOffset
        };

        const assistSigmaX = Math.max(7, sigmaX * 1.0);
        const assistSigmaY = Math.max(6, sigmaY * 0.35);
        const assistStrength = 0.62;

        gAssistLeft = gaussian2D(
            x - assistLeft.x,
            y - assistLeft.y,
            assistSigmaX,
            assistSigmaY
        );

        gAssistRight = gaussian2D(
            x - assistRight.x,
            y - assistRight.y,
            assistSigmaX,
            assistSigmaY
        );

        dy += (-SCALE * V * 1.15) * leftAmount * assistStrength * gAssistLeft;
        dy += (-SCALE * V * 1.15) * rightAmount * assistStrength * gAssistRight;
    }

    influence = Math.max(
        gL, gR, gL2, gR2,
        gLCheek, gRCheek,
        gAssistLeft, gAssistRight
    );

    return { dx, dy, influence };
}

/* ===============================
   Lip volume warp
================================= */
function computeLipVolumeWarp(state, x, y, data) {
    const lipVolume = data.lipVolume || 0;
    if (lipVolume <= 0) {
        return { dx: 0, dy: 0, influence: 0 };
    }

    const leftCorner = getLm(state, 61);
    const rightCorner = getLm(state, 291);

    const upperOuter = getLm(state, 0);
    const upperInner = getLm(state, 13);

    const lowerInner = getLm(state, 14);
    const lowerOuter = getLm(state, 17);

    const mouthCx = (leftCorner.x + rightCorner.x) * 0.5;
    const mouthCy = (upperInner.y + lowerInner.y) * 0.5;
    const mouthWidth = Math.max(1, Math.abs(rightCorner.x - leftCorner.x));

    const upperCx = (upperOuter.x + upperInner.x) * 0.5;
    const upperCy = (upperOuter.y + upperInner.y) * 0.5;

    const lowerCx = (lowerInner.x + lowerOuter.x) * 0.5;
    const lowerCy = (lowerInner.y + lowerOuter.y) * 0.5;

    const sigmaX = Math.max(18, mouthWidth * 0.24);
    const sigmaY = Math.max(8, mouthWidth * 0.09);

    const gUpper = gaussian2D(x - upperCx, y - upperCy, sigmaX, sigmaY);
    const gLower = gaussian2D(x - lowerCx, y - lowerCy, sigmaX, sigmaY);

    const edgeFade = clamp(1.0 - Math.abs(x - mouthCx) / (mouthWidth * 0.62), 0, 1);
    const edgeWeight = Math.pow(edgeFade, 1.35);

    const upperAmount = lipVolume * 30 * 2.0;
    const lowerAmount = lipVolume * 30 * 3.0;

    let lipDy = 0;
    lipDy -= upperAmount * gUpper * edgeWeight;
    lipDy += lowerAmount * gLower * edgeWeight;

    const seamFade = clamp(Math.abs(y - mouthCy) / Math.max(5, sigmaY * 0.9), 0, 1);
    lipDy *= 0.35 + 0.65 * seamFade;

    const lipInfluence = Math.max(gUpper, gLower) * edgeWeight;
    return { dx: 0, dy: lipDy, influence: lipInfluence };
}

/* ===============================
   MAIN
================================= */
export function computeDisplacement(state, x, y, data, cache) {
    let dx = 0;
    let dy = 0;
    let influence = 0;

    const smileDisp = computeSmileCornerWarp(state, x, y, data, cache);
    dx += smileDisp.dx;
    dy += smileDisp.dy;
    influence = Math.max(influence, smileDisp.influence);

    const lipDisp = computeLipVolumeWarp(state, x, y, data);
    dx += lipDisp.dx;
    dy += lipDisp.dy;
    influence = Math.max(influence, lipDisp.influence);

    const eyeL = computeEyeUpperLift(state, x, y, true, data.eyeLift * 1.8);
    const eyeR = computeEyeUpperLift(state, x, y, false, data.eyeLift * 1.8);

    dy += eyeL.dy + eyeR.dy;
    influence = Math.max(influence, eyeL.influence, eyeR.influence);

    const noseL = getLm(state, NOSE_LEFT);
    const noseR = getLm(state, NOSE_RIGHT);

    const gNoseL = gaussian2D(x - noseL.x, y - noseL.y, 95, 120);
    const gNoseR = gaussian2D(x - noseR.x, y - noseR.y, 95, 120);

    dx += data.noseSlim * 9 * (gNoseL - gNoseR);

    const wingL = getLm(state, NOSE_LEFT_WING);
    const wingR = getLm(state, NOSE_RIGHT_WING);

    const gWingL = gaussian2D(x - wingL.x, y - wingL.y, 64, 88);
    const gWingR = gaussian2D(x - wingR.x, y - wingR.y, 64, 88);

    dx += data.noseWingSlim * 176 * (gWingL - gWingR);

    const gWingLiftL = gaussian2D(x - wingL.x, y - (wingL.y + 8), 54, 60);
    const gWingLiftR = gaussian2D(x - wingR.x, y - (wingR.y + 8), 54, 60);

    dy -= data.noseWingSlim * 12.0 * (gWingLiftL + gWingLiftR);

    influence = Math.max(
        influence,
        gNoseL, gNoseR,
        gWingL, gWingR,
        gWingLiftL, gWingLiftR
    );

    const jawL = getLm(state, JAW_LEFT);
    const jawR = getLm(state, JAW_RIGHT);

    const gJawL = gaussian2D(x - jawL.x, y - jawL.y, 140, 160);
    const gJawR = gaussian2D(x - jawR.x, y - jawR.y, 140, 160);

    dx += data.jawSlim * 7 * (gJawL - gJawR);
    influence = Math.max(influence, gJawL, gJawR);

    return { dx, dy, influence };
}

/* ===============================
   patch helper
================================= */
function copyImageData(src, width, height, x, y, w, h) {
    const patch = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
        const sy = y + py;
        if (sy < 0 || sy >= height) continue;

        for (let px = 0; px < w; px++) {
            const sx = x + px;
            if (sx < 0 || sx >= width) continue;

            const si = (sy * width + sx) * 4;
            const di = (py * w + px) * 4;

            patch[di] = src[si];
            patch[di + 1] = src[si + 1];
            patch[di + 2] = src[si + 2];
            patch[di + 3] = src[si + 3];
        }
    }

    return patch;
}

function featherAlpha(px, py, w, h, featherX, featherY) {
    const dx = Math.min(px, w - 1 - px);
    const dy = Math.min(py, h - 1 - py);

    const ax = clamp(dx / Math.max(1, featherX), 0, 1);
    const ay = clamp(dy / Math.max(1, featherY), 0, 1);

    return ax * ay;
}

/* ===============================
   원본 치아 패치를 잘라서
   위로 살짝 복사 합성
================================= */
function overlayToothPatch(dst, src, width, height, anchor, options = {}) {
    if (!anchor) return;

    const patchW = Math.max(10, Math.round(options.patchW || 26));
    const patchH = Math.max(8, Math.round(options.patchH || 14));

    const liftY = options.liftY ?? 2;
    const alphaScale = options.alphaScale ?? 0.72;

    const srcX = Math.round(anchor.x - patchW * 0.5);

    // 중심보다 아래쪽을 조금 더 포함
    const srcY = Math.round(anchor.y - patchH * 0.30);

    const patch = copyImageData(src, width, height, srcX, srcY, patchW, patchH);

    const dstX = srcX;
    const dstY = Math.round(srcY - liftY);

    const featherX = Math.max(2, Math.round(patchW * 0.22));
    const featherY = Math.max(2, Math.round(patchH * 0.35));

    for (let py = 0; py < patchH; py++) {
        const ty = dstY + py;
        if (ty < 0 || ty >= height) continue;

        for (let px = 0; px < patchW; px++) {
            const tx = dstX + px;
            if (tx < 0 || tx >= width) continue;

            const pi = (py * patchW + px) * 4;
            const di = (ty * width + tx) * 4;

            const pr = patch[pi];
            const pg = patch[pi + 1];
            const pb = patch[pi + 2];
            const pa = patch[pi + 3];

            if (pa < 8) continue;
            if (!isToothLikePixel(pr, pg, pb)) continue;

            const edgeAlpha = featherAlpha(px, py, patchW, patchH, featherX, featherY);
            const a = alphaScale * edgeAlpha;

            if (a <= 0.001) continue;

            dst[di] = dst[di] * (1 - a) + pr * a;
            dst[di + 1] = dst[di + 1] * (1 - a) + pg * a;
            dst[di + 2] = dst[di + 2] * (1 - a) + pb * a;
            dst[di + 3] = 255;
        }
    }
}

/* ===============================
   tooth overlay apply
================================= */
function applyToothOverlay(state, src, dst, cache, data) {
    if (!cache?.isMouthOpen) return;

    const sigmaX = Math.max(12, data.sigmaX || 26);

    if (cache.toothLeft) {
        const toothHeight = Math.max(8, (cache.toothLeft.endY - cache.toothLeft.startY) + 4);
        overlayToothPatch(dst, src, TARGET_W, TARGET_H, cache.toothLeft, {
            patchW: Math.max(14, sigmaX * 0.75),
            patchH: toothHeight,
            liftY: 2,
            alphaScale: 0.72
        });
    }

    if (cache.toothRight) {
        const toothHeight = Math.max(8, (cache.toothRight.endY - cache.toothRight.startY) + 4);
        overlayToothPatch(dst, src, TARGET_W, TARGET_H, cache.toothRight, {
            patchW: Math.max(14, sigmaX * 0.75),
            patchH: toothHeight,
            liftY: 2,
            alphaScale: 0.72
        });
    }
}

/* ===============================
   APPLY
================================= */
export function applyWarp(state, dom, data) {
    const { srcCtx, workCtx } = dom.ctx;

    const srcImg = srcCtx.getImageData(0, 0, TARGET_W, TARGET_H);
    const dstImg = workCtx.createImageData(TARGET_W, TARGET_H);

    const src = srcImg.data;
    const dst = dstImg.data;
    dst.set(src);

    // 프레임당 딱 1번만 스캔
    const smileScanCache = prepareSmileScanCache(
        state,
        data,
        src,
        TARGET_W,
        TARGET_H
    );

    // 1차: 얼굴 워프
    for (let y = 0; y < TARGET_H; y++) {
        for (let x = 0; x < TARGET_W; x++) {
            const disp = computeDisplacement(state, x, y, data, smileScanCache);
            if (disp.influence < 0.001) continue;

            const rgba = bilinearSample(
                src,
                TARGET_W,
                TARGET_H,
                x - disp.dx,
                y - disp.dy
            );

            const di = (y * TARGET_W + x) * 4;
            dst[di] = rgba[0];
            dst[di + 1] = rgba[1];
            dst[di + 2] = rgba[2];
            dst[di + 3] = 255;
        }
    }

    // 2차: 치아 패치 오버레이
    applyToothOverlay(state, src, dst, smileScanCache, data);

    workCtx.putImageData(dstImg, 0, 0);
}