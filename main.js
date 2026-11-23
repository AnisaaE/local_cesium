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
  const initialSlide = slides.find(({ id }) => id === slideId) ?? slides[0];

  Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1OTdkNmE4OS0yZTVmLTQ1OTUtODNhNi1hOTVjMjAyMTU2ODUiLCJpZCI6MzI3NDAsInNjb3BlcyI6WyJhc3IiLCJnYyJdLCJpYXQiOjE1OTc0MDQwNTB9.FrhV7MfxnIPM1ikW8-Z4VaGJzKxwvZk_Y-Nb7HwOWa0";

  const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: slides.some(slide => slide.infoBox),
    navigationHelpButton: false,
    selectionIndicator: false,
    timeline: false,
    scene3DOnly: true,
    useBrowserRecommendedResolution: initialSlide.useBrowserRecommendedResolution ?? false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  const defaultLight = viewer.scene.light;
  const defaultHdr = viewer.scene.highDynamicRange;
  const defaultShadows = viewer.shadows;
  const defaultTime = viewer.clock.currentTime.clone();
  const defaultClockAnimation = viewer.clock.shouldAnimate;
  const basemapLayers = new Map();
  // Use a fixed, neutral light from above and southwest of Sofia.
  const center = Cesium.Cartesian3.fromDegrees(23.3219, 42.6977);
  const localFrame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const direction = Cesium.Matrix4.multiplyByPointAsVector(
    localFrame, new Cesium.Cartesian3(0.4, 0.6, -0.75), new Cesium.Cartesian3()
  );
  const daylight = new Cesium.DirectionalLight({ direction, intensity: 2.0 });
  let buildingTileset;
  let cameraFlightId = 0;

  function applySceneSettings(slide) {
    const useDaylight = slide.sceneLighting === "daylight";
    viewer.scene.globe.enableLighting = slide.terrainLighting ?? false;
    viewer.scene.light = useDaylight ? daylight : defaultLight;
    viewer.scene.highDynamicRange = useDaylight ? false : defaultHdr;
    viewer.shadows = useDaylight ? false : defaultShadows;
    viewer.clock.currentTime = slide.lightingTime
      ? Cesium.JulianDate.fromIso8601(slide.lightingTime)
      : defaultTime.clone();
    viewer.clock.shouldAnimate = slide.lightingTime ? false : defaultClockAnimation;
    viewer.useBrowserRecommendedResolution = slide.useBrowserRecommendedResolution ?? false;
    if (viewer.infoBox) {
      viewer.selectedEntity = undefined;
      viewer.infoBox.container.style.display = slide.infoBox ? "" : "none";
    }
    for (const [url, layer] of basemapLayers) {
      layer.alpha = url === slide.basemapUrl ? 1 : 0;
    }
    viewer.scene.requestRender();
  }

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

  function playCameraFlight(slide) {
    const flight = slide.cameraFlight;
    viewer.camera.flyTo({
      ...cameraView(flight),
      duration: flight.duration,
      maximumHeight: Math.max(slide.camera.height, flight.height),
      easingFunction: Cesium.EasingFunction.SINUSOIDAL_IN_OUT,
    });
  }

  function focusMap(slide, duration = 1.6, playFlight = true) {
    const id = ++cameraFlightId;
    viewer.camera.cancelFlight();
    const flight = {
      duration,
      easingFunction: Cesium.EasingFunction.SINUSOIDAL_IN_OUT,
    };
    if (playFlight && slide.cameraFlight) {
      flight.complete = () => queueMicrotask(() => {
        if (id === cameraFlightId) playCameraFlight(slide);
      });
    }
    if (!slide.camera && !slide.bounds && buildingTileset) {
      viewer.camera.flyToBoundingSphere(buildingTileset.boundingSphere, flight);
    } else {
      const view = slide.camera
        ? cameraView(slide.camera)
        : {
          destination: slide.bounds
            ? Cesium.Rectangle.fromDegrees(...slide.bounds)
            : Cesium.Cartesian3.fromDegrees(23.3219, 42.6977, 11000),
        };
      viewer.camera.flyTo({ ...view, ...flight });
    }
    viewer.scene.requestRender();
  }

  applySceneSettings(initialSlide);
  focusMap(initialSlide, 0, false);
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
    return Cesium.Cesium3DTileset.fromUrl(buildingsUrl, {
      dynamicScreenSpaceError: false,
      maximumScreenSpaceError: 1,
      skipLevelOfDetail: true,
    });
  }

  function loadImagery(url) {
    return Cesium.ArcGisMapServerImageryProvider.fromUrl(url, {
      enablePickFeatures: false,
    });
  }

  const basemapUrls = [...new Set(slides.map(slide => slide.basemapUrl).filter(Boolean))];
  const [terrain, buildings, orthophoto, ...basemaps] = await Promise.allSettled([
    loadTerrain(),
    loadBuildings(),
    loadImagery(orthophotoUrl),
    ...basemapUrls.map(loadImagery),
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
  basemaps.forEach((result, index) => {
    const url = basemapUrls[index];
    if (result.status === "fulfilled") {
      // Keep the default imagery underneath, including while tiles load.
      const layer = viewer.imageryLayers.addImageryProvider(result.value);
      layer.alpha = url === initialSlide.basemapUrl ? 1 : 0;
      basemapLayers.set(url, layer);
    } else {
      console.error("The satellite basemap failed to load.", result.reason);
    }
  });
  if (orthophoto.status === "rejected") {
    console.error("Sofia orthophoto failed to load.", orthophoto.reason);
    failures.push("Ортофотото на София не се зареди.");
  } else {
    viewer.imageryLayers.addImageryProvider(orthophoto.value);
  }

  buildingTileset = buildings.value;
  if (buildingTileset) {
    viewer.scene.primitives.add(buildingTileset);
    if (!initialSlide.camera && !initialSlide.bounds) focusMap(initialSlide, 0);
  }

  const layerOptions = Object.assign({}, ...slides.map(slide => slide.layerOptions));
  const layers = createLayers(Cesium, viewer, buildingTileset, layerOptions);
  const legendContainer = document.getElementById("layerLegends");
  const slideInfo = document.getElementById("slideInfo");
  const slideInfoTitle = document.getElementById("slideInfoTitle");
  const slideInfoContent = document.getElementById("slideInfoContent");
  let slideChange = 0;

  function updateSlideInfo(slide) {
    const info = slide.info;
    slideInfo.hidden = !info;
    if (!info) return;

    const content = [];
    if (info.text) {
      const text = document.createElement("p");
      text.textContent = info.text;
      content.push(text);
    }
    if (info.bullets?.length) {
      const list = document.createElement("ul");
      for (const bullet of info.bullets) {
        const item = document.createElement("li");
        item.textContent = bullet;
        list.append(item);
      }
      content.push(list);
    }
    for (const { src, width, height, alt, fullSizeLink } of info.images ?? []) {
      const image = document.createElement("img");
      image.width = width;
      image.height = height;
      image.alt = alt;
      image.src = new URL(src, import.meta.url).href;
      if (fullSizeLink) {
        const link = document.createElement("a");
        link.href = image.src;
        link.target = "_blank";
        link.rel = "noopener";
        link.setAttribute("aria-label", fullSizeLink);
        link.append(image);
        content.push(link);
      } else {
        content.push(image);
      }
    }
    slideInfoTitle.textContent = slide.title;
    slideInfoContent.replaceChildren(...content);
    slideInfo.scrollTop = 0;
  }

  async function updateSlide(slide) {
    const id = ++slideChange;
    const isCurrent = () => id === slideChange;
    updateSlideInfo(slide);
    applySceneSettings(slide);
    const layerFailures = await applySlide(slide, layers, legendContainer, isCurrent);
    if (!isCurrent()) return;
    const messages = [...failures, ...layerFailures];
    if (slide.basemapUrl && !basemapLayers.has(slide.basemapUrl)) {
      messages.push("Сателитната подложка не се зареди.");
    }
    statusMessage.textContent = messages.join(" ");
    statusMessage.hidden = messages.length === 0;
  }

  setupPresentation(initialSlide, slide => {
    void updateSlide(slide);
    focusMap(slide);
  }, focusMap);
  const initialUpdate = updateSlide(initialSlide);
  if (initialSlide.cameraFlight) playCameraFlight(initialSlide);
  await initialUpdate;
}

start().catch((error) => {
  console.error(error);
  statusMessage.textContent = "3D картата не може да се стартира.";
});
