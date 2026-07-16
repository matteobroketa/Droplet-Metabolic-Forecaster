# Validation

Release: `v18-transport-20260715`

## Automated checks

Primary regression command:

```bash
node scripts/check_syntax.js
node tests/audit_regression.js
```

Current minimum enforced checks: `70`

The regression suite covers:

- closed oxygen conservation
- closed tracked aqueous + headspace CO2 conservation
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
- monotonic pH protection from increased non-bicarbonate buffer capacity
- deterministic low/nominal/high demand scenario generation
- calibration parsing, synthetic half-time recovery, and calibration export metadata
- generated runtime data bundle reproducibility from source JSON catalogs
- deterministic source-backed parameter-provenance generation and coverage for cell lines, media, and oils
- export reproducibility metadata
- progress-hook solver equivalence
- preset and vessel synchronization
- database integrity checks
- solver-budget protection
- deterministic artifact assembly from the source template plus ordered `src/model` and `src/ui` modules
- CI workflow enforcement of syntax, regression, browser, build, manifest, and clean-rebuild gates
- machine-readable provenance verification for scientific source data

## Browser smoke coverage

Browser command:

```bash
npm run test:browser
```

The browser smoke test verifies:

- current release label on load
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
- CSV, JSON, data, PNG, and clipboard export paths trigger successfully
- versioned local-state restore survives reload and ignores stale legacy-key state
- no rendered `NaN` or `Infinity`
- no console errors

## Remaining validation gaps

- The default pH layer now uses carbonate/alkalinity chemistry, but it is still not benchmarked against a full explicit-medium ionic-strength solver with oil-phase CO₂.
- Oil-phase CO2 is not yet included in the tracked-carbon residual.
- Bulk nutrients remain mean-field even when oxygen uses grouped droplet states.
- Calibration currently fits only transport half-times from O₂ series; it does not yet provide joint identifiability against metabolic-rate uncertainty or pH data.
- The standalone artifact is now regenerated from a source template plus ordered `src/model` and `src/ui` modules, but the code and datasets are still only coarse-grained source files rather than fully separated data/physics/ui packages.
