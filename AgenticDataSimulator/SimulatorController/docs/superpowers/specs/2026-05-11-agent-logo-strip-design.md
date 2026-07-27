# Agent Logo Grid Design

## Goal

Add the partner logos from the design mockup directly below the `Available agents` list and its `Refresh` button in the left sidebar of the Simulator workspace, matching the provided `2 x 2` tiled appearance.

## Placement

The logo grid belongs inside the `AgentList` section, after the refresh controls and any refresh error text. It should visually read as a footer to the agent area, not as part of the agent list itself.

## Visual Behavior

The grid is decorative only. The logos are not clickable and do not introduce any new actions. They should follow the partner order used in the design mockup:

1. `Sintef`
2. `Telenor`
3. `Ericsson`
4. `TUW`

## Asset Strategy

The design mockup references the logos through image URLs. For this change, use the same logo sources reflected by the design rather than inventing new branding assets or changing the partner set. Each image still needs meaningful `alt` text even though the strip is decorative.

## Styling

Render the logos as an exact `2 x 2` grid of compact white tiles with small gaps between them, matching the screenshot reference. Each tile should have:

- a white background
- subtle rounding
- centered logo alignment
- enough padding so the logos do not touch the tile edges

The logos should be normalized within the tiles so the four cells feel visually balanced even if the original asset proportions differ. The overall grid should still sit quietly beneath the agent controls rather than drawing more attention than the list itself.

## Testing

Add a source-level test that proves `AgentList` renders the partner grid and includes the four expected partner names or logo references. Add CSS expectations for the new grid and tile classes, including the fixed two-column layout and white tile styling hooks.
