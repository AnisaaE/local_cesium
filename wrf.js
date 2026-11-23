const defaultManifestUrl = new URL("./assets/wrf/T2_C/manifest.json", import.meta.url);

export function createWrfLayer(Cesium, viewer, options = {}) {
  const manifestUrl = new URL(options.manifest ?? defaultManifestUrl, import.meta.url);
  const images = new Map();
  let manifest;
  let tilingScheme;
  let panel;
  let range;
  let timestamp;
  let playButton;
  let message;
  let layer;
  let previousLayer;
  let index = -1;
  let requestId = 0;
  let visible = false;
  let playing = false;
  let timer;

  async function initialize() {
    const data = await Cesium.Resource.fetchJson(manifestUrl.href);
    if (data.grid.crs !== "EPSG:3857" || !data.frames.length) {
      throw new Error("Missing Web Mercator WRF frames.");
    }
    const [west, south, east, north] = data.grid.bounds;
    tilingScheme = new Cesium.WebMercatorTilingScheme({
      rectangleSouthwestInMeters: new Cesium.Cartesian2(west, south),
      rectangleNortheastInMeters: new Cesium.Cartesian2(east, north),
    });

    panel = document.getElementById("wrfTimePanel");
    range = document.getElementById("wrfHour");
    timestamp = document.getElementById("wrfTimestamp");
    playButton = document.getElementById("wrfPlay");
    message = document.getElementById("wrfMessage");
    range.max = data.frames.length - 1;
    range.addEventListener("input", () => {
      setPlaying(false);
      void display(Number(range.value));
    });
    playButton.addEventListener("click", () => setPlaying(!playing));
    window.addEventListener("pagehide", () => setPlaying(false));

    const ramp = document.getElementById("wrfRamp");
    const colors = data.style.colors.join(", ");
    ramp.style.backgroundImage = `linear-gradient(to right, ${colors})`;
    if (data.style.interpolation === "lab" && CSS.supports("background-image", `linear-gradient(to right in lab, ${colors})`)) {
      ramp.style.backgroundImage = `linear-gradient(to right in lab, ${colors})`;
    }
    const [min, max] = data.style.range;
    document.getElementById("wrfMin").textContent = `${min.toFixed(2)} °C`;
    document.getElementById("wrfMax").textContent = `${max.toFixed(2)} °C`;
    manifest = data;
  }

  function loadImage(frameIndex) {
    const cached = images.get(frameIndex);
    images.delete(frameIndex);
    if (cached) {
      images.set(frameIndex, cached);
      return cached;
    }
    const url = new URL(manifest.frames[frameIndex].url, manifestUrl).href;
    const image = new Image();
    image.src = url;
    const decoded = image.decode().then(() => ({ image, url })).catch(error => {
      if (images.get(frameIndex) === decoded) images.delete(frameIndex);
      throw error;
    });
    images.set(frameIndex, decoded);
    if (images.size > 5) images.delete(images.keys().next().value);
    return decoded;
  }

  function retirePreviousAfterRender(outgoing) {
    const stop = viewer.scene.postRender.addEventListener(() => {
      stop();
      const finish = viewer.scene.postRender.addEventListener(() => {
        finish();
        if (previousLayer !== outgoing) return;
        viewer.imageryLayers.remove(outgoing);
        previousLayer = undefined;
        viewer.scene.requestRender();
      });
      viewer.scene.requestRender();
    });
  }

  async function display(frameIndex) {
    const id = ++requestId;
    message.textContent = "";

    try {
      const { image, url } = await loadImage(frameIndex);
      if (!visible || id !== requestId) return false;

      const provider = new Cesium.UrlTemplateImageryProvider({
        url, tilingScheme,
        maximumLevel: 0,
        tileWidth: manifest.grid.width, tileHeight: manifest.grid.height,
        enablePickFeatures: false,
      });
      provider.requestImage = () => Promise.resolve(image);

      if (previousLayer) viewer.imageryLayers.remove(previousLayer);
      previousLayer = layer;
      layer = viewer.imageryLayers.addImageryProvider(provider);
      if (previousLayer) retirePreviousAfterRender(previousLayer);
      index = frameIndex;
      range.value = frameIndex;
      const time = manifest.frames[frameIndex].timestamp.replace("T", " ").slice(0, 16) + " UTC";
      timestamp.textContent = time;
      range.setAttribute("aria-valuetext", time);
      viewer.scene.requestRender();

      for (const offset of [1, -1]) void loadImage(nextIndex(offset)).catch(() => {});
      return true;
    } catch (error) {
      if (!visible || id !== requestId) return false;
      console.error("WRF frame failed to load.", error);
      if (index >= 0) range.value = index;
      message.textContent = "Температурният кадър не се зареди.";
      setPlaying(false);
      return false;
    }
  }

  function nextIndex(offset) {
    const count = manifest.frames.length;
    return (index + offset + count) % count;
  }

  function setPlaying(next) {
    clearTimeout(timer);
    if (playing && !next) requestId++;
    playing = next;
    playButton.textContent = playing ? "Pause" : "Play";
    if (playing) scheduleFrame();
  }

  function scheduleFrame() {
    timer = setTimeout(async () => {
      if (await display(nextIndex(1)) && playing) scheduleFrame();
    }, options.frameDurationMs ?? 500);
  }

  return {
    title: "WRF 2 m air temperature",
    async setVisible(nextVisible) {
      visible = nextVisible;
      if (!visible) {
        if (!panel) return;
        requestId++;
        setPlaying(false);
        if (previousLayer) viewer.imageryLayers.remove(previousLayer);
        if (layer) viewer.imageryLayers.remove(layer);
        previousLayer = layer = undefined;
        panel.hidden = true;
        viewer.scene.requestRender();
        return;
      }
      if (!manifest) await initialize();
      if (visible && await display(Math.max(0, index))) panel.hidden = false;
      else if (visible) throw new Error("The initial WRF frame failed to load.");
    },
  };
}
