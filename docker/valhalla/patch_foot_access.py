"""Rewrites an OSM PBF extract so pedestrians get access wherever cyclists do.

Valhalla's pedestrian costing treats `highway=cycleway` (and any other way with
explicit cyclist access) as bike-only unless the way carries an explicit `foot`
tag. In practice, a lot of shared-use paths and cycleway bridge decks are
undertagged this way in OSM, which causes Valhalla to reject them for
pedestrian routing entirely and detour to the nearest way that *is* tagged for
foot traffic (sometimes tens of kilometers away). Ground truth: if it's
bikeable, it's walkable too, so we add `foot=yes` wherever bicycle access is
allowed and no explicit `foot` tag already overrides it.
"""

import sys

import osmium

BICYCLE_DENIED = {"no", "private", "dismount"}
BICYCLE_ALLOWED = {"yes", "designated", "permissive", "use_sidepath"}

# High-speed, car-dominant road classes: a shoulder that permits cyclists
# (bicycle=yes) is not evidence of a walkable shoulder — it's exactly the
# class of road that lacks sidewalks by design. Don't let bicycle access
# imply foot access here; only an explicit `foot` tag should grant it.
CAR_DOMINANT_HIGHWAYS = {"motorway", "motorway_link", "trunk", "trunk_link"}


def bicycle_access_allowed(tags: osmium.osm.TagList) -> bool:
    bicycle = tags.get("bicycle")
    if bicycle in BICYCLE_DENIED:
        return False
    if bicycle in BICYCLE_ALLOWED:
        return True
    return tags.get("highway") == "cycleway"


def foot_access_implied_by_bicycle(tags: osmium.osm.TagList) -> bool:
    if tags.get("highway") in CAR_DOMINANT_HIGHWAYS:
        return False
    return bicycle_access_allowed(tags)


class FootAccessPatcher(osmium.SimpleHandler):
    def __init__(self, writer: osmium.SimpleWriter):
        super().__init__()
        self.writer = writer
        self.ways_patched = 0

    def node(self, n: osmium.osm.Node) -> None:
        self.writer.add_node(n)

    def way(self, w: osmium.osm.Way) -> None:
        if "foot" not in w.tags and foot_access_implied_by_bicycle(w.tags):
            tags = dict(w.tags)
            tags["foot"] = "yes"
            self.writer.add_way(w.replace(tags=tags))
            self.ways_patched += 1
        else:
            self.writer.add_way(w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self.writer.add_relation(r)


def main() -> None:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <input.osm.pbf> <output.osm.pbf>", file=sys.stderr)
        raise SystemExit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]
    writer = osmium.SimpleWriter(output_path)
    handler = FootAccessPatcher(writer)
    try:
        handler.apply_file(input_path)
    finally:
        writer.close()

    print(f"Patched {handler.ways_patched} ways with foot=yes.")


if __name__ == "__main__":
    main()
