# OpenClaw Controller MVP Verification

## Automated checks

Run these from `IntentAgent/OpenClawController`:

```bash
npm test
npm run lint
npm run build
```

Expected result:

- `vitest` passes all unit and route tests.
- `eslint` reports no authored-code errors.
- `next build` completes successfully.

## Manual smoke flow

1. Start the app with `npm run dev`.
2. Open `/login`.
3. Create a local user with the register form.
4. Sign in with the same credentials and confirm the app redirects to `/workspace`.
5. Confirm the workspace shows:
   - the INTEND brand header with the icon, studio title, subtitle, registry status chip, static runId chip, and `About/Help` button,
   - a green registry chip when `https://start5g-1.cs.uit.no/a2a-registry/` is reachable and a red chip when it is not,
   - registry-derived domains,
   - filtered available agents for the selected domain,
   - the four partner logos below the `Available agents` refresh area as a `2 x 2` white-tile grid,
   - a Monaco editor with DSL text,
   - assistant hints and derived metric names,
   - the KG target panel.
6. Exercise the auth APIs:
   - `POST /api/auth/register`
   - `POST /api/auth/login`
   - `GET /api/auth/session`
   - `POST /api/auth/logout`
7. Exercise script persistence:
   - `GET /api/scripts?domain=<domain>`
   - `POST /api/scripts`
   - `GET/PATCH/DELETE /api/scripts/<id>`
8. Exercise registry reads:
   - `GET /api/domains`
   - `GET /api/agents?domain=<domain>`
9. Exercise KG target creation:
   - `GET /api/kg-targets?domain=<domain>`
   - `POST /api/kg-targets`
10. Exercise DSL support:
    - `POST /api/dsl/analyze`
    - `POST /api/dsl/completions`
11. Exercise run flows:
    - `POST /api/runs/dry-run`
    - `POST /api/runs/execute`
12. Exercise KG deletion:
    - Create a KG target from the workspace.
    - Click the trash-can button for that KG.
    - Confirm the delete prompt.
    - Verify the KG disappears from the workspace list.
    - Verify `GET /rest/repositories` in GraphDB no longer shows that repository.

## Notes

- The workspace currently surfaces the main flows and data dependencies, but several actions are still routed through API endpoints rather than fully interactive UI controls.
- GraphDB and registry requests depend on the configured external services being reachable from the current environment.
