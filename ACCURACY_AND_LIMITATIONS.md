# Accuracy, Confidence, and Limitations

The Metabolic Depletion Forecaster estimates how long cells may remain in a droplet or emulsion culture before a limiting condition is reached. It combines a physical model of droplet volume, oil oxygen storage, headspace exchange, and vessel geometry with a cell-line metabolic-rate database.

The result should be read as a **planning estimate**, not as a guaranteed incubation limit. Real cultures vary with passage number, medium, serum, oxygen tension, pH, cell density, adaptation state, and the actual gas-exchange geometry of the device.

Audited release:
`v18-transport-20260715`

## What is corrected in this release

- Closed-headspace O₂ and tracked CO₂ are updated in conserved amounts rather than concentration clamps.
- Finite exchange half-times now mean what the UI says: for two finite compartments, the concentration difference halves over the entered half-time, and the coupled exchange solve is simultaneous and conservative.
- Initial aqueous, oil, reservoir, and closed-headspace oxygen states are independent of the selected boundary gas.
- Bulk proliferation uses Poisson occupancy classes, so empty droplets do not contribute carrying capacity.
- Droplet exchange scales with droplet size through an area-to-volume relation.
- Respiratory O₂ uptake is limited by local O₂ using a Michaelis-Menten term and cannot exceed available oxygen.
- Endpoint times are interpolated within solver substeps instead of being reported only on 0.5 min boundaries.
- Accepted partial steps now update cumulative O₂/CO₂ counters only for the accepted fraction of the step.
- Closed zero-headspace configurations disable headspace gas exchange rather than transferring mass into a zero-volume gas compartment.
- Tracked aqueous + headspace CO₂ residuals are only meaningful in finite closed-headspace CO₂ mass-balance mode. External CO₂ reservoir modes are not treated as closed carbon balances, and oil-phase CO₂ is still outside the tracked inventory.
- Exchange half-times can be entered either as reference values to be geometry-scaled or as measured-effective values for the exact current configuration.
- Bulk O₂ keeps fluorinated oil as the dominant shared reversible reservoir. The app compares sampled oil-mediated equilibration against local occupied-droplet depletion, keeps the shared mean-field model by default, and exposes a conservative grouped empty/single/multi comparison when local depletion is transport-limited.
- Rate inputs can be interpreted either as 37 °C reference rates with Q10 scaling or as already measured at the selected temperature with no Q10 scaling.
- Deterministic low-demand, nominal, and high-demand scenario runs are available when stored metabolic-rate bounds exist for the selected line. These are bound sweeps, not probabilistic intervals.

## Remaining important limitations

- The pH layer is still heuristic. It uses bicarbonate, dissolved CO₂, lactate, and a buffer-capacity approximation, not a full DIC and alkalinity solver.
- Bulk nutrients are not resolved by occupancy class. Bulk O₂ can be shared or grouped depending on the selected or inferred transport regime, but nutrient depletion remains mean-field.
- Growth remains a logistic approximation and is not fully coupled to all environmental stressors.

## What the tool predicts

The tool estimates the earliest limiting endpoint among:

- oxygen depletion or hypoxia threshold
- glucose depletion
- glutamine depletion
- pH falling below the configured viability floor
- pH rising above the configured ceiling
- simulation horizon limits

The displayed useful window is the earliest endpoint under the selected assumptions. It is most useful for comparing experimental designs, such as droplet size, cell loading, oil volume, vessel format, headspace, and medium composition.

## Confidence tiers

Each cell line has a confidence tier. The tier reflects how directly the embedded rates are supported by public measurements.

| Tier | Meaning | Recommended use |
|---|---|---|
| **Tier A** | Exact or close measured rates are available for the selected cell line or a very close context. | Use roughly **50–70%** of the predicted useful window unless local exchange conditions have been calibrated. |
| **Tier B** | Rates are based on same-family, partial, or condition-adjacent measurements. | Use roughly **50–70%** of the predicted useful window and compare low/nominal/high-rate scenarios. |
| **Tier C** | Exact line-specific rates were not found; the row uses empirical measured-corpus medians or lineage fallback rates. | Use roughly **25–50%** of the predicted useful window unless calibrated with local data. |
| **Custom** | User-entered rates are used. | Confidence depends on how well the entered rates match the exact medium, oxygen, pH, and culture format. |

