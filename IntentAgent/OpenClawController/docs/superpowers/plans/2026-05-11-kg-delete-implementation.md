# KG Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trash-can delete action for each KG target that deletes the associated GraphDB repository first and deletes the local `KnowledgeGraphTarget` row only after GraphDB deletion succeeds.

**Architecture:** Extend the GraphDB client with a repository delete helper, add an authenticated dynamic API route for deleting a single KG target by local id, and wire the `KgTargetPanel` list items to call that route after a confirmation prompt. Keep failure handling strict: if GraphDB deletion fails, the local row stays intact and the UI shows an error instead of removing the card.

**Tech Stack:** Next.js App Router, React client components, Prisma + SQLite, GraphDB REST API, Vitest

---

### Task 1: Add GraphDB Repository Deletion Backend

**Files:**
- Modify: `src/lib/graphdb/client.ts`
- Create: `src/app/api/kg-targets/[id]/route.ts`
- Modify: `tests/graphdb/client.test.ts`
- Modify: `tests/graphdb/routes.test.ts`

- [ ] **Step 1: Write the failing GraphDB client delete test**

```ts
it("deletes repositories through the GraphDB REST API", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

  vi.stubGlobal("fetch", fetchMock);

  const graphDbClientModule = await import("../../src/lib/graphdb/client");

  await graphDbClientModule.deleteRepository({
    repositoryId: "telenor-5g4data-kg-avalanche-demo",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "http://graphdb.example/rest/repositories/telenor-5g4data-kg-avalanche-demo",
    expect.objectContaining({
      method: "DELETE",
    }),
  );
});
```

- [ ] **Step 2: Run the client test to verify it fails**

Run: `npm test -- tests/graphdb/client.test.ts`

Expected: FAIL because `deleteRepository` does not exist yet.

- [ ] **Step 3: Write the failing route tests for successful delete and GraphDB-first safety**

