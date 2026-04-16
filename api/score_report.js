require("dotenv").config();

const express = require("express");
const path = require("path");

module.exports = function createScoreReportRouter(pool) {
    const router = express.Router();

    // process.js와 같은 메모리 저장소 패턴
    const scoreReportStore = new Map();

    function escapeHtml(value = "") {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function safeSerializeForInlineScript(value) {
        return JSON.stringify(value ?? null)
            .replace(/</g, "\\u003C")
            .replace(/>/g, "\\u003E")
            .replace(/&/g, "\\u0026")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029");
    }

    function toNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function clampPercent(value) {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    function toPercentByKey(row, key) {
        const v = toNumber(row?.[key], 0);

        if (key === "total_score") return clampPercent(v);
        if (key === "impression_score") return clampPercent((v / 50) * 100);
        if (key === "voice_score") return clampPercent((v / 20) * 100);
        if (key === "content_score") return clampPercent((v / 20) * 100);
        if (key === "impression_gaze_score") return clampPercent((v / 28) * 100);

        return clampPercent(v);
    }

    function formatDateLabel(value) {
        const d = new Date(value);
        if (!Number.isFinite(d.getTime())) return "-";

        const yy = String(d.getFullYear()).slice(2);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");

        return yy + "." + mm + "." + dd;
    }

    function normalizeInterviewRows(rows) {
        return (rows || []).map((row) => ({
            id: row.id,
            analyzed_at: row.analyzed_at,
            label: formatDateLabel(row.analyzed_at),

            total_score: toNumber(row.total_score),
            impression_score: toNumber(row.impression_score),
            voice_score: toNumber(row.voice_score),
            content_score: toNumber(row.content_score),
            impression_gaze_score: toNumber(row.impression_gaze_score),

            total_percent: toPercentByKey(row, "total_score"),
            impression_percent: toPercentByKey(row, "impression_score"),
            gaze_percent: toPercentByKey(row, "impression_gaze_score"),
            voice_percent: toPercentByKey(row, "voice_score"),
            content_percent: toPercentByKey(row, "content_score")
        }));
    }

    function renderScoreReportPage(id, item) {
        return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>면접관 시점 리포트</title>

  <style>
    :root {
      --bg-1: #f7fbff;
      --bg-2: #e8f2ff;
      --bg-3: #dcecff;
      --navy: #162a5f;
      --blue: #2f73d9;
      --text: #223253;
      --muted: #6c7a98;
      --shadow-lg: 0 18px 34px rgba(24,42,92,0.12);
      --radius-2xl: 28px;
      --radius-xl: 22px;
      --page-max: 760px;
    }

    * { box-sizing: border-box; min-width: 0; }

    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background: linear-gradient(180deg, var(--bg-1), var(--bg-2) 42%, var(--bg-3));
      color: var(--text);
      font-family: "Pretendard","Noto Sans KR",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    }

    .page {
      width: 100%;
      min-height: 100dvh;
      padding: 8px 8px 20px;
      display: flex;
      justify-content: center;
    }

    .content {
      width: 100%;
      max-width: var(--page-max);
      display: grid;
      gap: 14px;
    }

    .hero {
      padding: 18px 16px;
      border-radius: var(--radius-2xl);
      color: #fff;
      background: linear-gradient(135deg, #2f73d9 0%, #76adff 55%, #9ec5ff 100%);
      box-shadow: var(--shadow-lg);
    }

    .hero h1 {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.2;
      font-weight: 900;
      letter-spacing: -0.03em;
    }

    .hero p {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      font-weight: 700;
      opacity: 0.96;
    }

    .section {
      background: rgba(255,255,255,0.96);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      padding: 16px;
      overflow: hidden;
    }

    .section-title {
      margin: 0 0 4px;
      font-size: 21px;
      line-height: 1.3;
      font-weight: 900;
      color: var(--navy);
    }

    .section-subtitle {
      margin: 0 0 14px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--muted);
      font-weight: 800;
    }

    .tab-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }

    .metric-tab {
      appearance: none;
      border: 0;
      cursor: pointer;
      border-radius: 999px;
      padding: 10px 14px;
      background: #edf4ff;
      color: var(--navy);
      font-size: 13px;
      font-weight: 900;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
    }

    .metric-tab.active {
      background: linear-gradient(180deg, #76adff 0%, #2f73d9 100%);
      color: #fff;
      box-shadow: 0 10px 18px rgba(47,115,217,0.22);
    }

    .chart-card {
      padding: 14px;
      border-radius: 18px;
      background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
    }

    .chart-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .chart-meta-title {
      font-size: 15px;
      font-weight: 900;
      color: var(--navy);
    }

    .chart-meta-value {
      font-size: 14px;
      font-weight: 900;
      color: var(--blue);
      white-space: nowrap;
    }

    .chart-wrap {
      position: relative;
      width: 100%;
      height: 280px;
    }

    .empty-box {
      border-radius: 18px;
      padding: 24px 18px;
      text-align: center;
      background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.08);
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
      font-weight: 800;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }

    .summary-card {
      padding: 12px;
      border-radius: 16px;
      background: #f8fbff;
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.06);
    }

    .summary-label {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
      color: var(--muted);
      margin-bottom: 6px;
    }

    .summary-value {
      font-size: 20px;
      line-height: 1.2;
      font-weight: 900;
      color: var(--navy);
    }

    .block-title {
      margin: 0 0 10px;
      font-size: 17px;
      line-height: 1.35;
      font-weight: 900;
      color: var(--navy);
    }

    .soon-box {
      border-radius: 18px;
      padding: 18px 16px;
      background: linear-gradient(180deg, #ffffff 0%, #f4f9ff 100%);
      box-shadow: inset 0 0 0 1px rgba(47,115,217,0.06);
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
      font-weight: 800;
    }

    @media (max-width: 640px) {
      .page { padding: 6px 4px 18px; }
      .content { gap: 10px; }
      .hero, .section { border-radius: 18px; padding: 14px; }
      .hero h1 { font-size: 24px; }
      .chart-wrap { height: 240px; }
      .summary-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="content">
      <section class="hero">
        <h1>면접관 시점 리포트</h1>
        <p>3초진단 모의면접과 훈련 기록을 날짜별 변화 그래프로 확인하세요.</p>
      </section>

      <section class="section">
        <h2 class="section-title">3초진단 모의면접</h2>
        <p class="section-subtitle">날짜별 백분위 환산 점수 변화를 그래프로 확인할 수 있습니다.</p>

        <div class="tab-row" id="metricTabs">
          <button class="metric-tab active" data-key="total_percent" data-label="총점">총점</button>
          <button class="metric-tab" data-key="impression_percent" data-label="인상">인상</button>
          <button class="metric-tab" data-key="gaze_percent" data-label="시선">시선</button>
          <button class="metric-tab" data-key="voice_percent" data-label="음성">음성</button>
          <button class="metric-tab" data-key="content_percent" data-label="내용">내용</button>
        </div>

        <div id="mockInterviewChartArea" class="chart-card" style="${item.interviewItems?.length ? "display:block;" : "display:none;"}">
          <div class="chart-meta">
            <div class="chart-meta-title" id="chartMetricTitle">총점 변화</div>
            <div class="chart-meta-value" id="chartLatestValue">-</div>
          </div>

          <div class="chart-wrap">
            <canvas id="scoreLineChart"></canvas>
          </div>

          <div class="summary-grid">
            <div class="summary-card">
              <div class="summary-label">최근 점수</div>
              <div class="summary-value" id="summaryLatest">-</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">최고 점수</div>
              <div class="summary-value" id="summaryBest">-</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">응시 횟수</div>
              <div class="summary-value" id="summaryCount">-</div>
            </div>
          </div>
        </div>

        <div id="mockInterviewEmpty" class="empty-box" style="${item.interviewItems?.length ? "display:none;" : "display:block;"}">
          아직 표시할 모의면접 기록이 없습니다.<br />
          기록이 쌓이면 날짜별 변화 그래프가 여기에 표시됩니다.
        </div>
      </section>

      <section class="section">
        <h2 class="block-title">훈련 점수</h2>
        <div class="soon-box">
          훈련 점수 섹션은 다음 단계에서 연결됩니다.<br />
          현재는 먼저 interview_scores 기반의 3초진단 모의면접 변화 그래프를 표시합니다.
        </div>
      </section>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    (function () {
      let chart = null;
      let scoreItems = ${safeSerializeForInlineScript(item.interviewItems || [])};
      let currentMetricKey = "total_percent";
      let currentMetricLabel = "총점";

      const metricTabsEl = document.getElementById("metricTabs");
      const chartMetricTitleEl = document.getElementById("chartMetricTitle");
      const chartLatestValueEl = document.getElementById("chartLatestValue");
      const summaryLatestEl = document.getElementById("summaryLatest");
      const summaryBestEl = document.getElementById("summaryBest");
      const summaryCountEl = document.getElementById("summaryCount");
      const canvas = document.getElementById("scoreLineChart");

      function clampPercent(value) {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
      }

      function formatPercentText(value) {
        return Math.round(clampPercent(value)) + "점";
      }

      function renderChart() {
        if (!scoreItems.length || !canvas) return;

        const labels = scoreItems.map(function (item) {
          return item.label || "-";
        });

        const values = scoreItems.map(function (item) {
          return clampPercent(item[currentMetricKey]);
        });

        const latestValue = values.length ? values[values.length - 1] : 0;
        const bestValue = values.length ? Math.max.apply(null, values) : 0;

        if (chartMetricTitleEl) chartMetricTitleEl.textContent = currentMetricLabel + " 변화";
        if (chartLatestValueEl) chartLatestValueEl.textContent = "최근 " + formatPercentText(latestValue);
        if (summaryLatestEl) summaryLatestEl.textContent = formatPercentText(latestValue);
        if (summaryBestEl) summaryBestEl.textContent = formatPercentText(bestValue);
        if (summaryCountEl) summaryCountEl.textContent = String(scoreItems.length);

        if (chart) {
          chart.destroy();
          chart = null;
        }

        chart = new Chart(canvas, {
          type: "line",
          data: {
            labels: labels,
            datasets: [
              {
                label: currentMetricLabel,
                data: values,
                borderColor: "#2f73d9",
                backgroundColor: "rgba(47,115,217,0.14)",
                pointBackgroundColor: "#2f73d9",
                pointBorderColor: "#ffffff",
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 5,
                borderWidth: 3,
                tension: 0.32,
                fill: true
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                callbacks: {
                  label: function (context) {
                    return currentMetricLabel + " " + formatPercentText(context.parsed.y);
                  }
                }
              }
            },
            scales: {
              y: {
                min: 0,
                max: 100,
                ticks: {
                  stepSize: 20,
                  callback: function (value) {
                    return value + "점";
                  }
                },
                grid: {
                  color: "rgba(47,115,217,0.08)"
                }
              },
              x: {
                ticks: {
                  maxRotation: 0,
                  minRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: 6
                },
                grid: {
                  display: false
                }
              }
            }
          }
        });
      }

      function bindTabs() {
        if (!metricTabsEl) return;

        metricTabsEl.addEventListener("click", function (event) {
          const button = event.target.closest(".metric-tab");
          if (!button) return;

          currentMetricKey = button.getAttribute("data-key") || "total_percent";
          currentMetricLabel = button.getAttribute("data-label") || "총점";

          Array.prototype.forEach.call(metricTabsEl.querySelectorAll(".metric-tab"), function (tab) {
            tab.classList.toggle("active", tab === button);
          });

          renderChart();
        });
      }

      bindTabs();
      renderChart();
    })();
  </script>
</body>
</html>`;
    }

    router.get("/score-report/:id", (req, res) => {
        const item = scoreReportStore.get(req.params.id);

        if (!item) {
            return res
                .status(404)
                .type("text/plain; charset=utf-8")
                .send("score report data not found");
        }

        res.status(200);
        res.set("Content-Type", "text/html; charset=utf-8");
        res.set("X-Content-Type-Options", "nosniff");
        return res.send(renderScoreReportPage(req.params.id, item));
    });

    router.post("/api/score_report", async (req, res) => {
        try {
            const userId = Number(req.body.user_id || 0);

            if (!userId) {
                return res.status(400).json({
                    ok: false,
                    error: "user_id 없음"
                });
            }

            const query = `
                SELECT
                    id,
                    user_id,
                    analyzed_at,
                    total_score,
                    impression_score,
                    voice_score,
                    content_score,
                    impression_gaze_score,
                    simul_type
                FROM interview_scores
                WHERE user_id = $1
                  AND simul_type = 0
                ORDER BY analyzed_at ASC, id ASC
            `;

            const result = await pool.query(query, [userId]);
            const rows = normalizeInterviewRows(result.rows || []);

            const reportId =
                Date.now().toString(36) +
                Math.random().toString(36).slice(2, 8);

            scoreReportStore.set(reportId, {
                user_id: userId,
                interviewItems: rows,
                createdAt: new Date().toISOString()
            });

            return res.json({
                ok: true,
                reportUrl: `/score-report/${reportId}`,
                count: rows.length
            });
        } catch (error) {
            console.error("/api/score_report 오류:", error);
            return res.status(500).json({
                ok: false,
                error: error.message || "score_report_failed"
            });
        }
    });

    return router;
};