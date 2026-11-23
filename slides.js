const districtBounds = [23.02, 42.39, 23.71, 42.92];
const overviewCamera = {
  longitude: 23.3312323316,
  latitude: 42.5594255987,
  height: 8111.007,
  heading: 0.0094097458,
  pitch: -33.4555808892,
  roll: 0,
};

export const presentationSteps = [
  {
    id: "data-methods-platforms",
    title: "Data, Methods, Platforms",
    layers: ["districts", "building-class", "air", "lidar", "noise", "pedestrian"],
    camera: overviewCamera,
  },
  {
    id: "urban-heat-island",
    title: "Urban Heat Island Temperature predicted",
    layers: ["temperature-prediction", "building-class"],
    layerOptions: { "temperature-prediction": { opacity: 0.50 } },
    sceneLighting: "daylight",
    camera: overviewCamera,
  },
  {
    id: "wrf-temperature",
    title: "WRF 2024 air temperature 2m: 14–22 July 2024",
    layers: ["wrf-temperature"],
    layerOptions: { "wrf-temperature": { frameDurationMs: 500 } },
    basemapUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    terrainLighting: true,
    lightingTime: "2022-03-15T10:26:18Z",
    useBrowserRecommendedResolution: true,
    camera: {
      longitude: 23.426711818168428,
      latitude: 42.55054030740261,
      height: 17647.62363827266,
      heading: 332.8394641505437,
      pitch: -44.599807525412395,
      roll: 0,
    },
  },
  {
    id: "heating-demand",
    title: "CEA Modeled Energy for Heating Demand",
    layers: ["heating-demand"],
  },
  {
    id: "15-minute-city",
    title: "15 minute city and Heat stress",
    layers: ["walkability-buildings", "heat-stress", "schools", "kindergartens", "solar-radiation"],
    layerControls: ["heat-stress", "schools", "kindergartens", "walkability-buildings", "solar-radiation"],
    infoBox: true,
    basemapUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    terrainLighting: true,
    lightingTime: "2022-03-15T10:26:50Z",
    camera: {
      // Walk3 position converted from Web Mercator and EGM96 to WGS84.
      longitude: 23.29257767952927,
      latitude: 42.690157884564975,
      height: 1907.3751847654894,
      heading: 45.57204437120955,
      pitch: -46.88803491971959,
      roll: 0,
    },
  },
  {
    id: "vitosha-views",
    title: "Views toward Vitosha Mountain",
    layers: ["walk-access"],
    camera: {
      longitude: 23.2903206,
      latitude: 42.7276907,
      height: 1153.93,
      heading: 185.322,
      pitch: -3.319,
      roll: 0,
    },
    cameraFlight: {
      longitude: 23.3051809,
      latitude: 42.7246225,
      height: 1152.79,
      heading: 185.322,
      pitch: -3.319,
      roll: 0,
      duration: 8,
    },
  },
  { id: "solar-radiation", title: "Solar radiation on building facades and streets" },
  { id: "cfd", title: "Detailed geometry and CFD analysis" },
];

export const slides = [
  ...presentationSteps.filter(step => step.layers),
  { id: "districts", layers: ["districts"], bounds: districtBounds },
  { id: "air", layers: ["air"] },
  { id: "lidar", layers: ["lidar"] },
  { id: "noise", layers: ["noise"] },
  { id: "pedestrian", layers: ["pedestrian"] },
  { id: "sensors", layers: ["air", "lidar", "noise", "pedestrian"] },
  { id: "building-class", layers: ["building-class"] },
];

export async function applySlide(slide, layers, legendContainer, isCurrent) {
  const activeIds = new Set(slide.layers);
  const entries = [
    ...[...layers].filter(([id]) => !activeIds.has(id)),
    ...[...layers].filter(([id]) => activeIds.has(id)),
  ];
  legendContainer.hidden = true;
  // Release the shared building style before applying the next one.
  const layerUpdates = entries.map(async ([id, layer]) => {
    await layer.setVisible(activeIds.has(id), slide);
  });
  const results = await Promise.allSettled(layerUpdates);
  if (!isCurrent()) return [];
  const availableIds = new Set();
  const failures = [];

  for (const [index, result] of results.entries()) {
    const [id, layer] = entries[index];
    if (result.status === "fulfilled") {
      availableIds.add(id);
    } else {
      console.error(`Failed to update layer ${layer.title}.`, result.reason);
      failures.push(`Слоят „${layer.title}“ не се зареди.`);
    }
  }

  const legends = new Map();
  for (const id of activeIds) {
    if (slide.layerControls && !slide.layerControls.includes(id)) continue;
    const layer = layers.get(id);
    if (layer?.legend?.length && (availableIds.has(id) || slide.layerControls?.includes(id))) {
      const legend = createLegend(layer, id === slide.layers[0] || layer.legend.length === 1);
      legend.hidden = !availableIds.has(id);
      legends.set(id, legend);
    }
  }
  const content = [...legends.values()];
  if (slide.layerControls) {
    content.unshift(createLayerControls(slide.layerControls, layers, availableIds, legends));
  }
  legendContainer.replaceChildren(...content);
  legendContainer.hidden = content.length === 0;
  return failures;
}

function createLayerControls(ids, layers, availableIds, legends) {
  const panel = document.createElement("fieldset");
  panel.className = "slide-layer-controls";
  const title = document.createElement("legend");
  title.textContent = "Layers";
  panel.append(title);

  for (const id of ids) {
    const layer = layers.get(id);
    if (!layer) continue;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = availableIds.has(id);
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    input.addEventListener("change", async () => {
      const visible = input.checked;
      input.disabled = true;
      status.textContent = "";
      try {
        await layer.setVisible(visible);
        const legend = legends.get(id);
        if (legend) legend.hidden = !visible;
      } catch (error) {
        console.error(`Failed to update layer ${layer.title}.`, error);
        input.checked = !visible;
        status.textContent = "Layer update failed.";
      } finally {
        input.disabled = false;
      }
    });
    label.append(input, document.createTextNode(layer.title));
    panel.append(label, status);
  }
  return panel;
}

function createLegend({ title, legend }, open) {
  const panel = document.createElement("details");
  panel.open = open;
  const heading = document.createElement("summary");
  heading.textContent = title;
  const list = document.createElement("ul");

  for (const { label, color, icon } of legend) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    if (icon) {
      swatch.className = "legend-icon";
      swatch.style.backgroundImage = `url("${icon}")`;
    } else {
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = color;
    }
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(label));
    list.append(item);
  }
  panel.append(heading, list);
  return panel;
}
