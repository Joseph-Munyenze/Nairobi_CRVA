/* =============================================================================
   config.js — CRVA taxonomy registry (full build)
   Edit THIS file to add/change data. Drop WGS84 GeoJSON into /data, then point
   a subsector at it. Nothing in the other JS files needs to change.
   Classification defaults to Jenks; override per component via
   `classify: { key: "quantile" | "jenks" }`. Colours are cool graduated ramps.
   ========================================================================== */

const CRVA_CONFIG = {

  defaultClassify: "jenks",

  hazards: {
    flood: {
      label: "Flood Hazard", enabled: true,
      hazardRaster: null, hazardLayer: "data/flood_hazard.geojson",
      hazardClassField: "gridcode", hazardNoData: [0]
    },
    airquality: {
      label: "Air Quality Hazard", enabled: true,
      hazardRaster: null, hazardLayer: "data/airquality_hazard.geojson",
      hazardClassField: "gridcode", hazardNoData: [0]
    },
    coldheat: {
      label: "Cold and Heat Hazard", enabled: true,
      hazardRaster: null, hazardLayer: "data/coldheat_hazard.geojson",
      hazardClassField: "hazardValue", hazardContinuous: true
    },
    waterstress: {
      label: "Water Stress Hazard", enabled: true,
      hazardRaster: null, hazardLayer: "data/waterstress_hazard.geojson",
      hazardClassField: "gridcode", hazardNoData: [0]
    },
    landslide: { label: "Landslide Hazard", enabled: false }
  },

  sectors: {

    social: {
      label: "Social Sector", enabled: true,
      subsectors: {
        health: {
          label: "Health (Flood)", enabled: true,
          indexLayer: "data/flood_health_areas.geojson",
          nameField: "Name",
          // Facilities aggregated into the 147 KNBS areas as a visible choropleth.
          components: ["facVeryHigh", "facHighPlus", "facTotal"],
          indices: {
            facVeryHigh: "facVeryHigh",
            facHighPlus: "facHighPlus",
            facTotal:    "facTotal"
          },
          classify: { facVeryHigh: "jenks", facHighPlus: "jenks", facTotal: "jenks" },
          unitLabel: "Areas", unitLabelOne: "area",
          extraFields: [
            { field: "facTotal",    label: "Health facilities (total)", format: "int" },
            { field: "facVeryHigh", label: "In very high risk",         format: "int" },
            { field: "facHigh",     label: "In high risk",              format: "int" },
            { field: "facModerate", label: "In moderate risk",          format: "int" },
            { field: "zoneLabel",   label: "Air-quality hazard zone",   format: "text" }
          ],
          // The original facility points remain available as an optional overlay.
          assetLayer: "data/health_facilities.geojson",
          assetLabel: "Health Facilities", assetLabelOne: "health facility",
          assetNameField: "Facility_N", assetRiskField: "RiskZone",
          assetClassField: "RiskClass", assetTypeField: "Type", assetOwnerField: "Owner"
        },
        aqHealth: {
          label: "Health (Air Quality)", enabled: true,
          indexLayer: "data/aq_health.geojson", nameField: "Name",
          components: ["risk", "exposure", "vulnerability", "hazardZone"],
          indices: { risk: "risk", exposure: "exposure", vulnerability: "vulnerability", hazardZone: "hazardZone" },
          unitLabel: "Areas", unitLabelOne: "area",
          extraFields: [ { field: "zoneLabel", label: "Hazard zone", format: "text" },
                         { field: "riskRank", label: "Risk rank", format: "int" } ]
        },
        aqEducation: {
          label: "Education (Air Quality)", enabled: true,
          indexLayer: "data/aq_education.geojson", nameField: "Name",
          components: ["risk", "exposure", "vulnerability", "hazardZone"],
          indices: { risk: "risk", exposure: "exposure", vulnerability: "vulnerability", hazardZone: "hazardZone" },
          unitLabel: "Areas", unitLabelOne: "area",
          extraFields: [ { field: "zoneLabel", label: "Hazard zone", format: "text" },
                         { field: "riskRank", label: "Risk rank", format: "int" } ]
        },
        aqPopulation: {
          label: "Population (Air Quality)", enabled: true,
          indexLayer: "data/aq_population.geojson", nameField: "Name",
          components: ["risk", "exposure", "vulnerability", "hazardZone"],
          indices: { risk: "risk", exposure: "exposure", vulnerability: "vulnerability", hazardZone: "hazardZone" },
          unitLabel: "Areas", unitLabelOne: "area",
          extraFields: [ { field: "zoneLabel", label: "Hazard zone", format: "text" },
                         { field: "riskRank", label: "Risk rank", format: "int" } ]
        },
        aqOverall: {
          label: "Socioeconomic Overall (Air Quality)", enabled: true,
          indexLayer: "data/aq_overall.geojson", nameField: "Name",
          components: ["risk", "impact", "hazardZone"],
          indices: { risk: "risk", impact: "impact", hazardZone: "hazardZone" },
          unitLabel: "Areas", unitLabelOne: "area",
          extraFields: [ { field: "zoneLabel", label: "Hazard zone", format: "text" },
                         { field: "riskRank", label: "Risk rank", format: "int" } ]
        }
      }
    },

    infrastructure: {
      label: "Infrastructure", enabled: true,
      subsectors: makeFloodInfra()
    },

    finance: {
      label: "Finance and Production", enabled: true,
      subsectors: makeColdHeatFinance()
    },

    environment: {
      label: "Environment and Natural Resources", enabled: true,
      subsectors: { climate: { label: "Environment and Climate Change", enabled: false } }
    },

    governance: {
      label: "Governance", enabled: true,
      subsectors: { sublocations: { label: "Sublocations", enabled: false } }
    }
  },

  components: [
    { key: "risk",             label: "Risk" },
    { key: "impact",           label: "Impact" },
    { key: "exposure",         label: "Exposure" },
    { key: "sensitivity",      label: "Sensitivity" },
    { key: "vulnerability",    label: "Vulnerability" },
    { key: "adaptiveCapacity", label: "Adaptive Capacity", inverted: true },
    { key: "adaptiveCap",      label: "Adaptive Capacity", inverted: true },
    { key: "hazardZone",       label: "Hazard Zone" },
    { key: "hazardMean",       label: "Hazard (mean)" },
    { key: "facTotal",         label: "Health Facilities (total)" },
    { key: "facHighPlus",      label: "Facilities in High + Very High Risk" },
    { key: "facVeryHigh",      label: "Facilities in Very High Risk" }
  ],

  classes: [
    { value: 1, label: "Very Low"  },
    { value: 2, label: "Low"       },
    { value: 3, label: "Moderate"  },
    { value: 4, label: "High"      },
    { value: 5, label: "Very High" }
  ],

  ramp:         ["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"],
  rampInverted: ["#006d2c", "#2ca25f", "#66c2a4", "#b2e2e2", "#edf8fb"],
  floodRamp:    ["#deebf7", "#9ecae1", "#4292c6", "#2171b5", "#08306b"],
  noDataColor:  "#c9d1d9",

  hazardRamps: {
    flood:      ["#deebf7", "#9ecae1", "#4292c6", "#2171b5", "#08306b"],
    airquality: ["#e0ecf4", "#9ebcda", "#8c96c6", "#8856a7", "#810f7c"],
    coldheat:   ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
    waterstress:["#f7fcf0", "#bae4bc", "#7bccc4", "#2b8cbe", "#08589e"]
  },

  defaults: {
    hazard: "flood", sector: "social", subsector: "health", component: "risk",
    center: [-1.286, 36.855], zoom: 11
  },

  meta: {
    year: 2026,
    source: "Nairobi CRVA (NCARP) — flood, air-quality, cold/heat & water-stress hazards; " +
            "infrastructure, socioeconomic & finance sector assessments"
  }
};

