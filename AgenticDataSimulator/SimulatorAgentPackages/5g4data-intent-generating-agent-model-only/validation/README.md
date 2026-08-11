# ModelOnly SHACL shapes

- `skill_subset_intent_shapes.ttl` — 5g4data intent subset (same family as stock generating agent).
- `tio_shapes_bundle.ttl` — concatenated TIO shapes from `tio-shacl/rdf/lib` + `tio-shacl/rdf/shapes`.

Regenerate the TIO bundle:

```bash
npx tsx scripts/bundle-tio-shacl-shapes.mts
```
