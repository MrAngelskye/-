"use strict";

// Карточки используют тот же словарь. Отдельную копию слов не сохраняем.
function createVocabularyCards({getWords, saveWords, focusEditor}) {
  const byId = id => document.getElementById(id);
  const dictionaryTab = byId("dictionary-tab");
  const cardsTab = byId("cards-tab");
  const dictionaryPanel = byId("dictionary-panel");
  const cardsPanel = byId("cards-panel");
  const card = byId("review-card");
  const stage = byId("card-stage");
  const front = byId("card-front");
  const back = byId("card-back");
  const wrongButton = byId("card-wrong");
  const correctButton = byId("card-correct");
  const deleteButton = byId("card-delete");
  const undoButton = byId("card-undo");
  const status = byId("card-status");
  const correct = new Set();
  const wrong = new Set();
  const removed = new Set();

  let queue = [];
  let dictionaryVersion = null;
  let revealed = false;
  let drag = null;
  let suppressClick = false;
  let cardMotion = null;
  let busy = false;
  let lastDeleted = null;

  const restingPose = {x: 0, y: 0, rotation: 0, scale: 1, opacity: 1};
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function readPose() {
    const style = getComputedStyle(card);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    return {
      x: matrix.m41,
      y: matrix.m42,
      rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
      scale: Math.hypot(matrix.a, matrix.b),
      opacity: Number(style.opacity)
    };
  }

  function poseFrame(pose, offset) {
    return {
      transform: "translate(" + pose.x + "px, " + pose.y + "px) rotate("
        + pose.rotation + "deg) scale(" + pose.scale + ")",
      opacity: pose.opacity,
      ...(offset === undefined ? {} : {offset})
    };
  }

  function setPose(pose) {
    const frame = poseFrame(pose);
    card.style.transform = frame.transform;
    card.style.opacity = frame.opacity;
  }

  function stopMotion() {
    if (!cardMotion) return;
    cardMotion.onfinish = null;
    cardMotion.cancel();
    cardMotion = null;
    delete card.dataset.moving;
  }

  function animateCard(poses, duration, onFinish = () => {}) {
    stopMotion();
    const lastPose = poses[poses.length - 1];
    if (reducedMotion.matches || typeof card.animate !== "function") {
      setPose(lastPose);
      onFinish();
      return;
    }
    const animation = card.animate(poses.map(pose => poseFrame(pose, pose.offset)), {
      duration,
      easing: "cubic-bezier(.22, .68, .32, 1)",
      fill: "forwards"
    });
    cardMotion = animation;
    card.dataset.moving = "true";
    animation.onfinish = () => {
      if (cardMotion !== animation) return;
      setPose(lastPose);
      stopMotion();
      onFinish();
    };
  }

  function returnToStack() {
    const start = readPose();
    delete card.dataset.intent;
    delete stage.dataset.intent;
    animateCard([
      {...start, offset: 0},
      {x: -start.x * 0.035, y: -start.y * 0.035, rotation: 0, scale: 1, opacity: 1, offset: 0.8},
      {...restingPose, offset: 1}
    ], 400);
  }

  function currentWord() {
    return getWords().find(word => word.id === queue[0]);
  }

  function rememberDictionary() {
    dictionaryVersion = JSON.stringify(getWords());
  }

  function startReview(ids = getWords().map(word => word.id)) {
    finishExit();
    cancelDrag();
    const savedIds = new Set(getWords().map(word => word.id));
    queue = [...new Set(ids)].filter(id => savedIds.has(id));
    correct.clear();
    wrong.clear();
    removed.clear();
    rememberDictionary();
    render();
  }

  function syncDictionary() {
    const changed = dictionaryVersion !== null;
    if (dictionaryVersion !== JSON.stringify(getWords())) {
      startReview();
      status.textContent = changed ? "Словарь изменился. Начата новая подборка." : "";
    }
    if (lastDeleted && getWords().some(word => word.id === lastDeleted.word.id)) {
      lastDeleted = null;
      undoButton.hidden = true;
    }
  }

  function selectTab(showCards, focusTab = false) {
    finishExit();
    cancelDrag();
    if (showCards) syncDictionary();
    dictionaryPanel.hidden = showCards;
    cardsPanel.hidden = !showCards;
    dictionaryTab.setAttribute("aria-selected", String(!showCards));
    cardsTab.setAttribute("aria-selected", String(showCards));
    dictionaryTab.tabIndex = showCards ? -1 : 0;
    cardsTab.tabIndex = showCards ? 0 : -1;
    if (focusTab) (showCards ? cardsTab : dictionaryTab).focus();
  }

  function render(focus = false, animate = false) {
    stopMotion();
    revealed = false;
    delete card.dataset.ready;
    delete card.dataset.exit;
    delete card.dataset.intent;
    delete stage.dataset.exiting;
    delete stage.dataset.intent;
    setPose(restingPose);
    card.setAttribute("aria-pressed", "false");
    card.setAttribute("aria-busy", "false");
    const word = currentWord();
    const completed = correct.size + wrong.size + removed.size;
    const total = completed + queue.length;

    byId("review-correct").textContent = correct.size;
    byId("review-wrong").textContent = wrong.size;
    byId("review-deleted").textContent = removed.size;
    byId("card-position").textContent = word
      ? "Карточка " + (completed + 1) + " из " + total
      : (total ? total + " из " + total : "");
    byId("review-active").hidden = !word;
    byId("review-empty").hidden = Boolean(word) || getWords().length !== 0;
    byId("review-complete").hidden = Boolean(word) || getWords().length === 0;
    byId("review-retry").disabled = wrong.size === 0;
    wrongButton.disabled = true;
    correctButton.disabled = true;
    deleteButton.disabled = !word;
    undoButton.disabled = false;

    if (word) {
      byId("card-word").textContent = word.english;
      byId("card-translation").textContent = word.russian;
      byId("card-original").textContent = word.english;
      card.dataset.long = String(Math.max(word.english.length, word.russian.length) > 35);
      front.setAttribute("aria-hidden", "false");
      back.setAttribute("aria-hidden", "true");
      card.setAttribute("aria-label", word.english + ". Показать перевод");
      if (animate) {
        animateCard([
          {x: 0, y: 16, rotation: -1.5, scale: 0.96, opacity: 0, offset: 0},
          {x: 0, y: -1, rotation: 0, scale: 1.003, opacity: 1, offset: 0.8},
          {...restingPose, offset: 1}
        ], 340);
      }
      if (focus) card.focus({preventScroll: true});
    } else {
      byId("review-summary").textContent = "Вспомнил: " + correct.size
        + ". На повторение: " + wrong.size + ". Удалено из словаря: " + removed.size + ".";
      if (focus) {
        byId(getWords().length ? "review-complete-title" : "review-empty-title")
          .focus({preventScroll: true});
      }
    }
  }

  function flipCard() {
    const word = currentWord();
    if (!word || busy || drag) return;
    revealed = !revealed;
    card.dataset.ready = "true";
    card.setAttribute("aria-pressed", String(revealed));
    front.setAttribute("aria-hidden", String(revealed));
    back.setAttribute("aria-hidden", String(!revealed));
    card.setAttribute("aria-label", revealed
      ? word.english + " — " + word.russian + ". Скрыть перевод"
      : word.english + ". Показать перевод");
    wrongButton.disabled = !revealed;
    correctButton.disabled = !revealed;
  }

  function finishExit(focus = false, animateNext = false) {
    if (!busy) return;
    stopMotion();
    busy = false;
    render(focus, animateNext);
  }

  function answer(action) {
    const word = currentWord();
    if (!word || busy) return;
    if (action !== "delete" && !revealed) {
      status.textContent = "Сначала нажми на карточку и открой перевод.";
      return false;
    }

    if (action === "delete") {
      const words = getWords();
      const index = words.findIndex(saved => saved.id === word.id);
      if (!saveWords(words.filter(saved => saved.id !== word.id))) {
        status.textContent = "Не удалось удалить слово. Карточка осталась на месте.";
        return false;
      }
      lastDeleted = {word, index};
      removed.add(word.id);
      undoButton.hidden = false;
      status.textContent = "«" + word.english + "» удалено из словаря.";
      rememberDictionary();
    } else {
      (action === "correct" ? correct : wrong).add(word.id);
      status.textContent = action === "correct" ? "Ответ отмечен: вспомнил." : "Это слово попадёт в повторение ошибок.";
    }

    queue.shift();
    busy = true;
    card.setAttribute("aria-busy", "true");
    wrongButton.disabled = true;
    correctButton.disabled = true;
    deleteButton.disabled = true;
    undoButton.disabled = true;
    card.dataset.exit = action;
    stage.dataset.exiting = "true";

    // Продолжаем движение от точки отпускания, без скачка в центр.
    const start = readPose();
    const direction = action === "wrong" ? -1 : 1;
    const end = action === "delete"
      ? {x: start.x * 0.45, y: Math.max(start.y + 130, 165), rotation: start.rotation * 0.4, scale: 0.9, opacity: 0}
      : {x: start.x + direction * 170, y: start.y - 24, rotation: direction * 14, scale: 0.94, opacity: 0};
    animateCard([
      {...start, offset: 0},
      {
        x: start.x + (end.x - start.x) * 0.48,
        y: start.y + (end.y - start.y) * 0.48,
        rotation: start.rotation + (end.rotation - start.rotation) * 0.48,
        scale: start.scale + (end.scale - start.scale) * 0.48,
        opacity: start.opacity * 0.66,
        offset: 0.55
      },
      {...end, offset: 1}
    ], 520, () => finishExit(!cardsPanel.hidden, true));
    return true;
  }

  function undoDelete() {
    if (!lastDeleted || busy) return;
    const words = [...getWords()];
    const {word, index} = lastDeleted;
    if (words.some(saved => saved.id === word.id)) return;
    words.splice(Math.min(index, words.length), 0, word);
    if (!saveWords(words)) {
      status.textContent = "Не удалось вернуть слово. Попробуй ещё раз.";
      return;
    }
    removed.delete(word.id);
    queue.unshift(word.id);
    lastDeleted = null;
    undoButton.hidden = true;
    rememberDictionary();
    render(true);
    status.textContent = "«" + word.english + "» возвращено в словарь и в карточки.";
  }

  function dragIntent(x, y) {
    const threshold = Math.min(110, Math.max(60, card.offsetWidth * 0.22));
    if (y > threshold && y > Math.abs(x) * 1.2) return "delete";
    if (Math.abs(x) > threshold && Math.abs(x) > Math.abs(y) * 1.1) {
      return x > 0 ? "correct" : "wrong";
    }
    return null;
  }

  function releaseDrag() {
    const pointerId = drag?.id;
    if (drag?.moved) suppressClick = true;
    drag = null;
    if (pointerId !== undefined && card.hasPointerCapture(pointerId)) {
      card.releasePointerCapture(pointerId);
    }
    delete card.dataset.dragging;
  }

  function cancelDrag() {
    if (!drag) return;
    releaseDrag();
    if (!busy) returnToStack();
  }

  function startDrag(event) {
    if (busy || !currentWord() || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    const base = readPose();
    stopMotion();
    setPose(base);
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, moved: false, base};
    card.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
    if (Math.hypot(drag.dx, drag.dy) > 8) drag.moved = true;
    if (!drag.moved) return;

    card.dataset.dragging = "true";
    // У края движение становится мягче: удерживаемая карточка остаётся в поле зрения.
    const limitX = Math.min(260, Math.max(72, (stage.clientWidth - card.offsetWidth) / 2 + card.offsetWidth * 0.12));
    const limitY = Math.min(150, card.offsetHeight * 0.35);
    const x = drag.base.x + limitX * Math.tanh(drag.dx / limitX);
    const y = drag.base.y + limitY * Math.tanh(drag.dy / limitY);
    const progress = Math.min(1, Math.hypot(drag.dx, drag.dy) / (card.offsetWidth * 0.45));
    setPose({
      x,
      y,
      rotation: Math.max(-10, Math.min(10, x / 24)),
      scale: 1 - progress * 0.02,
      opacity: 1 - progress * 0.26
    });
    const intent = dragIntent(drag.dx, drag.dy);
    if (intent) {
      card.dataset.intent = intent;
      stage.dataset.intent = intent;
      byId("card-drag-label").textContent = intent === "delete" ? "Удалить из словаря ↓"
        : (revealed ? (intent === "correct" ? "Вспомнил →" : "← Не вспомнил") : "Сначала открой перевод");
    } else {
      delete card.dataset.intent;
      delete stage.dataset.intent;
    }
  }

  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    moveDrag(event);
    const intent = dragIntent(event.clientX - drag.x, event.clientY - drag.y);
    const moved = drag.moved;
    releaseDrag();
    if (!moved) {
      returnToStack();
      return;
    }

    suppressClick = true;
    if (!intent || !answer(intent)) returnToStack();
  }

  dictionaryTab.addEventListener("click", () => selectTab(false));
  cardsTab.addEventListener("click", () => selectTab(true));
  for (const tab of [dictionaryTab, cardsTab]) {
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const showCards = event.key === "End" || (event.key !== "Home" && tab === dictionaryTab);
      selectTab(showCards, true);
    });
  }

  card.addEventListener("click", event => {
    if (suppressClick && event.detail !== 0) return;
    flipCard();
  });
  card.addEventListener("pointerdown", startDrag);
  card.addEventListener("pointermove", moveDrag);
  card.addEventListener("pointerup", endDrag);
  card.addEventListener("pointercancel", cancelDrag);
  card.addEventListener("lostpointercapture", () => { if (drag) cancelDrag(); });
  window.addEventListener("blur", cancelDrag);
  card.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      cancelDrag();
      return;
    }
    const actions = {ArrowLeft: "wrong", ArrowRight: "correct", ArrowDown: "delete"};
    if (!actions[event.key] || event.repeat) return;
    event.preventDefault();
    cancelDrag();
    answer(actions[event.key]);
  });
  wrongButton.addEventListener("click", () => answer("wrong"));
  correctButton.addEventListener("click", () => answer("correct"));
  deleteButton.addEventListener("click", () => answer("delete"));
  undoButton.addEventListener("click", undoDelete);
  byId("cards-add-word").addEventListener("click", () => {
    selectTab(false);
    focusEditor();
  });
  byId("review-restart").addEventListener("click", () => {
    startReview();
    status.textContent = "Начата новая подборка.";
    card.focus({preventScroll: true});
  });
  byId("review-retry").addEventListener("click", () => {
    startReview([...wrong]);
    status.textContent = "Повторяем слова, которые не удалось вспомнить.";
    card.focus({preventScroll: true});
  });
}
