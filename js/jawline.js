import { gaussian2D, clamp } from "./utils.js";
import { getLm } from "./landmarks.js";

/* index */
const IDX_MOUTH_LEFT = 61;
const IDX_MOUTH_RIGHT = 291;
const IDX_CHIN = 152;

const IDX_JAW_LEFT = 234;
const IDX_JAW_RIGHT = 454;

const IDX_JAW_LEFT_MID_1 = 172;
const IDX_JAW_LEFT_MID_2 = 136;
const IDX_JAW_RIGHT_MID_1 = 397;
const IDX_JAW_RIGHT_MID_2 = 365;

// 볼 / 광대 기준점
const IDX_CHEEK_LEFT = 117;
const IDX_CHEEK_RIGHT = 346;
const IDX_ZYGOMA_LEFT = 50;
const IDX_ZYGOMA_RIGHT = 280;

// 눈 아래(언더아이) 기준점
const IDX_UNDER_EYE_LEFT_A = 145;
const IDX_UNDER_EYE_LEFT_B = 153;
const IDX_UNDER_EYE_RIGHT_A = 374;
const IDX_UNDER_EYE_RIGHT_B = 380;

/* ===============================
   PARAM HELPER
================================= */
function getParam(data, dom, key, fallback = 0) {
    if (data && Number.isFinite(Number(data[key]))) {
        return Number(data[key]);
    }
    if (dom?.sliders?.[key]) {
        return Number(dom.sliders[key].value) / 100;
    }
    return fallback;
}

function getMidPoint(state, idxA, idxB) {
    const a = getLm(state, idxA);
    const b = getLm(state, idxB);
    return {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5
    };
}

/* ===============================
   JAW WIDTH
================================= */
function accumulateJawWidth(state, acc, x, y, amount) {
    if (amount <= 0) return;

    const jawL = getLm(state, IDX_JAW_LEFT);
    const jawR = getLm(state, IDX_JAW_RIGHT);
    const chin = getLm(state, IDX_CHIN);

    const gL = gaussian2D(x - jawL.x, y - jawL.y, 120, 150);
    const gR = gaussian2D(x - jawR.x, y - jawR.y, 120, 150);
    const chinProtect = 1 - gaussian2D(x - chin.x, y - chin.y, 95, 85);

    acc.dx += (+amount * 14 * gL * chinProtect);
    acc.dx += (-amount * 14 * gR * chinProtect);
    acc.influence = Math.max(acc.influence, gL, gR);
}

/* ===============================
   JAW SMOOTH
================================= */
function accumulateJawSmooth(state, acc, x, y, amount) {
    if (amount <= 0) return;

    const pts = [
        getLm(state, IDX_JAW_LEFT),
        getLm(state, IDX_JAW_LEFT_MID_1),
        getLm(state, IDX_JAW_LEFT_MID_2),
        getLm(state, IDX_CHIN),
        getLm(state, IDX_JAW_RIGHT_MID_2),
        getLm(state, IDX_JAW_RIGHT_MID_1),
        getLm(state, IDX_JAW_RIGHT)
    ];

    for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const next = pts[i + 1];

        const targetX = (prev.x + next.x) * 0.5;
        const targetY = (prev.y + next.y) * 0.5;

        const diffX = targetX - curr.x;
        const diffY = targetY - curr.y;

        const g = gaussian2D(x - curr.x, y - curr.y, 70, 90);

        acc.dx += diffX * amount * 0.42 * g;
        acc.dy += diffY * amount * 0.26 * g;
        acc.influence = Math.max(acc.influence, g);
    }
}

