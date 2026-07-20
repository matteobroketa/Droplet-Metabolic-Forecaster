const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadManifest, stableArtifactManifestHash, canonicalTextSha256, canonicalFileSha256 } = require('../scripts/release_utils');

const html = fs.readFileSync(path.join(__dirname, '..', 'metabolic_depletion_forecaster.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const limitations = fs.readFileSync(path.join(__dirname, '..', 'ACCURACY_AND_LIMITATIONS.md'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const ciWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
const parameterProvenance = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'parameter_provenance.json'), 'utf8'));
const manifest = loadManifest(path.join(__dirname, '..'));
const { buildParameterProvenance } = require('../scripts/parameter_provenance_utils');
const { loadSourceData } = require('../scripts/source_data_utils');
const start = html.indexOf('const DATA=');
const end = html.indexOf("window.addEventListener('resize'");
if (start < 0 || end < 0) throw new Error('Could not locate model code in HTML source.');
const modelPrelude = `
const __fallbackDocument={currentScript:null,querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){},body:{dataset:{}},createElement:()=>({}),documentElement:{dataset:{}}};
const __fallbackWindow={addEventListener(){}};
const __fallbackNavigator={};
const __fallbackLocalStorage={getItem(){return null},setItem(){},removeItem(){}};
const __fallbackLocation={reload(){}};
const __fallbackURL={createObjectURL(){return ''},revokeObjectURL(){}};
const __docTarget=()=>globalThis.document||__fallbackDocument;
const __winTarget=()=>globalThis.window||__fallbackWindow;
const document=new Proxy({},{
  get(_target,prop){
    const value=__docTarget()[prop];
    return typeof value==='function'?value.bind(__docTarget()):value;
  },
  set(_target,prop,value){
    __docTarget()[prop]=value;
    return true;
  }
});
const window=new Proxy({},{
  get(_target,prop){
    const value=__winTarget()[prop];
    return typeof value==='function'?value.bind(__winTarget()):value;
  },
  set(_target,prop,value){
    __winTarget()[prop]=value;
    return true;
  }
});
const navigator=globalThis.navigator||__fallbackNavigator;
const localStorage=globalThis.localStorage||__fallbackLocalStorage;
const location=globalThis.location||__fallbackLocation;
const print=()=>{};
const URL=globalThis.URL||__fallbackURL;
const Blob=globalThis.Blob||function(){};
`;

const model = new Function(
  modelPrelude +
    html.slice(start, end) +
    '\nreturn {DATA, STATE_KEY, PHYS, VESSELS, o2Eq, co2Eq, carbonateConstants, carbonateSpecies, solveCarbonateState, boundaryEquilibriumPH, geometryScales, estimateSolverWorkload, Engine, buildOccupancyModel, bulkCellsAt, bulkGroupCellsAt, cellsAt, dryGasPctToHeadspaceMoles, thresholdFromMode, initialFlux, co2HeadEq, parseCalibrationSeries, runCalibrationFit, gatherParams, hardValidateInputs, auditCellDatabase, CELL_DATABASE_ISSUES, applyModePreset, applyVesselPreset, applyPreset, syncVesselControls, vesselSpec, buildRateScenarioResults, buildExportPayload, buildOccupancyGroupExport, toCSV, canonicalCalculationResult, calculationHash, inputQualityGrade, planningTimeLabel};'
)();

