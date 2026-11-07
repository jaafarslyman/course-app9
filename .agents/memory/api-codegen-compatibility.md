---
name: API code generation compatibility
description: Compatibility requirements that surface when adding generated API schemas and client hooks.
---

When adding Express endpoints that consume generated Zod validators, extend the canonical OpenAPI contract and rerun code generation. Keep Orval's generated React Query version aligned with the installed TanStack Query version; this workspace uses v5. The generated client also iterates `Headers`, so its TypeScript library configuration must include DOM iterable types.

**Why:** New media routes exposed generator defaults that did not match the workspace's React Query and DOM typings.

**How to apply:** Before typechecking new routes, update `lib/api-spec/openapi.yaml`, run API codegen, then run the workspace typecheck.
