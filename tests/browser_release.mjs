import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const RELEASE = 'v19-html-authoritative-20260716';
const STATE_KEY = 'metabolic-forecaster-v19-html-authoritative-20260716';
const LEGACY_STATE_KEY = 'metabolic-forecaster-v17-audit-20260715';
const artifactPath = path.resolve('metabolic_depletion_forecaster.html').replace(/\\/g, '/');
const url = `file:///${artifactPath}`;
async function runBrowser(browserType, browserName) {
let browser;
try {
  browser = await browserType.launch({ headless: true });
} catch (error) {
  if (/Executable doesn't exist|browserType\.launch/i.test(String(error))) {
    console.log(`SKIP ${browserName}: Playwright browser is not installed on this platform.`);
    return { browserName, status: 'skipped' };
  }
  throw error;
}
const page = await browser.newPage();
const consoleErrors = [];
const externalRequests = [];

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
page.on('request', (request) => {
  if (!/^(?:file|data|blob):/i.test(request.url())) externalRequests.push(request.url());
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
    resultState: document.getElementById('safeCard')?.dataset.resultState || '',
  }));
}

async function settleAfter(action, timeout = 30000) {
  const previous = await snapshotRenderState();
  await action();
  await page.waitForFunction((snapshot) => {
    const cancel = document.getElementById('cancelBtn');
    const lastRun = document.getElementById('lastRun')?.textContent || '';
    const gasCards = document.getElementById('gasCards')?.textContent || '';
    const safeTime = document.getElementById('safeTime')?.textContent || '';
    const resultState = document.getElementById('safeCard')?.dataset.resultState || '';
    return (resultState === 'current' || resultState === 'blocked' || resultState === 'stopped') && (lastRun !== snapshot.lastRun || gasCards !== snapshot.gasCards || safeTime !== snapshot.safeTime || resultState !== snapshot.resultState);
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
assert((await page.locator('#growthModel').inputValue()) === 'stress_limited', 'default growth model should be stress-limited');
assert((await page.locator('#add_fbs').isChecked()) === false, 'FBS must be disabled by default');
assert((await page.locator('#rateTemperatureMode').inputValue()) === 'reference_q10', 'explicit Q10 temperature mode should be available by default');
assert(await page.evaluate(() => window.lastResult.params.rateApplicationMode === 'reference_q10_extrapolation' && window.lastResult.params.temperatureMultiplier === 1 && Object.values(window.lastResult.params.rateMultipliers).every((factor) => factor === 1)), 'default reference-temperature calculation should apply a unit Q10 multiplier');
assert((await page.locator('#safeTime').textContent()).trim().length > 0, 'default calculation missing');
assert((await page.locator('#chartAlternative').textContent()).includes('Timeline from'), 'chart text alternative missing');
assert(await page.evaluate(() => ['setup','emulsion','environment','metabolism','diagnostics','references'].every((id) => { const panel=document.getElementById('tab-'+id); return panel?.getAttribute('role')==='tabpanel' && panel?.getAttribute('aria-labelledby')==='tabButton-'+id; })), 'all tab panels must expose tabpanel semantics');
const workerEquivalence = await page.evaluate(async () => {
  const params = JSON.parse(JSON.stringify(window.lastResult.params));
  const synchronous = Engine.simulate(params);
  const source = workerScriptSource();
  if (!source) throw new Error('worker source is unavailable');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const workerResult = await new Promise((resolve, reject) => {
      const worker = new Worker(url);
      worker.onmessage = (event) => {
        if (event.data?.type === 'result') { worker.terminate(); resolve(event.data.result); }
        if (event.data?.type === 'error') { worker.terminate(); reject(new Error(event.data.error)); }
      };
      worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'worker execution failed')); };
      worker.postMessage({ jobId: 'equivalence', kind: 'simulate', payload: { params } });
    });
    const sampleIndexes = [0, Math.floor(synchronous.chart.length / 2), synchronous.chart.length - 1];
    return {
      limiterEqual: synchronous.limiter === workerResult.limiter,
      safeDelta: Math.abs(synchronous.safeMin - workerResult.safeMin),
      chartLengthEqual: synchronous.chart.length === workerResult.chart.length,
      samples: sampleIndexes.map((index) => ({
        index,
        o2: Math.abs(synchronous.chart[index].O2T - workerResult.chart[index].O2T),
        glucose: Math.abs(synchronous.chart[index].Glc - workerResult.chart[index].Glc),
        glutamine: Math.abs(synchronous.chart[index].Gln - workerResult.chart[index].Gln),
        pH: Math.abs(synchronous.chart[index].pH - workerResult.chart[index].pH),
      })),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
});
assert(workerEquivalence.limiterEqual, 'worker and synchronous solvers chose different endpoints');
assert(workerEquivalence.safeDelta <= 1e-9, `worker and synchronous endpoint times diverged by ${workerEquivalence.safeDelta}`);
assert(workerEquivalence.chartLengthEqual, 'worker and synchronous chart lengths differ');
assert(workerEquivalence.samples.every((sample) => sample.o2 <= 1e-9 && sample.glucose <= 1e-9 && sample.glutamine <= 1e-9 && sample.pH <= 1e-9), `worker and synchronous trajectories diverged: ${JSON.stringify(workerEquivalence.samples)}`);
for (const viewport of [[320, 568], [375, 667], [390, 844], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [1920, 1080]]) {
  await page.setViewportSize({ width: viewport[0], height: viewport[1] });
  await page.waitForTimeout(50);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert(width.scroll <= width.client + 1, `page overflow at ${viewport[0]}px: ${width.scroll}px > ${width.client}px`);
}
await page.setViewportSize({ width: 1280, height: 720 });
const resultBox = await page.locator('#safeCard').boundingBox();
assert(resultBox && resultBox.y < 720, 'primary result is not visible in the first 1280×720 viewport');
await page.setViewportSize({ width: 390, height: 844 });
const mobileResult = await page.locator('#safeCard').boundingBox();
assert(mobileResult && mobileResult.width <= 390, 'mobile result card overflows the viewport');
await page.setViewportSize({ width: 1280, height: 720 });
const unlabeledInputs = await page.evaluate(() => [...document.querySelectorAll('input[id],select[id],textarea[id]')].filter((el) => !document.querySelector(`label[for="${el.id}"]`) && !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map((el) => el.id));
assert(unlabeledInputs.length === 0, `form controls lack accessible labels: ${unlabeledInputs.join(', ')}`);

await page.click('#helpBtn');
assert(await page.locator('#helpDialog').evaluate((el) => el.classList.contains('open') && el.getAttribute('role') === 'dialog'), 'help dialog did not open accessibly');
await page.keyboard.press('Escape');
assert(!(await page.locator('#helpDialog').evaluate((el) => el.classList.contains('open'))), 'Escape should close help dialog');
await page.click('#equationsBtn');
assert(await page.locator('#equationsDialog').evaluate((el) => el.classList.contains('open')), 'equations dialog did not open');
await page.click('#closeEquationsBtn');

await settleAfter(() => page.selectOption('#growthModel', 'legacy_logistic', { force: true }));
assert((await page.locator('#growthModel').inputValue()) === 'legacy_logistic', 'legacy growth selector did not run');
await settleAfter(() => page.selectOption('#growthModel', 'stress_limited', { force: true }));

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
assert(await page.locator('#runCalibrationBtn').isVisible(), 'calibration action is missing from Diagnostics');

await page.click('[data-tab="setup"]');
await page.evaluate(() => { document.getElementById('customOCR').value = '-5'; });
await calculate();
assert(!(await page.locator('#safeTime').textContent()).includes('Invalid'), 'inactive custom OCR should be ignored for built-in lines');

const customCellValue = await page.evaluate(() => {
  const options = [...document.querySelectorAll('#cellLine option')];
  return options.find((option) => /custom/i.test(option.value) || /custom/i.test(option.textContent || ''))?.value || null;
});
assert(customCellValue, 'custom cell-line option missing');
await page.selectOption('#cellLine', customCellValue, { force: true });
await page.waitForFunction(() => document.getElementById('copySummaryBtn')?.disabled, null, { timeout: 5000 });
assert(await page.locator('#copySummaryBtn').isDisabled(), 'stale custom-rate input must disable copy/export actions');

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
await page.selectOption('#headspaceGas', 'co2air', { force: true });
assert(!(await page.locator('#safeTime').textContent()).includes('Invalid'), 'inactive custom gas inputs should be ignored');

await page.selectOption('#headspaceGas', 'custom', { force: true });
const invalidCustomGas = await page.evaluate(() => gatherParams().invalid || []);
assert(invalidCustomGas.some((message) => String(message).includes('cannot exceed 100%')), 'active custom gas inputs above 100% should be rejected');

await settleAfter(async () => {
  await page.selectOption('#headspaceGas', 'co2air', { force: true });
  await page.selectOption('#atmMode', 'closed', { force: true });
  await page.waitForFunction(() => document.getElementById('pHBoundaryMode')?.value === 'closed_headspace_mass_balance', null, { timeout: 5000 });
});
const closedCarbonText = await page.locator('#gasCards').textContent();
assert(closedCarbonText.includes('headspace CO₂'), 'closed finite-headspace run should report a tracked headspace-carbon residual');
assert(!closedCarbonText.includes('not applicable'), 'closed finite-headspace run should not mark tracked carbon residual as not applicable');
assert(closedCarbonText.includes('Oil CO₂ capacity ratio'), 'closed finite-headspace run should report oil CO₂ capacity metadata');

await page.evaluate(() => {
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set('cellLine', 'custom'); set('customOCR', '0'); set('customGCR', '0'); set('customLPR', '0'); set('customGlnCR', '0');
  set('vesselPreset', 'custom'); set('vesselPresetEnv', 'custom'); set('atmMode', 'closed'); set('pHBoundaryMode', 'closed_headspace_mass_balance');
  set('headspaceVolume', '0'); set('o2ThresholdMode', 'absolute_uM'); set('hypoxiaPct', '1'); set('initAqO2Pct', '100'); set('initOilO2Pct', '100'); set('initReservoirO2Pct', '100'); set('maxDays', '0.25'); set('bulkO2Mode', 'auto');
});
await calculate(15000);
const zeroHeadspaceProbe = await page.evaluate(() => ({
  limiter: window.lastResult?.limiter,
  safeMin: window.lastResult?.safeMin,
  maxMin: (window.lastResult?.params?.maxDays || 0) * 24 * 60,
  gasRes: window.lastResult?.conductances?.fmolPerMinPerUM?.gasRes,
  gasDirect: window.lastResult?.conductances?.fmolPerMinPerUM?.gasDirect,
  boundaryNet: window.lastResult?.initialFlux?.boundaryNet,
  capacityResidual: (window.lastResult?.capacities?.capEmpty || 0) + (window.lastResult?.capacities?.capSingle || 0) + (window.lastResult?.capacities?.capMulti || 0) - (window.lastResult?.capacities?.capBulk || 0),
}));
assert(zeroHeadspaceProbe.limiter === 'simulation horizon' && Math.abs(zeroHeadspaceProbe.safeMin - zeroHeadspaceProbe.maxMin) < 1e-6, 'zero-headspace browser run stopped before horizon');
assert(zeroHeadspaceProbe.gasRes === 0 && zeroHeadspaceProbe.gasDirect === 0 && zeroHeadspaceProbe.boundaryNet === 0, 'zero-headspace browser run retained a gas boundary');
assert(Math.abs(zeroHeadspaceProbe.capacityResidual) < 1e-9, 'auto-mode occupancy capacities do not reconcile');

await settleAfter(async () => {
  await page.selectOption('#atmMode', 'incubator', { force: true });
  await page.selectOption('#pHBoundaryMode', 'fixed_starting_pH_boundary', { force: true });
});
assert((await page.locator('#gasCards').textContent()).includes('not applicable'), 'external CO₂ boundary should mark tracked carbon residual as not applicable');

await page.selectOption('#atmMode', 'closed', { force: true });
await page.selectOption('#headspaceGas', 'nitrogen', { force: true });
await page.selectOption('#o2ThresholdMode', 'selected_pct', { force: true });
const invalidSelectedGas = await page.evaluate(() => gatherParams().invalid || []);
assert(invalidSelectedGas.some((message) => String(message).includes('selected-gas O₂ thresholds are invalid')), 'anoxic selected-gas threshold warning missing');

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
assert(await page.evaluate(() => ['gasHalf','oilHalf','dropHalf','gradientFactor','surfaceAccess','centerPenalty'].every((id,index) => document.getElementById(id)?.value === ['60','45','7','0.85','25','1'][index])), 'PDMS preset transport configuration is incomplete');
assert((await page.locator('#oilType').inputValue()) === 'pdms' && (await page.locator('#atmMode').inputValue()) === 'incubator' && (await page.locator('#pHBoundaryMode').inputValue()) === 'fixed_starting_pH_boundary', 'PDMS preset physical boundary configuration is incomplete');
await page.click('[data-preset="reservoir"]');
assert(await page.evaluate(() => ['gasHalf','oilHalf','dropHalf','gradientFactor','surfaceAccess','centerPenalty'].every((id,index) => document.getElementById(id)?.value === ['25','18','6','0.95','20','1'][index])), 'reservoir preset transport configuration is incomplete');
assert((await page.locator('#oilType').inputValue()) === 'hfe7500' && (await page.locator('#vesselPreset').inputValue()) === 'falcon_15' && (await page.locator('#atmMode').inputValue()) === 'incubator' && (await page.locator('#pHBoundaryMode').inputValue()) === 'fixed_starting_pH_boundary', 'reservoir preset physical boundary configuration is incomplete');
await page.click('[data-preset="closed"]');
await page.waitForFunction(() => document.getElementById('storageMode')?.value === 'static_tube' && document.getElementById('vesselPreset')?.value === 'eppendorf_1_5', null, { timeout: 5000 });
assert((await page.locator('#storageMode').inputValue()) === 'static_tube', 'closed preset should return to static tube mode');
assert((await page.locator('#vesselPreset').inputValue()) === 'eppendorf_1_5', 'closed preset should select the microcentrifuge tube');
await page.waitForFunction(() => document.getElementById('safeCard')?.dataset.resultState === 'current', null, { timeout: 30000 });

await page.click('[data-tab="setup"]');
await page.click('#copySummaryBtn');
await page.waitForFunction(() => (window.__copiedText || '').includes('Metabolic Depletion Forecaster v19'), null, { timeout: 5000 });
assert((await page.evaluate(() => window.__copiedText)).includes('Conservative planning scenario'), 'copy summary should place canonical scenario text on the clipboard');
assert(await page.evaluate(() => window.__copiedText.includes(window.lastResult.calculationHash)), 'copy summary should include the canonical calculation hash');

await page.click('[data-tab="references"]');
await page.click('#downloadDataBtn');
await page.waitForFunction(() => window.__downloads.some((entry) => entry.name === 'metabolic_forecaster_data.json'), null, { timeout: 5000 });

await page.click('[data-tab="diagnostics"]');
await page.locator('#detailedTimeSeries summary').click();
await page.click('#exportCsvBtn');
await page.click('#exportJsonBtn');
await page.waitForFunction(() => window.__downloads.some((entry) => entry.name === 'metabolic_depletion_forecaster_log.csv') && window.__downloads.some((entry) => entry.name === 'metabolic_depletion_forecaster_result.json'), null, { timeout: 5000 });
await page.waitForFunction(() => window.__downloads.filter((entry) => entry.name === 'metabolic_depletion_forecaster_log.csv' || entry.name === 'metabolic_depletion_forecaster_result.json').every((entry) => typeof entry.text === 'string'), null, { timeout: 5000 });
const downloads = await page.evaluate(() => window.__downloads.map((entry) => ({ name: entry.name, text: entry.text })));
const csvDownload = downloads.find((entry) => entry.name === 'metabolic_depletion_forecaster_log.csv');
const jsonDownload = downloads.find((entry) => entry.name === 'metabolic_depletion_forecaster_result.json');
assert(csvDownload && csvDownload.text && csvDownload.text.includes('time_h,target_o2_uM'), 'CSV export content missing');
assert(jsonDownload && jsonDownload.text && jsonDownload.text.includes('"release": "v19-html-authoritative-20260716"'), 'JSON export content missing');
assert(jsonDownload && jsonDownload.text && jsonDownload.text.includes('"growthModel": "stress_limited"'), 'JSON export should include growth model metadata');
assert(jsonDownload && jsonDownload.text && jsonDownload.text.includes('"groupedBulkNutrients"'), 'JSON export should include grouped bulk nutrient summaries');

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

await page.evaluate((stateKey) => localStorage.setItem(stateKey, '{malformed-json'), STATE_KEY);
await page.reload();
await page.waitForSelector('#safeTime');
await waitForCompletedRender();
assert((await page.locator('#safeTime').textContent()).trim().length > 0, 'malformed saved state should recover to a working calculation');

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

await page.evaluate(() => { const r={...window.lastResult,error:'Solver budget exceeded — test stop.',solver:{acceptedSteps:1,rootIterations:0,estimatedSteps:2,actualMinStep:0.1,actualMedianStep:0.1,actualMaxStep:0.1}}; completeRunResult(r); });
assert((await page.locator('#safeCard').getAttribute('data-result-state')) === 'stopped', 'solver stop should set stopped result state');
assert((await page.locator('#copySummaryBtn').isDisabled()) && (await page.locator('#exportCsvBtn').isDisabled()) && (await page.locator('#exportJsonBtn').isDisabled()) && (await page.locator('#savePngBtn').isDisabled()), 'solver stop should disable result exports');
assert((await page.locator('#warnings').textContent()).includes('Solver budget exceeded'), 'solver stop message missing');

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
assert(externalRequests.length === 0, `${browserName} made external requests: ${externalRequests.join(' | ')}`);
console.log(`${browserName} browser verification passed.`);
return { browserName, status: 'passed' };
}

const matrix = [];
const requestedBrowsers = new Set(String(process.env.PLAYWRIGHT_BROWSERS || 'Chromium,Firefox,WebKit').split(',').map((name) => name.trim().toLowerCase()));
for (const [browserName, browserType] of [['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]]) if (requestedBrowsers.has(browserName.toLowerCase())) matrix.push(await runBrowser(browserType, browserName));
console.log(`Browser matrix: ${matrix.map((entry) => `${entry.browserName}=${entry.status}`).join(', ')}`);
