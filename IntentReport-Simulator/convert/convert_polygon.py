import json
import argparse
from pyproj import Transformer

def geojson_25833_to_geosparql_wkt(geojson_text: str, decimals: int = 4) -> str:
    gj = json.loads(geojson_text)

    # EPSG:25833 (ETRS89 / UTM zone 33N) -> EPSG:4326 (WGS84 lon/lat)
    transformer = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)

    feat = gj["features"][0]
    geom = feat["geometry"]
    gtype = geom["type"]
    coords = geom["coordinates"]

    def fmt_xy(x, y):
        lon, lat = transformer.transform(x, y)
        return f"{lon:.{decimals}f} {lat:.{decimals}f}"  # WKT is x y = lon lat

    def ring_to_wkt(ring):
        # ring = [[x,y], [x,y], ...]
        return "(" + ", ".join(fmt_xy(x, y) for x, y in ring) + ")"

    if gtype == "Polygon":
        # coords = [outer_ring, hole1, hole2, ...]
        rings = ", ".join(ring_to_wkt(r) for r in coords)
        wkt = f"POLYGON({rings})"

    elif gtype == "MultiPolygon":
        # coords = [ polygon1, polygon2, ... ]
        # polygon = [outer_ring, hole1, ...]
        polys = []
        for poly in coords:
            rings = ", ".join(ring_to_wkt(r) for r in poly)
            polys.append(f"({rings})")
        # If it's a single polygon and you *must* output POLYGON instead of MULTIPOLYGON:
        if len(polys) == 1:
            wkt = f"POLYGON{polys[0]}"
        else:
            wkt = f"MULTIPOLYGON({', '.join(polys)})"
    else:
        raise ValueError(f"Unsupported geometry type: {gtype}")

    return f'geo:asWKT "{wkt}"^^geo:wktLiteral ]'


def main():
    parser = argparse.ArgumentParser(description='Convert GeoJSON from EPSG:25833 to GeoSPARQL WKT format')
    parser.add_argument('file', type=str, help='Input filename containing GeoJSON to convert')
    parser.add_argument('--decimals', type=int, default=4, help='Number of decimal places for coordinates (default: 4)')
    parser.add_argument('-o', '--output', type=str, help='Output filename to write the result to (if not specified, prints to stdout)')
    
    args = parser.parse_args()
    
    try:
        with open(args.file, 'r', encoding='utf-8-sig') as f:
            geojson_text = f.read()
        
        result = geojson_25833_to_geosparql_wkt(geojson_text, decimals=args.decimals)
        
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(result)
            print(f"Output written to '{args.output}'")
        else:
            print(result)
    except FileNotFoundError:
        print(f"Error: File '{args.file}' not found.")
        return 1
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in file '{args.file}': {e}")
        return 1
    except Exception as e:
        print(f"Error: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
