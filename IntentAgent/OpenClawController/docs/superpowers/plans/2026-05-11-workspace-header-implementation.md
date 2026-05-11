# Workspace Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current workspace top header with the design-matched INTEND brand header and a design-style right action area, while only wiring the registry-status chip live for now.

**Architecture:** Add a small server-side helper that checks whether the configured A2A registry base URL is reachable and pass that boolean into `WorkspaceShell`. Update `WorkspaceShell` to render the design-style left brand block and the right action area with a live registry chip, a static runId chip, and a visual `About/Help` button, plus any small CSS hooks needed to support the layout.

**Tech Stack:** Next.js App Router, React server components, global CSS, Vitest source-level tests

---

### Task 1: Add Registry Connectivity Detection

**Files:**
- Create: `src/lib/registry/status.ts`
- Modify: `src/app/workspace/page.tsx`
- Modify: `tests/app/workspace-shell.test.ts`

- [ ] **Step 1: Write the failing source-level test for the new header data flow**

```ts
expect(workspaceSource).toContain("getRegistryConnectionStatus");
expect(workspaceSource).toContain("registryConnected");
expect(shellSource).toContain("registryConnected");
```

- [ ] **Step 2: Run the source-level test to verify it fails**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: FAIL because the workspace page does not fetch registry connectivity and `WorkspaceShell` does not accept that prop yet.

- [ ] **Step 3: Implement the minimal registry status helper and page wiring**

```ts
// src/lib/registry/status.ts
import { loadAppEnv } from "@/lib/env";

export async function getRegistryConnectionStatus() {
  const env = loadAppEnv(process.env);

  try {
    const response = await fetch(env.a2aRegistryBaseUrl, {
      cache: "no-store",
    });

    return response.ok;
  } catch {
    return false;
  }
}
```

```ts
// src/app/workspace/page.tsx
import { getRegistryConnectionStatus } from "@/lib/registry/status";

const registryConnected = await getRegistryConnectionStatus();

return (
  <WorkspaceShell
    ...
    registryConnected={registryConnected}
  />
);
```

- [ ] **Step 4: Run the source-level test to verify it passes**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

### Task 2: Replace The Workspace Header Markup

**Files:**
- Modify: `src/components/workspace/workspace-shell.tsx`
- Modify: `tests/app/workspace-shell.test.ts`

- [ ] **Step 1: Extend the failing source-level test for the design header**

```ts
expect(shellSource).not.toContain("INTEND Controller");
expect(shellSource).not.toContain("OpenClaw Workspace");
expect(shellSource).toContain("INTEND Data Generation Controller Studio");
expect(shellSource).toContain(
  "TM Forum intent data generation script design and execution for cognitive continuum",
);
expect(shellSource).toContain("intend-icon.png");
expect(shellSource).toContain("agent registry connected");
expect(shellSource).toContain("agent registry disconnected");
expect(shellSource).toContain("runId: demo-run-2026-05-06");
expect(shellSource).toContain("About/Help");
```

- [ ] **Step 2: Run the source-level test to verify it fails**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: FAIL because the old brand text and stage chips are still rendered.

- [ ] **Step 3: Implement the minimal header markup**

```tsx
// src/components/workspace/workspace-shell.tsx
type WorkspaceShellProps = {
  ...
  registryConnected: boolean;
};

<header className="workspace-topbar">
  <div className="workspace-brand">
    <img
      alt="INTEND icon"
      className="workspace-brand-logo"
      src="https://intendproject.eu/assets/intend-icon.png"
    />
    <div className="workspace-brand-copy">
      <strong>INTEND Data Generation Controller Studio</strong>
      <span>
        TM Forum intent data generation script design and execution for cognitive
        continuum
      </span>
    </div>
  </div>
  <div className="workspace-top-actions">
    <span
      className={`workspace-chip ${
        registryConnected ? "workspace-chip-live" : "workspace-chip-down"
      }`}
    >
      {registryConnected ? "agent registry connected" : "agent registry disconnected"}
    </span>
    <span className="workspace-chip">runId: demo-run-2026-05-06</span>
    <button className="workspace-button" type="button">
      About/Help
    </button>
  </div>
</header>
```

- [ ] **Step 4: Run the source-level test to verify it passes**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

### Task 3: Add Styling Hooks For The New Header

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/app/workspace-shell.test.ts`

- [ ] **Step 1: Write the failing CSS expectations**

```ts
expect(globalsSource).toContain(".workspace-brand");
expect(globalsSource).toContain(".workspace-brand-logo");
expect(globalsSource).toContain(".workspace-brand-copy");
expect(globalsSource).toContain(".workspace-top-actions");
expect(globalsSource).toContain(".workspace-chip-live");
expect(globalsSource).toContain(".workspace-chip-down");
```

- [ ] **Step 2: Run the source-level test to verify it fails**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: FAIL because the new header styling hooks do not exist yet.

- [ ] **Step 3: Add the minimal CSS**

```css
.workspace-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.workspace-brand-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

.workspace-brand-copy {
  display: grid;
  gap: 4px;
}

.workspace-brand-copy strong {
  font-size: 1.1rem;
}

.workspace-brand-copy span {
  color: var(--muted);
  font-size: 0.92rem;
}

.workspace-top-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.workspace-chip-live {
  background: rgba(131, 242, 161, 0.14);
  color: #bdf7cb;
}

.workspace-chip-down {
  background: rgba(255, 138, 122, 0.18);
  color: #ffd1ca;
}
```

- [ ] **Step 4: Run the source-level test to verify it passes**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

### Task 4: Final Verification

**Files:**
- Modify: `docs/manual-verification.md`

- [ ] **Step 1: Add a manual verification note for the new header**

```md
- the top header matches the original design with the INTEND logo, updated title/subtitle, and a live registry connection chip.
```

- [ ] **Step 2: Run focused automated verification**

Run: `npm test -- tests/app/workspace-shell.test.ts`

Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS
