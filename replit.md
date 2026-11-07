# Lughati Course Platform

An Arabic-first English-learning platform for learner access, structured courses, progress, group chat, and instructor administration.

## Run & Operate

- `pnpm --filter @workspace/course-app run dev` — run the web app
- `pnpm --filter @workspace/api-server run dev` — run the media API
- `pnpm run typecheck` — typecheck all workspace packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and schemas
- Supabase setup and SQL: `artifacts/course-app/docs/supabase-setup.md` and `artifacts/course-app/supabase/`
- Required environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web app: React, Vite, Wouter, TanStack Query
- Auth and course data: Supabase Auth, Postgres RPCs, and Storage
- Media API: Express 5 with Zod request/response validation
- API codegen: Orval from `lib/api-spec/openapi.yaml`

## Where things live

- `artifacts/course-app/src/App.tsx` — learner and admin routes
- `artifacts/course-app/src/lib/` — Supabase, course, chat, upload, and media clients
- `artifacts/course-app/supabase/` — Supabase schema, RPC, and storage setup scripts
- `artifacts/api-server/src/routes/` — health and protected media endpoints
- `lib/api-spec/openapi.yaml` — shared API contract

## Architecture decisions

- Supabase is the source of truth for authentication, course content, learner progress, chat, and storage policies.
- Private course and chat media use short-lived signed links from the API server; the service-role key must never be exposed to the browser.
- The learner experience is Arabic-first and uses right-to-left layout.

## Product

Learners enter with their access details, browse courses and lesson content, track progress, and participate in group chat. Administrators manage learners, courses, and community settings.

## User preferences

No additional product-specific preferences provided.

## Gotchas

- Add the two `VITE_` Supabase values before building the web app; the app shows setup guidance when they are absent.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and restart the API server after changing it.
- Follow `docs/supabase-setup.md` before expecting sign-in or course data; the SQL scripts require the administrator email to be set in Supabase first.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
