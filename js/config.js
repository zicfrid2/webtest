(function () {
    window.DB_NAME = "CaptureImageDB";
    window.STORE_NAME = "images";
    window.IMAGE_KEY = "capturedImage";
    window.META_KEY = "capturedMeta";

    window.TARGET_W = 2208;
    window.TARGET_H = 3306;

    window.IDX_LEFT_CORNER = 61;
    window.IDX_RIGHT_CORNER = 291;

    window.LEFT_EYE_TOP = 159;
    window.LEFT_EYE_BOTTOM = 145;
    window.RIGHT_EYE_TOP = 386;
    window.RIGHT_EYE_BOTTOM = 374;
    window.LEFT_EYE_OUTER = 33;
    window.LEFT_EYE_INNER = 133;
    window.RIGHT_EYE_OUTER = 362;
    window.RIGHT_EYE_INNER = 263;

    window.LEFT_IRIS = [468, 469, 470, 471, 472];
    window.RIGHT_IRIS = [473, 474, 475, 476, 477];

    window.NOSE_LEFT = 98;
    window.NOSE_RIGHT = 327;
    window.NOSE_LEFT_WING = 49;
    window.NOSE_RIGHT_WING = 279;
    window.NOSE_TIP = 1;
    window.NOSE_BRIDGE_UP = 168;
    window.NOSE_BRIDGE_MID = 6;
    window.NOSE_BASE = 2;

    window.JAW_LEFT = 234;
    window.JAW_RIGHT = 454;

    window.FACE_OVAL = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
        361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
        176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
        162, 21, 54, 103, 67, 109
    ];

    window.OUTER_LIPS = [
        61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
        291, 409, 270, 269, 267, 0, 37, 39, 40, 185
    ];

    window.INNER_LIPS = [
        78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
        308, 415, 310, 311, 312, 13, 82, 81, 80, 191
    ];

    window.UPPER_LIP_CENTER = 13;
    window.LOWER_LIP_CENTER = 14;
    window.LEFT_MOUTH_CORNER = 61;
    window.RIGHT_MOUTH_CORNER = 291;

    // Brow landmark groups
    window.LEFT_BROW = [70, 63, 105, 66, 107];
    window.RIGHT_BROW = [336, 296, 334, 293, 300];
    window.LEFT_BROW_HEAD = 70;
    window.LEFT_BROW_TAIL = 107;
    window.RIGHT_BROW_HEAD = 336;
    window.RIGHT_BROW_TAIL = 300;

    window.LEFT_BROW_UPPER = [70, 63, 105, 66, 107];
    window.LEFT_BROW_LOWER = [52, 53, 46, 124, 35];
    window.RIGHT_BROW_UPPER = [336, 296, 334, 293, 300];
    window.RIGHT_BROW_LOWER = [282, 283, 276, 353, 265];

    window.DEFAULT_CONTROL_STATE = {
        faceLively: 0.35,
        blemishRemove: 0.32,
        faceSharpen: 0.34,

        eyeOpenAuto: 0.38,
        eyeLine: 0.30,
        irisDeepen: 0.24,

        noseContour: 0.34,
        noseBridgeHighlight: 0.28,

        smileLift: 0.36,
        lipVitality: 0.28,

        browBalance: 0.40,
        browTailLift: 0.32,
        browDensityEven: 0.38
    };
})();