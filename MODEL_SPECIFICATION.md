# Model Specification

Release: `v18-transport-20260715`

## Scope

This artifact is a standalone planning model for droplet emulsions and small-volume culture formats. It couples:

- target-droplet oxygen
- empty bulk-droplet oxygen
- single-cell bulk-droplet oxygen
- multicell bulk-droplet oxygen
- emulsion-oil oxygen
- reservoir-oil oxygen
- optional finite headspace oxygen
- target-droplet glucose, glutamine, lactate, dissolved CO2, and heuristic pH

## Oxygen transport

Fluorinated oil remains the dominant reversible oxygen reservoir. Cells are the irreversible oxygen sink.

Bulk oxygen uses one shared physical oil reservoir with two solver views:

- `shared_mean_field`
  Default bulk approximation. Use when sampled oil-mediated exchange remains fast relative to local occupied-droplet depletion.
- `grouped_transport_limited`
  Conservative empty/single/multicell comparison. Use when sampled local depletion is comparable to or faster than oil-mediated equilibration.

Both views exchange with the same oil compartment. Oxygen is not treated as permanently isolated by droplet occupancy. In `auto`, the model compares the effective oil-to-droplet half-time against sampled local depletion times, retains `shared_mean_field`, and raises a warning plus grouped recommendation only when transport limitation is plausible.
The transport-limited trigger is conservative: when sampled local occupied-droplet depletion becomes comparable to or faster than oil-mediated equilibration, the grouped empty/single/multicell comparison is recommended. When equilibration stays fast, the shared mean-field limit is retained.

## Half-time semantics

Entered half-times have two interpretations:

- `reference_scaled`
  The entered reference half-time is geometry-scaled for the current vessel and droplet size.
- `measured_effective`
  The entered half-time is used directly for the current configuration.

For two finite compartments with capacities `C1` and `C2`, conductance is:

`G = ln(2) / t_half * (C1 * C2) / (C1 + C2)`

For an infinite boundary and one finite compartment with capacity `C`, conductance is:

`G = ln(2) / t_half * C`

These definitions make the entered half-time the actual half-time of the concentration difference for finite pairs and the actual one-compartment relaxation half-time for infinite boundaries.

## Solver

Exchange is advanced with a simultaneous conservative implicit solve across the coupled linear network. Metabolic uptake and byproduct production are then applied in amount space. Event times are refined by repeated reruns of the real state-advance step until the accepted state lies on the threshold within tolerance.

Interactive runs are dispatched to a background Web Worker when the browser supports it. The worker executes the same `Engine.simulate(...)` path and reports accepted-step or sweep-case progress back to the main thread. Cancellation is implemented by terminating the active worker and recreating a fresh worker for the next job.

## Growth and occupancy

Bulk proliferation uses Poisson occupancy classes. Multicell growth is evaluated as an occupancy-weighted sum across classes with `k >= 2`; it is not approximated by a mean seed occupancy.

## Deterministic uncertainty scenarios

The artifact can also run three deterministic demand scenarios:

- low metabolic demand
- nominal
- high metabolic demand

When stored `low/nominal/high` bounds exist for the selected cell line, those bounds are propagated through the current additive, Warburg, and temperature modifiers by scaling around the current effective nominal rates. When stored bounds are unavailable because the user is using custom or explicit override rates, the current effective rates are reused and the UI marks that limitation explicitly.

## Export reproducibility

JSON exports include:

- audited release identifier
- audited source commit from the manifest
- audit-manifest SHA-256 stamped into the artifact
- raw DOM input snapshot
- effective simulation parameters
- parameter provenance summary
- actual transport conductances
- solver tolerances and diagnostics
- warnings and deterministic scenario summaries

## Carbon accounting

Tracked carbon currently includes:

- target aqueous CO2
- grouped bulk aqueous CO2
- finite closed headspace CO2 when `pHBoundaryMode = closed_headspace_mass_balance`

Oil-phase CO2 is not yet tracked. Residuals are therefore labeled as tracked aqueous + headspace CO2 residuals rather than full closed-carbon residuals.

## pH

pH remains heuristic. The current layer uses bicarbonate, dissolved CO2, lactate accumulation, and an empirical buffer-capacity term. It is not yet a full dissolved inorganic carbon and alkalinity solver.
