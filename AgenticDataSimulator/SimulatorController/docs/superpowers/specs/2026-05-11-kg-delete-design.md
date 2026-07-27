# KG Delete Design

## Goal

Add a trash-can delete action to each knowledge graph target shown in the workspace so a user can remove a previously created KG. Deletion must remove the associated GraphDB repository first and only remove the local app record after the GraphDB delete succeeds.

## UI Design

Each KG card in `KgTargetPanel` gets a trash-can button aligned with the card content. Clicking the button opens a confirmation prompt. If the user confirms, only that row enters a deleting state, the button is disabled, and the row stays visible until the delete request succeeds.

If deletion succeeds, the row is removed from the visible list immediately. If deletion fails, the row remains and the panel shows an error message.

## API Design

Add a delete endpoint for a single KG target keyed by the local target id. The route loads the target for the authenticated user, deletes the GraphDB repository using the stored `repositoryId`, and then deletes the corresponding `KnowledgeGraphTarget` row from the app database.

The route must not delete the local row if the GraphDB repository delete fails. This keeps the app state aligned with GraphDB and avoids hiding partially failed resources.

## GraphDB Behavior

The delete flow uses the GraphDB REST repository delete endpoint against the stored repository id. The named graph does not need a separate delete call because deleting the repository removes the repository contents with it.

The GraphDB client must throw on non-2xx responses so the route can stop before touching the local database.

## Error Handling

Unauthorized requests return `401`. Unknown KG target ids return `404`. Upstream GraphDB delete failures surface as route failures and keep the local record intact. The client UI converts route failure into a human-readable error message without removing the row.

## Testing

Add a route test proving a successful delete removes the GraphDB repository first and then deletes the local row. Add a route test proving a GraphDB delete failure does not remove the local row. Add a source-level UI test proving the KG panel includes a delete control and uses a delete URL with confirmation behavior.
