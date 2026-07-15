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
assert(((await page.locator('meta[name="artifact-commit"]').getAttribute('content')) || '').length === 40, 'artifact commit metadata missing');
assert(((await page.locator('meta[name="artifact-manifest-sha256"]').getAttribute('content')) || '').length === 64, 'artifact manifest hash metadata missing');
assert((await page.locator('#pHModel').inputValue()) === 'carbonate_alkalinity', 'default pH model should be carbonate/alkalinity');
assert((await page.locator('#safeTime').textContent()).trim().length > 0, 'default calculation missing');

await page.selectOption('#halfTimeMode', 'measured_effective', { force: true });
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForFunction(() => (document.getElementById('gasCards')?.textContent || '').includes('Half-time interpretation'), null, { timeout: 5000 });
assert((await page.locator('#gasCards').textContent()).includes('Half-time interpretation'), 'measured-effective mode did not render diagnostics');
await page.click('[data-tab=\"diagnostics\"]');
await page.click('#runScenariosBtn');
await page.waitForFunction(() => (document.getElementById('scenarioTable')?.textContent || '').includes('nominal'), null, { timeout: 5000 });
assert((await page.locator('#scenarioTable').textContent()).includes('nominal'), 'deterministic scenario table did not populate');

await page.selectOption('#atmMode', 'incubator', { force: true });
await page.selectOption('#pHBoundaryMode', 'closed_headspace_mass_balance', { force: true });
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForFunction(() => (document.getElementById('safeTime')?.textContent || '').includes('Invalid'), null, { timeout: 5000 });
assert((await page.locator('#safeTime').textContent()).includes('Invalid'), 'incompatible carbon/gas mode should block calculation');

await page.selectOption('#atmMode', 'closed', { force: true });
await page.selectOption('#headspaceGas', 'nitrogen', { force: true });
await page.selectOption('#o2ThresholdMode', 'selected_pct', { force: true });
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForFunction(() => (document.getElementById('warnings')?.textContent || '').includes('selected-gas O₂ thresholds are invalid'), null, { timeout: 5000 });
assert((await page.locator('#warnings').textContent()).includes('selected-gas O₂ thresholds are invalid'), 'anoxic selected-gas threshold warning missing');

await page.selectOption('#headspaceGas', 'co2air', { force: true });
await page.selectOption('#o2ThresholdMode', 'absolute_uM', { force: true });
await page.evaluate(() => {
  document.getElementById('maxDays').value = '60';
  document.getElementById('gasHalf').value = '0.05';
  document.getElementById('oilHalf').value = '0.05';
  document.getElementById('dropHalf').value = '0.05';
  document.getElementById('lambda').value = '20';
  document.getElementById('targetCells').value = '50';
});
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForFunction(() => document.getElementById('cancelBtn') && !document.getElementById('cancelBtn').disabled, null, { timeout: 5000 });
assert((await page.locator('#cancelBtn').isDisabled()) === false, 'cancel button should enable during worker run');
await page.evaluate(() => document.getElementById('cancelBtn').click());
await page.waitForFunction(() => (document.getElementById('lastRun')?.textContent || '').includes('cancelled'), null, { timeout: 5000 });
assert((await page.locator('#lastRun').textContent()).includes('cancelled'), 'worker cancellation status missing');

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
