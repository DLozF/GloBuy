import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemInstruction, buildRequestBody, parseArray, parseTranslations, usageTokens, translateTexts
} from '../src/translate.js';

test('system instruction bakes in the source-language glossary', () => {
  const sys = buildSystemInstruction('ko', 'en');
  assert.match(sys, /S급 → Grade S \(Like New\)/);
  assert.match(sys, /정품 → Authentic/);
  assert.match(sys, /Source language: ko\. Target language: en\./);
});

test("'auto' source language tells the model to detect it and omits the glossary", () => {
  const sys = buildSystemInstruction('auto', 'en');
  assert.match(sys, /detect it automatically/);
  assert.match(sys, /Target language: en\./);
  assert.doesNotMatch(sys, /Source language: auto\./); // no literal "auto" code
  assert.doesNotMatch(sys, /정품 → Authentic/);         // no source glossary when unknown
});

test('request body is OpenAI-shaped with JSON-object output', () => {
  const body = buildRequestBody(['a', 'b'], 'ko', 'en', undefined, 'deepseek-chat');
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.match(body.messages[1].content, /\["a","b"\]/);
});

// Builds an OpenAI-compatible chat-completions response.
function reply(payload, tokens = 42) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
      usage: { total_tokens: tokens }
    })
  };
}

test('translateTexts returns aligned translations and token usage', async () => {
  const { translations, tokens } = await translateTexts(['타비', 'S급'], {
    srcLang: 'ko', tgtLang: 'en', apiKey: 'x',
    fetchImpl: async () => reply({ translations: ['Tabi', 'Grade S (Like New)'] }, 99)
  });
  assert.deepEqual(translations, ['Tabi', 'Grade S (Like New)']);
  assert.equal(tokens, 99);
});

test('parseArray accepts a bare JSON array too', () => {
  const data = { choices: [{ message: { content: '["x","y"]' } }] };
  assert.deepEqual(parseArray(data), ['x', 'y']);
});

test('empty input short-circuits without calling the API', async () => {
  let called = false;
  const { translations } = await translateTexts([], {
    srcLang: 'ko', tgtLang: 'en', apiKey: 'x', fetchImpl: async () => { called = true; }
  });
  assert.deepEqual(translations, []);
  assert.equal(called, false);
});

// Echoes a transform of the input texts parsed out of the request body.
function echo(transform, tokens = 10) {
  const MARKER = 'Input: ';
  return async (url, init) => {
    const userContent = JSON.parse(init.body).messages[1].content;
    const inputs = JSON.parse(userContent.slice(userContent.indexOf(MARKER) + MARKER.length));
    return reply({ translations: transform(inputs) }, tokens);
  };
}

test('a misaligned batch is split in half and retried until it aligns', async () => {
  // Drops the first item when given >1 text; aligns correctly on single items.
  const fetchImpl = echo((t) => (t.length > 1 ? t.slice(1) : t.map((s) => s.toUpperCase())));
  const { translations } = await translateTexts(['a', 'b', 'c'], {
    srcLang: 'ko', tgtLang: 'en', apiKey: 'x', fetchImpl
  });
  assert.deepEqual(translations, ['A', 'B', 'C']);
});

test('split-batch token total includes the failed parent calls', async () => {
  // Drop-first forces ['a','b','c'] to misalign and split, and the ['b','c']
  // half to misalign and split again — 5 API calls total (2 of them failed
  // parents). Every call reports 10 tokens, so real provider cost is 5*10 = 50.
  // If a failed parent's tokens were dropped from the sum this would read 30.
  const fetchImpl = echo((t) => (t.length > 1 ? t.slice(1) : t.map((s) => s.toUpperCase())), 10);
  const { translations, tokens } = await translateTexts(['a', 'b', 'c'], {
    srcLang: 'ko', tgtLang: 'en', apiKey: 'x', fetchImpl
  });
  assert.deepEqual(translations, ['A', 'B', 'C']);
  assert.equal(tokens, 50);
});

test('a single item that still misaligns throws (caller falls back)', async () => {
  const fetchImpl = echo(() => []); // always returns zero items
  await assert.rejects(
    translateTexts(['only'], { srcLang: 'ko', tgtLang: 'en', apiKey: 'x', fetchImpl }),
    /expected 1 translations, got 0/
  );
});

test('parseTranslations throws on length mismatch (so caller can fall back)', () => {
  const data = { choices: [{ message: { content: '["only one"]' } }] };
  assert.throws(() => parseTranslations(data, 2), /expected 2 translations, got 1/);
});

test('parseArray throws on non-JSON model output', () => {
  const data = { choices: [{ message: { content: 'sorry, I cannot' } }] };
  assert.throws(() => parseArray(data), /not valid JSON/);
});

test('translateTexts surfaces non-OK HTTP as an error', async () => {
  await assert.rejects(
    translateTexts(['x'], {
      srcLang: 'ko', tgtLang: 'en', apiKey: 'x', retries: 0,
      fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' })
    }),
    /HTTP 429/
  );
});

test('translateTexts retries a transient 429, then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, text: async () => 'rate' };
    return reply({ translations: ['ok'] }, 5);
  };
  const { translations } = await translateTexts(['x'], {
    srcLang: 'ko', tgtLang: 'en', apiKey: 'x', fetchImpl, retries: 2, retryDelayMs: 1
  });
  assert.deepEqual(translations, ['ok']);
  assert.equal(calls, 2);
});

test('non-retryable status (400) throws immediately', async () => {
  let calls = 0;
  await assert.rejects(
    translateTexts(['x'], {
      srcLang: 'ko', tgtLang: 'en', apiKey: 'x', retries: 2, retryDelayMs: 1,
      fetchImpl: async () => { calls++; return { ok: false, status: 400, text: async () => 'bad' }; }
    }),
    /HTTP 400/
  );
  assert.equal(calls, 1);
});

test('translateTexts requires an API key', async () => {
  await assert.rejects(
    translateTexts(['x'], { srcLang: 'ko', tgtLang: 'en', fetchImpl: async () => ({}) }),
    /missing LLM_API_KEY/
  );
});

test('usageTokens defaults to 0 when absent', () => {
  assert.equal(usageTokens({}), 0);
  assert.equal(usageTokens({ usage: { total_tokens: 7 } }), 7);
});