/* ===============================
   CHEEK / ZYGOMA / UNDER-EYE LIFT
   marionetteLift 슬라이드 값으로만 작동
================================= */
function accumulateMarionetteLift(state, acc, x, y, amount) {
    if (amount <= 0) return;

    const mouthL = getLm(state, IDX_MOUTH_LEFT);
    const mouthR = getLm(state, IDX_MOUTH_RIGHT);

    const cheekL = getLm(state, IDX_CHEEK_LEFT);
    const cheekR = getLm(state, IDX_CHEEK_RIGHT);
    const zygL = getLm(state, IDX_ZYGOMA_LEFT);
    const zygR = getLm(state, IDX_ZYGOMA_RIGHT);

    const underEyeL = getMidPoint(state, IDX_UNDER_EYE_LEFT_A, IDX_UNDER_EYE_LEFT_B);
    const underEyeR = getMidPoint(state, IDX_UNDER_EYE_RIGHT_A, IDX_UNDER_EYE_RIGHT_B);

    // 슬라이더 값만 사용
    const lift = amount * 3;
    if (lift <= 0.001) return;

    // 볼: 위 + 바깥
    const cheekTargetL = {
        x: cheekL.x - 16,
        y: cheekL.y - 14
    };
    const cheekTargetR = {
        x: cheekR.x + 16,
        y: cheekR.y - 14
    };

    // 광대: 위 + 바깥
    const zygTargetL = {
        x: zygL.x - 12,
        y: zygL.y - 12
    };
    const zygTargetR = {
        x: zygR.x + 12,
        y: zygR.y - 12
    };

    // 눈 아래: 아주 살짝만 위 + 바깥
    const underEyeTargetL = {
        x: underEyeL.x - 6,
        y: underEyeL.y - 6
    };
    const underEyeTargetR = {
        x: underEyeR.x + 6,
        y: underEyeR.y - 6
    };

    // 영향 범위
    const gCheekL = gaussian2D(x - cheekL.x, y - cheekL.y, 120, 96);
    const gCheekR = gaussian2D(x - cheekR.x, y - cheekR.y, 120, 96);

    const gZygL = gaussian2D(x - zygL.x, y - zygL.y, 110, 84);
    const gZygR = gaussian2D(x - zygR.x, y - zygR.y, 110, 84);

    const gUnderEyeL = gaussian2D(x - underEyeL.x, y - underEyeL.y, 74, 46);
    const gUnderEyeR = gaussian2D(x - underEyeR.x, y - underEyeR.y, 74, 46);

    // 볼
    acc.dx += (cheekTargetL.x - cheekL.x) * 1.35 * lift * gCheekL;
    acc.dy += (cheekTargetL.y - cheekL.y) * 1.55 * lift * gCheekL;

    acc.dx += (cheekTargetR.x - cheekR.x) * 1.35 * lift * gCheekR;
    acc.dy += (cheekTargetR.y - cheekR.y) * 1.55 * lift * gCheekR;

    // 광대
    acc.dx += (zygTargetL.x - zygL.x) * 1.05 * lift * gZygL;
    acc.dy += (zygTargetL.y - zygL.y) * 1.15 * lift * gZygL;

    acc.dx += (zygTargetR.x - zygR.x) * 1.05 * lift * gZygR;
    acc.dy += (zygTargetR.y - zygR.y) * 1.15 * lift * gZygR;

    // 눈 아래는 약하게만
    acc.dx += (underEyeTargetL.x - underEyeL.x) * 0.42 * lift * gUnderEyeL;
    acc.dy += (underEyeTargetL.y - underEyeL.y) * 0.58 * lift * gUnderEyeL;

    acc.dx += (underEyeTargetR.x - underEyeR.x) * 0.42 * lift * gUnderEyeR;
    acc.dy += (underEyeTargetR.y - underEyeR.y) * 0.58 * lift * gUnderEyeR;

    // 입 보호
    const mouthCenterX = (mouthL.x + mouthR.x) * 0.5;
    const mouthCenterY = (mouthL.y + mouthR.y) * 0.5 + 10;
    const mouthProtect = gaussian2D(x - mouthCenterX, y - mouthCenterY, 78, 52);

    acc.dx *= (1 - mouthProtect * 0.22);
    acc.dy *= (1 - mouthProtect * 0.22);

    acc.influence = Math.max(
        acc.influence,
        gCheekL * lift,
        gCheekR * lift,
        gZygL * lift,
        gZygR * lift,
        gUnderEyeL * lift,
        gUnderEyeR * lift
    );
}

/* ===============================
   CORE DISP
================================= */
function computeJawlineDisp(state, x, y, jawWidth, jawSmooth, marionetteLift) {
    const acc = { dx: 0, dy: 0, influence: 0 };

    accumulateJawWidth(state, acc, x, y, jawWidth);
    accumulateJawSmooth(state, acc, x, y, jawSmooth);
    accumulateMarionetteLift(state, acc, x, y, marionetteLift);

    return acc;
}

/* ===============================
   APPLY
================================= */
export function applyJawlineEnhance(state, dom, data) {
    const jawWidth = getParam(data, dom, "jawWidth", 0);
    const jawSmooth = getParam(data, dom, "jawSmooth", 0);
    const marionetteLift = getParam(data, dom, "marionetteLift", 0);

    if (jawWidth <= 0 && jawSmooth <= 0 && marionetteLift <= 0) return;

    const { workCtx, tempCtx3 } = dom.ctx;
    const w = dom.canvas.workCanvas.width;
    const h = dom.canvas.workCanvas.height;

    const srcImg = workCtx.getImageData(0, 0, w, h);
    const dstImg = tempCtx3.createImageData(w, h);

    const src = srcImg.data;
    const dst = dstImg.data;
    dst.set(src);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const disp = computeJawlineDisp(state, x, y, jawWidth, jawSmooth, marionetteLift);
            if (disp.influence < 0.001) continue;

            const sx = clamp(x - disp.dx, 0, w - 1);
            const sy = clamp(y - disp.dy, 0, h - 1);

            const si = (Math.floor(sy) * w + Math.floor(sx)) * 4;
            const di = (y * w + x) * 4;

            dst[di] = src[si];
            dst[di + 1] = src[si + 1];
            dst[di + 2] = src[si + 2];
            dst[di + 3] = 255;
        }
    }

    tempCtx3.putImageData(dstImg, 0, 0);
    workCtx.clearRect(0, 0, w, h);
    workCtx.drawImage(dom.canvas.tempCanvas3, 0, 0);
}