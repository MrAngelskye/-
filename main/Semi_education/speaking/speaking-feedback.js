"use strict";

const speakingFeedback = (() => {
  const element = id => document.getElementById(id);
  const composer = element("answer-transcript");
  const mode = element("practice-mode");
  const analyze = element("analyze-recording");
  const send = element("review-transcript");
  const cancel = element("cancel-analysis");
  const status = element("analysis-status");
  const elapsed = element("analysis-elapsed");
  const connection = element("ai-connection");
  const log = element("speaking-chat");
  const listen = element("listen-phrase");
  const drafts = new Map();
  let scenario;
  let recording;
  let draft;
  let request;
  let captureBusy = false;
  let available = false;

  function updateButtons() {
    const busy = captureBusy || Boolean(request);
    analyze.disabled = !available || !recording || busy;
    send.disabled = !available || !composer.value.trim() || busy;
    cancel.hidden = !request;
    elapsed.hidden = !request;
    mode.disabled = captureBusy;
    composer.readOnly = captureBusy;
    listen.disabled = captureBusy;
    element("new-dialogue").disabled = captureBusy;
    log.setAttribute("aria-busy", String(Boolean(request)));
  }

  function cancelRequest(message = "") {
    request?.controller.abort();
    request = undefined;
    status.textContent = message;
    updateButtons();
  }

  function paragraph(text, className = "") {
    const node = document.createElement("p");
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderWords(message) {
    const text = paragraph("", "chat-answer");
    text.lang = "en";
    const words = message.recording && message.recording === recording ? message.words ?? [] : [];
    let cursor = 0;
    for (const word of words) {
      text.append(document.createTextNode(message.text.slice(cursor, word.startIndex)));
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.time = word.startTime;
      button.textContent = word.text;
      button.title = "Послушать с этого слова · " + word.startTime.toFixed(1) + " с";
      text.append(button);
      cursor = word.endIndex;
    }
    text.append(document.createTextNode(message.text.slice(cursor)));
    return text;
  }

  function renderReview(article, result) {
    article.append(paragraph(result.summary));
    if (result.taskFeedback) article.append(paragraph(result.taskFeedback));
    for (const correction of result.corrections) {
      const pair = paragraph("", "chat-correction");
      const original = document.createElement("span");
      original.lang = "en";
      original.textContent = correction.original;
      const corrected = document.createElement("strong");
      corrected.lang = "en";
      corrected.textContent = correction.correction;
      pair.append(original, " → ", corrected);
      article.append(pair, paragraph(correction.explanation));
    }
    if (result.correctedAnswer && result.correctedAnswer !== result.transcript) {
      const answer = document.createElement("blockquote");
      answer.lang = "en";
      answer.textContent = result.correctedAnswer;
      article.append(answer);
    }
    if (result.uncertainWords.length) article.append(paragraph("Нужно переслушать: " + result.uncertainWords.join(", ") + ".", "chat-note"));
    for (const item of result.pronunciation) {
      article.append(paragraph(item.word + ": " + item.heard), paragraph(item.tip, "chat-note"));
    }
    if (result.nextStep) article.append(paragraph(result.nextStep, "chat-next"));
  }

  function render(follow = false) {
    if (!draft.messages.length) {
      const welcome = document.createElement("div");
      welcome.className = "chat-welcome";
      welcome.append(paragraph("Начнём с твоего ответа."), paragraph("Запиши его вслух или напиши ниже. Потом можно обсудить исправления и попробовать ещё раз."));
      log.replaceChildren(welcome);
      return;
    }
    log.replaceChildren(...draft.messages.map((message, index) => {
      const article = document.createElement("article");
      article.className = "chat-message " + (message.role === "user" ? "chat-user" : "chat-teacher");
      article.append(paragraph(message.role === "user" ? "Ты" : "Преподаватель", "chat-author"));
      if (message.result) {
        renderReview(article, message.result);
      } else if (message.audio) {
        article.append(renderWords(message));
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "chat-edit";
        edit.dataset.edit = index;
        edit.textContent = "Исправить текст";
        article.append(edit);
      } else {
        for (const text of message.text.split(/\n\s*\n/)) article.append(paragraph(text));
      }
      return article;
    }));
    if (follow) log.scrollTop = log.scrollHeight;
  }

  function select(item, blob) {
    cancelRequest();
    window.speechSynthesis?.cancel();
    scenario = item;
    recording = blob;
    if (!drafts.has(item.id)) drafts.set(item.id, {text: "", mode: "answer", messages: []});
    draft = drafts.get(item.id);
    composer.value = draft.text;
    mode.value = draft.mode;
    element("practice-phrase").textContent = item.drill.text;
    element("practice-tip").textContent = item.drill.tip;
    element("listen-status").textContent = "";
    render();
    updateButtons();
  }

  function setCaptureBusy(busy) {
    if (busy && !captureBusy) cancelRequest();
    captureBusy = busy;
    updateButtons();
  }

  function setRecording(blob) {
    cancelRequest();
    recording = blob;
    for (const message of draft.messages) message.recording = null;
    draft.audioMessage = null;
    draft.retry = null;
    render();
    updateButtons();
  }

  function removeRecording() {
    cancelRequest();
    recording = undefined;
    for (const message of draft.messages) message.recording = null;
    draft.audioMessage = null;
    render();
    status.textContent = "Запись удалена. Сообщения остались в диалоге.";
    updateButtons();
  }

  // Отмена работает и во время подготовки звука в браузере.
  function cancellable(promise, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, {once: true});
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  async function makeWave(blob, signal) {
    if (!window.OfflineAudioContext) throw new Error("Браузер не умеет подготовить запись. Попробуй другой браузер.");
    const preparation = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const sampleRate = 16000;
    const decoder = new OfflineAudioContext(1, 1, sampleRate);
    let sound;
    try {
      const data = await cancellable(blob.arrayBuffer(), preparation);
      sound = await cancellable(decoder.decodeAudioData(data), preparation);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error("Не удалось подготовить звук. Запиши короткую фразу ещё раз или отправь её текстом.");
    }
    if (sound.duration > 60) throw new Error("Для разбора нужна запись длиной до 60 секунд.");
    const wave = new DataView(new ArrayBuffer(44 + sound.length * 2));
    for (const [offset, label] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
      for (let index = 0; index < label.length; index += 1) wave.setUint8(offset + index, label.charCodeAt(index));
    }
    wave.setUint32(4, wave.byteLength - 8, true);
    wave.setUint32(16, 16, true);
    wave.setUint16(20, 1, true);
    wave.setUint16(22, 1, true);
    wave.setUint32(24, sampleRate, true);
    wave.setUint32(28, sampleRate * 2, true);
    wave.setUint16(32, 2, true);
    wave.setUint16(34, 16, true);
    wave.setUint32(40, sound.length * 2, true);
    const channels = Array.from({length: sound.numberOfChannels}, (_, index) => sound.getChannelData(index));
    for (let index = 0; index < sound.length; index += 1) {
      const sample = channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length;
      wave.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
    }
    return wave.buffer;
  }

  function receiveTranscript(data, token) {
    if (request !== token || token.controller.signal.aborted) return;
    if (typeof data.transcript !== "string" || !Array.isArray(data.words)) throw new Error("Не удалось прочитать слова из записи.");
    if (!token.user) {
      token.user = draft.audioMessage;
      if (!token.user) {
        token.user = {role: "user", audio: true, recording};
        draft.messages.push(token.user);
        draft.audioMessage = token.user;
      }
    }
    Object.assign(token.user, {text: data.transcript, words: data.words});
    token.transcribed = true;
    status.textContent = "Слова появились в диалоге. Разбираю фразы и произношение…";
    render(true);
  }

  async function readFeedback(response, token) {
    if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let result;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, {stream: true});
        if (pending.length > 128 * 1024) throw new Error("Пришёл слишком большой ответ.");
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (line) {
            const message = JSON.parse(line);
            if (message.type === "transcript") receiveTranscript(message, token);
            if (message.type === "result") result = message.result;
            if (message.type === "error") throw new Error(message.error);
          }
          newline = pending.indexOf("\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!result) throw new Error("Ответ прервался до завершения разбора.");
    return result;
  }

  function feedbackText(result) {
    return [result.summary, result.taskFeedback,
      ...result.corrections.map(item => item.original + " → " + item.correction + ". " + item.explanation),
      ...result.pronunciation.map(item => item.word + ": " + item.heard + ". " + item.tip),
      result.nextStep].filter(Boolean).join("\n\n");
  }

  function history() {
    const messages = [];
    let length = 0;
    for (const message of draft.messages.slice(-12).reverse()) {
      const text = message.text.slice(0, 4000);
      if (length + text.length > 16000) break;
      messages.unshift({role: message.role, text});
      length += text.length;
    }
    return messages;
  }

  async function submit(source) {
    if (!available || request || captureBusy) return;
    const text = composer.value.trim();
    if (source === "audio" ? !recording : !text) return;
    const token = {controller: new AbortController(), started: Date.now(), timedOut: false};
    request = token;
    const timer = setInterval(() => {
      if (request === token) elapsed.textContent = Math.floor((Date.now() - token.started) / 1000) + " с";
    }, 1000);
    const timeout = setTimeout(() => { token.timedOut = true; token.controller.abort(); }, 120000);
    elapsed.textContent = "0 с";
    status.textContent = source === "audio" ? "Готовлю запись…" : "Готовлю ответ…";
    updateButtons();
    try {
      let options;
      if (source === "audio") {
        const body = await makeWave(recording, token.controller.signal);
        status.textContent = "Распознаю слова из записи…";
        options = {headers: {
          "Content-Type": "audio/wav", Accept: "application/x-ndjson",
          "X-Speaking-Scenario": scenario.id, "X-Speaking-Mode": mode.value
        }, body};
      } else {
        const previous = history();
        const retry = draft.retry?.text === text ? draft.retry : null;
        if (retry && previous.at(-1)?.role === "user" && previous.at(-1).text === text) previous.pop();
        token.user = retry ?? {role: "user", text};
        if (!retry) draft.messages.push(token.user);
        draft.text = "";
        composer.value = "";
        render(true);
        options = {headers: {"Content-Type": "application/json"}, body: JSON.stringify({
          scenarioId: scenario.id, mode: mode.value, transcript: text, history: previous
        })};
      }
      if (token.controller.signal.aborted) return;
      const path = source === "audio" ? "/speaking-api/analyze" : "/speaking-api/chat";
      const response = await fetch(path, {...options, method: "POST", signal: token.controller.signal});
      const result = await readFeedback(response, token);
      if (request !== token || token.controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || "Ответ не пришёл. Попробуй ещё раз.");
      if (source === "audio") {
        if (result.source !== "audio" || typeof result.transcript !== "string"
            || !Array.isArray(result.corrections) || !Array.isArray(result.pronunciation)) {
          throw new Error("Пришёл неполный разбор. Запись можно отправить повторно.");
        }
        if (!token.transcribed) receiveTranscript({transcript: result.transcript, words: result.words ?? []}, token);
        draft.messages.push({role: "assistant", text: feedbackText(result), result});
      } else {
        if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("Пришёл пустой ответ. Попробуй ещё раз.");
        draft.messages.push({role: "assistant", text: result.reply});
      }
      draft.retry = null;
      render(true);
      status.textContent = "Можно задать вопрос или попробовать ответить ещё раз.";
    } catch (error) {
      if (request === token) {
        status.textContent = token.timedOut ? "Ответ не пришёл за две минуты. Запись и переписка сохранены. Попробуй короткую фразу или отправь текст."
          : token.controller.signal.aborted ? "Отправка отменена."
            : error.name === "Error" ? error.message : "Связь прервалась. Попробуй отправить ответ ещё раз.";
        if (source === "text" && token.user) {
          draft.retry = token.user;
          if (!composer.value) composer.value = draft.text = text;
        }
        if (token.transcribed && !token.controller.signal.aborted) status.textContent += " Слова сохранены в диалоге. Можно исправить и отправить их текстом.";
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(timer);
      if (request === token) { request = undefined; updateButtons(); }
    }
  }

  function listenToPhrase() {
    const voice = window.speechSynthesis?.getVoices().find(item => item.localService && /^en([-_]|$)/i.test(item.lang));
    if (!voice) {
      element("listen-status").textContent = "Для озвучки нужен установленный на устройстве английский голос.";
      return;
    }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(scenario.drill.text);
    speech.voice = voice;
    speech.lang = voice.lang;
    speech.rate = 0.85;
    element("listen-status").textContent = "";
    window.speechSynthesis.speak(speech);
  }

  composer.addEventListener("input", () => { draft.text = composer.value; updateButtons(); });
  composer.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit("text"); }
  });
  mode.addEventListener("change", () => { cancelRequest(); draft.mode = mode.value; });
  send.addEventListener("click", () => submit("text"));
  analyze.addEventListener("click", () => submit("audio"));
  cancel.addEventListener("click", () => cancelRequest("Отправка отменена. Запись и переписка сохранены."));
  listen.addEventListener("click", listenToPhrase);
  element("new-dialogue").addEventListener("click", () => {
    cancelRequest();
    draft.messages = [];
    draft.audioMessage = null;
    draft.retry = null;
    composer.value = draft.text = "";
    render();
    updateButtons();
  });
  log.addEventListener("click", event => {
    const word = event.target.closest("button[data-time]");
    if (word && recording) {
      const audio = element("answer-audio");
      audio.currentTime = Math.max(0, Number(word.dataset.time) - 0.08);
      audio.play().catch(() => { status.textContent = "Включи запись в плеере выше."; });
    }
    const edit = event.target.closest("button[data-edit]");
    if (edit) {
      cancelRequest();
      composer.value = draft.text = draft.messages[Number(edit.dataset.edit)].text;
      composer.focus();
      updateButtons();
    }
  });

  async function connect() {
    if (!/^https?:$/.test(location.protocol)) {
      connection.textContent = "Для диалога открой Speaking через Start-Speaking.cmd.";
      return;
    }
    try {
      const response = await fetch("/speaking-api/status", {cache: "no-store", signal: AbortSignal.timeout(8000)});
      const result = await response.json();
      available = response.ok && result.configured === true;
      connection.textContent = available ? "" : "Диалог пока недоступен. Проверь ключ в настройках сервера.";
    } catch {
      connection.textContent = "Диалог недоступен по этому адресу. Запусти Start-Speaking.cmd и открой адрес из окна запуска.";
    }
    updateButtons();
  }

  const ready = connect();
  return {
    ready,
    get available() { return available; },
    select, setCaptureBusy, setRecording, removeRecording,
    analyzeRecording: () => submit("audio"),
    clear() { cancelRequest(); drafts.clear(); select(scenario); }
  };
})();