The tier warning at the top of the app is intended to keep the predicted useful window from being interpreted as a hard maximum.

## Empirical benchmark summary

The cell-line rate database was compared against public metabolic-rate measurements. Rates were normalized to **fmol/cell/min** for oxygen consumption, glucose consumption, lactate production, and glutamine consumption.

| Benchmark statistic | Result |
|---|---:|
| Total normalized comparisons | 63 |
| Direct same-line or same-family comparisons | 54 |
| Median symmetric fold error, all comparisons | **1.39×** |
| Median symmetric fold error, direct comparisons | **1.30×** |
| Comparisons within 2× | **71.4%** |
| Comparisons within 3× | **90.5%** |
| Severe comparisons above 10× | 2 |

A symmetric fold error of 2× means the embedded value is either twice as high or half as high as the empirical value. Lower is better.

### Error by metabolic factor

| Factor | Median fold error | Main caution |
|---|---:|---|
| Oxygen consumption | 1.25× | Platform and geometry can produce different OCR estimates. |
| Lactate production | 1.35× | Lactate and pH can shift strongly in suspension, hypoxia, and low serum. |
| Glutamine consumption | 1.48× | Glutamine behavior is condition-dependent and is one of the less stable rates. |
| Glucose consumption | 1.79× | Can vary widely by medium, pH, oxygen, serum, and lineage. |

## Where the model is strongest

The model is strongest when:

- the selected cell line is Tier A or Tier B
- the medium, pH, oxygen, and serum conditions are close to the cited conditions
- the experiment is used for relative design comparison rather than a hard go/no-go limit
- gas exchange is intentionally specified, such as vessel type, headspace, oil volume, and exchange half-times
- the user has measured or estimated OCR/GCR/LPR/GlnCR for the exact system and enters them as custom rates

The strongest matches in the benchmark set include Jurkat nutrient rates and several neutral, normoxic A549 and MCF-7 nutrient-rate conditions.

## Where the model can be wrong

The largest deviations occur when metabolism changes with the environment. A single nominal rate per cell line cannot fully represent every condition.

Important risk areas:

- **Hypoxia:** low oxygen can alter glucose uptake, lactate production, and glutamine use.
- **Acidosis:** lower pH can suppress or redirect metabolic fluxes.
- **Serum and growth-factor changes:** low serum and serum-free adaptation can change glucose and lactate behavior.
- **Suspension vs adherent culture:** the same line can show different rates after suspension adaptation.
- **Tier C fallback lines:** fallback medians prevent missing data, but they are not line-specific validation.
- **Gas-exchange geometry:** a static deep emulsion can behave very differently from a mixed oil reservoir, gas-permeable tubing, or an incubator-exposed thin layer.
- **pH forecasts:** pH depends on lactate, CO₂, bicarbonate, buffer capacity, headspace, and gas exchange. These are approximated, not directly measured.

## Examples from public-rate comparisons

These examples show how embedded rates compare with public measurements. They are not exhaustive; they illustrate the main failure modes.

### A549

Neutral, normoxic A549 glucose and lactate rates are well matched in the benchmark set. However, acidic or hypoxic conditions can diverge substantially. In one public A549 condition at pH 6.2 and 2% oxygen, the app's glucose rate was about **6.4× higher** than the measured rate. In another hypoxic condition, the app's glutamine rate was about **10× higher** than the measured rate.

### MCF-7

MCF-7 glucose, lactate, and glutamine rates match neutral, normoxic conditions reasonably well. Under low pH or hypoxia, empirical rates shift, so a static nominal rate can misestimate the limiting factor.

### HEK293

