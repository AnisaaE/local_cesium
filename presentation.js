import { presentationSteps } from "./slides.js";

export function setupPresentation(slide, onSlideChange, focusMap) {
  const panel = document.getElementById("presentation");
  const list = document.getElementById("presentationSteps");
  if (!presentationSteps.includes(slide)) return;
  let selected = slide;

  function showStep(step) {
    if (!step?.layers) return;
    if (step === selected) {
      focusMap(step);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("slide", step.id);
    window.history.pushState(null, "", url);
    selectStep(step);
  }

  function selectStep(step) {
    if (step === selected) return;
    selected = step;
    updateControls();
    onSlideChange(step);
  }

  const buttons = presentationSteps.map((step, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const number = document.createElement("span");
    number.textContent = index + 1;
    number.setAttribute("aria-hidden", "true");
    button.type = "button";
    button.append(number, document.createTextNode(step.title));

    if (step.layers) {
      button.addEventListener("click", () => showStep(step));
    } else {
      button.disabled = true;
      button.title = "Слоевете за тази стъпка предстоят";
    }
    item.append(button);
    return { item, button };
  });
  list.replaceChildren(...buttons.map(({ item }) => item));

  const collapse = document.getElementById("presentationCollapse");
  collapse.addEventListener("click", () => {
    list.hidden = !list.hidden;
    collapse.setAttribute("aria-expanded", String(!list.hidden));
    collapse.setAttribute("aria-label", list.hidden ? "Разгъни стъпките" : "Свий стъпките");
  });

  const previous = document.getElementById("presentationPrevious");
  const next = document.getElementById("presentationNext");
  const focusButton = document.getElementById("presentationFocus");
  const focusTitle = focusButton.title;

  function updateControls() {
    const index = presentationSteps.indexOf(selected);
    buttons.forEach(({ button }, position) => {
      if (position === index) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    previous.disabled = !presentationSteps[index - 1]?.layers;
    next.disabled = !presentationSteps[index + 1]?.layers;
    focusButton.textContent = selected.cameraFlight ? "Replay" : "Focus";
    focusButton.title = selected.cameraFlight ? "Пусни полета отначало" : focusTitle;
  }

  previous.addEventListener("click", () => showStep(presentationSteps[presentationSteps.indexOf(selected) - 1]));
  next.addEventListener("click", () => showStep(presentationSteps[presentationSteps.indexOf(selected) + 1]));
  focusButton.addEventListener("click", () => focusMap(selected));
  window.addEventListener("popstate", () => {
    const id = new URL(window.location.href).searchParams.get("slide");
    selectStep(presentationSteps.find(step => step.id === id && step.layers) ?? presentationSteps[0]);
  });
  updateControls();
  panel.hidden = false;
}
