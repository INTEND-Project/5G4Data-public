# Workspace Header Design

## Goal

Replace the current OpenClaw workspace top header with a design-matched header based on the original mockup. The new header should update both the left brand block and the right action area, while only wiring live behavior for the agent registry status chip at this stage.

## Left Brand Block

The left side of the header should match the design structure:

- INTEND logo/icon
- primary title: `INTEND Data Generation Controller Studio`
- secondary subtitle: `TM Forum intent data generation script design and execution for cognitive continuum`

This replaces the current `INTEND Controller` eyebrow and `OpenClaw Workspace` title. The layout should visually resemble the design’s `brand` block with the icon sitting to the left of the title stack.

## Right Action Area

The right side of the header should switch from the current stage chips to the design-inspired action area. For now it contains:

- a live registry-status chip
- a static `runId: demo-run-2026-05-06` chip
- a visual `About/Help` button

Only the registry-status chip is wired at this stage. The run id chip and button are present for design fidelity only and do not need new behavior yet.

## Registry Status Behavior

The registry-status chip reflects whether the A2A registry is reachable at [`https://start5g-1.cs.uit.no/a2a-registry/`](https://start5g-1.cs.uit.no/a2a-registry/).

The chip states are:

- `agent registry connected` when the registry base URL is reachable
- `agent registry disconnected` when the registry base URL is not reachable

The disconnected state should use a red/danger visual treatment so it is easy to distinguish from the connected state.

## Data Flow

Registry connectivity should be determined on the server during workspace page rendering. The workspace page passes a simple boolean or equivalent top-bar status value into `WorkspaceShell`, and `WorkspaceShell` renders the top-right status chip from that value.

This keeps the initial implementation simple and avoids adding a separate polling mechanism or client-side health check in this change.

## Styling

The top bar should visually move closer to the original design:

- left-aligned icon plus stacked title/subtitle
- right-aligned action row
- compact chips matching the design direction
- a distinct status chip style for connected vs disconnected

The existing stage chips are removed from the top bar as part of this redesign. They should not be reintroduced elsewhere unless intentionally planned in a future design step.

## Error Handling

If the registry status check fails for any reason, the UI should render the disconnected state instead of throwing or blocking the workspace render.

The header must remain renderable even when the registry is unavailable.

## Testing

Add a source-level test proving:

- the old `INTEND Controller` and `OpenClaw Workspace` text is gone
- the new title and subtitle are present
- the INTEND logo reference is present
- the right-side header includes the registry status chip text and the placeholder `runId` chip
- the style hooks for the new brand and action layout exist if new CSS classes are introduced

Add a focused server-side test or route-adjacent test for the registry connectivity helper if a new helper function is introduced to determine availability.
