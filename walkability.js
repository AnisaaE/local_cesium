const imageryRoot = "https://tiles-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services";
const pointsRoot = "https://raw.githubusercontent.com/eshirinyan/sofia_data/refs/heads/main";
const walkabilityUrl = new URL("./public/data/walkability_by_cadnum.json", import.meta.url);

export const walkRasters = [
  {
    id: "heat-stress",
    title: "Heat Stress (WBGT)",
    service: "WBGT_22082018_1600_tiles_UHI_palette",
    minimumLevel: 10,
    extent: [2549446.314595109, 5218939.691497494, 2641324.755888221, 5310987.274247459],
  },
  {
    id: "solar-radiation",
    title: "Solar Radiation",
    service: "dtcc_solar_total_rad_qgis_20180822T1600_tif",
    minimumLevel: 14,
    extent: [2583049.430622959, 5247610.5267311055, 2610841.680725466, 5276803.601949053],
  },
];

export function createWalkRasterProvider(Cesium, config) {
  const { service, extent, minimumLevel } = config;
  const [xmin, ymin, xmax, ymax] = extent;
  const tilingScheme = new Cesium.WebMercatorTilingScheme();
  const southwest = tilingScheme.projection.unproject(new Cesium.Cartesian3(xmin, ymin));
  const northeast = tilingScheme.projection.unproject(new Cesium.Cartesian3(xmax, ymax));
  const rectangle = new Cesium.Rectangle(southwest.longitude, southwest.latitude, northeast.longitude, northeast.latitude);
  const transparent = document.createElement("canvas");
  transparent.width = transparent.height = 1;

  class CachedRaster extends Cesium.UrlTemplateImageryProvider {
    requestImage(x, y, level, request) {
      // Keep Cesium's imagery pyramid without requesting uncached overview tiles.
      if (level < minimumLevel) return Promise.resolve(transparent);
      return super.requestImage(x, y, level, request);
    }
  }

  return new CachedRaster({
    url: `${imageryRoot}/${service}/MapServer/tile/{z}/{y}/{x}`,
    tilingScheme,
    rectangle,
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 20,
    enablePickFeatures: false,
  });
}

export const educationLayers = [
  { id: "schools", title: "Schools", color: "#2BC0FF", file: "sofiaplan_schools_points_20230705_shortversion_4326.geojson" },
  { id: "kindergartens", title: "Kindergartens", color: "#FC921F", file: "dg_points_26_sp_2023_enriched_sp.geojson" },
];

const pointFields = {
  objectid: "ID",
  object_nom: "Number",
  adres: "Address",
  finansiran: "Funding code",
  type: "Type code",
  kod_rayon: "District code",
  status: "Status",
  url: "Website",
  dg_sofia_2023_hyperlink: "Website",
  detaili: "Details",
};

export async function loadEducationPoints(Cesium, viewer, { title, color, file }) {
  const source = await Cesium.GeoJsonDataSource.load(`${pointsRoot}/${file}`, { describe: () => "" });
  source.name = title;
  const markerColor = Cesium.Color.fromCssColorString(color);
  const time = viewer.clock.currentTime;
  for (const entity of source.entities.values) {
    const position = Cesium.Cartographic.fromCartesian(entity.position.getValue(time));
    entity.position = Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, 15);
    entity.billboard = undefined;
    entity.point = new Cesium.PointGraphics({
      pixelSize: 9,
      color: markerColor,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      heightReference: Cesium.HeightReference.RELATIVE_TO_TERRAIN,
    });

    const properties = entity.properties.getValue(time);
    entity.name = properties.object_nam || title;
    const table = document.createElement("table");
    table.className = "cesium-infoBox-defaultTable";
    for (const [key, value] of Object.entries(properties)) {
      if (key === "object_nam" || value == null || value === "") continue;
      const row = table.insertRow();
      row.appendChild(document.createElement("th")).textContent = pointFields[key] ?? key;
      const cell = row.insertCell();
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        const link = document.createElement("a");
        link.href = value;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open link";
        cell.append(link);
      } else {
        cell.textContent = String(value);
      }
    }
    entity.description = table.outerHTML;
  }
  return source;
}

