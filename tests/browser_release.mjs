import path from 'node:path';
import { chromium } from 'playwright';

const artifactPath = path.resolve('metabolic_depletion_forecaster.html').replace(/\\/g, '/');
const url = `file:///${artifactPath}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => {
  consoleErrors.push(String(error));
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await page.goto(url);
await page.waitForSelector('#safeTime');

assert((await page.locator('body').getAttribute('data-release')) === 'v18-transport-20260715', 'stale release on browser load');
assert((await page.locator('#safeTime').textContent()).trim().length > 0, 'default calculation missing');

await page.selectOption('#halfTimeMode', 'measured_effective', { force: true });
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForTimeout(100);
assert((await page.locator('#gasCards').textContent()).includes('Half-time interpretation'), 'measured-effective mode did not render diagnostics');
await page.click('[data-tab=\"diagnostics\"]');
await page.click('#runScenariosBtn');
await page.waitForTimeout(100);
assert((await page.locator('#scenarioTable').textContent()).includes('nominal'), 'deterministic scenario table did not populate');

await page.selectOption('#atmMode', 'incubator', { force: true });
await page.selectOption('#pHBoundaryMode', 'closed_headspace_mass_balance', { force: true });
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForTimeout(100);
assert((await page.locator('#safeTime').textContent()).includes('Invalid'), 'incompatible carbon/gas mode should block calculation');

await page.selectOption('#atmMode', 'closed', { force: true });
await page.selectOption('#headspaceGas', 'nitrogen', { force: true });
await page.selectOption('#o2ThresholdMode', 'selected_pct', { force: true });
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForTimeout(100);
assert((await page.locator('#warnings').textContent()).includes('selected-gas O₂ thresholds are invalid'), 'anoxic selected-gas threshold warning missing');

const renderedText = [
  await page.locator('#safeTime').textContent(),
  await page.locator('#metrics').textContent(),
  await page.locator('#gasCards').textContent(),
  await page.locator('#warnings').textContent(),
  await page.locator('#logTable').textContent(),
].join(' ');
assert(!/NaN|Infinity/.test(renderedText), 'rendered output contains nonfinite values');
assert(consoleErrors.length === 0, `console errors detected: ${consoleErrors.join(' | ')}`);

await browser.close();
console.log('Browser smoke test passed.');