const {
  DATA,
  STATE_KEY,
  PHYS,
  VESSELS,
  o2Eq,
  co2Eq,
  carbonateConstants,
  carbonateSpecies,
  solveCarbonateState,
  boundaryEquilibriumPH,
  geometryScales,
  estimateSolverWorkload,
  Engine,
  buildOccupancyModel,
  bulkCellsAt,
  bulkGroupCellsAt,
  parseCalibrationSeries,
  runCalibrationFit,
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
  buildOccupancyGroupExport,
  toCSV,
  canonicalCalculationResult,
  calculationHash,
  inputQualityGrade,
  planningTimeLabel,
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
    pHModel: overrides.pHModel ?? 'heuristic_legacy',
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
    oil: overrides.oil ?? { capacityRatio: 14, co2CapacityRatio: 0, co2CapacityEnabled: false, co2EvidenceClassification: 'disabled — no CO2-specific evidence record', co2Provenance: null },
    gasHalf: overrides.gasHalf ?? 150,
    oilHalf: overrides.oilHalf ?? 480,
    dropHalf: overrides.dropHalf ?? 10,
    co2GasHalf: overrides.co2GasHalf ?? NaN,
    co2OilHalf: overrides.co2OilHalf ?? NaN,
    co2DropHalf: overrides.co2DropHalf ?? NaN,
    co2AqueousGasHalf: overrides.co2AqueousGasHalf ?? 10,
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
    growthModel: overrides.growthModel ?? 'stress_limited',
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

function independentCarbonateState(dic_mM, targetTA_mM, buffer_mM_per_pH, referencePH, T = 37) {
  const dT = T - 37;
  const pKa1 = 6.103 + -0.011 * dT;
  const pKa2 = 10.329 + -0.02 * dT;
  const pKw = 13.62 + -0.032 * dT;
  const K1 = 10 ** -pKa1;
  const K2 = 10 ** -pKa2;
  const Kw = 10 ** -pKw;
  const residual = (pH) => {
    const H = 10 ** -pH;
    const den = H * H + K1 * H + K1 * K2;
    const co2 = dic_mM * (H * H / den);
    const hco3 = dic_mM * (K1 * H / den);
    const co3 = dic_mM * (K1 * K2 / den);
    const oh = (Kw / H) * 1000;
    return hco3 + 2 * co3 + oh - H * 1000 + buffer_mM_per_pH * (pH - referencePH) - targetTA_mM;
  };
  let lo = 0.5;
  let hi = 13.5;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (residual(mid) >= 0) hi = mid;
    else lo = mid;
  }
  const pH = (lo + hi) / 2;
  const H = 10 ** -pH;
  const den = H * H + K1 * H + K1 * K2;
  return {
    pH,
    co2: dic_mM * (H * H / den),
    hco3: dic_mM * (K1 * H / den),
    co3: dic_mM * (K1 * K2 / den),
  };
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
    body: { dataset: { release: 'v19-html-authoritative-20260716' } },
    getElementById(id) {
      return elements.get(id) || ensure(id);
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) || ensure(selector.slice(1));
      if (selector === 'meta[name="artifact-release"]') return { content: 'v19-html-authoritative-20260716' };
      if (selector === 'meta[name="artifact-commit"]') return { content: 'd4032d9863245a89b4113788fed2cea33372da1f' };
      if (selector === 'meta[name="artifact-manifest-sha256"]') return { content: '0F565D0469D0C76F51DC31EF5C39D6EC57B6AF1A1B4D16F721C5254BF4A1E1A5' };
      const labelMatch = selector.match(/^label\[for="(.+)"\]$/);
      if (labelMatch) return { textContent: labelMatch[1] };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input,select' || selector === 'input,select,textarea') return [...elements.values()];
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
      test_oil: { id: 'test_oil', name: 'Test oil', capacityRatio: 14, co2CapacityRatio: 14 },
      hfe7500: { id: 'hfe7500', name: 'HFE', capacityRatio: 14, co2CapacityRatio: 14 },
      pdms: { id: 'pdms', name: 'PDMS', capacityRatio: 10, co2CapacityRatio: 10 },
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
    oilCO2CapacityOverride: '',
    co2GasHalf: '',
    co2OilHalf: '',
    co2DropHalf: '',
    co2AqueousGasHalf: '10',
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
    pHModel: 'carbonate_alkalinity',
    geometryMode: 'auto',
    modelTier: 'heuristic',
    halfTimeMode: 'reference_scaled',
    rateTemperatureMode: 'reference_q10',
    rateReferenceTemperature: '37',
    rateQ10: '2',
    atmMode: 'closed',
    centerPenalty: '1',
    gradientFactor: '1',
    storageMode: 'static_tube',
    surfaceAccess: '3',
    bulkO2Mode: 'auto',
    proliferation: 'off',
    growthModel: 'stress_limited',
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

run('canonical HTML contains production code and no competing reconstruction source exists', () => {
  const root = path.join(__dirname, '..');
  assert(html.includes('/* BEGIN EMBEDDED DATA */') && html.includes('/* END EMBEDDED DATA */'), 'canonical embedded-data markers missing');
  assert(html.includes('/* BEGIN MODEL ENGINE */'), 'canonical model marker missing');
  assert(html.includes('function captureRawInputs(){'), 'canonical HTML should contain UI/export code');
  for (const rel of ['src/standalone_artifact.template.html', 'src/model/00_data.generated.js', 'src/model/00_model_and_solver.js', 'src/model/10_engine_and_calibration.js', 'src/ui/10_ui_and_exports.js']) {
    assert(!fs.existsSync(path.join(root, rel)), `competing production source should be removed: ${rel}`);
  }
  const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build.js'), 'utf8');
  assert(!/writeFile|copyFile|rename|createWriteStream/.test(buildSource), 'build script must not contain a file-writing operation');
});

run('CI workflow keeps the audited syntax, test, build, and clean-tree gates', () => {
  assert.strictEqual(packageJson.scripts['check:syntax'], 'node scripts/check_syntax.js', 'package syntax-check script is missing or changed');
  const requiredWorkflowFragments = [
    'npm ci',
    'npm run verify:data',
    'npm run check:syntax',
    'npm test',
    'npm run test:browser',
    'npm run build',
    'npm run verify:artifact',
    'npm run verify:manifest',
    'npm run verify:provenance',
    'npm run verify:html-is-canonical',
    'timeout-minutes:',
    'git diff --exit-code',
  ];
  for (const fragment of requiredWorkflowFragments) {
    assert(ciWorkflow.includes(fragment), `CI workflow is missing required gate: ${fragment}`);
  }
});

run('canonical embedded data matches supporting JSON catalogs', () => {
  const { DATA: sourceData } = loadSourceData(path.join(__dirname, '..'));
  assert.deepStrictEqual(sourceData.cellLines, DATA.cellLines, 'runtime cell lines should match supporting JSON');
  assert.deepStrictEqual(sourceData.media, DATA.media, 'runtime media should match supporting JSON');
  assert.deepStrictEqual(sourceData.oils, DATA.oils, 'runtime oils should match supporting JSON');
  assert.deepStrictEqual(sourceData.refs, DATA.refs, 'runtime reference rows should match source JSON');
});

run('parameter provenance matches current source data and covers all cell/media/oil entities', () => {
  const expected = buildParameterProvenance(path.join(__dirname, '..'));
  assert.deepStrictEqual(parameterProvenance, expected, 'parameter provenance file should exactly match the current source-derived payload');
  assert.deepStrictEqual(Object.keys(parameterProvenance.cellLines).sort(), Object.keys(DATA.cellLines).sort(), 'cell-line provenance keys should match source data');
  assert.deepStrictEqual(Object.keys(parameterProvenance.media).sort(), Object.keys(DATA.media).sort(), 'medium provenance keys should match source data');
  assert.deepStrictEqual(Object.keys(parameterProvenance.oils).sort(), Object.keys(DATA.oils).sort(), 'oil provenance keys should match source data');
  for (const group of ['cellLines', 'media', 'oils']) {
    for (const entity of Object.values(parameterProvenance[group])) {
      assert(Array.isArray(entity.records) && entity.records.length > 0, `${group} ${entity.id} should have provenance records`);
      for (const record of entity.records) {
        for (const key of parameterProvenance.requiredFields) {
          assert(Object.prototype.hasOwnProperty.call(record, key), `${group} ${entity.id} record ${record.parameter} is missing field ${key}`);
        }
        assert(record.unit, `${group} ${entity.id} record ${record.parameter} should declare a unit`);
      }
    }
  }
  for (const oil of Object.values(parameterProvenance.oils)) {
    const co2 = oil.records.find((record) => record.parameter === 'co2CapacityRatio');
    assert(co2, `${oil.id} CO2 capacity provenance record missing`);
    assert.strictEqual(co2.value, 0, `${oil.id} default CO2 capacity must be disabled`);
    assert.deepStrictEqual(co2.source, [], `${oil.id} CO2 record must not copy oxygen references`);
    for (const key of parameterProvenance.oilCO2RequiredFields) assert(Object.prototype.hasOwnProperty.call(co2, key), `${oil.id} CO2 record missing ${key}`);
    assert.strictEqual(co2.evidenceClassification, 'disabled — no CO2-specific evidence record');
  }
});

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

run('simultaneous initial endpoints are recorded at the same instant', () => {
  const r = Engine.simulate(
    makeParams({
      initialO2T: 5,
      initialO2B: 100,
      initialO2Oil: 0,
      initialO2Res: 0,
      o2Threshold: 5,
      sub: { glc: 0.2, gln: 4, lac: 0, bicarb: 26 },
      glucoseFloor: 0.2,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      maxDays: 0.01,
    })
  );
  assert.strictEqual(r.limiter, 'O₂', 'deterministic endpoint priority should select O₂ for an exact tie');
  approx(r.safeMin, 0, 1e-12, 'simultaneous endpoint time');
  approx(r.events.O2, 0, 1e-12, 'O₂ endpoint should be recorded at t=0');
  approx(r.events.Glucose, 0, 1e-12, 'glucose endpoint should be recorded at t=0');
});

run('closed zero headspace has no fixed gas boundary and conserves oxygen and carbon to horizon', () => {
  const r = Engine.simulate(
    makeParams({
      targetCells: 0,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
      initialO2T: 160,
      initialO2B: 140,
      initialO2Oil: 120,
      initialO2Res: 100,
      headspace_mL: 0,
      headO2Initial: 0,
      headCO2Initial: 0,
      CO2Initial: 1.2,
      CO2Boundary: 9,
      pHBoundaryMode: 'closed_headspace_mass_balance',
      co2AqueousGasHalf: 1,
      o2Threshold: 5,
      maxDays: 0.05,
    })
  );
  assert.strictEqual(r.limiter, 'simulation horizon', 'zero-headspace run must not stop at time zero');
  approx(r.safeMin, r.params.maxDays * 24 * 60, 1e-9, 'zero-headspace run should reach the horizon');
  approx(r.mass.O2totalFinal, r.mass.O2total0, Math.max(1, r.mass.O2total0) * 1e-10, 'closed zero-headspace oxygen inventory changed');
  approx(r.mass.CO2trackedFinal, r.mass.CO2tracked0, Math.max(1, r.mass.CO2tracked0) * 1e-10, 'closed zero-headspace carbon inventory changed');
  assert.strictEqual(r.conductances.fmolPerMinPerUM.gasRes, 0, 'reservoir/headspace O2 conductance must be exactly zero');
  assert.strictEqual(r.conductances.fmolPerMinPerUM.gasDirect, 0, 'emulsion/headspace O2 conductance must be exactly zero');
  assert.strictEqual(r.conductances.fmolPerMinPerUM.co2GasRes, 0, 'reservoir/headspace CO2 conductance must be exactly zero');
  assert.strictEqual(r.conductances.fmolPerMinPerUM.co2GasDirect, 0, 'emulsion/headspace CO2 conductance must be exactly zero');
  assert.strictEqual(r.initialFlux.boundaryNet, 0, 'initial gas O2 flux must be exactly zero');
  assert(Math.abs(r.mass.o2Residual) <= Math.max(1, r.mass.O2total0) * 1e-10, `scale-aware O2 residual too large: ${r.mass.o2Residual}`);
  assert(Math.abs(r.mass.co2Residual) <= Math.max(1, r.mass.CO2tracked0) * 1e-10, `scale-aware carbon residual too large: ${r.mass.co2Residual}`);
  console.log(`  PROBE zero-headspace horizon=${r.safeMin}min gasO2=${r.conductances.fmolPerMinPerUM.gasRes}/${r.conductances.fmolPerMinPerUM.gasDirect} gasCO2=${r.conductances.fmolPerMinPerUM.co2GasRes}/${r.conductances.fmolPerMinPerUM.co2GasDirect} O2residual=${r.mass.o2Residual} CO2residual=${r.mass.co2Residual}`);
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
  const release = 'v19-html-authoritative-20260716';
  assert(html.includes(`release: ${release}`), 'artifact comment release mismatch');
  assert(html.includes(`data-release="${release}"`), 'body release mismatch');
  assert(html.includes(`content="${release}"`), 'meta release mismatch');
  assert(html.includes('Metabolic Depletion Forecaster v19'), 'title release mismatch');
  assert.strictEqual(STATE_KEY, 'metabolic-forecaster-v19-html-authoritative-20260716', 'state key mismatch');
  assert(readme.includes(release), 'README release mismatch');
  assert(limitations.includes(release), 'limitations release mismatch');
  assert(!html.includes('v17-audit-20260715'), 'old release identity still present');
});

run('canonical artifact carries manifest metadata without reconstruction', () => {
  const manifestSha256 = stableArtifactManifestHash(manifest);
  assert(html.includes(`content="${manifestSha256}"`), 'artifact should include the rendered stable manifest hash');
});

run('manifest file hashes use canonical LF text bytes for public raw parity', () => {
  const root = path.join(__dirname, '..');
  assert.strictEqual(manifest.files['metabolic_depletion_forecaster.html'], canonicalTextSha256(html), 'artifact hash should use canonical text bytes');
  assert.strictEqual(manifest.files['README.md'], canonicalFileSha256(path.join(root, 'README.md')), 'README hash should use canonical text bytes');
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

run('calibration parser accepts CSV with header', () => {
  const rows = parseCalibrationSeries('time_h,o2_uM\n0,204\n1 180\n2\t155');
  assert.strictEqual(rows.length, 3, 'expected three parsed calibration rows');
  approx(rows[1].time_h, 1, 1e-12, 'second parsed time mismatch');
  approx(rows[2].observed, 155, 1e-12, 'third parsed value mismatch');
});

run('single-parameter calibration recovers droplet half-time from synthetic target O2 data', () => {
  const trueParams = makeParams({
    pHModel: 'carbonate_alkalinity',
    targetCells: 1,
    lambda: 0,
    volume_nL: 0.578,
    Vaq_uL: 0.02,
    totalEmulsion_uL: 0.02,
    VoilEmul_uL: 0.01,
    residualOil_uL: 0.03,
    initialO2T: 204,
    initialO2B: 204,
    initialO2Oil: 204,
    initialO2Res: 204,
    dropHalf: 12,
    oilHalf: 80,
    gasHalf: 200,
    rates: { ocr: 0.2, gcr: 0, lpr: 0, gln: 0 },
    maxDays: 0.25,
    chartEveryMin: 1.5,
    logStep: 1.5,
    o2Threshold: 0,
  });
  const synthetic = Engine.simulate(trueParams);
  const times_h = [0, 0.1, 0.2, 0.4, 0.8, 1.2, 1.6, 1.8, 2];
  const series = times_h.map((time_h) => {
    const timeMin = time_h * 60;
    const chart = synthetic.chart;
    let predicted = chart[chart.length - 1].O2T;
    for (let i = 1; i < chart.length; i += 1) {
      if (timeMin <= chart[i].t) {
        const a = chart[i - 1];
        const b = chart[i];
        const frac = (timeMin - a.t) / Math.max(1e-9, b.t - a.t);
        predicted = a.O2T + (b.O2T - a.O2T) * frac;
        break;
      }
    }
    return { time_h, observed: predicted };
  });
  const wallStart = Date.now();
  const fit = runCalibrationFit({ ...trueParams, dropHalf: 4 }, { observable: 'O2T', fitMode: 'dropHalf', series });
  const observedWallMs = Date.now() - wallStart;
  assert.strictEqual(fit.status, 'identified', (fit.identifiabilityWarnings || []).join(' | '));
  assert(Math.abs(fit.bestFit.dropHalf - 12) < 2, `calibration should recover droplet half-time near 12 min, got ${fit.bestFit.dropHalf}`);
  assert(fit.bootstrapIntervals.dropHalf.low <= fit.bestFit.dropHalf && fit.bootstrapIntervals.dropHalf.high >= fit.bestFit.dropHalf, 'bootstrap range should contain the best fit');
  assert(fit.rmse < 0.01, `noise-free synthetic residual should be numerically zero, got RMSE ${fit.rmse}`);
  assert(fit.residuals.every((row) => Math.abs(row.residual) < 0.01), 'noise-free residuals should be numerically zero');
  assert(fit.parameterBounds.dropHalf.low > 0 && fit.parameterBounds.dropHalf.high > fit.parameterBounds.dropHalf.low, 'positive log-space parameter bounds missing');
  const independentGridMinimum = Math.min(...fit.objectiveSurface.map((candidate) => candidate.sse));
  approx(fit.sse, independentGridMinimum, 1e-12, 'reported one-parameter objective should equal the independently selected grid minimum');
  const reordered = runCalibrationFit({ ...trueParams, dropHalf: 4 }, { observable: 'O2T', fitMode: 'dropHalf', series: [...series].reverse() });
  approx(reordered.sse, fit.sse, 1e-12, 'calibration objective should be invariant to input row order');
  approx(reordered.bestFit.dropHalf, fit.bestFit.dropHalf, 1e-12, 'fit should be invariant to input row order after sorting');
  assert.strictEqual(fit.telemetry.modelEvaluations, 27, 'calibration model-evaluation telemetry mismatch');
  assert(fit.telemetry.acceptedSteps < 30000, `ordinary five-hour calibration exceeded accepted-step budget: ${fit.telemetry.acceptedSteps}`);
  assert.strictEqual(fit.telemetry.rejectedSteps, 0, 'implicit transport solver should not report rejected steps');
  assert(fit.telemetry.minimumTimestepMin > 0 && fit.telemetry.medianTimestepMin > 0, 'calibration timestep telemetry missing');
  assert(fit.telemetry.endpointBehavior['simulation horizon'] === 27, 'calibration should evaluate all observations through the horizon');
  assert.strictEqual(fit.telemetry.workloadDifference, fit.telemetry.actualSteps - fit.telemetry.estimatedSteps, 'estimated/actual workload difference mismatch');
  assert(observedWallMs < fit.telemetry.performanceBudgetMs, `calibration exceeded ${fit.telemetry.performanceBudgetMs} ms budget: ${observedWallMs} ms`);
  console.log(`  PROBE calibration evaluations=${fit.telemetry.modelEvaluations} accepted=${fit.telemetry.acceptedSteps} rejected=${fit.telemetry.rejectedSteps} estimated=${fit.telemetry.estimatedSteps} minDt=${fit.telemetry.minimumTimestepMin} medianDt=${fit.telemetry.medianTimestepMin} wall=${observedWallMs}ms fit=${fit.bestFit.dropHalf}`);
});

run('two-parameter calibration reports log-space objective and correlation diagnostics', () => {
  const trueParams = makeParams({
    targetCells: 1,
    lambda: 0,
    volume_nL: 0.578,
    Vaq_uL: 0.02,
    totalEmulsion_uL: 0.02,
    VoilEmul_uL: 0.01,
    residualOil_uL: 0.03,
    initialO2T: 204,
    initialO2B: 204,
    initialO2Oil: 204,
    initialO2Res: 204,
    dropHalf: 10,
    oilHalf: 60,
    gasHalf: 200,
    rates: { ocr: 0.2, gcr: 0, lpr: 0, gln: 0 },
    maxDays: 0.2,
    chartEveryMin: 1.5,
    logStep: 1.5,
    o2Threshold: 0,
  });
  const simulated = Engine.simulate(trueParams);
  const times = [0, 0.1, 0.2, 0.4, 0.8, 1.2, 1.6, 1.8, 2];
  const series = times.map((time_h) => {
    const timeMin = time_h * 60;
    const chart = simulated.chart;
    let point = chart.at(-1);
    for (let i = 1; i < chart.length; i += 1) if (timeMin <= chart[i].t) { const a = chart[i - 1], b = chart[i], f = (timeMin - a.t) / Math.max(1e-9, b.t - a.t); point = { O2T: a.O2T + (b.O2T - a.O2T) * f }; break; }
    return { time_h, observed: point.O2T };
  });
  const fit = runCalibrationFit({ ...trueParams, dropHalf: 4, oilHalf: 20 }, { observable: 'O2T', fitMode: 'dropHalf+oilHalf', series });
  assert.strictEqual(fit.objectiveSurface.length, 121, 'two-parameter fit should evaluate its 11×11 log-space grid');
  approx(fit.sse, Math.min(...fit.objectiveSurface.map((candidate) => candidate.sse)), 1e-12, 'reported two-parameter objective should equal the grid-search minimum');
  assert(fit.objectiveSurface.every((candidate) => candidate.values.every((value) => value > 0)), 'log-space grid must never evaluate negative half-times');
  assert(Array.isArray(fit.parameterCorrelationMatrix) && fit.parameterCorrelationMatrix.length === 2 && fit.parameterCorrelationMatrix[0].length === 2, 'two-parameter correlation matrix missing');
});

run('carbonate alkalinity solver matches an independent equilibrium root', () => {
  const p = makeParams({
    pHModel: 'carbonate_alkalinity',
    T: 37,
    pH0: 7.4,
    buffer: 10,
    sub: { glc: 25, gln: 4, lac: 0, bicarb: 26 },
    CO2Initial: 26 / 10 ** (7.4 - 6.103),
  });
  const baseline = solveCarbonateState(p.DICInitial || (p.CO2Initial + p.sub.bicarb), 0, p);
  const targetTA = baseline.hco3 + 2 * baseline.co3 + (10 ** -(13.62 - baseline.pH)) * 1000 - 10 ** -baseline.pH * 1000 + p.buffer * (baseline.pH - p.pH0) - 1.5;
  const app = solveCarbonateState(28, 1.5, p);
  const independent = independentCarbonateState(28, targetTA, p.buffer, p.pH0, p.T);
  approx(app.pH, independent.pH, 1e-4, 'carbonate solver pH mismatch');
  approx(app.co2, independent.co2, 1e-4, 'carbonate solver dissolved CO2 mismatch');
  approx(app.hco3, independent.hco3, 1e-4, 'carbonate solver bicarbonate mismatch');
});

run('carbonate alkalinity mode conserves tracked carbon in finite closed headspace mode', () => {
  const r = Engine.simulate(
    makeParams({
      pHModel: 'carbonate_alkalinity',
      pHBoundaryMode: 'closed_headspace_mass_balance',
      targetCells: 10,
      lambda: 0,
      rates: { ocr: 2, gcr: 0, lpr: 0.5, gln: 0 },
      gasHalf: 20,
      oilHalf: 1e9,
      dropHalf: 5,
      maxDays: 0.02,
      atmMode: 'closed',
      headspace_mL: 0.25,
      initialO2T: 200,
      initialO2B: 200,
      initialO2Oil: 200,
      initialO2Res: 200,
      o2Threshold: 0,
    })
  );
  assert.strictEqual(r.mass.closedCarbonBalance, true, 'carbonate closed finite-headspace mode should report closed tracked-carbon balance');
  assert(r.mass.co2ResidualPct < 1e-6, `carbonate tracked-carbon residual should stay near zero, got ${r.mass.co2ResidualPct}`);
});

run('carbonate oil-phase CO2 collapses to aqueous-only behavior when oil CO2 capacity is zero', () => {
  const base = {
    pHModel: 'carbonate_alkalinity',
    pHBoundaryMode: 'closed_headspace_mass_balance',
    targetCells: 8,
    lambda: 0,
    rates: { ocr: 1.5, gcr: 0, lpr: 0.4, gln: 0 },
    gasHalf: 20,
    oilHalf: 10,
    dropHalf: 5,
    maxDays: 0.02,
    atmMode: 'closed',
    headspace_mL: 0.25,
    initialO2T: 200,
    initialO2B: 200,
    initialO2Oil: 200,
    initialO2Res: 200,
    o2Threshold: 0,
  };
  const noOilCapacity = Engine.simulate(makeParams({ ...base, oil: { capacityRatio: 14, co2CapacityRatio: 0, co2CapacityEnabled: false } }));
  const noOilVolume = Engine.simulate(makeParams({ ...base, oil: { capacityRatio: 14, co2CapacityRatio: 14, co2CapacityEnabled: true }, co2GasHalf: 20, co2OilHalf: 10, co2DropHalf: 5, VoilEmul_uL: 0, residualOil_uL: 0 }));
  approx(noOilCapacity.mass.co2ResidualPct, noOilVolume.mass.co2ResidualPct, 1e-9, 'zero oil CO2 capacity should collapse to zero oil-volume carbon behavior');
  approx(noOilCapacity.final.pH, noOilVolume.final.pH, 0.02, 'zero oil CO2 capacity should stay close to zero oil-volume pH behavior');
  approx(noOilCapacity.final.mCO2Oil || 0, 0, 1e-12, 'zero oil CO2 capacity should leave no oil-phase tracked carbon');
});

run('higher oil CO2 capacity increases retained oil-phase carbon in carbonate mode', () => {
  const common = {
    pHModel: 'carbonate_alkalinity',
    pHBoundaryMode: 'closed_headspace_mass_balance',
    targetCells: 20,
    lambda: 0,
    rates: { ocr: 0, gcr: 0, lpr: 25, gln: 0 },
    gasHalf: 20,
    oilHalf: 10,
    dropHalf: 5,
    maxDays: 0.03,
    atmMode: 'closed',
    headspace_mL: 0.25,
    initialO2T: 200,
    initialO2B: 200,
    initialO2Oil: 200,
    initialO2Res: 200,
    o2Threshold: 0,
  };
  const planning = { co2CapacityEnabled: true, co2EvidenceClassification: 'Unvalidated planning assumption — user supplied' };
  const transport = { co2GasHalf: 20, co2OilHalf: 10, co2DropHalf: 5 };
  const low = Engine.simulate(makeParams({ ...common, ...transport, oil: { capacityRatio: 14, co2CapacityRatio: 2, ...planning } }));
  const high = Engine.simulate(makeParams({ ...common, ...transport, oil: { capacityRatio: 14, co2CapacityRatio: 40, ...planning } }));
  assert(high.final.mCO2Oil > low.final.mCO2Oil, `higher oil CO2 capacity should retain more oil-phase CO2, got low=${low.final.mCO2Oil}, high=${high.final.mCO2Oil}`);
});

run('oil CO2 defaults are disabled and transport never derives from oxygen half-times', () => {
  for (const oil of Object.values(DATA.oils)) {
    assert.strictEqual(oil.co2CapacityRatio, 0, `${oil.id} default CO2 capacity must be zero`);
    assert.strictEqual(oil.co2CapacityEnabled, false, `${oil.id} default CO2 capacity must be disabled`);
    assert.strictEqual(oil.co2Provenance, null, `${oil.id} should not claim CO2 provenance`);
  }
  assert(html.includes('Unvalidated planning assumption — user supplied'), 'user override label missing');
  assert(!html.includes('dropTargetHalf/2.2') && !html.includes('dropBulkHalf/2.2'), 'CO2 transport must not use the undocumented O2 / 2.2 factor');
});

run('true Poisson nutrient capacities persist in auto, shared, and grouped O2 modes', () => {
  const lambda = 0.4;
  const occupancy = buildOccupancyModel(lambda, 500, 1);
  for (const bulkO2Mode of ['auto', 'shared_mean_field', 'grouped_transport_limited']) {
    const r = Engine.simulate(makeParams({
      bulkO2Mode,
      lambda,
      N: 500,
      occupancy,
      Vaq_uL: 0.5,
      targetCells: 1,
      rates: { ocr: 0.2, gcr: 0.8, lpr: 1.2, gln: 0.3 },
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.05,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    }));
    approx(r.capacities.capEmpty + r.capacities.capSingle + r.capacities.capMulti, r.capacities.capBulk, Math.max(1, r.capacities.capBulk) * 1e-12, `${bulkO2Mode} chemical capacities must reconcile`);
    assert(r.capacities.capEmpty > 0 && r.capacities.capSingle > 0 && r.capacities.capMulti > 0, `${bulkO2Mode} must retain all occupancy groups`);
    approx(r.final.GlcEmpty, r.params.sub.glc, 1e-12, 'empty-droplet glucose should remain unchanged');
    approx(r.final.GlnEmpty, r.params.sub.gln, 1e-12, 'empty-droplet glutamine should remain unchanged');
    approx(r.final.LacEmpty, r.params.sub.lac, 1e-12, 'empty droplets must not produce lactate');
    assert(r.final.GlcMulti < r.final.GlcSingle, `multi-cell droplets should deplete glucose faster in ${bulkO2Mode}`);
    const expectedBulkGlc = ((r.final.GlcEmpty * r.capacities.capEmpty) + (r.final.GlcSingle * r.capacities.capSingle) + (r.final.GlcMulti * r.capacities.capMulti)) / Math.max(1e-9, r.capacities.capBulk);
    approx(r.final.GlcB, expectedBulkGlc, 1e-12, 'bulk glucose summary should equal the weighted group mean');
    const exported = buildOccupancyGroupExport(r);
    approx(exported.reconciliation.capacity_nL, 0, 1e-12, 'export capacity reconciliation failed');
    approx(exported.reconciliation.population, 0, 1e-9, 'export population reconciliation failed');
    for (const group of ['empty', 'single', 'multi']) assert(Number.isFinite(exported.groups[group].capacity_nL), `export ${group} capacity missing`);
  }
});

run('zero and near-zero Poisson occupancy have exact zero-demand behavior and bounded runtime', () => {
  const zero = buildOccupancyModel(0, 1000, 0);
  assert.strictEqual(zero.expectedBulkCells, 0, 'lambda=0 bulk population must be exactly zero');
  assert.strictEqual(zero.occupiedDroplets, 0, 'lambda=0 must have no occupied bulk droplets');
  assert.strictEqual(zero.tailProbability, 0, 'lambda=0 must have no truncation tail');
  const zeroResult = Engine.simulate(makeParams({ lambda: 0, targetCells: 0, occupancy: zero, rates: { ocr: 2, gcr: 3, lpr: 4, gln: 1 }, maxDays: 0.02, o2Threshold: 0 }));
  assert.strictEqual(zeroResult.mass.o2Consumed, 0, 'empty droplets must not consume oxygen');
  assert.strictEqual(zeroResult.mass.glucoseConsumed, 0, 'empty droplets must not consume glucose');
  assert.strictEqual(zeroResult.mass.glutamineConsumed, 0, 'empty droplets must not consume glutamine');
  assert.strictEqual(zeroResult.mass.lactateProduced, 0, 'empty droplets must not produce lactate');
  for (const lambda of [0, 1e-12, 1e-6, 0.3]) {
    const occupancy = buildOccupancyModel(lambda, 1000, 0);
    const r = Engine.simulate(makeParams({ lambda, targetCells: 0, occupancy, maxDays: 0.02, maxAcceptedSteps: 5000, o2Threshold: 0 }));
    assert.strictEqual(r.error, null, `lambda=${lambda} should not exhaust the solver step budget: ${r.error}`);
    assert(r.solver.acceptedSteps < 5000, `lambda=${lambda} runtime should remain bounded`);
  }
});

run('truncated Poisson probabilities normalize and converge as the retained limit increases', () => {
  const low = buildOccupancyModel(2, 1000, 1, { maxK: 16 });
  const high = buildOccupancyModel(2, 1000, 1, { maxK: 64 });
  const normalizedMass = 1 - high.tailProbability;
  approx(normalizedMass / high.retainedProbability, 1, 1e-12, 'retained Poisson probabilities should normalize to one');
  assert(high.tailProbability < low.tailProbability, 'larger truncation limit should reduce the explicit tail');
  approx(low.expectedBulkCells, high.expectedBulkCells, 1e-6, 'expected bulk demand should converge with a sufficient truncation limit');
});

run('stress-limited growth matches legacy logistic when local conditions stay near initial values', () => {
  const common = {
    prolif: true,
    dt_h: 12,
    lag_h: 0,
    targetCells: 1,
    lambda: 0,
    rates: { ocr: 0, gcr: 0, lpr: 0, gln: 0 },
    gasHalf: 1e9,
    oilHalf: 1e9,
    dropHalf: 1e9,
    maxDays: 0.2,
    atmMode: 'closed',
    headspace_mL: 0,
    o2Threshold: 0,
  };
  const stress = Engine.simulate(makeParams({ ...common, growthModel: 'stress_limited' }));
  const legacy = Engine.simulate(makeParams({ ...common, growthModel: 'legacy_logistic' }));
  approx(stress.final.nT, legacy.final.nT, legacy.final.nT * 1e-6 + 1e-9, 'stress-limited growth should match legacy logistic when no local stress develops');
});

run('stateful stress growth materially lowers population and integrated demand monotonically', () => {
  const lambda = 4;
  const occupancy = buildOccupancyModel(lambda, 800, 1);
  const common = {
    prolif: true,
    dt_h: 4,
    lag_h: 0,
    bulkO2Mode: 'grouped_transport_limited',
    lambda,
    N: 800,
    occupancy,
    Vaq_uL: 0.8,
    targetCells: 0,
    rates: { ocr: 0, gcr: 0.5, lpr: 0.5, gln: 0.2 },
    sub: { glc: 10, gln: 5, lac: 0, bicarb: 0 },
    gasHalf: 1e9,
    oilHalf: 1e9,
    dropHalf: 1e9,
    maxDays: 2,
    atmMode: 'closed',
    headspace_mL: 0,
    o2Threshold: -1,
    glucoseFloor: 5,
    pHFloor: 0,
    pHCeiling: 14,
  };
  const stress = Engine.simulate(makeParams({ ...common, growthModel: 'stress_limited' }));
  const legacy = Engine.simulate(makeParams({ ...common, growthModel: 'legacy_logistic' }));
  assert(stress.final.nMulti < legacy.final.nMulti * 0.8, `stress effect must be material, got stress=${stress.final.nMulti}, legacy=${legacy.final.nMulti}`);
  assert(stress.mass.glucoseConsumed < legacy.mass.glucoseConsumed * 0.9, `stress should reduce integrated demand, got stress=${stress.mass.glucoseConsumed}, legacy=${legacy.mass.glucoseConsumed}`);
  const levels = [2, 0.8, 0.3].map((glc) => Engine.simulate(makeParams({ ...common, sub: { ...common.sub, glc }, growthModel: 'stress_limited' })));
  assert(levels[0].final.nMulti >= levels[1].final.nMulti && levels[1].final.nMulti >= levels[2].final.nMulti, 'population must decrease monotonically with worsening glucose stress');
  for (const result of [stress, legacy, ...levels]) for (const value of [result.final.nT, result.final.nSingle, result.final.nMulti, result.final.nBulk]) assert(Number.isFinite(value) && value >= 0, `population must stay finite and nonnegative, got ${value}`);
  const fine = Engine.simulate(makeParams({ ...common, growthModel: 'stress_limited', maxStepMin: 0.25 }));
  const relative = Math.abs(fine.final.nMulti - stress.final.nMulti) / Math.max(1, fine.final.nMulti);
  assert(relative < 0.02, `stateful growth should converge under timestep refinement, relative difference=${relative}`);
  console.log(`  PROBE growth stressPopulation=${stress.final.nMulti} legacyPopulation=${legacy.final.nMulti} stressGlucose=${stress.mass.glucoseConsumed} legacyGlucose=${legacy.mass.glucoseConsumed} refinement=${relative}`);
});

run('carbonate alkalinity buffer capacity reduces acidification monotonically', () => {
  const low = Engine.simulate(
    makeParams({
      pHModel: 'carbonate_alkalinity',
      targetCells: 25,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 40, gln: 0 },
      buffer: 4,
      pHFloor: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.02,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    })
  );
  const high = Engine.simulate(
    makeParams({
      pHModel: 'carbonate_alkalinity',
      targetCells: 25,
      lambda: 0,
      rates: { ocr: 0, gcr: 0, lpr: 40, gln: 0 },
      buffer: 16,
      pHFloor: 0,
      gasHalf: 1e9,
      oilHalf: 1e9,
      dropHalf: 1e9,
      maxDays: 0.02,
      atmMode: 'closed',
      headspace_mL: 0,
      o2Threshold: 0,
    })
  );
  assert(high.final.pH > low.final.pH, `higher non-bicarbonate buffer capacity should reduce acidification, got low=${low.final.pH}, high=${high.final.pH}`);
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

run('coupled transport solver converges under refinement without mass drift', () => {
  const base = {
    volume_nL: 0.5,
    Vaq_uL: 0.02,
    totalEmulsion_uL: 0.02,
    VoilEmul_uL: 3,
    residualOil_uL: 5,
    targetCells: 2,
    lambda: 0.6,
    rates: { ocr: 0.8, gcr: 0.3, lpr: 0.45, gln: 0.1 },
    initialO2T: 90,
    initialO2B: 110,
    initialO2Oil: 150,
    initialO2Res: 160,
    gasHalf: 3,
    oilHalf: 5,
    dropHalf: 2,
    maxDays: 0.04,
    o2Threshold: 0,
    atmMode: 'closed',
    headspace_mL: 0.2,
  };
  const coarse = Engine.simulate(makeParams({ ...base, maxStepMin: 0.4 }));
  const fine = Engine.simulate(makeParams({ ...base, maxStepMin: 0.025 }));
  assert.strictEqual(coarse.error, null, `coarse solver failed: ${coarse.error}`);
  assert.strictEqual(fine.error, null, `fine solver failed: ${fine.error}`);
  approx(coarse.final.O2T, fine.final.O2T, 0.05, 'refined target O₂ trajectory');
  approx(coarse.final.Glc, fine.final.Glc, 0.01, 'refined glucose trajectory');
  assert(coarse.mass.o2ResidualPct < 1e-5, `coarse closed O₂ residual too large: ${coarse.mass.o2ResidualPct}`);
  assert(fine.mass.o2ResidualPct < 1e-5, `fine closed O₂ residual too large: ${fine.mass.o2ResidualPct}`);
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

run('grouped bulk O2 still shares the oil reservoir at finite exchange', () => {
  const lambda = 0.1;
  const occupancy = buildOccupancyModel(lambda, 1000, 1);
  const common = {
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
    maxDays: 0.1,
    atmMode: 'closed',
    headspace_mL: 0,
    o2Threshold: 0,
  };
  const isolated = Engine.simulate(makeParams({ ...common, dropHalf: 1e9 }));
  const finite = Engine.simulate(makeParams({ ...common, dropHalf: 5 }));
  assert(finite.final.O2Empty < isolated.final.O2Empty - 1, `finite oil-mediated exchange should let occupied droplets draw oxygen from empty droplets through shared oil; isolated empty=${isolated.final.O2Empty}, finite empty=${finite.final.O2Empty}`);
  assert(finite.mass.o2Consumed > isolated.mass.o2Consumed + 1, `finite oil-mediated exchange should relay additional oxygen into occupied droplets for consumption; isolated=${isolated.mass.o2Consumed}, finite=${finite.mass.o2Consumed}`);
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

run('explicit Q10 correction is applied once and condition-matched rates can disable it', () => {
  let referenceRates;
  withMockDom(baseFormValues({ temperature: '37', rateTemperatureMode: 'reference_q10', rateReferenceTemperature: '37', rateQ10: '2' }), () => {
    const p = gatherParams();
    referenceRates = { ...p.rates };
    assert.strictEqual(p.rateApplicationMode, 'reference_q10_extrapolation', 'Q10 rate application mode should be explicit');
    assert.strictEqual(p.temperatureMultiplier, 1, 'reference-temperature multiplier must equal one exactly');
  });
  withMockDom(baseFormValues({ temperature: '47', rateTemperatureMode: 'reference_q10', rateReferenceTemperature: '37', rateQ10: '2' }), () => {
    const p = gatherParams();
    assert.strictEqual(p.temperatureMultiplier, 2, 'a 10 C increase must multiply rates by Q10 exactly');
    for (const key of ['ocr', 'gcr', 'lpr', 'gln']) approx(p.rates[key], referenceRates[key] * 2, 1e-12, `${key} should receive exactly one Q10 multiplier`);
  });
  withMockDom(baseFormValues({ temperature: '47', rateTemperatureMode: 'condition_matched', rateReferenceTemperature: '37', rateQ10: '2' }), () => {
    const p = gatherParams();
    assert.strictEqual(p.rateApplicationMode, 'condition_matched_direct', 'condition-matched mode should be explicit');
    assert.strictEqual(p.temperatureMultiplier, 1, 'condition-matched mode must not extrapolate');
    for (const key of ['ocr', 'gcr', 'lpr', 'gln']) approx(p.rates[key], referenceRates[key], 1e-12, `${key} should remain measured when correction is disabled`);
  });
  const base = makeParams({ targetCells: 1, lambda: 0, rates: { ocr: 0.5, gcr: 0, lpr: 0, gln: 0 }, initialO2T: 10, initialO2B: 10, initialO2Oil: 0, initialO2Res: 0, VoilEmul_uL: 0, residualOil_uL: 0, headspace_mL: 0, gasHalf: 1e9, oilHalf: 1e9, dropHalf: 1e9, o2Threshold: 1, maxDays: 0.05 });
  const reference = Engine.simulate(base);
  const warmer = Engine.simulate({ ...base, rates: { ...base.rates, ocr: base.rates.ocr * 2 } });
  assert(warmer.safeMin < reference.safeMin, `higher Q10-scaled demand should shorten threshold time: ${warmer.safeMin} vs ${reference.safeMin}`);
});

run('one complete copy-summary implementation is present', () => {
  assert.strictEqual((html.match(/function copySummary\(/g) || []).length, 1, 'copy summary must have exactly one implementation');
  assert(html.includes('Deterministic demand range:'), 'copy summary should retain its complete demand-range section');
  assert(html.includes('source commit ${artifactMetadata().sourceCommit}'), 'copy summary should retain release provenance');
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
    r.calibration = { fitMode: 'dropHalf', bestFit: { dropHalf: 10 } };
    const payload = buildExportPayload(r);
    assert.strictEqual(payload.release, 'v19-html-authoritative-20260716', 'export release mismatch');
    assert.strictEqual(payload.artifactCommit, 'd4032d9863245a89b4113788fed2cea33372da1f', 'export artifact commit mismatch');
    assert(payload.auditManifestSha256 && payload.auditManifestSha256.length === 64, 'export manifest hash missing');
    assert(payload.rawInputs && payload.rawInputs.cellLine === 'test_cell', 'raw input snapshot missing');
    assert(payload.effectiveParameters && payload.effectiveParameters.cell.id === 'test_cell', 'effective parameters missing');
    assert(payload.parameterProvenance && payload.parameterProvenance.cellLine.source, 'parameter provenance missing');
    assert(payload.actualConductances && payload.actualConductances.fmolPerMinPerUM.dropTarget >= 0, 'conductance summary missing');
    assert(payload.solverTolerances && payload.solverTolerances.rootMaxIterationsPerEvent === 36, 'solver tolerances missing');
    assert.strictEqual(payload.pHModel, 'carbonate_alkalinity', 'export pH model missing');
    assert(payload.calibration && payload.calibration.bestFit.dropHalf === 10, 'export calibration summary missing');
    assert(Array.isArray(payload.warnings), 'export warnings missing');
    assert(Array.isArray(payload.rateScenarios) && payload.rateScenarios.length === 3, 'export rate scenarios missing');
    assert.strictEqual(typeof payload.trackedCarbonResidualApplicable, 'boolean', 'tracked-carbon applicability missing');
    assert(payload.occupancyGroups && payload.occupancyGroups.groups.empty && payload.occupancyGroups.groups.single && payload.occupancyGroups.groups.multi, 'occupancy group export missing');
    assert(Number.isFinite(payload.occupancyGroups.groups.single.population), 'single-group population export missing');
    approx(payload.occupancyGroups.reconciliation.capacity_nL, 0, 1e-9, 'exported capacity reconciliation failed');
    assert(payload.parameterProvenance.oil.co2EvidenceClassification, 'oil CO2 evidence classification missing');
    const csv = toCSV(r);
    for (const field of ['empty_capacity_nL','single_population','multi_glucose_mM','bulk_lactate_amount_weighted_mM','dic_reconciliation_mM_nL']) assert(csv.split('\n')[0].includes(field), `CSV occupancy field missing: ${field}`);
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

run('evidence-gated planning scenarios reduce precision and keep high demand conservative', () => {
  const proxy = makeParams({ cell: { id: 'proxy', name: 'Proxy', rateTier: 'C' }, directMeasuredRates: false, halfTimeMode: 'reference_scaled', med: { id: 'test_medium' }, pHModel: 'heuristic_legacy', geometryMode: 'auto' });
  const measured = makeParams({ cell: { id: 'custom', name: 'Measured', rateTier: 'A' }, directMeasuredRates: true, halfTimeMode: 'measured_effective', med: { id: 'custom_medium' }, pHModel: 'carbonate_alkalinity', geometryMode: 'measured' });
  const proxyQuality = inputQualityGrade(proxy), measuredQuality = inputQualityGrade(measured);
  assert(proxyQuality.grade > measuredQuality.grade, 'lower evidence quality must receive a lower grade');
  assert(planningTimeLabel(81.6732 * 60, proxyQuality).includes('approximately') && !planningTimeLabel(81.6732 * 60, proxyQuality).includes('6732'), 'proxy planning output must not expose excessive precision');
  const p = makeParams({
    cell: { id: 'bounded', name: 'Bounded', rateTier: 'A', ocr: 0, ocrLow: 0, ocrHigh: 0, gcr: 1, gcrLow: 0.5, gcrHigh: 2, lpr: 0, lprLow: 0, lprHigh: 0, gln: 0, glnLow: 0, glnHigh: 0 },
    rates: { ocr: 0, gcr: 1, lpr: 0, gln: 0 }, targetCells: 1, lambda: 0, sub: { glc: 1, gln: 10, lac: 0, bicarb: 26 }, glucoseFloor: 0.1,
    initialO2T: 100, initialO2B: 100, initialO2Oil: 100, initialO2Res: 100, gasHalf: 1e9, oilHalf: 1e9, dropHalf: 1e9, o2Threshold: 0, maxDays: 0.05,
  });
  const scenarios = buildRateScenarioResults(p), high = scenarios.find((scenario) => scenario.id === 'high_demand'), nominal = scenarios.find((scenario) => scenario.id === 'nominal');
  assert(high.safeMin <= nominal.safeMin + 1e-9, `high-demand scenario must not deplete nutrients later: ${high.safeMin} vs ${nominal.safeMin}`);
});

run('canonical calculation result is immutable and drives consistent exports', () => {
  withMockDom(baseFormValues(), () => {
    const p = gatherParams();
    const raw = Engine.simulate(p);
    raw.rateScenarios = buildRateScenarioResults(p);
    const r = canonicalCalculationResult(raw);
    assert(Object.isFrozen(r) && Object.isFrozen(r.params) && Object.isFrozen(r.timeSeries), 'canonical calculation result must be deeply immutable');
    assert.strictEqual(r.calculationSchema, 'droplet-metabolic-calculation-result/v1', 'canonical calculation schema missing');
    assert(r.calculationHash && r.calculationHash === calculationHash({release:r.release,inputs:r.normalizedInputs,derived:r.derivedParameters,events:r.thresholdEvents,limiter:r.limiter,safeMin:r.safeMin,final:r.final,rateScenarios:r.rateScenarios||[],calibration:r.calibration||null}), 'deterministic calculation hash mismatch');
    const payload = buildExportPayload(r);
    const csv = toCSV(r);
    assert.strictEqual(payload.calculationHash, r.calculationHash, 'JSON export must retain canonical calculation hash');
    assert(csv.includes(r.calculationHash), 'CSV export must retain canonical calculation hash');
    assert(csv.includes(`,${r.safeMin},${r.limiter},`), 'CSV export must retain canonical limiting time and label');
    assert(payload.valueProvenance && Object.values(payload.valueProvenance).every(Boolean), 'every canonical output group requires provenance');
    const reproduced = canonicalCalculationResult({ ...Engine.simulate(payload.effectiveParameters), rateScenarios: buildRateScenarioResults(payload.effectiveParameters) });
    assert.strictEqual(reproduced.calculationHash, r.calculationHash, 're-imported effective configuration should reproduce the same calculation hash');
    const augmented = canonicalCalculationResult({ ...r, calibration: { fitMode: 'dropHalf', bestFit: { dropHalf: 12 } } });
    assert(Object.isFrozen(augmented) && Object.isFrozen(augmented.calibration), 'augmented canonical result must remain deeply frozen');
    assert.notStrictEqual(augmented.calculationHash, r.calculationHash, 'calibration augmentation must recalculate the calculation hash');
  });
});

run('NaN and overflowing numeric inputs are rejected before solver execution', () => {
  withMockDom(
    baseFormValues({
      maxDays: 'NaN',
      ocrOverride: '1e309',
    }),
    () => {
      const p = gatherParams();
      assert(p.invalid.some((msg) => msg.includes('Simulation horizon') && msg.includes('finite number')), 'NaN simulation horizon should be rejected');
      assert(p.invalid.some((msg) => msg.includes('OCR override') && msg.includes('finite number')), 'overflowing OCR override should be rejected');
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

run('progress hooks report worker-safe progress without changing solver results', () => {
  const p = makeParams({ maxDays: 0.05, gasHalf: 0.5, oilHalf: 0.5, dropHalf: 0.5, rates: { ocr: 0.4, gcr: 0, lpr: 0, gln: 0 } });
  const progress = [];
  const hooked = Engine.simulate(p, { progress: (info) => progress.push(info) });
  const plain = Engine.simulate(p);
  assert(progress.length > 0, 'progress hook should receive updates');
  assert(progress.every((info, idx) => idx === 0 || info.acceptedSteps >= progress[idx - 1].acceptedSteps), 'accepted-step progress should be monotone');
  approx(hooked.safeMin, plain.safeMin, 1e-9, 'progress hook should not change safe time');
  approx(hooked.final.O2T, plain.final.O2T, 1e-9, 'progress hook should not change final oxygen');
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

run('auto bulk O2 switches to grouped transport when exchange is slow', () => {
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
  const grouped = Engine.simulate({ ...base, bulkO2Mode: 'grouped_transport_limited' });
  assert.strictEqual(auto.bulkO2Regime.selectedMode, 'grouped_transport_limited', 'auto mode should switch to grouped transport when depletion outruns exchange');
  assert.strictEqual(auto.bulkO2Regime.recommendedMode, 'grouped_transport_limited', 'auto mode should recommend grouped transport when depletion outruns exchange');
  assert.strictEqual(auto.bulkO2Regime.warningOnly, false, 'transport-limited auto mode should not leave a shared-model warning-only state');
  approx(auto.safeMin, grouped.safeMin, 1e-9, 'auto mode should execute the grouped transport model');
});

run('auto bulk O2 switches when proliferation makes later depletion transport-limited', () => {
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
  assert.strictEqual(auto.bulkO2Regime.selectedMode, 'grouped_transport_limited', 'auto mode should switch to grouped transport when later depletion competes with exchange');
  assert.strictEqual(auto.bulkO2Regime.recommendedMode, 'grouped_transport_limited', 'later transport limitation should recommend grouped transport');
  assert.strictEqual(auto.bulkO2Regime.warningOnly, false, 'later transport limitation should not remain warning-only');
  assert(auto.bulkO2Regime.sampledTimeMin > 0, 'transport limitation should be detected from a later sampled time, not only the initial state');
  approx(auto.safeMin, grouped.safeMin, 1e-9, 'auto mode should run the grouped reference');
  assert(Math.abs(grouped.safeMin - shared.safeMin) > 1e-6 || Math.abs(grouped.final.O2BulkOccupied - shared.final.O2BulkOccupied) > 1e-6, 'grouped comparison should remain available when later transport limitation matters');
});

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
process.exit(failCount === 0 ? 0 : 1);
