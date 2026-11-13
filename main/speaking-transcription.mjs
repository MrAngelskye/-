import {requestGemini, SpeakingError, textParts} from "./speaking-gemini.mjs";

function seconds(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,9})?s$/.test(value)) return NaN;
  return Number(value.slice(0, -1));
}

export function readTranscription(interaction, duration) {
  const parts = textParts(interaction);
  const transcript = parts.map(part => part.text).join("");
  if (!transcript.trim()) throw new SpeakingError(422, "Речь не удалось расслышать. Проверь микрофон и попробуй ещё раз.");
  if (transcript.length > 4000) throw new SpeakingError(422, "В записи слишком много текста. Запиши более короткий ответ.");

  const words = [];
  let textOffset = 0;
  for (const part of parts) {
    for (const note of part.annotations ?? []) {
      if (note.type !== "word_info") continue;
      const startTime = seconds(note.start_offset);
      const endTime = seconds(note.end_offset);
      const startIndex = note.start_index;
      const endIndex = note.end_index;
      const valid = Number.isInteger(startIndex) && Number.isInteger(endIndex)
        && startIndex >= 0 && endIndex > startIndex && endIndex <= part.text.length
        && part.text.slice(startIndex, endIndex) === note.text
        && startTime >= 0 && endTime > startTime && endTime <= duration + 0.05;
      if (!valid || words.length >= 600) continue;
      words.push({
        text: note.text,
        startIndex: textOffset + startIndex,
        endIndex: textOffset + endIndex,
        startTime,
        endTime: Math.min(endTime, duration)
      });
    }
    textOffset += part.text.length;
  }
  words.sort((first, second) => first.startIndex - second.startIndex);
  let previousEnd = 0;
  const ordered = words.filter(word => {
    if (word.startIndex < previousEnd) return false;
    previousEnd = word.endIndex;
    return true;
  });
  return {transcript, words: ordered};
}

export async function transcribeSpeaking({key, model, audio, signal}) {
  const interaction = await requestGemini({
    key,
    signal,
    timeout: 30000,
    payload: {
      model,
      input: [{type: "audio", mime_type: "audio/wav", data: audio.toString("base64")}],
      generation_config: {
        transcription_config: {
          language_codes: ["en-US"],
          mode: {type: "verbatim", timestamp_granularities: ["word"]}
        }
      }
    }
  });
  return readTranscription(interaction, (audio.length - 44) / 32000);
}
