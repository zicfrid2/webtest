import { TARGET_W, TARGET_H } from "./constants.js";
import { clamp, luminance } from "./utils.js";
import { buildFaceMask } from "./masks.js";
import { getBounds } from "./landmarks.js";

/* -------------------------------------------------------
 * 보호할 얼굴 부위 인덱스
 * MediaPipe Face Mesh 기준
 * ----------------------------------------------------- */
const LEFT_EYE_INDICES = [
    33, 133, 160, 159, 158, 157, 173, 153, 154, 155, 144, 145, 246, 161, 163, 7
];

const RIGHT_EYE_INDICES = [
    362, 263, 387, 386, 385, 384, 398, 373, 374, 380, 381, 382, 466, 388, 390, 249
];

const LEFT_BROW_INDICES = [
    46, 53, 52, 65, 55, 70, 63, 105, 66, 107
];

const RIGHT_BROW_INDICES = [
    276, 283, 282, 295, 285, 300, 293, 334, 296, 336
];

const OUTER_LIPS_INDICES = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185
];

const INNER_LIPS_INDICES = [
    78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
    415, 310, 311, 312, 13, 82, 81, 80, 191
];

/* -------------------------------------------------------
 * 공용 유틸
 * ----------------------------------------------------- */
function createBlurredFaceVersion(dom, radius, sourceCanvas) {
    const { tempCtx2 } = dom.ctx;
    tempCtx2.clearRect(0, 0, TARGET_W, TARGET_H);
    tempCtx2.save();
    tempCtx2.filter = `blur(${radius}px)`;
    tempCtx2.drawImage(sourceCanvas, 0, 0);
    tempCtx2.restore();
}

function createBlemishSmoothVersion(dom, radius) {
    const { tempCtx3 } = dom.ctx;
    tempCtx3.clearRect(0, 0, TARGET_W, TARGET_H);
    tempCtx3.save();
    tempCtx3.filter = `blur(${radius}px)`;
    tempCtx3.drawImage(dom.canvas.workCanvas, 0, 0);
    tempCtx3.restore();
}

function expandBox(box, pad) {
    return {
        left: clamp(box.left - pad, 0, TARGET_W - 1),
        top: clamp(box.top - pad, 0, TARGET_H - 1),
        right: clamp(box.right + pad, 0, TARGET_W - 1),
        bottom: clamp(box.bottom + pad, 0, TARGET_H - 1)
    };
}

function softRectMask(img, box, feather = 20, alpha = 255) {
    const px = img.data;
    const w = img.width;
    const h = img.height;

    const left = clamp(Math.floor(box.left), 0, w - 1);
    const top = clamp(Math.floor(box.top), 0, h - 1);
    const right = clamp(Math.floor(box.right), 0, w - 1);
    const bottom = clamp(Math.floor(box.bottom), 0, h - 1);

    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            const dx = Math.min(x - left, right - x);
            const dy = Math.min(y - top, bottom - y);
            const edge = Math.min(dx, dy);

            let falloff = 1;
            if (edge < feather) {
                falloff = edge / Math.max(1, feather);
            }

            const a = alpha * clamp(falloff, 0, 1);
            const i = (y * w + x) * 4;

            px[i] = Math.max(px[i], a);
            px[i + 1] = Math.max(px[i + 1], a);
            px[i + 2] = Math.max(px[i + 2], a);
            px[i + 3] = 255;
        }
    }
}

function getMaskAlpha(imgData, x, y) {
    if (x < 0 || y < 0 || x >= imgData.width || y >= imgData.height) return 0;
    const i = (y * imgData.width + x) * 4;
    return imgData.data[i] / 255;
}

/* -------------------------------------------------------
 * 눈 / 눈썹 / 입술 보호 마스크 생성
 * regionCanvas2 사용
 * ----------------------------------------------------- */
