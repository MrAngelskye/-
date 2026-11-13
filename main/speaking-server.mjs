import {createServer} from "node:http";
import {readFile, realpath} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {loadEnvFile} from "node:process";
import scenarios from "./Semi_education/speaking/speaking-scenarios.js";
import {analyzeSpeaking, chatSpeaking, AUDIO_BYTES_LIMIT, AUDIO_SECONDS_LIMIT, SpeakingError, validateWave} from "./speaking-ai.mjs";

const root = await realpath(fileURLToPath(new URL(".", import.meta.url)));
try {
  loadEnvFile(resolve(root, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw new Error("Не удалось прочитать настройки .env.");
}

const key = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
const transcriptionModel = process.env.GEMINI_TRANSCRIPTION_MODEL?.trim() || "gemini-3.5-transcribe";
const port = Number(process.env.STACKPHRASE_PORT || 5207);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Проверь STACKPHRASE_PORT.");
if (!/^[a-z0-9._-]+$/i.test(model)) throw new Error("Проверь имя GEMINI_MODEL.");
if (!/^[a-z0-9._-]+$/i.test(transcriptionModel)) throw new Error("Проверь имя GEMINI_TRANSCRIPTION_MODEL.");
const configured = Boolean(key && /^[\x21-\x7e]+$/.test(key));
const allowedHosts = new Set(["127.0.0.1:" + port, "localhost:" + port]);
const requestTimes = [];
let analyzing = false;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function event(response, value) {
  if (!response.headersSent) {
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
  }
  response.write(JSON.stringify(value) + "\n");
}

async function readBody(request, limit) {
  if (Number(request.headers["content-length"]) > limit) {
    request.resume();
    throw new SpeakingError(413, "Ответ слишком большой. Сократи текст или запись.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new SpeakingError(413, "Ответ слишком большой. Сократи текст или запись.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function context(scenarioId, mode) {
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario || !["answer", "phrase"].includes(mode)) {
    throw new SpeakingError(400, "Выбери задание и режим ответа на странице Speaking.");
  }
  return {scenario, mode};
}

async function analyze(request, response, origin, source) {
  if (request.method !== "POST" || request.headers.origin !== origin) {
    throw new SpeakingError(403, "Открой Speaking через сервер проекта.");
  }
  if (!configured) throw new SpeakingError(503, "Gemini пока не подключён. Добавь ключ API в настройки сервера.");
  if (analyzing) throw new SpeakingError(409, "Другой ответ ещё разбирается. Дождись результата.");
  const now = Date.now();
  while (requestTimes.length && now - requestTimes[0] > 60000) requestTimes.shift();
  if (requestTimes.length >= 6) throw new SpeakingError(429, "Слишком много разборов подряд. Повтори через минуту.");

  const controller = new AbortController();
  const cancel = () => controller.abort();
  response.on("close", cancel);
  analyzing = true;
  try {
    const contentType = request.headers["content-type"]?.split(";")[0].trim();
    let input;
    if (source === "audio") {
      if (contentType !== "audio/wav") throw new SpeakingError(415, "Нужна запись в формате WAV.");
      input = context(request.headers["x-speaking-scenario"], request.headers["x-speaking-mode"]);
      input.audio = await readBody(request, AUDIO_BYTES_LIMIT);
      validateWave(input.audio);
    } else {
      if (contentType !== "application/json") throw new SpeakingError(415, "Не удалось прочитать текст ответа.");
      let body;
      try {
        body = JSON.parse((await readBody(request, source === "chat" ? 96 * 1024 : 24 * 1024)).toString("utf8"));
      } catch (error) {
        if (error instanceof SpeakingError) throw error;
        throw new SpeakingError(400, "Не удалось прочитать текст ответа.");
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new SpeakingError(400, "Не удалось прочитать текст ответа.");
      }
      input = context(body.scenarioId, body.mode);
      if (typeof body.transcript !== "string" || !body.transcript.trim() || body.transcript.length > 4000) {
        throw new SpeakingError(400, "Введи ответ длиной до 4000 символов.");
      }
      input.transcript = body.transcript;
      if (source === "chat") {
        const history = body.history ?? [];
        if (!Array.isArray(history) || history.length > 12 || history.some(message =>
          !message || !["user", "assistant"].includes(message.role)
          || typeof message.text !== "string" || message.text.length > 4000)) {
          throw new SpeakingError(400, "Переписка слишком длинная. Начни новый диалог.");
        }
        if (history.reduce((length, message) => length + message.text.length, 0) > 16000) {
          throw new SpeakingError(400, "Переписка слишком длинная. Начни новый диалог.");
        }
        input.history = history.map(({role, text}) => ({role, text}));
      }
    }
    if (controller.signal.aborted) return;
    requestTimes.push(Date.now());
    if (source === "chat") {
      const result = await chatSpeaking({...input, key, model, signal: controller.signal});
      if (!controller.signal.aborted) json(response, 200, result);
      return;
    }
    const streamed = source === "audio" && request.headers.accept?.includes("application/x-ndjson");
    const result = await analyzeSpeaking({
      ...input, key, model, transcriptionModel, signal: controller.signal,
      onTranscript: data => {
        if (streamed && !controller.signal.aborted) event(response, {type: "transcript", ...data});
      }
    });
    if (!controller.signal.aborted) {
      if (streamed) {
        event(response, {type: "result", result});
        response.end();
      } else {
        json(response, 200, result);
      }
    }
  } finally {
    analyzing = false;
    response.off("close", cancel);
  }
}

const server = createServer({maxHeaderSize: 16 * 1024, requestTimeout: 30000}, async (request, response) => {
  try {
    const requestHost = request.headers.host;
    if (!allowedHosts.has(requestHost) || !request.url?.startsWith("/")) return response.writeHead(403).end();
    const origin = "http://" + requestHost;
    const url = new URL(request.url, origin);
    if (url.origin !== origin) return response.writeHead(403).end();

    if (url.pathname === "/speaking-api/status" && request.method === "GET") {
      return json(response, 200, {configured, provider: "Gemini", maxSeconds: AUDIO_SECONDS_LIMIT});
    }
    if (url.pathname === "/speaking-api/analyze") return await analyze(request, response, origin, "audio");
    if (url.pathname === "/speaking-api/review") return await analyze(request, response, origin, "text");
    if (url.pathname === "/speaking-api/chat") return await analyze(request, response, origin, "chat");
    if (url.pathname.startsWith("/speaking-api")) return json(response, 404, {error: "Такой способ разбора больше не используется."});
    if (request.method !== "GET") return response.writeHead(405).end();

    const path = url.pathname === "/" ? "/home.html" : decodeURIComponent(url.pathname);
    const contentType = types[extname(path).toLowerCase()];
    if (!contentType || !/^\/[a-z0-9_./ -]+$/i.test(path) || path.split("/").some(part => part.startsWith("."))) {
      return response.writeHead(404).end();
    }
    const file = await realpath(resolve(root, "." + path));
    if (!file.startsWith(root + sep)) return response.writeHead(404).end();
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    if (request.url?.startsWith("/speaking-api")) {
      const status = error instanceof SpeakingError ? error.status : 502;
      const message = error instanceof SpeakingError ? error.message : "Не удалось завершить разбор. Попробуй ещё раз.";
      if (response.headersSent) {
        event(response, {type: "error", error: message});
        return response.end();
      }
      return json(response, status, {error: message});
    }
    response.writeHead(error.code === "ENOENT" ? 404 : 400).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Speaking: http://127.0.0.1:" + port + "/Semi_education/speaking/speaking.html");
  console.log(configured ? "Gemini подключён. Модель: " + model : "Для разбора Gemini добавь GEMINI_API_KEY в .env рядом с сервером.");
});
