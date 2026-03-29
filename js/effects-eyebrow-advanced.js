// effect-eyebrow-advanced.js
import { LEFT_EYEBROW, RIGHT_EYEBROW } from "./constants.js";
import { getLm } from "./landmarks.js";
import { clamp, bilinearSample } from "./utils.js";

const DEBUG_BROW = false;

function dlog(...args) {
    if (DEBUG_BROW) console.log(...args);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;

    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (d !== 0) {
        if (max === rn) {
            h = ((gn - bn) / d) % 6;
        } else if (max === gn) {
            h = (bn - rn) / d + 2;
        } else {
            h = (rn - gn) / d + 4;
        }
        h *= 60;
        if (h < 0) h += 360;
    }

    return { h, s, v };
}

function isHairCandidate(r, g, b) {
    const lum = luminance(r, g, b);
    const { s, v } = rgbToHsv(r, g, b);

    // 너무 밝은 피부/하이라이트 제외
    if (v > 0.78 && s < 0.30) return false;

    // 어두운 픽셀은 거의 다 허용
    if (v < 0.58) return true;

    // 중간 밝기에서는 채도/명도 같이 봄
    if (v < 0.72 && s > 0.16) return true;

    // 갈색 계열처럼 약간 밝아도 허용
    if (lum < 170 && s > 0.20 && v < 0.80) return true;

    return false;
}

function getHairStrength(r, g, b) {
    const lum = luminance(r, g, b);
    const { s, v } = rgbToHsv(r, g, b);

    const darkScore = clamp((0.82 - v) / 0.42, 0, 1);
    const satScore = clamp((s - 0.08) / 0.42, 0, 1);
    const lumScore = clamp((185 - lum) / 120, 0, 1);

    return clamp(darkScore * 0.50 + satScore * 0.25 + lumScore * 0.25, 0, 1);
}

function getFillableStrength(r, g, b) {
    const lum = luminance(r, g, b);
    const { s, v } = rgbToHsv(r, g, b);

    // 빈 부분 후보:
    // 너무 검은 곳은 제외, 너무 하얀 피부도 제외
    const midValue = clamp(1 - Math.abs(v - 0.62) / 0.34, 0, 1);
    const notTooDark = clamp((v - 0.18) / 0.35, 0, 1);
    const notTooBright = clamp((0.92 - v) / 0.24, 0, 1);
    const satAllowance = clamp(1 - s / 0.55, 0, 1);
    const lumAllowance = clamp((210 - lum) / 160, 0, 1);

    return clamp(
        midValue * 0.35 +
        notTooDark * 0.15 +
        notTooBright * 0.20 +
        satAllowance * 0.10 +
        lumAllowance * 0.20,
        0,
        1
    );
}

function isValidPoint(p) {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function getCanvasSize(dom) {
    const w = dom?.canvas?.workCanvas?.width || 0;
    const h = dom?.canvas?.workCanvas?.height || 0;
    return { w, h };
}

function getBrowPolygon(state, side) {
    const indices = side === "left" ? LEFT_EYEBROW : RIGHT_EYEBROW;
    return indices.map((idx) => getLm(state, idx));
}

function getBounds(poly, w, h) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of poly) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }

    return {
        left: Math.max(0, Math.floor(minX)),
        top: Math.max(0, Math.floor(minY)),
        right: Math.min(w - 1, Math.ceil(maxX)),
        bottom: Math.min(h - 1, Math.ceil(maxY))
    };
}

function pointInPolygon(x, y, poly) {
    let inside = false;

    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;

        const intersect =
            ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-6) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;

    if (ab2 < 1e-6) return Math.hypot(px - ax, py - ay);

    let t = (apx * abx + apy * aby) / ab2;
    t = clamp(t, 0, 1);

    const qx = ax + abx * t;
    const qy = ay + aby * t;
    return Math.hypot(px - qx, py - qy);
}

