"""
Stand-in map server for the end-to-end tests: a tiny MapLibre style, TileJSON, one vector
tile (two roads + a lake, served for every z/x/y), empty font files and a raster fallback.
Lets the tests exercise the real vector-map + offline-download code with no internet.
"""
import base64, json

# Two diagonal roads and a small lake, encoded once with mapbox-vector-tile (extent 4096).
VECTOR_TILE = base64.b64decode("GikKBXJvYWRzEg0YAiIJCQCAQAqAQP8/EgwYAiIICQAACoBAgEAogCB4AhoiCgV3YXRlchIUGAMiEAnYBKg7GgCHDogOAACIDg8ogCB4Ag==")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


def style(base):
    return {
        "version": 8,
        "name": "NavNet test map",
        "glyphs": f"{base}/fonts/{{fontstack}}/{{range}}.pbf",
        "sources": {"omt": {"type": "vector", "url": f"{base}/tilejson"}},
        "layers": [
            {"id": "bg", "type": "background", "paint": {"background-color": "#eef0e8"}},
            {"id": "water", "type": "fill", "source": "omt", "source-layer": "water", "paint": {"fill-color": "#9cc3e0"}},
            {"id": "roads", "type": "line", "source": "omt", "source-layer": "roads", "paint": {"line-color": "#c9b26b", "line-width": 3}},
            {"id": "label", "type": "symbol", "source": "omt", "source-layer": "water",
             "layout": {"text-field": "lake", "text-font": ["Noto Sans Regular"], "text-size": 11}},
        ],
    }


def handle(path, base):
    """Return (body, content_type) for map requests, or None if `path` isn't one."""
    p = path.split("?")[0]
    if p == "/style.json":
        return json.dumps(style(base)).encode(), "application/json"
    if p == "/tilejson":
        return json.dumps({"tilejson": "3.0.0", "tiles": [f"{base}/vt/v1/{{z}}/{{x}}/{{y}}.pbf"], "minzoom": 0, "maxzoom": 14}).encode(), "application/json"
    if p.startswith("/vt/"):
        return VECTOR_TILE, "application/x-protobuf"
    if p.startswith("/fonts/"):
        return b"", "application/x-protobuf"
    if p.endswith(".png"):
        return PNG, "image/png"
    return None
