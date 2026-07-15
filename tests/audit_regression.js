const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'metabolic_depletion_forecaster.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const limitations = fs.readFileSync(path.join(__dirname, '..', 'ACCURACY_AND_LIMITATIONS.md'), 'utf8');
const start = html.indexOf('const DATA=');
const end = html.indexOf("window.addEventListener('resize'");
if (start < 0 || end < 0) throw new Error('Could not locate model code in HTML source.');

const model = new Function(
  html.slice(start, end) +
    '\nreturn {DATA, STATE_KEY, PHYS, VESSELS, o2Eq, co2Eq, geometryScales, estimateSolverWorkload, Engine, buildOccupancyModel, bulkCellsAt, bulkGroupCellsAt, cellsAt, dryGasPctToHeadspaceMoles, thresholdFromMode, initialFlux, co2HeadEq, gatherParams, hardValidateInputs, auditCellDatabase, CELL_DATABASE_ISSUES, applyModePreset, applyVesselPreset, applyPreset, syncVesselControls, vesselSpec, buildRateScenarioResults, buildExportPayload};'
)();

const {
  DATA,
  STATE_KEY,
  VESSELS,
  o2Eq,
  co2Eq,
  geometryScales,
  estimateSolverWorkload,
  Engine,
  buildOccupancyModel,
  bulkCellsAt,
  bulkGroupCellsAt,
  dryGasPctToHeadspaceMoles,
  thresholdFromMode,
  initialFlux,
  co2HeadEq,
  gatherParams,
  hardValidateInputs,
  auditCellDatabase,
  CELL_DATABASE_ISSUES,
  applyModePreset,
  applyVesselPreset,
  applyPreset,
  syncVesselControls,
  vesselSpec,
  buildRateScenarioResults,
  buildExportPayload,
} = model;

const AIR_GAS = { o2: 0.2095, co2: 0.0004 };
const INCUBATOR_GAS = { o2: 0.95 * 0.2095, co2: 0.05 };
let passCount = 0;
let failCount = 0;

function makeParams(overrides = {}) {
  const T = overrides.T ?? 37;
  const gas = overrides.gas ?? INCUBATOR_GAS;
  const volume_nL = overrides.volume_nL ?? 1;
  const Vaq_uL = overrides.Vaq_uL ?? 0.01;
  const N = overrides.N ?? Math.max(1, (Vaq_uL * 1000) / volume_nL);
  const lambda = overrides.lambda ?? 0.1;
  const targetCells = overrides.targetCells ?? 1;
  const airO2Eq = o2Eq(T, AIR_GAS);
  const O2eq = overrides.O2eq ?? o2Eq(T, gas);
  const CO2eq = overrides.CO2eq ?? co2Eq(T, gas);
  const occupancy = overrides.occupancy ?? buildOccupancyModel(lambda, N, targetCells);
  const headspace_mL = overrides.headspace_mL ?? 0.25;
  const p = {
    T,
    gas,
    cell: overrides.cell ?? { id: 'test_cell', name: 'Test', ocr: 0.2, ocrLow: 0.1, ocrHigh: 0.4, gcr: 0.1, gcrLow: 0.05, gcrHigh: 0.2, lpr: 0.1, lprLow: 0.05, lprHigh: 0.2, gln: 0.05, glnLow: 0.02, glnHigh: 0.08, evidenceTier: 'A' },
    med: overrides.med ?? { id: 'test_medium', name: 'Test medium' },
    O2eq,
    airO2Eq,
    CO2eq,
    CO2Initial: overrides.CO2Initial ?? CO2eq,
    CO2Boundary: overrides.CO2Boundary ?? CO2eq,
    pHBoundaryMode: overrides.pHBoundaryMode ?? 'closed_headspace_mass_balance',
    geometryMode: overrides.geometryMode ?? 'auto',
    storageMode: overrides.storageMode ?? 'static_tube',
    volume_nL,
    Vaq_uL,
    VoilEmul_uL: overrides.VoilEmul_uL ?? 0.01,
    residualOil_uL: overrides.residualOil_uL ?? 0.01,
    totalEmulsion_uL: overrides.totalEmulsion_uL ?? 0.02,
    totalOil_uL: overrides.totalOil_uL ?? 0.02,
    liquidFill_uL: overrides.liquidFill_uL ?? 0.02,
    vesselArea_mm2: overrides.vesselArea_mm2 ?? 28.27,
    emulsionDepth_mm: overrides.emulsionDepth_mm ?? 0.8,
    residualOilDepth_mm: overrides.residualOilDepth_mm ?? 0.4,
    vessel: overrides.vessel ?? { name: 'test vessel' },
    vesselCapacity_uL: overrides.vesselCapacity_uL ?? 1500,
    vesselDiameter_mm: overrides.vesselDiameter_mm ?? 6,
    tubingLength_mm: overrides.tubingLength_mm ?? 1000,
    filledTubingLength_mm: overrides.filledTubingLength_mm ?? null,
    oil: overrides.oil ?? { capacityRatio: 14 },
    gasHalf: overrides.gasHalf ?? 150,
    oilHalf: overrides.oilHalf ?? 480,
    dropHalf: overrides.dropHalf ?? 10,
    surfaceAccess: overrides.surfaceAccess ?? 0.03,
    centerPenalty: overrides.centerPenalty ?? 1,
    gradientFactor: overrides.gradientFactor ?? 1,
    targetCells,
    lambda,
    N,
    p0: overrides.p0 ?? Math.exp(-lambda),
    p1: overrides.p1 ?? lambda * Math.exp(-lambda),
    empty: overrides.empty ?? Math.exp(-lambda) * N,
    single: overrides.single ?? lambda * Math.exp(-lambda) * N,
    multi: overrides.multi ?? Math.max(0, N * (1 - Math.exp(-lambda) * (1 + lambda))),
    targetProbability: overrides.targetProbability ?? (lambda >= 0 ? Math.exp(-lambda) * Math.pow(lambda, targetCells) / Math.max(1, factorial(targetCells)) : 0),
    occupancy,
    occupiedDroplets: overrides.occupiedDroplets ?? occupancy.occupiedDroplets,
    occupiedFraction: overrides.occupiedFraction ?? occupancy.occupiedFraction,
    bulkInitialCells: overrides.bulkInitialCells ?? occupancy.expectedBulkCells,
    totalCells: overrides.totalCells ?? occupancy.expectedTotalCells,
    initialO2T: overrides.initialO2T ?? airO2Eq,
    initialO2B: overrides.initialO2B ?? airO2Eq,
    initialO2Oil: overrides.initialO2Oil ?? airO2Eq,
    initialO2Res: overrides.initialO2Res ?? airO2Eq,
    initAqO2Pct: overrides.initAqO2Pct ?? 100,
    initOilO2Pct: overrides.initOilO2Pct ?? 100,
    initReservoirO2Pct: overrides.initReservoirO2Pct ?? 100,
    headspace_mL,
    headO2Initial: overrides.headO2Initial ?? dryGasPctToHeadspaceMoles(19.9, headspace_mL, T),
    headCO2Initial: overrides.headCO2Initial ?? dryGasPctToHeadspaceMoles(5, headspace_mL, T),
    atmMode: overrides.atmMode ?? 'closed',
    sub: overrides.sub ?? { glc: 25, gln: 4, lac: 0, bicarb: 26 },
    buffer: overrides.buffer ?? 8,
    pH0: overrides.pH0 ?? 7.4,
    pHFloor: overrides.pHFloor ?? 6.8,
    pHCeiling: overrides.pHCeiling ?? 7.65,
    o2ThresholdMode: overrides.o2ThresholdMode ?? 'absolute_uM',
    o2ThresholdValue: overrides.o2ThresholdValue ?? 1,
    o2Threshold: overrides.o2Threshold ?? thresholdFromMode(overrides.o2ThresholdValue ?? 1, overrides.o2ThresholdMode ?? 'absolute_uM', O2eq, airO2Eq),
    chartO2Reference: overrides.chartO2Reference ?? Math.max(1, airO2Eq, O2eq, overrides.initialO2T ?? airO2Eq),
    rates: overrides.rates ?? { ocr: 0.2, gcr: 0, lpr: 0, gln: 0 },
    rq: overrides.rq ?? 1,
    o2Km_uM: overrides.o2Km_uM ?? 1,
    glucoseFloor: overrides.glucoseFloor ?? 0.1,
    glutamineFloor: overrides.glutamineFloor ?? 0.05,
    prolif: overrides.prolif ?? false,
    dt_h: overrides.dt_h ?? 24,
    lag_h: overrides.lag_h ?? 0,
    maxDays: overrides.maxDays ?? 2,
    logStep: overrides.logStep ?? 30,
    decimals: overrides.decimals ?? 4,
    marginWarning: overrides.marginWarning ?? 12,
    carryingCellsPerNL: overrides.carryingCellsPerNL ?? 300,
    pasteurThreshold_uM: overrides.pasteurThreshold_uM ?? 20,
    pasteurMax: overrides.pasteurMax ?? 1.8,
    rateScenarioSource: overrides.rateScenarioSource ?? { customCell: false, overridesActive: false },
    warnings: [],
    invalid: [],
  };
  return { ...p, ...overrides };
}

