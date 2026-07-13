/* =============================================================================
   report.js — PDF report builder
   Uses jsPDF + jsPDF-AutoTable (both from CDN). Everything is generated
   client-side from the same state the dashboard is showing, so the report can
   never disagree with the screen.
   ========================================================================== */

const Report = (() => {

  const SEI_GREEN = "#00b180";
  const INK = "#263238";
  const MUTED = "#617076";
  const RULE = "#dde2eb";

  const MARGIN = 15;          // mm
  const PAGE_W = 210;         // A4 portrait
  const PAGE_H = 297;
  const BODY_W = PAGE_W - MARGIN * 2;

  /* --------------------------------------------------------------- helpers */

  function hasLibs() {
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  /**
   * Rasterise the SVG logo so jsPDF can place it — jsPDF cannot embed SVG.
   * The logo has a viewBox but no intrinsic width/height, so the target size is
   * given explicitly. Resolves to null on any failure; the report still builds,
   * just without the mark.
   */
  function logoPNG() {
    return new Promise(resolve => {
      const W = 668, H = 827;                  // 4x the 167 x 206.84 viewBox
      const img = new Image();

      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, W, H);
          resolve({ url: c.toDataURL("image/png"), w: W, h: H });
        } catch (err) {
          console.warn("[report] Logo could not be rasterised:", err);
          resolve(null);
        }
      };

      img.onerror = () => {
        console.warn("[report] assets/sei_logo.svg did not load.");
        resolve(null);
      };

      img.src = "assets/sei_logo.svg";
    });
  }

  const fmt = v => (v === null || v === undefined ? "—"
    : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(4));

  const today = () => new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric"
  });

  /* ----------------------------------------------------------- page chrome */

  function header(doc, logo, ctx) {
    let x = MARGIN;

    if (logo) {
      const h = 11;
      const w = (logo.w / logo.h) * h;
      doc.addImage(logo.url, "PNG", MARGIN, MARGIN - 3, w, h);
      x = MARGIN + w + 6;
    }

    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Nairobi County CRVA", x, MARGIN + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text("Climate Risk and Vulnerability Assessment — NCARP", x, MARGIN + 7);

    doc.setDrawColor(RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, MARGIN + 12, PAGE_W - MARGIN, MARGIN + 12);

    return MARGIN + 20;
  }

  /** Footer with source line and page numbers, stamped on every page at the end. */
  function footers(doc) {
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(MUTED);
      doc.text(
        `Prepared by SEI for the NCARP project · ${CRVA_CONFIG.meta.year}`,
        MARGIN, PAGE_H - 9
      );
      doc.text(`Page ${i} of ${n}`, PAGE_W - MARGIN, PAGE_H - 9, { align: "right" });
    }
  }

  function sectionTitle(doc, text, y) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(INK);
    doc.text(text, MARGIN, y);
    return y + 5;
  }

  function paragraph(doc, text, y, size = 8.5) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(MUTED);
    const lines = doc.splitTextToSize(text, BODY_W);
    doc.text(lines, MARGIN, y);
    return y + lines.length * (size * 0.42) + 3;
  }

  const tableStyle = {
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2, textColor: INK,
              lineColor: RULE, lineWidth: 0.2 },
    headStyles: { fillColor: [0, 177, 128], textColor: 255, fontStyle: "bold",
                  fontSize: 8 },
    alternateRowStyles: { fillColor: [246, 247, 250] },
    margin: { left: MARGIN, right: MARGIN }
  };

  /* ----------------------------------------------------------------- build */

  /**
   * Build and download the report.
   * ctx carries everything the dashboard currently knows:
   *   { hazardLabel, sectorLabel, subsectorLabel, componentLabel, componentKey,
   *     inverted, subsector, features, schemes, assetStats, kpis,
   *     topComponent, topAssets, classDist }
   */
  async function build(ctx) {
    if (!hasLibs()) {
      throw new Error("jsPDF did not load — the report needs the two CDN scripts " +
                      "in index.html. Check your connection and reload.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    if (typeof doc.autoTable !== "function") {
      throw new Error("The jsPDF AutoTable plugin did not load — the report needs " +
                      "it for its tables. Check your connection and reload.");
    }

    const logo = await logoPNG();

    /* ---- page 1 --------------------------------------------------------- */
    let y = header(doc, logo, ctx);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(INK);
    doc.text(`${ctx.subsectorLabel} sector: ${ctx.hazardLabel.toLowerCase()} risk`, MARGIN, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    doc.text(
      `${ctx.hazardLabel} · ${ctx.sectorLabel} · ${ctx.subsectorLabel} — ` +
      `mapped component: ${ctx.componentLabel}. Generated ${today()}.`,
      MARGIN, y
    );
    y += 8;

    /* Key figures */
    y = sectionTitle(doc, "Key figures", y);
    doc.autoTable({
      ...tableStyle,
      startY: y,
      head: [["Indicator", "Value"]],
      body: [
        ["Sublocations analysed", String(ctx.kpis.units)],
        [`${ctx.assetLabel} assessed`, ctx.kpis.assets.toLocaleString()],
        [`${ctx.assetLabel} in very high risk zones`,
         `${ctx.kpis.veryHigh.toLocaleString()}  (${ctx.kpis.veryHighPct}%)`],
        [`${ctx.assetLabel} in high or very high risk zones`,
         `${ctx.kpis.highPlus.toLocaleString()}  (${ctx.kpis.highPlusPct}%)`],
        ["Sublocations with no demographic data",
         String(ctx.schemes[ctx.componentKey].excluded)]
      ],
      columnStyles: { 1: { halign: "right", fontStyle: "bold" } }
    });
    y = doc.lastAutoTable.finalY + 8;

    /* Chart A */
    const barImg = Charts.chartImage("assets", { width: 780, height: 340 });
    if (barImg) {
      y = sectionTitle(doc, `${ctx.assetLabel} by flood risk zone`, y);
      const h = BODY_W * (340 / 780);
      doc.addImage(barImg, "PNG", MARGIN, y, BODY_W, h);
      y += h + 8;
    }

    /* Chart B */
    const donutImg = Charts.chartImage("classes", { width: 780, height: 340 });
    if (donutImg) {
      if (y > PAGE_H - 80) { doc.addPage(); y = header(doc, logo, ctx); }
      y = sectionTitle(doc,
        `Sublocations by ${ctx.componentLabel.toLowerCase()} class`, y);
      const h = BODY_W * (340 / 780);
      doc.addImage(donutImg, "PNG", MARGIN, y, BODY_W, h);
      y += h + 6;
    }

    /* ---- page 2 --------------------------------------------------------- */
    doc.addPage();
    y = header(doc, logo, ctx);

    /* Top 5 by component */
    const titleA = ctx.inverted
      ? "Five sublocations with the lowest adaptive capacity"
      : `Five sublocations with the highest ${ctx.componentLabel.toLowerCase()}`;
    y = sectionTitle(doc, titleA, y);

    doc.autoTable({
      ...tableStyle,
      startY: y,
      head: [["#", "Sublocation", ctx.componentLabel, "Class"]],
      body: ctx.topComponent.map((r, i) => [
        String(i + 1), r.name, fmt(r.value), DataService.classLabel(r.cls)
      ]),
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        2: { halign: "right" },
        3: { cellWidth: 28 }
      }
    });
    y = doc.lastAutoTable.finalY + 9;

    /* Top 5 by very-high-risk assets */
    y = sectionTitle(doc,
      `Five sublocations with the most very-high-risk ${ctx.assetLabel.toLowerCase()}`, y);

    doc.autoTable({
      ...tableStyle,
      startY: y,
      head: [["#", "Sublocation", "Very high risk", "Total", "Share"]],
      body: ctx.topAssets.map((r, i) => [
        String(i + 1), r.name, String(r.value), String(r.total),
        r.total ? `${((r.value / r.total) * 100).toFixed(0)}%` : "—"
      ]),
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }
      }
    });
    y = doc.lastAutoTable.finalY + 9;

    /* Method and caveats */
    y = sectionTitle(doc, "Method and caveats", y);

    const scheme = ctx.schemes[ctx.componentKey];
    const methodText = scheme.method === "pre-classified"
      ? "Index values are supplied pre-classified on a 1–5 scale."
      : `Index values are continuous. The five classes shown are equal-interval ` +
        `breaks cut over the layer minimum and maximum ` +
        `(${fmt(scheme.min)} to ${fmt(scheme.max)} for ${ctx.componentLabel.toLowerCase()}).`;

    y = paragraph(doc, methodText, y);

    if (scheme.excluded > 0) {
      y = paragraph(doc,
        `${scheme.excluded} of ${ctx.features.length} sublocations carry no ` +
        `demographic data. Their sensitivity, adaptive capacity, vulnerability ` +
        `and risk values are absent rather than zero, and they are excluded from ` +
        `classification, charts and rankings. Exposure is independent of ` +
        `population and remains valid for all sublocations.`, y);
    }

    y = paragraph(doc,
      `Adaptive capacity is inverted: a high value is a good outcome. It is ` +
      `symbolised on a reversed ramp so that red always denotes the worst ` +
      `condition, whichever component is mapped, and it is ranked lowest-first.`, y);

    y = paragraph(doc,
      `Health facilities were assigned to sublocations by point-in-polygon ` +
      `overlay rather than by attribute join, as the facility sublocation field ` +
      `is inconsistently named.`, y);

    y = paragraph(doc, `Data sources: ${CRVA_CONFIG.meta.source}.`, y);

    footers(doc);

    const name = `Nairobi_CRVA_${ctx.subsectorLabel}_${ctx.componentLabel}`
      .replace(/\s+/g, "_") + ".pdf";
    doc.save(name);
  }

  return { build, hasLibs };
})();
