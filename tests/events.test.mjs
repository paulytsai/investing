import test from "node:test";
import assert from "node:assert/strict";
import { isBotUa, botName, isTestUser } from "../netlify/lib/events.mjs";

test("crawlers and scripted clients are recognised, browsers are not", () => {
  assert.equal(isBotUa("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"), true);
  assert.equal(isBotUa("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36"), true);
  assert.equal(isBotUa("curl/8.5.0"), true);
  assert.equal(isBotUa(""), true);
  assert.equal(isBotUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), false);
  assert.equal(isBotUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), false);
});

test("bot names are short slugs", () => {
  assert.equal(botName("Mozilla/5.0 (compatible; ClaudeBot/1.0)"), "claudebot");
  assert.equal(botName("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), "googlebot");
  assert.equal(botName("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0"), "headlesschrome");
  assert.equal(botName(""), "no-agent");
});

test("throwaway test accounts are recognised", () => {
  assert.equal(isTestUser("qtvck1465"), true);
  assert.equal(isTestUser("stripetest1791488637"), true);
  assert.equal(isTestUser("Diamond"), false);
});