function factorial(n) {
  let acc = 1;
  for (let i = 2; i <= n; i += 1) acc *= i;
  return acc;
}

function approx(actual, expected, tol, message) {
  assert(Math.abs(actual - expected) <= tol, `${message}: expected ${expected}, got ${actual}`);
}

function run(name, fn) {
  try {
    fn();
    passCount += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failCount += 1;
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function withMockDom(values, fn) {
  const previousDocument = global.document;
  const previousData = global.DATA;
  const previousModelData = {
    cellLines: { ...DATA.cellLines },
    media: { ...DATA.media },
    oils: { ...DATA.oils },
    additives: { ...DATA.additives },
    refs: Array.isArray(DATA.refs) ? [...DATA.refs] : [],
  };
  const previousWindow = global.window;
  const previousGetComputedStyle = global.getComputedStyle;
  const previousDevicePixelRatio = global.devicePixelRatio;
  const elements = new Map();
  const ensure = (id, value = '') => {
    if (!elements.has(id)) {
      const attrs = new Map();
      elements.set(id, {
        id,
        value,
        textContent: '',
        innerHTML: '',
        style: {},
        dataset: {},
        checked: false,
        type: 'number',
        min: '',
        max: '',
        previousElementSibling: { textContent: id },
        closest: () => null,
        classList: { toggle() {} },
        addEventListener() {},
        getAttribute(name) {
          if (name === 'min') return this.min === '' ? null : String(this.min);
          if (name === 'max') return this.max === '' ? null : String(this.max);
          return attrs.has(name) ? attrs.get(name) : null;
        },
        setAttribute(name, val) {
          attrs.set(name, String(val));
          if (name === 'min' || name === 'max') this[name] = String(val);
        },
        getBoundingClientRect() {
          return { width: 760, height: 520, left: 0, top: 0 };
        },
        getContext() {
          return {
            setTransform() {},
            clearRect() {},
            fillRect() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            stroke() {},
            fillText() {},
            save() {},
            restore() {},
            setLineDash() {},
            drawImage() {},
          };
        },
      });
    }
    return elements.get(id);
  };
  for (const [id, config] of Object.entries(values)) {
    const el = ensure(id, typeof config === 'object' ? config.value ?? '' : config);
    if (typeof config === 'object') Object.assign(el, config);
    else el.value = config;
  }
  global.document = {
    body: { dataset: { release: 'v18-transport-20260715' } },
    getElementById(id) {
      return elements.get(id) || ensure(id);
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) || ensure(selector.slice(1));
      if (selector === 'meta[name="artifact-release"]') return { content: 'v18-transport-20260715' };
      if (selector === 'meta[name="artifact-commit"]') return { content: 'd4032d9863245a89b4113788fed2cea33372da1f' };
      if (selector === 'meta[name="artifact-manifest-sha256"]') return { content: '0F565D0469D0C76F51DC31EF5C39D6EC57B6AF1A1B4D16F721C5254BF4A1E1A5' };
      const labelMatch = selector.match(/^label\[for="(.+)"\]$/);
      if (labelMatch) return { textContent: labelMatch[1] };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input,select') return [...elements.values()];
      if (selector === '[id^="qty_"]') return [...elements.values()].filter((el) => el.id.startsWith('qty_'));
      if (selector === 'input[type="number"],input[type="range"]') {
        return [...elements.values()].filter((el) => el.type === 'number' || el.type === 'range');
      }
      return [];
    },
  };
  global.DATA = {
    cellLines: {
      test_cell: { id: 'test_cell', name: 'Test', ocr: 0.2, gcr: 0.1, lpr: 0.1, gln: 0.05, dt: 24, lag: 4, rq: 1 },
      custom: { id: 'custom', name: 'Custom', ocr: 0, gcr: 0, lpr: 0, gln: 0, dt: 24, lag: 4, rq: 1 },
    },
    media: {
      test_medium: { id: 'test_medium', name: 'Test medium', glc: 25, gln: 4, pyr: 0, bicarb: 26, buffer: 8, lac: 0 },
      custom_medium: { id: 'custom_medium', name: 'Custom medium', glc: 0, gln: 0, pyr: 0, bicarb: 0, buffer: 1, lac: 0 },
    },
    oils: {
      test_oil: { id: 'test_oil', name: 'Test oil', capacityRatio: 14 },
      hfe7500: { id: 'hfe7500', name: 'HFE', capacityRatio: 14 },
      pdms: { id: 'pdms', name: 'PDMS', capacityRatio: 10 },
    },
    additives: {
      test_add: { id: 'test_add', name: 'Test additive', default: 1, checked: false, mod: {}, add: {} },
    },
    refs: [],
  };
  DATA.cellLines = global.DATA.cellLines;
  DATA.media = global.DATA.media;
  DATA.oils = global.DATA.oils;
  DATA.additives = global.DATA.additives;
  DATA.refs = global.DATA.refs;
  global.window = { lastResult: null, addEventListener() {} };
  global.devicePixelRatio = 1;
  global.getComputedStyle = () => ({ getPropertyValue: () => '#000' });
  try {
    return fn({ ensure, elements });
  } finally {
    global.document = previousDocument;
    global.DATA = previousData;
    DATA.cellLines = previousModelData.cellLines;
    DATA.media = previousModelData.media;
    DATA.oils = previousModelData.oils;
    DATA.additives = previousModelData.additives;
    DATA.refs = previousModelData.refs;
    global.window = previousWindow;
    global.getComputedStyle = previousGetComputedStyle;
    global.devicePixelRatio = previousDevicePixelRatio;
  }
}

function baseFormValues(overrides = {}) {
  return {
    temperature: '37',
    headspaceGas: 'co2air',
    cellLine: 'test_cell',
    medium: 'test_medium',
    oilType: 'test_oil',
    customO2: '21',
    customCO2: '5',
    customOCR: '0.2',
    customGCR: '0.1',
    customLPR: '0.1',
    customGlnCR: '0.05',
    customGlucose: '25',
    customGln: '4',
    customBicarb: '26',
    customBuffer: '8',
    totalEmulsion: '0.02',
    residualOil: '0.01',
    gasHalf: '150',
    oilHalf: '480',
    dropHalf: '10',
    maxDays: '2',
    logStep: '30',
    initAqO2Pct: '100',
    initOilO2Pct: '100',
    initReservoirO2Pct: '100',
    initHeadspaceO2Pct: '19.9',
    initHeadspaceCO2Pct: '5',
    glucoseFloor: '0.1',
    glutamineFloor: '0.05',
    carryingCapacity: '300',
    o2Km: '1',
    pasteurThreshold: '20',
    pasteurMax: '1.8',
    targetCells: '1',
    hypoxiaPct: '1',
    lambda: '0.1',
    pH0: '7.4',
    pHFloor: '6.8',
    pHCeiling: '7.65',
    vesselPreset: 'custom',
    vesselPresetEnv: 'custom',
    headspaceVolume: '0.25',
    vesselDiameter: '6',
    tubingLength: '1000',
    volumeT: '0.578',
    pHBoundaryMode: 'closed_headspace_mass_balance',
    geometryMode: 'auto',
    modelTier: 'heuristic',
    halfTimeMode: 'reference_scaled',
    rateTemperatureMode: 'reference_37c_q10',
    atmMode: 'closed',
    centerPenalty: '1',
    gradientFactor: '1',
    storageMode: 'static_tube',
    surfaceAccess: '3',
    bulkO2Mode: 'auto',
    proliferation: 'off',
    doublingTime: '24',
    lagPhase: '4',
    decimals: '4',
    marginWarning: '12',
    warburgOverride: '-1',
    ocrOverride: '',
    gcrOverride: '',
    lprOverride: '',
    glnOverride: '',
    o2ThresholdMode: 'absolute_uM',
    aqueousFraction: '30',
    qty_test_add: { value: '1', type: 'number', closest() { return { querySelector: () => ({ checked: false }) }; } },
    add_test_add: { checked: false, type: 'checkbox', value: 'on' },
    ...overrides,
  };
}

run('closed oxygen mass conserved without cells', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 0,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      rq: 1,
      o2Threshold: -1,
      initialO2T: 220,
      initialO2B: 80,
      initialO2Oil: 0,
      initialO2Res: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      CO2Initial: 0.1,
      CO2Boundary: 0.1,
    })
  );
  assert(r.mass.o2ResidualPct < 1e-6, `unexpected O2 residual ${r.mass.o2ResidualPct}`);
});

