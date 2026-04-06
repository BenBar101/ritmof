import { test, expect } from '@playwright/test';

// Offline-first: no Gemini route mock — the app does not call generativelanguage.googleapis.com in this flow.

test('FULL LIFECYCLE (real persistence + sync + attack)', async ({ page }) => {
  const prohibited429Patterns = [
    /Gemini 429/i,
    /RESOURCE_EXHAUSTED/i,
    /RATE_LIMIT_EXCEEDED/i,
    /Daily (Gemini|AI) quota used up/i,
    /(Gemini|AI) RPM limit hit/i,
    /(Gemini|AI) rate limit hit/i,
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

  // ---------- 1. FIRST LAUNCH ----------
  await page.goto('/');

  await expect(
    page.locator('[data-testid="skip-dropbox"], [data-testid="skip-calendar"], [data-testid="name"]'),
  ).toBeVisible({ timeout: 15000 });

  // ---------- 2. ONBOARDING ----------
  const skipDropbox = page.locator('[data-testid="skip-dropbox"]');
  if (await skipDropbox.isVisible()) await skipDropbox.click();

  const skipCalendar = page.locator('[data-testid="skip-calendar"]');
  if (await skipCalendar.isVisible()) await skipCalendar.click();

  await page.fill('[data-testid="name"]', 'Ben');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="major"]', 'Physics');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="interests"]', 'Chess');
  await page.click('[data-testid="start"]');

  await page.fill('[data-testid="goal"]', 'Dominate semester');
  await page.click('[data-testid="start"]');

  // ---------- 3. APP LOADED ----------
  await expect(page.locator('[data-testid="xp"]')).toBeVisible({ timeout: 10000 });
  // Offline-first: four bottom-nav tabs only (no Chat tab).
  await expect(page.locator('[data-testid="nav-home"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-habits"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-tasks"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-profile"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-chat"]')).toHaveCount(0);

  // ---------- 4. EARN XP ----------
  await page.click('[data-testid="nav-tasks"]');
  await page.fill('[data-testid="add-task-input"]', 'E2E test task');
  await page.click('[data-testid="add-task"]');
  await page.click('[data-testid="complete-task"]');

  const xpBefore = await page.locator('[data-testid="xp"]').textContent();

  // ---------- 5. RELOAD (IndexedDB test) ----------
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

  // ---------- 11. SMOKE: PROFILE → GACHA (static chronicle engine, no network) ----------
  await page.click('[data-testid="nav-profile"]');
  await page.getByRole('button', { name: 'GACHA' }).click();
  await expect(page.locator('text=CHRONICLE ENGINE')).toBeVisible({ timeout: 10000 });

  expect(observedConsoleOrPageErrors).toEqual([]);
});
