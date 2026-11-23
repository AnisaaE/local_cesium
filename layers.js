import { loadDistricts } from "./districts.js";
import { cfdVelocityLegend, loadCfdPoints, loadGateBuilding } from "./gate-cfd.js";
import { createHeatingDemandLayer } from "./heating-demand.js";
import { loadTemperature, temperatureLegend, temperatureTitle } from "./temperature.js";
import { createWalkabilityLayer, createWalkAccessLayer, createWalkRasterProvider, educationLayers, loadEducationPoints, walkRasters } from "./walkability.js";
import { createTimeLayer } from "./time-layer.js";

const labSensorsUrl =
  "https://services-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/LabSensors/FeatureServer";
const treesUrl =
  "https://raw.githubusercontent.com/eshirinyan/three_sample/refs/heads/main/sp_sofia_trees_i3dm_20250818_glb/tileset.json";

const sensorLayers = [
  { id: "air", serviceId: 3, title: "Air", label: "Станция за качество на въздуха" },
  { id: "lidar", serviceId: 2, title: "LiDAR", label: "LiDAR сензор" },
  { id: "noise", serviceId: 1, title: "Noise", label: "Сензор за шум", labelDistance: 5000 },
  { id: "pedestrian", serviceId: 0, title: "Pedestrian", label: "Сензор за пешеходци", labelDistance: 5000 },
];

const buildingClasses = [
  { value: "administration", color: "rgb(102, 194, 165)", label: "Administration" },
  { value: "business, trade", color: "rgb(252, 141, 98)", label: "Business, trade" },
  { value: "storage", color: "rgba(230, 12, 12, 1)", label: "Storage" },
  { value: "schools, education, research", color: "rgba(235, 42, 161, 1)", label: "Schools, education, research" },
  { value: "industry", color: "rgba(150, 235, 13, 1)", label: "Industry" },
  { value: "habitation", color: "rgb(255, 217, 47)", label: "Habitation" },
  { value: "culture", color: "rgba(6, 28, 234, 1)", label: "Culture" },
  { value: "traffic", color: "rgba(135, 37, 37, 1)", label: "Traffic" },
  { value: "church institution", color: "rgba(162, 0, 255, 1)", label: "Church Institution" },
  { value: "healthcare", color: "rgba(255, 255, 255, 1)", label: "Healthcare" },
  { value: "function", color: "rgba(102, 107, 255, 1)", label: "Function" },
  { value: "sport", color: "rgb(44, 160, 44)", label: "Sport" },
];
const otherClass = { color: "rgba(0, 0, 0, 1)", label: "Other / Unknown" };

