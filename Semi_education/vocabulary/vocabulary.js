(() => {
  "use strict";

  const STORAGE_KEY = "english.vocabulary.v1";
  const MAX_LENGTH = 160;
  const TRANSLATION_DELAY = 650;

  const form = document.getElementById("word-form");
  const sourceInput = document.getElementById("source-word");
  const translationInput = document.getElementById("translation");
  const direction = document.getElementById("direction");
  const languagePair = document.getElementById("language-pair");
  const translationStatus = document.getElementById("translation-status");
  const translateButton = document.getElementById("translate-again");
  const saveButton = document.getElementById("save-word");
  const cancelButton = document.getElementById("cancel-edit");
  const editor = document.querySelector(".editor");
  const editorTitle = document.getElementById("editor-title");
  const list = document.getElementById("word-list");
  const template = document.getElementById("word-template");
  const searchInput = document.getElementById("word-search");
  const count = document.getElementById("word-count");
  const emptyState = document.getElementById("empty-state");
  const noResults = document.getElementById("no-results");
  const storageWarning = document.getElementById("storage-warning");
  const listMessage = document.getElementById("list-message");
  const listStatus = document.getElementById("list-status");
  const undoButton = document.getElementById("undo-delete");
  const sortSelect = document.getElementById("word-sort");
  const clearSearchButton = document.getElementById("clear-search");
  const searchResults = document.getElementById("search-results");
  const practiceButton = document.getElementById("practice-toggle");
  const practiceHint = document.getElementById("practice-hint");
  const alphabet = new Intl.Collator("en", {sensitivity: "base", numeric: true});

  let storageReadable = true;
  let words = readWords();
  let editingId = null;
  let deletedWord = null;
  let translationTimer;
  let translationController;
  let translationVersion = 0;
  let translating = false;
  let hideTranslations = false;
  const revealedWords = new Set();
  const translationCache = new Map();

  function cleanText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return cleanText(value).normalize("NFKC").toLocaleLowerCase();
  }

  function showTranslationStatus(message, kind = "") {
    translationStatus.textContent = message;
    translationStatus.dataset.kind = kind;
  }

  function showStorageWarning(message) {
    storageWarning.textContent = message;
    storageWarning.hidden = false;
  }

  function showListMessage(message, canUndo = false) {
    listMessage.hidden = false;
    listStatus.textContent = message;
    undoButton.hidden = !canUndo;
  }

  function validWord(word) {
    return word && typeof word.id === "string"
      && word.id.length > 0 && word.id.length <= 100
      && typeof word.english === "string"
      && typeof word.russian === "string"
      && cleanText(word.english).length > 0
      && cleanText(word.russian).length > 0
      && word.english.length <= MAX_LENGTH
      && word.russian.length <= MAX_LENGTH;
  }

  function readWords() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || !parsed.every(validWord)
          || new Set(parsed.map(word => word.id)).size !== parsed.length) {
        throw new Error("Invalid dictionary");
      }
      return parsed;
    } catch {
      storageReadable = false;
      showStorageWarning(
        "Не удалось прочитать словарь. Сохранённые данные не изменены. " +
        "Проверь, разрешено ли браузеру хранить данные сайта."
      );
      return [];
    }
  }

  function writeWords(nextWords) {
    if (!storageReadable) return false;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextWords));
      words = nextWords;
      storageWarning.hidden = true;
      return true;
    } catch {
      showStorageWarning(
        "Не удалось сохранить изменения в браузере. " +
        "Старые слова и введённый текст остались на месте."
      );
      return false;
    }
  }

  function sourceLanguage() {
    const text = cleanText(sourceInput.value);
    if (!/[a-zа-яё]/i.test(text)) return null;
    if (direction.value !== "auto") return direction.value;
    return /[а-яё]/i.test(text) ? "ru" : "en";
  }

  function updateDirection() {
    const language = sourceLanguage() || (direction.value === "ru" ? "ru" : "en");
    languagePair.textContent = language === "ru" ? "RU → EN" : "EN → RU";
    sourceInput.lang = language;
    translationInput.lang = language === "ru" ? "en" : "ru";
  }

  function updateButtons() {
    const source = cleanText(sourceInput.value);
    const translation = cleanText(translationInput.value);
    translateButton.disabled = !source || translating || !sourceLanguage();
    saveButton.disabled = !storageReadable || translating
      || !source || !translation
      || source.length > MAX_LENGTH || translation.length > MAX_LENGTH;
    editor.setAttribute("aria-busy", String(translating));
  }

  function cancelTranslation() {
    clearTimeout(translationTimer);
    translationVersion += 1;
    if (translationController) translationController.abort();
    translationController = null;
    translating = false;
  }

  function scheduleTranslation() {
    cancelTranslation();
    translationInput.value = "";
    updateDirection();
    updateButtons();

    if (!cleanText(sourceInput.value)) {
      showTranslationStatus("Можно сразу ввести свой перевод.");
      return;
    }

    if (!sourceLanguage()) {
      showTranslationStatus("Введи слово на русском или английском.", "error");
      return;
    }

    showTranslationStatus("Подбираю перевод…");
    translationTimer = setTimeout(translateWord, TRANSLATION_DELAY);
  }

  function decodeTranslation(value) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return cleanText(decoder.value);
  }

  function matchesLanguage(text, targetLanguage) {
    return targetLanguage === "en"
      ? /[a-z]/i.test(text) && !/[а-яё]/i.test(text)
      : /[а-яё]/i.test(text);
  }

  function chooseTranslation(data, text, targetLanguage) {
    const primary = typeof data.responseData?.translatedText === "string"
      ? decodeTranslation(data.responseData.translatedText) : "";

    if (matchesLanguage(primary, targetLanguage)) return primary;

    const alternatives = Array.isArray(data.matches)
      ? data.matches
        .filter(match => typeof match.translation === "string"
          && Number(match.match) >= 0.7)
        .map(match => decodeTranslation(match.translation))
        .filter(value => matchesLanguage(value, targetLanguage))
      : [];

    if (!/\s/.test(text)) {
      const singleWord = alternatives.find(value => !/\s/.test(value));
      if (singleWord) return singleWord;
    }

    return alternatives[0] || "";
  }

  function knownTranslation(text, language) {
    const key = normalize(text);
    const saved = words.find(word =>
      normalize(language === "en" ? word.english : word.russian) === key
    );
    if (saved) return language === "en" ? saved.russian : saved.english;
    return translationCache.get(language + ":" + key);
  }

  async function translateWord() {
    cancelTranslation();
    const text = cleanText(sourceInput.value);
    const language = sourceLanguage();
    if (!text || !language) return;

    const existing = knownTranslation(text, language);
    if (existing) {
      translationInput.value = existing;
      showTranslationStatus("Нашёл сохранённый перевод. Его можно исправить.");
      updateButtons();
      return;
    }

    if (new TextEncoder().encode(text).length > 500) {
      showTranslationStatus("Сократи фразу или введи перевод вручную.", "error");
      updateButtons();
      return;
    }

    const version = translationVersion;
    const controller = new AbortController();
    translationController = controller;
    translating = true;
    updateButtons();
    showTranslationStatus("Ищу перевод…");

    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const targetLanguage = language === "en" ? "ru" : "en";
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", text);
      url.searchParams.set("langpair", language + "|" + targetLanguage);

      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok) throw new Error("Translation service unavailable");

      const data = await response.json();
      if (version !== translationVersion) return;

      if (data.quotaFinished || Number(data.responseStatus) === 429) {
        showTranslationStatus(
          "Дневной лимит автоперевода закончился. Можно ввести перевод вручную.",
          "error"
        );
        return;
      }

      if (Number(data.responseStatus) !== 200) {
        throw new Error("Translation service error");
      }

      const translated = chooseTranslation(data, text, targetLanguage);
      if (!translated) throw new Error("No translation");

      translationInput.value = translated;
      if (translated.length > MAX_LENGTH) {
        showTranslationStatus(
          "Перевод слишком длинный. Сократи его до 160 символов.", "error"
        );
      } else {
        translationCache.set(language + ":" + normalize(text), translated);
        showTranslationStatus("Готово. При желании исправь перевод.");
      }
    } catch {
      if (version !== translationVersion) return;
      showTranslationStatus(
        "Автоперевод сейчас недоступен. Введи свой вариант или попробуй ещё раз.",
        "error"
      );
    } finally {
      clearTimeout(timeout);
      if (version === translationVersion) {
        translationController = null;
        translating = false;
        updateButtons();
      }
    }
  }

  function wordCountLabel(number) {
    const lastTwo = number % 100;
    const last = number % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return number + " слов";
    if (last === 1) return number + " слово";
    if (last >= 2 && last <= 4) return number + " слова";
    return number + " слов";
  }

  function renderWords() {
    const query = normalize(searchInput.value);
    const visible = words.filter(word =>
      normalize(word.english).includes(query)
      || normalize(word.russian).includes(query)
    );

    if (sortSelect.value === "alphabet") {
      visible.sort((first, second) => alphabet.compare(first.english, second.english));
    }

    if (words.length === 0) {
      hideTranslations = false;
      revealedWords.clear();
    }

    list.replaceChildren();
    count.textContent = wordCountLabel(words.length);
    emptyState.hidden = words.length !== 0;
    noResults.hidden = words.length === 0 || visible.length !== 0;
    clearSearchButton.hidden = searchInput.value.length === 0;
    searchResults.hidden = !query || words.length === 0;
    searchResults.textContent = "Найдено: " + visible.length + " из " + words.length;
    sortSelect.disabled = words.length === 0;
    practiceButton.disabled = words.length === 0;
    practiceButton.setAttribute("aria-pressed", String(hideTranslations));
    practiceButton.textContent = hideTranslations ? "Показать переводы" : "Скрыть переводы";
    practiceHint.hidden = !hideTranslations;

    const fragment = document.createDocumentFragment();
    for (const [index, word] of visible.entries()) {
      const row = template.content.firstElementChild.cloneNode(true);
      row.dataset.id = word.id;
      row.dataset.editing = String(word.id === editingId);
      row.querySelector(".word-number").textContent = String(index + 1).padStart(2, "0");
      row.querySelector(".english-word").textContent = word.english;
      const translation = row.querySelector(".russian-word");
      translation.textContent = word.russian;
      translation.id = "saved-translation-" + index;
      row.querySelector('[data-action="reveal"]').setAttribute("aria-controls", translation.id);
      updateRowTranslation(row);
      row.querySelector('[data-action="edit"]').setAttribute(
        "aria-label", "Изменить слово " + word.english
      );
      row.querySelector('[data-action="delete"]').setAttribute(
        "aria-label", "Удалить слово " + word.english
      );
      fragment.append(row);
    }
    list.append(fragment);
  }

  function updateRowTranslation(row) {
    const show = !hideTranslations || revealedWords.has(row.dataset.id);
    const reveal = row.querySelector('[data-action="reveal"]');
    row.querySelector(".russian-word").hidden = !show;
    reveal.hidden = !hideTranslations;
    reveal.setAttribute("aria-expanded", String(show));
    reveal.textContent = show ? "Скрыть перевод" : "Показать перевод";
    reveal.setAttribute("aria-label", reveal.textContent + " слова "
      + row.querySelector(".english-word").textContent);
  }

  function updateEditingRows() {
    for (const row of list.children) {
      row.dataset.editing = String(row.dataset.id === editingId);
    }
  }

  function clearSearch() {
    searchInput.value = "";
    renderWords();
    searchInput.focus();
  }

  function resetEditor() {
    cancelTranslation();
    editingId = null;
    sourceInput.value = "";
    translationInput.value = "";
    editorTitle.textContent = "Новое слово";
    saveButton.replaceChildren(
      document.createTextNode("Добавить слово "),
      Object.assign(document.createElement("span"), {textContent: "+"})
    );
    saveButton.lastElementChild.setAttribute("aria-hidden", "true");
    cancelButton.hidden = true;
    updateEditingRows();
    showTranslationStatus("Можно сразу ввести свой перевод.");
    updateDirection();
    updateButtons();
  }

  function saveWord(event) {
    event.preventDefault();
    if (!form.reportValidity() || translating || !storageReadable) return;

    const source = cleanText(sourceInput.value);
    const translation = cleanText(translationInput.value);
    const language = sourceLanguage();

    if (!language || !source || !translation
        || source.length > MAX_LENGTH || translation.length > MAX_LENGTH) {
      showTranslationStatus("Проверь слово и перевод: не больше 160 символов.", "error");
      return;
    }

    const english = language === "en" ? source : translation;
    const russian = language === "en" ? translation : source;
    const duplicate = words.some(word => word.id !== editingId
      && normalize(word.english) === normalize(english)
      && normalize(word.russian) === normalize(russian));

    if (duplicate) {
      showTranslationStatus("Такая пара уже есть в словаре.", "error");
      return;
    }

    const wasEditing = Boolean(editingId);
    if (editingId && !words.some(word => word.id === editingId)) {
      showTranslationStatus("Это слово уже удалено. Отмени редактирование.", "error");
      return;
    }

    const word = {
      id: editingId || (globalThis.crypto?.randomUUID?.()
        || Date.now().toString(36) + Math.random().toString(36).slice(2)),
      english,
      russian
    };
    const nextWords = editingId
      ? words.map(saved => saved.id === editingId ? word : saved)
      : [word, ...words];

    if (!writeWords(nextWords)) return;

    searchInput.value = "";
    renderWords();
    resetEditor();
    showListMessage(wasEditing ? "Изменения сохранены." : "Слово добавлено.");
    sourceInput.focus();
  }

  function editWord(id) {
    const word = words.find(saved => saved.id === id);
    if (!word) return;

    cancelTranslation();
    editingId = id;
    direction.value = "en";
    sourceInput.value = word.english;
    translationInput.value = word.russian;
    editorTitle.textContent = "Изменить слово";
    saveButton.textContent = "Сохранить изменения";
    cancelButton.hidden = false;
    updateEditingRows();
    showTranslationStatus("Можно исправить слово и перевод.");
    updateDirection();
    updateButtons();
    sourceInput.focus();
  }

  function deleteWord(id) {
    const index = words.findIndex(word => word.id === id);
    if (index === -1) return;

    const removed = words[index];
    if (!writeWords(words.filter(word => word.id !== id))) return;

    deletedWord = {word: removed, index};
    if (editingId === id) resetEditor();
    renderWords();
    showListMessage("Слово удалено.", true);
 
    const nextRow = list.children[Math.min(index, list.children.length - 1)];
    if (nextRow) nextRow.querySelector('[data-action="edit"]').focus();
    else searchInput.focus();
  }

  function undoDelete() {
    if (!deletedWord) return;
    const nextWords = [...words];
    nextWords.splice(Math.min(deletedWord.index, nextWords.length), 0, deletedWord.word);
    if (!writeWords(nextWords)) return;

    deletedWord = null;
    renderWords();
    showListMessage("Слово возвращено.");
  }

  sourceInput.addEventListener("input", scheduleTranslation);
  direction.addEventListener("change", scheduleTranslation);
  translationInput.addEventListener("input", () => {
    cancelTranslation();
    showTranslationStatus(
      translationInput.value ? "Твой вариант перевода." : "Можно ввести перевод вручную."
    );
    updateButtons();
  });
  translateButton.addEventListener("click", translateWord);
  form.addEventListener("submit", saveWord);
  cancelButton.addEventListener("click", () => {
    resetEditor();
    sourceInput.focus();
  });
  searchInput.addEventListener("input", renderWords);
  clearSearchButton.addEventListener("click", clearSearch);
  document.getElementById("reset-search").addEventListener("click", clearSearch);
  document.getElementById("focus-editor").addEventListener("click", () => sourceInput.focus());
  sortSelect.addEventListener("change", renderWords);
  practiceButton.addEventListener("click", () => {
    hideTranslations = !hideTranslations;
    revealedWords.clear();
    renderWords();
  });
  undoButton.addEventListener("click", undoDelete);
  list.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.closest(".word-row").dataset.id;
    if (button.dataset.action === "reveal" && hideTranslations) {
      if (revealedWords.has(id)) revealedWords.delete(id);
      else revealedWords.add(id);
      updateRowTranslation(button.closest(".word-row"));
    }
    if (button.dataset.action === "edit") editWord(id);
    if (button.dataset.action === "delete") deleteWord(id);
  });

  renderWords();
  updateDirection();
  updateButtons();
})();
