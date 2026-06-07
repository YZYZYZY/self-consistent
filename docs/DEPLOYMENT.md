# Deployment

This project is designed to run as:

```text
Android phone
  -> Capacitor shell / PWA
  -> hosted web frontend
  -> FastAPI backend
  -> model provider + SQLite
```

## Backend

### Docker

```powershell
docker build -t micro-action-coach-api services/api
docker run --rm -p 8000:8000 --env-file .env micro-action-coach-api
```

### Docker Compose

```powershell
docker compose up --build api
```

The compose file persists SQLite data in the `api-data` Docker volume.

### Render

`render.yaml` defines a Docker web service rooted at `services/api`.

It also declares a persistent disk mounted at `/data`; the Render `DATABASE_URL` points SQLite at that mount so AI records, prompt overrides, and runtime model config survive restarts and deploys.

Set these secrets in Render:

```text
DEEPSEEK_API_KEY
SERVER_RECORD_ENABLED=true
ADMIN_TOKEN=your-admin-token
CORS_ORIGINS=https://your-frontend-domain.example
```

To switch model providers, set `AI_PROVIDER` to `deepseek`, `openai`, `qwen`, `moonshot`, `zhipu`, `claude`, `gemini`, or `custom`, then provide the matching `*_API_KEY` and optional `*_BASE_URL`. Claude/Gemini are supported through an OpenAI-compatible gateway URL in this first backend version.

### Railway / Fly.io / VPS

Use `services/api/Dockerfile`, expose port `8000`, and set:

```text
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=...
DATABASE_URL=sqlite:////data/micro_action_coach.db
SERVER_RECORD_ENABLED=true
ADMIN_TOKEN=...
CORS_ORIGINS=https://your-frontend-domain.example
```

Provider status can be checked without exposing secrets:

```text
GET /health
GET /readyz
GET /api/models/providers
GET /api/models/config
PUT /api/models/config
```

Use `GET /health` for lightweight runtime checks. It reports the active provider/model, whether the active provider is configured, and how many providers have usable credentials/base URLs.

Use `GET /readyz` for deployment readiness checks. It verifies SQLite is reachable and the current schema version matches the backend expectation without exposing API keys or the database path.

SQLite runs in WAL mode with tuned busy timeout/cache settings. Server-side writes use a serialized `BEGIN IMMEDIATE` transaction path so bursts of AI record saves, prompt edits, model switches, and backup restores are less likely to contend or drop writes on a personal SQLite deployment.

Use `PUT /api/models/config` to switch active provider/model at runtime. When `ADMIN_TOKEN` is set, send `X-Admin-Token`. The same runtime model config can be edited from the app at `我的 -> 模型代理`.

The client never stores model API keys. If the active provider is not configured, the Web/PWA/Android UI shows a model-setup notice and the coach flows use local fallback responses instead of calling the AI endpoints.

Prompt overrides are stored in SQLite and can be updated remotely:

```text
GET /api/prompts
PUT /api/prompts/{system|procrastination|encouragement|creation|relationship|daily_review}
```

When `ADMIN_TOKEN` is set, send it as `X-Admin-Token` for `PUT` requests. Set `SERVER_RECORD_ENABLED=false` if the backend should proxy AI calls without saving server-side records.

Per-request privacy also wins over the global setting: if an AI request includes `context.historyEnabled=false` or `context.serverRecordEnabled=false`, the backend will not write that turn to SQLite even when `SERVER_RECORD_ENABLED=true`. The app exposes this as `我的 -> 服务端记录`, so a user can keep local history enabled while opting out of server-side SQLite writes.

The same prompt overrides can be edited from the app at `我的 -> 提示词管理`, which is the easiest path for quick iteration after the Web frontend or Android shell is already deployed.

Server-side records can be inspected from the app at `我的 -> 服务端数据`. The backend also exposes:

```text
GET /api/diagnostics
GET /api/records
GET /api/records/page
GET /api/records/export
GET /api/records/stats
GET /api/admin/backup
POST /api/admin/restore
POST /api/admin/maintenance
GET /api/profile/summary
DELETE /api/records/{id}
DELETE /api/records
```

Use `GET /api/diagnostics` after deployment to verify FastAPI version, active provider/model, configured provider count, SQLite connectivity, WAL/busy-timeout settings, page/free-page counts, and whether server-side records are enabled. The response does not include provider API keys or the absolute database path.

Use `GET /api/records?limit=20&offset=0` for compatible paged record reads. Use `GET /api/records/page?limit=20&offset=0` when the client needs `total_records`, `next_offset`, and `has_more` in the same response. Add `scene=creation` or another scene id to filter records through the indexed scene path. Use `GET /api/records/export` to export the current server-side record set as JSON; it supports the same optional `scene` filter and is capped by the backend page-size clamp. Use `GET /api/admin/backup` before migrations or VPS moves to export all records, record stats, prompt overrides, and the runtime model config in one JSON file; unlike record export, backup is not capped at 200 records. Use `POST /api/admin/restore` to import that JSON in `merge` mode, or in explicit `replace` mode when rebuilding a fresh backend from a backup. Use `POST /api/admin/maintenance` for routine SQLite `PRAGMA optimize` plus WAL checkpoint maintenance; pass `{ "vacuum": true }` only when you intentionally want a heavier compaction pass. Use `GET /api/records/stats` for total count, latest write time, scene counts, risk counts, and the backend page-size clamp. The app loads server records incrementally with cursor-based pages instead of refetching a growing first page. Use `DELETE /api/records/{id}` to remove one SQLite AI record from the app's server-data list, or `DELETE /api/records` to clear all SQLite AI records; bulk deletion also runs `PRAGMA optimize` and a WAL checkpoint to keep long-lived personal SQLite deployments tidy. When `ADMIN_TOKEN` is set, send `X-Admin-Token` for exports, full backup, restore, maintenance, and deletion.

For long-lived VPS deployments, mount a persistent directory and use:

```text
DATABASE_URL=sqlite:////data/micro_action_coach.db
```

## Frontend

The frontend is a Vite PWA in `apps/web`.

Set the API base URL before building:

```powershell
Copy-Item apps\web\.env.example apps\web\.env.local
```

Then edit:

```text
VITE_API_BASE_URL=https://your-api-domain.example
```

Build:

```powershell
$env:VITE_API_BASE_URL='https://your-api-domain.example'
npm run build:web
$env:EXPECTED_FRONTEND_API_BASE=$env:VITE_API_BASE_URL
npm run smoke:frontend-api-base
```

`smoke:frontend-api-base` checks the built `apps/web/dist` JavaScript assets before upload. It must find the target backend API base URL in the production bundle and, for hosted backends, fail if the bundle still contains the localhost fallback.

### Cloudflare Pages

Recommended project settings:

```text
Project root: apps/web
Build command: npm run build
Build output directory: dist
Environment variable: VITE_API_BASE_URL
```

Compatibility project settings, for an existing Cloudflare Pages project that already builds from the repository root:

```text
Project root: /
Build command: npm run build
Build output directory: dist
Environment variable: VITE_API_BASE_URL
```

The repository root `build` script delegates to `npm run build:web` and mirrors `apps/web/dist` into root `dist`, so both settings produce the same Vite production output. Prefer the `apps/web` root for new Pages projects, and use the repository-root settings only when keeping an existing Pages project configuration.

`public/_headers` and `public/_redirects` are included for SPA routing and PWA cache behavior. The app registers the PWA service worker at startup; when a new frontend bundle is available, users see an in-app update prompt and can refresh into the latest version without reinstalling the Android shell.

### Vercel

`apps/web/vercel.json` configures:

- Vite build
- `dist` output
- SPA fallback
- static asset cache headers