run('preoxygenated liquid under nitrogen outgasses into closed headspace', () => {
  const r = Engine.simulate(
    makeParams({
      gas: { o2: 0, co2: 0 },
      O2eq: 0,
      targetCells: 0,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      o2Threshold: -1,
      initialO2T: 204,
      initialO2B: 204,
      initialO2Oil: 204,
      initialO2Res: 204,
      headO2Initial: 0,
      headCO2Initial: 0,
      CO2Initial: 0.1,
      CO2Boundary: 0.1,
      maxDays: 1,
    })
  );
  assert(r.final.headO2 > 0, 'closed headspace failed to gain oxygen from supersaturated liquid');
});

run('closed tracked CO2 accumulates conservatively', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 10,
      lambda: 0,
      rates: { ocr: 1.5, gcr: 0, lpr: 0, gln: 0 },
      rq: 1,
      o2Km_uM: 0.01,
      initialO2T: 1000,
      initialO2B: 1000,
      initialO2Oil: 0,
      initialO2Res: 0,
      headO2Initial: dryGasPctToHeadspaceMoles(21, 0.25, 37),
      headCO2Initial: 0,
      CO2Initial: 0.01,
      CO2Boundary: 0.01,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.02,
      o2Threshold: -1,
    })
  );
  assert(r.mass.co2ResidualPct < 0.2, `unexpected tracked CO2 residual ${r.mass.co2ResidualPct}`);
  assert(r.final.headCO2 > 0, 'closed headspace failed to retain produced CO2');
});

run('low-lambda carrying capacity uses occupied droplets only', () => {
  const p = makeParams({
    lambda: 0.1,
    targetCells: 1,
    prolif: true,
    dt_h: 1,
    lag_h: 0,
    carryingCellsPerNL: 100,
    volume_nL: 1,
    N: 1000,
  });
  const bulkAtSaturation = bulkCellsAt(p.occupancy, 1e6, p);
  const occupiedCapacity = p.occupiedDroplets * p.carryingCellsPerNL * p.volume_nL;
  const emptyDropletCapacity = (p.N - 1) * p.carryingCellsPerNL * p.volume_nL;
  approx(bulkAtSaturation, occupiedCapacity, occupiedCapacity * 0.01, 'bulk carrying capacity should track occupied droplets');
  assert(bulkAtSaturation < emptyDropletCapacity * 0.2, 'bulk carrying capacity still behaves like all droplets are occupied');
});

run('droplet exchange scales with droplet size', () => {
  const small = geometryScales(makeParams({ volume_nL: 0.07 }));
  const large = geometryScales(makeParams({ volume_nL: 7 }));
  assert(small.dropTarget > large.dropTarget * 4, `expected strong A/V scaling, got ${small.dropTarget} vs ${large.dropTarget}`);
});

run('finite-pair half-time halves the equal-capacity concentration difference', () => {
  const r = Engine.simulate(
    makeParams({
      halfTimeMode: 'measured_effective',
      targetCells: 0,
      lambda: 0,
      volume_nL: 1,
      Vaq_uL: 0.001,
      totalEmulsion_uL: 0.002,
      liquidFill_uL: 0.002,
      VoilEmul_uL: 0.001,
      residualOil_uL: 0,
      totalOil_uL: 0.001,
      oil: { capacityRatio: 1 },
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      initialO2T: 0,
      initialO2B: 0,
      initialO2Oil: 100,
      initialO2Res: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 10,
      atmMode: 'closed',
      headspace_mL: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: -1,
      maxDays: 10 / (24 * 60),
    })
  );
  approx(r.final.O2T, 25, 0.5, 'target compartment should reach the equal-capacity analytical value');
  approx(r.final.O2Oil, 75, 0.5, 'oil compartment should reach the equal-capacity analytical value');
  approx(r.final.O2Oil - r.final.O2T, 50, 0.75, 'concentration difference should halve after one entered half-time');
});

run('finite-pair half-time halves the unequal-capacity concentration difference', () => {
  const r = Engine.simulate(
    makeParams({
      halfTimeMode: 'measured_effective',
      targetCells: 0,
      lambda: 0,
      volume_nL: 1,
      Vaq_uL: 0.001,
      totalEmulsion_uL: 0.003,
      liquidFill_uL: 0.003,
      VoilEmul_uL: 0.002,
      residualOil_uL: 0,
      totalOil_uL: 0.002,
      oil: { capacityRatio: 1 },
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      initialO2T: 0,
      initialO2B: 0,
      initialO2Oil: 90,
      initialO2Res: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 10,
      atmMode: 'closed',
      headspace_mL: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: -1,
      maxDays: 10 / (24 * 60),
    })
  );
  approx(r.final.O2T, 30, 0.5, 'target compartment should match the unequal-capacity analytical value');
  approx(r.final.O2Oil, 75, 0.5, 'oil compartment should match the unequal-capacity analytical value');
  approx(r.final.O2Oil - r.final.O2T, 45, 0.75, 'unequal-capacity concentration difference should halve after one entered half-time');
});

