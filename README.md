# Metabolic Depletion Forecaster

Browser-based calculator for estimating useful incubation windows in droplet emulsions and small-volume culture formats.

Current release status:
`v18-transport-20260715`

- Conserved O₂ and tracked CO₂ are solved in amount space for closed systems.
- Finite exchange now uses the entered half-time as the actual concentration-difference half-time for finite pairs, with a simultaneous conservative solve across the coupled exchange network.
- Initial liquid O₂ and closed-headspace gas states are independent of the selected boundary gas.
- Bulk demand uses Poisson occupancy classes so empty droplets do not inherit carrying capacity.
- Bulk O₂ now keeps fluorinated oil as the shared reversible reservoir, explicitly compares oil-mediated droplet equilibration against local occupied-droplet depletion, and recommends the conservative grouped empty/single/multi comparison only when depletion is comparable to or faster than equilibration. Even in grouped mode, empty and occupied droplets still communicate through the shared oil phase.
- O₂ uptake is Michaelis-Menten-limited near low oxygen.
- Partial-step endpoint acceptance reruns only the accepted fraction, so mass counters and stop times stay aligned.
- Zero-headspace closed runs disable headspace gas exchange instead of leaking into a nonexistent gas compartment.
- Closed tracked-CO₂ residuals are only reported for finite closed-headspace carbon-balance mode, not for external CO₂ reservoir modes.
- CO₂ diagnostics are explicitly labeled as tracked aqueous + headspace CO₂ residuals; oil-phase CO₂ is not yet tracked.
- Exchange half-times now support two modes: geometry-scaled reference values or directly applied measured-effective values.
- Rate inputs now support two temperature interpretations: referenced to 37 °C with Q10 scaling, or already measured at the selected temperature with no Q10 scaling.
- Deterministic low-demand / nominal / high-demand scenario runs are available from stored cell-line rate bounds.
- Calibration now accepts pasted O₂ time series, fits selected transport half-times for the current setup, and reports residuals, profile-style ranges, and identifiability warnings.
- JSON exports now carry release metadata, audited source commit, audit-manifest SHA-256, raw input snapshots, effective parameters, parameter provenance, actual conductances, solver tolerances, solver diagnostics, warnings, and deterministic scenario summaries.
- Manual calculations and sweeps now run in a background Web Worker when supported, with progress text and a cancel button instead of freezing the UI thread.
- pH now defaults to a carbonate/alkalinity mode that tracks aqueous DIC, headspace CO₂, bicarbonate/carbonate speciation, water dissociation, lactate acid equivalents, and linear non-bicarbonate buffer alkalinity. The legacy heuristic bicarbonate/CO₂ mode remains available for backward comparison.

## Use

Open `metabolic_depletion_forecaster.html` in a browser.

The committed standalone artifact is generated deterministically from `src/standalone_artifact.template.html`, the ordered `src/model/*.js` and `src/ui/*.js` source modules, and the current audit-manifest metadata.
The current source layout keeps runtime data in `src/data/`, model constants/bootstrap in `src/model/00_model_and_solver.js`, extracted pure simulation and calibration logic in `src/model/10_engine_and_calibration.js`, and DOM/export logic in `src/ui/10_ui_and_exports.js`.
Scientific runtime defaults for cell lines, media, oils, and reference rows now live in `src/data/*.json`; the offline runtime bundle in `src/model/00_data.generated.js` is generated deterministically from those source catalogs.

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
```

CI runs the same gate set on every push and pull request, and also fails if rebuilding the standalone artifact leaves tracked files dirty.

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
- Metabolism: growth, Warburg override, rate overrides, Pasteur effect, and output settings.
- Diagnostics: gas capacity, exchange half-times, timeline table, transport calibration, exports, and sensitivity sweep.

## Vessel formats

The vessel selector includes 1.5 mL microcentrifuge tube, 15 mL conical tube, 600 µm ID PTFE tubing, and custom geometry. Tube formats calculate closed headspace from vessel capacity minus entered liquid volume. PTFE tubing uses wall area and tubing capacity from the selected length.