function getEdgeDistance(x, y, poly) {
    let best = Infinity;

    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        best = Math.min(best, pointSegmentDistance(x, y, a.x, a.y, b.x, b.y));
    }

    return best;
}

function getColumnRanges(poly, bounds) {
    const cols = [];

    for (let x = bounds.left; x <= bounds.right; x++) {
        let top = null;
        let bottom = null;
        let insideCount = 0;

        for (let y = bounds.top; y <= bounds.bottom; y++) {
            if (!pointInPolygon(x + 0.5, y + 0.5, poly)) continue;
            insideCount++;
            if (top === null) top = y;
            bottom = y;
        }

        if (insideCount >= 2 && top !== null && bottom !== null) {
            cols.push({ x, top, bottom, insideCount });
        }
    }

    return cols;
}

function smoothColumns(cols) {
    return cols.map((col, idx) => {
        let sumDensity = 0;
        let sumWeight = 0;
        let sumTop = 0;
        let sumBottom = 0;
        let wtTop = 0;
        let wtBottom = 0;

        for (let k = -2; k <= 2; k++) {
            const j = idx + k;
            if (j < 0 || j >= cols.length) continue;

            const weight = k === 0 ? 1.0 : (Math.abs(k) === 1 ? 0.75 : 0.45);
            sumDensity += cols[j].density * weight;
            sumWeight += weight;

            sumTop += cols[j].top * weight;
            sumBottom += cols[j].bottom * weight;
            wtTop += weight;
            wtBottom += weight;
        }

        return {
            ...col,
            targetDensity: sumWeight > 0 ? sumDensity / sumWeight : col.density,
            targetTop: wtTop > 0 ? sumTop / wtTop : col.top,
            targetBottom: wtBottom > 0 ? sumBottom / wtBottom : col.bottom
        };
    });
}

function buildDensityColumns(src, poly, bounds, w) {
    const cols = getColumnRanges(poly, bounds);

    for (const col of cols) {
        let darkCount = 0;
        let lumSum = 0;
        let strongTop = null;
        let strongBottom = null;

        for (let y = col.top; y <= col.bottom; y++) {
            const i = (y * w + col.x) * 4;
            const r = src[i];
            const g = src[i + 1];
            const b = src[i + 2];
            const lum = luminance(r, g, b);

            lumSum += lum;

            if (isHairCandidate(r, g, b)) {
                darkCount++;
                if (strongTop === null) strongTop = y;
                strongBottom = y;
            }
        }

        col.density = darkCount / Math.max(1, col.insideCount);
        col.avgLum = lumSum / Math.max(1, col.insideCount);
        col.strongTop = strongTop;
        col.strongBottom = strongBottom;
    }

    return smoothColumns(cols);
}

function estimateBrowTone(src, poly, bounds, w) {
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let count = 0;

    for (let y = bounds.top; y <= bounds.bottom; y++) {
        for (let x = bounds.left; x <= bounds.right; x++) {
            if (!pointInPolygon(x + 0.5, y + 0.5, poly)) continue;

            const edgeDist = getEdgeDistance(x + 0.5, y + 0.5, poly);
            if (edgeDist < 1.0) continue;

            const i = (y * w + x) * 4;
            const r = src[i];
            const g = src[i + 1];
            const b = src[i + 2];

            if (!isHairCandidate(r, g, b)) continue;

            rs += r;
            gs += g;
            bs += b;
            count++;
        }
    }

    if (count < 8) return [80, 64, 58];
    return [rs / count, gs / count, bs / count];
}

function getEndZones(bounds, side) {
    const width = bounds.right - bounds.left + 1;
    const zoneW = Math.max(6, Math.round(width * 0.22));

    if (side === "left") {
        return {
            innerLeft: bounds.right - zoneW + 1,
            innerRight: bounds.right,
            outerLeft: bounds.left,
            outerRight: bounds.left + zoneW - 1
        };
    }

    return {
        innerLeft: bounds.left,
        innerRight: bounds.left + zoneW - 1,
        outerLeft: bounds.right - zoneW + 1,
        outerRight: bounds.right
    };
}

