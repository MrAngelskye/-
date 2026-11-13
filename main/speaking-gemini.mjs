import {setTimeout as delay} from "node:timers/promises";

const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const responseLimit = 128 * 1024;

export class SpeakingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function apiError(status) {
  if (status === 401 || status === 403) {
    return new SpeakingError(503, "Gemini отклонил доступ. Проверь ключ API и доступ к модели на сервере.");
  }
  if (status === 404) return new SpeakingError(503, "Модель Gemini недоступна. Проверь настройки моделей на сервере.");
  if (status === 429) return new SpeakingError(429, "Достигнут лимит Gemini. Подожди немного и повтори разбор.");
  if (status === 503) return new SpeakingError(503, "Gemini сейчас перегружен. Повтори разбор чуть позже.");
  if (status === 400) return new SpeakingError(502, "Gemini не принял запрос. Проверь настройки модели на сервере.");
  return new SpeakingError(502, "Gemini временно не отвечает. Попробуй ещё раз позже.");
}

export function textParts(interaction) {
  return (interaction.steps ?? [])
    .filter(step => step.type === "model_output")
    .flatMap(step => step.content ?? [])
    .filter(part => part.type === "text" && typeof part.text === "string");
}

export async function requestGemini({key, payload, signal, timeout = 70000}) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  try {
    // Повторяем только явную перегрузку. Отмена и остальные ошибки не запускают новый запрос.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      deadline.throwIfAborted();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
          "Api-Revision": "2026-05-20"
        },
        body: JSON.stringify({...payload, store: false}),
        signal: deadline
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 503 && attempt === 0) {
          await delay(800, undefined, {signal: deadline});
          continue;
        }
        throw apiError(response.status);
      }

      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > responseLimit) throw new SpeakingError(502, "Gemini вернул слишком большой ответ.");
        chunks.push(chunk);
      }
      const interaction = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (interaction.status !== "completed" || !Array.isArray(interaction.steps)) {
        throw new SpeakingError(502, "Gemini не завершил обработку. Попробуй ещё раз.");
      }
      return interaction;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    if (deadline.aborted) throw new SpeakingError(504, "Gemini не успел обработать ответ. Попробуй более короткую запись.");
    if (error instanceof SpeakingError) throw error;
    if (error instanceof SyntaxError) throw new SpeakingError(502, "Не удалось прочитать ответ Gemini. Повтори разбор.");
    throw new SpeakingError(502, "Не удалось связаться с Gemini. Проверь интернет и повтори попытку.");
  }
}