run('infinite-boundary half-time retains the entered one-compartment relaxation time', () => {
  const r = Engine.simulate(
    makeParams({
      halfTimeMode: 'measured_effective',
      targetCells: 0,
      lambda: 0,
      volume_nL: 1,
      Vaq_uL: 0.001,
      VoilEmul_uL: 0,
      residualOil_uL: 0.001,
      totalOil_uL: 0.001,
      oil: { capacityRatio: 1 },
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      O2eq: 100,
      initialO2T: 0,
      initialO2B: 0,
      initialO2Oil: 0,
      initialO2Res: 0,
      gasHalf: 10,
      oilHalf: 1e9,
      dropHalf: 1e9,
      atmMode: 'incubator',
      headspace_mL: 0.25,
      o2Threshold: -1,
      maxStepMin: 0.05,
      maxDays: 10 / (24 * 60),
    })
  );
  approx(r.final.O2Res, 50, 0.1, 'finite compartment should relax halfway toward the boundary after one entered half-time');
});

run('event timing is interpolated instead of quantized to 0.5 min', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 1,
      lambda: 0,
      rates: { ocr: 2, gcr: 0, lpr: 0, gln: 0 },
      o2Km_uM: 1e-6,
      initialO2T: 7.3,
      initialO2B: 7.3,
      initialO2Oil: 0,
      initialO2Res: 0,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: 1,
      maxDays: 0.01,
      headspace_mL: 0,
      atmMode: 'closed',
    })
  );
  approx(r.safeMin, 3.15, 0.15, 'interpolated endpoint time');
  assert(Math.abs((r.safeMin / 0.5) - Math.round(r.safeMin / 0.5)) > 0.05, `event time ${r.safeMin} still looks quantized to 0.5 min`);
});

run('partial-step O2 endpoint keeps mass bookkeeping consistent', () => {
  const r = Engine.simulate(
    makeParams({
      volume_nL: 1,
      Vaq_uL: 0.001,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      totalEmulsion_uL: 0.001,
      targetCells: 1,
      lambda: 0,
      rates: { ocr: 2, gcr: 0, lpr: 0, gln: 0 },
      o2Km_uM: 1e-6,
      initialO2T: 1,
      initialO2B: 1,
      initialO2Oil: 0,
      initialO2Res: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: 0.5,
      maxDays: 0.01,
      atmMode: 'closed',
      headspace_mL: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
    })
  );
  approx(r.safeMin, 0.25, 0.05, 'partial-step endpoint time');
  assert(r.mass.o2ResidualPct < 1e-3, `partial-step bookkeeping residual too large: ${r.mass.o2ResidualPct}`);
});

run('glucose overshoot uses raw trial concentration for event timing', () => {
  const r = Engine.simulate(
    makeParams({
      volume_nL: 0.07,
      Vaq_uL: 0.00007,
      totalEmulsion_uL: 0.00007,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      targetCells: 50,
      lambda: 0,
      rates: { ocr: 0, gcr: 2, lpr: 0, gln: 0 },
      initialO2T: 100,
      initialO2B: 100,
      initialO2Oil: 0,
      initialO2Res: 0,
      sub: { glc: 0.4, gln: 10, lac: 0, bicarb: 0 },
      glucoseFloor: 0.1,
      headO2Initial: 0,
      headCO2Initial: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.01,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    })
  );
  approx(r.safeMin, 0.21, 0.03, 'glucose crossing time should match linear depletion');
  assert.strictEqual(r.limiter, 'Glucose');
});

run('only earliest event is retained when multiple thresholds fall in one step', () => {
  const r = Engine.simulate(
    makeParams({
      volume_nL: 0.07,
      Vaq_uL: 0.00007,
      totalEmulsion_uL: 0.00007,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      targetCells: 50,
      lambda: 0,
      rates: { ocr: 0, gcr: 2, lpr: 0, gln: 1.4 },
      initialO2T: 100,
      initialO2B: 100,
      initialO2Oil: 0,
      initialO2Res: 0,
      sub: { glc: 0.4, gln: 0.35, lac: 0, bicarb: 0 },
      glucoseFloor: 0.1,
      glutamineFloor: 0.05,
      headO2Initial: 0,
      headCO2Initial: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.01,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    })
  );
  assert.strictEqual(r.limiter, 'Glucose');
  assert(r.events.Glucose != null, 'earliest glucose event missing');
  assert.strictEqual(r.events.Glutamine, null, 'later glutamine event should not be retained after first stop');
});

run('zero headspace disables gas transfer sink', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 0,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      initialO2T: 0,
      initialO2B: 0,
      initialO2Oil: 0,
      initialO2Res: 100,
      headspace_mL: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      CO2Initial: 0.1,
      CO2Boundary: 0.1,
      maxDays: 0.2,
    })
  );
  approx(r.final.headO2, 0, 1e-9, 'zero-volume headspace should remain empty');
  approx(r.final.O2Res, 100, 1e-6, 'reservoir O2 should not leak into nonexistent headspace');
});

run('fixed CO2 reservoir is not limited by finite headspace moles', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 0,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      pHBoundaryMode: 'fixed_starting_pH_boundary',
      CO2Initial: 0.1,
      CO2Boundary: 2,
      headCO2Initial: 0,
      headspace_mL: 0.25,
      gasHalf: 10,
      oilHalf: 10,
      dropHalf: 0.1,
      maxDays: 0.02,
      initialO2T: 1,
      initialO2B: 1,
      initialO2Oil: 1,
      initialO2Res: 1,
      o2Threshold: 0,
    })
  );
  assert(r.final.CO2T > 0.1, 'fixed external CO2 reservoir failed to deliver CO2');
  approx(r.final.headCO2, 0, 1e-9, 'fixed external CO2 reservoir should not use finite headspace bookkeeping');
});

run('signed flux diagnostics distinguish supply from outward loss', () => {
  const p = makeParams({
    gas: { o2: 0, co2: 0 },
    O2eq: 0,
    initialO2T: 0,
    initialO2B: 0,
    initialO2Oil: 50,
    initialO2Res: 50,
    headO2Initial: 0,
  });
  const geom = geometryScales(p);
  const flux = initialFlux(p, p.volume_nL, Math.max(0, p.Vaq_uL * 1000 - p.volume_nL), p.VoilEmul_uL * 1000 * p.oil.capacityRatio, p.residualOil_uL * 1000 * p.oil.capacityRatio, geom);
  assert.strictEqual(flux.boundaryIntoLiquid, 0, 'outward boundary loss should not count as inward supply');
  assert(flux.boundaryOutOfLiquid > 0, 'expected outward boundary loss');
});

run('nonlinear Michaelis-Menten oxygen event matches analytical solution closely', () => {
  const r = Engine.simulate(
    makeParams({
      volume_nL: 1,
      Vaq_uL: 0.001,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      totalEmulsion_uL: 0.001,
      targetCells: 1,
      lambda: 0,
      rates: { ocr: 1, gcr: 0, lpr: 0, gln: 0 },
      o2Km_uM: 1,
      initialO2T: 1,
      initialO2B: 1,
      initialO2Oil: 0,
      initialO2Res: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: 0.5,
      maxDays: 0.05,
      atmMode: 'closed',
      headspace_mL: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
    })
  );
  const analytical = 0.5 + Math.log(2);
  approx(r.safeMin, analytical, 0.03, 'Michaelis-Menten crossing time');
});

run('closed finite headspace CO2 boundary follows headspace moles', () => {
  const p = makeParams({
    pHBoundaryMode: 'closed_headspace_mass_balance',
    headspace_mL: 0.25,
    headCO2Initial: dryGasPctToHeadspaceMoles(10, 0.25, 37),
  });
  const high = co2HeadEq({ headCO2: p.headCO2Initial }, p);
  const low = co2HeadEq({ headCO2: p.headCO2Initial / 10 }, p);
  assert(high > low * 5, `closed-headspace CO2 boundary should scale with headspace moles, got ${high} vs ${low}`);
});

