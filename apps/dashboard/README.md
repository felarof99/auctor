# Twitter Extractor Dashboard

Simple React dashboard that reads from the Supabase `tweets` table and shows rows extracted in the last hour.

## Setup

1. Create `apps/dashboard/.env`:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
```

2. Fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Notes:
- The extractor writes to the `tweets` table (see `apps/extractor/sql/schema.sql`).
- If you have RLS enabled, you need a `SELECT` policy for the anon key (or disable RLS for hackathon/local use).

## Run

```bash
bun run --filter @browseros/dashboard dev
```

