const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Canvas, Image, loadImage: loadCanvasImage } = require('skia-canvas');

const FACE_FX_DEFAULTS = {
    // 4. 콧볼 축소 워프
    noseWingSlim: 5,
    // 5. 코 입체감 보정
    noseDepth: 0,
    // 6. 눈매 강화
    eyeLine: 30,
    irisBlack: 100,

    // 🔥 추가 (눈 윗라인 리프트)
    eyeUpperLift: 50,

    // 🔥 추가 (입꼬리 올림 워프)
    mouthSmileLift: 50,

    // 7. 눈 개방감 보정
    eyeOpenAuto: 5,
    // 8. 눈썹 보정
    eyebrowFill: 50,
    eyebrowCleanup: 10,
    eyebrowTailTrim: 10,
    // 9. 입술 보정
    lipVolume: 0,
    lipSaturation: 50,
    lipBrightness: 30,
    lipCenterGlow: 0,
    // 10. 전체 톤 마감
    globalBrightness: 5,
    faceLively: 5,
    faceSharpen: 15,
    faceWhiten: 2,

    faceOvalSmooth: 40,
    faceContourSmoot: 100,
    blemishRemove: 120,
    eyeLowerLift: 0
};

function createCanvas(width = 1, height = 1) {
    const canvas = new Canvas(Math.max(1, width), Math.max(1, height));
    canvas.clientWidth = canvas.width;
    canvas.clientHeight = canvas.height;
    canvas.getBoundingClientRect = () => ({
        width: canvas.clientWidth || canvas.width,
        height: canvas.clientHeight || canvas.height,
    });
    return canvas;
}


const fx = { ...FACE_FX_DEFAULTS };

const LEFT_EYEBROW = [70, 63, 105, 66, 107, 55, 65, 52];
//const RIGHT_EYEBROW = [336, 296, 334, 293, 300, 285, 295, 282];
const RIGHT_EYEBROW = [282, 295, 285, 336, 296, 334, 293, 300];

//const LEFT_EYE = [33, 133, 159, 145, 160, 144, 158, 153, 173];
//const RIGHT_EYE = [362, 263, 386, 374, 387, 373, 385, 380, 398];
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];

const LEFT_EYE = [
    33, 133, 160, 159, 158, 157, 173, 153, 154, 155, 144, 145, 246, 161, 163, 7
];

const RIGHT_EYE = [
    362, 263, 387, 386, 385, 384, 398, 373, 374, 380, 381, 382, 466, 388, 390, 249
];

const LEFT_EYE_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const RIGHT_EYE_UPPER = [362, 466, 388, 387, 386, 385, 384, 398, 263];


const LEFT_EYE_LOWER = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const RIGHT_EYE_LOWER = [362, 249, 390, 373, 374, 380, 381, 382, 263];

const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
    361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
    176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109
];

//[323, 361, 288, 397, 365], [93, 132, 58, 172, 136]

/*
const OUTER_LIPS = [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
    291, 375, 321, 405, 314, 17, 84, 181, 91, 146
];
const INNER_LIPS = [
    78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
    308, 415, 310, 311, 312, 13, 82, 81, 80, 191
];
*/
const upperLipTopFull = [61, 185, 40, 39, 37, 267, 269, 270, 409];

const OUTER_LIPS = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
    291, 409, 270, 269, 267, 0, 37, 39, 40, 185
];

const INNER_LIPS = [
    78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
    308, 415, 310, 311, 312, 13, 82, 81, 80, 191
];




const UPPER_LIP_CENTER = 13;
const LOWER_LIP_CENTER = 14;
const LIP_LEFT = 61;
const LIP_RIGHT = 291;

const NOSE_BRIDGE_UP = 168;
const NOSE_BRIDGE_MID = 6;
const NOSE_TIP = 1;
const NOSE_BASE = 2;
const NOSE_LEFT_WING = 49;
const NOSE_RIGHT_WING = 279;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


function gaussian2D(dx, dy, sigmaX, sigmaY) {
    const sx = Math.max(1e-4, sigmaX);
    const sy = Math.max(1e-4, sigmaY);
    return Math.exp(-0.5 * ((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy)));
}

function bilinearSampleImageData(src, width, height, x, y) {
    const sx = clamp(x, 0, width - 1);
    const sy = clamp(y, 0, height - 1);

    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);

    const tx = sx - x0;
    const ty = sy - y0;

    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;

    const out = [0, 0, 0, 255];

    for (let c = 0; c < 4; c++) {
        const v00 = src[i00 + c];
        const v10 = src[i10 + c];
        const v01 = src[i01 + c];
        const v11 = src[i11 + c];

        const v0 = lerp(v00, v10, tx);
        const v1 = lerp(v01, v11, tx);
        out[c] = lerp(v0, v1, ty);
    }

    return out;
}

function createContextState() {
    return {
        afterData: {},
        forwardData: {},
        bootstrap: {},
        originalCanvas: createCanvas(1, 1),
        previewCanvas: createCanvas(1, 1),
        workCanvas: createCanvas(1, 1),
        setStatus() { },
        setInfo() { },
    };
}

let currentContext = createContextState();

function setRuntimeContext(ctx) {
    currentContext = ctx;
}

function getRuntimeContext() {
    return currentContext;
}

function setStatus(message) {
    getRuntimeContext().setStatus(message);
}

function setInfo(message) {
    getRuntimeContext().setInfo(message);
}


function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`before_image_load_failed: ${url}`));
        img.src = url;
    });
}

function ensureHiddenWorkCanvas() {
    return createCanvas(1, 1);
}

function getDisplaySize(canvas, fallbackW = 320, fallbackH = 320) {
    if (!canvas) return { width: fallbackW, height: fallbackH };

    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const width = Math.max(1, Math.round(rect?.width || canvas.clientWidth || fallbackW));
    const height = Math.max(1, Math.round(rect?.height || canvas.clientHeight || fallbackH));

    return { width, height };
}

function setupDisplayCanvas(canvas, width, height) {
    const dpr = 1;
    const pixelW = Math.max(1, Math.round(width * dpr));
    const pixelH = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    return ctx;
}

function drawCoverFromSourceToCanvas(source, canvas) {
    if (!source || !canvas) return;

    const srcW = source.width || source.videoWidth || source.naturalWidth || 1;
    const srcH = source.height || source.videoHeight || source.naturalHeight || 1;
    const { width: boxW, height: boxH } = getDisplaySize(canvas, srcW, srcH);
    const ctx = setupDisplayCanvas(canvas, boxW, boxH);

    const scale = Math.max(boxW / srcW, boxH / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (boxW - drawW) * 0.5;
    const dy = (boxH - drawH) * 0.5;

    ctx.drawImage(source, dx, dy, drawW, drawH);
}

function drawImageToWorkCanvas(canvas, img) {
    if (!canvas || !img) return;

    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    canvas.width = srcW;
    canvas.height = srcH;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, srcW, srcH);
    ctx.drawImage(img, 0, 0, srcW, srcH);
}

function normalizeLandmarks(raw, width, height) {
    if (!Array.isArray(raw)) return null;

    const result = raw
        .map((lm) => {
            if (!lm || typeof lm !== "object") return null;

            const x = Number(lm.x ?? 0);
            const y = Number(lm.y ?? 0);
            const z = Number(lm.z ?? 0);

            const px = Math.abs(x) <= 1.5 ? x * width : x;
            const py = Math.abs(y) <= 1.5 ? y * height : y;

            return { x: px, y: py, z };
        })
        .filter(Boolean);

    return result.length ? result : null;
}

function getLm(landmarks, idx) {
    const lm = landmarks?.[idx];
    return lm || { x: 0, y: 0, z: 0 };
}

function avgPoint(landmarks, indices) {
    if (!Array.isArray(indices) || !indices.length) return { x: 0, y: 0 };

    let sx = 0;
    let sy = 0;

    for (const idx of indices) {
        const p = getLm(landmarks, idx);
        sx += p.x;
        sy += p.y;
    }

    return { x: sx / indices.length, y: sy / indices.length };
}

function eyeOpenRatio(landmarks, isLeft) {
    const top = getLm(landmarks, isLeft ? 159 : 386);
    const bottom = getLm(landmarks, isLeft ? 145 : 374);
    const outer = getLm(landmarks, isLeft ? 33 : 362);
    const inner = getLm(landmarks, isLeft ? 133 : 263);

    const eyeH = Math.max(1, Math.abs(inner.x - outer.x));
    const eyeV = Math.max(0.1, Math.abs(bottom.y - top.y));
    return eyeV / eyeH;
}

function beginPolygonPath(ctx, landmarks, indices) {
    const first = getLm(landmarks, indices[0]);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < indices.length; i++) {
        const p = getLm(landmarks, indices[i]);
        ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
}

/////////////////////////////////////////////////////////////////////////////////////
function applyEyebrowCleanup(ctx, canvas, landmarks, fxData) {
    const cleanup = (fxData.eyebrowCleanup || 0) / 100;
    const tailTrim = (fxData.eyebrowTailTrim || 0) / 100;
    const fill = (fxData.eyebrowFill || 0) / 100;
    if (cleanup <= 0 && tailTrim <= 0 && fill <= 0) return;

    const srcImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = srcImg.data;
    const original = new Uint8ClampedArray(px);

    const leftBrowMask = buildPolygonMask(ctx, canvas, landmarks, LEFT_EYEBROW, 0).data;
    const rightBrowMask = buildPolygonMask(ctx, canvas, landmarks, RIGHT_EYEBROW, 0).data;

    const leftTone = estimateBrowTone(ctx, canvas, landmarks, LEFT_EYEBROW, leftBrowMask);
    const rightTone = estimateBrowTone(ctx, canvas, landmarks, RIGHT_EYEBROW, rightBrowMask);

    const lBrowCenter = avgPoint(landmarks, LEFT_EYEBROW);
    const rBrowCenter = avgPoint(landmarks, RIGHT_EYEBROW);

    const lEyeCenter = avgPoint(landmarks, LEFT_EYE);
    const rEyeCenter = avgPoint(landmarks, RIGHT_EYE);

    const lOuter = getLm(landmarks, LEFT_EYEBROW[0]);
    const rOuter = getLm(landmarks, RIGHT_EYEBROW[0]);

    // 밝은 부분 위주로 채우기
    const FILL_LUMA_THRESHOLD = 75;
    const CLEANUP_LUMA_THRESHOLD = 90;
    const TAIL_LUMA_THRESHOLD = 100;

    // 브러시를 위한 오버레이 캔버스
    const brushCanvas = new Canvas(canvas.width, canvas.height);
    brushCanvas.width = canvas.width;
    brushCanvas.height = canvas.height;
    const bctx = brushCanvas.getContext("2d");
    bctx.clearRect(0, 0, canvas.width, canvas.height);

    // 샘플 간격: 작을수록 더 촘촘하게 칠함
    const STEP_X = 2;
    const STEP_Y = 2;

    for (let y = 0; y < canvas.height; y += STEP_Y) {
        for (let x = 0; x < canvas.width; x += STEP_X) {
            const i = (y * canvas.width + x) * 4;

            const leftA = leftBrowMask[i] / 255;
            const rightA = rightBrowMask[i] / 255;
            const browMaskA = Math.max(leftA, rightA);
            if (browMaskA <= 0.001) continue;

            const isLeft = leftA >= rightA;
            const tone = isLeft ? leftTone : rightTone;
            const browCenter = isLeft ? lBrowCenter : rBrowCenter;
            const eyeCenter = isLeft ? lEyeCenter : rEyeCenter;
            const outer = isLeft ? lOuter : rOuter;

            const gBrow = gaussian2D(x - browCenter.x, y - browCenter.y, 95, 36);
            const eyeProtect = gaussian2D(x - eyeCenter.x, y - eyeCenter.y, 90, 42);
            const tailMask = gaussian2D(
                x - (outer.x + (isLeft ? -18 : 18)),
                y - (outer.y - 2),
                42,
                18
            );

            const lum = luminance(px[i], px[i + 1], px[i + 2]);
            const originalLum = luminance(original[i], original[i + 1], original[i + 2]);

            let alpha = 0;

            // 1) 빈 영역 채우기
            if (
                gBrow > 0.05 &&
                eyeProtect < 0.60 &&
                lum > FILL_LUMA_THRESHOLD &&
                originalLum > FILL_LUMA_THRESHOLD
            ) {
                const emptyBoost = clamp((lum - FILL_LUMA_THRESHOLD) / 80, 0, 1);
                alpha += fill * gBrow * (0.30 + emptyBoost * 0.85);
            }

            // 2) 흐린 부분 보강
            if (
                gBrow > 0.08 &&
                eyeProtect < 0.55 &&
                lum > CLEANUP_LUMA_THRESHOLD &&
                originalLum > CLEANUP_LUMA_THRESHOLD
            ) {
                alpha += cleanup * gBrow * 0.55;
            }

            // 3) 꼬리 보정
            if (
                tailMask > 0.05 &&
                lum > TAIL_LUMA_THRESHOLD &&
                originalLum > TAIL_LUMA_THRESHOLD
            ) {
                alpha += tailTrim * tailMask * 0.80;
            }

            alpha *= browMaskA;
            alpha = clamp(alpha, 0, 1);
            if (alpha <= 0.001) continue;

            const centerFade = clamp(gBrow * 1.15, 0, 1);
            const finalAlpha = clamp(alpha * (0.82 + centerFade * 0.55), 0, 0.90);

            const targetR = clamp(tone[0] * 0.30, 0, 255);
            const targetG = clamp(tone[1] * 0.30, 0, 255);
            const targetB = clamp(tone[2] * 0.30, 0, 255);

            // 좌우 눈썹 방향
            let baseAngle;
            if (isLeft) {
                // 왼쪽 눈썹: 오른쪽 위 방향
                baseAngle = -0.22;
            } else {
                // 오른쪽 눈썹: 왼쪽 위 방향
                baseAngle = Math.PI + 0.22;
            }

            // 중심/꼬리 따라 길이와 각도 살짝 변화
            const tailBias = clamp(tailMask * 1.4, 0, 1);
            const centerBias = clamp(gBrow * 1.2, 0, 1);

            const jitterX = (Math.random() - 0.5) * 1.2;
            const jitterY = (Math.random() - 0.5) * 1.0;
            const jitterAngle = (Math.random() - 0.5) * 0.16;

            const angle = baseAngle + jitterAngle + (isLeft ? -0.08 : 0.08) * tailBias;
            const length = 4.5 + centerBias * 1.6 + tailBias * 1.2 + Math.random() * 1.0;
            const width = 0.9 + centerBias * 0.45 + Math.random() * 0.25;

            paintBrushStroke(
                bctx,
                x + jitterX,
                y + jitterY,
                [targetR, targetG, targetB],
                finalAlpha * 0.35,
                angle,
                length,
                width
            );
        }
    }

    // 최종 합성
    ctx.drawImage(brushCanvas, 0, 0);
}

