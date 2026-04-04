// speechInsights.js
// 전사 텍스트 + 녹음 오디오를 분석해서 
// GPT 프롬프트에 넣을 수 있는 자동 분석 문자열을 만든다.

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

function formatTime(seconds) {
    return `${seconds.toFixed(2)}초`;
}

function mergeCloseSegments(segments, maxGapSec = 0.18) {
    if (!segments.length) return [];
    const merged = [segments[0]];
    for (let i = 1; i < segments.length; i++) {
        const prev = merged[merged.length - 1];
        const cur = segments[i];
        if (cur.start - prev.end <= maxGapSec) {
            prev.end = cur.end;
            prev.duration = round(prev.end - prev.start, 3);
            prev.avgRms = round((prev.avgRms + cur.avgRms) / 2, 5);
            prev.avgPitch = round(
                prev.avgPitch && cur.avgPitch
                    ? (prev.avgPitch + cur.avgPitch) / 2
                    : (prev.avgPitch || cur.avgPitch || 0),
                2
            );
            prev.samples = [...(prev.samples || []), ...(cur.samples || [])];
        } else {
            merged.push(cur);
        }
    }
    return merged;
}

function autoCorrelatePitch(buffer, sampleRate) {
    const size = buffer.length;
    let rms = 0;
    for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.01) return 0;

    let bestOffset = -1;
    let bestCorr = 0;
    const minFreq = 80;
    const maxFreq = 350;
    const minOffset = Math.floor(sampleRate / maxFreq);
    const maxOffset = Math.floor(sampleRate / minFreq);

    for (let offset = minOffset; offset <= maxOffset; offset++) {
        let corr = 0;
        for (let i = 0; i < size - offset; i++) {
            corr += buffer[i] * buffer[i + offset];
        }
        if (corr > bestCorr) {
            bestCorr = corr;
            bestOffset = offset;
        }
    }

    if (bestOffset === -1 || bestCorr <= 0) return 0;
    return sampleRate / bestOffset;
}

export function analyzeTranscriptFillers(transcript, fillerWords = DEFAULT_FILLERS) {
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
                found.push({
                    filler,
                    index: m.index ?? 0
                });
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

async function decodeAudioBlob(audioBlob) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        throw new Error("AudioContext_not_supported");
    }

    const audioContext = new AudioCtx();
    try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

        const channelCount = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const mono = new Float32Array(length);

        for (let ch = 0; ch < channelCount; ch++) {
            const data = audioBuffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                mono[i] += data[i] / channelCount;
            }
        }

        return {
            samples: mono,
            sampleRate: audioBuffer.sampleRate,
            duration: audioBuffer.duration
        };
    } finally {
        try {
            await audioContext.close();
        } catch (_) { }
    }
}

function frameSignal(samples, sampleRate) {
    const frameSize = 2048;
    const hopSize = 512;
    const frames = [];

    for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
        const slice = samples.subarray(start, start + frameSize);

        let sumSq = 0;
        let zeroCrossings = 0;
        let prev = slice[0];

        for (let i = 0; i < slice.length; i++) {
            const v = slice[i];
            sumSq += v * v;
            if ((prev >= 0 && v < 0) || (prev < 0 && v >= 0)) zeroCrossings++;
            prev = v;
        }

        const rms = Math.sqrt(sumSq / slice.length);
        const pitch = autoCorrelatePitch(slice, sampleRate);

        frames.push({
            start: start / sampleRate,
            end: (start + frameSize) / sampleRate,
            mid: (start + frameSize / 2) / sampleRate,
            duration: frameSize / sampleRate,
            rms,
            zcr: zeroCrossings / slice.length,
            pitch
        });
    }

    return frames;
}

function extractSpeechSegments(frames, speechThreshold) {
    const segments = [];
    let current = null;

    for (const f of frames) {
        const isSpeech = f.rms >= speechThreshold;
        if (isSpeech) {
            if (!current) {
                current = {
                    start: f.start,
                    end: f.end,
                    samples: [f]
                };
            } else {
                current.end = f.end;
                current.samples.push(f);
            }
        } else if (current) {
            current.duration = current.end - current.start;
            current.avgRms = mean(current.samples.map(x => x.rms));
            current.avgPitch = mean(current.samples.map(x => x.pitch).filter(Boolean));
            if (current.duration >= 0.18) segments.push(current);
            current = null;
        }
    }

    if (current) {
        current.duration = current.end - current.start;
        current.avgRms = mean(current.samples.map(x => x.rms));
        current.avgPitch = mean(current.samples.map(x => x.pitch).filter(Boolean));
        if (current.duration >= 0.18) segments.push(current);
    }

    return mergeCloseSegments(segments, 0.12);
}

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
            if (current.duration >= 0.45) silences.push(current);
            current = null;
        }
    }

    if (current) {
        current.duration = current.end - current.start;
        current.avgRms = mean(current.samples.map(x => x.rms));
        if (current.duration >= 0.45) silences.push(current);
    }

    return silences;
}

