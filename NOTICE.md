# Third-party components

MiniCAD uses the DSH host's React runtime, UI primitives, locale and theme services. It does not embed a copied DSH UI library.

Runtime and build dependencies retain their own licenses, distributed with their packages:

- DeepSeek Harness and schemastery: MIT.
- Three.js and React: MIT.
- esbuild: MIT.
- build123d: Apache-2.0.
- Open CASCADE Technology and its Python bindings: consult the installed OCCT / cadquery-ocp package notices (OCCT uses LGPL-2.1 with an additional exception).
- pypdf: BSD-3-Clause.
- pypdfium2 / PDFium: see their bundled licenses and third-party notices.
- ReportLab: BSD license.

Python dependencies are installed through uv and are not vendored into the plugin tarball. Review the complete dependency notices before redistributing a bundled Python environment.