function estimateBrowTone(ctx, canvas, landmarks, indices, browMaskData) {
    const pts = indices.map((i) => getLm(landmarks, i));
    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) - 10));
    const maxX = Math.min(canvas.width, Math.ceil(Math.max(...pts.map((p) => p.x)) + 10));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) - 10));
    const maxY = Math.min(canvas.height, Math.ceil(Math.max(...pts.map((p) => p.y)) + 10));

    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const img = ctx.getImageData(minX, minY, w, h).data;

    let rs = 0;
    let gs = 0;
    let bs = 0;
    let weightSum = 0;

    for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
            const fullIdx = (y * canvas.width + x) * 4;
            const m = browMaskData ? browMaskData[fullIdx] / 255 : 1;
            if (m <= 0.001) continue;

            const localX = x - minX;
            const localY = y - minY;
            const i = (localY * w + localX) * 4;

            const r = img[i];
            const g = img[i + 1];
            const b = img[i + 2];
            const lum = luminance(r, g, b);

            // 너무 밝은 피부 제외, 상대적으로 어두운 눈썹 색 위주 추정
            if (lum >= 165) continue;

            const darkWeight = clamp((165 - lum) / 110, 0, 1);
            const wgt = m * (0.35 + darkWeight * 0.65);

            rs += r * wgt;
            gs += g * wgt;
            bs += b * wgt;
            weightSum += wgt;
        }
    }

    if (weightSum <= 0.0001) return [70, 55, 50];
    return [rs / weightSum, gs / weightSum, bs / weightSum];
}

function paintBrushStroke(ctx, x, y, color, alpha, angle, length, width) {
    const a = clamp(alpha, 0, 1);
    if (a <= 0.001) return;

    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;

    ctx.save();
    ctx.strokeStyle = `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${a})`;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
}


function blendPixel(px, idx, tr, tg, tb, alpha) {
    const a = clamp(alpha, 0, 1);
    if (a <= 0.0001) return;

    px[idx] = clamp(Math.round(lerp(px[idx], tr, a)), 0, 255);
    px[idx + 1] = clamp(Math.round(lerp(px[idx + 1], tg, a)), 0, 255);
    px[idx + 2] = clamp(Math.round(lerp(px[idx + 2], tb, a)), 0, 255);
    px[idx + 3] = 255;
}

/////////////////////////////////////////////////////////////////////////////////////

function applyGlobalFinish(ctx, canvas, fxData) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;

    const brightness = (fxData.globalBrightness || 0) / 100;
    const lively = (fxData.faceLively || 0) / 100;
    const sharpen = (fxData.faceSharpen || 0) / 100;
    const whiten = (fxData.faceWhiten || 0) / 100;

    for (let i = 0; i < px.length; i += 4) {
        let r = px[i];
        let g = px[i + 1];
        let b = px[i + 2];

        // 밝기
        r = clamp(r + 255 * brightness, 0, 255);
        g = clamp(g + 255 * brightness, 0, 255);
        b = clamp(b + 255 * brightness, 0, 255);

        // 자연스러운 화이트 톤 (줄임)
        r = lerp(r, 255, whiten * 0.18);
        g = lerp(g, 255, whiten * 0.20);
        b = lerp(b, 255, whiten * 0.22);

        // 붉은기 제거 강화
        r *= (1 - whiten * 0.12);
        g *= (1 - whiten * 0.04);

        // 약한 쿨톤
        b += 5 * whiten;

        // 과한 빨강 억제
        const avgRgb = (r + g + b) / 3;
        if (r > avgRgb) {
            r = lerp(r, avgRgb, whiten * 0.5);
        }

        // 자연스러운 채도/대비
        const avg = (r + g + b) / 3;
        r = clamp(lerp(avg, r, 1 + lively * 0.25 + sharpen * 0.08), 0, 255);
        g = clamp(lerp(avg, g, 1 + lively * 0.22 + sharpen * 0.06), 0, 255);
        b = clamp(lerp(avg, b, 1 + lively * 0.20), 0, 255);

        px[i] = clamp(r, 0, 255);
        px[i + 1] = clamp(g, 0, 255);
        px[i + 2] = clamp(b, 0, 255);
    }

    ctx.putImageData(img, 0, 0);
}
function applyNoseWingSlimWarp(ctx, canvas, landmarks, fxData) {
    const strength = (fxData.noseWingSlim || 0) / 100;
    if (strength <= 0) return;

    const leftWing = getLm(landmarks, NOSE_LEFT_WING);
    const rightWing = getLm(landmarks, NOSE_RIGHT_WING);
    const bridgeUp = getLm(landmarks, NOSE_BRIDGE_UP);
    const bridgeMid = getLm(landmarks, NOSE_BRIDGE_MID);
    const tip = getLm(landmarks, NOSE_TIP);
    const base = getLm(landmarks, NOSE_BASE);

    const noseCenterX = (leftWing.x + rightWing.x) * 0.5;
    const noseCenterY = (bridgeMid.y + base.y) * 0.5;
    const noseWidth = Math.max(16, Math.abs(rightWing.x - leftWing.x));
    const noseHeight = Math.max(24, Math.abs(base.y - bridgeUp.y));

    const sigmaX = Math.max(10, noseWidth * 0.42);
    const sigmaY = Math.max(12, noseHeight * 0.34);

    const inwardAmount = noseWidth * (0.01 + strength * 0.16);
    const liftAmount = noseHeight * (0.01 + strength * 0.04);

    const padX = Math.max(24, Math.round(noseWidth * 1.0));
    const padYTop = Math.max(18, Math.round(noseHeight * 0.35));
    const padYBottom = Math.max(18, Math.round(noseHeight * 0.45));

    const minX = Math.max(0, Math.floor(Math.min(leftWing.x, rightWing.x) - padX));
    const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(leftWing.x, rightWing.x) + padX));
    const minY = Math.max(0, Math.floor(bridgeUp.y - padYTop));
    const maxY = Math.min(canvas.height - 1, Math.ceil(base.y + padYBottom));

    const srcImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = srcImg.data;
    const dstImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dst = dstImg.data;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const gWingL = gaussian2D(x - leftWing.x, y - leftWing.y, sigmaX, sigmaY);
            const gWingR = gaussian2D(x - rightWing.x, y - rightWing.y, sigmaX, sigmaY);

            const gLiftL = gaussian2D(
                x - leftWing.x,
                y - (leftWing.y + noseHeight * 0.10),
                sigmaX * 0.90,
                sigmaY * 0.80
            );
            const gLiftR = gaussian2D(
                x - rightWing.x,
                y - (rightWing.y + noseHeight * 0.10),
                sigmaX * 0.90,
                sigmaY * 0.80
            );

            const centerFadeX = clamp(1 - Math.abs(x - noseCenterX) / Math.max(1, noseWidth * 0.95), 0, 1);
            const lowerBias = clamp((y - bridgeMid.y) / Math.max(1, base.y - bridgeMid.y + 1), 0, 1);
            const tipProtect = 1 - gaussian2D(x - tip.x, y - tip.y, noseWidth * 0.30, noseHeight * 0.22) * 0.55;

            const dx =
                inwardAmount *
                (gWingL - gWingR) *
                (0.72 + 0.28 * lowerBias) *
                tipProtect;

            const dy =
                -liftAmount *
                (gLiftL + gLiftR) *
                (0.35 + 0.65 * centerFadeX);

            const influence = Math.max(gWingL, gWingR, gLiftL, gLiftR);
            if (influence < 0.001) continue;

            const rgba = bilinearSampleImageData(src, canvas.width, canvas.height, x - dx, y - dy);
            const di = (y * canvas.width + x) * 4;
            dst[di] = rgba[0];
            dst[di + 1] = rgba[1];
            dst[di + 2] = rgba[2];
            dst[di + 3] = 255;
        }
    }

    ctx.putImageData(dstImg, 0, 0);
}

