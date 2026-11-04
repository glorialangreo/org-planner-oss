# Dependency review

The project's own code is covered by the [MIT license](LICENSE). This document records dependency metadata for review and does not replace the full notices distributed with dependencies. Dependencies retain their respective licenses.

## Direct runtime dependencies

| Dependency | Declared package license |
|---|---|
| React, React DOM, React Flow (`@xyflow/react`) | MIT |
| Express, express-rate-limit, Helmet, Zod, ipaddr.js | MIT |
| Lucide React | ISC |
| Playwright | Apache-2.0 |
| Sharp | Apache-2.0 |

Development packages use MIT or Apache-2.0 according to the lockfile metadata.

## Transitive and bundled components

The lockfile also includes ISC, BSD-3-Clause, 0BSD and CC-BY-4.0 declarations. Sharp's native image-processing dependencies include LGPL-3.0-or-later components and combined Apache/MIT/LGPL declarations. Review the full notices and redistribution requirements for each platform's native binaries.

Playwright installs browser binaries separately. Chromium and its components have their own notices and redistribution requirements. A source-only release that installs dependencies on the user's computer differs from bundling native libraries or a browser.

Preserve required dependency copyright and license notices when distributing bundles, offline export code, native binaries or installers. Obtain legal review of the intended distribution before publication. Package metadata is a starting point, not a legal determination.

## Advisory review

Sharp was updated to the patched 0.35.5 series during implementation. Run `npm audit` again before each release because advisories and dependency versions change. A clean audit does not establish that the application is free of vulnerabilities.
