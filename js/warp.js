(function () {
    function clearMask() {
        maskCtx.clearRect(0, 0, TARGET_W, TARGET_H);
    }

    function drawPolygonPath(ctx, points) {
        if (!points || !points.length) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
    }

    function getPoints(indices) {
        return indices.map(function (idx) { return getLm(idx); });
    }

    function buildFaceMask() {
        clearMask();
        if (!window.landmarks || !window.landmarks.length) return;

        const pts = getPoints(FACE_OVAL);

        maskCtx.save();
        maskCtx.fillStyle = "#fff";
        drawPolygonPath(maskCtx, pts);
        maskCtx.fill();
        maskCtx.restore();
    }

    function buildLipMask() {
        clearMask();
        if (!window.landmarks || !window.landmarks.length) return;

        const outer = getPoints(OUTER_LIPS);
        const inner = getPoints(INNER_LIPS);

        maskCtx.save();
        maskCtx.fillStyle = "#fff";
        drawPolygonPath(maskCtx, outer);
        maskCtx.fill();

        maskCtx.globalCompositeOperation = "destination-out";
        drawPolygonPath(maskCtx, inner);
        maskCtx.fill();
        maskCtx.restore();
    }

    window.clearMask = clearMask;
    window.drawPolygonPath = drawPolygonPath;
    window.getPoints = getPoints;
    window.buildFaceMask = buildFaceMask;
    window.buildLipMask = buildLipMask;
})();