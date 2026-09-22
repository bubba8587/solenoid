<!-- [[C19]] namingModel -->

# Spec: Addressable model

Serves [[C19]] namingModel. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Every node has a **stable, user-editable name**, separate from the rete-internal `id`
(which stays random/regenerated-on-load, per `rebuildGraph`'s `idMap` — names never
assume id stability). Default: a type-scoped counter (`Filter_2`), editable, validated
unique per document. (`label` is a SEPARATE per-instance display field — persisted, and edited directly by Note/Group/Image/SvgPicker/Presentation — but it is NOT the addressable name and nothing resolves references through it.)

The **text form** (one node per line, name-addressed rather than id-addressed) is a second view of the same document, alongside the canvas and the JSON save. Its grammar, line order, canonicalization, sidecar and round-trip rules are `save-format.md` § The text form; what matters here is that every reference in it, node lines and sidecar alike, is by name.
