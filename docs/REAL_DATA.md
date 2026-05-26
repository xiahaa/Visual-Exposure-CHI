# Real Data Scenario

## Hong Kong Mong Kok

The current real-data scenario is:

```text
hong_kong_mong_kok_01
```

It uses a compact Mong Kok / Yau Ma Tei bounding box to keep the CHI prototype responsive while still showing a dense Hong Kong urban fabric.

```text
south: 22.3128
west: 114.1668
north: 22.3236
east: 114.1748
```

## Source

The data is downloaded from OpenStreetMap through the Overpass API.

Downloaded features:

```text
building footprints
school / hospital / kindergarten / clinic polygons
playground / park / garden polygons
residential landuse polygons
```

## Height Handling

Building height is assigned in this order:

```text
1. OSM height or building:height, if available
2. OSM building:levels * 3.2 m, if available
3. Default height by building type
```

Defaults:

```text
residential / apartments / commercial / office / hotel: 45 m
other buildings: 18 m
```

The generated `height_source` property records which rule was used.

## Regeneration

Run:

```powershell
cd D:\CHI
D:\CHI\.venv\Scripts\python.exe D:\CHI\scripts\download_hong_kong_osm.py
```

Generated files:

```text
data/scenarios/hong_kong_mong_kok_01/scenario.json
data/scenarios/hong_kong_mong_kok_01/buildings.geojson
data/scenarios/hong_kong_mong_kok_01/semantic_layers.geojson
```

## Notes

This is still a 2.5D block model. It is suitable for studying how people understand estimated visual exposure, but it should not be presented as survey-grade visibility analysis.
