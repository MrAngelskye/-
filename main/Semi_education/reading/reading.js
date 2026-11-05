(() => {
  "use strict";

  const STORAGE_KEY = "english.reading.v1";
  const byId = id => document.getElementById(id);
  const catalog = byId("catalog");
  const lessonPanel = byId("reading-lesson");
  const lessonList = byId("lesson-list");
  const resumeLink = byId("resume-reading");
  const passageTitle = byId("passage-title");
  const passage = byId("passage-text");
  const wordNote = byId("word-note");
  const noteText = byId("note-translation");
  const saveWordLink = byId("save-reading-word");
  const retryTranslation = byId("retry-translation");
  const {cleanText, maxEntryLength, translate} = englishTranslation;
  const translationCache = new Map();
  const form = byId("reading-quiz");
  const questions = byId("reading-questions");
  const quizMessage = byId("quiz-message");
  const checkButton = byId("check-reading");
  const retryButton = byId("retry-reading");
  const storageNote = byId("reading-storage-note");

  const progress = readProgress();
  let lesson;
  let attempt;
  let activeTranslation;
  let translationController;
  let selectionPointer = null;
  let selectionTimer;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function readProgress() {
    const progress = {lastLesson: null, lessons: {}};
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      progress.lastLesson = saved?.lastLesson ?? null;
      for (const item of readingLessons) {
        const entry = saved?.lessons?.[item.id];
        if (!entry) continue;
        const answers = item.questions.map((question, index) => {
          const choice = entry.answers?.[index];
          return Number.isInteger(choice) && choice >= 0 && choice < question.choices.length
            ? choice : null;
        });
        const checked = entry.checked === true && answers.every(answer => answer !== null);
        const lastScore = checked ? scoreAnswers(item, answers) : entry.lastScore;
        progress.lessons[item.id] = {
          answers,
          checked,
          lastScore: Number.isInteger(lastScore) && lastScore >= 0 && lastScore <= answers.length
            ? lastScore : null
        };
      }
    } catch {
      storageNote.hidden = false;
    }
    return progress;
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      storageNote.hidden = true;
    } catch {
      storageNote.hidden = false;
    }
  }

  function scoreAnswers(item, answers) {
    return item.questions.filter((question, index) => question.answer === answers[index]).length;
  }

  function renderCatalog() {
    lessonList.replaceChildren();
    const recent = readingLessons.find(item => item.id === progress.lastLesson);
    resumeLink.hidden = !recent;
    if (recent) {
      resumeLink.href = "#" + recent.id;
      resumeLink.textContent = progress.lessons[recent.id]?.checked ? "Вернуться к тексту" : "Продолжить чтение";
    }

    readingLessons.forEach((item, index) => {
      const entry = progress.lessons[item.id];
      const link = element("a", undefined, "lesson-link");
      link.href = "#" + item.id;
      const number = element("span", String(index + 1).padStart(2, "0"), "lesson-number");
      number.setAttribute("aria-hidden", "true");
      const details = element("div", undefined, "lesson-details");
      const title = element("h3", item.title);
      title.lang = "en";
      details.append(
        element("p", item.level + " · " + item.topic + " · " + item.minutes + " мин", "lesson-meta"),
        title,
        element("p", item.description)
      );
      let status = "Открыть текст";
      if (entry) {
        status = entry.lastScore === null ? "Начато" : "Пройдено · " + entry.lastScore + "/" + item.questions.length;
      }
      link.append(number, details, element("span", status + " →", "lesson-status"));
      const row = element("li");
      row.append(link);
      lessonList.append(row);
    });
  }

  function closeWordNote() {
    activeTranslation?.word?.setAttribute("aria-expanded", "false");
    activeTranslation = null;
    translationController?.abort();
    translationController = null;
    wordNote.hidden = true;
  }

  function dismissWordNote() {
    const word = activeTranslation?.word;
    clearTimeout(selectionTimer);
    if (selectedPassage()) window.getSelection().removeAllRanges();
    closeWordNote();
    word?.focus();
  }

  function showTranslatedText(source, translation) {
    noteText.textContent = translation;
    if (translation.length > maxEntryLength) {
      noteText.textContent += " Для сохранения выдели более короткий отрывок.";
      return;
    }
    const query = new URLSearchParams({"reading-en": source, "reading-ru": translation});
    saveWordLink.href = "../vocabulary/vocabulary.html#" + query;
    saveWordLink.hidden = false;
  }

  async function showTranslation(request) {
    closeWordNote();
    activeTranslation = request;
    request.word?.setAttribute("aria-expanded", "true");
    const {text, paragraph, word} = request;
    byId("note-word").textContent = text.length > 90 ? text.slice(0, 89) + "…" : text;
    saveWordLink.hidden = true;
    retryTranslation.hidden = true;
    paragraph.after(wordNote);
    wordNote.hidden = false;

    if (text.length > maxEntryLength) {
      noteText.textContent = "Выдели отрывок до " + maxEntryLength + " символов.";
      return;
    }
    const key = word ? text.toLowerCase() : text;
    const known = (word && Object.hasOwn(lesson.words, key) ? lesson.words[key] : null)
      || translationCache.get(key);
    if (known) {
      showTranslatedText(text, known);
      return;
    }

    const controller = new AbortController();
    translationController = controller;
    noteText.textContent = "Перевожу…";
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await translate(text, "en", "ru", controller.signal);
      if (activeTranslation !== request || controller.signal.aborted) return;
      translationCache.set(key, result);
      showTranslatedText(text, result);
    } catch (error) {
      if (activeTranslation !== request) return;
      noteText.textContent = error.message === "quota"
        ? "Дневной лимит автоперевода закончился."
        : "Не удалось получить перевод. Попробуй ещё раз.";
      retryTranslation.hidden = error.message === "quota";
    } finally {
      clearTimeout(timeout);
      if (translationController === controller) translationController = null;
    }
  }

  function activateWord(word) {
    const previous = word.closest("p").querySelector('.word-trigger[tabindex="0"]');
    if (previous) previous.tabIndex = -1;
    word.tabIndex = 0;
    if (activeTranslation?.word === word) {
      closeWordNote();
      return;
    }
    showTranslation({text: word.textContent, paragraph: word.closest("p"), word});
  }

  function selectedPassage() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!passage.contains(range.startContainer) || !passage.contains(range.endContainer)) return null;

    // Берём только строки урока, даже если выделение пересекает открытую подсказку.
    const parts = [];
    let lastParagraph;
    for (const paragraph of passage.querySelectorAll(".passage-paragraph")) {
      if (!range.intersectsNode(paragraph)) continue;
      const part = range.cloneRange();
      if (!paragraph.contains(range.startContainer)) part.setStart(paragraph, 0);
      if (!paragraph.contains(range.endContainer)) part.setEnd(paragraph, paragraph.childNodes.length);
      const text = cleanText(part.toString());
      if (text) {
        parts.push(text);
        lastParagraph = paragraph;
      }
    }
    const text = parts.join(" ");
    if (!/[a-z]/i.test(text)) return null;
    const focus = selection.focusNode;
    const focusElement = focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement;
    return {text, paragraph: focusElement?.closest(".passage-paragraph") || lastParagraph};
  }

  function queueSelectionTranslation() {
    clearTimeout(selectionTimer);
    if (!lesson || selectionPointer !== null) return;
    selectionTimer = setTimeout(() => {
      const request = selectedPassage();
      if (!request || (activeTranslation?.text === request.text
          && activeTranslation.paragraph === request.paragraph)) return;
      showTranslation(request);
    }, 350);
  }

  function renderPassage() {
    closeWordNote();
    clearTimeout(selectionTimer);
    lessonPanel.querySelector(".passage").append(wordNote);
    passage.replaceChildren();
    byId("passage-meta").textContent = lesson.level + " · " + lesson.topic + " · " + lesson.minutes + " мин";
    passageTitle.textContent = lesson.title;
    lesson.paragraphs.forEach((parts, index) => {
      const paragraph = element("p", undefined, "passage-paragraph");
      paragraph.id = "passage-" + index;
      paragraph.tabIndex = -1;
      const text = parts.map(part => typeof part === "string" ? part : part.text || part.word).join("");
      let offset = 0;
      for (const match of text.matchAll(/[a-z]+(?:['’-][a-z]+)*/gi)) {
        paragraph.append(text.slice(offset, match.index));
        const word = element("span", match[0], "word-trigger");
        if (Object.hasOwn(lesson.words, match[0].toLowerCase())) word.classList.add("word-trigger--known");
        word.tabIndex = offset === 0 ? 0 : -1;
        word.setAttribute("role", "button");
        word.setAttribute("aria-expanded", "false");
        word.setAttribute("aria-controls", "word-note");
        paragraph.append(word);
        offset = match.index + match[0].length;
      }
      paragraph.append(text.slice(offset));
      passage.append(paragraph);
    });
  }

  function showEvidence(index) {
    passage.querySelector(".evidence-highlight")?.classList.remove("evidence-highlight");
    const paragraph = byId("passage-" + index);
    paragraph.classList.add("evidence-highlight");
    paragraph.focus();
  }

  function renderQuiz() {
    questions.replaceChildren();
    lesson.questions.forEach((question, index) => {
      const group = element("fieldset", undefined, "question");
      const legend = element("legend", (index + 1) + ". " + question.prompt);
      legend.lang = "en";
      group.append(legend);
      question.choices.forEach((choice, choiceIndex) => {
        const label = element("label", undefined, "answer");
        const input = element("input");
        input.type = "radio";
        input.name = "question-" + index;
        input.value = choiceIndex;
        input.dataset.question = index;
        input.checked = attempt.answers[index] === choiceIndex;
        input.disabled = attempt.checked;
        const text = element("span", choice);
        text.lang = "en";
        label.append(input, text);
        if (attempt.checked && choiceIndex === question.answer) label.dataset.result = "correct";
        if (attempt.checked && input.checked && choiceIndex !== question.answer) label.dataset.result = "incorrect";
        group.append(label);
      });

      if (attempt.checked) {
        const correct = attempt.answers[index] === question.answer;
        const feedback = element("p", (correct ? "Верно. " : "Неверно. ") + question.explanation, "question-feedback");
        const evidence = element("button", "Показать абзац " + (question.paragraph + 1), "evidence-button");
        evidence.type = "button";
        evidence.addEventListener("click", () => showEvidence(question.paragraph));
        group.append(feedback, evidence);
      }
      questions.append(group);
    });

    checkButton.hidden = attempt.checked;
    retryButton.hidden = !attempt.checked;
    quizMessage.textContent = attempt.checked
      ? "Верных ответов — " + attempt.lastScore + " из " + lesson.questions.length + "."
      : "";
  }

  function showView(focus = false) {
    const selected = readingLessons.find(item => "#" + item.id === location.hash);
    lesson = selected;
    catalog.hidden = Boolean(lesson);
    lessonPanel.hidden = !lesson;
    if (!lesson) {
      closeWordNote();
      clearTimeout(selectionTimer);
      renderCatalog();
      if (focus) byId("catalog-title").focus();
      return;
    }
    attempt = progress.lessons[lesson.id] ??= {
      answers: lesson.questions.map(() => null),
      checked: false,
      lastScore: null
    };
    progress.lastLesson = lesson.id;
    saveProgress();
    renderPassage();
    renderQuiz();
    if (focus) passageTitle.focus();
  }

  passage.addEventListener("click", event => {
    const word = event.target.closest(".word-trigger");
    if (word && window.getSelection()?.isCollapsed !== false) activateWord(word);
  });
  passage.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || !event.target.closest(".passage-paragraph")) return;
    selectionPointer = event.pointerId;
    clearTimeout(selectionTimer);
  });
  function finishSelection(event) {
    if (event.pointerId !== selectionPointer) return;
    selectionPointer = null;
    queueSelectionTranslation();
  }
  document.addEventListener("pointerup", finishSelection);
  document.addEventListener("pointercancel", finishSelection);
  document.addEventListener("selectionchange", queueSelectionTranslation);
  window.addEventListener("blur", () => { selectionPointer = null; });
  passage.addEventListener("keydown", event => {
    const word = event.target.closest(".word-trigger");
    if (!word || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateWord(word);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const next = event.key === "ArrowLeft" ? word.previousElementSibling : word.nextElementSibling;
      if (!next) return;
      event.preventDefault();
      word.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  });
  lessonPanel.addEventListener("keydown", event => {
    if (event.key === "Escape" && activeTranslation) dismissWordNote();
  });
  byId("close-word-note").addEventListener("click", dismissWordNote);
  retryTranslation.addEventListener("click", () => showTranslation({...activeTranslation}));
  form.addEventListener("change", event => {
    const input = event.target;
    if (!input.matches('input[type="radio"]') || attempt.checked) return;
    attempt.answers[Number(input.dataset.question)] = Number(input.value);
    quizMessage.textContent = "";
    saveProgress();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (attempt.checked) return;
    const missing = attempt.answers.indexOf(null);
    if (missing !== -1) {
      quizMessage.textContent = "Выбери ответ на вопрос " + (missing + 1) + ".";
      form.querySelector('[name="question-' + missing + '"]').focus();
      return;
    }
    attempt.lastScore = scoreAnswers(lesson, attempt.answers);
    attempt.checked = true;
    saveProgress();
    renderQuiz();
    retryButton.focus();
  });
  retryButton.addEventListener("click", () => {
    attempt.answers.fill(null);
    attempt.checked = false;
    passage.querySelector(".evidence-highlight")?.classList.remove("evidence-highlight");
    saveProgress();
    renderQuiz();
    form.querySelector("input").focus();
  });
  window.addEventListener("hashchange", () => showView(true));
  showView();
})();
