# Validation

Release: `v18-transport-20260715`

## Automated checks

Primary regression command:

```bash
node tests/audit_regression.js
```

Current minimum enforced checks: `52`

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
- proliferation-triggered grouped transport selection
- preset and vessel synchronization
- database integrity checks
- solver-budget protection

## Browser smoke coverage

Browser command:

```bash
npm run test:browser
```

The browser smoke test verifies:

- current release label on load
- default calculation renders
- measured-effective mode renders diagnostics
- incompatible finite-headspace carbon mode blocks calculation
- anoxic selected-gas thresholds are rejected
- no rendered `NaN` or `Infinity`
- no console errors

## Remaining validation gaps

- The pH layer is still heuristic and not benchmarked against a full carbonate/alkalinity solver.
- Oil-phase CO2 is not yet included in the tracked-carbon residual.
- Bulk nutrients remain mean-field even when oxygen uses grouped droplet states.
- The standalone artifact is still monolithic; build currently verifies the committed artifact rather than regenerating it from split source modules.
