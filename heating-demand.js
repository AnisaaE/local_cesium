const dataUrl = new URL("./public/data/cea_energy_by_cadnum.json", import.meta.url);

// CEA_energy_heating_demand in the GATE_DT_20261115 ArcGIS Web Scene.
const stops = [
  { value: 46, rgb: [88, 19, 252] },
  { value: 70.2354, rgb: [28, 194, 253] },
  { value: 94.4708, rgb: [125, 253, 148] },
  { value: 118.7063, rgb: [245, 201, 38] },
  { value: 142.9417, rgb: [255, 43, 24] },
];
const fallback = [170, 170, 170];
const legend = [
  ...stops.map(({ value, rgb }, index) => {
    const bound = index === 0 ? "≤ " : index === stops.length - 1 ? "≥ " : "";
    return { color: `rgb(${rgb.join(", ")})`, label: `${bound}${value}` };
  }),
  { color: `rgb(${fallback.join(", ")})`, label: "No matched energy data" },
];

export function createHeatingDemandLayer(Cesium, viewer, buildings) {
  const colors = stops.map(({ rgb }) => Cesium.Color.fromBytes(...rgb));
  const neutral = Cesium.Color.fromBytes(...fallback);
  const last = stops.length - 1;
  let energyByCadnum;
  let loading;
  let previousStyle;
  let previousBlendMode;
  let visible = false;

  const style = new Cesium.Cesium3DTileStyle();
  style.color = {
    evaluateColor(feature, result) {
      const id = feature?.getProperty("cadnum");
      const value = typeof id === "string" && energyByCadnum?.get(id.trim());
      if (!Number.isFinite(value)) return Cesium.Color.clone(neutral, result);
      if (value <= stops[0].value) return Cesium.Color.clone(colors[0], result);
      if (value >= stops[last].value) return Cesium.Color.clone(colors[last], result);

      const upper = stops.findIndex(stop => value <= stop.value);
      const lower = upper - 1;
      const fraction = (value - stops[lower].value) / (stops[upper].value - stops[lower].value);
      return Cesium.Color.lerp(colors[lower], colors[upper], fraction, result ?? new Cesium.Color());
    },
  };

  return {
    title: "CEA heating demand (kWh/(m²·year))",
    legend,
    async setVisible(nextVisible) {
      if (nextVisible !== visible) {
        visible = nextVisible;
        if (visible) {
          previousStyle = buildings.style;
          previousBlendMode = buildings.colorBlendMode;
          buildings.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
          buildings.style = style;
        } else {
          if (buildings.style === style) buildings.style = previousStyle;
          buildings.colorBlendMode = previousBlendMode;
        }
        viewer.scene.requestRender();
      }

      if (!visible || energyByCadnum) return;
      loading ??= fetch(dataUrl)
        .then(response => {
          if (!response.ok) throw new Error(`Heating demand data returned HTTP ${response.status}.`);
          return response.json();
        })
        .then(data => {
          energyByCadnum = new Map(Object.entries(data));
          if (visible && buildings.style === style) {
            buildings.makeStyleDirty();
            viewer.scene.requestRender();
          }
        })
        .finally(() => { loading = undefined; });
      await loading;
    },
  };
}