run('initial headspace composition above 100% is rejected', () => {
  withMockDom(
    baseFormValues({
      initHeadspaceO2Pct: '100',
      initHeadspaceCO2Pct: '100',
    }),
    () => {
      const invalid = hardValidateInputs({ invalid: [], vessel: { id: 'custom' }, liquidFill_uL: 0, vesselCapacity_uL: 0 });
      assert(invalid.some((msg) => msg.includes('Initial headspace O₂ + CO₂ cannot exceed 100%')), 'missing initial-headspace sum validation');
    }
  );
});

run('zero lag and disabled Pasteur effect survive parameter collection', () => {
  withMockDom(
    baseFormValues({
      lagPhase: '0',
      pasteurThreshold: '0',
    }),
    () => {
      const p = gatherParams();
      assert.strictEqual(p.lag_h, 0, 'lag phase zero was replaced');
      assert.strictEqual(p.pasteurThreshold_uM, 0, 'Pasteur threshold zero was replaced');
    }
  );
});

run('negative additive quantity is rejected', () => {
  withMockDom(
    baseFormValues({
      qty_test_add: {
        id: 'qty_test_add',
        value: '-1',
        type: 'number',
        previousElementSibling: { textContent: 'Test additive' },
        closest() {
          return { querySelector: () => ({ checked: true }) };
        },
      },
      add_test_add: { checked: true, type: 'checkbox', value: 'on' },
    }),
    () => {
      const invalid = hardValidateInputs({ invalid: [], vessel: { id: 'custom' }, liquidFill_uL: 0, vesselCapacity_uL: 0 });
      assert(invalid.some((msg) => msg.includes('nonnegative')), 'negative additive quantity was not rejected');
    }
  );
});

run('public release identity is consistent', () => {
  const release = 'v18-transport-20260715';
  assert(html.includes(`release: ${release}`), 'artifact comment release mismatch');
  assert(html.includes(`data-release="${release}"`), 'body release mismatch');
  assert(html.includes(`content="${release}"`), 'meta release mismatch');
  assert(html.includes('Metabolic Depletion Forecaster v18'), 'title release mismatch');
  assert.strictEqual(STATE_KEY, 'metabolic-forecaster-v18-transport-20260715', 'state key mismatch');
  assert(readme.includes(release), 'README release mismatch');
  assert(limitations.includes(release), 'limitations release mismatch');
  assert(!html.includes('v17-audit-20260715'), 'old release identity still present');
});

run('external CO2 boundary marks closed CO2 residual not applicable', () => {
  const r = Engine.simulate(
    makeParams({
      pHBoundaryMode: 'fixed_starting_pH_boundary',
      CO2Initial: 0.1,
      CO2Boundary: 2,
      headCO2Initial: 0,
      headspace_mL: 0.25,
      gasHalf: 10,
      oilHalf: 10,
      dropHalf: 0.1,
      maxDays: 0.02,
      initialO2T: 1,
      initialO2B: 1,
      initialO2Oil: 1,
      initialO2Res: 1,
      o2Threshold: 0,
    })
  );
  assert.strictEqual(r.mass.closedCarbonBalance, false, 'fixed external CO2 boundary should not claim closed carbon balance');
  assert.strictEqual(r.mass.co2ResidualPct, null, 'CO2 residual should be not applicable for external boundary mode');
});

run('high-rate pH endpoint is refined onto the threshold state', () => {
  const r = Engine.simulate(
    makeParams({
      volume_nL: 0.07,
      Vaq_uL: 0.00007,
      totalEmulsion_uL: 0.00007,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      targetCells: 50,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 100, gln: 0 },
      initialO2T: 200,
      initialO2B: 200,
      initialO2Oil: 0,
      initialO2Res: 0,
      sub: { glc: 25, gln: 4, lac: 0, bicarb: 26 },
      buffer: 8,
      pH0: 7.4,
      pHFloor: 6.8,
      headO2Initial: 0,
      headCO2Initial: dryGasPctToHeadspaceMoles(5, 0.25, 37),
      CO2Initial: 1.3535,
      CO2Boundary: 1.3535,
      pHBoundaryMode: 'fixed_starting_pH_boundary',
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.01,
      atmMode: 'closed',
      headspace_mL: 0.25,
      o2Threshold: 0,
    })
  );
  approx(r.final.pH, 6.8, 0.01, 'accepted pH endpoint state should lie on the pH floor');
});

run('total aqueous volume must cover at least one target droplet', () => {
  withMockDom(
    baseFormValues({
      totalEmulsion: '0.000007',
      aqueousFraction: '1',
      volumeT: '1',
    }),
    () => {
      const p = gatherParams();
      assert(p.invalid.some((msg) => msg.includes('Total aqueous volume must be at least one target-droplet volume')), 'missing aqueous-volume validity check');
    }
  );
});

run('fractional target cells are rejected without rounding', () => {
  withMockDom(baseFormValues({ targetCells: '1.5' }), () => {
    const p = gatherParams();
    assert.strictEqual(p.targetCells, 1.5, 'fractional target cells should not be rounded');
    assert(p.invalid.some((msg) => msg.includes('must be an integer')), 'fractional target-cell validation missing');
  });
});

run('fractional decimals are rejected', () => {
  withMockDom(baseFormValues({ decimals: '3.5' }), () => {
    const p = gatherParams();
    assert.strictEqual(p.decimals, 3.5, 'fractional decimals should not be rounded');
    assert(p.invalid.some((msg) => msg.includes('Decimals must be an integer')), 'fractional decimals validation missing');
  });
});

run('inactive custom OCR is ignored when a built-in line is selected', () => {
  withMockDom(baseFormValues({ cellLine: 'test_cell', customOCR: '-1' }), () => {
    const p = gatherParams();
    assert(!p.invalid.some((msg) => msg.includes('Custom OCR')), 'inactive custom OCR should not be validated');
  });
});

run('inactive custom gas values are ignored when a preset gas is selected', () => {
  withMockDom(baseFormValues({ headspaceGas: 'co2air', customO2: '200', customCO2: '200' }), () => {
    const p = gatherParams();
    assert(!p.invalid.some((msg) => msg.includes('Custom gas')), 'inactive custom gas fields should not be validated');
  });
});

run('active custom OCR is rejected when the custom line is selected', () => {
  withMockDom(baseFormValues({ cellLine: 'custom', customOCR: '-1' }), () => {
    const p = gatherParams();
    assert(p.invalid.some((msg) => msg.includes('Custom OCR')), 'active custom OCR validation missing');
  });
});

run('incompatible finite-headspace carbon mode is rejected under incubator gas mode', () => {
  withMockDom(baseFormValues({ atmMode: 'incubator', pHBoundaryMode: 'closed_headspace_mass_balance' }), () => {
    const p = gatherParams();
    assert(p.invalid.some((msg) => msg.includes('Finite headspace CO₂ mass balance requires a closed gas boundary')), 'incompatible carbon/gas mode should be blocked');
  });
});

run('lambda and target-cell upper bounds are enforced without silent coercion', () => {
  withMockDom(
    baseFormValues({
      lambda: '100',
      targetCells: '100',
    }),
    () => {
      const p = gatherParams();
      assert.strictEqual(p.lambda, 100, 'lambda was silently coerced');
      assert.strictEqual(p.targetCells, 100, 'target cell count was silently coerced');
      assert(p.invalid.some((msg) => msg.includes('Occupancy λ')), 'lambda upper-bound validation missing');
      assert(p.invalid.some((msg) => msg.includes('Evaluated droplet cell count')), 'target-cell upper-bound validation missing');
    }
  );
});

