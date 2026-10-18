# Offline map runtime dependencies

These pinned browser distributions are local files. No CDN, glyph server, sprite
server or remote tile endpoint is used while displaying a saved region.

- `maplibre-gl-5.24.0.js`, `maplibre-gl-5.24.0.css`: MapLibre GL JS 5.24.0,
  from the official npm `maplibre-gl` package. BSD-3-Clause; see
  `maplibre-LICENSE.txt` (including bundled dependency notices).
- `pmtiles-4.5.0.js`: PMTiles JS 4.5.0, official npm `pmtiles` package.
  BSD-3-Clause; see `pmtiles-LICENSE.txt`. The bundled fflate decompressor is
  MIT-licensed; see `pmtiles-fflate-LICENSE.txt`.
- Style: app-owned simplified Protomaps v4 schema style, in
  `../offline-map-engine.js`. Local system fonts are used by omitting `glyphs`,
  supported by MapLibre GL JS since 5.11. No font or icon distribution is bundled.

Official references checked on 2026-10-18:

- <https://docs.protomaps.com/basemaps/downloads>
- <https://docs.protomaps.com/basemaps/layers>
- <https://source.coop/protomaps/openstreetmap>
- <https://maplibre.org/maplibre-style-spec/glyphs/>

The explicit **save region** operation reads a bounded subset from the published
Protomaps archive at
`https://data.source.coop/protomaps/openstreetmap/v4.pmtiles`. This is a download
archive, not OSM's public raster tile service. The downloaded data is an ODbL
Produced Work and requires OpenStreetMap attribution; the renderer and export
manifest retain it. Source data timestamp is read from PMTiles metadata, rather
than treating the download time as the map's freshness date. The mirror may lag
the daily builds. The archive's ETag is pinned during a download: a source change
aborts the operation without replacing an earlier ready pack.

The official daily-build host currently restricts browser CORS. We use the
published Source Cooperative mirror which exposes byte ranges and ETag to browser
clients. Deployment operators may use `download({sourceUrl})` with their own
compatible, licensed, CORS-enabled Protomaps v4 archive; this is not an arbitrary
URL input in the user interface. No live rendering is hotlinked to the mirror.

Vendored file SHA-256:

```text
45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb  maplibre-gl-5.24.0.js
ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732  maplibre-gl-5.24.0.css
caf981bc46f6327ee7e65d5dc964d89d38a69f60edca2bd4c5c890c21b554c6c  pmtiles-4.5.0.js
```
