const learningMenu = document.querySelector(".learning-menu");
const learningToggle = learningMenu.querySelector("summary");
const learningLinks = learningMenu.querySelector("ul");

function placeLearningMenu() {
  learningMenu.classList.remove("opens-up");
  learningLinks.style.maxHeight = "";

  if (!learningMenu.open || window.innerWidth <= 520) {
    return;
  }

  const button = learningToggle.getBoundingClientRect();
  const spaceBelow = window.innerHeight - button.bottom - 12;
  const spaceAbove = button.top - 12;
  const opensUp = spaceBelow < learningLinks.scrollHeight
    && spaceAbove > spaceBelow;

  learningMenu.classList.toggle("opens-up", opensUp);

  const availableSpace = opensUp ? spaceAbove : spaceBelow;
  learningLinks.style.maxHeight = Math.max(0, availableSpace) + "px";
}

learningMenu.addEventListener("toggle", placeLearningMenu);
window.addEventListener("resize", placeLearningMenu);

document.addEventListener("click", function (event) {
  if (!learningMenu.contains(event.target)) {
    learningMenu.open = false;
  }
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && learningMenu.open) {
    learningMenu.open = false;
    learningToggle.focus();
  }
});
