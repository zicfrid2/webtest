// speechInsights.js (CommonJS)
// WebM(Opus) / WAV 실제 분석 버전
// - ffmpeg 외부 바이너리 없이 libav.js(WebAssembly)로 디코드
// - 침묵, pitch, 말끝 흐림, 긴장, 작은 목소리 구간을 실제 오디오 프레임에서 계산
//
// 설치:
//   npm i @libav.js/variant-default
//
// 참고:
//   analyzeSpeech(audioFilePath, transcript) 형태는 유지

const fs = require("fs");
const path = require("path");

const DEFAULT_FILLERS = [
    "음", "어", "그", "이제", "약간", "사실", "뭐랄까", "그러니까",
    "저기", "음...", "어...", "그...", "막", "뭔가"
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function percentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return sorted[low];
    const t = idx - low;
    return sorted[low] * (1 - t) + sorted[high] * t;
}

function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const v = mean(arr.map(x => (x - m) ** 2));
    return Math.sqrt(v);
}

function avg(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function formatTime(seconds) {
    return `${toNumber(seconds, 0).toFixed(2)}초`;
}

function getSegmentDuration(seg) {
    const start = toNumber(seg?.start, 0);
    const end = toNumber(seg?.end, 0);
    if (end <= start) return 0;
    return end - start;
}

function getSegmentDurationSeconds(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return 0;
    return round(segments.reduce((sum, seg) => sum + getSegmentDuration(seg), 0), 2);
}

function countSegmentsAtLeast(segments, minSeconds) {
    if (!Array.isArray(segments) || segments.length === 0) return 0;
    return segments.reduce((count, seg) => count + (getSegmentDuration(seg) >= minSeconds ? 1 : 0), 0);
}

function normalizeSegment(seg) {
    const start = round(toNumber(seg?.start, 0), 2);
    const end = round(toNumber(seg?.end, 0), 2);
    const duration = round(
        seg?.duration != null ? toNumber(seg.duration, 0) : Math.max(0, end - start),
        2
    );

    return {
        start,
        end,
        duration,
        avgRms: seg?.avgRms != null ? round(toNumber(seg.avgRms, 0), 5) : undefined,
        avgPitch: seg?.avgPitch != null ? round(toNumber(seg.avgPitch, 0), 2) : undefined,
        confidence: seg?.confidence != null ? round(toNumber(seg.confidence, 0), 2) : undefined,
        reason: seg?.reason != null ? String(seg.reason) : undefined
    };
}

function mergeCloseSegments(segments, maxGapSec = 0.22) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const sorted = [...segments]
        .map(normalizeSegment)
        .sort((a, b) => a.start - b.start);

    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        const cur = sorted[i];

        if (cur.start - prev.end <= maxGapSec) {
            const prevDuration = prev.duration || Math.max(0, prev.end - prev.start);
            const curDuration = cur.duration || Math.max(0, cur.end - cur.start);
            const totalDuration = prevDuration + curDuration || 1;

            prev.end = round(Math.max(prev.end, cur.end), 2);
            prev.duration = round(prev.end - prev.start, 2);

            if (prev.avgRms != null || cur.avgRms != null) {
                const prevR = toNumber(prev.avgRms, 0);
                const curR = toNumber(cur.avgRms, 0);
                prev.avgRms = round(((prevR * prevDuration) + (curR * curDuration)) / totalDuration, 5);
            }

            if (prev.avgPitch != null || cur.avgPitch != null) {
                const prevP = toNumber(prev.avgPitch, 0);
                const curP = toNumber(cur.avgPitch, 0);
                prev.avgPitch = round(((prevP * prevDuration) + (curP * curDuration)) / totalDuration, 2);
            }

            if (prev.confidence != null || cur.confidence != null) {
                const prevC = toNumber(prev.confidence, 0);
                const curC = toNumber(cur.confidence, 0);
                prev.confidence = round(Math.max(prevC, curC), 2);
            }

            if (prev.reason || cur.reason) {
                const reasons = [prev.reason, cur.reason].filter(Boolean);
                prev.reason = [...new Set(reasons)].join(", ");
            }
        } else {
            merged.push(cur);
        }
    }

    return merged;
}