export function createLayers(Cesium, viewer, buildings, layerOptions = {}) {
  const layers = new Map(
    sensorLayers.map(config => [config.id, createSensorLayer(Cesium, viewer, config)])
  );
  layers.set("districts", createDataSourceLayer(viewer, {
    title: "Райони на София",
    legend: [{ color: "#ff0000", label: "Административна граница" }],
    load: () => loadDistricts(Cesium),
  }));
  layers.set("temperature-prediction", createDataSourceLayer(viewer, {
    title: temperatureTitle,
    legend: temperatureLegend,
    load: () => loadTemperature(Cesium, viewer.clock.currentTime, layerOptions["temperature-prediction"]),
  }));
  layers.set("gate-cfd", createSceneLayer({
    title: "CFD air speed",
    legend: cfdVelocityLegend,
    load: () => loadCfdPoints(Cesium),
    add: points => viewer.scene.primitives.add(points),
    requestRender: () => viewer.scene.requestRender(),
  }));
  const cityWithoutGate = buildings && new Cesium.Cesium3DTileStyle({
    show: "${cadnum} !== '68134.902.781.31'",
  });
  let cityStyleBeforeGate;
  layers.set("gate-building", createSceneLayer({
    title: "GATE 3D building",
    load: () => loadGateBuilding(Cesium),
    add: model => viewer.scene.primitives.add(model),
    onVisibilityChange(visible) {
      if (!buildings) return;
      if (visible && buildings.style !== cityWithoutGate) {
        cityStyleBeforeGate = buildings.style;
        buildings.style = cityWithoutGate;
      } else if (!visible && buildings.style === cityWithoutGate) {
        buildings.style = cityStyleBeforeGate;
      }
    },
    requestRender: () => viewer.scene.requestRender(),
  }));
  layers.set("time-layer", createTimeLayer(Cesium, viewer, layerOptions["time-layer"]));
  layers.set("trees", createSceneLayer({
    title: "Trees",
    load: () => Cesium.Cesium3DTileset.fromUrl(treesUrl),
    add: tileset => viewer.scene.primitives.add(tileset),
    requestRender: () => viewer.scene.requestRender(),
  }));
  for (const config of educationLayers) {
    layers.set(config.id, createDataSourceLayer(viewer, {
      title: config.title,
      load: () => loadEducationPoints(Cesium, viewer, config),
    }));
  }

  let heatImagery;
  for (const config of walkRasters) {
    layers.set(config.id, createSceneLayer({
      title: config.title,
      load: async () => new Cesium.ImageryLayer(createWalkRasterProvider(Cesium, config), {
        alpha: 1,
      }),
      add(imagery) {
        const collection = viewer.imageryLayers;
        if (config.id === "heat-stress") {
          heatImagery = imagery;
          collection.add(imagery);
        } else {
          // Walk3 lists WBGT above solar, even when either raster is toggled.
          collection.add(imagery, heatImagery ? collection.indexOf(heatImagery) : collection.length);
        }
        return imagery;
      },
      requestRender: () => viewer.scene.requestRender(),
    }));
  }
  layers.set("solar", createSceneLayer({
    title: "Solar",
    load: async () => {
      const url = new URL("./assets/solar/tileset.json", import.meta.url).href;
      const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
        maximumScreenSpaceError: 12,
        shadows: Cesium.ShadowMode.DISABLED,
        pointCloudShading: new Cesium.PointCloudShading({ eyeDomeLighting: false }),
      });
      tileset.style = new Cesium.Cesium3DTileStyle({ pointSize: 3 });
      return tileset;
    },
    add: tileset => viewer.scene.primitives.add(tileset),
    requestRender: () => viewer.scene.requestRender(),
  }));

  if (buildings) {
    const originalStyle = buildings.style;
    const originalBlendMode = buildings.colorBlendMode;
    const conditions = buildingClasses.map(({ value, color }) => [
      `\${citygml_class_description} === '${value}'`,
      color,
    ]);
    conditions.push(["true", otherClass.color]);

    const style = new Cesium.Cesium3DTileStyle({ color: { conditions } });
    layers.set("building-class", {
      title: "Building Class",
      legend: [...buildingClasses, otherClass],
      setVisible(visible, slide) {
        if (visible) {
          buildings.style = style;
          buildings.colorBlendMode = slide.sceneLighting === "daylight"
            ? Cesium.Cesium3DTileColorBlendMode.REPLACE
            : originalBlendMode;
        } else if (buildings.style === style) {
          buildings.style = originalStyle;
          buildings.colorBlendMode = originalBlendMode;
        }
      },
    });
    layers.set("heating-demand", createHeatingDemandLayer(Cesium, viewer, buildings));
    layers.set("walkability-buildings", createWalkabilityLayer(Cesium, viewer, buildings));
    layers.set("walk-access", createWalkAccessLayer(Cesium, viewer, buildings));
  }

  return layers;
}

function createSensorLayer(Cesium, viewer, { id, serviceId, title, label, labelDistance }) {
  const icon = new URL(`./assets/sensors/${id}.png`, import.meta.url).href;

  async function loadStations() {
    const url = `${labSensorsUrl}/${serviceId}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const source = await Cesium.GeoJsonDataSource.load(url, {
      clampToGround: true,
    });
    source.name = title;
    const labelRange = labelDistance
      ? new Cesium.DistanceDisplayCondition(0, labelDistance)
      : undefined;

    for (const station of source.entities.values) {
      if (!station.billboard) continue;

      const name = station.properties?.object?.getValue(viewer.clock.currentTime);
      station.billboard.image = icon;
      // The original icons have transparent padding around the circular symbols.
      station.billboard.width = 48;
      station.billboard.height = 48;
      station.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER;
      station.billboard.heightReference = Cesium.HeightReference.CLAMP_TO_TERRAIN;
      station.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
      if (name) {
        station.name = name;
        station.label = new Cesium.LabelGraphics({
          text: name,
          font: "bold 14px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          heightReference: Cesium.HeightReference.CLAMP_TO_TERRAIN,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: labelRange,
        });
      }
    }

    return source;
  }

  return createDataSourceLayer(viewer, {
    title,
    legend: [{ icon, label }],
    load: loadStations,
  });
}

function createDataSourceLayer(viewer, { title, legend, load }) {
  return createSceneLayer({
    title,
    legend,
    load,
    add: source => viewer.dataSources.add(source),
    requestRender: () => viewer.scene.requestRender(),
  });
}

function createSceneLayer({ title, legend, load, add, onVisibilityChange, requestRender }) {
  let object;
  let loading;
  let visible = false;

  return {
    title,
    legend,
    async setVisible(nextVisible) {
      visible = nextVisible;
      if (visible && !object) {
        loading ??= load()
          .then(async (source) => {
            source.show = visible;
            object = await add(source);
          })
          .finally(() => {
            loading = undefined;
          });
        await loading;
      }
      if (object) {
        object.show = visible;
        onVisibilityChange?.(visible);
        requestRender();
      }
    },
  };
}