Set `VITE_API_BASE_URL` in Vercel project environment variables.

Run `npm run smoke:static-config` after changing `_headers` or `vercel.json`. It verifies HTML, service worker, and manifest routes stay revalidating while hashed assets under `/assets/` remain immutable.

Run `npm run smoke:cloudflare-pages-config` after changing root/workspace package scripts, Cloudflare Pages project settings, or deployment docs. It verifies both supported Pages configurations remain valid: `apps/web` as the project root with `dist` output, and repository root builds with root `dist` output.

Run `npm run smoke:pwa-config` after changing `vite.config.ts`, `index.html`, PWA icons, or SPA fallback files. It verifies prompt-based updates, standalone manifest settings, maskable icons, service worker precache/navigation fallback, and vendor chunk split configuration.

Run `npm run smoke:frontend-api-base` after building for a hosted frontend and before uploading `dist`. Set `EXPECTED_FRONTEND_API_BASE` or `SMOKE_BACKEND_URL` to the deployed FastAPI origin.

After the frontend and backend are deployed, run `npm run smoke:deploy` with `SMOKE_FRONTEND_URL` and `SMOKE_BACKEND_URL` set. Unlike the local static-server smoke, this live deployment check also verifies the actual response cache headers for hosted HTML, the PWA manifest, `sw.js`, one referenced hashed JS/CSS asset, that the hosted frontend bundle contains the configured backend API base URL instead of a localhost fallback, and that the backend profile summary is readable and does not expose secrets. The full external evidence sequence is in `docs/RELEASE_EVIDENCE.md`.

After the final Cloudflare Pages and Render URLs are known, `npm run release:official-urls` can perform the explicit production URL handoff in one pass. Set `SMOKE_FRONTEND_URL` and `SMOKE_BACKEND_URL`; the script builds the frontend with `VITE_API_BASE_URL` set to the Render backend, verifies the built bundle, runs deployed smoke, syncs Capacitor with `CAP_SERVER_URL` set to the Pages frontend, builds the debug APK, and verifies the APK in remote hosted frontend mode.

To persist the deployed smoke evidence, set `SMOKE_DEPLOY_REPORT`:

```powershell
$env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'
npm run smoke:deploy
```

The report records the frontend/backend origins, whether optional AI/admin checks ran, the checks covered, and final status. A final deployment report must include `frontend_api_base` in `checks_run`, proving the deployed Web/PWA was built with the target backend URL. The smoke also verifies backend response-time headers, short-lived backend cache headers, cursor pagination, record stats, and optional SQLite maintenance plus the safe missing-record `DELETE /api/records/{id}` route when `SMOKE_ADMIN_TOKEN` is supplied.

## Capacitor Android

There are two modes:

### Bundled web assets

```powershell
npm run build:web
npm run cap:sync
cd apps\web\android
.\gradlew.bat assembleDebug --no-daemon
```

This produces:

```text
apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

### Remote hosted frontend

For fastest iteration, deploy the frontend remotely and point the Capacitor shell at it by setting `CAP_SERVER_URL` before syncing Android:

```powershell
$env:CAP_SERVER_URL='https://your-frontend-domain.example'
npm run cap:sync
cd apps\web\android
.\gradlew.bat assembleDebug --no-daemon
```

This reduces reinstall frequency because most UI/product changes ship through the hosted web app. The PWA update prompt lets users refresh into the newest frontend bundle from inside the app. Rebuild the Android shell only when native plugins, permissions, or Capacitor config changes.

For release APKs, `CAP_SERVER_URL` should use `https://`. Public `http://` hosts are rejected by the Capacitor config to avoid accidentally shipping a cleartext remote shell. Trusted local debugging is still supported for `localhost`, `127.0.0.1`, and common private LAN ranges such as `192.168.*`, `10.*`, and `172.16.*`-`172.31.*`. If you intentionally need another cleartext host during debugging, set `CAP_ALLOW_CLEAR_TEXT=true` before `cap sync`; do not use that override for hosted production frontends.

