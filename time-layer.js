const bounds = [23.20, 42.59, 23.45, 42.81];
const products = {
  lst: { manifestUrl: new URL("./assets/time-layer/manifest.json", import.meta.url), unit: "°C", hourly: false, stops: [15, 22, 29, 36, 43, 50], colors: ["#302b87", "#3569bc", "#35b5ad", "#efdb66", "#ed813c", "#b92445"], title: "Summer surface temperature" },
  wind: { manifestUrl: new URL("./assets/time-layer/wind.json", import.meta.url), unit: "m/s", hourly: true, stops: [0, 2, 4, 6, 9, 13], colors: ["#e1f6fc", "#8dd6e9", "#39a9d4", "#3268b9", "#6744a8", "#a5266f"], title: "10 m wind speed" },
};
const utcLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const utcDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", day: "numeric" });
const timeLabel = (time, hourly) => hourly ? `${utcLabel.format(new Date(time))} UTC` : time.slice(0, 4);

export function createTimeLayer(Cesium, viewer, options = {}) {
  let manifest, initializing, panel, chart, range, timestamp, playButton, message, datasetInput, sampleText;
  let layer, incomingLayer, stopTransition, index = -1, requestId = 0, visibilityId = 0;
  let visible = false, playing = false, timer, sliderTimer, active = products.lst;
  let selectedPoint, pointSamples, sampleRequest = 0;

  async function initialize() {
    const entries = await Promise.all(Object.entries(products).map(async ([id, product]) => [id, await Cesium.Resource.fetchJson(product.manifestUrl.href)]));
    manifest = Object.fromEntries(entries.map(([id, data]) => [id, { ...products[id], ...data, identifier: id }]));
    // Keep the selector aligned with the locally bundled cache. The source
    // WRF run has a few hours without pre-rendered tiles in the lightweight
    // Node-only distribution, so those hours must not produce broken frames.
    for (const data of Object.values(manifest)) {
      const available = await Promise.all(data.times.map(async time => {
        const date = time.replaceAll(":", "-");
        try {
          const response = await fetch(new URL(`./assets/time-layer/cache/${data.revision}/${date}/1/0/1.png`, import.meta.url));
          return response.ok;
        } catch {
          return false;
        }
      }));
      data.statistics = data.statistics.filter((_, i) => available[i]);
      data.times = data.times.filter((_, i) => available[i]);
    }
    active = manifest.lst;
    panel = document.getElementById("wrfTimePanel"); chart = document.getElementById("wrfChart");
    range = document.getElementById("wrfHour"); timestamp = document.getElementById("wrfTimestamp");
    playButton = document.getElementById("wrfPlay"); message = document.getElementById("wrfMessage");
    datasetInput = document.getElementById("wrfDataset"); sampleText = document.getElementById("wrfChartSample");
    datasetInput.addEventListener("change", () => {
      active = manifest[datasetInput.value] ?? manifest.lst; setPlaying(false); pointSamples = undefined; index = -1;
      updateDatasetUi(); void display(0); if (selectedPoint) void loadPointHistory(selectedPoint);
    });
    range.addEventListener("input", () => {
      setPlaying(false); const frameIndex = Number(range.value); updateChart(frameIndex);
      clearTimeout(sliderTimer); sliderTimer = setTimeout(() => void display(frameIndex), 140);
    });
    playButton.addEventListener("click", () => setPlaying(!playing));
    window.addEventListener("pagehide", () => { clearTimeout(sliderTimer); setPlaying(false); });
    const marker = viewer.entities.add({
      show: false,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString("#ff21d4"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "Selected point",
        font: "bold 14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -26),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
      const ray = viewer.camera.getPickRay(position), surface = ray && viewer.scene.globe.pick(ray, viewer.scene);
      const point = surface ?? viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid); if (!point) return;
      const location = Cesium.Cartographic.fromCartesian(point);
      selectedPoint = { lon: Cesium.Math.toDegrees(location.longitude), lat: Cesium.Math.toDegrees(location.latitude) };
      // Keep the marker at the exact clicked Cartesian position. Raising it
      // above the terrain causes a visible horizontal offset in perspective.
      marker.position = point;
      marker.show = true; void loadPointHistory(selectedPoint);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    updateDatasetUi();
  }

  function updateDatasetUi() {
    const data = active; range.max = data.times.length - 1; range.value = Math.max(0, index);
    range.setAttribute("aria-label", data.hourly ? "Hour" : "Summer year");
    document.getElementById("wrfTitle").textContent = `Time layer · ${data.title}`;
    document.getElementById("wrfRamp").style.backgroundImage = `linear-gradient(to right, ${data.colors.join(", ")})`;
    document.getElementById("wrfMin").textContent = `≤${data.stops[0]} ${data.unit}`;
    document.getElementById("wrfMax").textContent = `≥${data.stops.at(-1)} ${data.unit}`;
    document.getElementById("wrfChartTitle").textContent = `${data.title} history`; chart.hidden = false; updateChart(Math.max(0, index));
  }

  function cancelTransition() {
    stopTransition?.(); stopTransition = undefined;
    if (incomingLayer) { viewer.imageryLayers.remove(incomingLayer); incomingLayer = undefined; }
  }

  function showOnly(nextLayer, outgoing) {
    if (!outgoing) { nextLayer.alpha = 1; layer = nextLayer; return; }
    incomingLayer = nextLayer; nextLayer.alpha = 0.001; let rendered = 0;
    const stop = viewer.scene.postRender.addEventListener(() => {
      // Do not depend on terrain completion here: optional terrain tiles can
      // fail or keep streaming forever, while the imagery frame is already
      // ready to be displayed.
      const ready = nextLayer._timeLayerPending === 0; rendered = ready ? rendered + 1 : 0;
      if (rendered < 3) { viewer.scene.requestRender(); return; }
      nextLayer.alpha = 1; viewer.imageryLayers.remove(outgoing); if (incomingLayer === nextLayer) incomingLayer = undefined;
      layer = nextLayer; stop(); if (stopTransition === stop) stopTransition = undefined; viewer.scene.requestRender();
    });
    stopTransition = stop; viewer.scene.requestRender();
  }

  async function display(frameIndex) {
    const id = ++requestId; if (!visible || id !== requestId) return false;
    const data = active, date = data.times[frameIndex].replaceAll(":", "-"), root = new URL("./assets/time-layer/", import.meta.url).href;
    const provider = new Cesium.UrlTemplateImageryProvider({ url: `${root}cache/${data.revision}/${date}/{z}/{y}/{x}.png`, tilingScheme: new Cesium.WebMercatorTilingScheme(), rectangle: Cesium.Rectangle.fromDegrees(...bounds), maximumLevel: data.maxZoom ?? 12, tileWidth: 256, tileHeight: 256, enablePickFeatures: false });
    let pending = 0; const requestImage = provider.requestImage.bind(provider);
    provider.requestImage = (...args) => { const request = requestImage(...args); if (!request) return request; pending++; return Promise.resolve(request).finally(() => { pending--; }); };
    cancelTransition(); const outgoing = layer, nextLayer = viewer.imageryLayers.addImageryProvider(provider);
    Object.defineProperty(nextLayer, "_timeLayerPending", { configurable: true, get: () => pending });
    try { await provider.requestImage(1, 0, 1); } catch (error) {
      viewer.imageryLayers.remove(nextLayer); if (visible && id === requestId) { console.error("Time-layer frame failed to load.", error); message.textContent = "The selected time-layer frame could not be loaded."; } return false;
    }
    if (!visible || id !== requestId) { viewer.imageryLayers.remove(nextLayer); return false; }
    showOnly(nextLayer, outgoing); index = frameIndex; range.value = frameIndex; timestamp.textContent = timeLabel(data.times[frameIndex], data.hourly);
    range.setAttribute("aria-valuetext", timestamp.textContent); updateChart(frameIndex); message.textContent = ""; viewer.scene.requestRender(); return true;
  }

  function updateChart(selected) {
    if (!manifest || !active?.statistics?.length) return;
    const stats = active.statistics, points = pointSamples?.map(item => item.value) ?? [];
    const values = [...stats.flatMap(item => [item.min, item.mean, item.max]), ...points].filter(Number.isFinite); if (!values.length) return;
    const low = Math.floor(Math.min(...values)), high = Math.max(low + 1, Math.ceil(Math.max(...values)));
    const x = i => 42 + 286 * i / Math.max(1, stats.length - 1), y = value => 138 - 124 * (value - low) / (high - low);
    const pathFor = name => stats.map((item, i) => { const value = name === "point" ? points[i] : item[name]; if (!Number.isFinite(value)) return ""; const previous = name === "point" ? points[i - 1] : stats[i - 1]?.[name]; return `${i && Number.isFinite(previous) ? "L" : "M"}${x(i).toFixed(2)} ${y(value).toFixed(2)}`; }).join(" ");
    document.getElementById("wrfChartMaximum").setAttribute("d", pathFor("max")); document.getElementById("wrfChartMean").setAttribute("d", pathFor("mean")); document.getElementById("wrfChartMinimum").setAttribute("d", pathFor("min")); document.getElementById("wrfChartPoint").setAttribute("d", pathFor("point"));
    document.getElementById("wrfChartMax").textContent = `${high} ${active.unit}`; document.getElementById("wrfChartMin").textContent = `${low} ${active.unit}`;
    document.getElementById("wrfChartStart").textContent = timeLabel(stats[0].time, active.hourly); document.getElementById("wrfChartEnd").textContent = timeLabel(stats.at(-1).time, active.hourly);
    const cursor = document.getElementById("wrfChartCursor"); cursor.setAttribute("x1", x(selected)); cursor.setAttribute("x2", x(selected));
    const current = stats[selected], point = points[selected]; document.getElementById("wrfChartTemperature").textContent = `Min ${format(current.min)} · Mean ${format(current.mean)} · Max ${format(current.max)}${Number.isFinite(point) ? ` · Point ${format(point)}` : ""}`;
    sampleText.textContent = selectedPoint ? `Selected point: ${selectedPoint.lat.toFixed(5)}°, ${selectedPoint.lon.toFixed(5)}°` : "Click the map to read a source pixel.";
  }
  function format(value) { return Number.isFinite(value) ? `${value.toFixed(1)} ${active.unit}` : "—"; }

  async function loadPointHistory(point) {
    const id = ++sampleRequest; sampleText.textContent = "Reading source pixel history…"; const data = active;
    const samples = await Promise.all(data.times.map(time => sampleTile(data, time, point.lon, point.lat))); if (id !== sampleRequest || !visible) return;
    pointSamples = samples.map((value, i) => ({ time: data.times[i], value })); updateChart(Math.max(0, index));
  }
  async function sampleTile(data, time, lon, lat) {
    const z = 12, n = 2 ** z, xf = (lon + 180) / 360 * n, yf = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n, x = Math.floor(xf), y = Math.floor(yf), px = Math.min(255, Math.floor((xf - x) * 256)), py = Math.min(255, Math.floor((yf - y) * 256)), date = time.replaceAll(":", "-"), root = new URL("./assets/time-layer/", import.meta.url).href;
    try { const response = await fetch(`${root}cache/${data.revision}/${date}/${z}/${y}/${x}.png`); if (!response.ok) return null; const bitmap = await createImageBitmap(await response.blob()), canvas = document.createElement("canvas"); canvas.width = canvas.height = 256; const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0); const [r, g, b, a] = context.getImageData(px, py, 1, 1).data; bitmap.close(); return a ? decodeColor(data.colors, data.stops, r, g, b) : null; } catch { return null; }
  }
  function decodeColor(colors, stops, r, g, b) {
    const rgb = colors.map(color => color.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16))); let best = { distance: Infinity, value: null };
    for (let i = 0; i < rgb.length - 1; i++) { const a = rgb[i], next = rgb[i + 1], delta = next.map((value, channel) => value - a[channel]), length = delta.reduce((sum, value) => sum + value * value, 0) || 1, t = Math.max(0, Math.min(1, ((r - a[0]) * delta[0] + (g - a[1]) * delta[1] + (b - a[2]) * delta[2]) / length)), distance = [r, g, b].reduce((sum, value, channel) => sum + (value - (a[channel] + delta[channel] * t)) ** 2, 0); if (distance < best.distance) best = { distance, value: stops[i] + t * (stops[i + 1] - stops[i]) }; }
    return best.value;
  }

  const nextIndex = offset => { const count = active.times.length; return (index + offset + count) % count; };
  function setPlaying(next) { clearTimeout(timer); if (playing && !next) requestId++; playing = next; playButton.textContent = playing ? "Pause" : "Play"; if (playing) scheduleFrame(); }
  function scheduleFrame() { timer = setTimeout(async () => { if (await display(nextIndex(1)) && playing) scheduleFrame(); }, options.frameDurationMs ?? 900); }

  return { title: "Time layer · Sofia climate data", async setVisible(nextVisible) {
    const id = ++visibilityId; visible = nextVisible;
    if (!visible) { if (!panel) return; requestId++; clearTimeout(sliderTimer); setPlaying(false); cancelTransition(); if (layer) viewer.imageryLayers.remove(layer); layer = undefined; index = -1; panel.hidden = true; chart.hidden = true; viewer.scene.requestRender(); return; }
    if (!manifest) { initializing ??= initialize().finally(() => { initializing = undefined; }); await initializing; }
    if (id !== visibilityId) return; datasetInput.value = active.identifier; active = manifest[datasetInput.value]; updateDatasetUi();
    if (!await display(Math.max(0, index)) || id !== visibilityId) throw new Error("The initial time-layer frame failed to load.");
    panel.hidden = false; chart.hidden = false;
  }};
}
