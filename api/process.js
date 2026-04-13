require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads");
const afterImgModulePath = path.join(__dirname, "afterimg.js");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

router.use(express.json({ limit: "30mb" }));
router.use(express.urlencoded({ extended: true, limit: "30mb" }));
router.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, uploadDir);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname || "") || guessExtFromMime(file.mimetype);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 60 * 1024 * 1024
    }
});

const openai =
    process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

// 메모리 저장소
const forwardingStore = new Map();

/* -------------------------
 * 기본 유틸
 * ------------------------- */
function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clampScore(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function safeJsonParse(value, fallback = null) {
    if (value == null || value === "") return fallback;
    if (typeof value === "object") return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function hasMeaningfulAudioAnalysis(audioAnalysis) {
    return !!(
        audioAnalysis &&
        typeof audioAnalysis === "object" &&
        (
            Array.isArray(audioAnalysis.silenceSegments) ||
            Array.isArray(audioAnalysis.trailingFadeSegments) ||
            Array.isArray(audioAnalysis.tensionSegments) ||
            Array.isArray(audioAnalysis.lowVoiceSegments)
        )
    );
}

function normalizeFillerAnalysisPayload(raw) {
    const parsed = safeJsonParse(raw, raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value = "") {
    return escapeHtml(value).replace(/"/g, "&quot;");
}

function guessExtFromMime(mime) {
    if (!mime) return ".bin";
    if (mime.includes("webm")) return ".webm";
    if (mime.includes("wav")) return ".wav";
    if (mime.includes("mpeg")) return ".mp3";
    if (mime.includes("ogg")) return ".ogg";
    if (mime.includes("jpeg")) return ".jpg";
    if (mime.includes("png")) return ".png";
    return ".bin";
}

function guessMimeFromFilename(filename) {
    const lower = String(filename || "").toLowerCase();
    if (lower.endsWith(".webm")) return "audio/webm";
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    if (lower.endsWith(".m4a")) return "audio/mp4";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    return "application/octet-stream";
}

function safeSerializeForInlineScript(value) {
    return JSON.stringify(value ?? null)
        .replace(/</g, "\\u003C")
        .replace(/>/g, "\\u003E")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

function normalizeMetricsInput(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
        bothLowSeconds: toNumber(src.bothLowSeconds ?? src.bothSmilePositiveSeconds, 0),
        gazeYHighSeconds: toNumber(src.gazeYHighSeconds, 0),
        gazeXCount: toNumber(src.gazeXCount ?? src.gazeXAbsEventCount ?? src.gazeEventCount, 0),
        blinkCount: toNumber(src.blinkCount, 0),
        smileCount: toNumber(src.smileCount ?? src.smileBothCount, 0),
        jawOpenSmileMs: toNumber(src.jawOpenSmileMs ?? src.jawOpenSmileSeconds, 0),
        jawOpenCount: toNumber(src.jawOpenCount ?? src.jawOpenSeconds, 0),
        puckerCount: toNumber(src.puckerCount, 0),
        funnelCount: toNumber(src.funnelCount, 0),
        yawCount: toNumber(src.yawCount ?? src.yawChangeCount, 0),
        pitchCount: toNumber(src.pitchCount ?? src.pitchChangeCount, 0),
        browFrownSeconds: toNumber(src.browFrownSeconds ?? src.browFrownSecond ?? src.browSecond, 0)
    };
}

function pickBodyValue(body, keys, fallback = undefined) {
    for (const key of keys) {
        const value = body?.[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
}

function buildMetricsFromBody(body, prefix) {
    const raw = {
        bothSmilePositiveSeconds: pickBodyValue(body, [`${prefix}_bothSmilePositiveSeconds`, `${prefix}_bothLowSeconds`]),
        gazeYHighSeconds: pickBodyValue(body, [`${prefix}_gazeYHighSeconds`]),
        blinkCount: pickBodyValue(body, [`${prefix}_blinkCount`]),
        gazeEventCount: pickBodyValue(body, [`${prefix}_gazeEventCount`]),
        gazeXAbsEventCount: pickBodyValue(body, [`${prefix}_gazeXAbsEventCount`, `${prefix}_gazeXCount`]),
        smileBothCount: pickBodyValue(body, [`${prefix}_smileBothCount`, `${prefix}_smileCount`]),
        smileBothJawYCount: pickBodyValue(body, [`${prefix}_smileBothJawYCount`]),
        jawOpenSeconds: pickBodyValue(body, [`${prefix}_jawOpenSeconds`, `${prefix}_jawOpenCount`]),
        jawOpenSmileSeconds: pickBodyValue(body, [`${prefix}_jawOpenSmileSeconds`]),
        puckerCount: pickBodyValue(body, [`${prefix}_puckerCount`]),
        funnelCount: pickBodyValue(body, [`${prefix}_funnelCount`]),
        yawChangeCount: pickBodyValue(body, [`${prefix}_yawChangeCount`, `${prefix}_yawCount`]),
        pitchChangeCount: pickBodyValue(body, [`${prefix}_pitchChangeCount`, `${prefix}_pitchCount`]),
        browFrownSeconds: pickBodyValue(body, [`${prefix}_browFrownSeconds`, `${prefix}_browSecond`])
    };

    return normalizeMetricsInput(raw);
}

function matchNumber(text, regex, fallback = 0) {
    const m = String(text || "").match(regex);
    if (!m) return fallback;
    return toNumber(m[1], fallback);
}

function parseMetricsFromText(text = "") {
    return normalizeMetricsInput({
        bothLowSeconds: matchNumber(text, /양쪽.*?누적 시간:\s*([-\d.]+)초/),
        gazeYHighSeconds: matchNumber(text, /gazeY.*?누적 시간:\s*([-\d.]+)초/),
        gazeXCount: matchNumber(text, /gazeX.*?횟수:\s*([-\d.]+)/),
        blinkCount: matchNumber(text, /blink.*?횟수:\s*([-\d.]+)/i),
        smileCount: matchNumber(text, /smile.*?횟수:\s*([-\d.]+)/),
        jawOpenCount: matchNumber(text, /jawOpen.*?(?:누적 시간|횟수):\s*([-\d.]+)/),
        puckerCount: matchNumber(text, /pucker.*?횟수:\s*([-\d.]+)/),
        funnelCount: matchNumber(text, /funnel.*?횟수:\s*([-\d.]+)/),
        yawCount: matchNumber(text, /yaw.*?횟수:\s*([-\d.]+)/),
        pitchCount: matchNumber(text, /pitch.*?횟수:\s*([-\d.]+)/),
        browFrownSecond: matchNumber(text, /browFrown time:\s*([-\d.]+)초/)
    });
}

function getSegmentDurationSeconds(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return 0;
    return segments.reduce((sum, seg) => {
        const start = toNumber(seg?.start, 0);
        const end = toNumber(seg?.end, 0);
        if (end <= start) return sum;
        return sum + (end - start);
    }, 0);
}

function countSegmentsAtLeast(segments, minSeconds) {
    if (!Array.isArray(segments) || segments.length === 0) return 0;
    return segments.reduce((count, seg) => {
        const start = toNumber(seg?.start, 0);
        const end = toNumber(seg?.end, 0);
        return count + (end - start >= minSeconds ? 1 : 0);
    }, 0);
}

function normalizeSingleLandmarkPoint(point) {
    if (!point || typeof point !== "object") return null;
    return {
        x: toNumber(point.x, 0),
        y: toNumber(point.y, 0),
        z: toNumber(point.z, 0)
    };
}

function normalizeLandmarksPayload(raw) {
    const parsed = safeJsonParse(raw, raw);
    if (!parsed) return null;

    let source = null;

    if (Array.isArray(parsed)) {
        source = parsed;
    } else if (Array.isArray(parsed?.landmarks)) {
        source = parsed.landmarks;
    } else if (Array.isArray(parsed?.faceLandmarks)) {
        source = parsed.faceLandmarks;
    } else if (Array.isArray(parsed?.multiFaceLandmarks?.[0])) {
        source = parsed.multiFaceLandmarks[0];
    } else if (Array.isArray(parsed?.faces?.[0]?.landmarks)) {
        source = parsed.faces[0].landmarks;
    }

    if (!Array.isArray(source)) return null;

    return source
        .map(normalizeSingleLandmarkPoint)
        .filter(Boolean);
}

function normalizeBlendshapesPayload(raw) {
    const parsed = safeJsonParse(raw, raw);
    if (!parsed) return [];

    let source = null;

    if (Array.isArray(parsed)) {
        source = parsed;
    } else if (Array.isArray(parsed?.categories)) {
        source = parsed.categories;
    } else if (Array.isArray(parsed?.faceBlendshapes)) {
        source = parsed.faceBlendshapes;
    } else if (Array.isArray(parsed?.blendshapes)) {
        source = parsed.blendshapes;
    }

    if (!Array.isArray(source)) return [];

    return source
        .map(item => {
            if (!item || typeof item !== "object") return null;
            return {
                categoryName: String(item.categoryName || item.name || ""),
                score: toNumber(item.score, 0)
            };
        })
        .filter(item => item && item.categoryName);
}

function normalizeFacialMatrixesPayload(raw) {
    const parsed = safeJsonParse(raw, raw);
    if (!parsed) return [];

    let source = null;

    if (Array.isArray(parsed)) {
        source = parsed;
    } else if (Array.isArray(parsed?.facialTransformationMatrixes)) {
        source = parsed.facialTransformationMatrixes;
    } else if (Array.isArray(parsed?.matrixes)) {
        source = parsed.matrixes;
    } else if (Array.isArray(parsed?.matrices)) {
        source = parsed.matrices;
    }

    if (!Array.isArray(source)) return [];

    return source
        .map(item => {
            if (Array.isArray(item)) {
                return item.map(v => toNumber(v, 0));
            }
            if (Array.isArray(item?.data)) {
                return item.data.map(v => toNumber(v, 0));
            }
            return null;
        })
        .filter(arr => Array.isArray(arr) && arr.length > 0);
}

/* -------------------------
 * 텍스트 D
 * ------------------------- */
function buildTextDScoreSnapshot(metricsRaw) {
    const m = normalizeMetricsInput(metricsRaw);

    let mouthCornerScore = clampScore(m.bothLowSeconds * 2.8, 0, 11);
    mouthCornerScore = clampScore(mouthCornerScore - m.jawOpenCount * 10, 0, 11);
    const gazeYScore = clampScore(10 - (m.gazeYHighSeconds * 2.5), 0, 11);
    const gazeXScore = clampScore(5 - ((m.gazeXCount - 1) * 2), 0, 5);
    const smileScore = 0;

    const mouthHabitPenaltyScore = clampScore(
        5 - ((m.puckerCount + m.funnelCount) * 2),
        -5,
        5
    );

    if (m.yawCount === 1) m.yawCount = 0;
    if (m.pitchCount === 1) m.pitchCount = 0;
    if (m.blinkCount === 1) m.blinkCount = 0;

    if (m.yawCount < 2) m.yawCount = 0;
    else m.yawCount -= 1;
    if (m.pitchCount < 2) m.pitchCount = 0;
    else m.pitchCount -= 1;
    if (m.blinkCount < 2) m.blinkCount = 0;
    else m.blinkCount -= 1;

    const headMovePenaltyScore = clampScore(
        5 - ((m.yawCount + m.pitchCount) * 2),
        -5,
        5
    );

    const blinkScore = clampScore(3 + m.blinkCount * -1, -3, 3);
    const browFrownPenaltyScore = clampScore(2 + m.browFrownSeconds * -1, -4, 2);

    const totalScore =
        mouthCornerScore +
        gazeYScore +
        gazeXScore +
        blinkScore +
        mouthHabitPenaltyScore +
        headMovePenaltyScore;

    return {
        ...m,
        mouthCornerScore,
        gazeYScore,
        gazeXScore,
        smileScore,
        blinkScore,
        mouthHabitPenaltyScore,
        headMovePenaltyScore,
        browFrownPenaltyScore,
        totalScore
    };
}

function formatTextD(snapshot) {
    const s = snapshot;
    return [
        `텍스트D 점수`,
        `상태: 계산 완료`,
        ``,
        `입꼬리 점수: ${s.mouthCornerScore.toFixed(2)} / 10.00`,
        `  - 누적 시간: ${s.bothLowSeconds.toFixed(2)}초`,
        `gazeY 점수: ${s.gazeYScore.toFixed(2)} / 10.00`,
        `  - 기준: 10점 시작, gazeY 0.2 초과 누적시간 초당 2.5점 감점`,
        `  - 누적 시간: ${s.gazeYHighSeconds.toFixed(2)}초`,
        `gazeX 점수: ${s.gazeXScore.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, gazeX 횟수당 2점 감점`,
        `  - 횟수: ${s.gazeXCount}`,
        `smile 점수: ${s.smileScore.toFixed(2)} / 5.00`,
        `  - 기준: 0점 시작, smile 횟수당 2점 가점, 최대 5점`,
        `  - 횟수: ${s.smileCount}`,
        `입 습관 점수: ${s.mouthHabitPenaltyScore.toFixed(2)} / 시작 5.00`,
        `  - jawOpen=${s.jawOpenCount}, pucker=${s.puckerCount}, funnel=${s.funnelCount}`,
        `머리 움직임 점수: ${s.headMovePenaltyScore.toFixed(2)} / 시작 5.00`,
        `  - yaw=${s.yawCount}, pitch(pinch)=${s.pitchCount}`,
        `눈썹 찡그림 점수: ${s.browFrownPenaltyScore.toFixed(2)} / 감점`,
        `  - 기준: browFrown time 1초당 2점 감점`,
        `  - 누적 시간: ${s.browFrownSeconds.toFixed(2)}초`,
        ``,
        `총점: ${s.totalScore.toFixed(2)}`
    ].join("\n");
}

/* -------------------------
 * 텍스트 F
 * ------------------------- */
function buildTextFScoreSnapshot(metricsRaw) {
    const m = normalizeMetricsInput(metricsRaw);
    const browFrownPenaltyScore = clampScore(2 + (m.browFrownSeconds * -1), -4, 2);

    let mouthCornerScore = clampScore(m.bothLowSeconds * 0.5, 0, 5);
    mouthCornerScore = clampScore(mouthCornerScore + m.jawOpenSmileMs * 2, 0, 5);

    const gazeYScore = clampScore(5 - (m.gazeYHighSeconds * 0.5), 0, 5);
    const gazeXScore = clampScore(3 - ((m.gazeXCount - 1) * 0.1), 0, 3);
    const smileScore = 0;

    const mouthHabitPenaltyScore = clampScore(
        3 - (m.puckerCount * 0.3),
        -5,
        3
    );

    if (m.yawCount < 3) m.yawCount = 0;
    else m.yawCount -= 2;
    if (m.pitchCount < 3) m.pitchCount = 0;
    else m.pitchCount -= 2;
    if (m.blinkCount < 4) m.blinkCount = 0;
    else m.blinkCount -= 3;

    const headMovePenaltyScore = clampScore(
        3 - ((m.yawCount + m.pitchCount) * 0.3),
        -5,
        3
    );

    const blinkScore = clampScore(1 + m.blinkCount * -0.3, -2, 1);

    const totalScore =
        mouthCornerScore +
        gazeYScore +
        gazeXScore +
        smileScore +
        blinkScore +
        mouthHabitPenaltyScore +
        headMovePenaltyScore;

    return {
        ...m,
        mouthCornerScore,
        gazeYScore,
        gazeXScore,
        smileScore,
        blinkScore,
        mouthHabitPenaltyScore,
        headMovePenaltyScore,
        browFrownPenaltyScore,
        totalScore
    };
}

function formatTextF(snapshot) {
    const s = snapshot;
    return [
        `텍스트F 점수`,
        `상태: 계산 완료`,
        ``,
        `입꼬리 점수: ${s.mouthCornerScore.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, 양쪽 smileL/smileR 값 모두 0 초과 누적시간 초당 0.5점 감점`,
        `  - 누적 시간: ${s.bothLowSeconds.toFixed(2)}초`,
        `gazeY 점수: ${s.gazeYScore.toFixed(2)} / 6.00`,
        `  - 기준: 6점 시작, gazeY 0.2 초과 누적시간 초당 0.5점 감점`,
        `  - 누적 시간: ${s.gazeYHighSeconds.toFixed(2)}초`,
        `gazeX 점수: ${s.gazeXScore.toFixed(2)} / 3.00`,
        `  - 기준: 3점 시작, gazeX 횟수당 0.1점 감점`,
        `  - 횟수: ${s.gazeXCount}`,
        `smile 점수: ${s.smileScore.toFixed(2)} / 3.00`,
        `  - 기준: 0점 시작, smile 횟수당 1점 가점, 최대 3점`,
        `  - 횟수: ${s.smileCount}`,
        `입 습관 점수: ${s.mouthHabitPenaltyScore.toFixed(2)} / 시작 3.00`,
        `  - jawOpen=${s.jawOpenCount}, pucker=${s.puckerCount}, funnel=${s.funnelCount}`,
        `머리 움직임 점수: ${s.headMovePenaltyScore.toFixed(2)} / 시작 3.00`,
        `  - yaw=${s.yawCount}, pitch(pinch)=${s.pitchCount}`,
        `눈썹 찡그림 점수: ${s.browFrownPenaltyScore.toFixed(2)} / 감점`,
        `  - 기준: browFrown time 1초당 2점 감점`,
        `  - 누적 시간: ${s.browFrownSeconds.toFixed(2)}초`,
        ``,
        `총점: ${s.totalScore.toFixed(2)}`
    ].join("\n");
}

/* -------------------------
 * 텍스트 G
 * ------------------------- */
function buildTextGScoreSnapshot(audioAnalysisRaw) {
    const audioAnalysis = audioAnalysisRaw && typeof audioAnalysisRaw === "object"
        ? audioAnalysisRaw
        : {};

    const silenceSegments = Array.isArray(audioAnalysis.silenceSegments)
        ? audioAnalysis.silenceSegments
        : [];
    const trailingFadeSegments = Array.isArray(audioAnalysis.trailingFadeSegments)
        ? audioAnalysis.trailingFadeSegments
        : [];
    const tensionSegments = Array.isArray(audioAnalysis.tensionSegments)
        ? audioAnalysis.tensionSegments
        : [];
    const lowVoiceSegments = Array.isArray(audioAnalysis.lowVoiceSegments)
        ? audioAnalysis.lowVoiceSegments
        : [];

    const silence2Count = countSegmentsAtLeast(silenceSegments, 2);
    const silence3Count = countSegmentsAtLeast(silenceSegments, 3);
    const trailingFadeSeconds = getSegmentDurationSeconds(trailingFadeSegments);
    const tensionSeconds = getSegmentDurationSeconds(tensionSegments);
    const lowVoiceSeconds = getSegmentDurationSeconds(lowVoiceSegments);

    const silence2Score = clampScore(5 - silence2Count * 3, 0, 5);
    const silence3Score = clampScore(5 - silence3Count * 5, 0, 5);
    const trailingFadeScore = clampScore(5 - trailingFadeSeconds * 3, 0, 5);
    const tensionScore = clampScore(5 - tensionSeconds * 3, 0, 5);
    const lowVoiceScore = clampScore(5 - lowVoiceSeconds * 3, 0, 5);

    const totalScore =
        silence2Score +
        silence3Score +
        trailingFadeScore +
        tensionScore +
        lowVoiceScore;

    return {
        silence2Count,
        silence3Count,
        trailingFadeSeconds,
        tensionSeconds,
        lowVoiceSeconds,
        silence2Score,
        silence3Score,
        trailingFadeScore,
        tensionScore,
        lowVoiceScore,
        totalScore
    };
}

function formatTextG(snapshot) {
    const s = snapshot;
    return [
        `텍스트G 음성 점수`,
        `상태: 계산 완료`,
        ``,
        `2초 이상 침묵 점수: ${s.silence2Score.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, 2초 이상 침묵 횟수당 3점 감점`,
        `  - 횟수: ${s.silence2Count}`,
        `3초 이상 침묵 점수: ${s.silence3Score.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, 3초 이상 침묵 횟수당 5점 감점`,
        `  - 횟수: ${s.silence3Count}`,
        `말끝흐림 점수: ${s.trailingFadeScore.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, 말끝흐림 추정구간 초당 3점 감점`,
        `  - 누적 시간: ${s.trailingFadeSeconds.toFixed(2)}초`,
        `긴장 점수: ${s.tensionScore.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, 긴장 추정구간 초당 3점 감점`,
        `  - 누적 시간: ${s.tensionSeconds.toFixed(2)}초`,
        `목소리 작음 점수: ${s.lowVoiceScore.toFixed(2)} / 5.00`,
        `  - 기준: 5점 시작, 목소리 작은구간 초당 3점 감점`,
        `  - 누적 시간: ${s.lowVoiceSeconds.toFixed(2)}초`,
        ``,
        `[추가 음성 점수 요약]`,
        `2초 이상 침묵 횟수: ${s.silence2Count}`,
        `3초 이상 침묵 횟수: ${s.silence3Count}`,
        `2초 이상 침묵 점수: ${s.silence2Score.toFixed(2)} / 5.00`,
        `3초 이상 침묵 점수: ${s.silence3Score.toFixed(2)} / 5.00`,
        `말끝흐림 시간: ${s.trailingFadeSeconds.toFixed(2)}초`,
        `긴장 시간: ${s.tensionSeconds.toFixed(2)}초`,
        `목소리 작은구간 시간: ${s.lowVoiceSeconds.toFixed(2)}초`,
        ``,
        `총점: ${s.totalScore.toFixed(2)}`
    ].join("\n");
}

function buildSpeechInsightsDisplayText(baseText, snapshot) {
    const base = String(baseText || "").trim();

    if (!snapshot || !snapshot.totalScore) {
        return base || "음성 인사이트를 불러오지 못했습니다.";
    }

    const s = snapshot;
    const extra = [
        `[추가 음성 점수 요약]`,
        `2초 이상 침묵 횟수: ${s.silence2Count}`,
        `3초 이상 침묵 횟수: ${s.silence3Count}`,
        `2초 이상 침묵 점수: ${s.silence2Score.toFixed(2)} / 5.00`,
        `3초 이상 침묵 점수: ${s.silence3Score.toFixed(2)} / 5.00`,
        `말끝흐림 점수: ${s.trailingFadeScore.toFixed(2)} / 5.00 (누적 ${s.trailingFadeSeconds.toFixed(2)}초)`,
        `긴장 점수: ${s.tensionScore.toFixed(2)} / 5.00 (누적 ${s.tensionSeconds.toFixed(2)}초)`,
        `목소리 작은구간 점수: ${s.lowVoiceScore.toFixed(2)} / 5.00 (누적 ${s.lowVoiceSeconds.toFixed(2)}초)`,
        `텍스트G 총점: ${s.totalScore.toFixed(2)}`
    ].join("\n");

    return base ? `${base}\n\n${extra}` : extra;
}

/* -------------------------
 * OpenAI prompt
 * ------------------------- */
function setDefaultPromptText() {
    return `너는 면접 답변 코치다.
아래 정보를 모두 참고해 한국어로 분석해라.

반드시 함께 고려할 정보:
1. 면접 질문은 지원동기를 소개하세요
2. 면접 답변 텍스트

출력 형식:
1. 전체 평가 점수(20점 만점)
2. 감점 요인
3. 가장 먼저 고칠 1가지

최대한 간결하게 작성해라.`;
}

function buildAnalyzePrompt({ customPrompt, transcript, speechInsights }) {
    return [
        String(customPrompt || "").trim() || setDefaultPromptText(),
        "",
        "[답변 텍스트]",
        String(transcript || "").trim() || "(없음)",
        "",
        "[음성 인사이트]",
        String(speechInsights || "").trim() || "(없음)"
    ].join("\n");
}

/* -------------------------
 * 외부 API 호출
 * ------------------------- */
function buildBearerHeaders(apiKey) {
    if (!apiKey) return {};
    return { Authorization: `Bearer ${apiKey}` };
}

async function sendAudioToExternalTranscriber(audioFilePath, originalName) {
    const endpoint = process.env.TRANSCRIBE_API_URL;
    if (!endpoint) {
        return {
            transcript: "",
            raw: { warning: "TRANSCRIBE_API_URL not set" }
        };
    }

    const buffer = fs.readFileSync(audioFilePath);
    const blob = new Blob([buffer], { type: guessMimeFromFilename(originalName || audioFilePath) });
    const form = new FormData();
    form.append("audio", blob, originalName || path.basename(audioFilePath));

    const response = await fetch(endpoint, {
        method: "POST",
        headers: buildBearerHeaders(process.env.TRANSCRIBE_API_KEY),
        body: form
    });

    const rawText = await response.text();
    let data = {};
    try {
        data = JSON.parse(rawText);
    } catch {
        data = { rawText };
    }

    if (!response.ok) {
        throw new Error(data?.error || data?.message || `transcribe_failed_${response.status}`);
    }

    return {
        transcript: data?.transcript || data?.text || data?.result || "",
        raw: data
    };
}

async function callOpenAIIfRequested(prompt) {
    if (!openai) {
        return {
            skipped: true,
            reason: "OPENAI_API_KEY 미설정",
            result: ""
        };
    }

    const response = await openai.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5",
        input: prompt
    });

    return {
        skipped: false,
        result: response.output_text || ""
    };
}

/* -------------------------
 * forwarding page
 * ------------------------- */
function renderForwardPage(id, item) {
    const captureImageUrl = String(item?.captureImageUrl || "");
    const textDScore = item?.textDSnapshot || {};
    const textFScore = item?.textFSnapshot || {};
    const textGScore = item?.textGSnapshot || {};

    function toFixedScore(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n.toFixed(1) : "0.0";
    }

    function clampBar(v, max) {
        const n = Number(v);
        if (!Number.isFinite(n) || max <= 0) return 0;
        return Math.max(0, Math.min(100, (n / max) * 100));
    }

    function formatSignedScore(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return "0.0점";
        return `${n >= 0 ? "+" : ""}${n.toFixed(1)}점`;
    }

    function formatPenaltyFromMax(score, max) {
        const s = Number(score);
        const m = Number(max);
        if (!Number.isFinite(s) || !Number.isFinite(m)) return "(-0점)";
        const diff = s - m;
        if (diff >= 0) return "(0점)";
        return `(${diff.toFixed(1)}점)`;
    }

    function buildScoreItemsFromConfig(scoreObj, config) {
        return config.map((entry, index) => {
            const score = Number(scoreObj?.[entry.key] || 0);
            const max = Number(entry.max || 0);
            const ratio = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
            const percent = ratio * 100;

            let message = entry.messages?.[2] || "";
            if (percent >= 80) message = entry.messages?.[0] || message;
            else if (percent >= 60) message = entry.messages?.[1] || message;

            return {
                ...entry,
                index,
                score,
                max,
                ratio,
                percent,
                diffFromMax: score - max,
                message
            };
        });
    }

    function pickHighlightItems(scoreItems) {
        const lowItems = [...scoreItems]
            .sort((a, b) => (a.ratio - b.ratio) || (a.index - b.index))
            .slice(0, 2)
            .map(item => ({ ...item, tone: "low" }));

        const lowKeySet = new Set(lowItems.map(item => item.key));

        const highItem = [...scoreItems]
            .filter(item => !lowKeySet.has(item.key))
            .sort((a, b) => (b.ratio - a.ratio) || (a.index - b.index))[0] || null;

        return [...lowItems, ...(highItem ? [{ ...highItem, tone: "high" }] : [])];
    }

    function pickLowestImprovement(scoreItems) {
        const worst = [...scoreItems]
            .sort((a, b) => (a.ratio - b.ratio) || (a.index - b.index))[0];

        if (!worst) return null;

        return {
            label: worst.label,
            score: worst.score,
            max: worst.max,
            ratio: worst.ratio,
            message: worst.message
        };
    }

    function renderCompactScoreRow(item) {
        return `
          <div class="score-compact-row">
            <div class="score-compact-label">${escapeHtml(item.label)}</div>
            <div class="score-compact-value">${toFixedScore(item.score)} / ${toFixedScore(item.max)}</div>
          </div>
        `;
    }

    function renderInsightCard(item) {
        return `
          <div class="insight-card ${item.tone === "high" ? "high" : "low"}">
            <div class="insight-head">
              <div class="insight-label">${escapeHtml(item.label)}</div>
              <div class="insight-score">${toFixedScore(item.score)} / ${toFixedScore(item.max)} <span class="insight-diff">(${formatSignedScore(item.diffFromMax)})</span></div>
            </div>
            <div class="insight-message">${escapeHtml(item.message || "")}</div>
          </div>
        `;
    }

    function renderScoreCard({ title, totalScore, totalMax, scoreItems, dangerThreshold = 0 }) {
        const highlightItems = pickHighlightItems(scoreItems);
        const totalBarClass = Number(totalScore || 0) < dangerThreshold
            ? "score-bar-fill danger"
            : "score-bar-fill";

        return `
          <section class="first-impression-card">
            <div class="first-impression-title">${escapeHtml(title)}</div>

            <div class="score-total-row">
              <div class="score-total-text">
                총점 ${toFixedScore(totalScore)}점 / ${toFixedScore(totalMax)}점
              </div>
              <div class="score-right">
                <div class="score-bar-track">
                  <div class="${totalBarClass}" style="width:${clampBar(totalScore, totalMax)}%"></div>
                </div>
              </div>
            </div>

            <div class="score-compact-list">
              ${scoreItems.map(renderCompactScoreRow).join("")}
            </div>

            <div class="insight-list">
              ${highlightItems.map(renderInsightCard).join("")}
            </div>
          </section>
        `;
    }

    const firstImpressionItems = buildScoreItemsFromConfig(textDScore, [
        {
            key: "mouthCornerScore",
            label: "스마일 점수",
            max: 11,
            messages: [
                "밝은 미소가 형성되어 있어 면접관에게 긍정적인 인상을 줍니다.",
                "과하지 않은 자연스러운 미소로 안정적인 이미지를 유지하고 있습니다.",
                "미소 표현이 다소 부족하여, 표정 활용을 의식적으로 늘릴 필요가 있습니다."
            ]
        },
        {
            key: "gazeYScore",
            label: "시선 점수",
            max: 11,
            messages: [
                "시선이 잘 맞아 신뢰감이 높습니다.",
                "시선 처리가 전반적으로 무난합니다.",
                "시선을 더 안정적으로 맞추는 연습이 필요합니다."
            ]
        },
        {
            key: "gazeXScore",
            label: "시선 흔들림",
            max: 5,
            messages: [
                "시선이 안정되어 집중력이 좋아 보입니다.",
                "시선 흔들림이 크지 않아 무난합니다.",
                "좌우 시선 흔들림을 더 줄일 필요가 있습니다."
            ]
        },
        {
            key: "mouthHabitPenaltyScore",
            label: "입습관",
            max: 5,
            messages: [
                "입 주변 습관이 적어 전달력이 좋습니다.",
                "입습관이 크지 않아 비교적 안정적입니다.",
                "입습관을 줄이면 인상이 더 깔끔해집니다."
            ]
        },
        {
            key: "headMovePenaltyScore",
            label: "고개 움직임",
            max: 5,
            messages: [
                "고개 움직임이 안정적이라 차분해 보입니다.",
                "머리 움직임이 대체로 무난합니다.",
                "고개 움직임을 조금 더 줄일 필요가 있습니다."
            ]
        },
        {
            key: "blinkScore",
            label: "눈깜빡임",
            max: 3,
            messages: [
                "눈깜빡임이 안정적이라 침착한 인상입니다.",
                "눈깜빡임이 무난한 수준입니다.",
                "눈깜빡임 빈도를 조금 더 안정화할 필요가 있습니다."
            ]
        }
    ]);

    const textFItems = buildScoreItemsFromConfig(textFScore, [
        {
            key: "mouthCornerScore",
            label: "스마일 점수",
            max: 5,
            messages: [
                "미소 유지가 좋아 표정 전달력이 안정적입니다.",
                "표정이 비교적 무난하게 유지됩니다.",
                "미소 유지 시간이 더 필요합니다."
            ]
        },
        {
            key: "gazeYScore",
            label: "시선 점수",
            max: 5,
            messages: [
                "정면 시선이 안정적입니다.",
                "시선 처리가 무난합니다.",
                "시선이 아래로 빠지는 구간을 줄일 필요가 있습니다."
            ]
        },
        {
            key: "gazeXScore",
            label: "좌우 시선 안정",
            max: 3,
            messages: [
                "좌우 시선 이동이 적어 안정적입니다.",
                "좌우 시선이 대체로 무난합니다.",
                "좌우 시선 흔들림을 조금 더 줄여야 합니다."
            ]
        },
        {
            key: "mouthHabitPenaltyScore",
            label: "입모양 습관",
            max: 3,
            messages: [
                "입모양 습관이 적어 깔끔합니다.",
                "입모양 습관이 심하지 않습니다.",
                "불필요한 입모양 습관을 줄이면 더 좋습니다."
            ]
        },
        {
            key: "headMovePenaltyScore",
            label: "머리 흔들림",
            max: 3,
            messages: [
                "머리 움직임이 안정적입니다.",
                "머리 움직임이 무난한 수준입니다.",
                "머리 흔들림을 더 줄일 필요가 있습니다."
            ]
        },
        {
            key: "blinkScore",
            label: "눈깜빡임 안정",
            max: 1,
            messages: [
                "눈깜빡임이 잘 통제되고 있습니다.",
                "눈깜빡임이 대체로 무난합니다.",
                "눈깜빡임 빈도를 조금 더 조절하면 좋습니다."
            ]
        }
    ]);

    const textGItems = buildScoreItemsFromConfig(textGScore, [
        {
            key: "silence3Score",
            label: "긴 침묵 제어",
            max: 5,
            messages: [
                "긴 침묵이 거의 없어 흐름이 좋습니다.",
                "침묵 구간이 아주 크지 않습니다.",
                "3초 이상 멈춤 구간을 줄여야 합니다."
            ]
        },
        {
            key: "trailingFadeScore",
            label: "말끝 흐림",
            max: 5,
            messages: [
                "말끝이 또렷해 전달력이 좋습니다.",
                "말끝 흐림이 심하지 않습니다.",
                "말끝이 흐려지는 구간을 줄일 필요가 있습니다."
            ]
        },
        {
            key: "tensionScore",
            label: "긴장도",
            max: 5,
            messages: [
                "긴장도가 안정적입니다.",
                "긴장 구간이 비교적 무난합니다.",
                "긴장으로 추정되는 구간을 줄여야 합니다."
            ]
        },
        {
            key: "lowVoiceScore",
            label: "작은 목소리",
            max: 5,
            messages: [
                "목소리 크기가 안정적입니다.",
                "작은 목소리 구간이 많지 않습니다.",
                "작은 목소리 구간을 줄일 필요가 있습니다."
            ]
        }
    ]);

    const totalD = Number(textDScore.totalScore || 0);
    const totalF = Number(textFScore.totalScore || 0);
    const totalG = Number(textGScore.totalScore || 0);
    const overallTotal = totalD + totalF + totalG;

    const overallImproveItems = [
        {
            sectionTitle: "첫인상분석",
            totalScore: totalD,
            totalMax: 40,
            detail: pickLowestImprovement(firstImpressionItems)
        },
        {
            sectionTitle: "텍스트F",
            totalScore: totalF,
            totalMax: 20,
            detail: pickLowestImprovement(textFItems)
        },
        {
            sectionTitle: "텍스트G",
            totalScore: totalG,
            totalMax: 20,
            detail: pickLowestImprovement(textGItems)
        }
    ];

    function renderTrainingButton(index) {
        if (index === 0) {
            return `
              <a href="#" class="train-btn" data-training="smile">스마일 트레이닝</a>
            `;
        }
        if (index === 1) {
            return `
              <a href="#" class="train-btn" data-training="gaze">시선 트레이닝</a>
            `;
        }
        return "";
    }

    function renderOverallImproveItem(item, index) {
        const detail = item.detail || {
            label: "개선 포인트 없음",
            score: 0,
            max: 0,
            message: "현재 표시할 개선 포인트가 없습니다."
        };

        return `
          <div class="overall-improve-item">
            <div class="overall-improve-head">
              <div class="overall-improve-section">${escapeHtml(item.sectionTitle)}</div>
              <div class="overall-improve-total">${toFixedScore(item.totalScore)} / ${toFixedScore(item.totalMax)}</div>
            </div>
            <div class="overall-improve-label">${escapeHtml(detail.label)} <span class="overall-improve-penalty">${escapeHtml(formatPenaltyFromMax(detail.score, detail.max))}</span></div>
            <div class="overall-improve-message">${escapeHtml(detail.message || "")}</div>
            <div class="overall-improve-actions">
              ${renderTrainingButton(index)}
            </div>
          </div>
        `;
    }

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>면접관 관점 분석 페이지</title>
  <style>
    :root {
      --bg-1: #f7fbff;
      --bg-2: #e8f2ff;
      --bg-3: #dcecff;
      --navy: #162a5f;
      --blue: #2f73d9;
      --orange: #ff9b47;
      --text: #223253;
      --muted: #6c7a98;
      --shadow-lg: 0 18px 34px rgba(24,42,92,0.12);
      --shadow-md: 0 12px 24px rgba(24,42,92,0.09);
      --shadow-sm: 0 8px 18px rgba(24,42,92,0.07);
      --radius-2xl: 28px;
      --radius-xl: 22px;
      --radius-lg: 18px;
      --page-max: 520px;
    }
    * { box-sizing: border-box; min-width: 0; }
    html {
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
      background: linear-gradient(180deg, var(--bg-1), var(--bg-2) 42%, var(--bg-3));
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Pretendard","Noto Sans KR",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      color: var(--text);
      background: linear-gradient(180deg, var(--bg-1), var(--bg-2) 42%, var(--bg-3));
    }
    .page {
      width: 100%;
      min-height: 100vh;
      padding: 20px 14px 32px;
      display: flex;
      justify-content: center;
    }
    .content {
      width: 100%;
      max-width: var(--page-max);
      display: grid;
      gap: 16px;
    }
    .hero {
      padding: 24px 20px;
      border-radius: var(--radius-2xl);
      color: #fff;
      background: linear-gradient(135deg, #2f73d9 0%, #76adff 55%, #9ec5ff 100%);
      box-shadow: var(--shadow-lg);
    }
    .hero h1 {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.2;
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .hero p {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      opacity: 0.96;
      font-weight: 700;
    }
    .hero-id {
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 800;
      opacity: 0.9;
    }
    .section {
      background: rgba(255,255,255,0.96);
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-lg);
      padding: 18px;
      overflow: hidden;
    }
    .section-title {
      margin: 0 0 12px;
      font-size: 18px;
      line-height: 1.35;
      color: var(--navy);
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    .ba-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .ba-card {
      position: relative;
      background: #f8fbff;
      border-radius: 22px;
      padding: 12px;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.06);
    }
    .ba-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
      padding: 7px 12px;
      border-radius: 999px;
      background: rgba(47,115,217,0.12);
      color: var(--blue);
      font-size: 12px;
      font-weight: 900;
    }
    .ba-badge.orange {
      background: rgba(255,155,71,0.14);
      color: #e46f00;
    }
    .ba-thumb {
      position: relative;
      aspect-ratio: 2 / 3;
      border-radius: 16px;
      overflow: hidden;
      background: #eef4ff;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
    }
    .ba-thumb canvas,
    .ba-thumb img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      background: #eef4ff;
    }
    .ba-placeholder {
      position: absolute;
      inset: 0;
      z-index: 4;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 16px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
      font-weight: 800;
      background: linear-gradient(180deg, rgba(247,251,255,0.8), rgba(234,242,255,0.8));
    }
    .ba-overlay {
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 8;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(22,42,95,0.88);
      color: #fff;
      font-size: 12px;
      font-weight: 900;
      backdrop-filter: blur(8px);
    }
    .info-badge {
      position: absolute;
      right: 12px;
      top: 12px;
      z-index: 8;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.94);
      color: var(--navy);
      font-size: 12px;
      font-weight: 900;
      box-shadow: var(--shadow-sm);
    }
    .btn-main {
      appearance: none;
      border: 0;
      outline: none;
      cursor: pointer;
      width: 100%;
      min-height: 46px;
      padding: 12px 14px;
      border-radius: 14px;
      background: linear-gradient(180deg, #76adff 0%, #2f73d9 100%);
      color: #fff;
      font-size: 14px;
      font-weight: 900;
      box-shadow: 0 12px 22px rgba(47,115,217,0.22);
    }
    .text-box {
      width: 100%;
      min-height: 110px;
      resize: vertical;
      border: 0;
      outline: none;
      border-radius: 16px;
      padding: 14px;
      background: #f7fbff;
      color: var(--text);
      font-size: 13px;
      line-height: 1.65;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
      font-family: inherit;
    }

    .overall-summary-card {
      background: linear-gradient(180deg, #ffffff 0%, #f4f9ff 100%);
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-lg);
      padding: 18px;
      overflow: hidden;
      border: 1px solid rgba(47,115,217,0.08);
    }
    .overall-summary-title {
      margin: 0 0 12px;
      font-size: 20px;
      line-height: 1.3;
      color: var(--navy);
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    .overall-summary-top {
      display: grid;
      grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
      padding: 14px;
      border-radius: 18px;
      background: linear-gradient(180deg, #edf6ff 0%, #e3f0ff 100%);
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
    }
    .overall-summary-score {
      font-size: 22px;
      line-height: 1.3;
      font-weight: 900;
      color: var(--navy);
      white-space: nowrap;
    }
    .overall-meta-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .overall-meta-box {
      padding: 10px 12px;
      border-radius: 14px;
      background: #f8fbff;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.06);
    }
    .overall-meta-label {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .overall-meta-value {
      font-size: 14px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--navy);
    }
    .overall-improve-title {
      margin: 6px 0 10px;
      font-size: 15px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--navy);
    }
    .overall-improve-list {
      display: grid;
      gap: 10px;
    }
    .overall-improve-item {
      padding: 12px 14px;
      border-radius: 16px;
      background: #f8fbff;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.06);
    }
    .overall-improve-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }
    .overall-improve-section {
      font-size: 13px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--blue);
    }
    .overall-improve-total {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--muted);
      white-space: nowrap;
    }
    .overall-improve-label {
      font-size: 14px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--navy);
      margin-bottom: 6px;
    }
    .overall-improve-penalty {
      color: #e33b3b;
      font-size: 13px;
      font-weight: 900;
    }
    .overall-improve-message {
      font-size: 13px;
      line-height: 1.55;
      font-weight: 800;
      color: var(--text);
    }
    .overall-improve-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 10px;
    }
    .train-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 8px 12px;
      border-radius: 999px;
      background: linear-gradient(180deg, #76adff 0%, #2f73d9 100%);
      color: #fff;
      text-decoration: none;
      font-size: 12px;
      font-weight: 900;
      box-shadow: 0 8px 16px rgba(47,115,217,0.18);
    }

    .first-impression-card {
      background: rgba(255,255,255,0.96);
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-lg);
      padding: 18px;
      overflow: hidden;
    }
    .first-impression-title {
      margin: 0 0 14px;
      font-size: 20px;
      line-height: 1.3;
      color: var(--navy);
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    .score-total-row {
      display: grid;
      grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
      padding: 14px;
      border-radius: 18px;
      background: linear-gradient(180deg, #f6fbff 0%, #eef6ff 100%);
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
    }
    .score-total-text {
      font-size: 18px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--navy);
      white-space: nowrap;
    }
    .score-right {
      min-width: 0;
    }
    .score-bar-track {
      width: 100%;
      height: 12px;
      border-radius: 999px;
      background: #dfe9f8;
      overflow: hidden;
      box-shadow: inset 0 1px 2px rgba(20,40,80,0.08);
    }
    .score-bar-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #76adff 0%, #2f73d9 100%);
    }
    .score-bar-fill.danger {
      background: linear-gradient(90deg, #ff8d8d 0%, #e33b3b 100%);
    }
    .score-compact-list {
      display: grid;
      gap: 6px;
      margin-top: 2px;
    }
    .score-compact-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 12px;
      background: #f8fbff;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.05);
    }
    .score-compact-label {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
      color: var(--navy);
    }
    .score-compact-value {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
      color: var(--muted);
      white-space: nowrap;
    }
    .insight-list {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }
    .insight-card {
      padding: 12px 14px;
      border-radius: 16px;
      background: #f8fbff;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.06);
    }
    .insight-card.low {
      background: linear-gradient(180deg, #fff6f6 0%, #fff1f1 100%);
      box-shadow: inset 0 0 0 1px rgba(227,59,59,0.09);
    }
    .insight-card.high {
      background: linear-gradient(180deg, #f5fbff 0%, #edf6ff 100%);
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.09);
    }
    .insight-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }
    .insight-label {
      font-size: 13px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--navy);
    }
    .insight-score {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--muted);
      white-space: nowrap;
      text-align: right;
    }
    .insight-diff {
      color: #8a97b4;
    }
    .insight-message {
      font-size: 13px;
      line-height: 1.55;
      font-weight: 800;
      color: var(--text);
    }

    @media (max-width: 560px) {
      .ba-grid,
      .score-total-row,
      .overall-summary-top {
        grid-template-columns: 1fr;
      }
      .overall-meta-row {
        grid-template-columns: 1fr;
      }
      .score-total-text,
      .overall-summary-score {
        white-space: normal;
      }
      .score-compact-row,
      .insight-head,
      .overall-improve-head {
        display: block;
      }
      .score-compact-value,
      .insight-score,
      .overall-improve-total {
        margin-top: 4px;
        white-space: normal;
        text-align: left;
      }
      .overall-improve-actions {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="content">

      <section class="hero">
        <h1>종합 분석 결과</h1>
        <p>부족한 부분은 바로 훈련을 통하여 점수를 높이세요</p>
        <div class="hero-id">ID: ${escapeHtml(id)}</div>
      </section>

      <section class="overall-summary-card">
        <div class="overall-summary-title">최종 종합 점수</div>

        <div class="overall-summary-top">
          <div class="overall-summary-score">
            ${toFixedScore(overallTotal)}점 / 80점
          </div>
          <div class="score-right">
            <div class="score-bar-track">
              <div class="${overallTotal < 40 ? "score-bar-fill danger" : "score-bar-fill"}" style="width:${clampBar(overallTotal, 80)}%"></div>
            </div>
          </div>
        </div>

        <div class="overall-meta-row">
          <div class="overall-meta-box">
            <div class="overall-meta-label">첫인상분석</div>
            <div class="overall-meta-value">${toFixedScore(totalD)} / 40</div>
          </div>
          <div class="overall-meta-box">
            <div class="overall-meta-label">텍스트F</div>
            <div class="overall-meta-value">${toFixedScore(totalF)} / 20</div>
          </div>
          <div class="overall-meta-box">
            <div class="overall-meta-label">텍스트G</div>
            <div class="overall-meta-value">${toFixedScore(totalG)} / 20</div>
          </div>
        </div>

        <div class="overall-improve-title">지금 가장 먼저 고칠 개선사항</div>
        <div class="overall-improve-list">
          ${overallImproveItems.map((item, index) => renderOverallImproveItem(item, index)).join("")}
        </div>
      </section>

      <section class="section">
        <div class="section-title">Before / After</div>

        <div class="ba-grid">
          <div class="ba-card">
            <span class="ba-badge">Before</span>
            <div class="ba-thumb">
              <canvas id="originalCanvas" width="2208" height="3306"></canvas>
              ${captureImageUrl
            ? `<img id="beforeSourceImage" src="${escapeAttr(captureImageUrl)}" alt="교정 전 면접 인상" crossorigin="anonymous" />`
            : `<div class="ba-placeholder">클라이언트에서 전달된 before 이미지가 아직 없습니다.</div>`}
              <div class="ba-overlay">현재 인상</div>
            </div>
          </div>

          <div class="ba-card">
            <span class="ba-badge orange">After</span>
            <div class="ba-thumb">
              <canvas id="previewCanvas" width="2208" height="3306"></canvas>
              <div id="afterPlaceholder" class="ba-placeholder">after 이미지를 비동기로 생성하는 중입니다.</div>
              <div id="infoBadge" class="info-badge">이미지 로딩중.</div>
              <div class="ba-overlay">합격-UP 인상</div>
            </div>
            <button id="renderBtn" class="btn-main" type="button">합격 UP! 인상 확인</button>
          </div>
        </div>
      </section>

      ${renderScoreCard({
                title: "첫인상 분석 점수",
                totalScore: totalD,
                totalMax: 40,
                scoreItems: firstImpressionItems,
                dangerThreshold: 15
            })}

      ${renderScoreCard({
                title: "텍스트F 분석 점수",
                totalScore: totalF,
                totalMax: 20,
                scoreItems: textFItems,
                dangerThreshold: 8
            })}

      ${renderScoreCard({
                title: "텍스트G 음성 분석 점수",
                totalScore: totalG,
                totalMax: 20,
                scoreItems: textGItems,
                dangerThreshold: 8
            })}

      <section class="section">
        <div class="section-title">상태</div>
        <textarea id="status" class="text-box" readonly>페이지 초기화중.</textarea>
      </section>

      <section class="section">
        <div class="section-title">OpenAI 프롬프트</div>
        <textarea id="promptBox" class="text-box">${escapeHtml(item.prompt || "")}</textarea>
      </section>

      <section class="section">
        <div class="section-title">OpenAI 분석 결과</div>
        <textarea id="resultBox" class="text-box" readonly>${escapeHtml(item.result || "")}</textarea>
        <button id="analyzeBtn" class="btn-main" type="button">OpenAI 분석 실행</button>
      </section>

      <section class="section">
        <div class="section-title">디버그 로그</div>
        <textarea id="debugBox" class="text-box" readonly>${escapeHtml(item.debugLog || "")}</textarea>
      </section>
    </div>
  </div>

  <script>
    window.__FORWARDING_ID__ = ${safeSerializeForInlineScript(id)};
    window.__AFTERIMG_DATA__ = ${safeSerializeForInlineScript({
                forwardingId: id,
                captureImageUrl: item.captureImageUrl || "",
                beforeImageUrl: item.captureImageUrl || "",
                imageUrl: item.captureImageUrl || "",
                originalImageUrl: item.captureImageUrl || "",
                landmarks: item.landmarks || [],
                faceLandmarks: item.landmarks || [],
                blendshapes: item.blendshapes || [],
                faceBlendshapes: item.blendshapes || [],
                facialMatrixes: item.facialMatrixes || [],
                facialTransformationMatrixes: item.facialMatrixes || [],
                debug: {
                    landmarksCount: Array.isArray(item.landmarks) ? item.landmarks.length : 0,
                    blendshapesCount: Array.isArray(item.blendshapes) ? item.blendshapes.length : 0,
                    facialMatrixesCount: Array.isArray(item.facialMatrixes) ? item.facialMatrixes.length : 0
                }
            })};

    window.analysisBootstrap = {
      previewCanvasId: "previewCanvas",
      originalCanvasId: "originalCanvas",
      statusId: "status",
      infoBadgeId: "infoBadge",
      afterPlaceholderId: "afterPlaceholder",
      renderBtnId: "renderBtn"
    };
  </script>

  <script src="/forward/${encodeURIComponent(id)}/afterimg.js"></script>

  <script>
    const analyzeBtn = document.getElementById("analyzeBtn");
    const promptBox = document.getElementById("promptBox");
    const resultBox = document.getElementById("resultBox");
    const statusBox = document.getElementById("status");
    const debugBox = document.getElementById("debugBox");


    analyzeBtn?.addEventListener("click", async () => {
      const prompt = (promptBox?.value || "").trim();

      if (!prompt) {
        statusBox.value = "프롬프트를 입력하세요.";
        promptBox.focus();
        return;
      }

      try {
        analyzeBtn.disabled = true;
        statusBox.value = "OpenAI 분석 중입니다.";
        resultBox.value = "";

        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            prompt,
            transcript: ${safeSerializeForInlineScript(item.transcript || "")},
            speechInsights: ${safeSerializeForInlineScript(item.speechInsights || "")},
            forwardingId: ${safeSerializeForInlineScript(id)}
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "analyze_failed");
        }

        resultBox.value = data.result || "";
        statusBox.value = "분석이 완료되었습니다.";
      } catch (err) {
        statusBox.value = "분석 실패: " + (err.message || "unknown_error");
        debugBox.value = ${safeSerializeForInlineScript(item.debugLog || "")};
      } finally {
        analyzeBtn.disabled = false;
      }
    });

    document.addEventListener("click", (e) => {
      const link = e.target.closest(".train-btn");
      if (!link) return;
      e.preventDefault();
      alert("트레이닝 링크는 아직 준비중입니다.");
    });
  </script>
