const exerciseSections = document.querySelectorAll("[data-exercise]");

function normalizeAnswer(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[‐‑–—]/g, "-")
        .replace(/\s*-\s*/g, "-")
        .replace(/[.,!?;:]/g, "")
        .replace(/\s+/g, " ");
}

exerciseSections.forEach(function(section) {
    const inputs = section.querySelectorAll(".answer");
    const score = section.querySelector("[data-score]");

    function updateScore() {
        const correctCount = Array.from(inputs).filter(function(input) {
            return input.classList.contains("is-correct");
        }).length;

        score.textContent = `${correctCount} из ${inputs.length}`;
    }

    inputs.forEach(function(input) {
        const result = input.parentElement.querySelector(".result");
        const acceptedAnswers = input.dataset.answers
            .split("|")
            .map(normalizeAnswer);

        input.addEventListener("input", function() {
            const answer = normalizeAnswer(input.value);
            const isCorrect = answer !== "" && acceptedAnswers.includes(answer);

            input.classList.toggle("is-correct", isCorrect);
            result.textContent = isCorrect ? "✓" : "";
            result.setAttribute("aria-label", isCorrect ? "Correct" : "");

            updateScore();
        });
    });

    updateScore();
});
