"use strict";

const englishTranslation = (() => {
  const maxEntryLength = 4000;
  const maxRequestBytes = 500;
  const encoder = new TextEncoder();

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function splitText(text) {
    const chunks = [];
    let remaining = text;
    while (encoder.encode(remaining).length > maxRequestBytes) {
      let bytes = 0;
      let end = 0;
      for (const character of remaining) {
        bytes += encoder.encode(character).length;
        if (bytes > maxRequestBytes) break;
        end += character.length;
      }
      const prefix = remaining.slice(0, end);
      const lastSentence = [...prefix.matchAll(/[.!?]["”’)]?(?=\s)/g)].at(-1);
      const boundary = lastSentence
        ? lastSentence.index + lastSentence[0].length
        : prefix.lastIndexOf(" ");
      if (boundary > 0) end = boundary;
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function decodeTranslation(value) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return cleanText(decoder.value);
  }

  function matchesLanguage(text, language) {
    return language === "en"
      ? /[a-z]/i.test(text) && !/[а-яё]/i.test(text)
      : /[а-яё]/i.test(text);
  }

  function chooseTranslation(data, text, language) {
    const primary = typeof data.responseData?.translatedText === "string"
      ? decodeTranslation(data.responseData.translatedText) : "";
    if (matchesLanguage(primary, language)) return primary;

    const alternatives = Array.isArray(data.matches)
      ? data.matches
        .filter(match => typeof match?.translation === "string" && Number(match.match) >= 0.7)
        .map(match => decodeTranslation(match.translation))
        .filter(value => matchesLanguage(value, language))
      : [];
    if (!/\s/.test(text)) {
      const singleWord = alternatives.find(value => !/\s/.test(value));
      if (singleWord) return singleWord;
    }
    return alternatives[0] || "";
  }

  async function translate(text, source, target, signal) {
    const translated = [];
    for (const chunk of splitText(cleanText(text))) {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", chunk);
      url.searchParams.set("langpair", source + "|" + target);
      const response = await fetch(url, {signal, credentials: "omit", referrerPolicy: "no-referrer"});
      if (response.status === 429) throw new Error("quota");
      if (!response.ok) throw new Error("Translation service unavailable");

      const data = await response.json();
      if (data.quotaFinished || Number(data.responseStatus) === 429) throw new Error("quota");
      if (Number(data.responseStatus) !== 200) throw new Error("Translation service error");
      const result = chooseTranslation(data, chunk, target);
      if (!result) throw new Error("No translation");
      translated.push(result);
    }
    return translated.join(" ");
  }

  return {cleanText, maxEntryLength, translate};
})();
