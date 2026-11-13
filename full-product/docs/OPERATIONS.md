# Local operations

Run commands from `D:\AEIGS\full-product`. Docker Desktop must be running with Linux containers. The generated, Git-ignored `.env` contains private database and setup secrets. Do not print it in logs or replace it during routine startup.

## Startup and project identity

```powershell
py scripts/configure.py
docker compose up --build -d
docker compose ps
```

If `.env` already exists, the configure command preserves it and exits. Continue with Compose when the existing configuration is intentional. The default application, API documentation, and readiness URLs are `http://localhost:3000`, `http://localhost:8000/api/docs`, and `http://localhost:8000/api/ready`; honor intentional port overrides.

**Keep the Compose project name stable.** This installation's ignored `.env` pins `AEGIS_COMPOSE_PROJECT=aegis-full-product-verify`, selecting the user's existing **My Space** database and artifact volumes. Do not change or remove that setting to restart the product. A different project name selects different volumes and can look like an empty installation; it does not migrate existing accounts or workspaces. Do not recreate an owner merely because a different project appears empty.

For a genuinely new installation, create the first owner using the main README's bootstrap command or the first-owner setup screen with the private `SETUP_TOKEN`. Choose a unique password. No default login exists. Existing installations should use sign-in or the documented private-workspace registration flow.

```powershell
docker compose logs --tail 100 api worker frontend
docker compose --profile training stop
docker compose --profile training start
```

The profile-aware stop/start commands also cover an optional training worker that has already been created; `start` does not create a new one. To remove containers and the project network while retaining data volumes, use `docker compose --profile training down`. Do not use `down -v` unless deletion of that project's database and artifact volumes is intentional. Source dataset bind mounts are separate from these volumes.

## Additional CPU training worker

The standard worker supports CPU training. An additional CPU worker can be started with:

```powershell
docker compose --profile training up -d training-worker
```

This is not a GPU implementation. Worker concurrency and per-child memory recycling are configurable; recycling is not a hard peak-memory limit. Set container memory limits appropriate to the machine and dataset before larger jobs.

## Isolated browser checks

Browser tests create users, workspaces, and records. **Never run end-to-end tests against the personal application on port 3000.** Use a separate Compose project on ports 3001/8001. PostgreSQL, Redis, and artifact volumes are separate; source dataset mounts remain read-only.

Run this example in a new PowerShell terminal. Overrides affect that terminal only; they do not rewrite `.env` or its pinned project name:

```powershell
$checksProject = 'aegis-full-product-checks'
$env:FRONTEND_PORT = '3001'
$env:API_PORT = '8001'
$env:FRONTEND_ORIGIN = 'http://localhost:3001'
$env:AI_PROVIDER = 'none'
$env:COMPOSE_PROFILES = ''
docker compose --project-name $checksProject up --build -d --wait
docker compose --project-name $checksProject ps

Set-Location frontend
$env:AEGIS_E2E_URL = 'http://localhost:3001'
$env:AEGIS_E2E_ISOLATED = '1'
npm ci
npm run test:e2e
Set-Location ..

docker compose --project-name $checksProject down
```

The suite uses installed Google Chrome. On a fresh check database it securely reads the local setup token, creates a random verification owner, and saves matching test credentials in ignored `.e2e/checks-account.json`. It refuses to initialize an existing owner database when matching test credentials are unavailable. The isolation flag is required; setting only the URL leaves tests skipped.

`down` retains check volumes. Use a fresh check project name for a clean database instead of deleting personal volumes. Keep `--project-name` on all check commands. Close the terminal afterward so its port/origin overrides cannot affect a personal restart.

## Consistent backup

Back up PostgreSQL and the artifact/upload volume together because they reference one another. Pause submissions and wait for every queued/running job to reach a terminal state in the Jobs view first. Redis is a queue/cache, not the authoritative backup; this procedure deliberately requires idle jobs.

The following commands select the pinned personal project. They stop **frontend, API, and both workers** while leaving PostgreSQL/Redis running. The previously running services restart in `finally`, even if backup fails. A disposable API-service container archives storage without starting the API or running migrations.