function applyNoseDepth(ctx, landmarks, fxData) {
    const strength = (fxData.noseDepth || 0) / 100;
    if (strength <= 0) return;

    const up = getLm(landmarks, NOSE_BRIDGE_UP);
    const mid = getLm(landmarks, NOSE_BRIDGE_MID);
    const tip = getLm(landmarks, NOSE_TIP);
    const base = getLm(landmarks, NOSE_BASE);
    const leftWing = getLm(landmarks, NOSE_LEFT_WING);
    const rightWing = getLm(landmarks, NOSE_RIGHT_WING);

    const noseWidth = Math.max(12, Math.abs(rightWing.x - leftWing.x));
    const noseHeight = Math.max(20, Math.abs(base.y - up.y));

    ctx.save();
    ctx.globalCompositeOperation = "overlay";

    const centerGrad = ctx.createLinearGradient(up.x, up.y, tip.x, tip.y);
    centerGrad.addColorStop(0, `rgba(255,255,255,${0.10 + strength * 0.20})`);
    centerGrad.addColorStop(1, `rgba(255,255,255,${0.04 + strength * 0.08})`);
    ctx.strokeStyle = centerGrad;
    ctx.lineCap = "round";
    ctx.lineWidth = noseWidth * 0.18;
    ctx.beginPath();
    ctx.moveTo(up.x, up.y);
    ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y);
    ctx.stroke();

    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = `rgba(120,90,70,${0.05 + strength * 0.18})`;
    ctx.lineWidth = noseWidth * 0.14;

    ctx.beginPath();
    ctx.moveTo(up.x - noseWidth * 0.18, up.y + 4);
    ctx.quadraticCurveTo(mid.x - noseWidth * 0.24, mid.y, tip.x - noseWidth * 0.28, tip.y + noseHeight * 0.05);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(up.x + noseWidth * 0.18, up.y + 4);
    ctx.quadraticCurveTo(mid.x + noseWidth * 0.24, mid.y, tip.x + noseWidth * 0.28, tip.y + noseHeight * 0.05);
    ctx.stroke();

    ctx.restore();
}

