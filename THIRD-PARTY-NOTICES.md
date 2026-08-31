# Third-party notices

Solenoid includes the following third-party material.

## React Flow

The node canvas is built on [React Flow](https://reactflow.dev) by
[xyflow](https://xyflow.com) (webkid GmbH). The in-canvas "React Flow"
attribution link is deliberately left enabled in both render surfaces
(`hideAttribution: false`), per the React Flow project's attribution request.
React Flow is distributed under the MIT License:

```
MIT License

Copyright (c) 2019-2025 webkid GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled libraries

The web bundle ships the complete generated license inventory for every
bundled npm package at `third-party-licenses.txt` (produced by
`rollup-plugin-license`, see `vite.config.ts`). Highlights: the headless graph
model and dataflow engine are [Rete.js](https://retejs.org) (`rete`,
`rete-engine`, MIT); Excel function semantics come from
[Formula.js](https://formulajs.info) (MIT); charts are
[Recharts](https://recharts.org) (MIT); the desktop shell is
[Tauri](https://tauri.app) (MIT/Apache-2.0) and the native relational engine is
[Polars](https://pola.rs) (MIT).

Not everything is MIT: `elkjs` (auto-arrange layout) is EPL-2.0 OR
GPL-3.0-or-later, `dompurify` (markdown sanitizing) is MPL-2.0 OR Apache-2.0,
and the Atkinson Hyperlegible fonts are under the SIL Open Font License 1.1,
which travels with the font files in the bundle.

## Lucide

Several UI icons are drawn from [Lucide](https://lucide.dev) (inline SVG paths).
Lucide is distributed under the ISC License:

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```
