import path from 'node:path';
import { chromium } from 'playwright';

const RELEASE = 'v18-transport-20260715';
const STATE_KEY = 'metabolic-forecaster-v18-transport-20260715';
const LEGACY_STATE_KEY = 'metabolic-forecaster-v17-audit-20260715';
const artifactPath = path.resolve('metabolic_depletion_forecaster.html').replace(/\\/g, '/');
const url = `file:///${artifactPath}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];

await page.addInitScript(({ stateKey }) => {
  window.__downloads = [];
  window.__copiedText = null;
  window.__lastAnchorDownload = null;
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const href = createObjectURL(blob);
    const entry = { name: null, href, type: blob.type, size: blob.size, text: null };
    window.__downloads.push(entry);
    if (typeof blob.text === 'function') {
      blob.text().then((text) => {
        entry.text = text;
      }).catch(() => {});
    }
    return href;
  };
  URL.revokeObjectURL = (href) => {
    try { revokeObjectURL(href); } catch (_) {}
  };
  HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
    window.__lastAnchorDownload = { download: this.download || null, href: this.href || null };
    const match = window.__downloads.find((entry) => entry.href === this.href && !entry.name);
    if (match) match.name = this.download || null;
  };
  if (!navigator.clipboard) navigator.clipboard = {};
  navigator.clipboard.writeText = async (text) => {
    window.__copiedText = text;
  };
  window.__testStateKey = stateKey;
}, { stateKey: STATE_KEY });

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => {
  consoleErrors.push(String(error));
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForIdle(timeout = 10000) {
  await page.waitForFunction(() => {
    const cancel = document.getElementById('cancelBtn');
    const progress = document.getElementById('progressNote')?.textContent || '';
    const last = document.getElementById('lastRun')?.textContent || '';
    return !!cancel && cancel.disabled && !progress.trim() && !/Running .*background/.test(last);
  }, null, { timeout });
}

async function waitForCompletedRender(timeout = 20000) {
  await page.waitForFunction(() => {
    const gasCards = document.getElementById('gasCards')?.textContent || '';
    const lastRun = document.getElementById('lastRun')?.textContent || '';
    return gasCards.includes('Half-time interpretation') && !/Running .*background/.test(lastRun);
  }, null, { timeout });
}

async function snapshotRenderState() {
  return page.evaluate(() => ({
    lastRun: document.getElementById('lastRun')?.textContent || '',
    gasCards: document.getElementById('gasCards')?.textContent || '',
    safeTime: document.getElementById('safeTime')?.textContent || '',
  }));
}

async function settleAfter(action, timeout = 15000) {
  const previous = await snapshotRenderState();
  await action();
  await page.waitForFunction((snapshot) => {
    const cancel = document.getElementById('cancelBtn');
    const lastRun = document.getElementById('lastRun')?.textContent || '';
    const gasCards = document.getElementById('gasCards')?.textContent || '';
    const safeTime = document.getElementById('safeTime')?.textContent || '';
    return !!(cancel && !cancel.disabled) || lastRun !== snapshot.lastRun || gasCards !== snapshot.gasCards || safeTime !== snapshot.safeTime;
  }, previous, { timeout });
  await waitForIdle(timeout);
}

async function calculate(timeout = 10000) {
  await settleAfter(() => page.evaluate(() => document.getElementById('calculateBtn').click()), timeout);
}

async function activeTab() {
  return page.locator('.tab.active').getAttribute('data-tab');
}

await page.goto(url);
await page.waitForSelector('#safeTime');
await waitForCompletedRender();

assert((await page.locator('body').getAttribute('data-release')) === RELEASE, 'stale release on browser load');
assert(((await page.locator('meta[name="artifact-commit"]').getAttribute('content')) || '').length === 40, 'artifact commit metadata missing');
assert(((await page.locator('meta[name="artifact-manifest-sha256"]').getAttribute('content')) || '').length === 64, 'artifact manifest hash metadata missing');
assert((await page.locator('#pHModel').inputValue()) === 'carbonate_alkalinity', 'default pH model should be carbonate/alkalinity');
assert((await page.locator('#safeTime').textContent()).trim().length > 0, 'default calculation missing');

await page.focus('[data-tab="diagnostics"]');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('.tab.active')?.dataset.tab === 'diagnostics');
assert((await activeTab()) === 'diagnostics', 'keyboard activation should switch tabs');

await settleAfter(() => page.selectOption('#halfTimeMode', 'measured_effective', { force: true }));
assert((await page.locator('#halfTimeMode').inputValue()) === 'measured_effective', 'measured-effective mode was not selected');
assert((await page.locator('#gasCards').textContent()).includes('Half-time interpretation'), 'measured-effective mode did not render diagnostics');

await settleAfter(() => page.selectOption('#halfTimeMode', 'reference_scaled', { force: true }));
assert((await page.locator('#halfTimeMode').inputValue()) === 'reference_scaled', 'reference-scaled mode was not selected');
assert((await page.locator('#gasCards').textContent()).includes('Half-time interpretation'), 'reference-scaled mode did not render diagnostics');

await page.click('#runScenariosBtn');
await page.waitForFunction(() => (document.getElementById('scenarioTable')?.textContent || '').includes('nominal'), null, { timeout: 5000 });
assert((await page.locator('#scenarioTable').textContent()).includes('nominal'), 'deterministic scenario table did not populate');

await page.fill('#calibrationSeries', 'time_h,o2_uM\n0,204\n1,180\n2,160\n3,145');
await page.click('#runCalibrationBtn');
await page.waitForFunction(() => (document.getElementById('calibrationSummary')?.textContent || '').includes('Best fit'), null, { timeout: 10000 });
assert((await page.locator('#calibrationSummary').textContent()).includes('Best fit'), 'calibration summary did not populate');

await page.click('[data-tab="setup"]');
await page.evaluate(() => { document.getElementById('customOCR').value = '-5'; });
await calculate();
assert(!(await page.locator('#safeTime').textContent()).includes('Invalid'), 'inactive custom OCR should be ignored for built-in lines');

const customCellValue = await page.evaluate(() => {
  const options = [...document.querySelectorAll('#cellLine option')];
  return options.find((option) => /custom/i.test(option.value) || /custom/i.test(option.textContent || ''))?.value || null;
});
assert(customCellValue, 'custom cell-line option missing');
await settleAfter(() => page.selectOption('#cellLine', customCellValue, { force: true }));
assert((await page.locator('#safeTime').textContent()).includes('Invalid'), 'active custom OCR should block calculation');

const builtInCellValue = await page.evaluate((customValue) => {
  const options = [...document.querySelectorAll('#cellLine option')];
  return options.find((option) => option.value !== customValue)?.value || null;
}, customCellValue);
assert(builtInCellValue, 'built-in cell-line option missing');
await settleAfter(() => page.selectOption('#cellLine', builtInCellValue, { force: true }));

await page.click('[data-tab="environment"]');
await page.evaluate(() => {
  document.getElementById('customO2').value = '90';
  document.getElementById('customCO2').value = '20';
});
await settleAfter(() => page.selectOption('#headspaceGas', 'co2air', { force: true }));
assert(!(await page.locator('#safeTime').textContent()).includes('Invalid'), 'inactive custom gas inputs should be ignored');

await settleAfter(() => page.selectOption('#headspaceGas', 'custom', { force: true }));
assert((await page.locator('#safeTime').textContent()).includes('Invalid'), 'active custom gas inputs above 100% should block calculation');

await settleAfter(async () => {
  await page.selectOption('#headspaceGas', 'co2air', { force: true });
  await page.selectOption('#atmMode', 'closed', { force: true });
  await page.selectOption('#pHBoundaryMode', 'closed_headspace_mass_balance', { force: true });
});
const closedCarbonText = await page.locator('#gasCards').textContent();
assert(closedCarbonText.includes('headspace CO₂'), 'closed finite-headspace run should report a tracked headspace-carbon residual');
assert(!closedCarbonText.includes('not applicable'), 'closed finite-headspace run should not mark tracked carbon residual as not applicable');

await settleAfter(async () => {
  await page.selectOption('#atmMode', 'incubator', { force: true });
  await page.selectOption('#pHBoundaryMode', 'fixed_starting_pH_boundary', { force: true });
});
assert((await page.locator('#gasCards').textContent()).includes('not applicable'), 'external CO₂ boundary should mark tracked carbon residual as not applicable');

await settleAfter(async () => {
  await page.selectOption('#atmMode', 'closed', { force: true });
  await page.selectOption('#headspaceGas', 'nitrogen', { force: true });
  await page.selectOption('#o2ThresholdMode', 'selected_pct', { force: true });
});
assert((await page.locator('#warnings').textContent()).includes('selected-gas O₂ thresholds are invalid'), 'anoxic selected-gas threshold warning missing');

await settleAfter(async () => {
  await page.selectOption('#headspaceGas', 'co2air', { force: true });
  await page.selectOption('#o2ThresholdMode', 'absolute_uM', { force: true });
});
await page.click('[data-tab="emulsion"]');
await settleAfter(() => page.selectOption('#bulkO2Mode', 'grouped_transport_limited', { force: true }));
const groupedText = await page.locator('#gasCards').textContent();
assert(groupedText.includes('grouped transport limited'), 'grouped bulk O₂ mode should render in diagnostics');

await page.selectOption('#vesselPreset', 'ptfe_600', { force: true });
await page.waitForFunction(() => document.getElementById('storageMode')?.value === 'ptfe_tubing' && document.getElementById('gasHalf')?.value === '10', null, { timeout: 5000 });
assert((await page.locator('#storageMode').inputValue()) === 'ptfe_tubing', 'PTFE vessel preset should synchronize storage mode');
await page.selectOption('#vesselPreset', 'eppendorf_1_5', { force: true });
await page.waitForFunction(() => document.getElementById('storageMode')?.value === 'static_tube' && document.getElementById('gasHalf')?.value === '150' && document.getElementById('dropHalf')?.value === '10', null, { timeout: 5000 });
assert((await page.locator('#storageMode').inputValue()) === 'static_tube', 'returning to a static tube should reset storage mode');
assert((await page.locator('#gasHalf').inputValue()) === '150', 'returning to a static tube should reset gas half-time');
assert((await page.locator('#dropHalf').inputValue()) === '10', 'returning to a static tube should reset droplet half-time');

await page.click('[data-tab="setup"]');
await page.click('[data-preset="pdms"]');
await page.waitForFunction(() => document.getElementById('storageMode')?.value === 'pdms_chip', null, { timeout: 5000 });
assert((await page.locator('#storageMode').inputValue()) === 'pdms_chip', 'PDMS preset should set PDMS storage mode');
await page.click('[data-preset="closed"]');
await page.waitForFunction(() => document.getElementById('storageMode')?.value === 'static_tube' && document.getElementById('vesselPreset')?.value === 'eppendorf_1_5', null, { timeout: 5000 });
assert((await page.locator('#storageMode').inputValue()) === 'static_tube', 'closed preset should return to static tube mode');
assert((await page.locator('#vesselPreset').inputValue()) === 'eppendorf_1_5', 'closed preset should select the microcentrifuge tube');

await page.click('[data-tab="setup"]');
await page.click('#copySummaryBtn');
await page.waitForFunction(() => (window.__copiedText || '').includes('Metabolic Depletion Forecaster:'), null, { timeout: 5000 });
assert((await page.evaluate(() => window.__copiedText)).includes('Useful window'), 'copy summary should place forecast text on the clipboard');

await page.click('[data-tab="references"]');
await page.click('#downloadDataBtn');
await page.waitForFunction(() => window.__downloads.some((entry) => entry.name === 'metabolic_forecaster_data.json'), null, { timeout: 5000 });

await page.click('[data-tab="diagnostics"]');
await page.click('#exportCsvBtn');
await page.click('#exportJsonBtn');
await page.waitForFunction(() => window.__downloads.some((entry) => entry.name === 'metabolic_depletion_forecaster_log.csv') && window.__downloads.some((entry) => entry.name === 'metabolic_depletion_forecaster_result.json'), null, { timeout: 5000 });
const downloads = await page.evaluate(() => window.__downloads.map((entry) => ({ name: entry.name, text: entry.text })));
const csvDownload = downloads.find((entry) => entry.name === 'metabolic_depletion_forecaster_log.csv');
const jsonDownload = downloads.find((entry) => entry.name === 'metabolic_depletion_forecaster_result.json');
assert(csvDownload && csvDownload.text && csvDownload.text.includes('time_h,target_o2_uM'), 'CSV export content missing');
assert(jsonDownload && jsonDownload.text && jsonDownload.text.includes('"release": "v18-transport-20260715"'), 'JSON export content missing');

await page.click('#savePngBtn');
await page.waitForFunction(() => (window.__lastAnchorDownload?.download || '') === 'metabolic_depletion_timeline_highres.png', null, { timeout: 5000 });

await page.evaluate(({ stateKey, legacyKey }) => {
  localStorage.setItem(legacyKey, JSON.stringify({ tab: 'setup', theme: 'light', halfTimeMode: 'reference_scaled' }));
  localStorage.setItem(stateKey, JSON.stringify({ tab: 'references', theme: 'dark', halfTimeMode: 'measured_effective' }));
}, { stateKey: STATE_KEY, legacyKey: LEGACY_STATE_KEY });
await page.reload();
await page.waitForSelector('#safeTime');
await waitForCompletedRender();
assert((await page.locator('html').getAttribute('data-theme')) === 'dark', 'current release state should restore dark theme');
assert((await activeTab()) === 'references', 'current release state should restore the saved tab');
assert((await page.locator('#halfTimeMode').inputValue()) === 'measured_effective', 'current release state should restore measured-effective mode');

await page.click('[data-tab="setup"]');
await page.evaluate(() => {
  document.getElementById('maxDays').value = '30';
  document.getElementById('gasHalf').value = '0.1';
  document.getElementById('oilHalf').value = '0.1';
  document.getElementById('dropHalf').value = '0.1';
  document.getElementById('lambda').value = '20';
  document.getElementById('targetCells').value = '50';
});
await page.evaluate(() => document.getElementById('calculateBtn').click());
await page.waitForFunction(() => document.getElementById('cancelBtn') && !document.getElementById('cancelBtn').disabled, null, { timeout: 15000 });
assert((await page.locator('#cancelBtn').isDisabled()) === false, 'cancel button should enable during worker run');
await page.evaluate(() => document.getElementById('cancelBtn').click());
await page.waitForFunction(() => (document.getElementById('lastRun')?.textContent || '').includes('cancelled'), null, { timeout: 10000 });
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
console.log('Browser verification passed.');
