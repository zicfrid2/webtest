require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const OpenAI = require("openai");
const { Pool } = require("pg");
const processRouter = require("./api/process");

const app = express();
const PORT = process.env.PORT || 3000;

//const trainingRoutes = require("./api/trainingRoutes");

// -------------------- 필수 환경변수 체크 --------------------
if (!process.env.OPENAI_API_KEY) {
    console.error("[ENV ERROR] OPENAI_API_KEY 가 .env에 없습니다.");
}
if (!process.env.DB_USER) {
    console.error("[ENV ERROR] DB_USER 가 .env에 없습니다.");
}
if (!process.env.DB_HOST) {
    console.error("[ENV ERROR] DB_HOST 가 .env에 없습니다.");
}
if (!process.env.DB_NAME) {
    console.error("[ENV ERROR] DB_NAME 가 .env에 없습니다.");
}
if (!process.env.DB_PASSWORD) {
    console.error("[ENV ERROR] DB_PASSWORD 가 .env에 없습니다.");
}
if (!process.env.DB_PORT) {
    console.error("[ENV ERROR] DB_PORT 가 .env에 없습니다.");
}

// -------------------- 카카오 환경변수 체크 --------------------
if (!process.env.KAKAO_REST_API_KEY) {
    console.warn("[ENV WARN] KAKAO_REST_API_KEY 가 .env에 없습니다.");
}
if (!process.env.KAKAO_REDIRECT_URI) {
    console.warn("[ENV WARN] KAKAO_REDIRECT_URI 가 .env에 없습니다.");
}

// -------------------- 기본 설정 --------------------
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
app.use(express.static(path.resolve(".")));
app.use("/uploads", express.static(path.resolve("uploads")));
//app.use(trainingRoutes);

fs.mkdirSync("uploads", { recursive: true });

// -------------------- OpenAI --------------------
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// -------------------- PostgreSQL --------------------
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT)
});

// -------------------- 파일 업로드 --------------------
const MIME_TO_EXT = {
    "audio/webm": ".webm",
    "audio/webm;codecs=opus": ".webm",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac"
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => {
        const ext =
            path.extname(file.originalname || "").toLowerCase() ||
            MIME_TO_EXT[file.mimetype] ||
            ".webm";

        cb(null, `audio-${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }
});

// -------------------- DB 연결 테스트 --------------------
app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW() AS now");
        return res.json({
            ok: true,
            now: result.rows[0].now
        });
    } catch (error) {
        console.error("DB test error:", error);
        return res.status(500).json({
            ok: false,
            error: "db_connection_failed",
            message: error.message
        });
    }
});

// -------------------- 구글 로그인 유저 저장/갱신 --------------------
app.post("/api/users/google-login", async (req, res) => {
    try {
        const { google_id, email, name, profile_image } = req.body;

        if (!google_id || !email) {
            return res.status(400).json({
                ok: false,
                error: "missing_google_id_or_email"
            });
        }

        const result = await pool.query(
            `
      INSERT INTO users (google_id, email, name, profile_image)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email)
      DO UPDATE SET
        google_id = EXCLUDED.google_id,
        name = EXCLUDED.name,
        profile_image = EXCLUDED.profile_image
      RETURNING id, google_id, kakao_id, naver_id, email, name, profile_image, created_at
      `,
            [google_id, email, name || null, profile_image || null]
        );

        return res.json({
            ok: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Google login save error:", error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

// -------------------- 카카오 로그인 유저 저장/갱신 --------------------
app.post("/api/users/kakao-login", async (req, res) => {
    try {
        const { kakao_id, email, name, profile_image } = req.body;

        if (!kakao_id) {
            return res.status(400).json({
                ok: false,
                error: "missing_kakao_id"
            });
        }

        // 이메일이 있으면 email 기준으로 기존 유저와 병합
        if (email) {
            const result = await pool.query(
                `
INSERT INTO users (kakao_id, email, name, profile_image)
VALUES ($1, COALESCE($2, ''), $3, $4)
ON CONFLICT (kakao_id)
DO UPDATE SET
  email = COALESCE(EXCLUDED.email, ''),
  name = EXCLUDED.name,
  profile_image = EXCLUDED.profile_image
RETURNING id, google_id, kakao_id, naver_id, email, name, profile_image, created_at
        `,
                [kakao_id, email, name || null, profile_image || null]
            );

            return res.json({
                ok: true,
                user: result.rows[0]
            });
        }

        // 이메일이 없으면 kakao_id 기준으로 저장/갱신
        const result = await pool.query(
            `
      INSERT INTO users (kakao_id, email, name, profile_image)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (kakao_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        profile_image = EXCLUDED.profile_image
      RETURNING id, google_id, kakao_id, naver_id, email, name, profile_image, created_at
      `,
            [kakao_id, null, name || null, profile_image || null]
        );

        return res.json({
            ok: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Kakao login save error:", error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

// -------------------- 유저 목록 확인용 --------------------
app.get("/api/users", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT id, google_id, kakao_id, naver_id, email, name, profile_image, created_at
      FROM users
      ORDER BY id DESC
    `);

        return res.json({
            ok: true,
            users: result.rows
        });
    } catch (error) {
        console.error("Users fetch error:", error);
        return res.status(500).json({
            ok: false,
            error: "users_fetch_failed",
            message: error.message
        });
    }
});

