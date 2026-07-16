# Canonical product invariant

`metabolic_depletion_forecaster.html` is the product, the canonical source implementation, and the release artifact.

The HTML is authoritative. Production corrections must be implemented directly in that file first. No template, source module, build script, test helper, generator, agent, or packaging command may generate, overwrite, reconstruct, or replace it.

Supporting files may only inspect, parse, extract, test, benchmark, document, hash, copy, or verify the canonical HTML. If temporary modular extraction is useful, its direction is always:

`metabolic_depletion_forecaster.html` → ignored temporary derived files

Never:

template/modules → `metabolic_depletion_forecaster.html`

The application must continue to work by opening the single canonical HTML file through `file://`, without a web server, installation, CDN, external script, external stylesheet, remote data, or external runtime dependency.

The primary agent is the only agent allowed to edit production files. Subagents may perform independent read-only audits only. Preserve existing work and never use destructive Git restore, reset, or clean operations.
