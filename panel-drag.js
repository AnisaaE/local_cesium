const arrowOffsets = new Map([
  ["ArrowLeft", [-16, 0]],
  ["ArrowRight", [16, 0]],
  ["ArrowUp", [0, -16]],
  ["ArrowDown", [0, 16]],
]);

export function enablePanelDrag(panel, handle) {
  let drag;
  let position;

  function movePanel(left, top) {
    if (panel.hidden) return;
    const { width, height } = panel.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const x = Math.max(0, Math.min(left, clientWidth - width));
    const y = Math.max(0, Math.min(top, clientHeight - height));
    if (position?.x === x && position.y === y) return;

    position = { x, y };
    panel.classList.add("panel-moved");
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  handle.addEventListener("pointerdown", event => {
    if (drag || event.button !== 0) return;
    const { left, top } = panel.getBoundingClientRect();
    drag = { id: event.pointerId, offsetX: event.clientX - left, offsetY: event.clientY - top };
    handle.setPointerCapture(drag.id);
    panel.classList.add("panel-dragging");
  });

  handle.addEventListener("pointermove", event => {
    if (event.pointerId !== drag?.id) return;
    movePanel(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  });

  handle.addEventListener("lostpointercapture", event => {
    if (event.pointerId !== drag?.id) return;
    drag = undefined;
    panel.classList.remove("panel-dragging");
  });

  handle.addEventListener("keydown", event => {
    if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const offset = arrowOffsets.get(event.key);
    if (!offset) return;
    event.preventDefault();
    const { left, top } = panel.getBoundingClientRect();
    movePanel(left + offset[0], top + offset[1]);
  });

  function keepPanelInView() {
    if (position) movePanel(position.x, position.y);
  }
  new ResizeObserver(keepPanelInView).observe(panel);
  window.addEventListener("resize", keepPanelInView);
}
