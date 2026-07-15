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
- target-droplet glucose, glutamine, lactate, tracked aqueous carbon, and selectable pH model

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

## Calibration

The diagnostics tab can fit pasted O₂ time series against transport half-times for the current physical setup. Supported observables are:

- target droplet oxygen
- grouped bulk-droplet oxygen
- emulsion-oil oxygen
- reservoir-oil oxygen

Supported fit modes are:

- `dropHalf`
- `oilHalf`
- `gasHalf`
- `dropHalf+oilHalf`

The fitter uses the same `Engine.simulate(...)` path as normal predictions, samples the measurement horizon only, interpolates the chosen observable at each measurement time, and minimizes summed squared error on a log-spaced search grid. Reported diagnostics include residuals, profile-style accepted ranges, and a likelihood-weighted local log-parameter correlation for two-parameter fits.

Calibration is intentionally conservative about identifiability. It warns when accepted ranges stay broad, when the optimum lands on the search boundary, or when two fitted parameters remain strongly correlated. The workflow does not yet recalibrate metabolic rates, nutrient kinetics, or pH chemistry.

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

## Parameter provenance

Machine-readable source metadata is committed in `data/parameter_provenance.json`. The file is generated deterministically from the current source cell-line, medium, and oil records and includes, for every exported parameter:

- parameter name
- value
- unit
- source reference list
- exact-line versus proxy note
- experimental-condition metadata where available
- conversion or uncertainty note
- confidence tier
- free-text notes

This provenance artifact is verified in CI against the current source data so committed scientific metadata cannot silently drift from the model defaults.

## Carbon accounting

Tracked carbon currently includes:

- target aqueous tracked carbon
- grouped bulk aqueous tracked carbon
- finite closed headspace CO2 when `pHBoundaryMode = closed_headspace_mass_balance`

In `carbonate_alkalinity`, aqueous tracked carbon is DIC and the gas-exchange solve uses the dissolved-CO2 fraction implied by the current carbonate speciation. In `heuristic_legacy`, aqueous tracked carbon remains dissolved CO2. Oil-phase CO2 is not yet tracked, so residuals remain labeled as tracked aqueous + headspace carbon residuals rather than full closed-carbon residuals.

## pH

Two pH modes are available:

- `carbonate_alkalinity`
  Default mode. Solves pH from aqueous DIC, bicarbonate/carbonate speciation, water dissociation, lactate acid equivalents, and linear non-bicarbonate buffer alkalinity.
- `heuristic_legacy`
  Backward-comparison mode. Uses the older Henderson-Hasselbalch bicarbonate/CO2 approximation with empirical buffer correction.

Even in `carbonate_alkalinity`, this is not yet a full explicit-medium chemistry model: ionic-strength effects, explicit HEPES/protein species, ammonia chemistry, and oil-phase CO2 are still simplified or omitted.