</body>
</html>`;
}

router.get("/forward/:id", (req, res) => {
    const item = forwardingStore.get(req.params.id);

    if (!item) {
        return res
            .status(404)
            .type("text/plain; charset=utf-8")
            .send("forward data not found");
    }

    res.status(200);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(renderForwardPage(req.params.id, item));
});

router.get("/forward/:id/afterimg.js", (req, res) => {
    if (!fs.existsSync(afterImgModulePath)) {
        return res.status(404).send("// afterimg.js not found");
    }

    res.status(200);
    res.set("Content-Type", "application/javascript; charset=utf-8");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(fs.readFileSync(afterImgModulePath, "utf8"));
});

/* -------------------------
 * route: process
 * ------------------------- */
router.post(
    "/api/process",
    upload.fields([
        { name: "audio", maxCount: 1 },
        { name: "captureImage", maxCount: 1 }
    ]),
    async (req, res) => {
        let debugLines = [];

        try {
            const textA = String(req.body.textA || "");
            const textB = String(req.body.textB || "");
            const textC = String(req.body.textC || "");
            const textE = String(req.body.textE || "");
            const transcriptFromBody = String(req.body.transcript || "").trim();
            const speechInsightsFromBody = String(req.body.speechInsights || "").trim();
            const promptTextFromBody = String(req.body.promptText || "").trim();
            const customPrompt = String(req.body.prompt || "").trim();

            const audioFile = req.files?.audio?.[0] || null;
            const imageFile = req.files?.captureImage?.[0] || null;

            const landmarks =
                normalizeLandmarksPayload(req.body.faceLandmarksJson) ||
                normalizeLandmarksPayload(req.body.faceLandmarks) ||
                normalizeLandmarksPayload(req.body.landmarks) ||
                normalizeLandmarksPayload(req.body.multiFaceLandmarks) ||
                normalizeLandmarksPayload(req.body.landmarkResult) ||
                [];

            const blendshapes =
                normalizeBlendshapesPayload(req.body.faceBlendshapesJson) ||
                normalizeBlendshapesPayload(req.body.faceBlendshapes) ||
                normalizeBlendshapesPayload(req.body.blendshapes) ||
                [];

            const facialMatrixes =
                normalizeFacialMatrixesPayload(req.body.facialMatrixesJson) ||
                normalizeFacialMatrixesPayload(req.body.facialTransformationMatrixes) ||
                normalizeFacialMatrixesPayload(req.body.facialMatrixes) ||
                normalizeFacialMatrixesPayload(req.body.matrices) ||
                [];

            const textCMetrics = normalizeMetricsInput({
                ...parseMetricsFromText(textC),
                ...parseMetricsFromText(textB),
                ...buildMetricsFromBody(req.body, "textB"),
                ...(safeJsonParse(req.body.textBMetrics, null) || {}),
                ...(safeJsonParse(req.body.textCMetrics, null) || {})
            });

            const textEMetrics = normalizeMetricsInput({
                ...parseMetricsFromText(textE),
                ...buildMetricsFromBody(req.body, "textE"),
                ...(safeJsonParse(req.body.textEMetrics, null) || {})
            });

            const textDSnapshot = buildTextDScoreSnapshot(textCMetrics);
            const textFSnapshot = buildTextFScoreSnapshot(textEMetrics);
            const textD = formatTextD(textDSnapshot);
            const textF = formatTextF(textFSnapshot);

            debugLines.push("[process] textD/textF calculated");
            debugLines.push(`[process] landmarks=${Array.isArray(landmarks) ? landmarks.length : 0}`);
            debugLines.push(`[process] blendshapes=${Array.isArray(blendshapes) ? blendshapes.length : 0}`);
            debugLines.push(`[process] facialMatrixes=${Array.isArray(facialMatrixes) ? facialMatrixes.length : 0}`);

            let transcript = null;
            let transcribeRaw = null;

            if (audioFile) {
                debugLines.push(`[transcribe] start: ${audioFile.originalname}`);

                /*
                const transcribeResult = await sendAudioToExternalTranscriber(
                    audioFile.path,
                    audioFile.originalname
                );
                */
                const transcribeResult = "Audio Test";

                transcript = String(
                    transcribeResult?.text ||
                    transcribeResult?.transcript ||
                    transcriptFromBody ||
                    ""
                ).trim();

                transcribeRaw = transcribeResult?.raw ?? transcribeResult;
                debugLines.push(`[transcribe] success length=${transcript.length}`);
            } else {
                transcript = transcriptFromBody || "";
                debugLines.push("[transcribe] skipped");
            }

            const speechInsightsBaseText = promptTextFromBody || speechInsightsFromBody;
            const audioAnalysis = safeJsonParse(req.body.audioAnalysis, null) || {};
            const fillerAnalysis = normalizeFillerAnalysisPayload(req.body.fillerAnalysis);

            const hasBodyAudioAnalysis = hasMeaningfulAudioAnalysis(audioAnalysis);

            debugLines.push(`[speech-insights] promptText=${speechInsightsBaseText ? "yes" : "no"}`);
            debugLines.push(`[speech-insights] fillerAnalysis=${fillerAnalysis ? "yes" : "no"}`);
            debugLines.push(`[speech-insights] audioAnalysis=${hasBodyAudioAnalysis ? "yes" : "no"}`);

            const textGSnapshot = buildTextGScoreSnapshot(audioAnalysis || {});
            const textG = formatTextG(textGSnapshot);
            const speechInsights = buildSpeechInsightsDisplayText(
                speechInsightsBaseText,
                textGSnapshot
            );

            const finalPrompt = buildAnalyzePrompt({
                customPrompt,
                transcript,
                speechInsights
            });

            const captureImageUrl = imageFile
                ? `/uploads/${path.basename(imageFile.path)}`
                : "";

            const debugLog = [
                debugLines.join("\n"),
                "",
                "[debug.json]",
                JSON.stringify(
                    {
                        transcribeRaw,
                        audioAnalysis,
                        fillerAnalysis,
                        captureImageUrl,
                        landmarksCount: Array.isArray(landmarks) ? landmarks.length : 0,
                        blendshapesCount: Array.isArray(blendshapes) ? blendshapes.length : 0,
                        facialMatrixesCount: Array.isArray(facialMatrixes) ? facialMatrixes.length : 0
                    },
                    null,
                    2
                )
            ].join("\n");

            const forwardingId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

            forwardingStore.set(forwardingId, {
                createdAt: Date.now(),
                textA,
                textB,
                textC,
                textD,
                textDSnapshot,
                textE,
                textF,
                textFSnapshot,
                textG,
                textGSnapshot,
                transcript,
                speechInsights,
                prompt: finalPrompt,
                debugLog,
                result: "",
                captureImageUrl,
                landmarks: landmarks || [],
                blendshapes: blendshapes || [],
                facialMatrixes: facialMatrixes || []
            });

            return res.json({
                ok: true,
                forwardingId,
                forwardingUrl: `/forward/${forwardingId}`,
                transcript,
                textD,
                textF,
                textG,
                speechInsights,
                prompt: finalPrompt,
                debugLog,
                captureImageUrl,
                landmarks: landmarks || [],
                blendshapes: blendshapes || [],
                facialMatrixes: facialMatrixes || [],
                preparedOpenAIRequest: {
                    prompt: finalPrompt,
                    transcript,
                    speechInsights
                },
                scores: {
                    textD: textDSnapshot,
                    textF: textFSnapshot,
                    textG: textGSnapshot
                },
                files: {
                    audio: audioFile
                        ? {
                            originalname: audioFile.originalname,
                            filename: audioFile.filename,
                            url: `/uploads/${audioFile.filename}`
                        }
                        : null,
                    captureImage: imageFile
                        ? {
                            originalname: imageFile.originalname,
                            filename: imageFile.filename,
                            url: captureImageUrl
                        }
                        : null
                }
            });
        } catch (error) {
            console.error(error);
            debugLines.push(`[error] ${error.message || "unknown_error"}`);

            return res.status(500).json({
                ok: false,
                error: error.message || "process_failed",
                debugLog: debugLines.join("\n")
            });
        }
    }
);

/* -------------------------
 * route: analyze
 * ------------------------- */
router.post("/api/analyze", async (req, res) => {
    try {
        const prompt = String(req.body.prompt || "").trim();
        const forwardingId = String(req.body.forwardingId || "").trim();

        if (!prompt) {
            return res.status(400).json({
                ok: false,
                error: "prompt_required"
            });
        }

        const result = await callOpenAIIfRequested(prompt);

        if (forwardingId && forwardingStore.has(forwardingId)) {
            const prev = forwardingStore.get(forwardingId);
            forwardingStore.set(forwardingId, {
                ...prev,
                prompt,
                result: result.result || ""
            });
        }

        res.set("Content-Type", "application/json; charset=utf-8");
        return res.json({
            ok: true,
            result: result.result || "",
            skipped: !!result.skipped,
            reason: result.reason || ""
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            error: error.message || "analyze_failed"
        });
    }
});

module.exports = router;