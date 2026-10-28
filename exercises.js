const exercises = document.querySelectorAll(".exercise-row");

exercises.forEach(function(exercise) {
    const input = exercise.querySelector(".answer");
    const result = exercise.querySelector(".result");

    input.addEventListener("input", function() {
        let userAnswer = input.value.trim().toLowerCase();
        let correctAnswer = input.dataset.answer;

        if (userAnswer === correctAnswer){
            result.textContent = "✓ Верно!";
        } else {
            result.textContent = "";
        }
    });
});