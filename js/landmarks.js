import {
    TARGET_W, TARGET_H,
    IDX_LEFT_CORNER, IDX_RIGHT_CORNER,
    LEFT_EYE_TOP, LEFT_EYE_BOTTOM, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM,
    LEFT_EYE_OUTER, LEFT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_EYE_INNER
} from "./constants.js";
import { clamp } from "./utils.js";

export function getLm(state, index) {
    const p = state.sourceMeta?.landmarks?.[index];
    if (!p) throw new Error(`랜드마크 ${index}가 없습니다.`);
    return p;
}

export function getAveragePoint(state, indices) {
    let x = 0;
    let y = 0;
    for (const idx of indices) {
        const p = getLm(state, idx);
        x += p.x;
        y += p.y;
    }
    return { x: x / indices.length, y: y / indices.length };
}

export function getBounds(state, indices, padX = 0, padY = padX) {
    let minX = TARGET_W, minY = TARGET_H, maxX = 0, maxY = 0;
    for (const idx of indices) {
        const p = getLm(state, idx);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return {
        left: Math.floor(clamp(minX - padX, 0, TARGET_W - 1)),
        top: Math.floor(clamp(minY - padY, 0, TARGET_H - 1)),
        right: Math.floor(clamp(maxX + padX, 0, TARGET_W - 1)),
        bottom: Math.floor(clamp(maxY + padY, 0, TARGET_H - 1))
    };
}

export function getEyeOpenRatio(state, isLeft) {
    const top = getLm(state, isLeft ? LEFT_EYE_TOP : RIGHT_EYE_TOP);
    const bottom = getLm(state, isLeft ? LEFT_EYE_BOTTOM : RIGHT_EYE_BOTTOM);
    const outer = getLm(state, isLeft ? LEFT_EYE_OUTER : RIGHT_EYE_OUTER);
    const inner = getLm(state, isLeft ? LEFT_EYE_INNER : RIGHT_EYE_INNER);
    const h = Math.abs(top.y - bottom.y);
    const w = Math.max(1, Math.abs(outer.x - inner.x));
    return h / w;
}

export function buildData(state, dom) {
    const leftCorner = getLm(state, IDX_LEFT_CORNER);
    const rightCorner = getLm(state, IDX_RIGHT_CORNER);

    const sliders = dom.sliders;
    const leftLift = Number(sliders.leftLift.value);
    const rightLift = Number(sliders.rightLift.value);
    const sigmaX = Number(sliders.sigmaX.value);
    const sigmaY = Number(sliders.sigmaY.value);
    const roiPad = Number(sliders.roiPad.value);

    const roi = {
        left: Math.floor(clamp(Math.min(leftCorner.x, rightCorner.x) - roiPad, 0, TARGET_W - 1)),
        right: Math.floor(clamp(Math.max(leftCorner.x, rightCorner.x) + roiPad, 0, TARGET_W - 1)),
        top: Math.floor(clamp(Math.min(leftCorner.y, rightCorner.y) - roiPad, 0, TARGET_H - 1)),
        bottom: Math.floor(clamp(Math.max(leftCorner.y, rightCorner.y) + roiPad, 0, TARGET_H - 1))
    };

    return {
        leftCorner,
        rightCorner,
        leftLift,
        rightLift,
        sigmaX,
        sigmaY,
        roi,

        faceBlur: Number(sliders.faceBlur.value),
        faceSharpen: Number(sliders.faceSharpen.value),
        globalBrightness: Number(sliders.globalBrightness.value),
        faceLively: Number(sliders.faceLively.value) / 100,
        faceBlemish: Number(sliders.faceBlemish.value) / 100,
        eyeLift: Number(sliders.eyeLift.value) / 100,
        noseSlim: Number(sliders.noseSlim.value) / 100,
        noseWingSlim: Number(sliders.noseWingSlim.value) / 100,
        jawSlim: Number(sliders.jawSlim.value) / 100,

        noseDepth: Number(sliders.noseDepth.value) / 100,
        eyeLine: Number(sliders.eyeLine.value) / 100,
        irisDeepen: Number(sliders.irisDeepen.value) / 100,
        eyeOpenAuto: Number(sliders.eyeOpenAuto.value) / 100,
        eyebrowCleanup: Number(sliders.eyebrowCleanup.value) / 100,
        eyebrowTailTrim: Number(sliders.eyebrowTailTrim.value) / 100,

        lipSaturation: Number(sliders.lipSaturation.value) / 100,
        lipBrightness: Number(sliders.lipBrightness.value) / 100,
        lipCenterGlow: Number(sliders.lipCenterGlow.value) / 100,
        lipVolume: Number(sliders.lipVolume.value) / 100,

        eyebrowInnerSoft: Number(sliders.eyebrowInnerSoft.value) / 100,
        eyebrowOuterClean: Number(sliders.eyebrowOuterClean.value) / 100,
        eyebrowFill: Number(sliders.eyebrowFill.value) / 100,

        // 턱 관련 신규 슬라이더도 같이 넘기고 싶으면 여기 추가 가능
        jawWidth: Number(sliders.jawWidth.value) / 100,
        jawSmooth: Number(sliders.jawSmooth.value) / 100,
        marionetteLift: Number(sliders.marionetteLift.value) / 100,

        leftEyeOpenRatio: getEyeOpenRatio(state, true),
        rightEyeOpenRatio: getEyeOpenRatio(state, false)
    };
}