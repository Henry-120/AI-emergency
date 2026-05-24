import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, LngLatBoundsLike, Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { Shelter } from "../../services/offlineSafetyService";
import { OfflineShelterMap } from "./OfflineShelterMap";

const PMTILES_URL = "/maps/taiwan.pmtiles";
let protocolRegistered = false;

type MapPoint = { lat: number; lon: number };

function registerPmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

function buildBounds(points: MapPoint[]): LngLatBoundsLike | null {
  if (points.length === 0) return null;

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLon = points[0].lon;
  let maxLon = points[0].lon;

  points.forEach((point) => {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  });

  const latPad = Math.max((maxLat - minLat) * 0.2, 0.01);
  const lonPad = Math.max((maxLon - minLon) * 0.2, 0.01);

  return [
    [minLon - lonPad, minLat - latPad],
    [maxLon + lonPad, maxLat + latPad],
  ];
}

function getStreetStyle(pmtilesUrl: string): maplibregl.StyleSpecification {
  const pmtilesSource = {
    type: "vector" as const,
    url: `pmtiles://${new URL(pmtilesUrl, window.location.href).toString()}`,
    attribution: "Map data from bundled PMTiles",
  };

  return {
    version: 8,
    sources: {
      protomaps: pmtilesSource,
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f7f6f2" } },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": "#f7f6f2" },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": "#e9f3df", "fill-opacity": 0.72 },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": "#b8dff4" },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        minzoom: 14,
        paint: { "fill-color": "#dedbd2", "fill-opacity": 0.75 },
      },
      {
        id: "roads-minor-casing",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: { "line-color": "#d4d0c7", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 16, 5] },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 16, 3.4] },
      },
      {
        id: "roads-major-casing",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        paint: { "line-color": "#d5b86f", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 16, 8] },
      },
      {
        id: "roads-major",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        paint: { "line-color": "#f7d87a", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 16, 5.8] },
      },
    ],
  };
}

function getSheltersGeoJson(shelters: Shelter[]) {
  return {
    type: "FeatureCollection" as const,
    features: shelters.slice(0, 80).map((shelter, index) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [shelter.lon, shelter.lat],
      },
      properties: {
        id: shelter.id,
        name: shelter.name,
        nearest: index === 0,
        distance: shelter.distance_km ?? null,
      },
    })),
  };
}

function getRouteGeoJson(
  location: { lat: number; lng: number } | null,
  nearest: Shelter | undefined,
) {
  return {
    type: "FeatureCollection" as const,
    features:
      location && nearest
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: [
                  [location.lng, location.lat],
                  [nearest.lon, nearest.lat],
                ],
              },
              properties: {},
            },
          ]
        : [],
  };
}

export function MapLibreShelterMap({
  shelters,
  location,
}: {
  shelters: Shelter[];
  location: { lat: number; lng: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const [canUsePmtiles, setCanUsePmtiles] = useState(false);
  const [checkedAsset, setCheckedAsset] = useState(false);
  const nearest = shelters[0];

  const points = useMemo(
    () => [
      ...shelters.slice(0, 20).map((shelter) => ({ lat: shelter.lat, lon: shelter.lon })),
      ...(location ? [{ lat: location.lat, lon: location.lng }] : []),
    ],
    [location, shelters],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(PMTILES_URL, { method: "HEAD" })
      .then((response) => {
        if (!cancelled) setCanUsePmtiles(response.ok);
      })
      .catch(() => {
        if (!cancelled) setCanUsePmtiles(false);
      })
      .finally(() => {
        if (!cancelled) setCheckedAsset(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checkedAsset || !canUsePmtiles || !containerRef.current) return;

    registerPmtilesProtocol();

    const center = location
      ? ([location.lng, location.lat] as [number, number])
      : nearest
        ? ([nearest.lon, nearest.lat] as [number, number])
        : ([121, 23.7] as [number, number]);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getStreetStyle(PMTILES_URL),
      center,
      zoom: location || nearest ? 13 : 7,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("shelters", {
        type: "geojson",
        data: getSheltersGeoJson(shelters),
      });
      map.addSource("route", {
        type: "geojson",
        data: getRouteGeoJson(location, nearest),
      });
      map.addSource("user-location", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: location
            ? [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [location.lng, location.lat] },
                  properties: {},
                },
              ]
            : [],
        },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 4,
          "line-dasharray": [1.3, 1.2],
        },
      });
      map.addLayer({
        id: "shelter-points",
        type: "circle",
        source: "shelters",
        paint: {
          "circle-radius": ["case", ["get", "nearest"], 8, 5],
          "circle-color": ["case", ["get", "nearest"], "#facc15", "#0284c7"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "user-point",
        type: "circle",
        source: "user-location",
        paint: {
          "circle-radius": 8,
          "circle-color": "#22c55e",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      const bounds = buildBounds(points);
      if (bounds) {
        map.fitBounds(bounds, { padding: 42, maxZoom: 15, duration: 0 });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [canUsePmtiles, checkedAsset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    (map.getSource("shelters") as GeoJSONSource | undefined)?.setData(
      getSheltersGeoJson(shelters),
    );
    (map.getSource("route") as GeoJSONSource | undefined)?.setData(
      getRouteGeoJson(location, nearest),
    );
  }, [location, nearest, shelters]);

  if (!checkedAsset || !canUsePmtiles) {
    return <OfflineShelterMap shelters={shelters} location={location} />;
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-amber-300">
            離線街道地圖
          </div>
          <div className="text-sm text-slate-400">
            MapLibre + PMTiles 本機街道底圖
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>{Math.min(shelters.length, 80)} 點</div>
          <div>PMTiles</div>
        </div>
      </div>
      <div ref={containerRef} className="h-[58vh] min-h-[360px] w-full" />
    </section>
  );
}