Local notification routing is handled inside the Capacitor shell: after onboarding, the app schedules the default daily review reminder at 21:30 unless reminders are disabled; returning users restore the saved daily review reminder when the app starts. Daily review notifications open the review tab, and start-action/encouragement notifications open the matching coach scene in the chat tab. The Android manifest declares `POST_NOTIFICATIONS` for Android 13+. If notification plugin permissions, native scheduling behavior, or manifest permissions change, rebuild and reinstall the Android shell.

To return to bundled web assets, clear the variable and sync again:

```powershell
Remove-Item Env:\CAP_SERVER_URL -ErrorAction SilentlyContinue
npm run build:web
npm run cap:sync
```

The generated Android asset `capacitor.config.json` will contain `server.url` only in remote mode.

To verify remote hosted frontend mode without leaving the Android project pinned to a remote URL, run:

```powershell
npm run smoke:android:remote-assets
```

The script builds Web assets, syncs Android with a remote `CAP_SERVER_URL`, builds the debug APK, verifies the APK contains that remote URL, then clears `CAP_SERVER_URL`, syncs again, rebuilds, and verifies bundled-assets mode. To test a concrete deployed frontend:

```powershell
$env:ANDROID_REMOTE_SMOKE_REPORT='artifacts/android-remote-assets-smoke.json'
powershell -ExecutionPolicy Bypass -File scripts\smoke_capacitor_remote.ps1 -ServerUrl 'https://your-frontend-domain.example'
```

For an intentional local cleartext debug URL outside the automatically trusted private ranges, add `-AllowCleartext`.

For final release evidence, use a real deployed `https://` frontend URL. The default placeholder smoke is useful for proving the configuration path, but readiness and bundle scripts keep placeholder or unverified remote reports as supplemental evidence rather than completed `android_remote_frontend` evidence.

When `ANDROID_REMOTE_SMOKE_REPORT` is set, the remote smoke report records both the remote-mode and restored bundled-mode snapshots. A valid final report must show `server_url_is_https=true`, `server_url_is_placeholder=false`, `remote_server_config.url` equal to the deployed frontend URL, `restored_server_config.has_url=false`, `restored_server_config.android_scheme=https`, and SHA-256 summaries for both the remote-mode APK and the restored bundled APK. This makes it auditable that the shell can use remote Web assets for fast iteration and that the default bundled project was restored afterward.

The bundled Android shell can also change backend API hosts at runtime. In the app, open `我的 -> 后端连接`, enter the FastAPI base URL, then tap `保存并重连`. Tap `诊断连接` to check response latency, active model, provider configuration, and SQLite status from the installed app. This is useful when the APK is already installed but the backend moves from local LAN to a deployed host.

Local personal data lives in IndexedDB/Dexie. In the app, the `我的` page provides `导出本地数据`, `导入本地数据`, and `清理本地数据`. Importing local data replaces local records, conversations, messages, action cards, daily reviews, relationship drafts, and minimal safety events from a JSON export; it does not clear app preferences or server-side SQLite records. Clearing local data removes the same local structured data; it also leaves preferences and server-side SQLite records untouched.

## Verification

Before publishing, run the automated checks below and then complete `docs/ACCEPTANCE.md` for physical Android and deployment verification:

```powershell
npm run release:readiness
npm run build:web
npm run smoke:local-deploy
npm run lint:web
npm run test:web
$env:PYTHONPATH='services/api'
.\.venv\Scripts\python -m pytest services\api\tests
npm run smoke:api
npm run smoke:backend-deploy-config
npm run smoke:android:manifest
npm run cap:sync
cd apps\web\android
.\gradlew.bat assembleDebug --no-daemon
```

