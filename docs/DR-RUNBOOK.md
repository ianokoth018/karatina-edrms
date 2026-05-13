# EDRMS Disaster Recovery Runbook

> Owner: Operations / DBA on-call
> Last validated: _pending — see "RTO / RPO" below._
> Companion code: `lib/backup.ts`, `scripts/backup.ts`, `scripts/restore.ts`, `scripts/backup-worker.ts`, admin UI at `/admin/backup`.

---

## 1. Service architecture (one-paragraph orientation)

Karatina EDRMS is a Next.js 16 application backed by a single PostgreSQL database (`DATABASE_URL` in `.env`) and a local filesystem `uploads/` tree that holds AES-256-GCM-encrypted document bytes (one file per `DocumentFile.storagePath`). A handful of long-running Node workers run alongside the web tier (`npm run start:workers`) — capture, OCR, SLA, escalation, storage-tiering, retention/disposition, SIEM-shipper, and (new) the backup worker. State of record is Postgres; `uploads/` is required to decrypt and serve the actual file bytes. Restoring one without the other yields a broken system, so every backup pairs the two.

## 2. What is backed up, where, retention

| Artefact | What | Where | Retention |
|---|---|---|---|
| `db-<stamp>.dump` | `pg_dump --format=custom --no-owner --no-acl` of `DATABASE_URL` | `$BACKUP_DIR` (default `./backups`) | 7 daily / 4 weekly / 12 monthly |
| `uploads-<stamp>.tar.gz` | `tar czf` of `uploads/` (excludes `uploads/archive` unless `INCLUDE_ARCHIVE=1`) | `$BACKUP_DIR` | same |
| `manifest-<stamp>.json` | `{ id, timestamp, type, sizes, sha256 checksums }` | `$BACKUP_DIR` | same |
| `backup_logs` row | One per run, indexes the artefacts + records status, duration, errors | Postgres | rolls with the artefact |

Manual runs (CLI or "Run backup now" button) are tagged `type=manual` and are **never pruned** automatically — operators clean those up by hand.

### NOT backed up (operator responsibility)

* `.env` — including `ENCRYPTION_KEY`. Without the key, the uploads archive is useless. **Store the key in a separate password manager / KMS / sealed envelope.**
* TLS certificates, reverse-proxy config, OS users.
* External integration secrets (SMTP password, IMAP credentials, DocuSign tokens, SIEM bearer tokens) — these live in `.env`.

## 3. Restore procedure

Assumes a fresh host with: Node 20+, Postgres 16+ client tools (`pg_dump`, `pg_restore`), `tar`, the EDRMS source tree at `/srv/edrms`, and the most recent backup directory copied to `/srv/edrms/backups/`.

1. **Stop the running app and workers.** `systemctl stop edrms-web edrms-workers` (or your equivalent process manager). Confirm with `ss -ltnp | grep :3001` that nothing answers.
2. **Restore `.env`** from your secret store. Verify `DATABASE_URL`, `DIRECT_URL`, `ENCRYPTION_KEY`, `NEXTAUTH_SECRET` are set.
3. **Locate the manifest** to restore from. List manifests: `ls -lt /srv/edrms/backups/manifest-*.json`. Pick the newest known-good one.
4. **Sanity-check the artefacts referenced in the manifest exist** and are readable: `jq -r '.dbDumpPath, .uploadsPath' manifest-*.json | xargs ls -l`.
5. **Ensure the target database exists and is empty.** If the original host is gone: `createdb karatina_edrms`. If it exists, **double-check you are on the right server** — `pg_restore --clean` will drop tables.
6. **Run the restore CLI:**
   ```
   cd /srv/edrms
   npx tsx scripts/restore.ts /srv/edrms/backups/manifest-<stamp>.json --yes
   ```
   The script verifies sha256 of both artefacts before touching anything; an `Error: ... checksum mismatch` aborts safely.
7. **Confirm row counts** match the source (eyeball): `psql $DATABASE_URL -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;"`.
8. **Verify uploads were restored** and `DocumentFile.storagePath` rows still resolve: `ls /srv/edrms/uploads/edrms | head` and pick one row from `documents` to spot-check.
9. **Run Prisma generate** in case the client is stale: `npx prisma generate`.
10. **Start the app + workers** and run smoke tests: `systemctl start edrms-web edrms-workers`; `npm run smoke`; log in as an admin; open one document end-to-end.

## 4. RTO / RPO targets

| Metric | Target | Notes |
|---|---|---|
| **RPO — Recovery Point Objective** | **24 hours** | Daily backup at 02:00 local. Loss of any work after the last backup is acceptable. |
| **RTO — Recovery Time Objective** | **4 hours** | Includes provisioning a new host, restoring DB + uploads, smoke-testing, and switching DNS. |

These are **unvalidated targets** until a full restore drill has been performed end-to-end against a clean host. Track the next drill date in operations calendar; results should be appended below.

| Drill date | Outcome | Actual RTO | Notes |
|---|---|---|---|
| _(none yet)_ | | | |