HEK293 glucose rates are close to several adherent or lower-flux reports. Lactate production can be underpredicted for suspension-adapted serum-free culture, which can make pH forecasts too optimistic.

### Jurkat

Jurkat glucose and lactate rates match the cited continuous-flow values closely. Activation state, drugs, and immune stimulation can still change metabolism enough to justify custom overrides for quantitative work.

### SH-SY5Y

SH-SY5Y is less stable. In the benchmark set, glucose consumption was overpredicted while lactate production was underpredicted. This combination can misclassify whether glucose or pH is the limiting factor.

### hMSC / hASC-like stromal cells

Stromal and mesenchymal cell metabolism is highly medium- and protocol-dependent. Family comparisons showed large glucose-rate deviations, so these lines should be treated cautiously unless local rates are measured.

## Practical use recommendations

For experimental planning:

1. Start with the nominal forecast.
2. Apply the confidence-tier margin shown by the app.
3. Run sensitivity checks by changing cell rate overrides, droplet volume, λ, oil volume, headspace, and gas-exchange half-times.
4. Treat pH-limited and glutamine-limited results with extra caution.
5. For long incubations, run a pilot and measure at least glucose, lactate, pH, and viability at several time points.
6. Use local measurements to enter custom OCR/GCR/LPR/GlnCR whenever possible.

For conservative operation, avoid using the full predicted useful window unless the cell line, medium, and droplet/oil gas-exchange conditions have been calibrated locally.

## How to calibrate the model locally

A practical calibration experiment can be simple:

1. Culture a known number of cells in the same medium and environmental condition.
2. Measure glucose, lactate, glutamine, pH, and viability over time.
3. Convert concentration changes into per-cell rates.
4. Enter those measured rates in the app using the custom cell-line mode or rate overrides.
5. Compare predicted endpoints with a second validation run.

Approximate conversion:

```text
rate_fmol_per_cell_min = ΔmM × volume_mL × 1e9 / (cells × minutes)
```

For bulk-culture estimates:

```text
ΔmM per day = rate_fmol_per_cell_min × cells_per_mL × 1440 × 1e-9
```

## Interpretation of safe-window output

The predicted useful window is a model endpoint under the selected assumptions. It is not a certificate that cells remain healthy until that exact time.

A conservative interpretation is:

- **Tier A/B:** plan around 50–70% of the predicted useful window unless calibrated.
- **Tier C:** plan around 25–50% of the predicted useful window unless calibrated.
- **Custom measured rates:** confidence improves if the rates were measured in the same medium, oxygen, pH, density, and culture format.

## Data sources used for comparison

The benchmark set included public measurements and rate tables for oxygen consumption, glucose consumption, lactate production, and glutamine consumption. Sources included:

- Carlos-Reyes et al., 2024, *Metabolites*: A549 and MCF-7 glucose, lactate, and glutamine rates under pH and oxygen variation.
- Molter et al., 2008, with Ahmad and Gardner comparator data: A549 oxygen-consumption measurements.
- Etzkorn et al., 2010: A549 patterned oxygen-sensor OCR data.
- Hai et al., 2019: high-throughput single-cell photoacoustic A549 OCR data.
- Peniche Silva et al., 2020: A549 oxygen-gradient OCR context.
- Jang et al., 2022: HEK293 serum-free adherent and suspension glucose/lactate metabolism.
- Kronenberger et al., 2024, *Metabolites*: SH-SY5Y and Neuro2A glucose, glutamine, and lactate rates under serum variation.
- Patra et al., 2021: microfluidic NMR MCF-7 glucose, lactate, and pH kinetics.
- Gardner et al., 2022: physiological-media glucose-consumption comparisons across cancer cell lines.
- MSC and hASC metabolic studies used as family-level stromal comparators.

## Bottom line

The app is suitable as a calibrated planning and sensitivity-analysis tool. It is strongest when used with measured or Tier A/B rates and clear gas-exchange assumptions. It should not be treated as a universal biological predictor without local calibration.