function applyEndpointCleanup(src, dst, poly, bounds, w, h, side, innerAmount, outerAmount) {
    const zones = getEndZones(bounds, side);

    for (let y = bounds.top; y <= bounds.bottom; y++) {
        for (let x = bounds.left; x <= bounds.right; x++) {
            if (!pointInPolygon(x + 0.5, y + 0.5, poly)) continue;

            const edgeDist = getEdgeDistance(x + 0.5, y + 0.5, poly);
            if (edgeDist > 2.0) continue;

            const i = (y * w + x) * 4;
            const r = dst[i];
            const g = dst[i + 1];
            const b = dst[i + 2];

            const hairLike = getHairStrength(r, g, b);
            if (hairLike <= 0.01) continue;

            let amount = 0;
            let sampleX = x;
            const sampleY = y - 8;

            if (x >= zones.innerLeft && x <= zones.innerRight) {
                amount = innerAmount;
                sampleX += side === "left" ? -3 : 3;
            } else if (x >= zones.outerLeft && x <= zones.outerRight) {
                amount = outerAmount;
                sampleX += side === "left" ? 3 : -3;
            } else {
                continue;
            }

            if (amount <= 0.001) continue;

            const skin = bilinearSample(src, sampleX, sampleY, w, h);
            const t = clamp(amount * hairLike * (1 - edgeDist / 2.0) * 0.62, 0, 0.52);

            dst[i] = clamp(Math.round(lerp(r, skin[0], t)), 0, 255);
            dst[i + 1] = clamp(Math.round(lerp(g, skin[1], t)), 0, 255);
            dst[i + 2] = clamp(Math.round(lerp(b, skin[2], t)), 0, 255);
        }
    }
}

function collectDarkSamplesForColumn(src, col, w) {
    const samples = [];

    for (let y = col.top; y <= col.bottom; y++) {
        const i = (y * w + col.x) * 4;
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];

        if (isHairCandidate(r, g, b)) {
            samples.push({ r, g, b, y, strength: getHairStrength(r, g, b) });
        }
    }

    return samples;
}

function averageSamples(samples) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sw = 0;

    for (const s of samples) {
        const w = 0.35 + s.strength * 0.65;
        sr += s.r * w;
        sg += s.g * w;
        sb += s.b * w;
        sw += w;
    }

    if (sw <= 1e-6) return [80, 64, 58];

    return [
        sr / sw,
        sg / sw,
        sb / sw
    ];
}

function drawPolygonOutline(dst, poly, w, h) {
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));

        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = Math.round(a.x + (b.x - a.x) * t);
            const y = Math.round(a.y + (b.y - a.y) * t);

            if (x < 0 || y < 0 || x >= w || y >= h) continue;

            const idx = (y * w + x) * 4;
            dst[idx] = 255;
            dst[idx + 1] = 255;
            dst[idx + 2] = 255;
            dst[idx + 3] = 255;
        }
    }
}

