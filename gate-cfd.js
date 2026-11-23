const cfdQueryUrl =
  "https://services-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/CFD_post_isosurface_moved_4326_clipped/FeatureServer/0/query";
const gateSceneUrl =
  "https://tiles-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/Gate_export_20241104_r23_reduced_20241114_notex/SceneServer/layers/0";
const velocityField = "Velocity___m_s__1__";
const pageSize = 16000;

// The model site slab is at 600.20 m. Sofia terrain at its centre is at 603.83 m.
const siteHeightOffset = 3.63;
const gateLongitude = 23.3305844;
const gateLatitude = 42.673897;

const velocityRanges = [
  { limit: 1, color: "#63a6ff", label: "0–1 m/s" },
  { limit: 2, color: "#50ded4", label: "1–2 m/s" },
  { limit: 4, color: "#a1e070", label: "2–4 m/s" },
  { limit: 6, color: "#ffcc60", label: "4–6 m/s" },
  { limit: Infinity, color: "#ff7668", label: "6+ m/s" },
];

export const cfdVelocityLegend = velocityRanges.map(({ color, label }) => ({ color, label }));

export async function loadGateBuilding(Cesium) {
  const origin = Cesium.Cartesian3.fromDegrees(gateLongitude, gateLatitude);
  const corrected = Cesium.Cartesian3.fromDegrees(gateLongitude, gateLatitude, siteHeightOffset);
  const translation = Cesium.Cartesian3.subtract(corrected, origin, new Cesium.Cartesian3());
  return Cesium.I3SDataProvider.fromUrl(gateSceneUrl, {
    cesium3dTilesetOptions: {
      modelMatrix: Cesium.Matrix4.fromTranslation(translation),
    },
  });
}

export async function loadCfdPoints(Cesium) {
  const { count } = await queryCfd(Cesium, { returnCountOnly: true });
  if (!Number.isInteger(count) || count < 1) throw new Error("The GATE CFD layer contains no points.");

  const pages = await Promise.all(Array.from({ length: Math.ceil(count / pageSize) }, (_, index) =>
    queryCfd(Cesium, {
      outFields: velocityField,
      returnGeometry: true,
      returnZ: true,
      outSR: 4326,
      resultType: "standard",
      resultOffset: index * pageSize,
      resultRecordCount: pageSize,
      orderByFields: "ObjectId",
    })
  ));
  if (pages.some((page, index) => !Array.isArray(page.features) ||
      page.features.length !== Math.min(pageSize, count - index * pageSize))) {
    throw new Error("The GATE CFD service returned an incomplete set of points.");
  }

  const colors = velocityRanges.map(({ color }) => Cesium.Color.fromCssColorString(color).withAlpha(0.8));
  const scaleByDistance = new Cesium.NearFarScalar(150, 1.5, 8000, 0.45);
  const points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
  for (const { features } of pages) {
    for (const { geometry, attributes } of features) {
      const { x, y, z } = geometry ?? {};
      const velocity = attributes?.[velocityField];
      if (![x, y, z, velocity].every(Number.isFinite)) continue;
      const color = colors[velocityRanges.findIndex(({ limit }) => velocity < limit)];
      points.add({
        // Keep the CFD heights relative to the building when aligning both to the terrain.
        position: Cesium.Cartesian3.fromDegrees(x, y, z + siteHeightOffset),
        color,
        pixelSize: 3,
        scaleByDistance,
      });
    }
  }
  if (!points.length) {
    points.destroy();
    throw new Error("The GATE CFD layer contains no valid XYZ and velocity values.");
  }
  return points;
}

async function queryCfd(Cesium, query) {
  const resource = new Cesium.Resource({
    url: cfdQueryUrl,
    queryParameters: { where: "1=1", f: "json", ...query },
  });
  const data = await resource.fetchJson();
  if (data.error) throw new Error(`GATE CFD request failed (${data.error.code}).`);
  return data;
}
