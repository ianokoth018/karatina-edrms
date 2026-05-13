# EDRMS Performance Harness

This directory contains the perf harness used to validate that EDRMS can
survive realistic load. The KCAA spec quotes ~20 million documents; we
provision a synthetic 50k corpus on a dev box and extrapolate ceiling
behaviour from there.

The harness has three pieces, all under `scripts/`:

| Script              | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `perf-seed.ts`      | Bulk-insert synthetic Documents + DocumentFiles             |
| `perf-bench.ts`     | Single-shot latency measurement on critical endpoints       |
| `perf-load.ts`      | Sustained concurrent load against `/api/search`             |

No new npm dependencies were added — everything uses the existing
`@prisma/client` and Node's stdlib `http`/`https`.

---

## Quick start

```bash
# 1. Make sure the FTS indexes are in place (idempotent).
npx tsx scripts/setup-fts-indexes.ts

# 2. Generate 50k synthetic Documents + DocumentFiles.
#    Re-runnable: counts what already exists and only inserts the gap.
npm run perf:seed

# 3. In one terminal start the app:
npm run dev

# 4. In another, point the bench at it:
BASE_URL=http://localhost:3000 \
ADMIN_EMAIL=admin@karu.ac.ke \
ADMIN_PASSWORD='Admin@2026' \
npm run perf:bench

# 5. For sustained throughput:
npm run perf:load
```

### Cleaning up

```bash
# Removes everything tagged "PERF-*" (Document rows; the FK cascade drops
# DocumentFile/OcrWord rows). Also deletes synthetic perf-user-* accounts.
npx tsx scripts/perf-seed.ts --clean
```

---

## Knobs

### `perf-seed.ts`

| Env var            | Default  | Notes                                   |
| ------------------ | -------- | --------------------------------------- |
| `PERF_DOC_COUNT`   | `50000`  | Total Document rows to ensure exist     |
| `PERF_DEPT_COUNT`  | `12`     | Synthetic department buckets            |
| `PERF_USER_COUNT`  | `30`     | Synthetic users (creators)              |

Batches are 500 rows wrapped in a `db.$transaction` so a failure rolls
back the batch instead of corrupting the count.

### `perf-bench.ts`

| Env var           | Default                       |
| ----------------- | ----------------------------- |
| `BASE_URL`        | `http://localhost:3000`       |
| `ADMIN_EMAIL`     | `admin@karu.ac.ke`            |
| `ADMIN_PASSWORD`  | `Admin@2026`                  |
| `PERF_ITERATIONS` | `50`                          |

Routes under test:

- `GET  /api/documents?limit=20`
- `GET  /api/search?q=contract`
- `GET  /api/search?q=contract&ai=0`
- `GET  /api/admin/reports/overview?sinceDays=30`
- `GET  /api/admin/search-analytics?sinceDays=30`
- `POST /api/workflows/simulate`  (small 4-node graph)

Output: markdown table on stdout + `perf-results-<timestamp>.csv` next to
the working directory.

### `perf-load.ts`

| Env var           | Default                          |
| ----------------- | -------------------------------- |
| `PERF_VUS`        | `10`                             |
| `PERF_DURATION_S` | `60`                             |
| `PERF_TARGET_PATH`| `/api/search?q=test`             |

Reports throughput, error rate, and p50/p95/p99 latency. Progress lines
every 5s so you can see whether the server is heating up.

---

## Interpreting results at 50k

Rough sniff-test boundaries on a developer laptop (Postgres on the same
box, Next dev server, no Redis cache):

| Endpoint                           | Healthy at 50k | Concerning at 50k |
| ---------------------------------- | -------------- | ----------------- |
| `documents.list (limit=20)`        | < 100 ms p95   | > 500 ms p95      |
| `search.fts q=contract`            | < 250 ms p95   | > 1 s p95         |
| `reports.overview sinceDays=30`    | < 800 ms p95   | > 3 s p95         |
| `search-analytics sinceDays=30`    | < 500 ms p95   | > 2 s p95         |
| `workflows.simulate (4 nodes)`     | < 50 ms p95    | > 200 ms p95      |
| `/api/search` sustained, 10 VUs    | > 30 req/s     | < 10 req/s        |

If any of those line up on the "concerning" side, the usual fixes are:

1. **FTS not being used.** Confirm `scripts/setup-fts-indexes.ts` ran
   and `EXPLAIN ANALYZE` shows a `Bitmap Index Scan` on
   `idx_documents_fts` / `idx_document_files_ocr_fts`.
2. **Missing btree indexes on filters.** `Document.status`,
   `department`, `documentType`, and `createdAt` already have
   `@@index([...])` in the schema. If you add filters, add indexes.
3. **N+1 in admin reports.** The overview/analytics routes aggregate;
   consider pushing the aggregation into a single Postgres query or a
   nightly materialised view rather than counting in JS.
4. **AI rewrite hot path.** `search?ai=1` calls the LLM provider on
   every request. Always benchmark with `ai=0` for a baseline, and gate
   `ai=1` behind a user toggle.

---

## Roadmap (TODO)

These haven't been implemented; they're the next levers when 50k starts
to feel slow at the boundaries above:

- [ ] **`pgvector` for semantic search.** Add an `embedding vector(1536)`
      column on `DocumentFile.ocrText` and use IVFFlat or HNSW. Gives us
      semantic recall the FTS can't deliver, and scales to millions.
- [ ] **OpenSearch (or Meilisearch) for scale-out search.** Once we
      cross ~1M documents, in-Postgres FTS hits index-size and
      maintenance cost issues. Mirror documents into an external search
      cluster and route `/api/search` through it.
- [ ] **Materialised views for admin reports.** `overview` and
      `search-analytics` recompute window aggregates per-request.
      Refresh a `mv_reports_daily` every 5 minutes and read from that.
- [ ] **Connection pooling at the edge.** PgBouncer (transaction mode)
      in front of Postgres so the Next runtime can survive a load spike
      without exhausting Postgres backends.
- [ ] **Result caching for `/api/search`.** A 30s LRU keyed on
      `(userId, query, filters)` would absorb refresh-spam without
      sacrificing freshness.
- [ ] **OCR storage offload.** `DocumentFile.ocrText` lives inline in
      Postgres. For tens of millions of rows we'll want to move OCR
      bodies to object storage and keep only the FTS column in the DB.

---

## Numbers we hit on the dev box

> Fill these in after the first real run. The CSV from `perf-bench.ts`
> can be opened in any spreadsheet to slice further (e.g. min/max/avg
> per route).

| Route                            | Method | p50 (ms) | p95 (ms) | p99 (ms) | req/s | errors |
| -------------------------------- | ------ | -------- | -------- | -------- | ----- | ------ |
| documents.list                   | GET    |          |          |          |       |        |
| search.fts                       | GET    |          |          |          |       |        |
| search.fts.noAi                  | GET    |          |          |          |       |        |
| reports.overview.30d             | GET    |          |          |          |       |        |
| search-analytics.30d             | GET    |          |          |          |       |        |
| workflows.simulate               | POST   |          |          |          |       |        |

Load profile (`perf-load.ts`, `/api/search?q=test`, 10 VUs × 60s):

| Metric            | Value |
| ----------------- | ----- |
| Total requests    |       |
| Throughput (rps)  |       |
| Error rate (%)    |       |
| p50 latency (ms)  |       |
| p95 latency (ms)  |       |
| p99 latency (ms)  |       |
| Max latency (ms)  |       |
