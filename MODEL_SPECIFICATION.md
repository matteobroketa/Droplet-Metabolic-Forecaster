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

Bulk oxygen uses two explicit regimes:

- `shared_mean_field`
  Use when sampled oil-mediated exchange remains fast relative to local occupied-droplet depletion.
- `grouped_transport_limited`
  Use when sampled local depletion is comparable to or faster than oil-mediated equilibration.

Both grouped and shared modes exchange with the same oil compartment. Oxygen is not treated as permanently isolated by droplet occupancy.

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

## Growth and occupancy

Bulk proliferation uses Poisson occupancy classes. Multicell growth is evaluated as an occupancy-weighted sum across classes with `k >= 2`; it is not approximated by a mean seed occupancy.

## Carbon accounting

Tracked carbon currently includes:

- target aqueous CO2
- grouped bulk aqueous CO2
- finite closed headspace CO2 when `pHBoundaryMode = closed_headspace_mass_balance`

Oil-phase CO2 is not yet tracked. Residuals are therefore labeled as tracked aqueous + headspace CO2 residuals rather than full closed-carbon residuals.

## pH

pH remains heuristic. The current layer uses bicarbonate, dissolved CO2, lactate accumulation, and an empirical buffer-capacity term. It is not yet a full dissolved inorganic carbon and alkalinity solver.