run('measured-effective half-time mode bypasses geometry scaling', () => {
  const ref = Engine.simulate(makeParams({ volume_nL: 0.07, dropHalf: 10, halfTimeMode: 'reference_scaled', maxDays: 0.01 }));
  const eff = Engine.simulate(makeParams({ volume_nL: 0.07, dropHalf: 10, halfTimeMode: 'measured_effective', maxDays: 0.01 }));
  assert(ref.effective.dropTargetHalf < 6, `reference-scaled droplet half-time should shrink for 70 pL, got ${ref.effective.dropTargetHalf}`);
  approx(eff.effective.dropTargetHalf, 10, 0.05, 'measured-effective droplet half-time should remain unchanged');
});

run('timestep refinement changes endpoint only slightly', () => {
  const coarse = Engine.simulate(
    makeParams({
      volume_nL: 1,
      Vaq_uL: 0.001,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      totalEmulsion_uL: 0.001,
      targetCells: 1,
      lambda: 0,
      rates: { ocr: 1, gcr: 0, lpr: 0, gln: 0 },
      o2Km_uM: 1,
      initialO2T: 1,
      initialO2B: 1,
      initialO2Oil: 0,
      initialO2Res: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: 0.5,
      maxDays: 0.05,
      atmMode: 'closed',
      headspace_mL: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxStepMin: 0.5,
    })
  );
  const fine = Engine.simulate(
    makeParams({
      volume_nL: 1,
      Vaq_uL: 0.001,
      VoilEmul_uL: 0,
      residualOil_uL: 0,
      totalEmulsion_uL: 0.001,
      targetCells: 1,
      lambda: 0,
      rates: { ocr: 1, gcr: 0, lpr: 0, gln: 0 },
      o2Km_uM: 1,
      initialO2T: 1,
      initialO2B: 1,
      initialO2Oil: 0,
      initialO2Res: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      o2Threshold: 0.5,
      maxDays: 0.05,
      atmMode: 'closed',
      headspace_mL: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxStepMin: 0.05,
    })
  );
  assert(Math.abs(coarse.safeMin - fine.safeMin) < 0.05, `endpoint should converge under timestep refinement, got ${coarse.safeMin} vs ${fine.safeMin}`);
});

run('pH ceiling endpoint is refined onto the threshold state', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 0,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      initialO2T: 200,
      initialO2B: 200,
      initialO2Oil: 200,
      initialO2Res: 200,
      sub: { glc: 25, gln: 4, lac: 0, bicarb: 26 },
      pH0: 7.2,
      pHCeiling: 7.55,
      CO2Initial: 5,
      CO2Boundary: 0.2,
      pHBoundaryMode: 'fixed_starting_pH_boundary',
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 0.5,
      maxDays: 0.5,
      atmMode: 'incubator',
      o2Threshold: 0,
    })
  );
  approx(r.final.pH, 7.55, 1e-3, 'accepted pH-ceiling endpoint should lie on the pH ceiling');
});

run('glutamine overshoot uses raw trial concentration for event timing', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 1,
      lambda: 0,
      sub: { glc: 25, gln: 0.06, lac: 0, bicarb: 26 },
      glutamineFloor: 0.05,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 60 },
      initialO2T: 200,
      initialO2B: 200,
      initialO2Oil: 0,
      initialO2Res: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.01,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    })
  );
  assert(r.safeMin > 0 && r.safeMin < 0.5, `glutamine endpoint should be refined within the step, got ${r.safeMin}`);
});

run('measured-effective half-times ignore vessel geometry changes', () => {
  const a = Engine.simulate(makeParams({ halfTimeMode: 'measured_effective', dropHalf: 10, gasHalf: 120, oilHalf: 240, vesselArea_mm2: 10, emulsionDepth_mm: 10, volume_nL: 0.07, maxDays: 0.01 }));
  const b = Engine.simulate(makeParams({ halfTimeMode: 'measured_effective', dropHalf: 10, gasHalf: 120, oilHalf: 240, vesselArea_mm2: 300, emulsionDepth_mm: 0.2, volume_nL: 5, maxDays: 0.01 }));
  approx(a.effective.gasResHalf, b.effective.gasResHalf, 1e-9, 'measured-effective gas half-time changed');
  approx(a.effective.oilHalf, b.effective.oilHalf, 1e-9, 'measured-effective oil half-time changed');
  approx(a.effective.dropTargetHalf, b.effective.dropTargetHalf, 1e-9, 'measured-effective droplet half-time changed');
});

run('reference-scaled half-times respond to droplet size and vessel geometry', () => {
  const small = Engine.simulate(makeParams({ halfTimeMode: 'reference_scaled', dropHalf: 10, volume_nL: 0.07, maxDays: 0.01 }));
  const large = Engine.simulate(makeParams({ halfTimeMode: 'reference_scaled', dropHalf: 10, volume_nL: 7, maxDays: 0.01 }));
  assert(small.effective.dropTargetHalf < large.effective.dropTargetHalf, 'reference scaling should change droplet half-time with droplet size');
});

run('anoxic selected-gas threshold is rejected for pure nitrogen', () => {
  withMockDom(
    baseFormValues({
      headspaceGas: 'nitrogen',
      o2ThresholdMode: 'selected_pct',
      atmMode: 'incubator',
    }),
    () => {
      const p = gatherParams();
      assert(p.invalid.some((msg) => msg.includes('selected-gas O₂ thresholds are invalid')), 'pure nitrogen selected-gas threshold should be blocked');
    }
  );
});

run('anoxic selected-gas threshold is rejected for 95% N2 / 5% CO2', () => {
  withMockDom(
    baseFormValues({
      headspaceGas: 'n2co2',
      o2ThresholdMode: 'selected_pct',
      atmMode: 'incubator',
    }),
    () => {
      const p = gatherParams();
      assert(p.invalid.some((msg) => msg.includes('selected-gas O₂ thresholds are invalid')), '95% N2 / 5% CO2 selected-gas threshold should be blocked');
    }
  );
});

run('empty droplets keep their oxygen when oil exchange is negligible', () => {
  const lambda = 0.1;
  const occupancy = buildOccupancyModel(lambda, 1000, 1);
  const r = Engine.simulate(
    makeParams({
      bulkO2Mode: 'grouped_transport_limited',
      lambda,
      N: 1000,
      occupancy,
      Vaq_uL: 1,
      targetCells: 0,
      rates: { ocr: 200, gcr: 0, lpr: 0, gln: 0 },
      initialO2T: 10,
      initialO2B: 10,
      initialO2Oil: 0,
      initialO2Res: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.1,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    })
  );
  assert(r.final.O2Empty > 9.9, `empty droplets should keep oxygen when decoupled from oil, got ${r.final.O2Empty}`);
  assert(r.final.O2BulkOccupied < 9, `occupied droplets should consume only their own oxygen, got ${r.final.O2BulkOccupied}`);
});

run('preset synchronization resets PTFE kinetics when returning to a static tube', () => {
  withMockDom(baseFormValues({ vesselPreset: 'ptfe_600', vesselPresetEnv: 'ptfe_600', storageMode: 'ptfe_tubing' }), () => {
    applyVesselPreset();
    assert.strictEqual(String(global.document.getElementById('gasHalf').value), '10');
    global.document.getElementById('vesselPreset').value = 'eppendorf_1_5';
    global.document.getElementById('vesselPresetEnv').value = 'eppendorf_1_5';
    applyVesselPreset();
    assert.strictEqual(String(global.document.getElementById('storageMode').value), 'static_tube');
    assert.strictEqual(String(global.document.getElementById('gasHalf').value), '150');
    assert.strictEqual(String(global.document.getElementById('dropHalf').value), '10');
  });
});

