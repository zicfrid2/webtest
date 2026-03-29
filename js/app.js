import { createDomRefs } from "./dom.js";
import { drawBaseImage } from "./canvas-state.js";
import { loadSourceData, savePreviewToFile } from "./db.js";
import { buildData } from "./landmarks.js";
import { applyWarp } from "./effects-warp.js";
import { applyFaceEffects, applyGlobalBrightness } from "./effects-face.js";
import {
    applyNoseDepth,
    applyEyeLineEnhance,
    applyEyeOpenHighlight,
    applyEyebrowCleanup,
    applyLipEnhancement
} from "./effects-features.js";
import { applyEyebrowAdvanced } from "./effects-eyebrow-advanced.js";
import { applyJawlineEnhance } from "./jawline.js";
import { drawGuides } from "./guides.js";

const dom = createDomRefs();

const state = {
    sourceBlob: null,
    sourceMeta: null,
    sourceImageBitmap: null,
    showGuides: false
};

function setStatus(msg) {
    if (dom.statusEl) dom.statusEl.textContent = msg;
}

function setInfo(msg) {
    if (dom.infoBadge) dom.infoBadge.textContent = msg;
}

function syncSliderLabels() {
    for (const key of Object.keys(dom.sliders || {})) {
        const slider = dom.sliders[key];
        const valueEl = dom.values?.[key];
        if (slider && valueEl) {
            valueEl.textContent = slider.value;
        }
    }
}

function renderSmile() {
    if (!state.sourceMeta || !state.sourceImageBitmap) {
        setStatus("이미지 또는 랜드마크 데이터가 없습니다.");
        return;
    }

    syncSliderLabels();
    drawBaseImage(state, dom);

    const data = buildData(state, dom);

    // 1) 얼굴/형태 변형
    applyWarp(state, dom, data);

    // 2) 전체 밝기
    applyGlobalBrightness(dom, data);

    // 3) 얼굴 전반 효과
    const faceBox = applyFaceEffects(state, dom, data);

    // 4) 눈썹 정리 / 보강
    applyEyebrowCleanup(state, dom, data);
    applyEyebrowAdvanced(state, dom, data);

    // 5) 세부 기능들
    applyNoseDepth(state, dom, data);
    applyEyeLineEnhance(state, dom, data);
    applyEyeOpenHighlight(state, dom, data);
    applyLipEnhancement(state, dom, data);
    applyJawlineEnhance(state, dom, data);

    // 6) preview canvas 갱신
    dom.ctx.previewCtx.clearRect(
        0,
        0,
        dom.canvas.previewCanvas.width,
        dom.canvas.previewCanvas.height
    );
    dom.ctx.previewCtx.drawImage(dom.canvas.workCanvas, 0, 0);

    // 7) 가이드
    drawGuides(state, dom, data, faceBox);

    setStatus("적용 완료");
    setInfo(
        `Smile L/R ${data.leftLift ?? 0}/${data.rightLift ?? 0} | ` +
        `Eye ${dom.sliders.eyeLift?.value ?? 0} | ` +
        `Nose ${dom.sliders.noseSlim?.value ?? 0} | ` +
        `Brow In ${dom.sliders.eyebrowInnerSoft?.value ?? 0} | ` +
        `Brow Out ${dom.sliders.eyebrowOuterClean?.value ?? 0} | ` +
        `Brow Fill ${dom.sliders.eyebrowFill?.value ?? 0}`
    );
}

function safeRender() {
    try {
        renderSmile();
    } catch (err) {
        console.error(err);
        setStatus("렌더링에 실패했습니다.");
        setInfo("렌더링 실패");
    }
}

function bindSliderValue(slider, label, formatter = (v) => v) {
    if (!slider || !label) return;

    slider.addEventListener("input", () => {
        label.textContent = formatter(slider.value);
    });

    slider.addEventListener("change", safeRender);
}

for (const key of Object.keys(dom.sliders || {})) {
    bindSliderValue(dom.sliders[key], dom.values?.[key]);
}

if (dom.buttons?.renderBtn) {
    dom.buttons.renderBtn.addEventListener("click", safeRender);
}

if (dom.buttons?.toggleBtn) {
    dom.buttons.toggleBtn.addEventListener("click", () => {
        state.showGuides = !state.showGuides;
        dom.buttons.toggleBtn.textContent = `가이드 표시: ${state.showGuides ? "ON" : "OFF"}`;
        safeRender();
    });
}

if (dom.buttons?.saveBtn) {
    dom.buttons.saveBtn.addEventListener("click", async () => {
        try {
            await savePreviewToFile(dom);
            setStatus("변형된 이미지를 파일로 저장했습니다.");
        } catch (err) {
            console.error(err);
            setStatus("파일 저장에 실패했습니다.");
        }
    });
}

if (dom.buttons?.backBtn) {
    dom.buttons.backBtn.addEventListener("click", () => {
        location.href = "capture.html";
    });
}

(async function init() {
    try {
        setStatus("저장된 이미지와 랜드마크를 불러오는 중입니다.");
        setInfo("로딩중");
        await loadSourceData(state, dom);
        safeRender();
    } catch (err) {
        console.error(err);
        setStatus(
            "analysis.html 초기화에 실패했습니다.\n" +
            "먼저 capture.html에서 사진을 촬영하고 랜드마크를 저장한 뒤 다시 열어주세요."
        );
        setInfo("초기화 실패");
    }
})();