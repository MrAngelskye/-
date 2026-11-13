import {CHAT_INSTRUCTIONS, CHAT_SCHEMA, FEEDBACK_SCHEMA, SPEAKING_INSTRUCTIONS} from "./speaking-prompts.mjs";
import {requestGemini, SpeakingError, textParts} from "./speaking-gemini.mjs";
import {transcribeSpeaking} from "./speaking-transcription.mjs";
export {SpeakingError} from "./speaking-gemini.mjs";

export const AUDIO_SECONDS_LIMIT = 60;
export const AUDIO_BYTES_LIMIT = 44 + AUDIO_SECONDS_LIMIT * 16000 * 2;

// Gemini поддерживает часть JSON Schema. Ограничения длины проверяем и здесь.
function matchesSchema(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "string") {
    return typeof value === "string"
      && value.length >= (schema.minLength ?? 0)
      && value.length <= (schema.maxLength ?? Infinity);
  }
  if (schema.type === "array") {
    return Array.isArray(value)
      && value.length <= schema.maxItems
      && value.every(item => matchesSchema(item, schema.items));
  }
  if (schema.type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && schema.required.every(key => Object.hasOwn(value, key))
      && Object.keys(value).every(key => Object.hasOwn(schema.properties, key))
      && Object.entries(schema.properties).every(([key, field]) => matchesSchema(value[key], field));
  }
  return false;
}

function normalizePhrase(text) {
  return " " + text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
}

function applyCorrections(transcript, corrections) {
  const edits = [];
  for (const item of corrections) {
    let start = transcript.indexOf(item.original);
    const overlaps = offset => edits.some(edit =>
      offset < edit.end && offset + item.original.length > edit.start);
    while (start >= 0 && overlaps(start)) {
      start = transcript.indexOf(item.original, start + 1);
    }
    if (start >= 0) edits.push({start, end: start + item.original.length, item});
  }
  edits.sort((first, second) => first.start - second.start);

  let cursor = 0;
  let correctedAnswer = "";
  for (const edit of edits) {
    correctedAnswer += transcript.slice(cursor, edit.start) + edit.item.correction;
    cursor = edit.end;
  }
  correctedAnswer += transcript.slice(cursor);
  return {correctedAnswer, corrections: edits.map(edit => edit.item)};
}

export function validateFeedback(value, {source, transcript}) {
  if (!matchesSchema(value, FEEDBACK_SCHEMA)) {
    throw new SpeakingError(502, "Gemini вернул неполный разбор. Попробуй ещё раз.");
  }
  value.transcript = transcript;
  if (source === "text" && (value.pronunciation.length || value.uncertainWords.length)) {
    throw new SpeakingError(502, "Сервис вернул анализ аудио для текстового ответа. Повтори проверку.");
  }
  if (["ready", "uncertain"].includes(value.status) && !value.transcript.trim()) {
    throw new SpeakingError(502, "Gemini не вернул слова из ответа. Попробуй другую запись.");
  }
  if (value.uncertainWords.some(word => !value.transcript.includes(word))
      || value.corrections.some(item => !value.transcript.includes(item.original))
      || value.pronunciation.some(item => !value.transcript.includes(item.word))) {
    throw new SpeakingError(502, "В разборе есть слова, которых нет в расшифровке. Повтори проверку.");
  }

  // Сомнительно распознанное слово не должно превращаться в ошибку ученика.
  const unclear = [...value.uncertainWords, "[unclear]"].map(normalizePhrase);
  const overlapsUnclear = text => {
    const phrase = normalizePhrase(text);
    return unclear.some(word => phrase.includes(word) || word.includes(phrase));
  };
  value.corrections = value.corrections.filter(item => !overlapsUnclear(item.original));
  value.pronunciation = value.pronunciation.filter(item => !overlapsUnclear(item.word));
  if (["no_speech", "other_language"].includes(value.status)) {
    value.corrections = [];
    value.pronunciation = [];
    value.correctedAnswer = "";
  } else {
    // Меняем только проверенные фрагменты. Остальная часть ответа сохраняется дословно.
    Object.assign(value, applyCorrections(value.transcript, value.corrections));
  }
  return value;
}

