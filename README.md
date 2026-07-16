# Metabolic Depletion Forecaster

Browser-based calculator for estimating useful incubation windows in droplet emulsions and small-volume culture formats.

Current release status:
`v19-html-authoritative-20260716`

- Conserved O₂ and tracked CO₂ are solved in amount space for closed systems.
- Finite exchange now uses the entered half-time as the actual concentration-difference half-time for finite pairs, with a simultaneous conservative solve across the coupled exchange network.
- Initial liquid O₂ and closed-headspace gas states are independent of the selected boundary gas.
- Bulk demand uses Poisson occupancy classes so empty droplets do not inherit carrying capacity.
- Bulk O₂ now keeps fluorinated oil as the shared reversible reservoir, explicitly compares oil-mediated droplet equilibration against local occupied-droplet depletion, and recommends the conservative grouped empty/single/multi comparison only when depletion is comparable to or faster than equilibration. Even in grouped mode, empty and occupied droplets still communicate through the shared oil phase.
- O₂ uptake is Michaelis-Menten-limited near low oxygen.
- Partial-step endpoint acceptance reruns only the accepted fraction, so mass counters and stop times stay aligned.
- Zero-headspace closed runs disable headspace gas exchange instead of leaking into a nonexistent gas compartment.
- Closed tracked-CO₂ residuals are only reported for finite closed-headspace carbon-balance mode, not for external CO₂ reservoir modes.
- Oil-phase CO₂ is disabled by default for every oil because no embedded record has CO₂-specific capacity evidence. It can be enabled only with capacity and transport inputs labeled `Unvalidated planning assumption — user supplied`.
- Exchange half-times now support two modes: geometry-scaled reference values or directly applied measured-effective values.
- Rate inputs now support two temperature interpretations: referenced to 37 °C with Q10 scaling, or already measured at the selected temperature with no Q10 scaling.
- Bulk nutrients are now resolved by occupancy class, so empty, single-cell, and multi-cell bulk droplets can diverge in glucose, glutamine, and lactate history even while sharing the same oil reservoir for O₂.
- Proliferation now evolves accepted-step population state and supports a stress-limited mode driven by local O₂, glucose, glutamine, lactate, and pH. The legacy mode uses the same stateful step with environmental stress fixed to one.
- Deterministic low-demand / nominal / high-demand scenario runs are available from stored cell-line rate bounds.
- Calibration now accepts pasted O₂ time series, fits selected transport half-times for the current setup, and reports residuals, profile-style ranges, and identifiability warnings.
- JSON exports now carry release metadata, audited source commit, audit-manifest SHA-256, raw input snapshots, effective parameters, parameter provenance, actual conductances, solver tolerances, solver diagnostics, grouped bulk nutrient summaries, growth-model metadata, warnings, and deterministic scenario summaries.
- Manual calculations and sweeps now run in a background Web Worker when supported, with progress text and a cancel button instead of freezing the UI thread.
- pH now defaults to a carbonate/alkalinity mode that tracks aqueous DIC, headspace CO₂, bicarbonate/carbonate speciation, water dissociation, lactate acid equivalents, and linear non-bicarbonate buffer alkalinity. The legacy heuristic bicarbonate/CO₂ mode remains available for backward comparison.

## Use

Open `metabolic_depletion_forecaster.html` in a browser.

`metabolic_depletion_forecaster.html` is the product, canonical source implementation, and release artifact. No support command generates, reconstructs, or overwrites it. `npm run build` hashes and parses the HTML, extracts derived JavaScript only to ignored `.tmp/`, runs validators, and fails if the HTML hash changes.

Supporting catalogs in `src/data/*.json` and machine-readable provenance in `data/parameter_provenance.json` exist for inspection and verification. Their values are checked against the embedded canonical runtime data; extraction and verification direction is always canonical HTML → temporary/supporting views, never the reverse.

Run regression checks with:

```bash
npm run build:provenance
npm run build:data
npm run check:syntax
npm test
npm run test:browser
npm run build
npm run verify:data
npm run verify:artifact
npm run verify:manifest
npm run verify:provenance
npm run verify:html-is-canonical
```

CI runs the same gate set with an explicit three-minute Node regression timeout and Chromium/Firefox/WebKit coverage where supported. It also fails if support commands alter the canonical HTML or leave tracked files dirty.

Scientific source metadata is now exported to `data/parameter_provenance.json`, generated deterministically from the current source data and verified in CI.

Supporting audit docs:

- `MODEL_SPECIFICATION.md`
- `VALIDATION.md`
- `AUDIT_MANIFEST.json`
- `src/data/`
- `data/parameter_provenance.json`

## Main controls

- Setup: cell line, medium, droplet volume, target occupancy, additives.
- Emulsion & Gas: Poisson λ, total emulsion volume, aqueous fraction, reservoir oil volume, oil type, vessel format, and exchange kinetics.
- Environment: gas phase, finite or replenished boundary, temperature, pH limits, and hypoxia threshold.
- Metabolism: growth enable/disable, stress-limited vs legacy logistic growth mode, Warburg override, rate overrides, Pasteur effect, and output settings.
- Diagnostics: gas capacity, exchange half-times, timeline table, transport calibration, exports, and sensitivity sweep.

## Vessel formats

The vessel selector includes 1.5 mL microcentrifuge tube, 15 mL conical tube, 600 µm ID PTFE tubing, and custom geometry. Tube formats calculate closed headspace from vessel capacity minus entered liquid volume. PTFE tubing uses wall area and tubing capacity from the selected length.