function applyEyeLineEnhance(ctx, canvas, landmarks, fxData) {
    const lineStrength = (fxData.eyeLineEnhance || fxData.eyeLine || 0) / 100;
    const irisStrength = (fxData.irisDeepen || fxData.irisBlack || 0) / 100;
    if (lineStrength <= 0 && irisStrength <= 0) return;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    const clamp255 = (v) => Math.max(0, Math.min(255, v));

    const gaussian2DLocal = (dx, dy, sx, sy) => {
        return Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)));
    };

    const irisLeftIdx = (typeof LEFT_IRIS !== "undefined") ? LEFT_IRIS : [468, 469, 470, 471, 472];
    const irisRightIdx = (typeof RIGHT_IRIS !== "undefined") ? RIGHT_IRIS : [473, 474, 475, 476, 477];

    const getAvgPoint = (idxList) => {
        const pts = idxList.map(i => getLm(landmarks, i)).filter(Boolean);
        if (!pts.length) return null;

        let sx = 0;
        let sy = 0;
        for (let i = 0; i < pts.length; i++) {
            sx += pts[i].x;
            sy += pts[i].y;
        }

        return {
            x: sx / pts.length,
            y: sy / pts.length
        };
    };

    const drawEyeRegionEffect = (isLeft) => {
        const outer = getLm(landmarks, isLeft ? 33 : 362);
        const inner = getLm(landmarks, isLeft ? 133 : 263);
        const top = getLm(landmarks, isLeft ? 159 : 386);
        const bottom = getLm(landmarks, isLeft ? 145 : 374);
        const iris = getAvgPoint(isLeft ? irisLeftIdx : irisRightIdx);

        if (!outer || !inner || !top || !bottom || !iris) return;

        const cx = (outer.x + inner.x) * 0.5;
        const cy = (top.y + bottom.y) * 0.5;
        const eyeWidth = Math.max(12, Math.abs(inner.x - outer.x));
        const eyeHeight = Math.max(8, Math.abs(bottom.y - top.y));

        const regionPadX = eyeWidth * 0.22;
        const regionPadY = eyeHeight * 0.85;

        const minX = Math.max(0, Math.floor(Math.min(outer.x, inner.x) - regionPadX));
        const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(outer.x, inner.x) + regionPadX));
        const minY = Math.max(0, Math.floor(Math.min(top.y, bottom.y) - regionPadY));
        const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(top.y, bottom.y) + regionPadY));

        const eyeMaskSigmaX = Math.max(8, eyeWidth * 0.58);
        const eyeMaskSigmaY = Math.max(4, eyeHeight * 1.15);

        const upperSigmaX = Math.max(18, eyeWidth * 0.85);
        const upperSigmaY = Math.max(4, eyeHeight * 0.42);

        const lowerSigmaX = Math.max(18, eyeWidth * 0.90);
        const lowerSigmaY = Math.max(5, eyeHeight * 0.55);

        const irisSigmaX = Math.max(4, eyeWidth * 0.18);
        const irisSigmaY = Math.max(4, eyeHeight * 0.72);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const idx = (y * canvas.width + x) * 4;

                const eyeMask = gaussian2DLocal(x - cx, y - cy, eyeMaskSigmaX, eyeMaskSigmaY);
                if (eyeMask < 0.02) continue;

                const gUpper = gaussian2DLocal(x - top.x, y - top.y, upperSigmaX, upperSigmaY);
                const gLower = gaussian2DLocal(x - bottom.x, y - bottom.y, lowerSigmaX, lowerSigmaY);
                const gIris = gaussian2DLocal(x - iris.x, y - iris.y, irisSigmaX, irisSigmaY);

                const upperLine = gUpper * lineStrength;
                const lowerSoft = gLower * lineStrength * 0.35;
                const irisEffect = gIris * irisStrength;

                const darken = (upperLine * 18 + irisEffect * 26) * eyeMask;
                const brighten = (lowerSoft * 7) * eyeMask;

                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                const gray = (r + g + b) / 3;
                const desat = irisEffect * 0.18 * eyeMask;

                const nr = r * (1 - desat) + gray * desat;
                const ng = g * (1 - desat) + gray * desat;
                const nb = b * (1 - desat) + gray * desat;

                data[idx] = clamp255(nr - darken + brighten);
                data[idx + 1] = clamp255(ng - darken + brighten);
                data[idx + 2] = clamp255(nb - darken + brighten);
            }
        }
    };

    drawEyeRegionEffect(true);
    drawEyeRegionEffect(false);

    ctx.putImageData(img, 0, 0);
}
function applyEyeOpenHighlight(ctx, landmarks, fxData) {
    const amount = (fxData.eyeOpenAuto || 0) / 100;
    if (amount <= 0) return;

    const leftRatio = eyeOpenRatio(landmarks, true);
    const rightRatio = eyeOpenRatio(landmarks, false);

    const applyOne = (center, ratio) => {
        const boost = clamp((0.18 - ratio) / 0.08, 0, 1) * amount;
        if (boost <= 0.001) return;

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const g = ctx.createRadialGradient(center.x, center.y - 8, 1, center.x, center.y - 8, 36);
        g.addColorStop(0, `rgba(255,255,255,${0.08 + boost * 0.25})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(center.x, center.y - 8, 36, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };

    applyOne(avgPoint(landmarks, LEFT_IRIS), leftRatio);
    applyOne(avgPoint(landmarks, RIGHT_IRIS), rightRatio);
}


function applyLipEnhancement(ctx, canvas, landmarks, fxData) {
    const lipSaturation = (fxData.lipSaturation || 0) / 100;
    const lipBrightness = (fxData.lipBrightness || 0) / 100;
    const lipCenterGlow = (fxData.lipCenterGlow || 0) / 100;

    if (lipSaturation <= 0 && lipBrightness <= 0 && lipCenterGlow <= 0) return;

    const left = getLm(landmarks, LIP_LEFT);
    const right = getLm(landmarks, LIP_RIGHT);
    const upper = getLm(landmarks, UPPER_LIP_CENTER);
    const lower = getLm(landmarks, LOWER_LIP_CENTER);
    if (!left || !right || !upper || !lower) return;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;

    const cx = (left.x + right.x) * 0.5;
    const cy = (upper.y + lower.y) * 0.5;

    // 바깥으로 퍼지지 않도록, outer lip를 중심쪽으로 수축해서 마스크 생성
    const contractedOuterMask = buildContractedLipMask(
        ctx,
        canvas,
        landmarks,
        OUTER_LIPS,
        cx,
        cy,
        0.14,   // 수축 비율. 0.10~0.18 정도에서 조절
        2       // feather
    ).data;

    // 안쪽 입술은 glow/강조 가중치용
    const innerMask = buildPolygonMask(ctx, canvas, landmarks, INNER_LIPS, 1).data;

    const sx = Math.max(20, Math.abs(right.x - left.x) * 0.22);
    const sy = Math.max(12, Math.abs(lower.y - upper.y) * 1.10);

    for (let i = 0; i < px.length; i += 4) {
        const outerA = contractedOuterMask[i] / 255;
        if (outerA <= 0.001) continue;

        const idx = i / 4;
        const x = idx % canvas.width;
        const y = Math.floor(idx / canvas.width);

        const innerA = innerMask[i] / 255;
        const centerGlow = gaussian2D2(x - cx, y - cy, sx, sy) * lipCenterGlow;

        let r = px[i];
        let g = px[i + 1];
        let b = px[i + 2];

        const avg = (r + g + b) / 3;

        const satBoost = 1 + lipSaturation * (0.38 + innerA * 0.12);
        const brightnessBoost = lipBrightness * (10 + (avg < 110 ? 8 : 0));
        const centerBoost = centerGlow * 14 * innerA; // glow도 안쪽 중심에만 더 강하게

        r = avg + (r - avg) * satBoost + brightnessBoost + centerBoost;
        g = avg + (g - avg) * (1 + lipSaturation * 0.12) + brightnessBoost * 0.22 + centerBoost * 0.25;
        b = avg + (b - avg) * (1 + lipSaturation * 0.08) + brightnessBoost * 0.16 + centerBoost * 0.20;

        px[i] = clamp(lerp(px[i], r, outerA), 0, 255);
        px[i + 1] = clamp(lerp(px[i + 1], g, outerA), 0, 255);
        px[i + 2] = clamp(lerp(px[i + 2], b, outerA), 0, 255);
    }

    ctx.putImageData(img, 0, 0);
}

function buildContractedLipMask(ctx, canvas, landmarks, indices, cx, cy, shrinkRatio = 0.14, feather = 2) {
    const maskCanvas = new Canvas(canvas.width, canvas.height);
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const mctx = maskCanvas.getContext("2d");

    const pts = indices
        .map(i => getLm(landmarks, i))
        .filter(Boolean)
        .map(p => ({
            x: cx + (p.x - cx) * (1 - shrinkRatio),
            y: cy + (p.y - cy) * (1 - shrinkRatio)
        }));

    if (pts.length < 3) {
        return mctx.createImageData(canvas.width, canvas.height);
    }

    mctx.clearRect(0, 0, canvas.width, canvas.height);
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        mctx.lineTo(pts[i].x, pts[i].y);
    }
    mctx.closePath();

    mctx.fillStyle = "#fff";
    mctx.shadowColor = "#fff";
    mctx.shadowBlur = feather;
    mctx.fill();

    return mctx.getImageData(0, 0, canvas.width, canvas.height);
}

function buildPolygonMask(ctx, canvas, landmarks, indices, blurRadius) {
    const maskCanvas = new Canvas(canvas.width, canvas.height);
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;

    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) {
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    beginPolygonPath(maskCtx, landmarks, indices);
    maskCtx.fillStyle = "#ffffff";
    maskCtx.fill();

    if (blurRadius > 0) {
        const blurredCanvas = new Canvas(canvas.width, canvas.height);
        blurredCanvas.width = canvas.width;
        blurredCanvas.height = canvas.height;

        const blurredCtx = blurredCanvas.getContext("2d");
        if (blurredCtx) {
            blurredCtx.filter = `blur(${blurRadius}px)`;
            blurredCtx.drawImage(maskCanvas, 0, 0);

            maskCtx.clearRect(0, 0, canvas.width, canvas.height);
            maskCtx.drawImage(blurredCanvas, 0, 0);
        }
    }

    return maskCtx.getImageData(0, 0, canvas.width, canvas.height);
}

function gaussian2D2(x, y, sx, sy) {
    const dx = (x * x) / (2 * sx * sx);
    const dy = (y * y) / (2 * sy * sy);
    return Math.exp(-(dx + dy));
}

function resolveBeforeUrl(options = {}) {
    const { afterData, forwardData, bootstrap } = getRuntimeContext();
    return (
        options.beforeImageUrl ||
        options.imageUrl ||
        afterData.beforeImageUrl ||
        afterData.captureImageUrl ||
        afterData.imageUrl ||
        afterData.originalImageUrl ||
        forwardData.beforeImageUrl ||
        forwardData.captureImageUrl ||
        forwardData.imageUrl ||
        forwardData.originalImageUrl ||
        bootstrap.beforeImageUrl ||
        bootstrap.captureImageUrl ||
        bootstrap.imageUrl ||
        bootstrap.originalImageUrl ||
        ""
    );
}

function resolveLandmarks(options = {}) {
    const { afterData, forwardData } = getRuntimeContext();
    return (
        options.landmarks ||
        options.faceLandmarks ||
        afterData.landmarks ||
        afterData.faceLandmarks ||
        forwardData.landmarks ||
        forwardData.faceLandmarks ||
        null
    );
}

function applyEyeUpperLiftWarp(ctx, canvas, landmarks, fxData) {
    const strength = (fxData.eyeUpperLift || 0) / 100;
    if (strength <= 0) return;

    const srcImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = srcImg.data;
    const dstImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dst = dstImg.data;

    const warpPoint = (targetIdx, outerIdx, innerIdx, forceScale = 1.0) => {
        const target = getLm(landmarks, targetIdx);
        const outer = getLm(landmarks, outerIdx);
        const inner = getLm(landmarks, innerIdx);
        if (!target || !outer || !inner) return;

        const eyeWidth = Math.max(12, Math.abs(inner.x - outer.x));

        const minX = Math.max(0, Math.floor(target.x - eyeWidth * 0.75));
        const maxX = Math.min(canvas.width - 1, Math.ceil(target.x + eyeWidth * 0.75));
        const minY = Math.max(0, Math.floor(target.y - eyeWidth * 0.45));
        const maxY = Math.min(canvas.height - 1, Math.ceil(target.y + eyeWidth * 0.22));

        const sigmaX = Math.max(3, eyeWidth * 0.34);
        const sigmaY = Math.max(2, eyeWidth * 0.09);

        const liftAmount = eyeWidth * (0.02 + strength * 0.3) * forceScale;

        // 중심은 강하고, 바깥은 더 빨리 약해지게
        const falloffPower = 2;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                //if (y > target.y) continue;

                const g0 = gaussian2D(
                    x - target.x,
                    y - target.y,
                    sigmaX,
                    sigmaY
                );

                const g = Math.pow(g0, falloffPower);
                if (g < 0.0008) continue;

                // 중심 근처일수록 더 위로
                const dy = -(liftAmount * g);

                const rgba = bilinearSampleImageData(
                    src,
                    canvas.width,
                    canvas.height,
                    x,
                    y - dy
                );

                const di = (y * canvas.width + x) * 4;
                dst[di] = rgba[0];
                dst[di + 1] = rgba[1];
                dst[di + 2] = rgba[2];
                dst[di + 3] = rgba[3];
            }
        }
    };

    // 왼쪽 눈
    warpPoint(159, 33, 133, 1.0);
    warpPoint(160, 33, 133, 0.75);
    warpPoint(158, 33, 133, 0.55);
    //warpPoint(246, 33, 133, 1.0);

    // 오른쪽 눈
    warpPoint(386, 362, 263, 1.0);
    warpPoint(387, 362, 263, 0.75);
    warpPoint(385, 362, 263, 0.55);
    //warpPoint(466, 362, 263, 1.0);

    ctx.putImageData(dstImg, 0, 0);
}

function applyIrisBlack(ctx, canvas, landmarks, fxData) {
    const strength = (fxData.irisBlack || 0) / 100;
    if (strength <= 0) return;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    const clamp255 = (v) => Math.max(0, Math.min(255, v));

    const irisLeftIdx = (typeof LEFT_IRIS !== "undefined") ? LEFT_IRIS : [468, 469, 470, 471, 472];
    const irisRightIdx = (typeof RIGHT_IRIS !== "undefined") ? RIGHT_IRIS : [473, 474, 475, 476, 477];

    const getAvgPoint = (idxList) => {
        const pts = idxList.map(i => getLm(landmarks, i)).filter(Boolean);
        if (!pts.length) return null;

        let sx = 0, sy = 0;
        for (let i = 0; i < pts.length; i++) {
            sx += pts[i].x;
            sy += pts[i].y;
        }

        return {
            x: sx / pts.length,
            y: sy / pts.length
        };
    };

    const gaussian2DLocal = (dx, dy, sx, sy) => {
        return Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)));
    };

    const processEye = (irisIdx, isLeft) => {
        const iris = getAvgPoint(irisIdx);
        const outer = getLm(landmarks, isLeft ? 33 : 362);
        const inner = getLm(landmarks, isLeft ? 133 : 263);
        const top = getLm(landmarks, isLeft ? 159 : 386);
        const bottom = getLm(landmarks, isLeft ? 145 : 374);

        if (!iris || !outer || !inner || !top || !bottom) return;

        const eyeWidth = Math.max(10, Math.abs(inner.x - outer.x));
        const eyeHeight = Math.max(6, Math.abs(bottom.y - top.y));

        const irisSigmaX = Math.max(4, eyeWidth * 0.12);
        const irisSigmaY = Math.max(4, eyeHeight * 0.45);

        const minX = Math.max(0, Math.floor(iris.x - irisSigmaX * 2.4));
        const maxX = Math.min(canvas.width - 1, Math.ceil(iris.x + irisSigmaX * 2.4));
        const minY = Math.max(0, Math.floor(iris.y - irisSigmaY * 2.4));
        const maxY = Math.min(canvas.height - 1, Math.ceil(iris.y + irisSigmaY * 2.4));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const gIris = gaussian2DLocal(x - iris.x, y - iris.y, irisSigmaX, irisSigmaY);
                if (gIris < 0.01) continue;

                const idx = (y * canvas.width + x) * 4;

                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                const gray = (r + g + b) / 3;

                const desat = gIris * strength * 0.28;
                const darken = gIris * strength * 42;

                const nr = r * (1 - desat) + gray * desat;
                const ng = g * (1 - desat) + gray * desat;
                const nb = b * (1 - desat) + gray * desat;

                data[idx] = clamp255(nr - darken * 1.03);
                data[idx + 1] = clamp255(ng - darken * 1.00);
                data[idx + 2] = clamp255(nb - darken * 0.97);
            }
        }

        const catchX = iris.x - irisSigmaX * 0.33;
        const catchY = iris.y - irisSigmaY * 0.34;
        const catchSigmaX = Math.max(1.2, irisSigmaX * 0.20);
        const catchSigmaY = Math.max(1.2, irisSigmaY * 0.20);

        const cMinX = Math.max(0, Math.floor(catchX - catchSigmaX * 2.2));
        const cMaxX = Math.min(canvas.width - 1, Math.ceil(catchX + catchSigmaX * 2.2));
        const cMinY = Math.max(0, Math.floor(catchY - catchSigmaY * 2.2));
        const cMaxY = Math.min(canvas.height - 1, Math.ceil(catchY + catchSigmaY * 2.2));

        for (let y = cMinY; y <= cMaxY; y++) {
            for (let x = cMinX; x <= cMaxX; x++) {
                const glow = gaussian2DLocal(x - catchX, y - catchY, catchSigmaX, catchSigmaY);
                if (glow < 0.03) continue;

                const idx = (y * canvas.width + x) * 4;
                const add = glow * strength * 52;

                data[idx] = clamp255(data[idx] + add);
                data[idx + 1] = clamp255(data[idx + 1] + add);
                data[idx + 2] = clamp255(data[idx + 2] + add);
            }
        }
    };

    processEye(irisLeftIdx, true);
    processEye(irisRightIdx, false);

    ctx.putImageData(img, 0, 0);
}

function applyMouthCornerLiftWarp(ctx, canvas, landmarks, fxData) {
    const strength = (fxData.mouthSmileLift || 0) / 100;
    if (strength <= 0) return;

    const leftCorner = getLm(landmarks, LIP_LEFT);    // 61
    const rightCorner = getLm(landmarks, LIP_RIGHT);  // 291

    if (!leftCorner || !rightCorner) return;

    // 요청한 라인들
    const upperLineAIdx = [191, 80, 81, 82, 13, 312, 311];
    const upperLineBIdx = [95, 88, 178, 87, 14, 317, 402];
    const peakLiftIdx = [40, 270];

    const upperLineA = upperLineAIdx.map(i => getLm(landmarks, i)).filter(Boolean);
    const upperLineB = upperLineBIdx.map(i => getLm(landmarks, i)).filter(Boolean);
    const peakLiftPts = peakLiftIdx.map(i => getLm(landmarks, i)).filter(Boolean);

    const allPts = [
        leftCorner,
        rightCorner,
        ...upperLineA,
        ...upperLineB,
        ...peakLiftPts
    ];

    if (allPts.length < 2) return;

    const mouthWidth = Math.max(20, Math.abs(rightCorner.x - leftCorner.x));

    // 입꼬리/볼 퍼짐 범위
    const sigmaX = Math.max(12, mouthWidth * 0.1);
    const sigmaY = Math.max(10, mouthWidth * 0.22);

    // 입술 라인용 범위
    const lineSigmaX = Math.max(8, mouthWidth * 0.09);
    const lineSigmaY = Math.max(6, mouthWidth * 0.08);

    // 봉우리(40,270) 조금 더 집중
    const peakSigmaX = Math.max(8, mouthWidth * 0.08);
    const peakSigmaY = Math.max(6, mouthWidth * 0.07);

    const movePx = mouthWidth * 0.21 * strength;

    // 1) 입꼬리 위 + 바깥
    const upRatio = 0.78;
    const sideRatio = 0.75;

    // 2) 볼/팔자 약하게 바깥 + 살짝 위
    const cheekSideRatio = 0.14;
    const cheekUpRatio = 0.05;

    // 3) 입술 라인 살짝 위
    const upperLineAUpRatio = 0.10;
    const upperLineBUpRatio = 0.12;

    // 4) 40, 270은 조금 더 위
    const peakUpRatio = 0.14;

    const srcImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = srcImg.data;
    const dstImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dst = dstImg.data;

    const padX = Math.max(40, Math.round(sigmaX * 3.8));
    const padY = Math.max(40, Math.round(sigmaY * 3.8));

    const xs = allPts.map(p => p.x);
    const ys = allPts.map(p => p.y);

    const minX = Math.max(0, Math.floor(Math.min(...xs) - padX));
    const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(...xs) + padX));
    const minY = Math.max(0, Math.floor(Math.min(...ys) - padY - 20));
    const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(...ys) + padY + 20));

    // 입꼬리 앵커
    const leftAnchorX = leftCorner.x - 24;
    const leftAnchorY = leftCorner.y - 16;

    const rightAnchorX = rightCorner.x + 24;
    const rightAnchorY = rightCorner.y - 16;

    // 볼/팔자 쪽 앵커
    const leftCheekX = leftCorner.x - mouthWidth * 0.42;
    const leftCheekY = leftCorner.y - mouthWidth * 0.10;

    const rightCheekX = rightCorner.x + mouthWidth * 0.42;
    const rightCheekY = rightCorner.y - mouthWidth * 0.10;

    // 입꼬리 2차 lift
    const strength2 = strength * 0.2;
    const movePx2 = mouthWidth * 0.21 * strength2;
    const sigmaX2 = sigmaX * 0.28;
    const sigmaY2 = sigmaY * 0.82;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            // 입꼬리 influence
            const gL = gaussian2D(x - leftAnchorX, y - leftAnchorY, sigmaX, sigmaY);
            const gR = gaussian2D(x - rightAnchorX, y - rightAnchorY, sigmaX, sigmaY);

            // 입꼬리 2차 influence
            const gL2 = gaussian2D(x - leftAnchorX, y - leftAnchorY, sigmaX2, sigmaY2);
            const gR2 = gaussian2D(x - rightAnchorX, y - rightAnchorY, sigmaX2, sigmaY2);

            // 볼/팔자 influence
            const gLCheek = gaussian2D(
                x - leftCheekX,
                y - leftCheekY,
                sigmaX * 1.25,
                sigmaY * 1.15
            );

            const gRCheek = gaussian2D(
                x - rightCheekX,
                y - rightCheekY,
                sigmaX * 1.25,
                sigmaY * 1.15
            );

            // 입술 라인 influence 합산
            let gUpperA = 0;
            for (const p of upperLineA) {
                gUpperA += gaussian2D(
                    x - p.x,
                    y - p.y,
                    lineSigmaX,
                    lineSigmaY
                );
            }

            let gUpperB = 0;
            for (const p of upperLineB) {
                gUpperB += gaussian2D(
                    x - p.x,
                    y - p.y,
                    lineSigmaX,
                    lineSigmaY
                );
            }

            let gPeak = 0;
            for (const p of peakLiftPts) {
                gPeak += gaussian2D(
                    x - p.x,
                    y - p.y,
                    peakSigmaX,
                    peakSigmaY
                );
            }

            // 여러 포인트 합산이므로 적당히 clamp
            gUpperA = Math.min(1, gUpperA);
            gUpperB = Math.min(1, gUpperB);
            gPeak = Math.min(1, gPeak);

            const influence = Math.max(
                gL, gR, gL2, gR2, gLCheek, gRCheek, gUpperA, gUpperB, gPeak
            );
            if (influence < 0.001) continue;

            // 1) 입꼬리: 바깥 + 위
            const dxL = -gL * movePx * sideRatio;
            const dyL = -gL * movePx * upRatio;

            const dxR = gR * movePx * sideRatio;
            const dyR = -gR * movePx * upRatio;

            // 1-2) 입꼬리 2차 lift
            const dxL2 = -gL2 * movePx2 * sideRatio;
            const dyL2 = -gL2 * movePx2 * upRatio;

            const dxR2 = gR2 * movePx2 * sideRatio;
            const dyR2 = -gR2 * movePx2 * upRatio;

            // 2) 볼/팔자
            const dxLCheek = -gLCheek * movePx * cheekSideRatio;
            const dyLCheek = -gLCheek * movePx * cheekUpRatio;

            const dxRCheek = gRCheek * movePx * cheekSideRatio;
            const dyRCheek = -gRCheek * movePx * cheekUpRatio;

            // 3) 윗라인/아랫라인 모두 살짝 위
            const dxUpperA = 0;
            const dyUpperA = -gUpperA * movePx * upperLineAUpRatio;

            const dxUpperB = 0;
            const dyUpperB = -gUpperB * movePx * upperLineBUpRatio;

            // 4) 40, 270은 조금 더 위
            const dxPeak = 0;
            const dyPeak = -gPeak * movePx * peakUpRatio;

            const dx =
                dxL + dxR +
                dxL2 + dxR2 +
                dxLCheek + dxRCheek +
                dxUpperA + dxUpperB + dxPeak;

            const dy =
                dyL + dyR +
                dyL2 + dyR2 +
                dyLCheek + dyRCheek +
                dyUpperA + dyUpperB + dyPeak;

            const rgba = bilinearSampleImageData(
                src,
                canvas.width,
                canvas.height,
                x - dx,
                y - dy
            );

            const di = (y * canvas.width + x) * 4;
            dst[di] = rgba[0];
            dst[di + 1] = rgba[1];
            dst[di + 2] = rgba[2];
            dst[di + 3] = 255;
        }
    }

    ctx.putImageData(dstImg, 0, 0);

    // 디버그 점
    ctx.save();
    ctx.fillStyle = "red";

    ctx.beginPath();
    ctx.arc(leftAnchorX, leftAnchorY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(rightAnchorX, rightAnchorY, 3, 0, Math.PI * 2);
    ctx.fill();

    for (const p of peakLiftPts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const p of upperLineA) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const p of upperLineB) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function applyFaceOvalSmooth(ctx, canvas, landmarks, fxData) {
    let strength = (fxData.faceOvalSmooth || 0) / 100;
    const strength2 = strength;
    const strength3 = strength * 2;
    if (strength <= 0) return;

    const W = canvas.width;
    const H = canvas.height;

    const srcImg = ctx.getImageData(0, 0, W, H);
    const src = srcImg.data;
    const dstImg = ctx.getImageData(0, 0, W, H);
    const dst = dstImg.data;
    dst.set(src);

    const RIGHT_CHAIN = [356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152];
    const LEFT_CHAIN = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];

    const lerp = (a, b, t) => a + (b - a) * t;

    // 누적 변위
    const flowX = new Float32Array(W * H);
    const flowY = new Float32Array(W * H);

    // 숫자 표시용
    const debugLabels = [];

    const drawPoint = (x, y, color, size = 2) => {
        const cx = Math.round(x);
        const cy = Math.round(y);

        for (let oy = -size; oy <= size; oy++) {
            for (let ox = -size; ox <= size; ox++) {
                const px = cx + ox;
                const py = cy + oy;
                if (px < 0 || py < 0 || px >= W || py >= H) continue;

                const idx = (py * W + px) * 4;
                dst[idx] = color[0];
                dst[idx + 1] = color[1];
                dst[idx + 2] = color[2];
                dst[idx + 3] = 255;
            }
        }
    };

    const processChain = (indices, isLeft) => {
        const pts = indices.map(idx => ({ idx, p: getLm(landmarks, idx) })).filter(v => v.p);
        if (pts.length < 4) return;

        const leftFace = getLm(landmarks, 234);
        const rightFace = getLm(landmarks, 454);
        const faceWidth = Math.abs((rightFace?.x || 0) - (leftFace?.x || 0)) || 200;

        for (let start = 0; start + 3 < pts.length; start += 2) {
            const localStrength = strength2;

            const p0 = pts[start].p;
            const m1 = pts[start + 1].p;
            const m2 = pts[start + 2].p;
            const p3 = pts[start + 3].p;

            // p0 -> p3 선벡터
            const vx = p3.x - p0.x;
            const vy = p3.y - p0.y;
            const vLen2 = vx * vx + vy * vy;
            if (vLen2 < 1e-5) continue;

            // 직교 단위벡터
            let nx = -vy;
            let ny = vx;
            const nLen = Math.hypot(nx, ny);
            if (nLen < 1e-5) continue;
            nx /= nLen;
            ny /= nLen;

            // 체인 바깥 방향 정렬
            if (isLeft) {
                if (nx > 0) {
                    nx = -nx;
                    ny = -ny;
                }
            } else {
                if (nx < 0) {
                    nx = -nx;
                    ny = -ny;
                }
            }

            // sigma는 기존 방식 유지
            const ax = Math.abs(nx);
            const ay = Math.abs(ny);

            const sigmaMin = Math.max(8, faceWidth * 0.018);
            const sigmaMax = Math.max(18, faceWidth * 0.11);

            const sigmaX = lerp(sigmaMin, sigmaMax, ay);
            const sigmaY = lerp(sigmaMin, sigmaMax, ax);

            const movePts = [m1, m2];

            for (const cur of movePts) {
                // cur의 직교투영점
                const wx = cur.x - p0.x;
                const wy = cur.y - p0.y;

                const t = (wx * vx + wy * vy) / vLen2;
                const footX = p0.x + vx * t;
                const footY = p0.y + vy * t;

                // 직교 signed distance
                const offX = cur.x - footX;
                const offY = cur.y - footY;
                const signedDist = offX * nx + offY * ny;
                const rawPerpDist = Math.abs(signedDist);

                if (rawPerpDist < 0.5) continue;

                // 바깥쪽만 보정
                if (signedDist <= 0) continue;

                // 숫자는 직교거리 그대로 표시
                debugLabels.push({
                    x: cur.x,
                    y: cur.y,
                    text: rawPerpDist.toFixed(1)
                });

                // 변화량 = 직교거리 * strength
                const moveBase = rawPerpDist * localStrength;

                const minX = Math.max(0, Math.floor(cur.x - sigmaX * 2.6));
                const maxX = Math.min(W - 1, Math.ceil(cur.x + sigmaX * 2.6));
                const minY = Math.max(0, Math.floor(cur.y - sigmaY * 2.6));
                const maxY = Math.min(H - 1, Math.ceil(cur.y + sigmaY * 2.6));

                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        // 중심에서 멀어질수록 gaussian으로만 약해짐
                        const g = gaussian2D(x - cur.x, y - cur.y, sigmaX, sigmaY);
                        if (g < 0.002) continue;

                        const move = moveBase * g;
                        const i = y * W + x;

                        // 안쪽으로 밀기 위한 source 오프셋 누적
                        flowX[i] += nx * move;
                        flowY[i] += ny * move;
                    }
                }

                // 내부 디버그 파란점
                drawPoint(cur.x, cur.y, [0, 0, 255], 2);
            }
        }
    };

    processChain(LEFT_CHAIN, true);
    processChain(RIGHT_CHAIN, false);

    // 누적 변위로 한 번만 샘플링
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const dx = flowX[i];
            const dy = flowY[i];

            if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) continue;

            const sampleX = x + dx;
            const sampleY = y + dy;

            const rgba = bilinearSampleImageData(src, W, H, sampleX, sampleY);
            const di = i * 4;
            dst[di] = rgba[0];
            dst[di + 1] = rgba[1];
            dst[di + 2] = rgba[2];
            dst[di + 3] = 255;
        }
    }

    ctx.putImageData(dstImg, 0, 0);

    // ===== 오버레이 =====
    ctx.save();

    // 빨간 랜드마크 점 5px
    ctx.fillStyle = "red";
    const drawLm = (idx) => {
        const p = getLm(landmarks, idx);
        if (!p) return;

        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        //ctx.fill();
    };

    LEFT_CHAIN.forEach(drawLm);
    RIGHT_CHAIN.forEach(drawLm);

    // 빨간 숫자
    ctx.fillStyle = "red";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 3;
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (const item of debugLabels) {
        const tx = item.x + 10;
        const ty = item.y - 15;
        //ctx.strokeText(item.text, tx, ty);
        //ctx.fillText(item.text, tx, ty);
    }

    ctx.restore();
}
//////////////////////////////////////////////////////////////////////////////////////////////


function ApplyBlemish(ctx, canvas, landmarks, fxData) {
    const strength = (fxData.blemishRemove || fxData.faceBlemishRemove || 0) / 100;
    if (strength <= 0) return;

    const W = canvas.width;
    const H = canvas.height;

    const srcImg = ctx.getImageData(0, 0, W, H);
    const src = srcImg.data;
    const dstImg = ctx.getImageData(0, 0, W, H);
    const dst = dstImg.data;
    dst.set(src);

    const STEP = 3;
    const PATCH_R = 1; // 3x3
    const BLUR_NOT_BLEMISH = 0.22; // 중간 블러
    const BLUR_BLEMISH = 0.11;     // 복제 후 약한 블러
    const COPY_BLEND = 0.72 + strength * 0.18;

    const facePts = FACE_OVAL.map(i => getLm(landmarks, i));
    const leftEyePts = LEFT_EYE.map(i => getLm(landmarks, i));
    const rightEyePts = RIGHT_EYE.map(i => getLm(landmarks, i));
    const leftBrowPts = LEFT_EYEBROW.map(i => getLm(landmarks, i));
    const rightBrowPts = RIGHT_EYEBROW.map(i => getLm(landmarks, i));
    const lipPts = OUTER_LIPS.map(i => getLm(landmarks, i));

    const noseLeft = getLm(landmarks, NOSE_LEFT_WING);
    const noseRight = getLm(landmarks, NOSE_RIGHT_WING);
    const noseUp = getLm(landmarks, NOSE_BRIDGE_UP);
    const noseBase = getLm(landmarks, NOSE_BASE);

    const faceMinX = Math.max(0, Math.floor(Math.min(...facePts.map(p => p.x))));
    const faceMaxX = Math.min(W - 1, Math.ceil(Math.max(...facePts.map(p => p.x))));
    const faceMinY = Math.max(0, Math.floor(Math.min(...facePts.map(p => p.y))));
    const faceMaxY = Math.min(H - 1, Math.ceil(Math.max(...facePts.map(p => p.y))));

    function pointInPolygon(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            const hit =
                ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-6) + xi);
            if (hit) inside = !inside;
        }
        return inside;
    }

    function bboxFromPts(pts, pad = 0) {
        return {
            minX: Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) - pad)),
            maxX: Math.min(W - 1, Math.ceil(Math.max(...pts.map(p => p.x)) + pad)),
            minY: Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) - pad)),
            maxY: Math.min(H - 1, Math.ceil(Math.max(...pts.map(p => p.y)) + pad))
        };
    }

    function inRect(x, y, r) {
        return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
    }

    const leftEyeBox = bboxFromPts(leftEyePts, 8);
    const rightEyeBox = bboxFromPts(rightEyePts, 8);
    const leftBrowBox = bboxFromPts(leftBrowPts, 8);
    const rightBrowBox = bboxFromPts(rightBrowPts, 8);
    const lipBox = bboxFromPts(lipPts, 10);

    const nosePadX = 12;
    const nosePadY = 10;
    const noseBox = {
        minX: Math.max(0, Math.floor(Math.min(noseLeft.x, noseRight.x) - nosePadX)),
        maxX: Math.min(W - 1, Math.ceil(Math.max(noseLeft.x, noseRight.x) + nosePadX)),
        minY: Math.max(0, Math.floor(noseUp.y - nosePadY)),
        maxY: Math.min(H - 1, Math.ceil(noseBase.y + nosePadY))
    };

    function isFaceSkinArea(x, y) {
        if (x < faceMinX || x > faceMaxX || y < faceMinY || y > faceMaxY) return false;
        if (!pointInPolygon(x, y, facePts)) return false;

        if (inRect(x, y, leftEyeBox)) return false;
        if (inRect(x, y, rightEyeBox)) return false;
        if (inRect(x, y, leftBrowBox)) return false;
        if (inRect(x, y, rightBrowBox)) return false;
        if (inRect(x, y, lipBox)) return false;
        if (inRect(x, y, noseBox)) return false;

        return true;
    }

    function getIdx(x, y) {
        return (y * W + x) * 4;
    }

    function getRGB(data, x, y) {
        const cx = clamp(x, 0, W - 1);
        const cy = clamp(y, 0, H - 1);
        const i = getIdx(cx, cy);
        return [data[i], data[i + 1], data[i + 2]];
    }

    function mean3x3Lum(data, cx, cy) {
        let sum = 0;
        let cnt = 0;

        for (let y = cy - 1; y <= cy + 1; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                if (!isFaceSkinArea(x, y)) continue;
                const i = getIdx(x, y);
                sum += luminance(data[i], data[i + 1], data[i + 2]);
                cnt++;
            }
        }

        return cnt > 0 ? sum / cnt : null;
    }

    function var3x3Lum(data, cx, cy) {
        const mean = mean3x3Lum(data, cx, cy);
        if (mean == null) return null;

        let sum = 0;
        let cnt = 0;

        for (let y = cy - 1; y <= cy + 1; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                if (!isFaceSkinArea(x, y)) continue;
                const i = getIdx(x, y);
                const l = luminance(data[i], data[i + 1], data[i + 2]);
                const d = l - mean;
                sum += d * d;
                cnt++;
            }
        }

        return cnt > 0 ? sum / cnt : null;
    }

    function isBlemish(cx, cy) {
        if (!isFaceSkinArea(cx, cy)) return false;

        const centerMean = mean3x3Lum(src, cx, cy);
        if (centerMean == null) return false;

        const upMean = mean3x3Lum(src, cx, cy - STEP);
        const downMean = mean3x3Lum(src, cx, cy + STEP);

        let ref = null;
        if (upMean != null && downMean != null) ref = (upMean + downMean) * 0.5;
        else if (upMean != null) ref = upMean;
        else if (downMean != null) ref = downMean;
        else return false;

        // 주변 위/아래보다 확실히 어두우면 잡티
        return (ref - centerMean) > (2.5 - strength * 1.0);
    }

    function copy3x3From(srcData, dstData, tx, ty, sx, sy, blend) {
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const px = tx + ox;
                const py = ty + oy;
                const qx = sx + ox;
                const qy = sy + oy;

                if (px < 0 || py < 0 || px >= W || py >= H) continue;
                if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
                if (!isFaceSkinArea(px, py)) continue;
                if (!isFaceSkinArea(qx, qy)) continue;

                const si = getIdx(qx, qy);
                const di = getIdx(px, py);

                dstData[di] = lerp(dstData[di], srcData[si], blend);
                dstData[di + 1] = lerp(dstData[di + 1], srcData[si + 1], blend);
                dstData[di + 2] = lerp(dstData[di + 2], srcData[si + 2], blend);
                dstData[di + 3] = 255;
            }
        }
    }

    function blur3x3At(data, cx, cy, amount) {
        const temp = [];

        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const px = cx + ox;
                const py = cy + oy;

                if (px < 0 || py < 0 || px >= W || py >= H) {
                    temp.push(null);
                    continue;
                }

                let rs = 0, gs = 0, bs = 0, cnt = 0;

                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const qx = px + kx;
                        const qy = py + ky;
                        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
                        if (!isFaceSkinArea(qx, qy)) continue;

                        const i = getIdx(qx, qy);
                        rs += data[i];
                        gs += data[i + 1];
                        bs += data[i + 2];
                        cnt++;
                    }
                }

                if (cnt === 0) temp.push(null);
                else temp.push([rs / cnt, gs / cnt, bs / cnt]);
            }
        }

        let ti = 0;
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++, ti++) {
                const px = cx + ox;
                const py = cy + oy;
                if (px < 0 || py < 0 || px >= W || py >= H) continue;
                if (!isFaceSkinArea(px, py)) continue;
                if (!temp[ti]) continue;

                const di = getIdx(px, py);
                data[di] = lerp(data[di], temp[ti][0], amount);
                data[di + 1] = lerp(data[di + 1], temp[ti][1], amount);
                data[di + 2] = lerp(data[di + 2], temp[ti][2], amount);
                data[di + 3] = 255;
            }
        }
    }

    function chooseDonor(cx, cy) {
        const candidates = [
            { x: cx, y: cy - STEP }, // 위
            { x: cx, y: cy + STEP }  // 아래
        ];

        const centerVar = var3x3Lum(src, cx, cy);
        let best = null;

        for (const c of candidates) {
            if (c.x - 1 < 0 || c.y - 1 < 0 || c.x + 1 >= W || c.y + 1 >= H) continue;
            if (!isFaceSkinArea(c.x, c.y)) continue;

            const donorMean = mean3x3Lum(src, c.x, c.y);
            const donorVar = var3x3Lum(src, c.x, c.y);
            if (donorMean == null || donorVar == null) continue;

            const centerMean = mean3x3Lum(src, cx, cy);
            if (centerMean == null) continue;

            // 더 깨끗하고, 밝기 차이 적은 후보 선택
            const score =
                Math.abs(donorMean - centerMean) * 0.7 +
                donorVar * 1.0 +
                Math.max(0, donorVar - (centerVar || 0)) * 0.5;

            if (!best || score < best.score) {
                best = { x: c.x, y: c.y, score };
            }
        }

        return best;
    }

    for (let y = faceMinY + 1; y <= faceMaxY - 1; y += STEP) {
        for (let x = faceMinX + 1; x <= faceMaxX - 1; x += STEP) {
            if (!isFaceSkinArea(x, y)) continue;

            if (isBlemish(x, y)) {
                const donor = chooseDonor(x, y);
                if (donor) {
                    copy3x3From(src, dst, x, y, donor.x, donor.y, COPY_BLEND);
                    blur3x3At(dst, x, y, BLUR_BLEMISH);
                } else {
                    blur3x3At(dst, x, y, BLUR_NOT_BLEMISH);
                }
            } else {
                blur3x3At(dst, x, y, BLUR_NOT_BLEMISH);
            }
        }
    }

    ctx.putImageData(dstImg, 0, 0);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////
function applyEyeLowerLiftWarp(ctx, canvas, landmarks, fxData) {
    const strength = (fxData.eyeLowerLift || 0) / 100;
    if (strength <= 0) return;

    const srcImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = srcImg.data;
    const dstImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dst = dstImg.data;

    const avgPts = (pts) => {
        if (!pts || !pts.length) return null;
        let sx = 0, sy = 0;
        for (let i = 0; i < pts.length; i++) {
            sx += pts[i].x;
            sy += pts[i].y;
        }
        return {
            x: sx / pts.length,
            y: sy / pts.length
        };
    };

    const clamp255 = (v) => Math.max(0, Math.min(255, v));
    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    const rgbToHsv = (r, g, b) => {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;

        let h = 0;
        const s = max === 0 ? 0 : d / max;
        const v = max;

        if (d !== 0) {
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
                case g: h = ((b - r) / d + 2); break;
                case b: h = ((r - g) / d + 4); break;
            }
            h /= 6;
        }

        return { h, s, v };
    };

    const hsvToRgb = (h, s, v) => {
        let r = 0, g = 0, b = 0;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);

        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    };

    const blendToward = (r, g, b, tr, tg, tb, amount) => {
        const a = clamp01(amount);
        return {
            r: clamp255(r * (1 - a) + tr * a),
            g: clamp255(g * (1 - a) + tg * a),
            b: clamp255(b * (1 - a) + tb * a)
        };
    };

    const blurMixAt = (srcData, dstData, w, h, x, y, radius, mix) => {
        const ix = Math.round(x);
        const iy = Math.round(y);

        let rs = 0, gs = 0, bs = 0, count = 0;
        for (let yy = iy - radius; yy <= iy + radius; yy++) {
            if (yy < 0 || yy >= h) continue;
            for (let xx = ix - radius; xx <= ix + radius; xx++) {
                if (xx < 0 || xx >= w) continue;
                const si = (yy * w + xx) * 4;
                rs += srcData[si];
                gs += srcData[si + 1];
                bs += srcData[si + 2];
                count++;
            }
        }

        if (count <= 0) return;

        const avgR = rs / count;
        const avgG = gs / count;
        const avgB = bs / count;

        const di = (iy * w + ix) * 4;
        dstData[di] = clamp255(dstData[di] * (1 - mix) + avgR * mix);
        dstData[di + 1] = clamp255(dstData[di + 1] * (1 - mix) + avgG * mix);
        dstData[di + 2] = clamp255(dstData[di + 2] * (1 - mix) + avgB * mix);
    };

    const toneRegions = [];

    const processEye = (lowerIdx, upperIdx, isLeft) => {
        const outer = getLm(landmarks, isLeft ? 33 : 362);
        const inner = getLm(landmarks, isLeft ? 133 : 263);
        if (!outer || !inner) return;

        const upperCenter = avgPoint(landmarks, upperIdx);
        if (!upperCenter) return;

        const lowerPtsAll = lowerIdx.map(i => getLm(landmarks, i)).filter(Boolean);
        if (!lowerPtsAll.length) return;

        const lowerLiftPts = isLeft
            ? [getLm(landmarks, 144), getLm(landmarks, 145), getLm(landmarks, 153), getLm(landmarks, 33)].filter(Boolean)
            : [getLm(landmarks, 373), getLm(landmarks, 374), getLm(landmarks, 380), getLm(landmarks, 362)].filter(Boolean);

        if (!lowerLiftPts.length) return;

        const centerPt = lowerLiftPts[Math.min(1, lowerLiftPts.length - 1)];
        const eyeWidth = Math.max(12, Math.abs(inner.x - outer.x));
        const eyeHeight = Math.max(6, Math.abs(centerPt.y - upperCenter.y));

        const cheekPt = {
            x: outer.x + (isLeft ? eyeWidth * 0.22 : -eyeWidth * 0.22),
            y: centerPt.y + eyeHeight * 1.45
        };

        const outerCornerPt = {
            x: outer.x + (isLeft ? -eyeWidth * 0.03 : eyeWidth * 0.03),
            y: outer.y + eyeHeight * 0.20
        };

        const cheekMainPt = isLeft
            ? getLm(landmarks, 117)
            : getLm(landmarks, 346);

        const zygomaLinePts = isLeft
            ? [117, 118, 119].map(i => getLm(landmarks, i)).filter(Boolean)
            : [346, 347, 348].map(i => getLm(landmarks, i)).filter(Boolean);

        const zygomaLineCenter = avgPts(zygomaLinePts);

        const zygomaTarget = zygomaLineCenter ? {
            x: zygomaLineCenter.x + (isLeft ? 10 : -10),
            y: zygomaLineCenter.y - 20
        } : null;

        const underEyeMid = isLeft
            ? {
                x: ((getLm(landmarks, 145)?.x || centerPt.x) + (getLm(landmarks, 153)?.x || centerPt.x)) * 0.5,
                y: ((getLm(landmarks, 145)?.y || centerPt.y) + (getLm(landmarks, 153)?.y || centerPt.y)) * 0.5
            }
            : {
                x: ((getLm(landmarks, 374)?.x || centerPt.x) + (getLm(landmarks, 380)?.x || centerPt.x)) * 0.5,
                y: ((getLm(landmarks, 374)?.y || centerPt.y) + (getLm(landmarks, 380)?.y || centerPt.y)) * 0.5
            };

        const minX = Math.max(0, Math.floor(Math.min(inner.x, outer.x) - eyeWidth * 1.45));
        const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(inner.x, outer.x) + eyeWidth * 1.45));
        const minY = Math.max(0, Math.floor(upperCenter.y - eyeHeight * 0.75));
        const maxY = Math.min(canvas.height - 1, Math.ceil(centerPt.y + eyeHeight * 4.0));

        const centerLift = eyeHeight * (0.05 + strength * 0.15);
        const midLift = centerLift * 0.82;
        const outerLift = centerLift * 2.52;

        const cheekLift = centerLift * 3.35;
        const cheekMainLift = centerLift * 13.8;
        const underEyeLift = centerLift * 0.5;

        const sigmaX = Math.max(3, eyeWidth * 0.16);
        const sigmaY = Math.max(1, eyeHeight * 0.16);

        const outerSigmaX = Math.max(3, eyeWidth * 1.18);
        const outerSigmaY = Math.max(1, eyeHeight * 1.22);

        const cheekSigmaX = Math.max(10, eyeWidth * 1.58);
        const cheekSigmaY = Math.max(8, eyeHeight * 1.90);

        const cheekMainSigmaX = Math.max(14, eyeWidth * 1.95);
        const cheekMainSigmaY = Math.max(12, eyeHeight * 2.10);

        const zygomaSigmaX = Math.max(18, eyeWidth * 1.25);
        const zygomaSigmaY = Math.max(14, eyeHeight * 1.10);

        const underEyeSigmaX = Math.max(10, eyeWidth * 0.75);
        const underEyeSigmaY = Math.max(6, eyeHeight * 0.48);

        const liftPoints = [
            { pt: lowerLiftPts[0], lift: midLift, sigmaX: sigmaX, sigmaY: sigmaY, type: "lower" },
            { pt: lowerLiftPts[1] || lowerLiftPts[0], lift: centerLift, sigmaX: sigmaX, sigmaY: sigmaY, type: "lower" },
            { pt: lowerLiftPts[2] || lowerLiftPts[lowerLiftPts.length - 1], lift: midLift, sigmaX: sigmaX, sigmaY: sigmaY, type: "lower" },

            { pt: outerCornerPt, lift: outerLift, sigmaX: outerSigmaX, sigmaY: outerSigmaY, type: "outer" },
            { pt: cheekPt, lift: cheekLift, sigmaX: cheekSigmaX, sigmaY: cheekSigmaY, type: "cheek" },

            cheekMainPt ? { pt: cheekMainPt, lift: cheekMainLift, sigmaX: cheekMainSigmaX, sigmaY: cheekMainSigmaY, type: "cheekMain" } : null,

            (zygomaLineCenter && zygomaTarget) ? {
                pt: zygomaLineCenter,
                target: zygomaTarget,
                sigmaX: zygomaSigmaX,
                sigmaY: zygomaSigmaY,
                type: "zygomaDirect"
            } : null,

            underEyeMid ? { pt: underEyeMid, lift: underEyeLift, sigmaX: underEyeSigmaX, sigmaY: underEyeSigmaY, type: "underEyeWide" } : null
        ].filter(Boolean);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                let totalDx = 0;
                let totalDy = 0;

                for (const item of liftPoints) {
                    if (!item.pt) continue;

                    const g = gaussian2D(
                        x - item.pt.x,
                        y - item.pt.y,
                        item.sigmaX,
                        item.sigmaY
                    );
                    if (g < 0.0008) continue;

                    let mask = 1;

                    if (item.type === "lower") {
                        const lowerMask = clamp(
                            (y - upperCenter.y) / Math.max(4, eyeHeight),
                            0,
                            1
                        );

                        const horizontalMask = clamp(
                            1 - Math.abs(x - centerPt.x) / Math.max(6, eyeWidth * 0.95),
                            0,
                            1
                        );

                        mask = lowerMask * (0.55 + horizontalMask * 0.45);
                        totalDy += (-item.lift) * g * mask;
                    } else if (item.type === "outer") {
                        const outerMaskX = clamp(
                            1 - Math.abs(x - outer.x) / Math.max(4, eyeWidth * 0.42),
                            0,
                            1
                        );

                        const outerMaskY = clamp(
                            1 - Math.abs(y - (outer.y + eyeHeight * 0.20)) / Math.max(3, eyeHeight * 0.75),
                            0,
                            1
                        );

                        mask = outerMaskX * outerMaskY;
                        totalDy += (-item.lift) * g * mask;
                    } else if (item.type === "cheek") {
                        const cheekHorizontal = clamp(
                            1 - Math.abs(x - cheekPt.x) / Math.max(10, eyeWidth * 1.15),
                            0,
                            1
                        );

                        const cheekVerticalSoft = clamp(
                            1 - Math.abs(y - cheekPt.y) / Math.max(10, eyeHeight * 1.75),
                            0,
                            1
                        );

                        const belowEyeMask = clamp(
                            (y - (centerPt.y + eyeHeight * 0.05)) / Math.max(4, eyeHeight * 1.4),
                            0,
                            1
                        );

                        mask = cheekHorizontal * (0.35 + cheekVerticalSoft * 0.65) * (0.45 + belowEyeMask * 0.55);
                        totalDy += (-item.lift) * g * mask;
                    } else if (item.type === "cheekMain") {
                        const horiz = clamp(
                            1 - Math.abs(x - item.pt.x) / Math.max(12, eyeWidth * 1.35),
                            0,
                            1
                        );

                        const vert = clamp(
                            1 - Math.abs(y - item.pt.y) / Math.max(10, eyeHeight * 1.55),
                            0,
                            1
                        );

                        const belowMask = clamp(
                            (y - (upperCenter.y + eyeHeight * 0.55)) / Math.max(5, eyeHeight * 1.6),
                            0,
                            1
                        );

                        mask = horiz * (0.35 + vert * 0.65) * (0.45 + belowMask * 0.55);
                        totalDy += (-item.lift) * g * mask;
                    } else if (item.type === "zygomaDirect") {
                        const horiz = clamp(
                            1 - Math.abs(x - item.pt.x) / Math.max(12, eyeWidth * 1.25),
                            0,
                            1
                        );

                        const vert = clamp(
                            1 - Math.abs(y - item.pt.y) / Math.max(10, eyeHeight * 1.15),
                            0,
                            1
                        );

                        const belowMask = clamp(
                            (y - (upperCenter.y + eyeHeight * 0.35)) / Math.max(5, eyeHeight * 1.35),
                            0,
                            1
                        );

                        mask = horiz * (0.40 + vert * 0.60) * (0.40 + belowMask * 0.60);

                        const dxMove = (item.target.x - item.pt.x) * strength;
                        const dyMove = (item.target.y - item.pt.y) * strength;

                        totalDx += dxMove * g * mask;
                        totalDy += dyMove * g * mask;
                    } else if (item.type === "underEyeWide") {
                        const horiz = clamp(
                            1 - Math.abs(x - item.pt.x) / Math.max(8, eyeWidth * 0.95),
                            0,
                            1
                        );

                        const vert = clamp(
                            1 - Math.abs(y - item.pt.y) / Math.max(6, eyeHeight * 0.95),
                            0,
                            1
                        );

                        const belowMask = clamp(
                            (y - (upperCenter.y + eyeHeight * 0.12)) / Math.max(4, eyeHeight * 1.05),
                            0,
                            1
                        );

                        mask = horiz * (0.45 + vert * 0.55) * (0.55 + belowMask * 0.45);
                        totalDy += (-item.lift) * g * mask;
                    }
                }

                if (Math.abs(totalDx) <= 0.0001 && Math.abs(totalDy) <= 0.0001) continue;

                const rgba = bilinearSampleImageData(
                    src,
                    canvas.width,
                    canvas.height,
                    x - totalDx,
                    y - totalDy
                );

                const di = (y * canvas.width + x) * 4;
                dst[di] = rgba[0];
                dst[di + 1] = rgba[1];
                dst[di + 2] = rgba[2];
                dst[di + 3] = 255;
            }
        }

        toneRegions.push({
            isLeft,
            eyeWidth,
            eyeHeight,
            upperCenter,
            centerPt,
            cheekPt,
            cheekMainPt,
            zygomaLineCenter,
            zygomaTarget,
            underEyeMid
        });
    };

    processEye(LEFT_EYE_LOWER, [159, 158], true);
    processEye(RIGHT_EYE_LOWER, [386, 385], false);

    const toneSrc = new Uint8ClampedArray(dst);

    for (const region of toneRegions) {
        const {
            isLeft,
            eyeWidth,
            eyeHeight,
            upperCenter,
            centerPt,
            cheekPt,
            cheekMainPt,
            zygomaLineCenter,
            zygomaTarget,
            underEyeMid
        } = region;

        if (!zygomaLineCenter || !underEyeMid) continue;

        const cheekColorCenter = zygomaTarget || cheekMainPt || cheekPt || zygomaLineCenter;

        const minX = Math.max(0, Math.floor(zygomaLineCenter.x - eyeWidth * 2.2));
        const maxX = Math.min(canvas.width - 1, Math.ceil(zygomaLineCenter.x + eyeWidth * 2.2));
        const minY = Math.max(0, Math.floor(upperCenter.y - eyeHeight * 1.35));
        const maxY = Math.min(canvas.height - 1, Math.ceil(centerPt.y + eyeHeight * 3.1));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const i = (y * canvas.width + x) * 4;

                const gZygomaHighlight = gaussian2D(
                    x - zygomaLineCenter.x,
                    y - (zygomaLineCenter.y - eyeHeight * 0.62),
                    Math.max(18, eyeWidth * 0.50),
                    Math.max(12, eyeHeight * 0.78)
                );

                const gZygomaColor = gaussian2D(
                    x - cheekColorCenter.x,
                    y - (cheekColorCenter.y - eyeHeight * 0.08),
                    Math.max(16, eyeWidth * 0.48),
                    Math.max(12, eyeHeight * 0.82)
                );

                const shadowCenterX = zygomaLineCenter.x + (isLeft ? 4 : -4);

                const baseGZygomaBelow = gaussian2D(
                    x - shadowCenterX,
                    y - (zygomaLineCenter.y + eyeHeight * 0.48),
                    Math.max(10, eyeWidth * 0.55),
                    Math.max(8, eyeHeight * 0.52)
                );

                const innerCut = isLeft
                    ? clamp((x - zygomaLineCenter.x) / (eyeWidth * 0.6), 0, 1)
                    : clamp((zygomaLineCenter.x - x) / (eyeWidth * 0.6), 0, 1);

                const gZygomaBelow = baseGZygomaBelow * innerCut;

                const gUnderEye = gaussian2D(
                    x - underEyeMid.x,
                    y - (underEyeMid.y + eyeHeight * 0.42),
                    Math.max(14, eyeWidth * 0.82),
                    Math.max(8, eyeHeight * 0.58)
                );

                if (
                    gZygomaHighlight < 0.001 &&
                    gZygomaColor < 0.001 &&
                    gZygomaBelow < 0.001 &&
                    gUnderEye < 0.001
                ) continue;

                let r = dst[i];
                let g = dst[i + 1];
                let b = dst[i + 2];

                if (gZygomaHighlight > 0.001) {
                    const addBright = (10 + 8 * strength) * gZygomaHighlight;
                    const satDown = (0.03 + 0.025 * strength) * gZygomaHighlight;

                    const hsv = rgbToHsv(r, g, b);
                    hsv.s = Math.max(0, hsv.s - satDown);
                    hsv.v = Math.min(1, hsv.v + addBright / 255);

                    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
                    r = rgb.r;
                    g = rgb.g;
                    b = rgb.b;

                    const hiBlend = blendToward(
                        r, g, b,
                        255, 238, 228,
                        (0.05 + 0.08 * strength) * gZygomaHighlight
                    );
                    r = hiBlend.r;
                    g = hiBlend.g;
                    b = hiBlend.b;
                }

                if (gZygomaColor > 0.001) {
                    const cheekTint = blendToward(
                        r, g, b,
                        248, 210, 205,
                        (0.035 + 0.065 * strength) * gZygomaColor
                    );
                    r = cheekTint.r;
                    g = cheekTint.g;
                    b = cheekTint.b;
                }

                if (gZygomaBelow > 0.001) {
                    const subBright = (4 + 4 * strength) * gZygomaBelow;
                    r = clamp255(r - subBright);
                    g = clamp255(g - subBright);
                    b = clamp255(b - subBright);

                    const shadowTint = blendToward(
                        r, g, b,
                        128, 108, 104,
                        (0.01 + 0.015 * strength) * gZygomaBelow
                    );
                    r = shadowTint.r;
                    g = shadowTint.g;
                    b = shadowTint.b;
                }

                if (gUnderEye > 0.001) {
                    const underEyeTint = blendToward(
                        r, g, b,
                        245, 232, 225,
                        (0.02 + 0.03 * strength) * gUnderEye
                    );
                    r = underEyeTint.r;
                    g = underEyeTint.g;
                    b = underEyeTint.b;
                }

                dst[i] = r;
                dst[i + 1] = g;
                dst[i + 2] = b;
            }
        }

        const blurMinX = Math.max(0, Math.floor(underEyeMid.x - eyeWidth * 1.1));
        const blurMaxX = Math.min(canvas.width - 1, Math.ceil(underEyeMid.x + eyeWidth * 1.1));
        const blurMinY = Math.max(0, Math.floor(underEyeMid.y - eyeHeight * 0.15));
        const blurMaxY = Math.min(canvas.height - 1, Math.ceil(underEyeMid.y + eyeHeight * 1.15));

        for (let y = blurMinY; y <= blurMaxY; y++) {
            for (let x = blurMinX; x <= blurMaxX; x++) {
                const gUnderEye = gaussian2D(
                    x - underEyeMid.x,
                    y - (underEyeMid.y + eyeHeight * 0.42),
                    Math.max(14, eyeWidth * 0.82),
                    Math.max(8, eyeHeight * 0.58)
                );
                if (gUnderEye < 0.01) continue;

                const blurMix = (0.10 + 0.16 * strength) * gUnderEye;
                blurMixAt(toneSrc, dst, canvas.width, canvas.height, x, y, 1, blurMix);

                const i = (y * canvas.width + x) * 4;
                const add = (4 + 6 * strength) * gUnderEye;
                dst[i] = clamp255(dst[i] + add);
                dst[i + 1] = clamp255(dst[i + 1] + add);
                dst[i + 2] = clamp255(dst[i + 2] + add);
            }
        }
    }

    ctx.putImageData(dstImg, 0, 0);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function renderAfterFromBefore() {
    throw new Error("renderAfterFromBefore is browser-only. Use renderAfterImage(options) on the server.");
}

function resetCanvasForServer(canvas, width = 1, height = 1) {
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    canvas.clientWidth = canvas.width;
    canvas.clientHeight = canvas.height;
    return canvas;
}

async function loadImage(source) {
    if (!source) {
        throw new Error("before_image_load_failed: empty_source");
    }

    if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
        const img = new Image();
        img.src = source;
        return img;
    }

    if (typeof source === "string") {
        const trimmed = source.trim();
        if (!trimmed) throw new Error("before_image_load_failed: empty_string");

        const isRemote = /^https?:\/\//i.test(trimmed);
        const isDataUrl = /^data:/i.test(trimmed);

        if (isRemote || isDataUrl) {
            return await loadCanvasImage(trimmed);
        }

        const absPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
        if (!fs.existsSync(absPath)) {
            throw new Error(`before_image_load_failed: ${trimmed}`);
        }
        return await loadCanvasImage(absPath);
    }

    if (source.src || source.width || source.height || source.naturalWidth) {
        return source;
    }

    throw new Error("before_image_load_failed: unsupported_source_type");
}

function resolveInputSource(options = {}) {
    return (
        options.imageBuffer ||
        options.beforeImageBuffer ||
        options.beforeImagePath ||
        options.imagePath ||
        options.beforeImageUrl ||
        options.imageUrl ||
        options.beforeImageSource ||
        options.imageSource ||
        null
    );
}

function createStatusCollector(externalLogger) {
    const state = { status: "", info: "", steps: [] };
    return {
        state,
        setStatus(message) {
            state.status = message || "";
            state.steps.push({ type: "status", value: state.status });
            if (typeof externalLogger === "function") externalLogger({ type: "status", value: state.status });
        },
        setInfo(message) {
            state.info = message || "";
            state.steps.push({ type: "info", value: state.info });
            if (typeof externalLogger === "function") externalLogger({ type: "info", value: state.info });
        }
    };
}

async function renderAfterImage(options = {}) {
    const status = createStatusCollector(options.onProgress);

    const runtimeContext = {
        afterData: { ...(options.afterData || {}) },
        forwardData: { ...(options.forwardData || {}) },
        bootstrap: { ...(options.bootstrap || {}) },
        originalCanvas: createCanvas(1, 1),
        previewCanvas: createCanvas(1, 1),
        workCanvas: createCanvas(1, 1),
        setStatus: status.setStatus,
        setInfo: status.setInfo,
    };

    setRuntimeContext(runtimeContext);

    if (options.landmarks) {
        runtimeContext.afterData.landmarks = options.landmarks;
    } else if (options.faceLandmarks) {
        runtimeContext.afterData.faceLandmarks = options.faceLandmarks;
    }

    Object.keys(fx).forEach((k) => delete fx[k]);
    Object.assign(fx, FACE_FX_DEFAULTS, options.fx || options.fxOverrides || {});

    const inputSource = resolveInputSource(options);
    const img = await loadImage(inputSource || resolveBeforeUrl(options));

    resetCanvasForServer(runtimeContext.originalCanvas, img.width || img.naturalWidth || 1, img.height || img.naturalHeight || 1);
    resetCanvasForServer(runtimeContext.previewCanvas, img.width || img.naturalWidth || 1, img.height || img.naturalHeight || 1);
    resetCanvasForServer(runtimeContext.workCanvas, img.width || img.naturalWidth || 1, img.height || img.naturalHeight || 1);

    setStatus("before 이미지를 불러와 after 영역에 로드하는 중입니다.");
    setInfo("after 로딩중");

    drawCoverFromSourceToCanvas(img, runtimeContext.originalCanvas);
    drawImageToWorkCanvas(runtimeContext.workCanvas, img);

    const workCtx = runtimeContext.workCanvas.getContext("2d");
    const landmarks = normalizeLandmarks(
        resolveLandmarks(options),
        runtimeContext.workCanvas.width,
        runtimeContext.workCanvas.height
    );

    if (!landmarks || !Array.isArray(landmarks) || !landmarks.length) {
        applyGlobalFinish(workCtx, runtimeContext.workCanvas, fx);
        drawCoverFromSourceToCanvas(runtimeContext.workCanvas, runtimeContext.previewCanvas);
        setStatus("랜드마크가 없어 전체 톤 보정만 적용했습니다.");
        setInfo("랜드마크 없음");
    } else {
        setStatus("잡티 제거");
        setInfo("blemish");
        ApplyBlemish(workCtx, runtimeContext.workCanvas, landmarks, fx);

        setStatus("얼굴형 부드럽게 중...");
        setInfo("face oval");
        applyFaceOvalSmooth(workCtx, runtimeContext.workCanvas, landmarks, fx);

        setStatus("콧볼 축소 워프 적용 중.");
        setInfo("nose wing");
        applyNoseWingSlimWarp(workCtx, runtimeContext.workCanvas, landmarks, fx);

        setStatus("코 보정 적용 중.");
        setInfo("nose");
        applyNoseDepth(workCtx, landmarks, fx);

        setStatus("눈 보정 적용 중.");
        setInfo("eyes");

        applyEyeUpperLiftWarp(workCtx, runtimeContext.workCanvas, landmarks, fx);

        applyEyeLowerLiftWarp(workCtx, runtimeContext.workCanvas, landmarks, fx);

        setStatus("눈썹 보정 적용 중.");
        setInfo("brow");
        applyEyebrowCleanup(workCtx, runtimeContext.workCanvas, landmarks, fx);

        setStatus("입술 보정 적용 중.");
        setInfo("lips");
        applyLipEnhancement(workCtx, runtimeContext.workCanvas, landmarks, fx);

        setStatus("입꼬리 보정 적용 중.");
        setInfo("smile");
        applyMouthCornerLiftWarp(workCtx, runtimeContext.workCanvas, landmarks, fx);

        applyGlobalFinish(workCtx, runtimeContext.workCanvas, fx);
        drawCoverFromSourceToCanvas(runtimeContext.workCanvas, runtimeContext.previewCanvas);

        setStatus("after 이미지 렌더링이 완료되었습니다.");
        setInfo("완료");
    }

    const format = String(options.format || "png").toLowerCase();
    let outputBuffer;

    if (format === "jpeg" || format === "jpg") {
        outputBuffer = await runtimeContext.workCanvas.toBuffer("jpg", { quality: options.quality ?? 0.95 });
    } else if (format === "webp") {
        outputBuffer = await runtimeContext.workCanvas.toBuffer("webp", { quality: options.quality ?? 0.95 });
    } else {
        outputBuffer = await runtimeContext.workCanvas.toBuffer("png");
    }

    if (options.outputPath) {
        await fsp.writeFile(options.outputPath, outputBuffer);
    }

    return {
        buffer: outputBuffer,
        outputPath: options.outputPath || null,
        width: runtimeContext.workCanvas.width,
        height: runtimeContext.workCanvas.height,
        status: status.state.status,
        info: status.state.info,
        steps: status.state.steps,
        fx: { ...fx }
    };
}

module.exports = {
    FACE_FX_DEFAULTS,
    renderAfterImage,
    processAfterImage: renderAfterImage
};