function normalizeAudioAnalysis(audioAnalysis) {
    const src = audioAnalysis && typeof audioAnalysis === "object" ? audioAnalysis : {};

    const silenceSegments = Array.isArray(src.silenceSegments)
        ? mergeCloseSegments(src.silenceSegments, 0.12)
        : [];

    const trailingFadeSegments = Array.isArray(src.trailingFadeSegments)
        ? mergeCloseSegments(src.trailingFadeSegments, 0.18)
        : [];

    const tensionSegments = Array.isArray(src.tensionSegments)
        ? mergeCloseSegments(src.tensionSegments, 0.18)
        : [];

    const lowVoiceSegments = Array.isArray(src.lowVoiceSegments)
        ? mergeCloseSegments(src.lowVoiceSegments, 0.18)
        : [];

    const duration =
        src.duration != null
            ? round(toNumber(src.duration, 0), 2)
            : round(
                Math.max(
                    0,
                    ...[
                        ...silenceSegments.map(s => s.end),
                        ...trailingFadeSegments.map(s => s.end),
                        ...tensionSegments.map(s => s.end),
                        ...lowVoiceSegments.map(s => s.end)
                    ]
                ),
                2
            );

    return {
        duration,
        silenceSegments,
        trailingFadeSegments,
        tensionSegments,
        lowVoiceSegments,
        stats: {
            totalSilenceTime: getSegmentDurationSeconds(silenceSegments),
            longSilenceCount: countSegmentsAtLeast(silenceSegments, 1.0),
            trailingFadeTime: getSegmentDurationSeconds(trailingFadeSegments),
            tensionTime: getSegmentDurationSeconds(tensionSegments),
            lowVoiceTime: getSegmentDurationSeconds(lowVoiceSegments)
        }
    };
}