// The continuous colorInfo renderer and class-break fill from ArcGIS Walk3.
const stops = [
  [32, [37, 52, 148]],
  [38.2011, [44, 127, 184]],
  [44.4021, [65, 182, 196]],
  [50.6031, [161, 218, 180]],
  [56.8042, [255, 255, 204]],
];
const neutral = [170, 170, 170];
const legend = stops.map(([value, rgb], index) => ({
  label: `${index === 0 ? "≤ " : index === stops.length - 1 ? "≥ " : ""}${value}`,
  color: `rgb(${rgb.join(", ")})`,
}));
legend.push({ label: "No matched walkability data", color: `rgb(${neutral.join(", ")})` });

export function createWalkabilityLayer(Cesium, viewer, buildings) {
  const colors = stops.map(([, rgb]) => Cesium.Color.fromBytes(...rgb));
  const fallback = Cesium.Color.fromBytes(...neutral);
  const last = stops.length - 1;
  let lookup;
  let previousStyle;
  let previousBlend;
  let active = false;
  const style = new Cesium.Cesium3DTileStyle();
  style.color = {
    evaluateColor(feature, result) {
      const id = feature?.getProperty("cadnum");
      const value = typeof id === "string" ? lookup.get(id.trim()) : undefined;
      if (!Number.isFinite(value)) return Cesium.Color.clone(fallback, result);
      if (value <= stops[0][0]) return Cesium.Color.clone(colors[0], result);
      if (value >= stops[last][0]) return Cesium.Color.clone(colors[last], result);
      const upper = stops.findIndex(([stop]) => value <= stop);
      const low = stops[upper - 1][0];
      const fraction = (value - low) / (stops[upper][0] - low);
      return Cesium.Color.lerp(colors[upper - 1], colors[upper], fraction, result);
    },
  };

  return {
    title: "Walkability Buildings",
    legend,
    async setVisible(visible) {
      if (visible === active) return;
      if (visible) {
        if (!lookup) {
          const response = await fetch(walkabilityUrl);
          if (!response.ok) throw new Error(`Walkability data returned HTTP ${response.status}.`);
          lookup = new Map(Object.entries(await response.json()));
        }
        previousStyle = buildings.style;
        previousBlend = buildings.colorBlendMode;
        buildings.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
        buildings.style = style;
      } else {
        if (buildings.style === style) buildings.style = previousStyle;
        buildings.colorBlendMode = previousBlend;
      }
      active = visible;
      viewer.scene.requestRender();
    },
  };
}

// The main project's walk_access_index classes from js/color-config.js.
const walkAccessClasses = [
  { minimum: 80, color: "rgb(88, 140, 126)", label: "≥ 0.8 (Excellent – Class A)" },
  { minimum: 60, color: "rgb(242, 227, 148)", label: "0.6 – 0.79 (Good – Class B)" },
  { minimum: 40, color: "rgb(242, 174, 114)", label: "0.4 – 0.59 (Average – Class C)" },
  { minimum: 20, color: "rgb(217, 100, 89)", label: "0.2 – 0.39 (Poor – Class D)" },
  { color: "rgb(128, 0, 0)", label: "< 0.2 (Very Poor – Class E)" },
];
const noWalkAccess = { color: "rgb(200, 200, 200)", label: "Unknown / No Data" };

export function createWalkAccessLayer(Cesium, viewer, buildings) {
  const attribute = "${feature['walk_access_index']}";
  const value = `Number(${attribute})`;
  const conditions = [
    [`${attribute} === undefined || isNaN(${value})`, noWalkAccess.color],
    ...walkAccessClasses.map(({ minimum, color }) => [
      minimum === undefined ? "true" : `${value} >= ${minimum}`,
      color,
    ]),
  ];
  const style = new Cesium.Cesium3DTileStyle({ color: { conditions } });
  let previousStyle;
  return {
    title: "Walkability Index",
    legend: [...walkAccessClasses, noWalkAccess],
    setVisible(visible) {
      if (visible && buildings.style !== style) {
        previousStyle = buildings.style;
        buildings.style = style;
      } else if (!visible && buildings.style === style) {
        buildings.style = previousStyle;
      } else {
        return;
      }
      viewer.scene.requestRender();
    },
  };
}
