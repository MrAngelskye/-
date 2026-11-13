"use strict";

const speakingScenarios = [
  {
    id: "my-work-setup",
    title: "My work setup",
    level: "A1",
    seconds: 30,
    prompt: "A new teammate asks what you use for work. Name two things and say what you do with them.",
    steps: ["Назови два инструмента.", "Скажи, для чего нужен каждый.", "Закончи простой фразой о своей работе."],
    phrases: "I use … · I write … · I talk to …",
    checklist: ["Я назвал два инструмента.", "Я объяснил, как использую каждый.", "Я сказал, чем занимаюсь."],
    example: "I use a laptop and a headset. I write code on my laptop. I talk to my team with my headset. I work on a small website.",
    drill: {text: "I write code on my laptop.", tip: "В write буква w не звучит. В laptop ударение на первом слоге."}
  },
  {
    id: "report-a-bug",
    title: "Report a bug",
    level: "A2",
    seconds: 45,
    prompt: "You click Save on the profile page. The page shows a success message, but your new name disappears when you reload. Tell a teammate about the issue.",
    steps: ["Назови страницу и действие.", "Опиши ожидаемый и фактический результат.", "Скажи, как повторить ошибку."],
    phrases: "I expected … · After I reload … · You can reproduce it by …",
    checklist: ["Я назвал страницу и действие.", "Я объяснил, что ожидал и что произошло.", "Я назвал шаги, чтобы повторить ошибку."],
    example: "I found a bug on the profile page. Change your name and click Save. You see a success message. I expected the new name to stay, but the old name comes back when I reload the page.",
    drill: {text: "I found a bug on the profile page.", tip: "В bug закончи слово звонким /ɡ/. В profile ударение на первом слоге."}
  },
  {
    id: "choose-a-fix",
    title: "Choose a fix",
    level: "B1",
    seconds: 60,
    prompt: "A dashboard takes eight seconds to open because it loads a large chart. You can load the chart only when the user opens it, or make it smaller but show less detail. Recommend one option to your team.",
    steps: ["Коротко опиши проблему.", "Сравни два варианта.", "Предложи решение и способ проверить его."],
    phrases: "One option is … · The trade-off is … · I would measure …",
    checklist: ["Я сформулировал проблему.", "Я сравнил преимущества и ограничения двух вариантов.", "Я предложил решение и объяснил, как его проверить."],
    example: "The dashboard is slow because it loads the full chart immediately. A smaller chart could load faster, but users would lose detail. I would load the full chart when they open it. We can measure the opening time before and after the change, and check how long users wait for the chart.",
    drill: {text: "The chart should load faster.", tip: "В chart начни с /tʃ/. В should буква l не звучит."}
  }
];

// Страница и сервер берут условия заданий из одного файла.
if (typeof module !== "undefined" && module.exports) {
  module.exports = speakingScenarios;
}
