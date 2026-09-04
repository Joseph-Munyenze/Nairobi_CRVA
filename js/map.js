/* =============================================================================
   map.js — Leaflet map, layers, symbology, legend, popups
   ========================================================================== */

const MapView = (() => {

  let map;
  let indexLayer = null;      // choropleth of the index polygons
  let hazardLayer = null;     // background hazard surface
  let assetLayer = null;      // point assets
  let legendCtl, infoCtl;
  let baseLayers = {};
  let hazardRenderer = null;
  let featureIndex = new Map();   // polygon name -> leaflet layer
  let assetFilterParent = null;   // when set, only assets in this polygon show
  let activeHazardCfg = null;     // hazard cfg currently rendered, for the legend
  let activeHazardContScheme = null;
  let onFeatureClick = null;
  let panelCtl = null;
  let indexOpacity = 0.80;        // choropleth fill opacity, user-adjustable
  let indexVisible = true;

  /* ------------------------------------------------------------------ init */

  function init(containerId) {
    map = L.map(containerId, {
      center: CRVA_CONFIG.defaults.center,
      zoom: CRVA_CONFIG.defaults.zoom,
      zoomControl: true,
      preferCanvas: true
    });

    const ESRI  = "Esri, Maxar, Earthstar Geographics";
    const ESRIC = "Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

    // All keyless. CARTO tiles were dropped because their CDN now returns an
    // "API key required" wall at higher zooms.
    baseLayers = {
      light: {
        label: "Light (Esri Canvas)",
        layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          { attribution: ESRIC, maxZoom: 16 })
      },
      streets: {
        label: "Streets (OpenStreetMap)",
        layer: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 })
      },
      dark: {
        label: "Dark (Esri Dark Gray)",
        layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          { attribution: ESRIC, maxZoom: 16 })
      },
      imagery: {
        label: "Satellite (Esri World Imagery)",
        layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { attribution: ESRI, maxZoom: 19 })
      },
      topo: {
        label: "Topographic (Esri)",
        layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
          { attribution: ESRI, maxZoom: 19 })
      },
      terrain: {
        label: "Terrain (Esri NatGeo)",
        layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
          { attribution: "Esri, National Geographic", maxZoom: 16 })
      },
      none: { label: "No basemap", layer: null }
    };

    baseLayers.light.layer.addTo(map);

    // Dedicated pane between the tiles (200) and the overlays (400) so the
    // hazard surface always sits under the choropleth, whatever the draw order.
    map.createPane("hazardPane");
    map.getPane("hazardPane").style.zIndex = 350;
    hazardRenderer = L.canvas({ pane: "hazardPane" });

    L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
    addLegend();
    addInfoBox();
    return map;
  }

  /** Switch basemap. "none" removes all tiles — useful over the hazard raster. */
  function setBasemap(key) {
    Object.entries(baseLayers).forEach(([k, entry]) => {
      if (!entry.layer) return;
      if (k === key) entry.layer.addTo(map);
      else if (map.hasLayer(entry.layer)) map.removeLayer(entry.layer);
    });
    if (indexLayer && indexVisible) indexLayer.bringToFront();
    if (assetLayer && map.hasLayer(assetLayer)) assetLayer.bringToFront();
  }

  /* --------------------------------------------------- on-canvas controls */

  const ICONS = {
    basemap: '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">' +
      '<path d="M10 2.4 2.6 6 10 9.6 17.4 6 10 2.4Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M2.6 10.2 10 13.8l7.4-3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>' +
      '<path d="M2.6 14.2 10 17.8l7.4-3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".3"/></svg>',
    layers: '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">' +
      '<rect x="2.6" y="2.6" width="6.4" height="6.4" rx="1.2" fill="currentColor"/>' +
      '<rect x="11" y="2.6" width="6.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<rect x="2.6" y="11" width="6.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<rect x="11" y="11" width="6.4" height="6.4" rx="1.2" fill="currentColor" opacity=".45"/></svg>'
  };

  /**
   * Two icon buttons, top-right: basemap picker and layer switcher. Each opens
   * a popover; opening one closes the other. The layer list is passed in by
   * app.js so nothing here is hard-coded to a subsector.
   *
   * layers: [{ key, label, checked, disabled, title }]
   * handlers: { onBasemap(key), onLayer(key, on), onOpacity(0-1) }
   */
  function addControlPanel(layers, handlers, activeBasemap, hideOpacity) {
    if (panelCtl) { map.removeControl(panelCtl); panelCtl = null; }

    panelCtl = L.control({ position: "topright" });
    panelCtl.onAdd = () => {
      const root = L.DomUtil.create("div", "map-tools");

      const bmOptions = Object.entries(baseLayers).map(([k, e]) => `
        <label class="mp-row" for="bm_${k}">
          <input type="radio" name="mp-basemap" id="bm_${k}" value="${k}"
                 ${k === activeBasemap ? "checked" : ""}>
          <span class="mp-dot"></span><span>${e.label}</span>
        </label>`).join("");

      const lyOptions = layers.map(l => `
        <label class="mp-row ${l.disabled ? "is-disabled" : ""}" for="ly_${l.key}"
               title="${l.title || ""}">
          <input type="checkbox" id="ly_${l.key}" value="${l.key}"
                 ${l.checked ? "checked" : ""} ${l.disabled ? "disabled" : ""}>
          <span class="mp-box"></span><span>${l.label}</span>
        </label>`).join("");

      const opacityBlock = hideOpacity ? "" : `
            <div class="mp-slider">
              <h5>Choropleth opacity
                <span class="mp-val" id="mpOpacityVal">${Math.round(indexOpacity * 100)}%</span>
              </h5>
              <input type="range" id="mpOpacity" min="0" max="100" step="5"
                     value="${Math.round(indexOpacity * 100)}" class="mp-range">
              <p class="mp-hint">Turn down to read the hazard surface underneath.</p>
            </div>`;

      root.innerHTML = `
        <div class="tool" data-tool="basemap">
          <button type="button" class="tool-btn" id="btnBasemap"
                  aria-label="Basemap" aria-expanded="false" title="Basemap">
            ${ICONS.basemap}
          </button>
          <div class="tool-pop" id="popBasemap" role="dialog" aria-label="Basemap">
            <h5>Basemap</h5>
            ${bmOptions}
          </div>
        </div>

        <div class="tool" data-tool="layers">
          <button type="button" class="tool-btn" id="btnLayers"
                  aria-label="Layers" aria-expanded="false" title="Layers">
            ${ICONS.layers}
          </button>
          <div class="tool-pop" id="popLayers" role="dialog" aria-label="Layers">
            <h5>Layers</h5>
            <div id="mpLayers">${lyOptions}</div>
            ${opacityBlock}
          </div>
        </div>`;

      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);

      /* open/close — one popover at a time */
      const tools = root.querySelectorAll(".tool");
      const closeAll = except => tools.forEach(t => {
        if (t === except) return;
        t.classList.remove("is-open");
        t.querySelector(".tool-btn").setAttribute("aria-expanded", "false");
      });

      tools.forEach(t => {
        const btn = t.querySelector(".tool-btn");
        btn.addEventListener("click", () => {
          const open = !t.classList.contains("is-open");
          closeAll(t);
          t.classList.toggle("is-open", open);
          btn.setAttribute("aria-expanded", String(open));
        });
      });

      // clicking the map, or Escape, closes any open popover
      map.on("click", () => closeAll(null));
      document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeAll(null);
      });

      root.querySelectorAll('input[name="mp-basemap"]').forEach(r => {
        r.addEventListener("change", () => handlers.onBasemap(r.value));
      });
      root.querySelectorAll('#mpLayers input[type="checkbox"]').forEach(c => {
        c.addEventListener("change", () => handlers.onLayer(c.value, c.checked));
      });

      const slider = root.querySelector("#mpOpacity");
      if (slider) {
        slider.addEventListener("input", () => {
          const pct = Number(slider.value);
          root.querySelector("#mpOpacityVal").textContent = `${pct}%`;
          handlers.onOpacity(pct / 100);
        });
      }

      panelCtl._div = root;
      return root;
    };
    panelCtl.addTo(map);
  }

  /** Keep a layer checkbox in sync when state changes elsewhere. */
  function setPanelLayer(key, on, disabled) {
    if (!panelCtl || !panelCtl._div) return;
    const cb = panelCtl._div.querySelector(`#ly_${key}`);
    if (!cb) return;
    cb.checked = on;
    if (disabled !== undefined) {
      cb.disabled = disabled;
      cb.closest(".mp-row").classList.toggle("is-disabled", disabled);
    }
  }

  /* ------------------------------------------------------------- info box */

  function addInfoBox() {
    infoCtl = L.control({ position: "topleft" });
    infoCtl.onAdd = () => {
      const div = L.DomUtil.create("div", "map-info");
      div.innerHTML = "";
      div.style.display = "none";
      infoCtl._div = div;
      return div;
    };
    infoCtl.addTo(map);
  }

  function showInfo(html) {
    if (!infoCtl._div) return;
    infoCtl._div.innerHTML = html;
    infoCtl._div.style.display = "block";
  }

  function hideInfo() {
    if (infoCtl._div) infoCtl._div.style.display = "none";
  }

  /* --------------------------------------------------------------- legend */

  function addLegend() {
    legendCtl = L.control({ position: "bottomleft" });
    legendCtl.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      legendCtl._div = div;
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    legendCtl.addTo(map);
  }

  /** Redraw the legend for the active component + scheme. */
  function renderLegend(componentKey, scheme, hazardOn) {
    if (!legendCtl._div) return;
    const inverted = DataService.isInverted(componentKey);
    const label = DataService.componentLabel(componentKey);
    const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3));

    // Compact ramp: five swatches in a row, class names beneath the ends.
    // Exact break values live in each swatch's tooltip, so the legend stays small.
    let swatches = "";
    CRVA_CONFIG.classes.forEach((c, i) => {
      const lo = i === 0 ? scheme.min : scheme.breaks[i - 1];
      const hi = scheme.breaks[i];
      const range = scheme.method === "pre-classified"
        ? `Class ${c.value}`
        : `${fmt(lo)} – ${fmt(hi)}`;
      swatches += `<span class="lg-sw" style="background:${DataService.colorForClass(c.value, componentKey)}"
                         title="${c.label}: ${range}"></span>`;
    });

    const ends = inverted
      ? ["Very low (worst)", "Very high (best)"]
      : ["Very low", "Very high"];

    const noData = scheme.excluded > 0 ? `
      <div class="lg-nodata" title="${scheme.excluded} features excluded from classification">
        <span class="lg-sw sm" style="background:${CRVA_CONFIG.noDataColor}"></span>
        No data (${scheme.excluded})
      </div>` : "";

    const invNote = inverted
      ? `<p class="lg-note">High adaptive capacity is good — ramp reversed so red is always worst.</p>`
      : "";

    const hazCfg = (hazardOn && activeHazardCfg) ? activeHazardCfg : null;
    const hazRamp = hazCfg ? hazardRampFor(hazCfg) : CRVA_CONFIG.floodRamp;
    const hazName = hazCfg ? (hazCfg.label || "Hazard") : "Hazard";
    const hazardBlock = hazardOn ? `
      <div class="lg-sub">
        <span class="lg-sub-title">${hazName}</span>
        <div class="lg-ramp">
          ${hazRamp.map(c => `<span class="lg-sw" style="background:${c}"></span>`).join("")}
        </div>
        <div class="lg-ends"><span>Very low</span><span>Very high</span></div>
      </div>` : "";

    legendCtl._div.innerHTML = `
      <div class="lg-head">
        <h4>${label}</h4>
        <button type="button" class="lg-toggle" aria-label="Collapse legend">−</button>
      </div>
      <div class="lg-body">
        <div class="lg-ramp">${swatches}</div>
        <div class="lg-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>
        ${noData}
        ${invNote}
        ${hazardBlock}
      </div>`;

    // collapse to just the title bar — handy on small screens
    const btn = legendCtl._div.querySelector(".lg-toggle");
    btn.addEventListener("click", () => {
      const collapsed = legendCtl._div.classList.toggle("is-collapsed");
      btn.textContent = collapsed ? "+" : "−";
      btn.setAttribute("aria-label", collapsed ? "Expand legend" : "Collapse legend");
    });
  }

  /* ---------------------------------------------------- index choropleth */

  /* ---------------------------------------------------- index choropleth */

  /** Legend for hazard-only mode: the hazard's five classes in its own ramp. */
  function renderHazardLegend(hazardCfg) {
    if (!legendCtl._div) return;
    const ramp = hazardRampFor(hazardCfg);
    const label = hazardCfg.label || "Hazard";
    let swatches = "";
    CRVA_CONFIG.classes.forEach((c, i) => {
      swatches += `<span class="lg-sw" style="background:${ramp[i]}" title="${c.label}"></span>`;
    });
    legendCtl._div.innerHTML = `
      <div class="lg-head">
        <h4>${label}</h4>
        <button type="button" class="lg-toggle" aria-label="Collapse legend">−</button>
      </div>
      <div class="lg-body">
        <div class="lg-ramp">${swatches}</div>
        <div class="lg-ends"><span>Very low</span><span>Very high</span></div>
      </div>`;
    const btn = legendCtl._div.querySelector(".lg-toggle");
    btn.addEventListener("click", () => {
      const collapsed = legendCtl._div.classList.toggle("is-collapsed");
      btn.textContent = collapsed ? "+" : "−";
    });
  }

  function styleFor(feature, subsector, componentKey, scheme) {
    const v = DataService.getComponentValue(feature, subsector, componentKey);
    const cls = scheme.classOf(v);
    return {
      fillColor: DataService.colorForClass(cls, componentKey),
      fillOpacity: (cls === null ? 0.55 : 1) * indexOpacity,
      color: "#ffffff",
      weight: 0.8,
      opacity: Math.min(1, indexOpacity + 0.2)   // keep boundaries readable
    };
  }

  /** Popup HTML for an index polygon: all five components, raw value + class. */
  function indexPopup(feature, subsector, schemes) {
    const name = DataService.getField(feature, subsector.nameField);
    const rows = DataService.componentsFor(subsector).map(c => {
      const v = DataService.getComponentValue(feature, subsector, c.key);
      const cls = schemes[c.key].classOf(v);
      const chip = `<span class="chip" style="background:${DataService.colorForClass(cls, c.key)}"></span>`;
      const val = v === null ? "—" : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(4));
      return `<tr><th>${c.label}</th><td>${val}</td>
              <td>${chip}${DataService.classLabel(cls)}</td></tr>`;
    }).join("");

    const extras = (subsector.extraFields || []).map(x => {
      let v = DataService.getField(feature, x.field);
      if (v === null || v === "") return "";
      if (x.format === "int") v = Math.round(v).toLocaleString();
      return `<tr><th>${x.label}</th><td colspan="2">${v}</td></tr>`;
    }).join("");

    return `
      <div class="popup">
        <h3>${name}</h3>
        <table class="popup-table">${rows}${extras ? `<tr class="sep"><td colspan="3"></td></tr>${extras}` : ""}</table>
      </div>`;
  }

  /** Draw / redraw the choropleth. */
  function renderIndexLayer(geojson, subsector, componentKey, schemes) {
    if (indexLayer) { map.removeLayer(indexLayer); indexLayer = null; }
    featureIndex = new Map();
    const scheme = schemes[componentKey];

    indexLayer = L.geoJSON(geojson, {
      style: f => styleFor(f, subsector, componentKey, scheme),
      onEachFeature: (feature, layer) => {
        const name = DataService.getField(feature, subsector.nameField);
        featureIndex.set(name, layer);
        layer.bindPopup(indexPopup(feature, subsector, schemes), { maxWidth: 320 });

        layer.on({
          mouseover: e => {
            e.target.setStyle({
              weight: 2.5, color: "#263238",
              fillOpacity: Math.min(0.95, indexOpacity + 0.12), opacity: 1
            });
            e.target.bringToFront();
            if (assetLayer && map.hasLayer(assetLayer)) assetLayer.bringToFront();
            const v = DataService.getComponentValue(feature, subsector, componentKey);
            const cls = scheme.classOf(v);
            showInfo(`
              <strong>${name}</strong>
              <span>${DataService.componentLabel(componentKey)}:
                ${v === null ? "no data" : v.toFixed(4)} · ${DataService.classLabel(cls)}</span>`);
          },
          mouseout: e => {
            indexLayer.resetStyle(e.target);
            hideInfo();
          },
          click: () => { if (onFeatureClick) onFeatureClick(feature); }
        });
      }
    });

    if (indexVisible) indexLayer.addTo(map);
    if (assetLayer && map.hasLayer(assetLayer)) assetLayer.bringToFront();
    renderLegend(componentKey, scheme, hazardLayer && map.hasLayer(hazardLayer));
    return indexLayer;
  }

  /** Restyle in place when the component changes (cheaper than a full rebuild). */
  function restyleIndexLayer(subsector, componentKey, schemes) {
    if (!indexLayer) return;
    const scheme = schemes[componentKey];
    indexLayer.eachLayer(layer => {
      layer.setStyle(styleFor(layer.feature, subsector, componentKey, scheme));
      layer.setPopupContent(indexPopup(layer.feature, subsector, schemes));
    });
    renderLegend(componentKey, scheme, hazardLayer && map.hasLayer(hazardLayer));
  }

  /* -------------------------------------------------------- hazard layer */

  /**
   * Draw the hazard surface from a parsed GeoTIFF.
   * Pixel value 1-5 maps to the flood ramp; NoData and values outside 1-5 are
   * drawn transparent. Reprojection to Web Mercator is handled by
   * georaster-layer-for-leaflet, so a UTM 37S raster works as-is.
   */
  /** Ramp for a hazard surface, keyed by the hazard's own id. */
  function hazardRampFor(hazardCfg) {
    const id = hazardCfg && hazardCfg.__id;
    return (id && CRVA_CONFIG.hazardRamps && CRVA_CONFIG.hazardRamps[id])
      || CRVA_CONFIG.floodRamp;
  }

  function renderHazardRaster(georaster, hazardCfg) {
    if (hazardLayer) { map.removeLayer(hazardLayer); hazardLayer = null; }
    activeHazardCfg = hazardCfg || null;
    if (!georaster || typeof GeoRasterLayer !== "function") return null;

    const noData = hazardCfg.hazardNoData || [];
    const ramp = hazardRampFor(hazardCfg);

    hazardLayer = new GeoRasterLayer({
      georaster,
      pane: "hazardPane",
      opacity: 0.75,
      resolution: 256,               // render resolution per tile
      pixelValuesToColorFn: values => {
        const v = values[0];
        if (v === null || v === undefined || isNaN(v)) return null;
        if (noData.includes(v)) return null;
        const c = Math.round(v);
        return (c >= 1 && c <= 5) ? ramp[c - 1] : null;
      }
    });
    return hazardLayer;
  }

  function renderHazardLayer(geojson, hazardCfg) {
    if (hazardLayer) { map.removeLayer(hazardLayer); hazardLayer = null; }
    activeHazardCfg = hazardCfg || null;
    if (!geojson) return null;

    const field = hazardCfg.hazardClassField;

    // Continuous hazard (e.g. cold/heat 0.36–0.94): Jenks-class it into 1–5.
    let contScheme = null;
    if (hazardCfg.hazardContinuous) {
      const vals = geojson.features
        .map(f => DataService.getField(f, field))
        .filter(v => typeof v === "number" && isFinite(v));
      contScheme = DataService.buildClassification(
        geojson.features,
        { indices: { _h: field }, classify: { _h: "jenks" } },
        "_h"
      );
      activeHazardContScheme = contScheme;
    } else {
      activeHazardContScheme = null;
    }

    hazardLayer = L.geoJSON(geojson, {
      pane: "hazardPane",        // always beneath the choropleth
      renderer: hazardRenderer,
      style: f => {
        const ramp = hazardRampFor(hazardCfg);
        const raw = DataService.getField(f, field);
        const c = contScheme
          ? (ramp[(contScheme.classOf(raw) || 1) - 1] || "transparent")
          : ((raw >= 1 && raw <= 5) ? ramp[raw - 1] : "transparent");
        return { fillColor: c, fillOpacity: 0.75, color: c, weight: 0.2 };
      },
      interactive: false
    });
    return hazardLayer;
  }

  function toggleHazard(on) {
    if (!hazardLayer) return;
    if (on) hazardLayer.addTo(map);
    else if (map.hasLayer(hazardLayer)) map.removeLayer(hazardLayer);
  }

  /* --------------------------------------------------------- asset layer */

  function assetPopup(feature, subsector) {
    const p = feature.properties;
    const name = DataService.getField(feature, subsector.assetNameField) || "Unnamed";
    const cls = DataService.getField(feature, subsector.assetRiskField);
    const clsLabel = DataService.getField(feature, subsector.assetClassField)
      || DataService.classLabel(cls);
    const type = DataService.getField(feature, subsector.assetTypeField);
    const owner = DataService.getField(feature, subsector.assetOwnerField);

    return `
      <div class="popup">
        <h3>${name}</h3>
        <table class="popup-table">
          <tr><th>Risk zone</th><td>
            <span class="chip" style="background:${DataService.colorForClass(cls, "risk")}"></span>
            ${clsLabel}${cls ? ` (${cls})` : ""}</td></tr>
          ${type  ? `<tr><th>Type</th><td>${type}</td></tr>` : ""}
          ${owner ? `<tr><th>Owner</th><td>${owner}</td></tr>` : ""}
          <tr><th>Sublocation</th><td>${p.__parent || "outside index layer"}</td></tr>
        </table>
      </div>`;
  }

  function renderAssetLayer(geojson, subsector) {
    if (assetLayer) { map.removeLayer(assetLayer); assetLayer = null; }
    if (!geojson) return null;

    assetLayer = L.geoJSON(geojson, {
      filter: f => !assetFilterParent || f.properties.__parent === assetFilterParent,
      pointToLayer: (feature, latlng) => {
        const cls = DataService.getField(feature, subsector.assetRiskField);
        return L.circleMarker(latlng, {
          radius: 4.5,
          fillColor: DataService.colorForClass(cls, "risk"),
          color: "#263238",
          weight: 0.9,
          opacity: 1,
          fillOpacity: 0.95
        });
      },
      onEachFeature: (feature, layer) => {
        layer.bindPopup(assetPopup(feature, subsector), { maxWidth: 300 });
      }
    });
    return assetLayer;
  }

  /** Show/hide the choropleth without rebuilding it. */
  function toggleIndex(on) {
    indexVisible = on;
    if (!indexLayer) return;
    if (on) { indexLayer.addTo(map); indexLayer.bringToFront(); }
    else if (map.hasLayer(indexLayer)) map.removeLayer(indexLayer);
    if (assetLayer && map.hasLayer(assetLayer)) assetLayer.bringToFront();
  }

  /** Set choropleth fill opacity (0-1) and restyle in place. */
  function setIndexOpacity(value, subsector, componentKey, schemes) {
    indexOpacity = Math.max(0, Math.min(1, value));
    if (!indexLayer) return;
    const scheme = schemes[componentKey];
    indexLayer.eachLayer(l => l.setStyle(styleFor(l.feature, subsector, componentKey, scheme)));
  }

  function toggleAssets(on) {
    if (!assetLayer) return;
    if (on) { assetLayer.addTo(map); assetLayer.bringToFront(); }
    else if (map.hasLayer(assetLayer)) map.removeLayer(assetLayer);
  }

  /** Restrict the point layer to one polygon (null clears the filter). */
  function filterAssetsByParent(parentName, geojson, subsector, visible) {
    assetFilterParent = parentName;
    const wasVisible = visible !== undefined
      ? visible
      : (assetLayer && map.hasLayer(assetLayer));
    renderAssetLayer(geojson, subsector);
    if (wasVisible) toggleAssets(true);
  }

  /* ------------------------------------------------------------ navigation */

  function zoomToFeatureByName(name, openPopup = true) {
    const layer = featureIndex.get(name);
    if (!layer) return;
    map.fitBounds(layer.getBounds(), { maxZoom: 14, padding: [40, 40] });
    if (openPopup) layer.openPopup();
  }

  function resetView() {
    if (indexLayer) map.fitBounds(indexLayer.getBounds(), { padding: [10, 10] });
    else map.setView(CRVA_CONFIG.defaults.center, CRVA_CONFIG.defaults.zoom);
  }

  function fitToData() { resetView(); }

  function clearAll() {
    [indexLayer, hazardLayer, assetLayer].forEach(l => {
      if (l && map.hasLayer(l)) map.removeLayer(l);
    });
    indexLayer = hazardLayer = assetLayer = null;
    if (legendCtl._div) legendCtl._div.innerHTML = "";
    hideInfo();
  }

  function setFeatureClickHandler(fn) { onFeatureClick = fn; }
  function invalidate() { if (map) map.invalidateSize(); }

  return {
    init, setBasemap,
    renderIndexLayer, restyleIndexLayer,
    renderHazardLayer, renderHazardRaster, renderHazardLegend, toggleHazard,
    renderAssetLayer, toggleAssets, filterAssetsByParent,
    toggleIndex, setIndexOpacity,
    addControlPanel, setPanelLayer,
    zoomToFeatureByName, resetView, fitToData, clearAll,
    setFeatureClickHandler, invalidate,
    get instance() { return map; }
  };
})();
