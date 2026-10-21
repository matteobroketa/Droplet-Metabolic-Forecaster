import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';

const artifact = path.resolve('metabolic_depletion_forecaster.html').replace(/\\/g, '/');
const browser = await chromium.launch({ headless: true });
try {
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

// Saved catalog values can outlive their options after an update. They must
// never create a "current" forecast with an empty cell/medium/oil definition.
const defaults = await page.evaluate(() => ({
  cellLine: document.querySelector('#cellLine').value,
  medium: document.querySelector('#medium').value,
  oilType: document.querySelector('#oilType').value,
  tab: document.querySelector('.tab.active').dataset.tab,
}));
for (const saved of [
  {cellLine: 'removed-cell'}, {medium: 'removed-medium'},
  {oilType: 'removed-oil'}, {tab: 'removed-tab'},
  {cellLine: null, medium: {}, oilType: []},
  {cellLine: 'mcf7', tab: 'environment'},
]) {
  const restoredPage = await browser.newPage();
  const restoredErrors = [];
  restoredPage.on('pageerror', error => restoredErrors.push(error.message));
  await restoredPage.addInitScript(saved => {
    localStorage.setItem('metabolic-forecaster-v19-html-authoritative-20260716', JSON.stringify({maxDays: '0.25', ...saved}));
  }, saved);
  await restoredPage.goto(`file:///${artifact}`);
  await restoredPage.waitForFunction(() => document.querySelector('#safeCard').dataset.resultState === 'current', null, {timeout: 30000});
  const restored = await restoredPage.evaluate(() => ({
    cellLine: window.lastResult.params.cell.id,
    medium: window.lastResult.params.med.id,
    oilType: window.lastResult.params.oil.id,
    tab: document.querySelector('.tab.active')?.dataset.tab,
    activePanels: document.querySelectorAll('.tab-content.active').length,
    rate: window.lastResult.params.rates.ocr,
  }));
  const validSaved = saved.cellLine === 'mcf7';
  assert.equal(restored.cellLine, validSaved ? 'mcf7' : defaults.cellLine, 'Saved cell selection must resolve to an existing catalog entry');
  assert.equal(restored.medium, defaults.medium);
  assert.equal(restored.oilType, defaults.oilType);
  assert.equal(restored.tab, validSaved ? 'environment' : defaults.tab);
  assert.equal(restored.activePanels, 1);
  assert.ok(restored.rate > 0, 'Restoration must not silently zero cell consumption');
  if (('cellLine' in saved && !validSaved) || 'medium' in saved || 'oilType' in saved) {
    assert.match(await restoredPage.locator('#resultStatus').textContent(), /unavailable choices reset to defaults/);
  }
  assert.deepEqual(restoredErrors, []);
  await restoredPage.close();
}

for (const failure of ['constructor', 'runtime', 'postMessage', 'messageerror']) {
  const fallbackPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const fallbackErrors = [];
  fallbackPage.on('pageerror', error => fallbackErrors.push(error.message));
  await fallbackPage.addInitScript(mode => {
    localStorage.setItem('metabolic-forecaster-v19-html-authoritative-20260716', JSON.stringify({maxDays: '0.25'}));
    const NativeWorker = window.Worker;
    if (mode === 'constructor') {
      window.Worker = class { constructor() { throw new DOMException('Workers blocked by browser policy', 'SecurityError'); } };
    } else if (mode === 'runtime') {
      window.Worker = class extends NativeWorker {
        constructor() {
          const url = URL.createObjectURL(new Blob(['throw new Error("Worker runtime regression fixture");'], {type: 'text/javascript'}));
          super(url);
          URL.revokeObjectURL(url);
        }
      };
    } else {
      window.Worker = class extends NativeWorker {
        postMessage() {
          if (mode === 'postMessage') throw new DOMException('Worker message could not be cloned', 'DataCloneError');
          setTimeout(() => this.dispatchEvent(new MessageEvent('messageerror')), 0);
        }
      };
    }
  }, failure);
  console.log('Checking worker failure:', failure);
  await fallbackPage.goto(`file:///${artifact}`);
  await fallbackPage.waitForFunction(() => document.querySelector('#safeCard')?.dataset.resultState === 'current', null, { timeout: 30000 }).catch(async error => {
    throw new Error(failure + ': ' + error.message + ' | ' + await fallbackPage.locator('#resultStatus').textContent() + ' | ' + fallbackErrors.join('; '));
  });
  assert.equal(await fallbackPage.locator('#calculateBtn').isEnabled(), true, failure + ': Calculate remained disabled');
  assert.equal(await fallbackPage.locator('#exportJsonBtn').isEnabled(), true, failure + ': successful fallback was not exportable');
  assert.equal(await fallbackPage.locator('#cancelBtn').isVisible(), false, failure + ': worker remained active');
  assert.deepEqual(fallbackErrors, [], failure + ': unhandled browser errors');
  if (failure === 'runtime' || failure === 'messageerror') assert.match(await fallbackPage.locator('#lastRun').textContent(), /Worker fallback after error/);
  await fallbackPage.close();
}

// A late worker error must not publish the old inputs as a current result.
const staleResult = await page.evaluate(() => {
  const previous = window.lastResult;
  window.Worker = class extends EventTarget {
    constructor() { super(); window.fixtureWorker = this; }
    postMessage() {}
    terminate() {}
  };
  runAndRender();
  const input = document.querySelector('#targetCells');
  input.value = String(Number(input.value) + 1);
  input.dispatchEvent(new Event('input', {bubbles: true}));
  clearTimeout(timer);
  window.fixtureWorker.onerror({preventDefault() {}, message: 'Late worker failure'});
  return {state: document.querySelector('#safeCard').dataset.resultState, retainedPrevious: window.lastResult === previous, exportDisabled: document.querySelector('#exportJsonBtn').disabled, calculateEnabled: !document.querySelector('#calculateBtn').disabled};
});
assert.deepEqual(staleResult, {state: 'stale', retainedPrevious: true, exportDisabled: true, calculateEnabled: true});

} finally {
  await browser.close();
}
console.log('Standalone HTML smoke check and worker failure regressions passed.');
