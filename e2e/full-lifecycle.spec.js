/* global process */
import { test, expect } from '@playwright/test';

test('FULL LIFECYCLE (real persistence + sync + attack)', async ({ page }) => {
  // Onboarding validates the key format locally (no network ping).
  // Gemini endpoint is mocked below, so this is only for syntactic validity.
  const GEMINI_TEST_API_KEY = process.env.GEMINI_TEST_API_KEY || `AIza${'A'.repeat(32)}`;

  const prohibited429Patterns = [
    /Gemini 429/i,
    /RESOURCE_EXHAUSTED/i,
    /RATE_LIMIT_EXCEEDED/i,
    /Daily Gemini quota used up/i,
    /Gemini RPM limit hit/i,
    /Gemini rate limit hit/i,
    /Rate cap reached/i,
    /Invalid API key/i,
    /No Gemini API key configured/i,
    /No API key\. Configure in settings\./i,
    /CLIENT_RATE_LIMITED/i,
    /\b429\b/i,
  ];

  const observedConsoleOrPageErrors = [];
  page.on('console', (msg) => {
    const txt = msg.text();
    if (prohibited429Patterns.some((re) => re.test(txt))) {
      observedConsoleOrPageErrors.push(`[console:${msg.type()}] ${txt}`);
    }
  });
  page.on('pageerror', (err) => {
    const txt = String(err?.message ?? err);
    if (prohibited429Patterns.some((re) => re.test(txt))) {
      observedConsoleOrPageErrors.push(`[pageerror] ${txt}`);
    }
  });

  // Mock Gemini API so this E2E is deterministic and does not depend on
  // your current Gemini quota / RPM settings.
  await page.route(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    async (route) => {
      const req = route.request();

      let postData = {};
      try { postData = req.postDataJSON(); } catch { /* ignore */ }

      const contents = Array.isArray(postData?.contents) ? postData.contents : [];
      const systemInstruction = postData?.systemInstruction?.parts?.[0]?.text ?? '';
      const userText = contents?.[0]?.parts?.[0]?.text ?? '';

      const mkGeminiResponse = (text) => ({
        candidates: [
          {
            finishReason: 'STOP',
            content: { role: 'model', parts: [{ text }] },
          },
        ],
        usageMetadata: {
          totalTokenCount: 123,
          promptTokenCount: 80,
          candidatesTokenCount: 43,
        },
      });

      // Identify call intent by prompt fragments.
      // - Missions: contains "Reply JSON array only"
      // - Quote: contains "Generate ONE real"
      // - Dynamic costs: contains "adjusting economy parameters"
      // - Chat: expects JSON { message, commands: [] }
      let text;
      if (
        userText.includes('Reply JSON array only') ||
        systemInstruction.includes('Reply JSON array only')
      ) {
        const items = Array.from({ length: 8 }).map((_, i) => ({
          id: `dummy_${i}`,
          desc: `Mock mission ${i + 1}`,
          type: ['habits', 'session', 'task', 'streak'][i % 4],
          target: 1 + (i % 3),
          xp: [25, 50, 75, 100][i % 4],
        }));
        text = JSON.stringify(items);
      } else if (
        userText.includes('Generate ONE real') ||
        systemInstruction.includes('Generate ONE real')
      ) {
        text = JSON.stringify({
          quote: 'Mock quote for E2E. Focus, execute, repeat.',
          author: 'E2E Test Bot',
          source: '',
        });
      } else if (
        userText.includes('adjusting economy parameters') ||
        systemInstruction.includes('adjusting economy parameters')
      ) {
        text = JSON.stringify({
          xpPerLevel: 1000,
          gachaCost: 100,
          streakShieldCost: 200,
        });
      } else {
        text = JSON.stringify({
          message: 'Mock Gemini response (success).',
          commands: [],
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mkGeminiResponse(text)),
      });
    },
  );

  // ---------- 1. FIRST LAUNCH ----------
  await page.goto('/');

  await expect(
    page.locator('[data-testid="skip-dropbox"], [data-testid="api-key"], [data-testid="name"]'),
  ).toBeVisible({ timeout: 15000 });

  // ---------- 2. ONBOARDING ----------
  const skipDropbox = page.locator('[data-testid="skip-dropbox"]');
  if (await skipDropbox.isVisible()) await skipDropbox.click();

  const apiKeyInput = page.locator('[data-testid="api-key"]');
  await expect(apiKeyInput).toBeVisible({ timeout: 5000 });
  await apiKeyInput.fill(GEMINI_TEST_API_KEY);
  await page.locator('[data-testid="save-gemini"]').click();

  const skipCalendar = page.locator('[data-testid="skip-calendar"]');
  if (await skipCalendar.isVisible()) await skipCalendar.click();

  await page.fill('[data-testid="name"]', 'Ben');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="major"]', 'Physics');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="books"]', 'Feynman');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="interests"]', 'Chess');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="goal"]', 'Dominate semester');
  await page.click('[data-testid="start"]');

  // ---------- 3. APP LOADED ----------
  await expect(page.locator('[data-testid="xp"]')).toBeVisible({ timeout: 10000 });

  // ---------- 4. EARN XP ----------
  await page.click('[data-testid="nav-tasks"]');
  await page.fill('[data-testid="add-task-input"]', 'E2E test task');
  await page.click('[data-testid="add-task"]');
  await page.click('[data-testid="complete-task"]');

  const xpBefore = await page.locator('[data-testid="xp"]').textContent();

  // ---------- 5. RELOAD (IndexedDB test) ----------
  // TinyBase persister saves to IndexedDB asynchronously. Wait for flush before reload.
  await page.waitForTimeout(500);
  await page.reload();

  await expect(page.locator('[data-testid="xp"]')).toBeVisible({ timeout: 10000 });
  const xpAfter = await page.locator('[data-testid="xp"]').textContent();
  expect(xpAfter).toBe(xpBefore);

  // ---------- 6. VERIFY STATE DIRECTLY ----------
  const state = await page.evaluate(() => {
    return window.__RITMOL_TEST__?.getState?.() ?? null;
  });
  expect(state).toBeTruthy();

  // ---------- 7. VALID SYNC ----------
  await page.evaluate(() => {
    window.__RITMOL_TEST__.injectSync = () => ({ _schemaVersion: 1, jv_xp: 999 });
  });

  await page.click('[data-testid="pull"]');
  // XP is rendered with a unit suffix (e.g. "999 XP"); match the numeric portion.
  await expect(page.locator('[data-testid="xp"]')).toHaveText(/999/, { timeout: 15000 });

  // ---------- 8. MALICIOUS SYNC ----------
  await page.evaluate(() => {
    window.__RITMOL_TEST__.injectSync = () => ({ data: { __proto__: { hacked: true } } });
  });

  await page.click('[data-testid="pull"]');

  // ---------- 9. VERIFY APP NOT CORRUPTED ----------
  await expect(page.locator('[data-testid="xp"]')).toBeVisible();
  const polluted = await page.evaluate(() => ({}).hacked);
  expect(polluted).toBeUndefined();

  // ---------- 10. LARGE PAYLOAD ATTACK ----------
  await page.evaluate(() => {
    window.__RITMOL_TEST__.injectSync = () => ({
      _schemaVersion: 1,
      data: { text: 'a'.repeat(11 * 1024 * 1024) },
    });
  });

  await page.click('[data-testid="pull"]');
  await expect(page.locator('[data-testid="xp"]')).toBeVisible();

  // ---------- 11. ASSERT NO 429 / API-KEY ERRORS ----------
  // Trigger one interactive Gemini call so Gemini 429/invalid-key issues
  // would surface deterministically in the UI (but endpoint is mocked).
  await page.click('[data-testid="nav-chat"]');

  const gotIt = page.locator('button', { hasText: 'GOT IT' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

  const chatTextarea = page.locator('textarea');
  await expect(chatTextarea).toBeVisible({ timeout: 10000 });

  await chatTextarea.fill('E2E: rate-limit and API-key check');
  await chatTextarea.press('Enter');

  // Give the UI a moment to react (success, lock state, or error).
  await page.waitForTimeout(8000);

  const prohibitedUiStrings = [
    'Gemini 429',
    'RESOURCE_EXHAUSTED',
    'RATE_LIMIT_EXCEEDED',
    'Daily Gemini quota used up',
    'Gemini RPM limit hit',
    'Gemini rate limit hit',
    'Rate cap reached',
    'AI LOCKED',
    'Invalid API key',
    'No Gemini API key configured',
    'No API key. Configure in settings.',
  ];

  for (const s of prohibitedUiStrings) {
    await expect(page.locator(`text=${s}`)).toHaveCount(0);
  }

  expect(observedConsoleOrPageErrors).toEqual([]);
});