```powershell
function Invoke-AegisCompose {
    docker compose @args
    if ($LASTEXITCODE -ne 0) { throw 'Compose command failed; resolve the error before continuing.' }
}

$runningServices = @(docker compose --profile training ps --services --status running)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the selected project.' }
$backupPath = Join-Path (Get-Location).Path ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmssfff'))
New-Item -ItemType Directory -Path $backupPath -ErrorAction Stop | Out-Null

try {
    Invoke-AegisCompose --profile training stop frontend api worker training-worker
    Invoke-AegisCompose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/aegis.dump'
    Invoke-AegisCompose cp postgres:/tmp/aegis.dump (Join-Path $backupPath 'aegis.dump')
    Invoke-AegisCompose run --rm --no-deps --user 0:0 --entrypoint sh --volume "${backupPath}:/backup" api -c 'tar -czf /backup/aegis-storage.tar.gz -C /storage .'
}
finally {
    if ($runningServices.Count -gt 0) {
        Invoke-AegisCompose --profile training start @runningServices
    }
}
docker compose ps
```

PostgreSQL must already be running. The disposable storage helper runs as root inside its container to preserve volume files and write the selected backup directory; it does not change credentials. Protect the dump and archive: they contain private records, password hashes, uploads, and possibly model artifacts. Keep a secure copy of the matching private configuration outside source control. Source dataset bind mounts are not included; preserve their original files and permission records independently.

Archive creation alone does not verify recoverability. Validate a matched backup by restoring it into a separate environment.

## Restore into a separate environment

This procedure restores a matched backup into a **fresh, timestamped Compose project** on ports 3002/8002. It leaves the personal project and its volumes untouched. Use empty target volumes: extracting into populated storage could leave unrelated files behind. Do not substitute the personal project name without a separately planned, backed-up maintenance procedure.

Open a new PowerShell terminal in `full-product/`. Replace `YOUR_TIMESTAMP` with a completed backup directory and use trusted archives only. Keep `--project-name $restoreProject` on every restore command; omitting it selects the project pinned in `.env`.

```powershell
function Invoke-AegisRestore {
    docker compose --project-name $restoreProject @args
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed; leave API and workers stopped until resolved.' }
}

$backupPath = (Resolve-Path -LiteralPath '.\backups\YOUR_TIMESTAMP' -ErrorAction Stop).Path
Get-Item -LiteralPath (Join-Path $backupPath 'aegis.dump'), (Join-Path $backupPath 'aegis-storage.tar.gz') -ErrorAction Stop | Out-Null
$restoreProject = 'aegis-full-product-restore-' + (Get-Date -Format 'yyyyMMddHHmmssfff')
$env:FRONTEND_PORT = '3002'
$env:API_PORT = '8002'
$env:FRONTEND_ORIGIN = 'http://localhost:3002'

Invoke-AegisRestore --profile training stop frontend api worker training-worker
Invoke-AegisRestore up -d --wait postgres redis
Invoke-AegisRestore cp (Join-Path $backupPath 'aegis.dump') postgres:/tmp/aegis.dump
Invoke-AegisRestore exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error --single-transaction /tmp/aegis.dump'
Invoke-AegisRestore run --rm --no-deps --user 0:0 --entrypoint sh --volume "${backupPath}:/backup:ro" api -c 'tar -xzf /backup/aegis-storage.tar.gz -C /storage && chown -R aegis:aegis /storage'
Invoke-AegisRestore up -d --wait api
Invoke-AegisRestore up -d --wait worker frontend
Invoke-AegisRestore ps
```

API and workers remain stopped throughout database and artifact restoration. Start them only after both steps succeed. `pg_restore` intentionally omits `--clean`: an unexpected non-empty database should cause a transactional failure instead of silently replacing an installation. API startup applies any newer database migrations before worker/frontend startup. Restore using the matching application version first when checking backup integrity; do not run older code against a newer schema.

Open `http://localhost:3002` in a separate browser profile and inspect restored workspaces, reports, uploads, and model versions. Database backups contain sessions; separate profiles also prevent sharing the `localhost` session cookie with the personal installation. Manage the restore with its explicit project name. `docker compose --project-name $restoreProject down` stops that environment and retains its volumes. Close the terminal to discard temporary port/origin overrides. Do not copy check or restore settings over the personal `.env`.

## Deployment boundary

For hosted deployment, configure TLS, `COOKIE_SECURE=true`, the exact public origin, managed secrets, proxy/service access controls, and an independent security review. The included loopback Compose configuration and these procedures target local development; they do not establish production readiness.
