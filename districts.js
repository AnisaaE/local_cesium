const districtsUrl =
  "https://services-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/boundaries_disctricts_20260407/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";

export async function loadDistricts(Cesium) {
  const { type, features, error } = await Cesium.Resource.fetchJson(districtsUrl);
  if (type !== "FeatureCollection") {
    throw new Error(error?.message ?? "Invalid district GeoJSON.");
  }

  const source = new Cesium.CustomDataSource("Райони на София");
  for (const { geometry, properties } of features) {
    if (!geometry) continue;
    const polygons = geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [geometry.coordinates];

    for (const polygon of polygons) {
      for (const ring of polygon) {
        source.entities.add({
          polyline: {
            positions: ring.map(([longitude, latitude]) =>
              Cesium.Cartesian3.fromDegrees(longitude, latitude)
            ),
            material: Cesium.Color.RED,
            width: 2,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
      }
    }

    const name = properties.obns_lat;
    const position = findLabelPosition(polygons);
    if (name && position) {
      source.entities.add({
        name,
        position: Cesium.Cartesian3.fromDegrees(...position),
        label: {
          text: name,
          font: "bold 14px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.CLAMP_TO_TERRAIN,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }
  return source;
}

function findLabelPosition(polygons) {
  let bestPosition;
  let bestWidth = 0;

  // Midpoints of scanline intervals lie inside the district and outside its holes.
  for (const rings of polygons) {
    const latitudes = rings[0].map(([, latitude]) => latitude);
    const south = Math.min(...latitudes);
    const north = Math.max(...latitudes);
    for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const latitude = south + (north - south) * fraction;
      const crossings = [];
      for (const ring of rings) {
        for (let index = 1; index < ring.length; index++) {
          const [x1, y1] = ring[index - 1];
          const [x2, y2] = ring[index];
          if ((y1 > latitude) !== (y2 > latitude)) {
            crossings.push(x1 + (x2 - x1) * (latitude - y1) / (y2 - y1));
          }
        }
      }
      crossings.sort((a, b) => a - b);
      for (let index = 1; index < crossings.length; index += 2) {
        const west = crossings[index - 1];
        const east = crossings[index];
        if (east - west > bestWidth) {
          bestWidth = east - west;
          bestPosition = [(west + east) / 2, latitude];
        }
      }
    }
  }
  return bestPosition;
}
