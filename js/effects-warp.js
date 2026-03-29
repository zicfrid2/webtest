/* ===============================
  입 꼬리 조정
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
   - 좌우 비대칭 과상승 방지
   - 오른쪽만 추가되던 보정 제거
   - 좌우 lift를 완만하게 평균화
   - 아래쪽 번짐 감소
================================= */
function computeSmileCornerWarp(x, y, data) {
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

    // 좌우 차이가 과하면 평균 쪽으로 살짝 끌어와서 한쪽만 과하게 뜨는 것 방지
    const mean = (rawLeft + rawRight) * 0.5;
    const balance = 0.72; // 1에 가까울수록 좌우를 더 비슷하게 맞춤
    const leftAmount = rawLeft * (1 - balance) + mean * balance;
    const rightAmount = rawRight * (1 - balance) + mean * balance;

    const SCALE = 1.15;
    const H = 0.3;   // 옆 이동은 줄이고
    const V = 0.7;   // 위 이동은 더 중심으로

    // 입꼬리 주변 영향
    const gL = gaussian2D(
        x - leftCorner.x,
        y - leftCorner.y,
        sigmaX,
        sigmaY
    );
    const gR = gaussian2D(
        x - rightCorner.x,
        y - rightCorner.y,
        sigmaX,
        sigmaY
    );

    // 입꼬리 위쪽 볼륨을 살짝 따라 올리되 좌우 동일하게 적용
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

    // 입 아래쪽이 같이 끌려 올라가면 찌그러져 보여서 감쇠
    const belowFadeL = clamp((leftCorner.y - y + sigmaY * 0.35) / (sigmaY * 1.35), 0, 1);
    const belowFadeR = clamp((rightCorner.y - y + sigmaY * 0.35) / (sigmaY * 1.35), 0, 1);

    // LEFT
    dx += (-SCALE * H) * leftAmount * gL * belowFadeL;
    dy += (-SCALE * V) * leftAmount * gL * belowFadeL;

    // RIGHT
    dx += (+SCALE * H) * rightAmount * gR * belowFadeR;
    dy += (-SCALE * V) * rightAmount * gR * belowFadeR;

    // 좌우 공통 보조 리프트
    dx += (-0.28) * leftAmount * gLCheek;
    dy += (-0.36) * leftAmount * gLCheek;

    dx += (+0.28) * rightAmount * gRCheek;
    dy += (-0.36) * rightAmount * gRCheek;

    influence = Math.max(gL, gR, gLCheek, gRCheek);

    return { dx, dy, influence };
}

/* ===============================
   Lip volume warp
   upper : lower = 2 : 3
   - upper lip moves upward
   - lower lip moves downward
   - center stronger, corners weaker
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

    let dy = 0;
    dy -= upperAmount * gUpper * edgeWeight;
    dy += lowerAmount * gLower * edgeWeight;

    const seamFade = clamp(Math.abs(y - mouthCy) / Math.max(5, sigmaY * 0.9), 0, 1);
    dy *= 0.35 + 0.65 * seamFade;

    const influence = Math.max(gUpper, gLower) * edgeWeight;
    return { dx: 0, dy, influence };
}

/* ===============================
   MAIN
================================= */
export function computeDisplacement(state, x, y, data) {
    let dx = 0;
    let dy = 0;
    let influence = 0;

    const smileDisp = computeSmileCornerWarp(x, y, data);
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
   APPLY
================================= */
export function applyWarp(state, dom, data) {
    const { srcCtx, workCtx } = dom.ctx;

    const srcImg = srcCtx.getImageData(0, 0, TARGET_W, TARGET_H);
    const dstImg = workCtx.createImageData(TARGET_W, TARGET_H);

    const src = srcImg.data;
    const dst = dstImg.data;
    dst.set(src);

    for (let y = 0; y < TARGET_H; y++) {
        for (let x = 0; x < TARGET_W; x++) {
            const disp = computeDisplacement(state, x, y, data);
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

    workCtx.putImageData(dstImg, 0, 0);
}