`npm run release:readiness` does not call external services by default. It audits whether local build artifacts exist, whether `artifacts/local-verify.json` is valid, and whether valid successful external evidence reports already exist for DeepSeek, deployed frontend/backend smoke, remote hosted frontend Android shell smoke, and physical Android phone smoke. If a report is missing, it also checks whether the matching environment variables or non-emulator adb device are available and prints the command to run, but it does not mark external evidence complete until the JSON report exists and passes validation. For final release gating, run it with `RELEASE_READINESS_STRICT=true` so any non-OK readiness check fails the command.

To keep a machine-readable release evidence file, set `RELEASE_READINESS_REPORT`:

```powershell
$env:RELEASE_READINESS_REPORT='artifacts/release-readiness.json'
npm run release:readiness
```

The report includes all local/external checks, their suggested commands, remaining external evidence keys, APK SHA-256/size, core Web/PWA file hashes, and `dist/assets` count/size.

After local verification, create a handoff bundle with:

```powershell
npm run release:bundle
```

It writes `artifacts/release-YYYYMMDD-HHMMSS/` with the debug APK, `release-readiness.json`, `release-manifest.json`, and valid external evidence JSON files copied into `external-evidence/`. The manifest records the APK SHA-256, copied evidence hashes, missing evidence report keys, ignored/supplemental evidence, and remaining external evidence keys, so the APK sent for phone testing can be matched to the readiness report.

`npm run smoke:api` starts a real local uvicorn process against a temporary SQLite database, then checks `/health`, `/api/diagnostics`, model-provider metadata redaction, fallback AI responses, server-side record writes, readable profile summary, per-request `serverRecordEnabled=false`, high-risk non-persistence, paged reads, export, backup/restore, bulk deletion, single-record deletion, missing-record 404, and final empty-page verification.

`npm run smoke:backend-deploy-config` verifies backend deployment scaffolding: `.env.example` files, Dockerfile runtime settings, Docker Compose persistent `/data` volume and healthcheck, Render persistent disk, `/health` health check path, secret environment placeholders, and the key deployment variables documented here.

`npm run smoke:local-deploy` starts the built `apps/web/dist` as a static site and a temporary FastAPI/SQLite backend, then reuses the deployment smoke checks for frontend HTML, PWA manifest, service worker, backend diagnostics, CORS, high-risk safety interception, admin backup/merge-restore, maintenance, and safe single-record delete-route behavior. It skips live cache-header assertions because the local development static server does not emulate Cloudflare Pages or Vercel response headers. Run `npm run build:web` first.

`npm run smoke:text-encoding` checks frontend source, backend prompt/fallback/profile-summary files, key backend tests, smoke scripts including Android smoke, core docs, `apps/web/package.json`, Vite production output, and Capacitor bundled web assets for expected Chinese text and common mojibake markers. Run it after production builds and after `cap:sync` whenever UI copy, prompt copy, docs, tests, smoke scripts, or encoding-sensitive files change.

`npm run smoke:secrets` scans the Web/PWA production output and Android APK client assets for model API key variable names, currently configured local secret values, and common `sk-...` key-like tokens. Run it after production builds and after `cap:sync` whenever environment variables or model-provider plumbing change.

`npm run smoke:android:manifest` checks the Android manifest for required Internet/notification permissions, confirms the app does not request call permission, and verifies the Web/PWA safety sheet exposes `tel:` hotline entries for `12356`, `110`, and `120`. With one USB-debugging phone connected, `npm run smoke:android` installs and launches the debug APK, checks installed package permissions, and verifies Android can resolve `ACTION_DIAL` intents for those hotline numbers. Set `ANDROID_SMOKE_REPORT=artifacts/android-smoke.json` to save the physical-device evidence with device metadata and APK SHA-256.

When a real DeepSeek key is available, run:

```powershell
$env:DEEPSEEK_API_KEY='...'
$env:DEEPSEEK_SMOKE_REPORT='artifacts/deepseek-smoke.json'
npm run smoke:deepseek
```

This verifies the real provider response can be parsed into the backend coach result schema and returns a tiny action card.
