const path = require('path');
const { loadSourceData } = require('./source_data_utils');

const CELL_PARAMETER_SPECS = [
  ['ocr', 'fmol/cell/min'],
  ['ocrLow', 'fmol/cell/min'],
  ['ocrHigh', 'fmol/cell/min'],
  ['gcr', 'fmol/cell/min'],
  ['gcrLow', 'fmol/cell/min'],
  ['gcrHigh', 'fmol/cell/min'],
  ['lpr', 'fmol/cell/min'],
  ['lprLow', 'fmol/cell/min'],
  ['lprHigh', 'fmol/cell/min'],
  ['gln', 'fmol/cell/min'],
  ['glnLow', 'fmol/cell/min'],
  ['glnHigh', 'fmol/cell/min'],
  ['warburg', 'relative multiplier'],
  ['dt', 'h'],
  ['lag', 'h'],
  ['rq', 'dimensionless'],
];

const MEDIUM_PARAMETER_SPECS = [
  ['glc', 'mM'],
  ['gln', 'mM'],
  ['pyr', 'mM'],
  ['bicarb', 'mM'],
  ['buffer', 'mM/pH'],
  ['lac', 'mM'],
];

const OIL_PARAMETER_SPECS = [
  ['capacityRatio', 'water-equivalent ratio'],
  ['defaultDropHalf', 'min'],
];

function cleanValue(value) {
  return value === undefined ? null : value;
}

function nonEmptyArray(values) {
  return Array.isArray(values) ? values.filter((value) => value != null && value !== '') : [];
}

function cellParameterRecord(cell, parameter, unit) {
  const rateSource = nonEmptyArray(cell.rateRefs).length ? nonEmptyArray(cell.rateRefs) : nonEmptyArray(cell.refs);
  const confidenceTier = cell.rateTier || cell.evidenceTier || null;
  return {
    parameter,
    value: cleanValue(cell[parameter]),
    unit,
    source: rateSource,
    exactLineOrProxy: cell.rateBasis || cell.estimateBasis || (cell.aliasOf ? `Alias of ${cell.aliasOf}` : null),
    experimentalConditions: {
      cultureMode: cell.cultureMode || null,
      tissue: cell.tissue || null,
      diseaseModel: cell.diseaseModel || null,
      recommendedMediumId: cell.recommendedMediumId || null,
    },
    conversionPerformed: cell.rateUncertaintyModel || null,
    confidenceTier,
    notes: nonEmptyArray([
      cell.group || null,
      cell.fullName || null,
      cell.measuredDefault == null ? null : `measuredDefault=${cell.measuredDefault}`,
      cell.rateRevision || null,
    ]),
  };
}

function mediumParameterRecord(medium, parameter, unit) {
  return {
    parameter,
    value: cleanValue(medium[parameter]),
    unit,
    source: nonEmptyArray(medium.refs),
    exactLineOrProxy: medium.id === 'custom_medium' ? 'User-defined medium values' : 'Nominal formulation preset',
    experimentalConditions: {
      group: medium.group || null,
    },
    conversionPerformed: null,
    confidenceTier: null,
    notes: nonEmptyArray([medium.name || null]),
  };
}

function oilParameterRecord(oil, parameter, unit) {
  return {
    parameter,
    value: cleanValue(oil[parameter]),
    unit,
    source: nonEmptyArray(oil.refs),
    exactLineOrProxy: oil.id === 'pdms' ? 'PDMS wall/chip phase planning preset' : 'Carrier-oil planning preset',
    experimentalConditions: null,
    conversionPerformed: null,
    confidenceTier: null,
    notes: nonEmptyArray([oil.name || null]),
  };
}

function buildParameterProvenance(root) {
  const { DATA, sourcePaths } = loadSourceData(root);
  const cellLines = Object.fromEntries(
    Object.entries(DATA.cellLines).map(([id, cell]) => [
      id,
      {
        entityType: 'cellLine',
        id,
        name: cell.name || null,
        fullName: cell.fullName || null,
        hidden: !!cell.hidden,
        aliasOf: cell.aliasOf || null,
        canonical: !cell.aliasOf,
        records: CELL_PARAMETER_SPECS.map(([parameter, unit]) => cellParameterRecord(cell, parameter, unit)),
      },
    ])
  );
  const media = Object.fromEntries(
    Object.entries(DATA.media).map(([id, medium]) => [
      id,
      {
        entityType: 'medium',
        id,
        name: medium.name || null,
        records: MEDIUM_PARAMETER_SPECS.map(([parameter, unit]) => mediumParameterRecord(medium, parameter, unit)),
      },
    ])
  );
  const oils = Object.fromEntries(
    Object.entries(DATA.oils).map(([id, oil]) => [
      id,
      {
        entityType: 'oil',
        id,
        name: oil.name || null,
        records: OIL_PARAMETER_SPECS.map(([parameter, unit]) => oilParameterRecord(oil, parameter, unit)),
      },
    ])
  );
  return {
    schemaVersion: 1,
    generatedFrom: {
      sourceFile: 'src/data/*.json',
      sourceFiles: Object.values(sourcePaths),
      generator: path.join('scripts', 'build_parameter_provenance.js').replaceAll(path.sep, '/'),
    },
    requiredFields: [
      'parameter',
      'value',
      'unit',
      'source',
      'exactLineOrProxy',
      'experimentalConditions',
      'conversionPerformed',
      'confidenceTier',
      'notes',
    ],
    cellLines,
    media,
    oils,
  };
}

module.exports = {
  buildParameterProvenance,
};
