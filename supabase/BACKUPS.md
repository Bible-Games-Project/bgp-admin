# Database backups

The console's database lives in the Supabase project `jolsgcmdbhpaoofjabfg`. It is on the free plan, which keeps no backups we can restore.
[`supabase-backup.yml`](../.github/workflows/supabase-backup.yml) runs every night at 02:43 UTC. It takes a full `pg_dump`, encrypts it with [age](https://age-encryption.org) and keeps it as a workflow artifact for 90 days.

- **The key.** The private key that decrypts the backups is in Pau's macOS Keychain as "Supabase bgp-admin backup key". **Without it the backups are useless**, so keep a second copy in a password manager. The public key is in the workflow.
- **What's inside.** Every schema, including `auth`: users, password hashes and TOTP secrets. Supabase Storage isn't used, so there are no files to back up.
- **If the nightly runs stop.** GitHub pauses scheduled workflows in a public repo after 60 days without commits, and emails before it does. If that happens, re-enable both `Supabase backup` and `Supabase keep-alive` from the repo's Actions tab.

## Get a backup

You need `age`, `gh` and the PostgreSQL 17 tools (`brew install age gh postgresql@17`).

```sh
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
gh run list --repo Bible-Games-Project/bgp-admin --workflow supabase-backup.yml --limit 10
gh run download <run-id> --repo Bible-Games-Project/bgp-admin --dir backup
age --decrypt \
  --identity <(security find-generic-password -s "Supabase bgp-admin backup key" -w) \
  --output backup.dump backup/*.dump.age
```

Once it's decrypted, `backup.dump` holds password hashes and TOTP secrets in the clear. Delete it when you're done.

## Look at old rows

To see a table as it was, without touching the live database:

```sh
pg_restore --data-only --table=apps --file=- backup.dump
```

## Rebuild the database

Use this when the project is gone, or its data can't be fixed row by row. It restores into an **empty** project whose schema comes from `supabase/migrations`. It does not overwrite a live database.

1. Create a new project in the "BGP Admin" org. Apply the migrations to it with `npx -y supabase@2.118.0 db push --db-url "<its session pooler URL>"`.
2. Restore the users and the console's tables:

   ```sh
   pg_restore --list backup.dump \
     | grep -E ' TABLE DATA public | TABLE DATA auth (users|identities|mfa_factors) ' > restore.list
   pg_restore --data-only --use-list=restore.list --file=data.sql backup.dump
   psql "<its session pooler URL>" --single-transaction --set ON_ERROR_STOP=1 \
     --command 'SET session_replication_role = replica' --file data.sql
   ```

   - `session_replication_role = replica` turns off foreign-key checks while the data loads. They have to be off because the dump lists tables alphabetically, not parents first.
   - Sessions and refresh tokens are left out on purpose, because they don't work in another project. Everyone signs in again with the same password and authenticator app.
3. Point the console at the new project the way commit 59cbe0d did. That means `.env`, `wrangler.toml`, `supabase/config.toml`, the workflows and the `SUPABASE_DB_PASSWORD` secret.