## 5. Failure scenarios

### 5.1 Database host loss (Postgres server unreachable or disk dead)

1. Provision a replacement Postgres instance with the same major version.
2. Update `DATABASE_URL` in `.env` to point at it (or keep the original DNS name and re-resolve).
3. From the app host, fetch the latest manifest under `$BACKUP_DIR` and run steps 5–7 of the restore procedure.
4. Restart workers; check `/admin/system-status`.

### 5.2 App server loss (web tier dead, DB and uploads intact)

1. Provision new app host with Node 20+, `pg_dump` / `pg_restore` / `tar` client tools, and the repo checked out at the same commit as production.
2. Drop the previous `.env` into place; verify it points at the surviving DB.
3. `npm ci && npx prisma generate && npm run build`.
4. `systemctl start edrms-web edrms-workers`. No DB restore necessary.
5. If the new host has no `uploads/`, fetch the most recent uploads archive from `$BACKUP_DIR` (or the off-site copy) and extract: `tar xzf uploads-<stamp>.tar.gz`.

### 5.3 Uploads disk loss (`uploads/` gone, DB intact)

1. Stop the workers so no new files are written into the missing path.
2. Restore from the most recent uploads tarball:
   ```
   tar xzf $BACKUP_DIR/uploads-<stamp>.tar.gz -C /srv/edrms
   ```
3. Spot-check a recent `DocumentFile.storagePath` from Postgres and `ls` the path.
4. Restart workers. Any files created between the backup and the disk loss are gone — query `documents` for rows created after the backup `timestamp` and follow up with originators.

### 5.4 Ransomware / encryption of live data

1. **Take the affected hosts offline immediately** — do not reboot, do not run AV in-place; capture forensic image first if required by policy.
2. Provision **fresh, isolated** hosts. Do not reuse credentials from the compromised hosts; rotate `NEXTAUTH_SECRET`, DB password, SMTP/IMAP creds, integration tokens.
3. Restore from the **oldest manifest known to predate the compromise** (check `backup_logs` timestamps against IDS / EDR alerts).
4. **Verify `ENCRYPTION_KEY` from secure offline copy** — never copy it back from the compromised host.
5. Run the full restore procedure (section 3). Apply OS / app patches before exposing to the network.
6. Force-reset all user sessions (`DELETE FROM user_sessions;`) and require password reset on next login.
7. Notify DPO / compliance per incident-response policy; preserve `audit_logs` for the investigation.

### 5.5 Accidental table drop / mass-delete

1. **Do not panic; do not run another backup** — that would overwrite the oldest daily with the corrupted state in roughly seven days.
2. Identify the time of the accident from `audit_logs` (`SELECT * FROM audit_logs ORDER BY occurred_at DESC LIMIT 50;`) or application logs.
3. Restore the most recent manifest taken **before** that timestamp into a **scratch** database:
   ```
   createdb edrms_scratch
   DATABASE_URL=postgresql://.../edrms_scratch npx tsx scripts/restore.ts <manifest> --yes
   ```
4. Export just the affected rows from the scratch DB (`pg_dump -t affected_table edrms_scratch | psql edrms_prod` after dropping the broken rows, or surgical `COPY (SELECT ...) TO STDOUT` + `COPY ... FROM STDIN`).
5. Verify with the original requester; write an audit row documenting the restore.

## 6. Post-restore verification

* **Smoke test:** `npm run smoke` — exercises every major module's import path.
* **Audit-chain verify:** `/admin/audit-integrity` page — recomputes the prev/next hash chain over `audit_logs` and reports the first mismatch (if any). A clean run after restore confirms the chain is intact.
* **File integrity sample:** pick 10 random rows from `document_files`, fetch them through the app, and confirm the served bytes decrypt (the app does this implicitly — a 200 OK with non-zero length means the AES-GCM auth tag verified).
* **Counts:** spot-compare `SELECT count(*) FROM documents`, `audit_logs`, `users` against the source.
* **Worker liveness:** check `/admin/system-status` for green ticks on each worker.
* **Auth:** log in as an admin, as a regular user; confirm `last_login_at` updates.

## 7. Off-site / cloud backup — TODO

The current implementation writes to `$BACKUP_DIR` on the same host as the database. **A same-host backup does not survive host loss, disk loss, or ransomware**, so an off-site sync is required before production go-live.

Recommended approach (not yet implemented):

* Nightly `rclone sync $BACKUP_DIR s3:edrms-backups/` (or Backblaze B2 with object-lock for ransomware protection).
* Server-side encryption + bucket versioning + lifecycle rules to mirror the local 7-daily / 4-weekly / 12-monthly policy.
* Quarterly restore drill from the off-site copy to validate the chain end-to-end.

Until that is wired up, copy `$BACKUP_DIR/manifest-*.json` + the referenced artefacts to an off-host location (encrypted external disk, secondary server, or cloud bucket) at least weekly. **The `ENCRYPTION_KEY` must travel separately** — never store it in the same place as the uploads archive.
