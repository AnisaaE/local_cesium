import { presentationSteps } from "./slides.js";

export function setupPresentation(slide, focusMap) {
  const panel = document.getElementById("presentation");
  const list = document.getElementById("presentationSteps");
  const selected = presentationSteps.indexOf(slide);
  if (selected === -1) return;

  function showStep(step) {
    const url = new URL(window.location.href);
    url.searchParams.set("slide", step.id);
    window.location.assign(url);
  }

  const buttons = presentationSteps.map((step, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const number = document.createElement("span");
    number.textContent = index + 1;
    number.setAttribute("aria-hidden", "true");
    button.type = "button";
    button.append(number, document.createTextNode(step.title));

    if (step === slide) {
      button.setAttribute("aria-current", "step");
      button.addEventListener("click", focusMap);
    } else if (step.layers) {
      button.addEventListener("click", () => showStep(step));
    } else {
      button.disabled = true;
      button.title = "Слоевете за тази стъпка предстоят";
    }
    item.append(button);
    return item;
  });
  list.replaceChildren(...buttons);

  const collapse = document.getElementById("presentationCollapse");
  collapse.addEventListener("click", () => {
    list.hidden = !list.hidden;
    collapse.setAttribute("aria-expanded", String(!list.hidden));
    collapse.setAttribute("aria-label", list.hidden ? "Разгъни стъпките" : "Свий стъпките");
  });

  for (const [control, step] of [
    ["presentationPrevious", presentationSteps[selected - 1]],
    ["presentationNext", presentationSteps[selected + 1]],
  ]) {
    if (!step?.layers) continue;
    const button = document.getElementById(control);
    button.disabled = false;
    button.addEventListener("click", () => showStep(step));
  }
  const focusButton = document.getElementById("presentationFocus");
  if (slide.cameraFlight) {
    focusButton.textContent = "Replay";
    focusButton.title = "Пусни полета отначало";
  }
  focusButton.addEventListener("click", focusMap);
  panel.hidden = false;
}
