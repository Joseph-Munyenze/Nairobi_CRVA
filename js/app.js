/* =============================================================================
   app.js — state, filter wiring, render orchestration
   ========================================================================== */

(() => {

  /* --------------------------------------------------------------- state */

  const state = {
    hazard: CRVA_CONFIG.defaults.hazard,
    sector: CRVA_CONFIG.defaults.sector,
    subsector: CRVA_CONFIG.defaults.subsector,
    component: CRVA_CONFIG.defaults.component,
    showHazard: true,
    showAssets: true,
    showIndex: true,
    indexOpacity: 0.8,
    basemap: "light",
    focusParent: null,           // sublocation the asset layer is filtered to
    data: {
      index: null,               // index polygon GeoJSON
      assets: null,              // asset point GeoJSON
      hazard: null,              // hazard polygon GeoJSON (fallback, may stay null)
      hazardRaster: null         // parsed hazard GeoTIFF (preferred, may stay null)
    },
    schemes: {},                 // classification per component
    assetStats: null,
    lastStats: null              // rankings + distribution as last rendered
  };

  const $ = id => document.getElementById(id);

  /* --------------------------------------------------------- config access */

  function subsectorCfg() {
    const sector = CRVA_CONFIG.sectors[state.sector];
    if (!sector) return null;
    const sub = sector.subsectors[state.subsector];
    return sub || null;
  }

  function selectionEnabled() {
    const h = CRVA_CONFIG.hazards[state.hazard];
    const s = CRVA_CONFIG.sectors[state.sector];
    const ss = subsectorCfg();
    return !!(h && h.enabled && s && s.enabled && ss && ss.enabled && ss.indexLayer);
  }

  /* -------------------------------------------------------------- filters */

  /** Populate a <select> from a registry object of { key: {label, enabled} }. */
  function fillSelect(el, entries, selected) {
    el.innerHTML = "";
    Object.entries(entries).forEach(([key, node]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = node.enabled ? node.label : `${node.label} — coming soon`;
      opt.disabled = !node.enabled;
      if (!node.enabled) opt.title = "Coming soon";
      if (key === selected) opt.selected = true;
      el.appendChild(opt);
    });
  }

  function buildFilters() {
    fillSelect($("hazardSelect"), CRVA_CONFIG.hazards, state.hazard);

    // Sector select, with a leading "None" option so the user can view a hazard
    // surface on its own without any subsector overlay.
    const secEl = $("sectorSelect");
    secEl.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "__none__";
    noneOpt.textContent = "None — hazard only";
    if (state.sector === "__none__") noneOpt.selected = true;
    secEl.appendChild(noneOpt);
    Object.entries(CRVA_CONFIG.sectors).forEach(([key, node]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = node.enabled ? node.label : `${node.label} — coming soon`;
      opt.disabled = !node.enabled;
      if (key === state.sector) opt.selected = true;
      secEl.appendChild(opt);
    });

    fillSubsectors();
    buildComponentRadios();
  }

  function buildComponentRadios() {
    const wrap = $("componentGroup");
    wrap.innerHTML = "";
    if (state.sector === "__none__") return;   // no components in hazard-only mode
    const comps = DataService.componentsFor(subsectorCfg());
    if (!comps.some(c => c.key === state.component)) {
      state.component = comps[0] ? comps[0].key : state.component;
    }
    comps.forEach(c => {
      const id = `comp_${c.key}`;
      const row = document.createElement("label");
      row.className = "radio-row";
      row.setAttribute("for", id);
      row.innerHTML = `
        <input type="radio" name="component" id="${id}" value="${c.key}"
               ${c.key === state.component ? "checked" : ""}>
        <span class="radio-dot" aria-hidden="true"></span>
        <span class="radio-label">${c.label}</span>
        ${c.inverted ? '<span class="tag-inv" title="High is good — ramp is reversed">inverted</span>' : ""}`;
      row.querySelector("input").addEventListener("change", () => {
        state.component = c.key;
        renderAll({ restyleOnly: true });
      });
      wrap.appendChild(row);
    });
  }

  function fillSubsectors() {
    const subEl = $("subsectorSelect");
    if (state.sector === "__none__") {
      subEl.innerHTML = '<option>—</option>';
      subEl.disabled = true;
      return;
    }
    subEl.disabled = false;
    const sector = CRVA_CONFIG.sectors[state.sector];
    const subs = sector ? sector.subsectors : {};
    const keys = Object.keys(subs);
    if (!keys.includes(state.subsector)) {
      const firstEnabled = keys.find(k => subs[k].enabled);
      state.subsector = firstEnabled || keys[0];
    }
    fillSelect(subEl, subs, state.subsector);
  }

  function wireFilters() {
    $("hazardSelect").addEventListener("change", e => {
      state.hazard = e.target.value;
      loadAndRender();
    });

    $("sectorSelect").addEventListener("change", e => {
      state.sector = e.target.value;
      fillSubsectors();
      buildComponentRadios();
      loadAndRender();
    });

    $("subsectorSelect").addEventListener("change", e => {
      state.subsector = e.target.value;
      loadAndRender();
    });

    $("resetView").addEventListener("click", () => {
      clearFocus();
      MapView.resetView();
    });

    $("clearFocus").addEventListener("click", clearFocus);

    $("downloadCsv").addEventListener("click", () => {
      const ss = subsectorCfg();
      if (!ss || !state.data.index) return;
      const csv = Stats.toCSV(state.data.index.features, ss, state.schemes, state.assetStats);
      const name = `crva_${state.hazard}_${state.sector}_${state.subsector}.csv`;
      Stats.downloadCSV(csv, name);
    });

    // Per-chart PNG buttons in each panel header
    document.querySelectorAll(".btn-png").forEach(btn => {
      btn.addEventListener("click", () => downloadChart(btn.dataset.chart));
    });

    $("downloadPdf").addEventListener("click", downloadReport);
  }

  /* ------------------------------------------------------------- loading */

  /** Layer list for the on-canvas panel — built from config, not hard-coded. */
  function buildControlPanel(ss, haveHazard, hazardPath) {
    const layers = [];
    if (ss) {
      const unitLabel = ss.unitLabel || "Sublocation";
      layers.push({ key: "index", label: `${unitLabel} choropleth`, checked: state.showIndex });
    }
    layers.push({ key: "hazard", label: CRVA_CONFIG.hazards[state.hazard].label,
      checked: state.showHazard && haveHazard,
      disabled: !haveHazard,
      title: haveHazard ? "" : `Add ${hazardPath} to switch this layer on` });
    // Asset toggle only for subsectors that have a point layer
    if (ss && ss.assetLayer) {
      layers.push({ key: "assets", label: ss.assetLabel || "Assets",
        checked: state.showAssets && !!state.data.assets,
        disabled: !state.data.assets });
    }

    MapView.addControlPanel(layers, {
      onBasemap: key => {
        state.basemap = key;
        MapView.setBasemap(key);
      },
      onLayer: (key, on) => {
        if (key === "index")  { state.showIndex = on;  MapView.toggleIndex(on); }
        if (key === "hazard") { state.showHazard = on; MapView.toggleHazard(on);
          if (subsectorCfg()) MapView.restyleIndexLayer(subsectorCfg(), state.component, state.schemes); }
        if (key === "assets") { state.showAssets = on; MapView.toggleAssets(on); }
      },
      onOpacity: v => {
        state.indexOpacity = v;
        if (subsectorCfg()) MapView.setIndexOpacity(v, subsectorCfg(), state.component, state.schemes);
      }
    }, state.basemap, !ss);   // hideOpacity when no choropleth
  }

  function setStatus(kind, message) {
    const el = $("statusBar");
    el.className = `status status-${kind}`;
    el.innerHTML = message;
    el.style.display = message ? "flex" : "none";
  }

  function showEmptyState(show) {
    $("emptyState").style.display = show ? "flex" : "none";
    $("map").style.visibility = show ? "hidden" : "visible";
    $("statsContent").style.display = show ? "none" : "block";
    $("statsEmpty").style.display = show ? "block" : "none";
  }

  async function loadAndRender() {
    MapView.clearAll();
    Charts.destroyAll();
    state.focusParent = null;

    // ---- Hazard-only mode (sector = None): show just the hazard surface ----
    if (state.sector === "__none__") {
      const hz = CRVA_CONFIG.hazards[state.hazard] || {};
      if (!hz.enabled) { showEmptyState(true); setStatus("", ""); return; }
      showEmptyState(false);
      setStatus("loading", '<span class="spinner"></span> Loading hazard…');
      try {
        state.data.index = null;
        state.data.assets = null;
        state.data.hazardRaster = hz.hazardRaster
          ? await DataService.loadRaster(hz.hazardRaster) : null;
        state.data.hazard = (!state.data.hazardRaster && hz.hazardLayer)
          ? await DataService.loadGeoJSON(hz.hazardLayer, { optional: true }) : null;

        const haveHazard = !!(state.data.hazardRaster || state.data.hazard);
        const hzCfg = { ...hz, __id: state.hazard };
        if (state.data.hazardRaster) MapView.renderHazardRaster(state.data.hazardRaster, hzCfg);
        else MapView.renderHazardLayer(state.data.hazard, hzCfg);
        if (haveHazard) MapView.toggleHazard(true);
        MapView.fitToData();

        buildControlPanel(null, haveHazard, hz.hazardRaster || hz.hazardLayer);
        renderHazardOnlyStats(hz);
        MapView.renderHazardLegend(hzCfg);   // legend shows hazard classes
        setStatus(haveHazard ? "" : "warn",
          haveHazard ? "" : "Hazard surface not loaded for this hazard.");
      } catch (err) {
        console.error(err);
        setStatus("error", `Could not load the hazard. ${err.message}`);
        MapView.clearAll();
      }
      return;
    }

    const ss = subsectorCfg();
    if (!selectionEnabled()) {
      showEmptyState(true);
      setStatus("", "");
      return;
    }

    showEmptyState(false);
    setStatus("loading", '<span class="spinner"></span> Loading layers…');

    try {
      // Index layer (required)
      state.data.index = await DataService.loadGeoJSON(ss.indexLayer);

      // Asset layer (optional per subsector)
      state.data.assets = ss.assetLayer
        ? await DataService.loadGeoJSON(ss.assetLayer, { optional: true })
        : null;

      // Hazard surface (optional). A GeoTIFF is preferred; a polygonised
      // GeoJSON is the fallback. Whichever is present wins, raster first.
      const hz = CRVA_CONFIG.hazards[state.hazard] || {};
      state.data.hazardRaster = hz.hazardRaster
        ? await DataService.loadRaster(hz.hazardRaster)
        : null;
      state.data.hazard = (!state.data.hazardRaster && hz.hazardLayer)
        ? await DataService.loadGeoJSON(hz.hazardLayer, { optional: true })
        : null;

      // Spatial join: stamp every asset with its parent polygon name
      if (state.data.assets) {
        DataService.joinPointsToPolygons(
          state.data.assets, state.data.index, ss.nameField
        );
      }

      // Classification for every component this subsector exposes
      state.schemes = {};
      DataService.componentsFor(ss).forEach(c => {
        state.schemes[c.key] = DataService.buildClassification(
          state.data.index.features, ss, c.key
        );
      });

      state.assetStats = Stats.assetSummary(state.data.assets, ss);

      renderAll({ fit: true });

      // On-canvas layer + basemap panel
      const haveHazard = !!(state.data.hazardRaster || state.data.hazard);
      const hazardPath = hz.hazardRaster || hz.hazardLayer;
      buildControlPanel(ss, haveHazard, hazardPath);

      if (!haveHazard) {
        state.showHazard = false;
        setStatus("warn",
          `${CRVA_CONFIG.hazards[state.hazard].label} surface not loaded. Drop it at ` +
          `<code>${hazardPath}</code> and reload — no code changes needed.`);
      } else {
        setStatus("", "");
      }

    } catch (err) {
      console.error(err);
      showEmptyState(false);
      setStatus("error", `Could not load the data. ${err.message}`);
      MapView.clearAll();
    }
  }

  /** Minimal stats panel for hazard-only mode. */
  function renderHazardOnlyStats(hz) {
    $("statsContent").style.display = "none";
    $("statsEmpty").style.display = "block";
    $("statsEmpty").innerHTML =
      `Showing the <strong>${hz.label}</strong> surface only. ` +
      `Choose a sector to overlay a subsector assessment.`;
  }

  /* ------------------------------------------------------------ rendering */

  function renderAll({ fit = false, restyleOnly = false } = {}) {
    const ss = subsectorCfg();
    if (!ss || !state.data.index) return;

    if (restyleOnly) {
      MapView.restyleIndexLayer(ss, state.component, state.schemes);
    } else {
      const hzCfg = CRVA_CONFIG.hazards[state.hazard] || {};
      hzCfg.__id = state.hazard;
      if (state.data.hazardRaster) {
        MapView.renderHazardRaster(state.data.hazardRaster, hzCfg);
      } else {
        MapView.renderHazardLayer(state.data.hazard, hzCfg);
      }
      const haveHaz = !!(state.data.hazardRaster || state.data.hazard);
      if (haveHaz && state.showHazard) MapView.toggleHazard(true);

      MapView.renderIndexLayer(state.data.index, ss, state.component, state.schemes);

      MapView.renderAssetLayer(state.data.assets, ss);
      if (state.data.assets && state.showAssets) MapView.toggleAssets(true);

      if (fit) MapView.fitToData();
    }

    renderStats(ss);
  }

  function renderStats(ss) {
    const features = state.data.index.features;
    const scheme = state.schemes[state.component];
    const unitLabel = ss.unitLabel || "Sublocations";
    const unitOne = ss.unitLabelOne || "sublocation";
    const hasAssets = !!ss.assetLayer && !!state.data.assets;

    // Distribution of the index polygons across the active component's classes
    const dist = Stats.classDistribution(features, ss, state.component, scheme);

    // --- KPI cards ------------------------------------------------------
    if (hasAssets) {
      const k = Stats.kpis(features, state.assetStats);
      $("kpiUnits").textContent = k.units;
      $("kpiAssets").textContent = k.assets.toLocaleString();
      $("kpiVeryHigh").textContent = k.veryHigh.toLocaleString();
      $("kpiVeryHighPct").textContent = `${k.veryHighPct}% of all ${ss.assetLabel.toLowerCase()}`;
      $("kpiHighPlus").textContent = k.highPlus.toLocaleString();
      $("kpiHighPlusPct").textContent = `${k.highPlusPct}% of all ${ss.assetLabel.toLowerCase()}`;
      $("kpiAssetLabel").textContent = ss.assetLabel;
      $("kpiUnitsLabel").textContent = `${unitLabel} analysed`;
      $("kpiVeryHighLabel").textContent = "In very high risk zones";
      $("kpiHighPlusLabel").textContent = "In high + very high zones";
      state.lastStats = { kpis: k };
    } else {
      // Polygon-only subsector: KPIs describe the index polygons themselves
      const vhigh = dist.dist[5] || 0;
      const high = dist.dist[4] || 0;
      const classified = features.length - dist.noData;
      const pct = n => (classified ? ((n / classified) * 100).toFixed(1) : "0.0");
      const compLabel = DataService.componentLabel(state.component).toLowerCase();

      $("kpiUnits").textContent = features.length;
      $("kpiAssets").textContent = classified.toLocaleString();
      $("kpiAssetLabel").textContent = `${unitLabel} classified`;
      $("kpiUnitsLabel").textContent = `${unitLabel} analysed`;
      $("kpiVeryHigh").textContent = vhigh.toLocaleString();
      $("kpiVeryHighLabel").textContent = `Highest ${compLabel} class`;
      $("kpiVeryHighPct").textContent = `${pct(vhigh)}% of ${unitLabel.toLowerCase()}`;
      $("kpiHighPlus").textContent = (high + vhigh).toLocaleString();
      $("kpiHighPlusLabel").textContent = "Top two classes";
      $("kpiHighPlusPct").textContent = `${pct(high + vhigh)}% of ${unitLabel.toLowerCase()}`;
      state.lastStats = { kpis: {
        units: features.length, assets: classified,
        veryHigh: vhigh, veryHighPct: pct(vhigh),
        highPlus: high + vhigh, highPlusPct: pct(high + vhigh)
      } };
    }

    // --- Chart A --------------------------------------------------------
    if (hasAssets) {
      $("chartATitle").textContent = `${ss.assetLabel} by flood risk zone`;
      Charts.renderAssetRiskChart("chartAssets", state.assetStats, ss.assetLabel);
    } else {
      // Bar of index-polygon counts per class for the active component
      const barStats = { byClass: dist.dist };
      $("chartATitle").textContent =
        `${unitLabel} by ${DataService.componentLabel(state.component).toLowerCase()} class`;
      Charts.renderAssetRiskChart("chartAssets", barStats, unitLabel, state.component);
    }

    // --- Chart B (class donut) -----------------------------------------
    $("chartBTitle").textContent =
      `${unitLabel} by ${DataService.componentLabel(state.component).toLowerCase()} class`;
    Charts.renderClassDonut("chartClasses", dist, state.component);
    state.lastStats.dist = dist;

    // --- Top 5 by component --------------------------------------------
    const inverted = DataService.isInverted(state.component);
    $("topComponentTitle").textContent = inverted
      ? `Top 5 ${unitLabel.toLowerCase()} with the lowest ${DataService.componentLabel(state.component).toLowerCase()}`
      : `Top 5 ${unitLabel.toLowerCase()} by ${DataService.componentLabel(state.component).toLowerCase()}`;

    const topA = Stats.topByComponent(features, ss, state.component, scheme);
    state.lastStats.topA = topA;
    $("topComponentList").innerHTML = topA.length ? topA.map((r, i) => `
      <li class="rank-row" data-name="${r.name}">
        <span class="rank-n">${i + 1}</span>
        <span class="rank-name">${r.name}</span>
        <span class="rank-val">${r.value.toFixed(r.value >= 100 ? 0 : 4)}</span>
        <span class="rank-chip" style="background:${DataService.colorForClass(r.cls, state.component)}">
          ${DataService.classLabel(r.cls)}</span>
      </li>`).join("") : `<li class="rank-empty">No values available for this component.</li>`;

    $("topComponentList").querySelectorAll(".rank-row").forEach(row => {
      row.addEventListener("click", () => MapView.zoomToFeatureByName(row.dataset.name));
    });

    // --- Second ranking -------------------------------------------------
    if (hasAssets) {
      const topB = Stats.topByAssetRisk(features, ss, state.assetStats);
      state.lastStats.topB = topB;
      $("topAssetTitle").textContent =
        `Top 5 ${unitOne}s by very-high-risk ${ss.assetLabel.toLowerCase()}`;
      $("topAssetList").innerHTML = topB.length ? topB.map((r, i) => `
        <li class="rank-row" data-name="${r.name}">
          <span class="rank-n">${i + 1}</span>
          <span class="rank-name">${r.name}</span>
          <span class="rank-val strong">${r.value} of ${r.total}</span>
          <span class="rank-chip" style="background:${DataService.colorForClass(5, "risk")}">Very High</span>
        </li>`).join("") : `<li class="rank-empty">No ${ss.assetLabel.toLowerCase()} in the highest risk class.</li>`;
      $("topAssetList").querySelectorAll(".rank-row").forEach(row => {
        row.addEventListener("click", () => focusOnParent(row.dataset.name, ss));
      });
    } else {
      // No assets: second panel ranks by the subsector's secondary component
      // (e.g. Exposure) if one exists, else hides.
      const comps = DataService.componentsFor(ss);
      const secondary = comps.find(c => c.key !== state.component);
      if (secondary) {
        const sScheme = state.schemes[secondary.key];
        const topB2 = Stats.topByComponent(features, ss, secondary.key, sScheme);
        state.lastStats.topB = topB2.map(r => ({ name: r.name, value: r.value, total: null }));
        $("topAssetTitle").textContent =
          `Top 5 ${unitLabel.toLowerCase()} by ${secondary.label.toLowerCase()}`;
        $("topAssetList").innerHTML = topB2.length ? topB2.map((r, i) => `
          <li class="rank-row" data-name="${r.name}">
            <span class="rank-n">${i + 1}</span>
            <span class="rank-name">${r.name}</span>
            <span class="rank-val">${r.value.toFixed(r.value >= 100 ? 0 : 4)}</span>
            <span class="rank-chip" style="background:${DataService.colorForClass(r.cls, secondary.key)}">
              ${DataService.classLabel(r.cls)}</span>
          </li>`).join("") : `<li class="rank-empty">No values available.</li>`;
        $("topAssetList").querySelectorAll(".rank-row").forEach(row => {
          row.addEventListener("click", () => MapView.zoomToFeatureByName(row.dataset.name));
        });
      } else {
        state.lastStats.topB = [];
        $("topAssetTitle").textContent = "";
        $("topAssetList").innerHTML = "";
      }
    }
  }

  /* ---------------------------------------------------------------- export */

  /** Filename-safe slug for the current selection. */
  function slug(extra) {
    return `Nairobi_CRVA_${state.subsector}_${extra}`
      .replace(/[^a-z0-9_]+/gi, "_");
  }

  function downloadChart(key) {
    const sizes = {
      assets:  { width: 780, height: 340, scale: 3 },   // -> 2340 x 1020 px
      classes: { width: 780, height: 340, scale: 3 }
    };
    const label = key === "assets" ? "facilities_by_risk_zone"
                                   : `sublocations_by_${state.component}`;
    const ok = Charts.downloadChart(key, `${slug(label)}.png`, sizes[key]);
    if (!ok) {
      setStatus("error", "Could not export that chart. See the browser console for details.");
    }
  }

  /** Assemble everything the report needs from current state and build the PDF. */
  async function downloadReport() {
    const ss = subsectorCfg();
    if (!ss || !state.data.index || !state.lastStats) return;

    const btn = $("downloadPdf");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Building report…";

    try {
      const secondaryComp = DataService.componentsFor(ss).find(c => c.key !== state.component);
      await Report.build({
        hazardLabel:    CRVA_CONFIG.hazards[state.hazard].label,
        sectorLabel:    CRVA_CONFIG.sectors[state.sector].label,
        subsectorLabel: ss.label,
        hasAssets:      !!ss.assetLayer && !!state.data.assets,
        assetLabel:     ss.assetLabel || "Assets",
        unitLabel:      ss.unitLabel || "Sublocations",
        unitLabelOne:   ss.unitLabelOne || "sublocation",
        secondaryLabel: secondaryComp ? secondaryComp.label : null,
        componentKey:   state.component,
        componentLabel: DataService.componentLabel(state.component),
        inverted:       DataService.isInverted(state.component),
        subsector:      ss,
        features:       state.data.index.features,
        schemes:        state.schemes,
        assetStats:     state.assetStats,
        kpis:           state.lastStats.kpis,
        classDist:      state.lastStats.dist,
        topComponent:   state.lastStats.topA,
        topAssets:      state.lastStats.topB
      });
    } catch (err) {
      console.error(err);
      setStatus("error", err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /* --------------------------------------------------- focus / drill-down */

  function focusOnParent(name, ss) {
    state.focusParent = name;
    MapView.filterAssetsByParent(name, state.data.assets, ss, state.showAssets);
    MapView.zoomToFeatureByName(name, false);
    $("focusBar").style.display = "flex";
    $("focusName").textContent = name;
  }

  function clearFocus() {
    const ss = subsectorCfg();
    if (!ss || !state.data.assets) { $("focusBar").style.display = "none"; return; }
    state.focusParent = null;
    MapView.filterAssetsByParent(null, state.data.assets, ss, state.showAssets);
    $("focusBar").style.display = "none";
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    $("footerYear").textContent = CRVA_CONFIG.meta.year;
    $("footerSource").textContent = CRVA_CONFIG.meta.source;

    MapView.init("map");
    MapView.setFeatureClickHandler(() => {});
    buildFilters();
    wireFilters();
    loadAndRender();

    window.addEventListener("resize", () => MapView.invalidate());
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