function applyHairFillDebug(src, dst, poly, bounds, w, h, amount) {
    if (amount <= 0.001) return;

    const tone = estimateBrowTone(src, poly, bounds, w);
    const cols = buildDensityColumns(src, poly, bounds, w);

    for (const col of cols) {
        const lack = clamp((col.targetDensity - col.density) / 0.60, 0, 1);
        if (lack <= 0.001) continue;

        const fillTop = Math.max(col.top, Math.round(col.targetTop));
        const fillBottom = Math.min(col.bottom, Math.round(col.targetBottom));
        if (fillBottom - fillTop < 1) continue;

        const darkSamples = collectDarkSamplesForColumn(src, col, w);
        if (darkSamples.length < 1) continue;

        const [sr, sg, sb] = averageSamples(darkSamples);

        for (let y = fillTop; y <= fillBottom; y++) {
            if (!pointInPolygon(col.x + 0.5, y + 0.5, poly)) continue;

            const edgeDist = getEdgeDistance(col.x + 0.5, y + 0.5, poly);
            if (edgeDist < 0.12) continue;

            const i = (y * w + col.x) * 4;
            const r = dst[i];
            const g = dst[i + 1];
            const b = dst[i + 2];

            const centerY = (fillTop + fillBottom) * 0.5;
            const verticalBias = clamp(
                1 - Math.abs(y - centerY) / Math.max(1.0, (fillBottom - fillTop) * 1.35),
                0,
                1
            );

            const s1 = bilinearSample(src, col.x - 2, y, w, h);
            const s2 = bilinearSample(src, col.x + 2, y, w, h);

            const refR = (s1[0] + s2[0]) * 0.5;
            const refG = (s1[1] + s2[1]) * 0.5;
            const refB = (s1[2] + s2[2]) * 0.5;

            const targetR = sr * 0.52 + refR * 0.28 + tone[0] * 0.20;
            const targetG = sg * 0.52 + refG * 0.28 + tone[1] * 0.20;
            const targetB = sb * 0.52 + refB * 0.28 + tone[2] * 0.20;

            const fillable = getFillableStrength(r, g, b);
            const edgeSafe = clamp(edgeDist / 0.7, 0, 1);

            const t = clamp(amount * lack * verticalBias * fillable * edgeSafe * 2.2, 0, 0.95);

            if (t > 0.003) {
                const red = Math.round(180 + 75 * t);
                const green = Math.round(10 * (1 - t));
                const blue = Math.round(10 * (1 - t));

                dst[i] = clamp(red, 0, 255);
                dst[i + 1] = clamp(green, 0, 255);
                dst[i + 2] = clamp(blue, 0, 255);
                dst[i + 3] = 255;
            }

            if (DEBUG_BROW && t > 0.03) {
                console.log("[brow-fill-debug]", {
                    x: col.x,
                    y,
                    lack,
                    verticalBias,
                    fillable,
                    edgeSafe,
                    t,
                    targetR,
                    targetG,
                    targetB
                });
            }
        }
    }

    dlog("[applyHairFillDebug] cols=", cols);
}

function applyOneSide(src, dst, state, side, data, w, h) {
    const poly = getBrowPolygon(state, side);
    if (poly.some((p) => !isValidPoint(p))) return;

    const bounds = getBounds(poly, w, h);

    drawPolygonOutline(dst, poly, w, h);

    applyEndpointCleanup(
        src,
        dst,
        poly,
        bounds,
        w,
        h,
        side,
        data.eyebrowInnerSoft || 0,
        data.eyebrowOuterClean || 0
    );

    const afterCleanup = new Uint8ClampedArray(dst);
    applyHairFillDebug(afterCleanup, dst, poly, bounds, w, h, data.eyebrowFill || 0);

    dlog("[applyOneSide]", side, bounds, poly);
}

export function applyEyebrowAdvanced(state, dom, data) {
    const total =
        (data?.eyebrowInnerSoft || 0) +
        (data?.eyebrowOuterClean || 0) +
        (data?.eyebrowFill || 0);

    if (total <= 0.001) return;

    const workCtx = dom?.ctx?.workCtx;
    const workCanvas = dom?.canvas?.workCanvas;
    if (!workCtx || !workCanvas) return;

    const { w, h } = getCanvasSize(dom);
    if (!w || !h) return;

    const img = workCtx.getImageData(0, 0, w, h);
    const src = new Uint8ClampedArray(img.data);
    const dst = img.data;

    applyOneSide(src, dst, state, "left", data, w, h);
    applyOneSide(src, dst, state, "right", data, w, h);

    workCtx.putImageData(img, 0, 0);
}