// -------------------- 네이버 로그인 유저 저장/갱신 --------------------
app.post("/api/users/naver-login", async (req, res) => {
    try {
        const { naver_id, email, name, profile_image } = req.body;

        if (!naver_id) {
            return res.status(400).json({
                ok: false,
                error: "missing_naver_id"
            });
        }

        const result = await pool.query(
            `
      INSERT INTO users (naver_id, email, name, profile_image)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (naver_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        profile_image = EXCLUDED.profile_image
      RETURNING id, google_id, kakao_id, naver_id, email, name, profile_image, created_at
      `,
            [naver_id, email || null, name || null, profile_image || null]
        );

        return res.json({
            ok: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Naver login save error:", error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

// -------------------- 카카오 설정 확인용 --------------------
app.get("/api/auth/kakao-config", (req, res) => {
    return res.json({
        ok: true,
        hasRestApiKey: !!process.env.KAKAO_REST_API_KEY,
        redirectUri: process.env.KAKAO_REDIRECT_URI || "",
        restApiKey: process.env.KAKAO_REST_API_KEY || ""
    });
});

// -------------------- STT --------------------
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
    let uploadedPath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: "audio_file_missing" });
        }

        uploadedPath = req.file.path;

        const transcription = await client.audio.transcriptions.create({
            file: fs.createReadStream(uploadedPath),
            model: "gpt-4o-mini-transcribe",
            language: "ko"
        });

        return res.json({ text: transcription.text || "" });
    } catch (error) {
        console.error("Transcription error:", error);
        return res.status(500).json({
            error: "transcription_failed",
            message: error.message
        });
    } finally {
        if (uploadedPath && fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
        }
    }
});

/////////////
app.post("/api/training-results", async (req, res) => {
    try {
        const {
            user_id,
            training_type,
            level_no,
            stage_no,
            score1,
            grade,
            score2
        } = req.body;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                message: "user_id 없음"
            });
        }

        const query = `
            INSERT INTO training_results
            (user_id, training_type, level_no, stage_no, score1, grade, score2)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        await pool.query(query, [
            user_id,
            training_type,
            level_no,
            stage_no,
            score1,
            grade,
            score2
        ]);

        return res.json({ ok: true });
    } catch (error) {
        console.error("training-results 저장 오류:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

const forwardingStore = new Map();

function parseTotalAIScoreFromResult(text) {
    if (!text) return 0;

    const patterns = [
        /점수\s*[:：]?\s*(\d+(?:\.\d+)?)\s*점/i
    ];

    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (match && match[1] != null) {
            return Number(match[1]) || 0;
        }
    }

    return 0;
}

// -------------------- 분석 --------------------
app.post("/api/analyze", async (req, res) => {
    //console.log("[SERVER] /api/analyze 진입");
    try {
        const { prompt, transcript, speechInsightsText, speechInsights, forwardingId } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "missing_prompt" });
        }

        const inputText = `
${prompt}

[면접 답변 텍스트]
${transcript || "없음"}
`;

        const response = await client.responses.create({
            model: "gpt-4o-mini",
            input: inputText
        });

        let resultText = response.output_text || "";

        // 🔥 핵심: 줄바꿈을 아예 <br>로 바꿔서 보낸다
        resultText = resultText.replace(/\n/g, "<br>");

        // 🔥 여기 추가 (메모리 저장)
        if (forwardingId && forwardingStore) {
            forwardingStore.set(forwardingId, {
                ok: true,
                result: resultText
            });
        }

        return res.json({
            ok: true,
            result: resultText
        });

    } catch (error) {
        console.error("Analyze error:", error);

        // 🔥 실패도 저장 (선택)
        if (req.body.forwardingId && forwardingStore) {
            forwardingStore.set(req.body.forwardingId, {
                ok: false,
                result: ""
            });
        }

        return res.status(500).json({
            ok: false,
            error: "analyze_failed",
            message: error.message
        });
    }
});

// -------------------- process.js 라우터 연결 --------------------
app.use("/", processRouter);

// -------------------- 상태 확인용 --------------------
app.get("/", (req, res) => {
    res.send("Server normal");
});

// -------------------- 실행 --------------------
app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
});