```ts
it("deletes the GraphDB repository before removing the local KG target", async () => {
  dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
    id: "kg-target-1",
    userId: "user-1",
    domain: "telenor.5g4data",
    repositoryId: "telenor-5g4data-kg-avalanche-demo",
    graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    displayName: "KG Avalanche Demo",
  });
  graphDbClientMock.deleteRepository.mockResolvedValue(undefined);
  dbMock.knowledgeGraphTarget.delete.mockResolvedValue({
    id: "kg-target-1",
  });

  const routeModule = await import("../../src/app/api/kg-targets/[id]/route");
  const response = await routeModule.DELETE(
    new Request("http://localhost/api/kg-targets/kg-target-1", { method: "DELETE" }),
    { params: Promise.resolve({ id: "kg-target-1" }) },
  );

  expect(graphDbClientMock.deleteRepository).toHaveBeenCalledWith({
    repositoryId: "telenor-5g4data-kg-avalanche-demo",
  });
  expect(dbMock.knowledgeGraphTarget.delete).toHaveBeenCalledWith({
    where: { id: "kg-target-1" },
  });
  expect(response.status).toBe(200);
});

it("does not delete the local KG target when GraphDB delete fails", async () => {
  dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
    id: "kg-target-1",
    userId: "user-1",
    domain: "telenor.5g4data",
    repositoryId: "telenor-5g4data-kg-avalanche-demo",
    graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    displayName: "KG Avalanche Demo",
  });
  graphDbClientMock.deleteRepository.mockRejectedValue(
    new Error("GraphDB repository deletion failed with 500"),
  );

  const routeModule = await import("../../src/app/api/kg-targets/[id]/route");

  await expect(
    routeModule.DELETE(
      new Request("http://localhost/api/kg-targets/kg-target-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "kg-target-1" }) },
    ),
  ).rejects.toThrow("GraphDB repository deletion failed with 500");

  expect(dbMock.knowledgeGraphTarget.delete).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the route tests to verify they fail**

Run: `npm test -- tests/graphdb/routes.test.ts`

Expected: FAIL because the dynamic delete route and delete mock wiring do not exist yet.

- [ ] **Step 5: Implement the minimal GraphDB delete helper and route**

```ts
// src/lib/graphdb/client.ts
export async function deleteRepository(input: { repositoryId: string }) {
  const env = loadAppEnv(process.env);
  const response = await fetch(
    `${env.graphDbBaseUrl}rest/repositories/${encodeURIComponent(input.repositoryId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await buildGraphDbErrorMessage(response, "repository deletion"));
  }
}
```

```ts
// src/app/api/kg-targets/[id]/route.ts
import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { deleteRepository } from "@/lib/graphdb/client";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const target = await db.knowledgeGraphTarget.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Knowledge graph target not found" }, { status: 404 });
  }

  await deleteRepository({
    repositoryId: target.repositoryId,
  });

  await db.knowledgeGraphTarget.delete({
    where: {
      id: target.id,
    },
  });

  return NextResponse.json({ deletedTargetId: target.id });
}
```

- [ ] **Step 6: Run the backend tests to verify they pass**

Run: `npm test -- tests/graphdb/client.test.ts tests/graphdb/routes.test.ts`

Expected: PASS

### Task 2: Add Trash-Can Delete Control To The KG Panel

**Files:**
- Modify: `src/app/workspace/page.tsx`
- Modify: `src/components/workspace/workspace-shell.tsx`
- Modify: `src/components/workspace/kg-target-panel.tsx`
- Modify: `tests/app/workspace-shell.test.ts`

- [ ] **Step 1: Write the failing UI/source test for the delete affordance**

```ts
expect(workspaceSource).toContain("kgTargetsDeleteUrlBase");
expect(shellSource).toContain("kgTargetsDeleteUrlBase");
expect(kgTargetPanelSource).toContain("window.confirm");
expect(kgTargetPanelSource).toContain("fetch(`${deleteUrlBase}/");
expect(kgTargetPanelSource).toContain('method: "DELETE"');
expect(kgTargetPanelSource).toContain("Deleting...");
expect(kgTargetPanelSource).toContain('aria-label={`Delete ${target.displayName}`}');
```

- [ ] **Step 2: Run the UI/source test to verify it fails**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: FAIL because the KG panel has no delete URL or trash-can control yet.

- [ ] **Step 3: Implement the minimal UI wiring**

```ts
// src/app/workspace/page.tsx
const kgTargetsDeleteUrlBase = withAppBasePath("/api/kg-targets");
```

```ts
// src/components/workspace/workspace-shell.tsx
<KgTargetPanel
  createUrl={kgTargetsCreateUrl}
  deleteUrlBase={kgTargetsDeleteUrlBase}
  selectedDomain={selectedDomain}
  targets={kgTargets}
/>
```

```tsx
// src/components/workspace/kg-target-panel.tsx
async function handleDelete(target: { id: string; displayName: string }) {
  if (!window.confirm(`Delete ${target.displayName} and its GraphDB repository?`)) {
    return;
  }

  setDeletingTargetId(target.id);
  setCreateError(null);

  try {
    const response = await fetch(`${deleteUrlBase}/${target.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`KG deletion failed with ${response.status}`);
    }

    setDisplayedTargets((currentTargets) =>
      currentTargets.filter((currentTarget) => currentTarget.id !== target.id),
    );
  } catch (error) {
    console.error(error);
    setCreateError("Unable to delete the knowledge graph target right now.");
  } finally {
    setDeletingTargetId(null);
  }
}
```

```tsx
<button
  aria-label={`Delete ${target.displayName}`}
  className="workspace-button workspace-button-secondary"
  disabled={deletingTargetId === target.id}
  onClick={() => void handleDelete(target)}
  type="button"
>
  {deletingTargetId === target.id ? "Deleting..." : (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9z" fill="currentColor" />
    </svg>
  )}
</button>
```

- [ ] **Step 4: Run the UI/source test to verify it passes**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

### Task 3: Verify The End-To-End Delete Behavior

**Files:**
- Modify: `docs/manual-verification.md`

- [ ] **Step 1: Add the manual verification step**

```md
12. Exercise KG deletion:
    - Create a KG target from the workspace.
    - Click the trash-can button for that KG.
    - Confirm the delete prompt.
    - Verify the KG disappears from the workspace list.
    - Verify `GET /rest/repositories` in GraphDB no longer shows that repository.
```

- [ ] **Step 2: Run focused automated verification**

Run: `npm test -- tests/graphdb/client.test.ts tests/graphdb/routes.test.ts tests/app/workspace-shell.test.ts`

Expected: PASS

- [ ] **Step 3: Run lint on the touched files**

Run: `npm run lint`

Expected: PASS