run('reservoir preset selects a vessel large enough for its liquid fill', () => {
  withMockDom(baseFormValues(), () => {
    applyPreset('reservoir');
    const p = gatherParams();
    assert.strictEqual(p.vessel.id, 'falcon_15', 'reservoir preset should use 15 mL conical tube');
    assert(!p.invalid.some((msg) => msg.includes('exceeds')), 'reservoir preset should not overflow its vessel');
  });
});

run('closed preset does not rely on a stale manual headspace value', () => {
  withMockDom(baseFormValues({ headspaceVolume: '9.99' }), () => {
    applyPreset('closed');
    const p = gatherParams();
    assert.strictEqual(p.vessel.id, 'eppendorf_1_5');
    assert(p.headspace_mL < 1.0, `closed preset should use auto headspace from vessel geometry, got ${p.headspace_mL}`);
  });
});

run('rate temperature interpretation applies Q10 only in reference mode', () => {
  withMockDom(baseFormValues({ temperature: '33', rateTemperatureMode: 'reference_37c_q10' }), () => {
    const p = gatherParams();
    assert(p.q10Factor.ocr < 1, '33 C reference mode should reduce OCR via Q10');
  });
  withMockDom(baseFormValues({ temperature: '42', rateTemperatureMode: 'reference_37c_q10' }), () => {
    const p = gatherParams();
    assert(p.q10Factor.ocr > 1, '42 C reference mode should increase OCR via Q10');
  });
  withMockDom(baseFormValues({ temperature: '33', rateTemperatureMode: 'measured_selected_temperature' }), () => {
    const p = gatherParams();
    approx(p.q10Factor.ocr, 1, 1e-12, 'measured-temperature mode should not apply OCR Q10');
    approx(p.q10Factor.gcr, 1, 1e-12, 'measured-temperature mode should not apply GCR Q10');
  });
});

run('deterministic rate scenarios use stored low/nominal/high bounds', () => {
  const p = makeParams({
    cell: { id: 'bounded', name: 'Bounded', ocr: 2, ocrLow: 1, ocrHigh: 4, gcr: 0, gcrLow: 0, gcrHigh: 0, lpr: 0, lprLow: 0, lprHigh: 0, gln: 0, glnLow: 0, glnHigh: 0, evidenceTier: 'A' },
    rates: { ocr: 2, gcr: 0, lpr: 0, gln: 0 },
    initialO2T: 10,
    initialO2B: 10,
    initialO2Oil: 0,
    initialO2Res: 0,
    VoilEmul_uL: 0,
    residualOil_uL: 0,
    targetCells: 1,
    lambda: 0,
    o2Threshold: 0,
    headspace_mL: 0,
    gasHalf: 1e9,
    oilHalf: 1e9,
    dropHalf: 1e9,
    maxDays: 0.01,
  });
  const scenarios = buildRateScenarioResults(p);
  assert.strictEqual(scenarios.length, 3, 'expected low/nominal/high scenarios');
  assert.strictEqual(scenarios[0].available, true, 'stored bounds should be available');
  approx(scenarios[0].rates.ocr, 1, 1e-9, 'low-demand OCR should use low bound');
  approx(scenarios[1].rates.ocr, 2, 1e-9, 'nominal OCR should use nominal rate');
  approx(scenarios[2].rates.ocr, 4, 1e-9, 'high-demand OCR should use high bound');
  assert(scenarios[0].final.O2T >= scenarios[1].final.O2T, 'low-demand scenario should leave at least as much final O2 as nominal');
  assert(scenarios[1].final.O2T >= scenarios[2].final.O2T, 'nominal scenario should leave at least as much final O2 as high-demand');
});

run('deterministic rate scenarios fall back to current rates when custom or override rates are active', () => {
  const p = makeParams({
    cell: { id: 'custom', name: 'Custom', ocr: 2, gcr: 1, lpr: 1, gln: 0.5 },
    rates: { ocr: 3, gcr: 1.5, lpr: 2, gln: 0.75 },
    rateScenarioSource: { customCell: true, overridesActive: true },
  });
  const scenarios = buildRateScenarioResults(p);
  assert(scenarios.every((s) => s.available === (s.id === 'nominal')), 'custom/override cases should only have exact nominal bounds');
  assert(scenarios.every((s) => Math.abs(s.rates.ocr - 3) < 1e-12), 'fallback scenarios should reuse current effective rates');
});

run('JSON export payload includes reproducibility metadata and conductances', () => {
  withMockDom(baseFormValues(), () => {
    const p = gatherParams();
    const r = Engine.simulate(p);
    r.rateScenarios = buildRateScenarioResults(p);
    const payload = buildExportPayload(r);
    assert.strictEqual(payload.release, 'v18-transport-20260715', 'export release mismatch');
    assert.strictEqual(payload.artifactCommit, 'd4032d9863245a89b4113788fed2cea33372da1f', 'export artifact commit mismatch');
    assert(payload.auditManifestSha256 && payload.auditManifestSha256.length === 64, 'export manifest hash missing');
    assert(payload.rawInputs && payload.rawInputs.cellLine === 'test_cell', 'raw input snapshot missing');
    assert(payload.effectiveParameters && payload.effectiveParameters.cell.id === 'test_cell', 'effective parameters missing');
    assert(payload.parameterProvenance && payload.parameterProvenance.cellLine.source, 'parameter provenance missing');
    assert(payload.actualConductances && payload.actualConductances.fmolPerMinPerUM.dropTarget >= 0, 'conductance summary missing');
    assert(payload.solverTolerances && payload.solverTolerances.rootMaxIterationsPerEvent === 36, 'solver tolerances missing');
    assert(Array.isArray(payload.warnings), 'export warnings missing');
    assert(Array.isArray(payload.rateScenarios) && payload.rateScenarios.length === 3, 'export rate scenarios missing');
    assert.strictEqual(typeof payload.trackedCarbonResidualApplicable, 'boolean', 'tracked-carbon applicability missing');
  });
});

run('generic min/max enforcement catches temperature, surface exposure, and decimals', () => {
  withMockDom(
    baseFormValues({
      temperature: '50',
      surfaceAccess: '200',
      decimals: '20',
    }),
    () => {
      const p = gatherParams();
      assert(p.invalid.some((msg) => msg.includes('Temperature')), 'temperature max validation missing');
      assert(p.invalid.some((msg) => msg.includes('Direct exposed emulsion oil')), 'surface access max validation missing');
      assert(p.invalid.some((msg) => msg.includes('Decimals')), 'decimals max validation missing');
    }
  );
});

run('cell database audit reports no remaining duplicate selectable names', () => {
  assert.strictEqual(CELL_DATABASE_ISSUES.length, 0, CELL_DATABASE_ISSUES.join('\n'));
  assert.strictEqual(auditCellDatabase(DATA.cellLines).length, 0, 'cell database audit should pass');
});

run('cell database metadata fixes HeLa and downgrades NIH 3T3 confidence', () => {
  assert(/Cervix/i.test(DATA.cellLines.hela.group), `HeLa group should be cervix, got ${DATA.cellLines.hela.group}`);
  assert(!/Lung/i.test(DATA.cellLines.hela.rateBasis), `HeLa rate basis should not mention lung fallback, got ${DATA.cellLines.hela.rateBasis}`);
  assert.strictEqual(DATA.cellLines.nih3t3.rateTier, 'C', 'NIH 3T3 should not remain Tier A');
  assert(!/Human MSC\/ASC/i.test(DATA.cellLines.nih3t3.rateBasis), 'NIH 3T3 basis should not claim human MSC/ASC Tier A evidence');
});