function detectTrailingFadeSegments(speechSegments) {
    const fades = [];

    for (const seg of speechSegments) {
        if (!seg.samples || seg.samples.length < 8 || seg.duration < 0.7) continue;

        const sampleCount = seg.samples.length;
        const tailCount = Math.max(3, Math.floor(sampleCount * 0.2));
        const tail = seg.samples.slice(sampleCount - tailCount);
        const head = seg.samples.slice(0, sampleCount - tailCount);

        const tailRms = mean(tail.map(s => s.rms));
        const bodyRms = mean(head.map(s => s.rms));
        const tailPitch = mean(tail.map(s => s.pitch).filter(Boolean));
        const bodyPitch = mean(head.map(s => s.pitch).filter(Boolean));

        const fadeByVolume = bodyRms > 0 && tailRms < bodyRms * 0.55;
        const fadeByPitch = bodyPitch > 0 && tailPitch > 0 && tailPitch < bodyPitch * 0.82;

        if (fadeByVolume || fadeByPitch) {
            fades.push({
                start: tail[0].start,
                end: tail[tail.length - 1].end,
                duration: round(tail[tail.length - 1].end - tail[0].start, 3),
                avgRms: round(tailRms, 5),
                avgPitch: round(tailPitch || 0, 2)
            });
        }
    }

    return mergeCloseSegments(fades, 0.15).filter(s => s.duration >= 0.2);
}

function detectLowVoiceSegments(speechSegments, medianSpeechRms) {
    const lowVoice = [];

    for (const seg of speechSegments) {
        if (seg.avgRms < medianSpeechRms * 0.58) {
            lowVoice.push({
                start: seg.start,
                end: seg.end,
                duration: round(seg.duration, 3),
                avgRms: round(seg.avgRms, 5),
                avgPitch: round(seg.avgPitch || 0, 2)
            });
        }
    }

    return lowVoice;
}

function detectTensionSegments(frames, speechThreshold) {
    const speechFrames = frames.filter(f => f.rms >= speechThreshold);
    const pitches = speechFrames.map(f => f.pitch).filter(p => p >= 90 && p <= 320);
    const rmsValues = speechFrames.map(f => f.rms);

    const pitchMean = mean(pitches);
    const pitchStd = std(pitches) || 1;
    const rmsMean = mean(rmsValues);
    const rmsStd = std(rmsValues) || 1;

    const raw = [];
    let current = null;

    for (const f of speechFrames) {
        const pitchHigh = f.pitch >= pitchMean + pitchStd * 1.15;
        const energyHigh = f.rms >= rmsMean + rmsStd * 0.85;
        const tense = pitchHigh || (pitchHigh && energyHigh) || (f.pitch >= pitchMean + pitchStd * 0.8 && energyHigh);

        if (tense) {
            if (!current) {
                current = {
                    start: f.start,
                    end: f.end,
                    samples: [f]
                };
            } else {
                current.end = f.end;
                current.samples.push(f);
            }
        } else if (current) {
            const duration = current.end - current.start;
            if (duration >= 0.25) {
                raw.push({
                    start: current.start,
                    end: current.end,
                    duration: round(duration, 3),
                    avgRms: round(mean(current.samples.map(x => x.rms)), 5),
                    avgPitch: round(mean(current.samples.map(x => x.pitch).filter(Boolean)), 2)
                });
            }
            current = null;
        }
    }

    if (current) {
        const duration = current.end - current.start;
        if (duration >= 0.25) {
            raw.push({
                start: current.start,
                end: current.end,
                duration: round(duration, 3),
                avgRms: round(mean(current.samples.map(x => x.rms)), 5),
                avgPitch: round(mean(current.samples.map(x => x.pitch).filter(Boolean)), 2)
            });
        }
    }

    return mergeCloseSegments(raw, 0.15);
}

function toReadableList(title, segments, extraFormatter = null) {
    if (!segments.length) return `${title}: 없음`;
    const top = segments.slice(0, 8);
    const lines = top.map((seg, idx) => {
        const extra = extraFormatter ? extraFormatter(seg) : "";
        return `- ${idx + 1}) ${formatTime(seg.start)} ~ ${formatTime(seg.end)} (${seg.duration.toFixed(2)}초)${extra}`;
    });
    const more = segments.length > top.length ? `\n- 외 ${segments.length - top.length}개 구간` : "";
    return `${title}:\n${lines.join("\n")}${more}`;
}

