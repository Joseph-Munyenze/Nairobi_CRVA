# Nairobi County CRVA Dashboard — Full Build

Interactive Climate Risk & Vulnerability Assessment for Nairobi County (NCARP),
branded for SEI. Config-driven: everything is registered in `js/config.js`.

## Run it

Serve over HTTP (not file://):

    cd crva-dashboard
    npx http-server -p 8000      # or: python -m http.server 8000

Open http://localhost:8000

## What's loaded

**4 hazards**
- Flood (5-class polygon)
- Air Quality (5-class polygon)
- Cold & Heat (continuous per-sublocation value, Jenks-classed on the fly)
- Water Stress (raster polygonised to 5 classes)

**16 subsectors across 3 sectors**
- Social: Health (Flood, with facility points), Health / Education / Population /
  Socioeconomic Overall (Air Quality)
- Infrastructure (Flood): Housing, WASH, Sports, Energy, ICT, Public Works,
  Transport — each with Exposure, Sensitivity, Adaptive Capacity, Vulnerability,
  Impact, Risk
- Finance & Production (Cold & Heat): Agriculture, Financial Services,
  Manufacturing, Trade — each with Exposure, Sensitivity, Adaptive Capacity,
  Vulnerability, Impact

## Classification & colour

- **Jenks natural breaks** is the default for all continuous components
  (`defaultClassify: "jenks"` in config). Pre-classified 1–5 fields (hazard
  zones) are used as-is. A subsector can override per component with
  `classify: { key: "quantile" }`.
- **Cool graduated ramps.** The main data ramp runs pale blue-green → deep teal
  (`#edf8fb → #006d2c`); darker = higher value of whatever is mapped. Adaptive
  Capacity is inverted (high is good), so its ramp reverses — dark always marks
  the worst outcome. Each hazard surface has its own distinct cool ramp
  (flood blues, air-quality purples, cold/heat blues, water-stress greens).

## Data conversion

All 49 source shapefiles were converted to WGS84 GeoJSON:
- Reprojected from UTM 37S (EPSG:32737) where needed (flood infrastructure).
- KML export cruft (FolderPath, SymbolID, PopupInfo, etc.) stripped.
- Truncated shapefile field names (10-char limit) mapped to clean keys.
- Geometry simplified (~16 m tolerance) and coordinates rounded to 5 dp.
- The flood "Infrastructure Risk" master table (which holds every infra
  subsector's columns) was split into one file per subsector; Sensitivity and
  Adaptive Capacity were merged in from the Sensitivity shapefile by name.
- Water Stress raster polygonised (dissolved by class) and simplified.

## Adding more

Drop a WGS84 GeoJSON in `/data`, add a subsector node in `config.js` with its
`indexLayer`, `nameField`, `components` and `indices`. Nothing else changes.

## Recent fixes

- **Keyless basemaps.** CARTO tiles were dropped (their CDN now demands an API
  key at higher zooms). Basemaps are now all keyless: Esri Light Canvas
  (default), OpenStreetMap, Esri Dark, Esri Satellite, Esri Topographic, Esri
  NatGeo, plus "No basemap".
- **Sector = None.** The sector filter has a leading "None — hazard only"
  option: pick a hazard and see just its surface, with the legend showing that
  hazard's five classes, no subsector overlay.
- **Legend follows the active layer.** In subsector mode the legend shows the
  selected component's five classes; in hazard-only mode it shows the hazard's.
- Basemap/layer popovers no longer overlap.