run('solver accepted-step budget fails gracefully', () => {
  const r = Engine.simulate(
    makeParams({
      maxDays: 10,
      maxAcceptedSteps: 2,
      gasHalf: 0.1,
      oilHalf: 0.1,
      dropHalf: 0.1,
      o2Threshold: 0,
    })
  );
  assert(r.error && r.error.includes('accepted-step budget exceeded'), `expected solver budget error, got ${r.error}`);
});

run('workload estimator flags very expensive configurations', () => {
  const estimate = estimateSolverWorkload(makeParams({ maxDays: 14, gasHalf: 0.1, oilHalf: 0.1, dropHalf: 0.1 }));
  assert(estimate.estimatedSteps > 1000, 'workload estimate should increase for fast-kinetic long-horizon runs');
});

run('auto bulk O2 matches the shared mean-field limit when exchange is fast', () => {
  const base = makeParams({
    bulkO2Mode: 'auto',
    lambda: 0.1,
    dropHalf: 0.01,
    gasHalf: 1e9,
    oilHalf: 1e9,
    rates: { ocr: 2, gcr: 0, lpr: 0, gln: 0 },
    maxDays: 0.01,
    o2Threshold: 0,
  });
  const auto = Engine.simulate(base);
  const shared = Engine.simulate({ ...base, bulkO2Mode: 'shared_mean_field' });
  assert.strictEqual(auto.bulkO2Regime.selectedMode, 'shared_mean_field', 'auto mode should stay shared when exchange is fast');
  approx(auto.safeMin, shared.safeMin, 1e-9, 'auto mode should match the shared limit');
});

run('grouped bulk O2 matches the isolated-droplet limit when exchange is slow', () => {
  const lambda = 0.1;
  const occupancy = buildOccupancyModel(lambda, 1000, 0);
  const base = makeParams({
    bulkO2Mode: 'grouped_transport_limited',
    lambda,
    N: 1000,
    occupancy,
    Vaq_uL: 1,
    targetCells: 0,
    dropHalf: 1e9,
    gasHalf: 1e9,
    oilHalf: 1e9,
    rates: { ocr: 200, gcr: 0, lpr: 0, gln: 0 },
    initialO2T: 10,
    initialO2B: 10,
    initialO2Oil: 0,
    initialO2Res: 0,
    maxDays: 0.1,
    atmMode: 'closed',
    headspace_mL: 0,
    o2Threshold: 0,
  });
  const grouped = Engine.simulate(base);
  assert.strictEqual(grouped.bulkO2Regime.selectedMode, 'grouped_transport_limited', 'grouped mode should stay grouped');
  assert(grouped.final.O2Empty > 9.9, `empty droplets should keep near-initial oxygen in the isolated-droplet limit, got ${grouped.final.O2Empty}`);
  assert(grouped.final.O2BulkOccupied < 9, `occupied droplets should deplete their own oxygen in the isolated-droplet limit, got ${grouped.final.O2BulkOccupied}`);
});

run('grouped bulk O2 converges to the shared mean-field limit when exchange is fast', () => {
  const base = makeParams({
    bulkO2Mode: 'grouped_transport_limited',
    lambda: 0.1,
    dropHalf: 0.01,
    gasHalf: 1e9,
    oilHalf: 1e9,
    rates: { ocr: 2, gcr: 0, lpr: 0, gln: 0 },
    maxDays: 0.01,
    o2Threshold: 0,
  });
  const grouped = Engine.simulate(base);
  const shared = Engine.simulate({ ...base, bulkO2Mode: 'shared_mean_field' });
  approx(grouped.safeMin, shared.safeMin, 1e-9, 'grouped fast-exchange limit should match shared mean-field safe time');
  approx(grouped.final.O2BulkOccupied, shared.final.O2BulkOccupied, 0.25, 'grouped fast-exchange limit should match shared bulk oxygen within a tight fast-exchange tolerance');
});

run('auto bulk O2 warns instead of switching when exchange is slow', () => {
  const lambda = 0.1;
  const occupancy = buildOccupancyModel(lambda, 1000, 0);
  const base = makeParams({
    bulkO2Mode: 'auto',
    lambda,
    N: 1000,
    occupancy,
    Vaq_uL: 1,
    targetCells: 0,
    dropHalf: 1e9,
    gasHalf: 1e9,
    oilHalf: 1e9,
    rates: { ocr: 200, gcr: 0, lpr: 0, gln: 0 },
    initialO2T: 10,
    initialO2B: 10,
    initialO2Oil: 0,
    initialO2Res: 0,
    maxDays: 0.1,
    atmMode: 'closed',
    headspace_mL: 0,
    o2Threshold: 0,
  });
  const auto = Engine.simulate(base);
  const shared = Engine.simulate({ ...base, bulkO2Mode: 'shared_mean_field' });
  assert.strictEqual(auto.bulkO2Regime.selectedMode, 'shared_mean_field', 'auto mode should retain the shared oil reservoir');
  assert.strictEqual(auto.bulkO2Regime.recommendedMode, 'grouped_transport_limited', 'auto mode should recommend grouped transport when depletion outruns exchange');
  assert.strictEqual(auto.bulkO2Regime.warningOnly, true, 'transport-limited auto mode should issue a warning instead of switching');
  approx(auto.safeMin, shared.safeMin, 1e-9, 'auto warning mode should still execute the shared mean-field model');
});

run('auto bulk O2 warns when proliferation makes later depletion transport-limited', () => {
  const base = makeParams({
    bulkO2Mode: 'auto',
    halfTimeMode: 'measured_effective',
    lambda: 0.05,
    N: 500,
    Vaq_uL: 0.5,
    prolif: true,
    dt_h: 0.5,
    lag_h: 0,
    carryingCellsPerNL: 600,
    dropHalf: 20,
    gasHalf: 1e9,
    oilHalf: 1e9,
    rates: { ocr: 3, gcr: 0, lpr: 0, gln: 0 },
    maxDays: 0.2,
    o2Threshold: 0,
    headspace_mL: 0,
    atmMode: 'closed',
  });
  const auto = Engine.simulate(base);
  const grouped = Engine.simulate({ ...base, bulkO2Mode: 'grouped_transport_limited' });
  const shared = Engine.simulate({ ...base, bulkO2Mode: 'shared_mean_field' });
  assert.strictEqual(auto.bulkO2Regime.selectedMode, 'shared_mean_field', 'auto mode should keep the shared oil reservoir active');
  assert.strictEqual(auto.bulkO2Regime.recommendedMode, 'grouped_transport_limited', 'later transport limitation should recommend grouped transport');
  assert.strictEqual(auto.bulkO2Regime.warningOnly, true, 'later transport limitation should issue a shared-model warning');
  assert(auto.bulkO2Regime.sampledTimeMin > 0, 'transport limitation should be detected from a later sampled time, not only the initial state');
  approx(auto.safeMin, shared.safeMin, 1e-9, 'auto warning mode should still run the shared reference');
  assert(Math.abs(grouped.safeMin - shared.safeMin) > 1e-6 || Math.abs(grouped.final.O2BulkOccupied - shared.final.O2BulkOccupied) > 1e-6, 'grouped comparison should remain available when later transport limitation matters');
});

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
process.exit(failCount === 0 ? 0 : 1);
