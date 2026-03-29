function q(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`DOM element not found: ${id}`);
    return el;
}

export function bindSliderValue(sliderEl, valueEl, formatter = null) {
    if (!sliderEl) throw new Error("bindSliderValue: sliderEl is required");
    if (!valueEl) throw new Error("bindSliderValue: valueEl is required");

    const renderValue = () => {
        const raw = sliderEl.value;
        valueEl.textContent = typeof formatter === "function" ? formatter(raw) : raw;
    };

    renderValue();
    sliderEl.addEventListener("input", renderValue);

    return renderValue;
}

export function createDomRefs() {
    const canvas = {
        originalCanvas: q("originalCanvas"),
        previewCanvas: q("previewCanvas"),
        srcCanvas: q("srcCanvas"),
        workCanvas: q("workCanvas"),
        maskCanvas: q("maskCanvas"),
        tempCanvas: q("tempCanvas"),
        tempCanvas2: q("tempCanvas2"),
        tempCanvas3: q("tempCanvas3"),
        regionCanvas: q("regionCanvas"),
        regionCanvas2: q("regionCanvas2")
    };

    const ctx = {
        originalCtx: canvas.originalCanvas.getContext("2d"),
        previewCtx: canvas.previewCanvas.getContext("2d"),
        srcCtx: canvas.srcCanvas.getContext("2d", { willReadFrequently: true }),
        workCtx: canvas.workCanvas.getContext("2d", { willReadFrequently: true }),
        maskCtx: canvas.maskCanvas.getContext("2d", { willReadFrequently: true }),
        tempCtx: canvas.tempCanvas.getContext("2d", { willReadFrequently: true }),
        tempCtx2: canvas.tempCanvas2.getContext("2d", { willReadFrequently: true }),
        tempCtx3: canvas.tempCanvas3.getContext("2d", { willReadFrequently: true }),
        regionCtx: canvas.regionCanvas.getContext("2d", { willReadFrequently: true }),
        regionCtx2: canvas.regionCanvas2.getContext("2d", { willReadFrequently: true })
    };

    const statusEl = q("status");
    const infoBadge = q("infoBadge");

    const sliders = {
        leftLift: q("leftLiftSlider"),
        rightLift: q("rightLiftSlider"),
        sigmaX: q("sigmaXSlider"),
        sigmaY: q("sigmaYSlider"),
        roiPad: q("roiPadSlider"),
        eyeLift: q("eyeLiftSlider"),
        noseSlim: q("noseSlimSlider"),
        noseWingSlim: q("noseWingSlimSlider"),
        jawSlim: q("jawSlimSlider"),

        // 턱 관련 신규 슬라이더
        jawWidth: q("jawWidthSlider"),
        jawSmooth: q("jawSmoothSlider"),
        marionetteLift: q("marionetteLiftSlider"),

        globalBrightness: q("globalBrightnessSlider"),
        faceBlur: q("faceBlurSlider"),
        faceSharpen: q("faceSharpenSlider"),
        faceLively: q("faceLivelySlider"),
        faceBlemish: q("faceBlemishSlider"),
        noseDepth: q("noseDepthSlider"),
        eyeLine: q("eyeLineSlider"),
        irisDeepen: q("irisDeepenSlider"),
        eyeOpenAuto: q("eyeOpenAutoSlider"),
        eyebrowCleanup: q("eyebrowCleanupSlider"),
        eyebrowTailTrim: q("eyebrowTailTrimSlider"),
        eyebrowInnerSoft: q("eyebrowInnerSoftSlider"),
        eyebrowOuterClean: q("eyebrowOuterCleanSlider"),
        eyebrowFill: q("eyebrowFillSlider"),
        lipSaturation: q("lipSaturationSlider"),
        lipBrightness: q("lipBrightnessSlider"),
        lipCenterGlow: q("lipCenterGlowSlider"),
        lipVolume: q("lipVolumeSlider")
    };

    const values = {
        leftLift: q("leftLiftValue"),
        rightLift: q("rightLiftValue"),
        sigmaX: q("sigmaXValue"),
        sigmaY: q("sigmaYValue"),
        roiPad: q("roiPadValue"),
        eyeLift: q("eyeLiftValue"),
        noseSlim: q("noseSlimValue"),
        noseWingSlim: q("noseWingSlimValue"),
        jawSlim: q("jawSlimValue"),

        // 턱 관련 신규 값 표시
        jawWidth: q("jawWidthValue"),
        jawSmooth: q("jawSmoothValue"),
        marionetteLift: q("marionetteLiftValue"),

        globalBrightness: q("globalBrightnessValue"),
        faceBlur: q("faceBlurValue"),
        faceSharpen: q("faceSharpenValue"),
        faceLively: q("faceLivelyValue"),
        faceBlemish: q("faceBlemishValue"),
        noseDepth: q("noseDepthValue"),
        eyeLine: q("eyeLineValue"),
        irisDeepen: q("irisDeepenValue"),
        eyeOpenAuto: q("eyeOpenAutoValue"),
        eyebrowCleanup: q("eyebrowCleanupValue"),
        eyebrowTailTrim: q("eyebrowTailTrimValue"),
        eyebrowInnerSoft: q("eyebrowInnerSoftValue"),
        eyebrowOuterClean: q("eyebrowOuterCleanValue"),
        eyebrowFill: q("eyebrowFillValue"),
        lipSaturation: q("lipSaturationValue"),
        lipBrightness: q("lipBrightnessValue"),
        lipCenterGlow: q("lipCenterGlowValue"),
        lipVolume: q("lipVolumeValue")
    };

    const buttons = {
        renderBtn: q("renderBtn"),
        toggleBtn: q("toggleBtn"),
        saveBtn: q("saveBtn"),
        backBtn: q("backBtn")
    };

    return { canvas, ctx, statusEl, infoBadge, sliders, values, buttons };
}