function buildFeatureExclusionMask(state, dom) {
    const { regionCanvas2 } = dom.canvas;
    const { regionCtx2 } = dom.ctx;

    regionCtx2.clearRect(0, 0, TARGET_W, TARGET_H);

    const exclusion = regionCtx2.getImageData(0, 0, TARGET_W, TARGET_H);

    const leftEyeBox = expandBox(getBounds(state, LEFT_EYE_INDICES, 22, 20), 8);
    const rightEyeBox = expandBox(getBounds(state, RIGHT_EYE_INDICES, 22, 20), 8);

    const leftBrowBox = expandBox(getBounds(state, LEFT_BROW_INDICES, 24, 22), 12);
    const rightBrowBox = expandBox(getBounds(state, RIGHT_BROW_INDICES, 24, 22), 12);

    const lipIndices = [...OUTER_LIPS_INDICES, ...INNER_LIPS_INDICES];
    const lipsBox = expandBox(getBounds(state, lipIndices, 26, 20), 10);

    // 부드러운 보호 마스크
    softRectMask(exclusion, leftEyeBox, 24, 255);
    softRectMask(exclusion, rightEyeBox, 24, 255);
    softRectMask(exclusion, leftBrowBox, 26, 255);
    softRectMask(exclusion, rightBrowBox, 26, 255);
    softRectMask(exclusion, lipsBox, 24, 255);

    regionCtx2.putImageData(exclusion, 0, 0);

    return {
        imgData: exclusion,
        leftEyeBox,
        rightEyeBox,
        leftBrowBox,
        rightBrowBox,
        lipsBox,
        canvas: regionCanvas2
    };
}

/* -------------------------------------------------------
 * 밝기
 * ----------------------------------------------------- */
export function applyGlobalBrightness(dom, data) {
    if (data.globalBrightness === 0) return;

    const { workCtx } = dom.ctx;
    const img = workCtx.getImageData(0, 0, TARGET_W, TARGET_H);
    const px = img.data;

    for (let i = 0; i < px.length; i += 4) {
        px[i] = clamp(px[i] + data.globalBrightness, 0, 255);
        px[i + 1] = clamp(px[i + 1] + data.globalBrightness, 0, 255);
        px[i + 2] = clamp(px[i + 2] + data.globalBrightness, 0, 255);
    }

    workCtx.putImageData(img, 0, 0);
}

/* -------------------------------------------------------
 * 얼굴 생기
 * ----------------------------------------------------- */
export function applyFaceVibrance(dom, bbox, lively01) {
    if (lively01 <= 0) return;

    const { workCtx, maskCtx } = dom.ctx;
    const w = bbox.right - bbox.left + 1;
    const h = bbox.bottom - bbox.top + 1;

    const img = workCtx.getImageData(bbox.left, bbox.top, w, h);
    const mask = maskCtx.getImageData(bbox.left, bbox.top, w, h);

    const px = img.data;
    const mx = mask.data;
    const contrast = 1 + lively01 * 0.18;
    const vibrance = lively01 * 0.42;

    for (let i = 0; i < px.length; i += 4) {
        const alpha = mx[i] / 255;
        if (alpha <= 0.001) continue;

        let r = px[i];
        let g = px[i + 1];
        let b = px[i + 2];

        const avg = (r + g + b) / 3;

        r = avg + (r - avg) * contrast;
        g = avg + (g - avg) * contrast;
        b = avg + (b - avg) * contrast;

        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const satBoost = 1 + vibrance * (1 - (maxC - minC) / 255);

        r = avg + (r - avg) * satBoost;
        g = avg + (g - avg) * satBoost;
        b = avg + (b - avg) * satBoost;

        px[i] = clamp(px[i] * (1 - alpha) + clamp(r, 0, 255) * alpha, 0, 255);
        px[i + 1] = clamp(px[i + 1] * (1 - alpha) + clamp(g, 0, 255) * alpha, 0, 255);
        px[i + 2] = clamp(px[i + 2] * (1 - alpha) + clamp(b, 0, 255) * alpha, 0, 255);
    }

    workCtx.putImageData(img, bbox.left, bbox.top);
}

/* -------------------------------------------------------
 * 약한 얼굴 블러
 * ----------------------------------------------------- */
