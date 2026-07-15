# Metabolic Depletion Forecaster

Browser-based calculator for estimating useful incubation windows in droplet emulsions and small-volume culture formats.

Current release status:

- Conserved O₂ and tracked CO₂ are solved in amount space for closed systems.
- Initial liquid O₂ and closed-headspace gas states are independent of the selected boundary gas.
- Bulk demand uses Poisson occupancy classes so empty droplets do not inherit carrying capacity.
- O₂ uptake is Michaelis-Menten-limited near low oxygen.
- Partial-step endpoint acceptance reruns only the accepted fraction, so mass counters and stop times stay aligned.
- Zero-headspace closed runs disable headspace gas exchange instead of leaking into a nonexistent gas compartment.
- Closed tracked-CO₂ residuals are only reported for finite closed-headspace carbon-balance mode, not for external CO₂ reservoir modes.
- Exchange half-times now support two modes: geometry-scaled reference values or directly applied measured-effective values.
- pH remains a heuristic bicarbonate/CO₂ estimate, not a full carbonate alkalinity solver.

## Use

Open `metabolic_depletion_forecaster.html` in a browser.

Run regression checks with:

```bash
node tests/audit_regression.js
```

## Main controls

- Setup: cell line, medium, droplet volume, target occupancy, additives.
- Emulsion & Gas: Poisson λ, total emulsion volume, aqueous fraction, reservoir oil volume, oil type, vessel format, and exchange kinetics.
- Environment: gas phase, finite or replenished boundary, temperature, pH limits, and hypoxia threshold.
- Metabolism: growth, Warburg override, rate overrides, Pasteur effect, and output settings.
- Diagnostics: gas capacity, exchange half-times, timeline table, exports, and sensitivity sweep.

## Vessel formats

The vessel selector includes 1.5 mL microcentrifuge tube, 15 mL conical tube, 600 µm ID PTFE tubing, and custom geometry. Tube formats calculate closed headspace from vessel capacity minus entered liquid volume. PTFE tubing uses wall area and tubing capacity from the selected length.
