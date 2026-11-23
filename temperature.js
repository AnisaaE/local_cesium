const temperatureUrl =
  "https://services-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/obs_20180822_temp_restructured_grid_3857_21_00/FeatureServer/0/query";

const pageSize = 2000;
const stops = [
  { value: 21.6801, color: "#5813FC" },
  { value: 22.8268, color: "#1CC2FD" },
  { value: 23.9734, color: "#7DFD94" },
  { value: 25.1200, color: "#F5C926" },
  { value: 26.2667, color: "#FF2B18" },
];

export const temperatureTitle = "Temp predict 9pm 20180822";
export const temperatureLegend = stops.map(({ value, color }) => ({
  color,
  label: `${value.toFixed(4)} °C`,
}));

export async function loadTemperature(Cesium, time, { opacity = 0.50 } = {}) {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError("Temperature opacity must be between 0 and 1.");
  }

  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(temperatureUrl);
    url.search = new URLSearchParams({
      where: "1=1",
      outFields: "OBJECTID,Temp_float",
      returnGeometry: "true",
      outSR: "4326",
      orderByFields: "OBJECTID ASC",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: "geojson",
    });

    const page = await Cesium.Resource.fetchJson(url.href);
    if (page?.type !== "FeatureCollection") {
      throw new Error(page?.error?.message ?? "Invalid temperature GeoJSON.");
    }
    features.push(...page.features);
    if (!page.properties?.exceededTransferLimit) break;
  }

  const source = await Cesium.GeoJsonDataSource.load({ type: "FeatureCollection", features }, {
    clampToGround: true,
    fill: Cesium.Color.TRANSPARENT,
    stroke: Cesium.Color.TRANSPARENT,
  });
  source.name = temperatureTitle;

  const palette = stops.map(({ value, color }) => ({
    value,
    color: Cesium.Color.fromCssColorString(color).withAlpha(opacity),
  }));
  for (const entity of source.entities.values) {
    if (!entity.polygon) continue;
    const temperature = entity.properties?.Temp_float?.getValue(time);
    entity.polygon.outline = false;
    entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
    if (Number.isFinite(temperature)) {
      entity.polygon.material = interpolateColor(Cesium, palette, temperature);
    } else {
      entity.polygon.show = false;
    }
  }
  return source;
}

function interpolateColor(Cesium, palette, value) {
  if (value <= palette[0].value) return palette[0].color;
  for (let index = 1; index < palette.length; index++) {
    const high = palette[index];
    if (value <= high.value) {
      const low = palette[index - 1];
      const fraction = (value - low.value) / (high.value - low.value);
      return Cesium.Color.lerp(low.color, high.color, fraction, new Cesium.Color());
    }
  }
  return palette[palette.length - 1].color;
}