export async function analyzeAudioBlob(audioBlob) {
    const decoded = await decodeAudioBlob(audioBlob);
    const frames = frameSignal(decoded.samples, decoded.sampleRate);

    const rmsValues = frames.map(f => f.rms).filter(v => Number.isFinite(v));
    const noiseFloor = percentile(rmsValues, 0.2);
    const silenceThreshold = Math.max(noiseFloor * 1.35, 0.0035);
    const speechThreshold = Math.max(noiseFloor * 2.6, 0.009);

    const speechSegments = extractSpeechSegments(frames, speechThreshold);
    const silenceSegments = extractSilenceSegments(frames, silenceThreshold);
    const speechRmsValues = speechSegments.map(s => s.avgRms).filter(Boolean);
    const medianSpeechRms = percentile(speechRmsValues, 0.5) || speechThreshold;

    const trailingFadeSegments = detectTrailingFadeSegments(speechSegments);
    const lowVoiceSegments = detectLowVoiceSegments(speechSegments, medianSpeechRms);
    const tensionSegments = detectTensionSegments(frames, speechThreshold);

    const totalSpeechTime = speechSegments.reduce((sum, s) => sum + s.duration, 0);
    const totalSilenceTime = silenceSegments.reduce((sum, s) => sum + s.duration, 0);
    const longSilenceCount = silenceSegments.filter(s => s.duration >= 1.0).length;

    return {
        duration: round(decoded.duration, 2),
        thresholds: {
            noiseFloor: round(noiseFloor, 5),
            silenceThreshold: round(silenceThreshold, 5),
            speechThreshold: round(speechThreshold, 5)
        },
        stats: {
            totalSpeechTime: round(totalSpeechTime, 2),
            totalSilenceTime: round(totalSilenceTime, 2),
            longSilenceCount
        },
        silenceSegments: silenceSegments.map(s => ({
            start: round(s.start, 2),
            end: round(s.end, 2),
            duration: round(s.duration, 2),
            avgRms: round(s.avgRms, 5)
        })),
        trailingFadeSegments,
        lowVoiceSegments,
        tensionSegments
    };
}

export function buildSpeechInsightsPrompt({ transcript, fillerAnalysis, audioAnalysis }) {
    const transcriptText = String(transcript || "").trim();

    const fillerDetailEntries = Object.entries(fillerAnalysis.detail || {});
    const fillerDetailText = fillerDetailEntries.length
        ? fillerDetailEntries.map(([word, count]) => `- ${word}: ${count}회`).join("\n")
        : "- 없음";

    const repeatedText = fillerAnalysis.repeatedWordCount > 0
        ? fillerAnalysis.repeatedWords.slice(0, 10).map((v, i) => `- ${i + 1}) ${v}`).join("\n")
        : "- 없음";

    const silenceText = toReadableList(
        "침묵 구간",
        audioAnalysis.silenceSegments || [],
        seg => ` / 평균 음량 ${seg.avgRms}`
    );

    const fadeText = toReadableList(
        "말끝 흐림 추정 구간",
        audioAnalysis.trailingFadeSegments || [],
        seg => ` / 평균 pitch ${seg.avgPitch || 0}Hz`
    );

    const tensionText = toReadableList(
        "긴장 추정 구간",
        audioAnalysis.tensionSegments || [],
        seg => ` / 평균 pitch ${seg.avgPitch || 0}Hz`
    );

    const lowVoiceText = toReadableList(
        "목소리 작은 구간",
        audioAnalysis.lowVoiceSegments || [],
        seg => ` / 평균 음량 ${seg.avgRms}`
    );

    return `
[자동 음성 분석 정보]
이 정보는 브라우저에서 전사 텍스트와 오디오 파형을 바탕으로 추정한 참고값이다.
절대적인 진단처럼 쓰지 말고, 면접 말하기 피드백 용도로 해석해라.

[전사 텍스트]
${transcriptText || "(없음)"}

[필러 단어 총횟수]
${fillerAnalysis.totalCount}회

[필러 단어 상세]
${fillerDetailText}

[반복 단어 패턴]
${repeatedText}

[오디오 전체 길이]
${audioAnalysis.duration}초

[총 발화 시간]
${audioAnalysis.stats.totalSpeechTime}초

[총 침묵 시간]
${audioAnalysis.stats.totalSilenceTime}초

[1초 이상 긴 침묵 횟수]
${audioAnalysis.stats.longSilenceCount}회

${silenceText}

${fadeText}

${tensionText}

${lowVoiceText}
`.trim();
}

export async function analyzeSpeechArtifacts({ transcript, audioBlob }) {
    const fillerAnalysis = analyzeTranscriptFillers(transcript);

    let audioAnalysis;
    try {
        audioAnalysis = await analyzeAudioBlob(audioBlob);
    } catch (err) {
        audioAnalysis = {
            duration: 0,
            stats: {
                totalSpeechTime: 0,
                totalSilenceTime: 0,
                longSilenceCount: 0
            },
            silenceSegments: [],
            trailingFadeSegments: [],
            lowVoiceSegments: [],
            tensionSegments: [],
            error: err?.message || "audio_decode_failed"
        };
    }

    const promptText = buildSpeechInsightsPrompt({
        transcript,
        fillerAnalysis,
        audioAnalysis
    });

    return {
        fillerAnalysis,
        audioAnalysis, 
        promptText
    };
} 