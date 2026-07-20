import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';

const artifact = path.resolve('metabolic_depletion_forecaster.html').replace(/\\/g, '/');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const externalRequests = [];

page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', (request) => {
  if (!/^(file|data|blob):/i.test(request.url())) externalRequests.push(request.url());
});

await page.goto(`file:///${artifact}`);
await page.waitForFunction(() => document.querySelector('#safeCard')?.dataset.resultState === 'current', null, { timeout: 30000 });

assert.match(await page.locator('#safeCard').innerText(), /Nominal limiter/i, 'Findings did not render.');
assert.ok(await page.locator('#timeline').evaluate((canvas) => canvas.width > 0 && canvas.height > 0), 'Timeline did not render.');
await page.locator('[data-chart-view="nutrients"]').click();
assert.ok(await page.locator('[data-chart-view="nutrients"]').evaluate((button) => button.classList.contains('active')), 'Timeline view switch did not work.');
assert.equal(await page.locator('meta[name="artifact-manifest-sha256"]').count(), 0, 'Manifest metadata remains in the tool.');
assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);
assert.deepEqual(externalRequests, [], `Unexpected external requests: ${externalRequests.join(' | ')}`);

await browser.close();
console.log('Standalone HTML smoke check passed.');
