/* =============================================================================
   charts.js — Chart.js panels
   Chart A: assets by risk zone (horizontal bar)
   Chart B: index-polygon distribution by class for the active component (donut)
   ========================================================================== */

const Charts = (() => {

  let barChart = null;
  let donutChart = null;
  const configs = {};        // last config per chart, kept for high-res export

  const FONT = "Calibre, 'Noto Sans', Arial, Helvetica, sans-serif";
  const INK = "#263238";
  const MUTED = "#617076";
  const GRID = "#ebf0f8";

  Chart.defaults.font.family = FONT;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = MUTED;

  /* --------------------------------------- Chart A — assets by risk zone */

  function renderAssetRiskChart(canvasId, assetStats, assetLabel) {
    const labels = CRVA_CONFIG.classes.map(c => c.label);
    const data = CRVA_CONFIG.classes.map(c => assetStats.byClass[c.value] || 0);
    const colors = CRVA_CONFIG.classes.map(c => DataService.colorForClass(c.value, "risk"));
    const total = data.reduce((a, b) => a + b, 0);

    const cfg = {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: assetLabel,
          data,
          backgroundColor: colors,
          borderColor: "#ffffff",
          borderWidth: 1,
          borderRadius: 3,
          barThickness: 18
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 34 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total ? ((ctx.parsed.x / total) * 100).toFixed(1) : "0.0";
                return ` ${ctx.parsed.x} (${pct}%)`;
              }
            }
          },
          // count + % printed at the end of each bar
          datalabels: false
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: GRID, drawBorder: false },
            ticks: { precision: 0 }
          },
          y: { grid: { display: false }, ticks: { color: INK } }
        }
      },
      plugins: [{
        id: "barValueLabels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const v = data[i];
            const pct = total ? ((v / total) * 100).toFixed(1) : "0.0";
            ctx.save();
            ctx.fillStyle = INK;
            ctx.font = `600 10px ${FONT}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`${v} · ${pct}%`, bar.x + 6, bar.y);
            ctx.restore();
          });
        }
      }]
    };

    if (barChart) barChart.destroy();
    barChart = new Chart(document.getElementById(canvasId), cfg);
    configs.assets = cfg;
  }

  /* -------------------------- Chart B — polygon distribution by class */

  function renderClassDonut(canvasId, distribution, componentKey) {
    const { dist, noData } = distribution;
    const labels = CRVA_CONFIG.classes.map(c => c.label);
    const data = CRVA_CONFIG.classes.map(c => dist[c.value] || 0);
    const colors = CRVA_CONFIG.classes.map(c => DataService.colorForClass(c.value, componentKey));

    if (noData > 0) {
      labels.push("No data");
      data.push(noData);
      colors.push(CRVA_CONFIG.noDataColor);
    }
    const total = data.reduce((a, b) => a + b, 0);

    const cfg = {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: "#ffffff",
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: {
          legend: {
            position: "right",
            labels: { boxWidth: 10, boxHeight: 10, padding: 8, usePointStyle: true, pointStyle: "rectRounded" }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : "0.0";
                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
            }
          }
        }
      }
    };

    if (donutChart) donutChart.destroy();
    donutChart = new Chart(document.getElementById(canvasId), cfg);
    configs.classes = cfg;
  }

  /* ----------------------------------------------------------- PNG export */

  /** White background — canvases are transparent by default, which looks
      broken when pasted into PowerPoint or Word. */
  const whiteBackground = {
    id: "whiteBackground",
    beforeDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };

  /**
   * Re-render a chart at print resolution and return a PNG data URL.
   *
   * Three things this has to get right, all of which bite if ignored:
   *  - the canvas must be IN the document, or Chart.js measures it as 0x0 and
   *    the image comes back blank. It is parked off-screen, not detached.
   *  - the data must be a deep copy. Chart.js writes internal metadata onto the
   *    dataset objects of the live chart, and handing those same objects to a
   *    second Chart instance throws.
   *  - the canvas is transparent by default, which looks broken on a white
   *    slide, so a white background is composited underneath.
   *
   * key: "assets" | "classes"
   */
  function chartImage(key, { width = 780, height = 340, scale = 3 } = {}) {
    const cfg = configs[key];
    if (!cfg) {
      console.warn(`[charts] No chart to export for "${key}".`);
      return null;
    }

    // Off-screen host: in the DOM (so Chart.js can measure it) but not visible.
    const host = document.createElement("div");
    host.style.cssText =
      `position:fixed; left:-99999px; top:0; width:${width}px; height:${height}px;`;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    host.appendChild(canvas);
    document.body.appendChild(host);

    let url = null;
    let tmp = null;

    try {
      tmp = new Chart(canvas, {
        type: cfg.type,
        data: JSON.parse(JSON.stringify(cfg.data)),   // deep copy, plain values only
        plugins: [...(cfg.plugins || []), whiteBackground],
        options: {
          ...cfg.options,
          responsive: false,
          maintainAspectRatio: false,
          animation: false,
          devicePixelRatio: scale,
          plugins: { ...(cfg.options.plugins || {}) }
        }
      });

      tmp.update("none");                 // draw synchronously, no animation
      url = tmp.toBase64Image("image/png", 1);
    } catch (err) {
      console.error(`[charts] Export of "${key}" failed:`, err);
      url = null;
    } finally {
      if (tmp) tmp.destroy();
      host.remove();
    }

    return url;
  }

  /** Download one chart as a PNG. Returns false if the export failed. */
  function downloadChart(key, filename, size) {
    const url = chartImage(key, size);
    if (!url) return false;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }

  function destroyAll() {
    if (barChart) { barChart.destroy(); barChart = null; }
    if (donutChart) { donutChart.destroy(); donutChart = null; }
  }

  return {
    renderAssetRiskChart, renderClassDonut, destroyAll,
    chartImage, downloadChart
  };
})();
