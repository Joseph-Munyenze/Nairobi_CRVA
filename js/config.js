/* =============================================================================
   config.js — CRVA taxonomy registry
   -----------------------------------------------------------------------------
   THIS IS THE ONLY FILE YOU EDIT WHEN ADDING NEW DATA.

   To add a subsector:
     1. Drop its GeoJSON files (WGS84 / EPSG:4326) into /data.
     2. Flip `enabled: true` on the subsector node below and fill in the
        layer paths, nameField, indices and (optionally) assetLayer fields.
     Nothing in js/data.js, js/map.js, js/charts.js, js/stats.js or js/app.js
     needs to change.

   Field-name contract for a subsector node:
     indexLayer      path to the polygon (index) GeoJSON
     nameField       polygon name attribute
     indices         { componentKey: "ATTRIBUTE_NAME", ... } for all 5 components
     noData          optional: marks features whose index values are not real
                     { field, equals, appliesTo: [componentKeys] }
     assetLayer      optional path to a point (asset) GeoJSON
     assetNameField  / assetRiskField / assetClassField / assetTypeField /
     assetOwnerField point-layer attributes
   ========================================================================== */

const CRVA_CONFIG = {

  /* --------------------------------------------------------------------- */
  hazards: {
    flood: {
      label: "Flood Hazard",
      enabled: true,

      // The hazard surface can be supplied EITHER as a polygonised GeoJSON
      // (what is loaded now) OR as a georeferenced GeoTIFF. The raster wins if
      // both are present; set hazardRaster to a path to use one instead.
      //
      // GeoTIFF option: single band, integer class 1-5, any georeferenced CRS.
      // A .ovr pyramid file will NOT work — it carries no georeferencing.
      hazardRaster: null,

      // Polygonised surface: 5 multipart features, class held in gridcode.
      hazardLayer: "data/flood_hazard.geojson",
      hazardClassField: "gridcode",

      // Raster pixel values to draw transparent (only used with hazardRaster).
      hazardNoData: [0]
    },
    heatcold:    { label: "Heat and Cold Hazard", enabled: false },
    airquality:  { label: "Air Quality Hazard",   enabled: false },
    landslide:   { label: "Landslide Hazard",     enabled: false },
    waterstress: { label: "Water Stress Hazard",  enabled: false }
  },

  /* --------------------------------------------------------------------- */
  sectors: {
    finance: {
      label: "Finance and Production", enabled: true,
      subsectors: {
        manufacturing: { label: "Manufacturing and Industrial Facilities", enabled: false },
        finInfra:      { label: "Financial Infrastructure",                enabled: false },
        trade:         { label: "Trade and Marketing Centers",             enabled: false },
        agriLand:      { label: "Agricultural Land",                       enabled: false }
      }
    },

    infrastructure: {
      label: "Infrastructure", enabled: true,
      subsectors: {
        transport: { label: "Transport (roads, bridges, culverts)",       enabled: false },
        housing:   { label: "Housing and Public Buildings",               enabled: false },
        energy:    { label: "Energy (substations, transformer stations)", enabled: false },
        wash:      { label: "WASH",                                       enabled: false }
      }
    },

    social: {
      label: "Social Sector", enabled: true,
      subsectors: {

        /* ---- THE ONE FULLY-LOADED SUBSECTOR (Phase 1) ------------------ */
        health: {
          label: "Health",
          enabled: true,

          indexLayer: "data/health_sublocations.geojson",
          nameField:  "SLNAME",
          popField:   "total_pop",

          indices: {
            exposure:         "Weighted_E",
            sensitivity:      "Sensitivit",
            adaptiveCapacity: "AdaptiveCa",
            vulnerability:    "Vulnerabil",
            risk:             "Health_Ris"
          },

          // 26 sublocations carry total_pop = 0: the WorldPop-derived
          // components were never populated for them, so their 0.0 values are
          // NoData, not real zeros. Exposure is independent of population and
          // stays valid for these features.
          noData: {
            field: "total_pop",
            equals: 0,
            appliesTo: ["sensitivity", "adaptiveCapacity", "vulnerability", "risk"]
          },

          // Extra attributes shown in the sublocation popup
          extraFields: [
            { field: "total_pop",  label: "Total population",  format: "int" },
            { field: "Pop_Under5", label: "Population under 5", format: "int" },
            { field: "Pop_Over65", label: "Population over 65", format: "int" },
            { field: "Division",   label: "Division",           format: "text" }
          ],

          assetLayer:      "data/health_facilities.geojson",
          assetLabel:      "Health Facilities",
          assetLabelOne:   "health facility",
          assetNameField:  "Facility_N",
          assetRiskField:  "RiskZone",     // integer 1-5
          assetClassField: "RiskClass",    // "Very Low" ... "Very High"
          assetTypeField:  "Type",
          assetOwnerField: "Owner"
        },

        education:  { label: "Education",  enabled: false },
        population: { label: "Population", enabled: false }
      }
    },

    environment: {
      label: "Environment and Natural Resources", enabled: true,
      subsectors: {
        climate:  { label: "Environment and Climate Change (greenspaces)", enabled: false },
        forestry: { label: "Forestry",                                     enabled: false },
        tourism:  { label: "Tourism and Wildlife",                         enabled: false },
        drm:      { label: "Disaster Risk Management",                     enabled: false }
      }
    },

    governance: {
      label: "Governance", enabled: true,
      subsectors: {
        popTotal:     { label: "Population (total)", enabled: false },
        police:       { label: "Police Stations",    enabled: false },
        sublocations: { label: "Sublocations",       enabled: false }
      }
    }
  },

  /* --------------------------------------------------------------------- */
  components: [
    { key: "risk",             label: "Risk" },
    { key: "exposure",         label: "Exposure" },
    { key: "sensitivity",      label: "Sensitivity" },
    { key: "vulnerability",    label: "Vulnerability" },
    { key: "adaptiveCapacity", label: "Adaptive Capacity", inverted: true }
  ],

  classes: [
    { value: 1, label: "Very Low"  },
    { value: 2, label: "Low"       },
    { value: 3, label: "Moderate"  },
    { value: 4, label: "High"      },
    { value: 5, label: "Very High" }
  ],

  /* Data ramps are deliberately NOT SEI brand colours — legibility first.
     ramp        : ColorBrewer YlOrRd (5-class sequential), class 1 -> 5.
     rampInverted: ColorBrewer RdYlGn (5-class), used for Adaptive Capacity so
                   that "worst" (very low adaptive capacity) is always red. */
  ramp:         ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"],
  rampInverted: ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"],
  floodRamp:    ["#deebf7", "#9ecae1", "#4292c6", "#2171b5", "#08306b"],
  noDataColor:  "#c9d1d9",

  /* Nairobi County default view */
  defaults: {
    hazard: "flood",
    sector: "social",
    subsector: "health",
    component: "risk",
    center: [-1.303, 36.884],
    zoom: 11
  },

  meta: {
    year: 2026,
    source: "Nairobi CRVA (NCARP) — flood hazard, WorldPop demographics, KMHFL health facilities"
  }
};