export function blendBlurWithMask(dom, bbox, radius) {
    if (radius <= 0) return;

    createBlurredFaceVersion(dom, radius, dom.canvas.workCanvas);

    const { workCtx, tempCtx2, maskCtx } = dom.ctx;
    const w = bbox.right - bbox.left + 1;
    const h = bbox.bottom - bbox.top + 1;

    const baseImg = workCtx.getImageData(bbox.left, bbox.top, w, h);
    const blurImg = tempCtx2.getImageData(bbox.left, bbox.top, w, h);
    const maskImg = maskCtx.getImageData(bbox.left, bbox.top, w, h);

    const base = baseImg.data;
    const blur = blurImg.data;
    const mask = maskImg.data;

    const blurMix = clamp(radius / 20, 0, 1) * 0.7;

    for (let i = 0; i < base.length; i += 4) {
        const alpha = (mask[i] / 255) * blurMix;
        if (alpha <= 0.001) continue;

        base[i] = base[i] * (1 - alpha) + blur[i] * alpha;
        base[i + 1] = base[i + 1] * (1 - alpha) + blur[i + 1] * alpha;
        base[i + 2] = base[i + 2] * (1 - alpha) + blur[i + 2] * alpha;
    }

    workCtx.putImageData(baseImg, bbox.left, bbox.top);
}

/* -------------------------------------------------------
 * 강하게 체감되는 피부 정리 / 잡티 완화
 * - 눈썹 / 눈 / 입술 보호
 * - 얼굴 피부만 스무딩
 * - 어두운 잡티 + 붉은기 + 잔결 완화
 * - 너무 플라스틱처럼 되지 않게 경계 보호
 * ----------------------------------------------------- */
export function applyBlemishRemoval(state, dom, bbox, data) {
    const amount01 = clamp(data.faceBlemish ?? 0, 0, 1);
    if (amount01 <= 0) return;

    const exclusionMask = buildFeatureExclusionMask(state, dom);

    // 체감이 확 나도록 반경 자체를 좀 더 키움
    const rFine = 2.2 + amount01 * 3.2;
    const rSoft = 5.5 + amount01 * 7.5;

    createBlemishSmoothVersion(dom, rFine);
    const { tempCtx3, tempCtx2, workCtx, maskCtx } = dom.ctx;

    const w = bbox.right - bbox.left + 1;
    const h = bbox.bottom - bbox.top + 1;

    const fineImg = tempCtx3.getImageData(bbox.left, bbox.top, w, h);

    createBlurredFaceVersion(dom, rSoft, dom.canvas.workCanvas);
    const softImg = tempCtx2.getImageData(bbox.left, bbox.top, w, h);

    const baseImg = workCtx.getImageData(bbox.left, bbox.top, w, h);
    const faceMaskImg = maskCtx.getImageData(bbox.left, bbox.top, w, h);

    const base = baseImg.data;
    const faceMask = faceMaskImg.data;
    const fine = fineImg.data;
    const soft = softImg.data;
    const exclusion = exclusionMask.imgData;

    for (let y = 0; y < h; y++) {
        const gy = bbox.top + y;

        for (let x = 0; x < w; x++) {
            const gx = bbox.left + x;
            const i = (y * w + x) * 4;

            const faceAlpha = faceMask[i] / 255;
            if (faceAlpha <= 0.001) continue;

            // 눈 / 눈썹 / 입술 보호
            const excluded = getMaskAlpha(exclusion, gx, gy);
            if (excluded > 0.02) continue;

            const r = base[i];
            const g = base[i + 1];
            const b = base[i + 2];

            const lum = luminance(r, g, b);
            const fineLum = luminance(fine[i], fine[i + 1], fine[i + 2]);
            const softLum = luminance(soft[i], soft[i + 1], soft[i + 2]);

            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC - minC;

            // 잡티 / 잔결 / 붉은기 탐지
            const darkDefect = clamp((fineLum - lum + 4) / 18, 0, 1);
            const textureDiff = clamp(Math.abs(lum - fineLum) / 18, 0, 1);
            const redCast = clamp((r - (g * 0.72 + b * 0.28) - 3) / 24, 0, 1);

            // 강한 엣지는 보호
            const edgeStrength = clamp(Math.abs(lum - softLum) / 60, 0, 1);
            const edgeProtect = 1 - edgeStrength * 0.62;

            // 채도 높은 부분은 덜 건드림
            const chromaProtect = 1 - clamp((sat - 40) / 120, 0, 0.55);

            // 하이라이트 지나친 부분 덜 건드림
            const highlightProtect = 1 - clamp((lum - 205) / 70, 0, 0.45);

            // 피부색 비슷한 영역 우선
            const skinLike =
                (r > 42 && g > 28 && b > 18 && r >= g * 0.9)
                    ? 1.0
                    : 0.82;

            let blend =
                (
                    darkDefect * 0.52 +
                    textureDiff * 0.62 +
                    redCast * 0.26
                ) *
                edgeProtect *
                chromaProtect *
                highlightProtect *
                faceAlpha *
                skinLike;

            // 슬라이더가 더 세게 반영되도록
            blend *= (0.38 + amount01 * 1.18);
            blend = Math.pow(clamp(blend, 0, 1), 0.82);

            if (blend <= 0.001) continue;

            // 강한 체감용 혼합 비율
            const mixFine = 0.76 * blend;
            const mixSoft = 0.44 * blend;

            const rr = base[i] * (1 - mixFine - mixSoft) + fine[i] * mixFine + soft[i] * mixSoft;
            const gg = base[i + 1] * (1 - mixFine - mixSoft) + fine[i + 1] * mixFine + soft[i + 1] * mixSoft;
            const bb = base[i + 2] * (1 - mixFine - mixSoft) + fine[i + 2] * mixFine + soft[i + 2] * mixSoft;

            // 아주 약한 톤 정리
            const avg = (rr + gg + bb) / 3;
            const toneUnify = 0.05 * blend;

            base[i] = clamp(rr * (1 - toneUnify) + avg * toneUnify, 0, 255);
            base[i + 1] = clamp(gg * (1 - toneUnify) + avg * toneUnify, 0, 255);
            base[i + 2] = clamp(bb * (1 - toneUnify) + avg * toneUnify, 0, 255);
        }
    }

    workCtx.putImageData(baseImg, bbox.left, bbox.top);

    return exclusionMask;
}

