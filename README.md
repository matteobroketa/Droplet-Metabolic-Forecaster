# Metabolic Depletion Forecaster

Browser-based calculator for estimating useful incubation windows in droplet emulsions and small-volume culture formats.

## Use

Open `metabolic_depletion_forecaster.html` in a browser.

## Main controls

- Setup: cell line, medium, droplet volume, target occupancy, additives.
- Emulsion & Gas: Poisson λ, total emulsion volume, aqueous fraction, reservoir oil volume, oil type, vessel format, and exchange kinetics.
- Environment: gas phase, finite or replenished boundary, temperature, pH limits, and hypoxia threshold.
- Metabolism: growth, Warburg override, rate overrides, Pasteur effect, and output settings.
- Diagnostics: gas capacity, exchange half-times, timeline table, exports, and sensitivity sweep.

## Vessel formats

The vessel selector includes 1.5 mL microcentrifuge tube, 15 mL conical tube, 600 µm ID PTFE tubing, and custom geometry. Tube formats calculate closed headspace from vessel capacity minus entered liquid volume. PTFE tubing uses wall area and tubing capacity from the selected length.
