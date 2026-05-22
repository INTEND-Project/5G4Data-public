# Agent Logo Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four decorative partner logos from the design mockup directly below the `Available agents` refresh area in the workspace sidebar as an exact `2 x 2` tiled grid.

**Architecture:** Keep the change entirely inside the existing `AgentList` section so the logos travel with the agent panel and do not require new data flow from the server. Reuse the design’s partner order and source URLs, then replace the earlier loose strip with a fixed two-column grid of white logo tiles that visually matches the screenshot reference.

**Tech Stack:** Next.js App Router, React client components, global CSS, Vitest source-level tests

---

### Task 1: Add The Decorative Partner Grid To AgentList

**Files:**
- Modify: `src/components/workspace/agent-list.tsx`
- Modify: `tests/app/workspace-shell.test.ts`

- [ ] **Step 1: Write the failing source-level test**

```ts
expect(agentListSource).toContain("workspace-partner-grid");
expect(agentListSource).toContain("workspace-partner-tile");
expect(agentListSource).toContain("intendproject.eu/assets/1-sintef-4b735e01.png");
expect(agentListSource).toContain("intendproject.eu/assets/13-telenor-860e8851.png");
expect(agentListSource).toContain("intendproject.eu/assets/8-ericsson-2ecdf414.png");
expect(agentListSource).toContain("intendproject.eu/assets/3-tuw-0f8a1ebe.png");
expect(agentListSource).toContain('alt="Sintef"');
expect(agentListSource).toContain('alt="Telenor"');
expect(agentListSource).toContain('alt="Ericsson"');
expect(agentListSource).toContain('alt="TUW"');
```

- [ ] **Step 2: Run the source-level test to verify it fails**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: FAIL because `AgentList` does not render the tiled partner logo grid yet.

- [ ] **Step 3: Add the minimal partner strip markup**

```tsx
<div aria-label="Project partners" className="workspace-partner-grid">
  <div className="workspace-partner-tile">
    <Image
      alt="Sintef"
      className="workspace-partner-logo"
      height={28}
      src="https://intendproject.eu/assets/1-sintef-4b735e01.png"
      width={120}
    />
  </div>
  <div className="workspace-partner-tile">
    <Image
      alt="Telenor"
      className="workspace-partner-logo"
      height={28}
      src="https://intendproject.eu/assets/13-telenor-860e8851.png"
      width={120}
    />
  </div>
  <div className="workspace-partner-tile">
    <Image
      alt="Ericsson"
      className="workspace-partner-logo"
      height={28}
      src="https://intendproject.eu/assets/8-ericsson-2ecdf414.png"
      width={120}
    />
  </div>
  <div className="workspace-partner-tile">
    <Image
      alt="TUW"
      className="workspace-partner-logo"
      height={28}
      src="https://intendproject.eu/assets/3-tuw-0f8a1ebe.png"
      width={120}
    />
  </div>
</div>
```

- [ ] **Step 4: Run the source-level test to verify it passes**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

### Task 2: Style The Grid To Match The Sidebar Layout

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/app/workspace-shell.test.ts`

- [ ] **Step 1: Write the failing CSS expectations**

```ts
expect(globalsSource).toContain(".workspace-partner-grid");
expect(globalsSource).toContain(".workspace-partner-tile");
expect(globalsSource).toContain(".workspace-partner-logo");
expect(globalsSource).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
expect(globalsSource).toContain("background: #ffffff;");
expect(globalsSource).toContain("border-radius:");
expect(globalsSource).toContain("padding:");
expect(globalsSource).toContain("max-height:");
expect(globalsSource).toContain("object-fit: contain;");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: FAIL because the partner grid CSS classes do not exist yet.

- [ ] **Step 3: Add the minimal styling**

```css
.workspace-partner-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.workspace-partner-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 4px 8px;
  background: #ffffff;
  border-radius: 4px;
}

.workspace-partner-logo {
  max-height: 14px;
  max-width: 100%;
  width: auto;
  object-fit: contain;
}
```

- [ ] **Step 4: Run the source-level test to verify it passes**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

### Task 3: Final Verification

**Files:**
- Modify: `docs/manual-verification.md`

- [ ] **Step 1: Add a manual verification note for the sidebar logos**

```md
- the four partner logos appear below the `Available agents` refresh area as a `2 x 2` white-tile grid.
```

- [ ] **Step 2: Run focused automated verification**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS
