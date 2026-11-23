export function showCameraDebug(Cesium, viewer) {
  const { camera, scene } = viewer;
  const canvas = scene.canvas;
  const panel = document.createElement("pre");
  panel.id = "cameraDebug";
  panel.setAttribute("aria-label", "Тестови координати на камерата и курсора");
  document.body.append(panel);

  const cursor = new Cesium.Cartesian2();
  const ray = new Cesium.Ray();
  const intersection = new Cesium.Cartesian3();
  const cartographic = new Cesium.Cartographic();
  let onCanvas = false;
  let frame;

  const degrees = (angle, precision) => Cesium.Math.toDegrees(angle).toFixed(precision);
  const position = ({ longitude, latitude, height }) =>
    `Дълж. ${degrees(longitude, 7)}° · Шир. ${degrees(latitude, 7)}° · h ${height.toFixed(2)} m`;

  function update() {
    frame = undefined;
    const pickRay = onCanvas ? camera.getPickRay(cursor, ray) : undefined;
    const ground = pickRay ? scene.globe.pick(pickRay, scene, intersection) : undefined;
    const groundPosition = ground ? scene.globe.ellipsoid.cartesianToCartographic(ground, cartographic) : undefined;
    panel.textContent = [
      "Камера · WGS84",
      position(camera.positionCartographic),
      `Heading ${degrees(camera.heading, 3)}° · Pitch ${degrees(camera.pitch, 3)}° · Roll ${degrees(camera.roll, 3)}°`,
      "Терен под курсора · WGS84",
      groundPosition ? position(groundPosition) : "—",
    ].join("\n");
  }

  function scheduleUpdate() {
    if (frame === undefined) frame = requestAnimationFrame(update);
  }

  canvas.addEventListener("pointermove", event => {
    const bounds = canvas.getBoundingClientRect();
    cursor.x = event.clientX - bounds.left;
    cursor.y = event.clientY - bounds.top;
    onCanvas = true;
    scheduleUpdate();
  });
  canvas.addEventListener("pointerleave", () => {
    onCanvas = false;
    scheduleUpdate();
  });
  scene.postRender.addEventListener(scheduleUpdate);
  scheduleUpdate();
}
