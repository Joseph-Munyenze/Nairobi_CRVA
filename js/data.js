/* =============================================================================
   data.js — GeoJSON loading, field access, NoData handling, classification
   No field name appears in this file. Everything comes from CRVA_CONFIG.
   ========================================================================== */

const DataService = (() => {

  /* ---------------------------------------------------------------- loading */

  /**
   * Fetch a GeoJSON file. Returns null (never throws) when the file is absent,
   * so optional layers such as the flood hazard surface degrade gracefully.
   */
  async function loadGeoJSON(path, { optional = false } = {}) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      const gj = await res.json();
      if (!gj || gj.type !== "FeatureCollection") {
        throw new Error(`${path} is not a GeoJSON FeatureCollection`);
      }
      return gj;
    } catch (err) {
      if (optional) {
        console.warn(`[data] Optional layer not loaded: ${path} — ${err.message}`);
        return null;
      }
      throw new Error(`Could not load ${path}. ${err.message}`);
    }
  }

  /**
   * Fetch and parse a GeoTIFF into a georaster object.
   * Returns null when the file is absent or georaster.js is not loaded, so the
   * hazard layer degrades to the GeoJSON fallback (or to nothing) without
   * breaking the app.
   */
  async function loadRaster(path) {
    if (typeof parseGeoraster !== "function") {
      console.warn("[data] georaster.js not loaded — skipping raster hazard layer.");
      return null;
    }
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      const buf = await res.arrayBuffer();
      const raster = await parseGeoraster(buf);
      console.info(
        `[data] Raster ${path}: ${raster.width}×${raster.height} px, ` +
        `${raster.numberOfRasters} band(s), CRS EPSG:${raster.projection}, ` +
        `values ${raster.mins[0]}–${raster.maxs[0]}.`
      );
      return raster;
    } catch (err) {
      console.warn(`[data] Raster not loaded: ${path} — ${err.message}`);
      return null;
    }
  }

  /* ----------------------------------------------------------- field access */

  /** Raw attribute value, or null when missing. */
  function getField(feature, field) {
    if (!feature || !field) return null;
    const v = feature.properties ? feature.properties[field] : null;
    return v === undefined ? null : v;
  }

  /**
   * Value of one CRVA component for one feature, applying the subsector's
   * NoData rule. Returns null when the value is not real.
   */
  function getComponentValue(feature, subsector, componentKey) {
    const field = subsector.indices ? subsector.indices[componentKey] : null;
    if (!field) return null;

    const nd = subsector.noData;
    if (nd && (!nd.appliesTo || nd.appliesTo.includes(componentKey))) {
      const flag = getField(feature, nd.field);
      if (flag === null || flag === nd.equals) return null;
    }

    const v = getField(feature, field);
    if (v === null || v === "" || typeof v !== "number" || !isFinite(v)) return null;
    return v;
  }

  /* -------------------------------------------------------- classification */

  /**
   * Build a 5-class scheme for one component.
   * If every valid value is already an integer 1-5 the values are used
   * directly; otherwise equal-interval breaks are cut over the layer min-max.
   * Features excluded as NoData are counted and reported.
   */
  function buildClassification(features, subsector, componentKey) {
    const values = [];
    let excluded = 0;

    features.forEach(f => {
      const v = getComponentValue(f, subsector, componentKey);
      if (v === null) excluded++;
      else values.push(v);
    });

    const nClasses = CRVA_CONFIG.classes.length;
    const scheme = {
      component: componentKey,
      excluded,
      count: values.length,
      method: "equal-interval",
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      breaks: []
    };

    const alreadyClassed =
      values.length > 0 &&
      values.every(v => Number.isInteger(v) && v >= 1 && v <= nClasses);

    if (alreadyClassed) {
      scheme.method = "pre-classified";
      scheme.breaks = [1, 2, 3, 4, 5];
      scheme.classOf = v => (v === null ? null : v);
      return scheme;
    }

    // Equal-interval breaks over min-max
    const span = scheme.max - scheme.min;
    const step = span / nClasses;
    for (let i = 1; i <= nClasses; i++) scheme.breaks.push(scheme.min + step * i);

    scheme.classOf = v => {
      if (v === null) return null;
      if (span === 0) return 1;
      let c = Math.ceil((v - scheme.min) / step);
      if (c < 1) c = 1;
      if (c > nClasses) c = nClasses;
      return c;
    };

    if (excluded > 0) {
      console.info(
        `[data] ${componentKey}: ${excluded} feature(s) excluded as NoData, ` +
        `${values.length} classified (${scheme.method}, ` +
        `${scheme.min.toFixed(4)}–${scheme.max.toFixed(4)}).`
      );
    }
    return scheme;
  }

  /* ------------------------------------------------------ colours & labels */

  function isInverted(componentKey) {
    const c = CRVA_CONFIG.components.find(x => x.key === componentKey);
    return !!(c && c.inverted);
  }

  /** Ramp for a component. Adaptive Capacity gets the red→green ramp so that
      the worst outcome is red for every component. */
  function rampFor(componentKey) {
    return isInverted(componentKey) ? CRVA_CONFIG.rampInverted : CRVA_CONFIG.ramp;
  }

  function colorForClass(cls, componentKey) {
    if (cls === null || cls === undefined) return CRVA_CONFIG.noDataColor;
    return rampFor(componentKey)[cls - 1] || CRVA_CONFIG.noDataColor;
  }

  function classLabel(cls) {
    if (cls === null || cls === undefined) return "No data";
    const c = CRVA_CONFIG.classes.find(x => x.value === cls);
    return c ? c.label : "No data";
  }

  function componentLabel(key) {
    const c = CRVA_CONFIG.components.find(x => x.key === key);
    return c ? c.label : key;
  }

  /* ------------------------------------------------- point-in-polygon join */

  /** Ray-casting test for one linear ring. */
  function pointInRing(pt, ring) {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect =
        (yi > y) !== (yj > y) &&
        x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Polygon = [outerRing, ...holes] */
  function pointInPolygon(pt, polygon) {
    if (!polygon.length || !pointInRing(pt, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
      if (pointInRing(pt, polygon[i])) return false; // in a hole
    }
    return true;
  }

  /** Works for Polygon and MultiPolygon geometries. */
  function pointInFeature(pt, feature) {
    const g = feature.geometry;
    if (!g) return false;
    if (g.type === "Polygon") return pointInPolygon(pt, g.coordinates);
    if (g.type === "MultiPolygon") {
      return g.coordinates.some(poly => pointInPolygon(pt, poly));
    }
    return false;
  }

  /** Simple [minX, minY, maxX, maxY] bbox cache to keep the join cheap. */
  function featureBBox(feature) {
    if (feature.__bbox) return feature.__bbox;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (function walk(c) {
      if (typeof c[0] === "number") {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      } else c.forEach(walk);
    })(feature.geometry.coordinates);
    feature.__bbox = [minX, minY, maxX, maxY];
    return feature.__bbox;
  }

  /**
   * Spatial join: stamp every point feature with the name of the polygon it
   * falls in, written to `__parent`. Points outside every polygon get null.
   * Generic — nothing here knows about health.
   */
  function joinPointsToPolygons(points, polygons, polygonNameField) {
    let matched = 0;
    points.features.forEach(pt => {
      const c = pt.geometry && pt.geometry.coordinates;
      pt.properties.__parent = null;
      if (!c) return;
      for (const poly of polygons.features) {
        const [minX, minY, maxX, maxY] = featureBBox(poly);
        if (c[0] < minX || c[0] > maxX || c[1] < minY || c[1] > maxY) continue;
        if (pointInFeature(c, poly)) {
          pt.properties.__parent = getField(poly, polygonNameField);
          matched++;
          break;
        }
      }
    });
    const total = points.features.length;
    console.info(
      `[data] Spatial join: ${matched}/${total} points matched to a polygon ` +
      `(${total - matched} fell outside the index layer).`
    );
    return { matched, unmatched: total - matched };
  }

  return {
    loadGeoJSON,
    loadRaster,
    getField,
    getComponentValue,
    buildClassification,
    colorForClass,
    classLabel,
    componentLabel,
    rampFor,
    isInverted,
    joinPointsToPolygons,
    pointInFeature
  };
})();
