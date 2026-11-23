import { createLayers } from "./layers.js";
import { showCameraDebug } from "./camera-debug.js";
import { setupPresentation } from "./presentation.js";
import { applySlide, slides } from "./slides.js";

const terrainAssetId = 2564867;
const buildingsUrl =
  "https://raw.githubusercontent.com/eshirinyan/three_sample/refs/heads/main/sofia_building_tiles_20261027/tileset.json";
const orthophotoUrl =
  "https://tiles-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/sofia_orthophoto_2020_city_50cm_alpha_3857_tif/MapServer/";

const statusMessage = document.getElementById("status");

async function start() {
  const Cesium = window.Cesium;
  if (!Cesium) {
    throw new Error("CesiumJS failed to load.");
  }

  const params = new URLSearchParams(window.location.search);
  const slideId = params.get("slide");
  const slide = slides.find(({ id }) => id === slideId) ?? slides[0];
  const useDaylight = slide.sceneLighting === "daylight";

  Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1OTdkNmE4OS0yZTVmLTQ1OTUtODNhNi1hOTVjMjAyMTU2ODUiLCJpZCI6MzI3NDAsInNjb3BlcyI6WyJhc3IiLCJnYyJdLCJpYXQiOjE1OTc0MDQwNTB9.FrhV7MfxnIPM1ikW8-Z4VaGJzKxwvZk_Y-Nb7HwOWa0";

  const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: slide.infoBox ?? false,
    navigationHelpButton: false,
    selectionIndicator: false,
    timeline: false,
    scene3DOnly: true,
    useBrowserRecommendedResolution: slide.useBrowserRecommendedResolution ?? false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.enableLighting = slide.terrainLighting ?? false;
  if (slide.lightingTime) {
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(slide.lightingTime);
    viewer.clock.shouldAnimate = false;
  }
  if (useDaylight) {
    // Use a fixed, neutral light from above and southwest of Sofia.
    const center = Cesium.Cartesian3.fromDegrees(23.3219, 42.6977);
    const localFrame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const direction = Cesium.Matrix4.multiplyByPointAsVector(
      localFrame, new Cesium.Cartesian3(0.4, 0.6, -0.75), new Cesium.Cartesian3()
    );
    viewer.scene.light = new Cesium.DirectionalLight({ direction, intensity: 2.0 });
    viewer.scene.highDynamicRange = false;
    viewer.shadows = false;
  }
  let buildingTileset;

  function cameraView({ longitude, latitude, height, heading, pitch, roll }) {
    return {
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: Cesium.Math.toRadians(roll),
      },
    };
  }

  function focusMap() {
    if (slide.camera) {
      viewer.camera.setView(cameraView(slide.camera));
    } else if (slide.bounds) {
      viewer.camera.setView({ destination: Cesium.Rectangle.fromDegrees(...slide.bounds) });
    } else if (buildingTileset) {
      void viewer.flyTo(buildingTileset);
    } else {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(23.3219, 42.6977, 11000),
      });
    }
    viewer.scene.requestRender();
  }

  function playCameraFlight() {
    const flight = slide.cameraFlight;
    viewer.camera.cancelFlight();
    focusMap();
    viewer.camera.flyTo({
      ...cameraView(flight),
      duration: flight.duration,
      maximumHeight: Math.max(slide.camera.height, flight.height),
      easingFunction: Cesium.EasingFunction.SINUSOIDAL_IN_OUT,
    });
  }

  focusMap();
  if (params.get("debug") === "1") showCameraDebug(Cesium, viewer);

  async function loadTerrain() {
    const terrainResource = await Cesium.IonResource.fromAssetId(terrainAssetId, {
      accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjNWUzZmI0ZS02NDcxLTRlNjktYTcyYi00OWZlNTA4ZmViMTAiLCJpZCI6NDY4MjksImlhdCI6MTYxNjYwMTM4Nn0.3KOIXUjF4QpChsVKmW9pNy5WdE6qi3C61jBJc9VJGIQ",
    });
    viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
      terrainResource,
      { requestVertexNormals: true }
    );
    viewer.scene.requestRender();
  }

  async function loadBuildings() {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(buildingsUrl, {
      dynamicScreenSpaceError: false,
      maximumScreenSpaceError: 1,
      skipLevelOfDetail: true,
    });
    if (useDaylight) {
      tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
    }
    return tileset;
  }

  async function loadBasemap() {
    if (!slide.basemapUrl) return;
    const current = viewer.imageryLayers.length ? viewer.imageryLayers.get(0) : undefined;
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(slide.basemapUrl, {
      enablePickFeatures: false,
    });
    viewer.imageryLayers.addImageryProvider(provider, 0);
    if (current) viewer.imageryLayers.remove(current);
    viewer.scene.requestRender();
  }

  async function loadOrthophoto() {
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(orthophotoUrl, {
      enablePickFeatures: false,
    });
    viewer.imageryLayers.addImageryProvider(provider);
    viewer.scene.requestRender();
  }

  const [terrain, buildings, basemap, orthophoto] = await Promise.allSettled([
    loadTerrain(),
    loadBuildings(),
    loadBasemap(),
    loadOrthophoto(),
  ]);
  const failures = [];

  if (terrain.status === "rejected") {
    console.error("Sofia terrain failed to load.", terrain.reason);
    failures.push("Теренът на София не се зареди.");
  }
  if (buildings.status === "rejected") {
    console.error("Sofia buildings failed to load.", buildings.reason);
    failures.push("3D сградите на София не се заредиха.");
  }
  if (basemap.status === "rejected") {
    console.error("The WRF basemap failed to load.", basemap.reason);
    failures.push("Сателитната подложка на WRF не се зареди.");
  }
  if (orthophoto.status === "rejected") {
    console.error("Sofia orthophoto failed to load.", orthophoto.reason);
    failures.push("Ортофотото на София не се зареди.");
  }

  buildingTileset = buildings.value;
  const layers = createLayers(Cesium, viewer, buildingTileset, slide.layerOptions);
  const layerUpdates = applySlide(slide, layers, document.getElementById("layerLegends"));
  if (buildingTileset) {
    viewer.scene.primitives.add(buildingTileset);
    if (slide.camera || slide.bounds) {
      viewer.scene.requestRender();
    } else {
      focusMap();
    }
  }
  setupPresentation(slide, slide.cameraFlight ? playCameraFlight : focusMap);

  failures.push(...await layerUpdates);
  statusMessage.textContent = failures.join(" ");
  statusMessage.hidden = failures.length === 0;
  if (slide.cameraFlight) playCameraFlight();
}

start().catch((error) => {
  console.error(error);
  statusMessage.textContent = "3D картата не може да се стартира.";
});