export function validateWave(audio) {
  const valid = audio.length > 44 && audio.length <= AUDIO_BYTES_LIMIT && audio.length % 2 === 0
    && audio.toString("ascii", 0, 4) === "RIFF" && audio.readUInt32LE(4) === audio.length - 8
    && audio.toString("ascii", 8, 16) === "WAVEfmt " && audio.readUInt32LE(16) === 16
    && audio.readUInt16LE(20) === 1 && audio.readUInt16LE(22) === 1
    && audio.readUInt32LE(24) === 16000 && audio.readUInt32LE(28) === 32000
    && audio.readUInt16LE(32) === 2 && audio.readUInt16LE(34) === 16
    && audio.toString("ascii", 36, 40) === "data" && audio.readUInt32LE(40) === audio.length - 44;
  if (!valid) throw new SpeakingError(400, "Нужна WAV-запись до 60 секунд. Запиши ответ на этой странице.");
  if (audio.length < 44 + 16000) throw new SpeakingError(422, "Запись слишком короткая. Скажи хотя бы одну фразу.");
  let energy = 0;
  for (let offset = 44; offset < audio.length; offset += 2) {
    energy += (audio.readInt16LE(offset) / 32768) ** 2;
  }
  if (Math.sqrt(energy / ((audio.length - 44) / 2)) < 0.0005) {
    throw new SpeakingError(422, "В записи почти не слышно звука. Проверь микрофон и запиши ответ ещё раз.");
  }
}

export async function analyzeSpeaking({
  key, model, transcriptionModel = "gemini-3.5-transcribe",
  scenario, mode, audio, transcript, signal, onTranscript
}) {
  const source = audio ? "audio" : "text";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(110000)]);
  const spoken = audio
    ? await transcribeSpeaking({key, model: transcriptionModel, audio, signal: deadline})
    : {transcript, words: []};
  deadline.throwIfAborted();
  if (audio) onTranscript?.(spoken);

  const task = {
    source, mode, level: scenario.level,
    task: scenario.prompt,
    goals: scenario.steps,
    practicePhrase: scenario.drill.text,
    transcript: spoken.transcript
  };
  const input = [{type: "text", text: JSON.stringify(task)}];
  if (audio) input.push({type: "audio", mime_type: "audio/wav", data: audio.toString("base64")});

  const interaction = await requestGemini({
    key,
    signal: deadline,
    payload: {
      model,
      system_instruction: SPEAKING_INSTRUCTIONS,
      input,
      generation_config: {max_output_tokens: 5000},
      response_format: {type: "text", mime_type: "application/json", schema: FEEDBACK_SCHEMA}
    }
  });
  let feedback;
  try {
    feedback = JSON.parse(textParts(interaction).map(part => part.text).join(""));
  } catch {
    throw new SpeakingError(502, "Не удалось прочитать разбор Gemini. Расшифровку можно проверить отдельно.");
  }
  return {
    source,
    ...validateFeedback(feedback, {source, transcript: spoken.transcript}),
    words: spoken.words
  };
}

export async function chatSpeaking({key, model, scenario, mode, transcript, history, signal}) {
  const interaction = await requestGemini({
    key, signal, timeout: 45000,
    payload: {
      model, system_instruction: CHAT_INSTRUCTIONS,
      input: [{type: "text", text: JSON.stringify({
        level: scenario.level, task: scenario.prompt, mode,
        practicePhrase: scenario.drill.text, history, message: transcript
      })}],
      generation_config: {max_output_tokens: 2200},
      response_format: {type: "text", mime_type: "application/json", schema: CHAT_SCHEMA}
    }
  });
  let reply;
  try {
    reply = JSON.parse(textParts(interaction).map(part => part.text).join(""));
  } catch {
    throw new SpeakingError(502, "Не удалось прочитать ответ. Сообщение сохранено, попробуй отправить его ещё раз.");
  }
  if (!matchesSchema(reply, CHAT_SCHEMA) || !reply.reply.trim()) {
    throw new SpeakingError(502, "Пришёл неполный ответ. Попробуй отправить сообщение ещё раз.");
  }
  return reply;
}