function analyzeTranscriptFillers(transcript, fillerWords = DEFAULT_FILLERS) {
    const text = String(transcript || "").trim();
    const cleanText = text.replace(/\s+/g, " ");
    const detail = {};
    const found = [];
    let total = 0;

    for (const filler of fillerWords) {
        const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(^|[\\s,.!?…])(${escaped})(?=[$\\s,.!?…])`, "g");
        const matches = [...cleanText.matchAll(regex)];
        const count = matches.length;

        if (count > 0) {
            detail[filler] = count;
            total += count;
            for (const m of matches) {
                found.push({ filler, index: m.index ?? 0 });
            }
        }
    }

    const repeatedWordRegex = /\b([가-힣A-Za-z]+)\s+\1\b/g;
    const repeatedWords = [...cleanText.matchAll(repeatedWordRegex)].map(m => m[0]);

    return {
        totalCount: total,
        detail,
        repeatedWords,
        repeatedWordCount: repeatedWords.length,
        found
    };
}

function toReadableList(title, segments, extraFormatter = null) {
    if (!Array.isArray(segments) || segments.length === 0) {
        return `${title}: 없음`;
    }

    const top = segments.slice(0, 8);
    const lines = top.map((seg, idx) => {
        const extra = extraFormatter ? extraFormatter(seg) : "";
        return `- ${idx + 1}) ${formatTime(seg.start)} ~ ${formatTime(seg.end)} (${seg.duration.toFixed(2)}초)${extra}`;
    });

    const more = segments.length > top.length ? `\n- 외 ${segments.length - top.length}개 구간` : "";
    return `${title}:\n${lines.join("\n")}${more}`;
}

function buildSpeechInsightsText({ transcript, fillerAnalysis, audioAnalysis }) {
    const transcriptText = String(transcript || "").trim();

    const fillerDetailEntries = Object.entries(fillerAnalysis?.detail || {});
    const fillerDetailText = fillerDetailEntries.length
        ? fillerDetailEntries.map(([word, count]) => `- ${word}: ${count}회`).join("\n")
        : "- 없음";

    const repeatedText = fillerAnalysis?.repeatedWordCount > 0
        ? fillerAnalysis.repeatedWords.slice(0, 10).map((v, i) => `- ${i + 1}) ${v}`).join("\n")
        : "- 없음";

    const silenceText = toReadableList(
        "침묵 구간",
        audioAnalysis.silenceSegments || [],
        seg => {
            const parts = [];
            if (seg.avgRms != null) parts.push(`평균 음량 ${seg.avgRms}`);
            if (seg.confidence != null) parts.push(`민감도 ${seg.confidence}`);
            if (seg.reason) parts.push(seg.reason);
            return parts.length ? ` / ${parts.join(" / ")}` : "";
        }
    );

    const fadeText = toReadableList(
        "말끝 흐림 추정 구간",
        audioAnalysis.trailingFadeSegments || [],
        seg => {
            const parts = [];
            if (seg.avgPitch != null) parts.push(`평균 pitch ${seg.avgPitch}Hz`);
            if (seg.confidence != null) parts.push(`민감도 ${seg.confidence}`);
            if (seg.reason) parts.push(seg.reason);
            return parts.length ? ` / ${parts.join(" / ")}` : "";
        }
    );

    const tensionText = toReadableList(
        "긴장 추정 구간",
        audioAnalysis.tensionSegments || [],
        seg => {
            const parts = [];
            if (seg.avgPitch != null) parts.push(`평균 pitch ${seg.avgPitch}Hz`);
            if (seg.confidence != null) parts.push(`민감도 ${seg.confidence}`);
            if (seg.reason) parts.push(seg.reason);
            return parts.length ? ` / ${parts.join(" / ")}` : "";
        }
    );

    const lowVoiceText = toReadableList(
        "목소리 작은 구간",
        audioAnalysis.lowVoiceSegments || [],
        seg => {
            const parts = [];
            if (seg.avgRms != null) parts.push(`평균 음량 ${seg.avgRms}`);
            if (seg.confidence != null) parts.push(`민감도 ${seg.confidence}`);
            if (seg.reason) parts.push(seg.reason);
            return parts.length ? ` / ${parts.join(" / ")}` : "";
        }
    );

    return [
        `[자동 음성 분석 정보]`,
        `이 정보는 서버에서 계산한 참고용 분석값이다.`,
        `절대적인 진단이 아니라 면접 말하기 피드백 용도로 해석해라.`,
        ``,
        `[전사 텍스트]`,
        transcriptText || "(없음)",
        ``,
        `[필러 단어 총횟수]`,
        `${fillerAnalysis.totalCount}회`,
        ``,
        `[필러 단어 상세]`,
        fillerDetailText,
        ``,
        `[반복 단어 패턴]`,
        repeatedText,
        ``,
        `[오디오 전체 길이]`,
        `${audioAnalysis.duration.toFixed(2)}초`,
        ``,
        `[총 침묵 시간]`,
        `${audioAnalysis.stats.totalSilenceTime.toFixed(2)}초`,
        ``,
        `[1초 이상 긴 침묵 횟수]`,
        `${audioAnalysis.stats.longSilenceCount}회`,
        ``,
        `[말끝 흐림 총 누적시간]`,
        `${toNumber(audioAnalysis.stats.trailingFadeTime, 0).toFixed(2)}초`,
        ``,
        `[긴장 총 누적시간]`,
        `${toNumber(audioAnalysis.stats.tensionTime, 0).toFixed(2)}초`,
        ``,
        `[목소리 작은 구간 총 누적시간]`,
        `${toNumber(audioAnalysis.stats.lowVoiceTime, 0).toFixed(2)}초`,
        ``,
        silenceText,
        ``,
        fadeText,
        ``,
        tensionText,
        ``,
        lowVoiceText
    ].join("\n");
}

let libavFactoryPromise = null;

async function loadLibAVFactory() {
    if (!libavFactoryPromise) {
        libavFactoryPromise = import("@libav.js/variant-default");
    }
    const mod = await libavFactoryPromise;
    return mod.default || mod.LibAV || mod;
}

async function createLibAVInstance() {
    const LibAV = await loadLibAVFactory();
    if (typeof LibAV?.LibAV === "function") {
        return await LibAV.LibAV({ noworker: true });
    }
    if (typeof LibAV === "function") {
        return await LibAV({ noworker: true });
    }
    throw new Error("libav.js 초기화 실패: @libav.js/variant-default 로드 불가");
}

function pickAudioStream(streams) {
    if (!Array.isArray(streams) || !streams.length) return null;
    return streams.find(s =>
        String(s?.codec_type || "").toLowerCase() === "audio" ||
        String(s?.codec_name || "").toLowerCase().includes("opus") ||
        String(s?.codec_name || "").toLowerCase().includes("pcm")
    ) || streams[0];
}

function convertFrameToMonoFloat32(frame) {
    const channels = Math.max(1, toNumber(frame?.channels, 1));
    const data = Array.isArray(frame?.data) ? frame.data : [];
    if (!data.length) return new Float32Array(0);

    const plane0 = data[0];
    if (!plane0) return new Float32Array(0);

    if (data.length === 1) {
        const src = plane0 instanceof Float32Array ? plane0 : Float32Array.from(plane0);
        if (channels === 1) return src;
        const samples = Math.floor(src.length / channels);
        const mono = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            let sum = 0;
            for (let ch = 0; ch < channels; ch++) sum += src[i * channels + ch] || 0;
            mono[i] = sum / channels;
        }
        return mono;
    }

    const minLen = Math.min(...data.map(p => (p ? p.length : 0)).filter(Boolean));
    const mono = new Float32Array(minLen);
    for (let i = 0; i < minLen; i++) {
        let sum = 0;
        let used = 0;
        for (let ch = 0; ch < data.length; ch++) {
            const plane = data[ch];
            if (!plane || i >= plane.length) continue;
            sum += plane[i] || 0;
            used++;
        }
        mono[i] = used ? sum / used : 0;
    }
    return mono;
}

async function decodeAudioToMonoPcm(audioFilePath) {
    const libav = await createLibAVInstance();
    const inputBuffer = fs.readFileSync(audioFilePath);
    const ext = path.extname(audioFilePath) || ".webm";
    const virtualName = `input${ext}`;

    try {
        await libav.writeFile(virtualName, new Uint8Array(inputBuffer));
        const [fmtCtx, streams] = await libav.ff_init_demuxer_file(virtualName);
        const audioStream = pickAudioStream(streams);
        if (!audioStream) {
            throw new Error("오디오 스트림을 찾지 못했습니다.");
        }

        const [, decoderCtx, pkt, frame] = await libav.ff_init_decoder(
            audioStream.codec_id,
            audioStream.codecpar
        );

        const [, packets] = await libav.ff_read_multi(fmtCtx, pkt);
        const targetPackets = packets?.[audioStream.index] || [];
        const frames = await libav.ff_decode_multi(decoderCtx, pkt, frame, targetPackets, true);

        const chunks = [];
        let totalLength = 0;
        for (const fr of frames) {
            const mono = convertFrameToMonoFloat32(fr);
            if (!mono.length) continue;
            chunks.push(mono);
            totalLength += mono.length;
        }

        const mono = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            mono.set(chunk, offset);
            offset += chunk.length;
        }

        const sampleRate = toNumber(frames?.[0]?.sample_rate || audioStream?.codecpar?.sample_rate, 48000);
        return {
            samples: mono,
            sampleRate,
            channels: 1,
            duration: sampleRate > 0 ? mono.length / sampleRate : 0
        };
    } finally {
        try { await libav.unlink?.(virtualName); } catch (_) { }
        try { await libav.terminate?.(); } catch (_) { }
    }
}

function frameAudio(samples, sampleRate, frameSec = 0.04, hopSec = 0.02) {
    const frameSize = Math.max(1, Math.round(sampleRate * frameSec));
    const hopSize = Math.max(1, Math.round(sampleRate * hopSec));
    const frames = [];

    for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
        const slice = samples.subarray(start, start + frameSize);
        frames.push({
            startIndex: start,
            endIndex: start + frameSize,
            startSec: start / sampleRate,
            endSec: (start + frameSize) / sampleRate,
            samples: slice
        });
    }

    return { frames, frameSize, hopSize };
}

function computeRms(arr) {
    if (!arr.length) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
    return Math.sqrt(sum / arr.length);
}

function autoCorrelatePitch(samples, sampleRate) {
    const n = samples.length;
    if (n < 64) return 0;

    const minHz = 75;
    const maxHz = 420;
    const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
    const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz));

    let energy = 0;
    for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
    if (energy <= 1e-8) return 0;

    let bestLag = -1;
    let bestCorr = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < n - lag; i++) {
            const a = samples[i];
            const b = samples[i + lag];
            corr += a * b;
            normA += a * a;
            normB += b * b;
        }

        const denom = Math.sqrt(normA * normB) || 1;
        const normalized = corr / denom;
        if (normalized > bestCorr) {
            bestCorr = normalized;
            bestLag = lag;
        }
    }

    if (bestLag <= 0 || bestCorr < 0.55) return 0;
    return sampleRate / bestLag;
}

function buildFrameFeatures(samples, sampleRate) {
    const { frames } = frameAudio(samples, sampleRate, 0.04, 0.02);

    return frames.map(frame => {
        const rms = computeRms(frame.samples);
        const pitch = rms > 0.003 ? autoCorrelatePitch(frame.samples, sampleRate) : 0;

        return {
            start: round(frame.startSec, 3),
            end: round(frame.endSec, 3),
            mid: round((frame.startSec + frame.endSec) * 0.5, 3),
            duration: round(frame.endSec - frame.startSec, 3),
            rms,
            zcr: 0,
            pitch,
            voiced: pitch > 0,
            samples: frame.samples
        };
    });
}

// 1번 파일의 silenceSegments 생성 방식 이식
function extractSilenceSegments(frames, silenceThreshold) {
    const silences = [];
    let current = null;

    for (const f of frames) {
        const isSilent = f.rms < silenceThreshold;

        if (isSilent) {
            if (!current) {
                current = { start: f.start, end: f.end, samples: [f] };
            } else {
                current.end = f.end;
                current.samples.push(f);
            }
        } else if (current) {
            current.duration = current.end - current.start;
            current.avgRms = mean(current.samples.map(x => x.rms));

            if (current.duration >= 0.45) {
                silences.push({
                    start: round(current.start, 2),
                    end: round(current.end, 2),
                    duration: round(current.duration, 2),
                    avgRms: round(current.avgRms, 5),
                    confidence: round(clamp(current.duration >= 1.0 ? 0.92 : 0.72 + current.duration * 0.15, 0, 0.99), 2),
                    reason: current.duration >= 1.0 ? "긴 정지" : "짧은 정지"
                });
            }

            current = null;
        }
    }

    if (current) {
        current.duration = current.end - current.start;
        current.avgRms = mean(current.samples.map(x => x.rms));

        if (current.duration >= 0.45) {
            silences.push({
                start: round(current.start, 2),
                end: round(current.end, 2),
                duration: round(current.duration, 2),
                avgRms: round(current.avgRms, 5),
                confidence: round(clamp(current.duration >= 1.0 ? 0.92 : 0.72 + current.duration * 0.15, 0, 0.99), 2),
                reason: current.duration >= 1.0 ? "긴 정지" : "짧은 정지"
            });
        }
    }

    return mergeCloseSegments(silences, 0.12);
}

function collectSegments(features, predicate, mapper) {
    const out = [];
    let current = null;

    for (const f of features) {
        if (predicate(f)) {
            if (!current) {
                current = {
                    start: f.start,
                    end: f.end,
                    frames: [f]
                };
            } else {
                current.end = f.end;
                current.frames.push(f);
            }
        } else if (current) {
            out.push(mapper(current));
            current = null;
        }
    }

    if (current) out.push(mapper(current));
    return out;
}

function analyzeRealAudio(samples, sampleRate) {
    const features = buildFrameFeatures(samples, sampleRate);
    const duration = samples.length / sampleRate;

    const rmsValues = features.map(f => f.rms).filter(v => v > 0);
    const voiced = features.filter(f => f.voiced);
    const voicedPitches = voiced.map(f => f.pitch);
    const voicedRms = voiced.map(f => f.rms);

    const silenceThreshold = Math.max(0.0025, percentile(rmsValues, 0.18) * 0.9);
    const lowVoiceThreshold = Math.max(0.003, percentile(voicedRms, 0.28) * 0.95);
    const pitchMedian = percentile(voicedPitches, 0.5);
    const pitchStd = std(voicedPitches);

    // 여기서 실제 silenceSegments 생성
    const silenceSegments = extractSilenceSegments(features, silenceThreshold);

    const lowVoiceSegments = collectSegments(
        features,
        f => f.rms > silenceThreshold && f.rms <= lowVoiceThreshold,
        cur => {
            const vals = cur.frames.map(v => v.rms);
            const dur = cur.end - cur.start;
            const ratio = lowVoiceThreshold > 0 ? Math.max(0, 1 - avg(vals) / lowVoiceThreshold) : 0;
            return {
                start: round(cur.start, 2),
                end: round(cur.end, 2),
                duration: round(dur, 2),
                avgRms: round(avg(vals), 5),
                confidence: round(clamp(0.65 + ratio * 0.35 + Math.min(0.12, dur * 0.1), 0, 0.99), 2),
                reason: "발화 대비 볼륨 저하"
            };
        }
    ).filter(seg => seg.duration >= 0.22);

    const tensionSegments = collectSegments(
        voiced,
        f => {
            if (!pitchMedian) return false;
            return f.pitch >= pitchMedian + Math.max(18, pitchStd * 0.55);
        },
        cur => {
            const pitches = cur.frames.map(v => v.pitch).filter(Boolean);
            const dur = cur.end - cur.start;
            const pAvg = avg(pitches);
            const excess = pitchMedian > 0 ? (pAvg - pitchMedian) / pitchMedian : 0;
            return {
                start: round(cur.start, 2),
                end: round(cur.end, 2),
                duration: round(dur, 2),
                avgPitch: round(pAvg, 2),
                confidence: round(clamp(0.68 + excess * 0.9 + Math.min(0.12, dur * 0.08), 0, 0.99), 2),
                reason: "pitch 상승"
            };
        }
    ).filter(seg => seg.duration >= 0.16);

    const trailingFadeSegments = [];
    const voicedRuns = collectSegments(
        features,
        f => f.rms > silenceThreshold,
        cur => cur
    );

    for (const run of voicedRuns) {
        const framesInRun = run.frames;
        if (!framesInRun || framesInRun.length < 6) continue;

        const half = Math.floor(framesInRun.length / 2);
        const first = framesInRun.slice(0, half);
        const last = framesInRun.slice(half);

        const firstRms = avg(first.map(f => f.rms));
        const lastRms = avg(last.map(f => f.rms));
        const firstPitch = avg(first.map(f => f.pitch).filter(Boolean));
        const lastPitch = avg(last.map(f => f.pitch).filter(Boolean));

        const rmsDrop = firstRms > 0 ? (firstRms - lastRms) / firstRms : 0;
        const pitchDrop = firstPitch > 0 && lastPitch > 0 ? (firstPitch - lastPitch) / firstPitch : 0;
        const runDur = run.end - run.start;

        if (runDur >= 0.35 && (rmsDrop >= 0.22 || pitchDrop >= 0.10)) {
            const segStartIndex = Math.max(0, framesInRun.length - Math.max(3, Math.floor(framesInRun.length * 0.45)));
            const tailFrames = framesInRun.slice(segStartIndex);

            trailingFadeSegments.push({
                start: round(tailFrames[0].start, 2),
                end: round(tailFrames[tailFrames.length - 1].end, 2),
                duration: round(tailFrames[tailFrames.length - 1].end - tailFrames[0].start, 2),
                avgPitch: round(avg(tailFrames.map(f => f.pitch).filter(Boolean)), 2),
                confidence: round(clamp(0.66 + rmsDrop * 0.5 + pitchDrop * 0.5, 0, 0.99), 2),
                reason: rmsDrop >= 0.22 && pitchDrop >= 0.10
                    ? "끝음 하강 + 볼륨 감소"
                    : rmsDrop >= 0.22
                        ? "어미 볼륨 감소"
                        : "끝음 하강"
            });
        }
    }

    return normalizeAudioAnalysis({
        duration,
        silenceSegments,
        trailingFadeSegments,
        tensionSegments,
        lowVoiceSegments
    });
}

async function analyzeSpeech(audioFilePath, transcript = "") {
    const fillerAnalysis = analyzeTranscriptFillers(transcript);

    if (!audioFilePath || !fs.existsSync(audioFilePath)) {
        throw new Error(`오디오 파일을 찾을 수 없습니다: ${audioFilePath}`);
    }

    const decoded = await decodeAudioToMonoPcm(audioFilePath);
    const audioAnalysis = analyzeRealAudio(decoded.samples, decoded.sampleRate);

    const promptText = buildSpeechInsightsText({
        transcript,
        fillerAnalysis,
        audioAnalysis
    });

    return {
        baseText: promptText,
        promptText,
        audioAnalysis,
        raw: {
            audioFilePath,
            fillerAnalysis,
            decode: {
                sampleRate: decoded.sampleRate,
                duration: round(decoded.duration, 3),
                channels: decoded.channels,
                sampleCount: decoded.samples.length,
                containerHint: path.extname(audioFilePath).toLowerCase()
            },
            audioAnalysis,
            mode: "real-webm-audio"
        }
    };
}

module.exports = {
    DEFAULT_FILLERS,
    clamp,
    round,
    percentile,
    mean,
    std,
    avg,
    toNumber,
    formatTime,
    getSegmentDuration,
    getSegmentDurationSeconds,
    countSegmentsAtLeast,
    normalizeSegment,
    normalizeAudioAnalysis,
    analyzeTranscriptFillers,
    buildSpeechInsightsText,
    decodeAudioToMonoPcm,
    buildFrameFeatures,
    extractSilenceSegments,
    analyzeRealAudio,
    analyzeSpeech
};