function makeFloodInfra() {
  const defs = { housing: "Housing & Public Buildings", wash: "WASH",
    sports: "Sports & Recreation", energy: "Energy", ict: "ICT",
    publicworks: "Public Works", transport: "Transport" };
  const subs = {};
  for (const [key, label] of Object.entries(defs)) {
    subs[key] = {
      label, enabled: true,
      indexLayer: `data/flood_${key}.geojson`, nameField: "Name",
      components: ["risk", "impact", "exposure", "sensitivity", "vulnerability", "adaptiveCap"],
      indices: { risk: "risk", impact: "impact", exposure: "exposure",
        sensitivity: "sensitivity", vulnerability: "vulnerability", adaptiveCap: "adaptiveCap" },
      unitLabel: "Areas", unitLabelOne: "area",
      extraFields: [ { field: "hazardMean", label: "Hazard (mean)", format: "num" } ]
    };
  }
  return subs;
}

function makeColdHeatFinance() {
  const defs = { agriculture: "Agriculture", finance: "Financial Services",
    manufacturing: "Manufacturing", trade: "Trade & Markets" };
  const subs = {};
  for (const [key, label] of Object.entries(defs)) {
    subs[key] = {
      label, enabled: true,
      indexLayer: `data/coldheat_${key}.geojson`, nameField: "Name",
      components: ["impact", "exposure", "sensitivity", "vulnerability", "adaptiveCap"],
      indices: { impact: "impact", exposure: "exposure", sensitivity: "sensitivity",
        vulnerability: "vulnerability", adaptiveCap: "adaptiveCap" },
      noData: { field: "dataStatus", equals: "NO_DATA",
        appliesTo: ["impact", "exposure", "sensitivity", "vulnerability", "adaptiveCap"] },
      unitLabel: "Sublocations", unitLabelOne: "sublocation",
      extraFields: [ { field: "division", label: "Division", format: "text" },
                     { field: "dataStatus", label: "Data status", format: "text" } ]
    };
  }
  return subs;
}
