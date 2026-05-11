# Controller GUI Figma Import Starter

This package is a static UI starter for import into Figma (for example via an HTML-to-Figma plugin), based on the INTEND visual direction and your requested workflow.

## Files

- `index.html`: main multi-pane UI mockup
- `styles.css`: design tokens and layout styles

## Included UX concepts

- Domain selector (currently `5g4data` only).
- Left script explorer panel with multiple script entries.
- Center script editor area (Cursor-like layout cues).
- Right assistant/agent pane for script authoring help.
- Run controls with mode selection (`dry-run`, `execute`).
- GraphDB section to create/select a knowledge graph for run output storage.

## Suggested import flow

1. Open your preferred HTML-to-Figma plugin.
2. Import `index.html` and `styles.css` from this folder.
3. Convert repeated blocks into Figma components:
   - script list item
   - toolbar button
   - status chip
   - run mode selector
   - assistant message bubble

## Notes

- This is intentionally static and design-oriented (not a functional web app).
- Asset references use files from `../intendproject-assets-curated/`.
