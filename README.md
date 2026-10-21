# Metabolic Depletion Forecaster

A self-contained browser tool for estimating oxygen, nutrient, and pH limits in droplet emulsions and small-volume cultures.

## Use

Open `metabolic_depletion_forecaster.html` directly in a modern browser. It works from `file://` with no server, installation, or external runtime dependency.

The HTML file is the product and the only source of application behavior and embedded data. Edit it directly when changing the tool.

## Checks

```bash
npm ci
npx playwright install chromium
npm run verify
```

On Linux, use `npx playwright install --with-deps chromium` if browser system libraries are missing. If a browser blocks background workers, the tool falls back to its synchronous calculation path.

The checks are intentionally small:

- `npm test` parses the inline application script.
- `npm run test:browser` opens the standalone file in Chromium and checks that a forecast and timeline render without external requests or browser errors. It also checks recovery from blocked or failed background workers and obsolete saved dropdown selections. Unavailable saved choices reset to the visible defaults, with a notice in the result status.
