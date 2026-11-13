(() => {
  "use strict";

  const STORAGE_KEY = "stackphrase.speaking.review.v1";
  const RECORDING_LIMIT = 59000;
  const byId = id => document.getElementById(id);
  const scenarioList = byId("scenario-list");
  const reviewItems = byId("review-items");
  const reviewResult = byId("review-result");
  const timerToggle = byId("timer-toggle");
  const timeDisplay = byId("answer-time");
  const timerMessage = byId("timer-message");
  const recordAnalyze = byId("record-analyze");
  const recordStart = byId("record-start");
  const recordStop = byId("record-stop");
  const recordMessage = byId("record-message");
  const recordResult = byId("record-result");
  const audio = byId("answer-audio");
  const download = byId("record-download");
  const recordings = new Map();
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const defaultRecordMessage = recordMessage.textContent;
  const progress = readProgress();

  let scenario;
  let remaining = 0;
  let deadline = 0;
  let timerInterval;
  let requestId = 0;
  let requesting = false;
  let capture;
  let returnRecordFocus;

  function readProgress() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Object.fromEntries(speakingScenarios.map(item => [
        item.id,
        item.checklist.map((_, index) => stored?.[item.id]?.[index] === true)
      ]));
    } catch {
      return Object.fromEntries(speakingScenarios.map(item => [
        item.id,
        item.checklist.map(() => false)
      ]));
    }
  }

  function fillList(list, entries) {
    list.replaceChildren(...entries.map(text => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
  }

  function updateReviewMessage(saved = true) {
    const marked = progress[scenario.id].filter(Boolean).length;
    reviewResult.textContent = "Отмечено " + marked + " из " + scenario.checklist.length + ".";
    if (!saved) reviewResult.textContent += " Браузер не смог сохранить отметки.";
  }

  function renderReview() {
    reviewItems.replaceChildren(...scenario.checklist.map((text, index) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = progress[scenario.id][index];
      input.dataset.index = index;
      label.append(input, text);
      return label;
    }));
    updateReviewMessage();
  }

  function showTime() {
    const seconds = Math.ceil(remaining / 1000);
    timeDisplay.textContent = "0" + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function updateTime() {
    remaining = Math.max(0, deadline - performance.now());
    showTime();
    if (remaining > 0) return;
    clearInterval(timerInterval);
    timerInterval = undefined;
    timerToggle.textContent = "Запустить снова";
    timerMessage.textContent = capture && !capture.stopping
      ? "Время вышло. Останови запись, когда закончишь ответ."
      : "Время вышло. Прослушай ответ или попробуй ещё раз.";
  }

  function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = undefined;
    remaining = scenario.seconds * 1000;
    timerToggle.textContent = "Запустить таймер";
    timerMessage.textContent = "";
    showTime();
  }

  function toggleTimer() {
    if (timerInterval !== undefined) {
      updateTime();
      if (!remaining) return;
      clearInterval(timerInterval);
      timerInterval = undefined;
      timerToggle.textContent = "Продолжить";
      timerMessage.textContent = "Таймер на паузе.";
      return;
    }
    if (!remaining) resetTimer();
    deadline = performance.now() + remaining;
    timerInterval = setInterval(updateTime, 100);
    timerToggle.textContent = "Пауза";
    timerMessage.textContent = "";
  }

  function updateRecordControls() {
    const busy = requesting || Boolean(capture);
    const focused = document.activeElement;
    recordAnalyze.hidden = busy || !canRecord;
    recordAnalyze.disabled = !speakingFeedback.available;
    recordStart.hidden = busy;
    recordStart.disabled = !canRecord;
    recordStop.hidden = !busy;
    recordStop.disabled = Boolean(capture?.stopping);
    recordStop.textContent = requesting ? "Отменить запрос"
      : capture?.stopping ? "Завершаем запись…" : "Остановить запись";
    recordResult.hidden = busy || !recordings.has(scenario.id);
    for (const button of scenarioList.querySelectorAll("button")) button.disabled = busy;
    speakingFeedback.setCaptureBusy(busy);
    if (busy && focused === returnRecordFocus) recordStop.focus({preventScroll: true});
    if (!busy && returnRecordFocus) {
      if (focused === recordStop || focused === document.body) returnRecordFocus.focus({preventScroll: true});
      returnRecordFocus = undefined;
    }
  }

  function showRecording() {
    const recording = recordings.get(scenario.id);
    if (recording) {
      if (audio.getAttribute("src") !== recording.url) audio.src = recording.url;
      download.href = recording.url;
      download.download = "stackphrase-" + scenario.id + "." + recording.extension;
    } else {
      audio.removeAttribute("src");
      audio.load();
      download.removeAttribute("href");
    }
  }

  function selectScenario(item) {
    scenario = item;
    for (const button of scenarioList.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.scenario === item.id));
    }
    byId("scenario-meta").textContent = item.level + " · " + item.seconds + " секунд на ответ";
    byId("scenario-title").textContent = item.title;
    byId("scenario-prompt").textContent = item.prompt;
    fillList(byId("scenario-steps"), item.steps);
    byId("scenario-phrases").textContent = item.phrases;
    const example = byId("scenario-example");
    example.textContent = item.example;
    example.closest("details").open = false;
    resetTimer();
    renderReview();
    showRecording();
    speakingFeedback.select(item, recordings.get(item.id)?.blob);
    updateRecordControls();
    recordMessage.textContent = canRecord ? defaultRecordMessage
      : window.isSecureContext
        ? "Запись недоступна в этом браузере. Можно ответить вслух с таймером и пройти самопроверку."
        : "Для записи открой страницу через локальный сервер или по HTTPS.";
  }

  function stopTracks(stream) {
    for (const track of stream.getTracks()) track.stop();
  }

  function releaseCapture(session) {
    clearTimeout(session.limit);
    stopTracks(session.stream);
  }

  function storeRecording(session, blob) {
    const previous = recordings.get(session.scenarioId);
    if (blob) {
      const mediaType = blob.type.split(";")[0];
      const extension = {
        "audio/mp4": "m4a",
        "video/mp4": "m4a",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/x-wav": "wav"
      }[mediaType] || "webm";
      recordings.set(session.scenarioId, {url: URL.createObjectURL(blob), extension, blob});
    } else {
      recordings.delete(session.scenarioId);
    }
    showRecording();
    if (previous) URL.revokeObjectURL(previous.url);
    speakingFeedback.setRecording(blob);
  }

  function finishRecording(session, audioAvailable) {
    if (capture !== session || session.finishing) return;
    session.finishing = true;
    session.stopping = true;
    releaseCapture(session);
    let stored = false;

    try {
      const type = session.recorder.mimeType || session.chunks[0]?.type || "";
      const blob = audioAvailable ? new Blob(session.chunks, {type}) : undefined;
      if (blob?.size) {
        storeRecording(session, blob);
        stored = true;
        recordMessage.textContent = "Запись готова. Её можно прослушать или скачать.";
      } else {
        recordMessage.textContent = audioAvailable
          ? "Запись пустая. Попробуй ещё раз."
          : "Браузер прервал запись. Можно попробовать снова.";
      }
    } catch {
      if (capture === session) recordMessage.textContent = "Не удалось сохранить ответ. Попробуй записать его ещё раз.";
    } finally {
      if (capture === session) {
        capture = undefined;
        updateRecordControls();
      }
    }
    if (stored && session.mode === "ai") {
      speakingFeedback.analyzeRecording();
    }
  }

  async function startRecording(mode, button) {
    if (!canRecord || requesting || capture || (mode === "ai" && !speakingFeedback.available)) return;
    const id = ++requestId;
    if (document.activeElement === button) returnRecordFocus = button;
    requesting = true;
    audio.pause();
    window.speechSynthesis?.cancel();
    recordMessage.textContent = "Разреши доступ к микрофону в браузере.";
    updateRecordControls();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (id !== requestId) {
        stopTracks(stream);
        return;
      }
      const recorder = new MediaRecorder(stream);
      const session = {recorder, stream, scenarioId: scenario.id, mode, chunks: [], stopping: false};
      recorder.addEventListener("dataavailable", event => {
        if (event.data.size) session.chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => finishRecording(session, true));
      recorder.addEventListener("error", () => finishRecording(session, false));
      recorder.start();
      requesting = false;
      capture = session;
      session.limit = setTimeout(stopRecording, RECORDING_LIMIT);
      recordMessage.textContent = mode === "ai"
        ? "Говори по-английски. После остановки ответ появится в диалоге."
        : "Идёт запись. Максимальная длительность — 60 секунд.";
      updateRecordControls();
    } catch (error) {
      if (stream) stopTracks(stream);
      if (id !== requestId) return;
      requesting = false;
      recordMessage.textContent = error.name === "NotAllowedError"
        ? "Микрофон не разрешён. Можно продолжить с таймером."
        : "Микрофон недоступен. Проверь подключение или продолжи с таймером.";
      updateRecordControls();
    }
  }

  function stopRecording() {
    if (requesting) {
      requestId += 1;
      requesting = false;
      recordMessage.textContent = "Запрос отменён.";
      updateRecordControls();
      return;
    }
    if (!capture || capture.stopping) return;
    capture.stopping = true;
    clearTimeout(capture.limit);
    if (capture.recorder.state !== "inactive") capture.recorder.stop();
    updateRecordControls();
  }

  function clearRecording() {
    if (requesting || capture) return;
    const recording = recordings.get(scenario.id);
    if (!recording) return;
    recordings.delete(scenario.id);
    showRecording();
    speakingFeedback.removeRecording();
    URL.revokeObjectURL(recording.url);
    updateRecordControls();
    recordMessage.textContent = "Аудиозапись удалена.";
  }

  for (const item of speakingScenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scenario = item.id;
    const level = document.createElement("span");
    level.textContent = item.level;
    const title = document.createElement("strong");
    title.lang = "en";
    title.textContent = item.title;
    button.append(level, title);
    button.addEventListener("click", () => {
      if (scenario !== item) selectScenario(item);
    });
    scenarioList.append(button);
  }

  reviewItems.addEventListener("change", event => {
    const input = event.target;
    if (!input.matches("input[type=checkbox]")) return;
    progress[scenario.id][Number(input.dataset.index)] = input.checked;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      updateReviewMessage();
    } catch {
      updateReviewMessage(false);
    }
  });
  timerToggle.addEventListener("click", toggleTimer);
  byId("timer-reset").addEventListener("click", resetTimer);
  recordAnalyze.addEventListener("click", () => startRecording("ai", recordAnalyze));
  recordStart.addEventListener("click", () => startRecording("audio", recordStart));
  recordStop.addEventListener("click", stopRecording);
  byId("record-clear").addEventListener("click", clearRecording);
  window.addEventListener("pagehide", () => {
    requestId += 1;
    requesting = false;
    returnRecordFocus = undefined;
    const session = capture;
    capture = undefined;
    if (session) {
      if (session.recorder.state !== "inactive") session.recorder.stop();
      releaseCapture(session);
    }
    for (const recording of recordings.values()) URL.revokeObjectURL(recording.url);
    recordings.clear();
    speakingFeedback.clear();
    resetTimer();
    showRecording();
    updateRecordControls();
    recordMessage.textContent = canRecord ? defaultRecordMessage : recordMessage.textContent;
  });

  selectScenario(speakingScenarios[0]);
  byId("speaking-practice").hidden = false;
  speakingFeedback.ready.then(updateRecordControls);
})();
