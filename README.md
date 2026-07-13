# Nairobi County CRVA Dashboard — Phase 1

Interactive Climate Risk and Vulnerability Assessment viewer for Nairobi County,
built for the NCARP project and branded for SEI.

Phase 1 is fully loaded for **Flood Hazard → Social Sector → Health**. Every
other hazard, sector and subsector is present in the filters as a disabled
"coming soon" entry.

## Run it

No build step. Serve the folder over HTTP — `fetch()` will not read GeoJSON from
a `file://` path.

```
VS Code → right-click index.html → "Open with Live Server"
```

or

```
python3 -m http.server 8000     # then open http://localhost:8000
```

## File tree

```
crva-dashboard/
├── index.html
├── css/style.css
├── js/
│   ├── config.js     ← the only file to edit when adding data
│   ├── data.js       loading, NoData handling, classification, point-in-polygon join
│   ├── map.js        Leaflet layers, symbology, legend, popups
│   ├── charts.js     Chart.js panels
│   ├── stats.js      KPIs, generic ranking, CSV export
│   └── app.js        state + render orchestration
├── data/
│   ├── health_sublocations.geojson    (110 polygons, reprojected to EPSG:4326)
│   ├── health_facilities.geojson      (1,006 points, reprojected to EPSG:4326)
│   └── flood_hazard.geojson           (5 class polygons, simplified from 84 MB)
└── assets/sei_logo.svg
```

## Data as loaded

Both supplied GeoJSONs were in **EPSG:32737 (UTM 37S)**. Leaflet only reads
WGS84, so they were reprojected to **EPSG:4326** and written into `data/`.
The originals are untouched.

**Sublocations** — `HealthSector.geojson` → `data/health_sublocations.geojson`

| Component | Field | Range (valid features) |
|---|---|---|
| Exposure | `Weighted_E` | 0 – 35.5 |
| Sensitivity | `Sensitivit` | 0.0852 – 0.5648 |
| Adaptive Capacity | `AdaptiveCa` | 0.2622 – 0.8542 (inverted: high = good) |
| Vulnerability | `Vulnerabil` | 0.0157 – 0.4167 |
| Risk | `Health_Ris` | 0 – 0.0540 |

Name field: `SLNAME`. All values are continuous, so the app cuts
**equal-interval breaks over the layer min–max** and states this in the legend.

**NoData:** 26 sublocations carry `total_pop = 0` and 0.0 across sensitivity,
adaptive capacity, vulnerability and risk — the WorldPop-derived components were
never populated for them, so these are NoData, not real zeros. They are excluded
from classification, charts and rankings, drawn grey, and counted in the legend
and console. Exposure is independent of population and stays valid for all 110.

**Health facilities** — `HealthFacilities_HealthRiskZone.geojson` →
`data/health_facilities.geojson`. 1,006 points; `RiskZone` 1–5 (= `gridcode`),
`RiskClass` text label, `Facility_N`, `Type`, `Owner`.
Distribution: 36 Very Low · 85 Low · 188 Moderate · 396 High · 301 Very High.

The `Sub_Locati` attribute on the facilities is inconsistently cased and named —
only 130 of 1,006 values match `SLNAME` exactly — so it is ignored. The app runs
a **browser-side ray-casting point-in-polygon join** against the sublocation
layer at load time (1,004 of 1,006 points match; 2 fall outside the county
polygons).

## Flood hazard layer

`data/flood_hazard.geojson` — 5 multipart polygons, one per hazard class, class
held in `gridcode` (1 = Very Low … 5 = Very High), CRS WGS84.

The supplied export was 84.6 MB with 1.9 million vertices, which stalls the
browser. It was simplified with a 0.0002 degree tolerance (~22 m, roughly the
source pixel size) and coordinates truncated to 5 decimal places, giving
10.8 MB and 486k vertices with no visible change at county scale. The layer is
drawn on a canvas renderer in its own map pane below the choropleth, and is
non-interactive so it costs nothing in hit-testing.

If you ever want to swap in a raster instead, set `hazardRaster` in
`config.js` to a path such as `data/flood_hazard.tif` (single band, integer
1–5, any georeferenced CRS — a `.ovr` pyramid will not work). It is parsed in
the browser by `georaster` + `georaster-layer-for-leaflet`, already loaded from
CDN in `index.html`. The raster takes precedence over the GeoJSON when both are
set.

## Export

Three exports, all generated in the browser from whatever the dashboard is
currently showing — they cannot disagree with the screen.

- **PDF report** (`js/report.js`, jsPDF + AutoTable) — two pages: key figures,
  both charts, the two Top-5 tables, and a method-and-caveats section that
  states the classification method, the NoData exclusions, the adaptive-capacity
  inversion and the point-in-polygon join. Filename carries the active
  subsector and component.
- **Chart PNGs** — the download icon in each chart's header. Charts are
  re-rendered off-screen at 1400×620 with a white background, so they are sharp
  when pasted into PowerPoint or Word rather than a blurry screen-resolution
  grab with a transparent background.
- **CSV table** — every sublocation with all five components, class labels and
  facility counts by risk level.

The report reflects the current hazard/sector/subsector/component selection, so
switching component and re-exporting gives you a report on that component.

## Adding a new subsector

1. Put the GeoJSON files in `data/` (WGS84).
2. In `js/config.js`, set `enabled: true` on the subsector node and fill in
   `indexLayer`, `nameField`, `indices`, and optionally `assetLayer` +
   `assetNameField` / `assetRiskField`.

That is the whole change. The map, legend, charts, rankings and CSV export are
all driven from the registry; nothing in the other five JS files knows what a
health facility is.

## Map controls

Two icon buttons sit at the top right of the map. Each opens a popover;
opening one closes the other, and a map click or Escape closes both.

- **Basemap** (stack icon) — CARTO Positron / Voyager / Dark Matter,
  OpenStreetMap, Esri World Imagery, Esri Topographic, Esri NatGeo, or none.
- **Layers** (squares icon) — sublocation choropleth, flood hazard, health
  facilities, each independent. A layer whose file is missing shows disabled.
  Also holds the **choropleth opacity** slider: the flood hazard is drawn
  *below* the choropleth, so at full opacity it is hidden — slide down (or
  switch the choropleth off) to read the hazard surface.

The legend is bottom-left, collapsible via the − button. Break values for each
class are in the swatch tooltips rather than printed, to keep it small. The
scale bar sits bottom-right so the two do not collide.

## Design notes

Chrome uses the SEI palette (green `#00b180` accent, `#263238` ink, grey scale,
purple for the "inverted" tag) and SEI's type stack — `Calibre, "Noto Sans",
Arial, Helvetica, sans-serif` with `font-size-adjust: 0.444`. Calibre is a
licensed font and is not bundled; machines that have it installed will use it,
everyone else falls back to Noto Sans, exactly as SEI's own site does. **Data ramps are not brand colours** —
sequential ColorBrewer YlOrRd for the four positive components, RdYlGn for
adaptive capacity so that red always means the worst outcome. Legibility on the
map outranks branding.
