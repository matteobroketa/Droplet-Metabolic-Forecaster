# Validation

Release: `v18-transport-20260715`

## Automated checks

Primary regression command:

```bash
node scripts/check_syntax.js
node tests/audit_regression.js
```

Current minimum enforced checks: `76`

The regression suite covers:

- closed oxygen conservation
- closed tracked aqueous + oil + headspace CO2 conservation
- independent initial-vs-boundary oxygen states
- preoxygenated liquid outgassing into finite closed headspace
- Michaelis-Menten oxygen-limited uptake
- refined root solving for oxygen, nutrient, and pH endpoints
- hard input rejection without silent rounding for target-cell count
- inactive-field validation suppression
- incompatible carbon/gas mode rejection
- measured-effective vs reference-scaled half-time interpretation
- finite-pair and infinite-boundary half-time analytical checks
- shared-limit and isolated-droplet-limit bulk oxygen checks
- finite-exchange shared-oil relay between empty and occupied droplet groups
- transport-limited warning detection with grouped comparison still available
- carbonate/alkalinity equilibrium against an independent root solve
- carbonate closed-headspace tracked-carbon conservation
- default-disabled oil CO2 provenance, explicit unvalidated override, and no O2-derived CO2 transport checks
- monotonic pH protection from increased non-bicarbonate buffer capacity
- true empty/single/multicell chemical capacities in auto, shared, and grouped O2 modes, including export reconciliation
- stateful growth identity, material stress suppression, integrated-demand reduction, monotonicity, finite/nonnegative populations, and timestep convergence
- deterministic low/nominal/high demand scenario generation
- calibration parsing, synthetic half-time recovery, workload telemetry, and the 5-second / 30,000-step performance budget
- canonical embedded-data equality against supporting JSON catalogs
- deterministic source-backed parameter-provenance generation and coverage for cell lines, media, and oils
- export reproducibility metadata
- progress-hook solver equivalence
- preset and vessel synchronization
- database integrity checks
- solver-budget protection
- HTML-authoritative architecture, absence of competing template/modules, and hash invariance across support commands
- CI workflow enforcement of syntax, regression timeout, three-browser matrix, build validation, manifest, canonical-hash, and clean-tree gates
- machine-readable provenance verification for scientific source data

## Browser smoke coverage

Browser command:

```bash
npm run test:browser
```

The browser smoke test verifies:

- current release label on direct `file://` load in Chromium, Firefox, and WebKit where supported
- no external runtime requests
- artifact commit and manifest hash metadata are stamped
- default calculation renders
- keyboard activation can switch tabs
- worker-backed long runs expose cancel status
- measured-effective mode renders diagnostics
- reference-scaled mode renders diagnostics
- calibration UI runs and renders a best-fit summary
- inactive custom cell/gas fields are ignored while active invalid custom fields block calculation
- closed tracked-carbon mode and external CO₂ mode render distinct diagnostics
- incompatible finite-headspace carbon mode blocks calculation
- anoxic selected-gas thresholds are rejected
- grouped transport mode, vessel synchronization, and presets update visible controls
- growth-model and grouped-carbon diagnostics render in the rebuilt artifact
- CSV, JSON, data, PNG, and clipboard export paths trigger successfully
- versioned local-state restore survives reload and ignores stale legacy-key state
- no rendered `NaN` or `Infinity`
- no console errors
- zero-headspace conductance/flux behavior and auto-mode occupancy reconciliation
- saved-state recovery from malformed JSON
- dialog open/close and Escape behavior
- chart text alternative and form-label accessibility checks

## Remaining validation gaps

- The default pH layer uses carbonate/alkalinity chemistry, but it is still not benchmarked against a full explicit-medium ionic-strength solver. Oil-phase CO₂ is disabled by default and user overrides remain unvalidated.
- Bulk nutrients are occupancy-resolved, but nutrient exchange among droplets is still not modeled.
- Calibration currently fits only transport half-times from O₂ series; it does not yet provide joint identifiability against metabolic-rate uncertainty or pH data.
- The canonical HTML intentionally remains a single-file implementation. Temporary extraction supports testing, but there is no reverse build path from modules or templates.
