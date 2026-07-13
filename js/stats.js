/* =============================================================================
   stats.js — summary statistics, generic rankings, CSV export
   All functions take data + a subsector config; none of them know what a
   "health facility" is.
   ========================================================================== */

const Stats = (() => {

  /* ---------------------------------------------------------- asset counts */

  /**
   * Count assets per parent polygon, broken down by risk class 1-5.
   * Returns { byParent: Map<name, {total, byClass:{1..5}}>, byClass:{1..5}, total }
   */
  function assetSummary(assets, subsector) {
    const riskField = subsector.assetRiskField;
    const byParent = new Map();
    const byClass = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0, unclassified = 0;

    if (!assets) return { byParent, byClass, total, unclassified };

    assets.features.forEach(f => {
      total++;
      const cls = DataService.getField(f, riskField);
      const parent = f.properties.__parent;

      if (cls >= 1 && cls <= 5) byClass[cls]++;
      else unclassified++;

      if (parent) {
        if (!byParent.has(parent)) {
          byParent.set(parent, { total: 0, byClass: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
        }
        const rec = byParent.get(parent);
        rec.total++;
        if (cls >= 1 && cls <= 5) rec.byClass[cls]++;
      }
    });

    return { byParent, byClass, total, unclassified };
  }

  /* ------------------------------------------------------------ KPI values */

  function kpis(indexFeatures, assetStats) {
    const total = assetStats.total || 0;
    const veryHigh = assetStats.byClass[5] || 0;
    const high = assetStats.byClass[4] || 0;
    const pct = n => (total ? ((n / total) * 100).toFixed(1) : "0.0");

    return {
      units: indexFeatures.length,
      assets: total,
      veryHigh, veryHighPct: pct(veryHigh),
      highPlus: high + veryHigh, highPlusPct: pct(high + veryHigh)
    };
  }

  /* --------------------------------------------------- class distributions */

  /** How many polygons fall in each class for the active component. */
  function classDistribution(indexFeatures, subsector, componentKey, scheme) {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let noData = 0;
    indexFeatures.forEach(f => {
      const v = DataService.getComponentValue(f, subsector, componentKey);
      const c = scheme.classOf(v);
      if (c === null) noData++;
      else dist[c]++;
    });
    return { dist, noData };
  }

  /* ------------------------------------------------------ generic rankings */

  /**
   * Generic ranking. `valueOf` maps a feature to a number (or null to skip),
   * `direction` is "desc" (highest first) or "asc" (lowest first).
   * `tieBreakers` is an optional array of extra valueOf functions.
   */
  function rank(features, { valueOf, direction = "desc", limit = 5, tieBreakers = [] }) {
    const rows = [];
    features.forEach(f => {
      const v = valueOf(f);
      if (v === null || v === undefined || !isFinite(v)) return;
      rows.push({ feature: f, value: v, tb: tieBreakers.map(fn => fn(f) || 0) });
    });

    const sign = direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (a.value !== b.value) return sign * (a.value - b.value);
      for (let i = 0; i < a.tb.length; i++) {
        if (a.tb[i] !== b.tb[i]) return b.tb[i] - a.tb[i]; // tie-breakers: high first
      }
      return 0;
    });

    return rows.slice(0, limit);
  }

  /** Top polygons by the selected component (lowest first when inverted). */
  function topByComponent(indexFeatures, subsector, componentKey, scheme, limit = 5) {
    const inverted = DataService.isInverted(componentKey);
    return rank(indexFeatures, {
      valueOf: f => DataService.getComponentValue(f, subsector, componentKey),
      direction: inverted ? "asc" : "desc",
      limit
    }).map(r => ({
      name: DataService.getField(r.feature, subsector.nameField),
      value: r.value,
      cls: scheme.classOf(r.value),
      feature: r.feature
    }));
  }

  /** Top polygons by count of assets in the highest risk class (5). */
  function topByAssetRisk(indexFeatures, subsector, assetStats, limit = 5) {
    const get = (f, cls) => {
      const name = DataService.getField(f, subsector.nameField);
      const rec = assetStats.byParent.get(name);
      if (!rec) return 0;
      return cls === "total" ? rec.total : rec.byClass[cls];
    };

    return rank(indexFeatures, {
      valueOf: f => get(f, 5),
      direction: "desc",
      limit,
      tieBreakers: [f => get(f, 4), f => get(f, "total")]   // level-4 count, then total
    })
      .filter(r => r.value > 0)
      .map(r => ({
        name: DataService.getField(r.feature, subsector.nameField),
        value: r.value,
        total: get(r.feature, "total"),
        feature: r.feature
      }));
  }

  /* ------------------------------------------------------------ CSV export */

  function toCSV(indexFeatures, subsector, schemes, assetStats) {
    const esc = v => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const comps = CRVA_CONFIG.components;
    const header = [subsector.nameField];
    comps.forEach(c => header.push(`${c.label} value`, `${c.label} class`));
    header.push("Assets total");
    CRVA_CONFIG.classes.forEach(c => header.push(`Assets ${c.label} risk`));

    const lines = [header.map(esc).join(",")];

    indexFeatures.forEach(f => {
      const name = DataService.getField(f, subsector.nameField);
      const row = [name];
      comps.forEach(c => {
        const v = DataService.getComponentValue(f, subsector, c.key);
        row.push(v === null ? "" : v);
        row.push(v === null ? "No data" : DataService.classLabel(schemes[c.key].classOf(v)));
      });
      const rec = assetStats.byParent.get(name);
      row.push(rec ? rec.total : 0);
      CRVA_CONFIG.classes.forEach(c => row.push(rec ? rec.byClass[c.value] : 0));
      lines.push(row.map(esc).join(","));
    });

    return lines.join("\n");
  }

  function downloadCSV(text, filename) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    assetSummary, kpis, classDistribution,
    rank, topByComponent, topByAssetRisk,
    toCSV, downloadCSV
  };
})();