/* -------------------------------------------------------
 * 샤픈
 * ----------------------------------------------------- */
export function applySharpen(dom, bbox, amountPercent) {
    const amount = amountPercent / 100;
    if (amount <= 0) return;

    const { workCtx, maskCtx } = dom.ctx;
    const w = bbox.right - bbox.left + 1;
    const h = bbox.bottom - bbox.top + 1;

    const srcImg = workCtx.getImageData(bbox.left, bbox.top, w, h);
    const maskImg = maskCtx.getImageData(bbox.left, bbox.top, w, h);

    const src = srcImg.data;
    const out = new Uint8ClampedArray(src);
    const mask = maskImg.data;

    const kCenter = 1 + 4 * amount;
    const kSide = -amount;
    const idx = (x, y) => (y * w + x) * 4;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = idx(x, y);
            const alpha = mask[i] / 255;
            if (alpha <= 0.001) continue;

            for (let c = 0; c < 3; c++) {
                const v =
                    src[idx(x, y) + c] * kCenter +
                    src[idx(x - 1, y) + c] * kSide +
                    src[idx(x + 1, y) + c] * kSide +
                    src[idx(x, y - 1) + c] * kSide +
                    src[idx(x, y + 1) + c] * kSide;

                out[i + c] = clamp(
                    src[i + c] * (1 - alpha) + clamp(v, 0, 255) * alpha,
                    0,
                    255
                );
            }
        }
    }

    workCtx.putImageData(new ImageData(out, w, h), bbox.left, bbox.top);
}

/* -------------------------------------------------------
 * 전체 얼굴 효과
 * 순서도 피부 보정 체감 위주로 조정
 * ----------------------------------------------------- */
export function applyFaceEffects(state, dom, data) {
    const bbox = buildFaceMask(state, dom);

    // 1. 피부 정리 먼저
    applyBlemishRemoval(state, dom, bbox, data);

    // 2. 약한 전체 블러
    blendBlurWithMask(dom, bbox, data.faceBlur * 0.65);

    // 3. 생기
    applyFaceVibrance(dom, bbox, data.faceLively);

    // 4. 마지막 샤픈
    applySharpen(dom, bbox, data.faceSharpen);

    return bbox;
}