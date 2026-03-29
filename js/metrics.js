(function () {
    function sampleGray(img, x, y) {
        const ix = Math.floor(clamp(x, 0, TARGET_W - 1));
        const iy = Math.floor(clamp(y, 0, TARGET_H - 1));
        const i = (iy * TARGET_W + ix) * 4;
        const px = img.data;
        return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    }

    function computeBrowThickness(upperIndices, lowerIndices) {
        const n = Math.min(upperIndices.length, lowerIndices.length);
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const up = getLm(upperIndices[i]);
            const lo = getLm(lowerIndices[i]);
            sum += Math.hypot(up.x - lo.x, up.y - lo.y);
        }
        return sum / Math.max(1, n);
    }

    function computeBrowAngle(headIdx, tailIdx) {
        const h = getLm(headIdx);
        const t = getLm(tailIdx);
        return Math.atan2(-(t.y - h.y), t.x - h.x) * 180 / Math.PI;
    }

    function computeBrowDensity(img, upperIndices, lowerIndices) {
        const upper = getAveragePoint(upperIndices);
        const lower = getAveragePoint(lowerIndices);
        const cx = (upper.x + lower.x) * 0.5;
        const cy = (upper.y + lower.y) * 0.5;

        const thickness = Math.max(8, computeBrowThickness(upperIndices, lowerIndices) * 0.55);

        let browSum = 0;
        let skinSum = 0;
        let browCount = 0;
        let skinCount = 0;

        for (let dy = -Math.round(thickness); dy <= Math.round(thickness); dy++) {
            for (let dx = -60; dx <= 60; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                const g = sampleGray(img, x, y);
                browSum += g;
                browCount++;
            }
        }

        for (let dy = Math.round(thickness * 1.8); dy <= Math.round(thickness * 3.2); dy++) {
            for (let dx = -60; dx <= 60; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                const g = sampleGray(img, x, y);
                skinSum += g;
                skinCount++;
            }
        }

        const browMean = browSum / Math.max(1, browCount);
        const skinMean = skinSum / Math.max(1, skinCount);

        return clamp((skinMean - browMean) / 80, 0, 1);
    }

    function updateBrowMetrics() {
        const img = originalCtx.getImageData(0, 0, TARGET_W, TARGET_H);

        const faceLeft = getLm(234);
        const faceRight = getLm(454);
        const faceWidth = Math.max(1, Math.abs(faceRight.x - faceLeft.x));

        const leftHead = getLm(LEFT_BROW_HEAD);
        const leftTail = getLm(LEFT_BROW_TAIL);
        const rightHead = getLm(RIGHT_BROW_HEAD);
        const rightTail = getLm(RIGHT_BROW_TAIL);

        const leftLen = Math.hypot(leftTail.x - leftHead.x, leftTail.y - leftHead.y);
        const rightLen = Math.hypot(rightTail.x - rightHead.x, rightTail.y - rightHead.y);
        const browLengthRatio = ((leftLen + rightLen) * 0.5) / faceWidth;

        const leftThickness = computeBrowThickness(LEFT_BROW_UPPER, LEFT_BROW_LOWER);
        const rightThickness = computeBrowThickness(RIGHT_BROW_UPPER, RIGHT_BROW_LOWER);
        const browThickness = (leftThickness + rightThickness) * 0.5;

        const leftAngle = computeBrowAngle(LEFT_BROW_HEAD, LEFT_BROW_TAIL);
        const rightAngle = computeBrowAngle(RIGHT_BROW_HEAD, RIGHT_BROW_TAIL);
        const browAngle = (leftAngle + rightAngle) * 0.5;

        const leftDensity = computeBrowDensity(img, LEFT_BROW_UPPER, LEFT_BROW_LOWER);
        const rightDensity = computeBrowDensity(img, RIGHT_BROW_UPPER, RIGHT_BROW_LOWER);
        const browDensity = (leftDensity + rightDensity) * 0.5;

        const elLength = document.getElementById("metricBrowLength");
        const elThickness = document.getElementById("metricBrowThickness");
        const elAngle = document.getElementById("metricBrowAngle");
        const elDensity = document.getElementById("metricBrowDensity");

        if (elLength) elLength.textContent = browLengthRatio.toFixed(3);
        if (elThickness) elThickness.textContent = browThickness.toFixed(1);
        if (elAngle) elAngle.textContent = browAngle.toFixed(1);
        if (elDensity) elDensity.textContent = browDensity.toFixed(3);
    }

    window.updateBrowMetrics = updateBrowMetrics;
})();