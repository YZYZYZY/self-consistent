# Acceptance Checklist

Use this checklist before calling the Web/PWA + Capacitor Android + FastAPI version complete.

## Automated Evidence

Run from the repository root:

```powershell
$env:VERIFY_LOCAL_REPORT='artifacts/local-verify.json'
npm run verify:local
npm run release:readiness
```

`verify:local` runs the local gates in a fixed safe order. Set `VERIFY_LOCAL_REPORT` to write a JSON artifact for the release bundle. It also runs `smoke:deepseek` when `DEEPSEEK_API_KEY` is set and `smoke:deploy` when both `SMOKE_FRONTEND_URL` and `SMOKE_BACKEND_URL` are set.

`release:readiness` summarizes which local/external release evidence is already present and which external checks remain. It now includes the local verification report when `artifacts/local-verify.json` exists and passes validation. External checks are marked complete only when the matching valid JSON evidence report exists; environment variables or connected devices only make the suggested command easier to run. For a final blocking release audit, set `RELEASE_READINESS_STRICT=true`; strict mode fails on any non-OK readiness check, including local artifacts, local verification, warnings, and missing external evidence.

For the external evidence sequence with JSON report paths, use `docs/RELEASE_EVIDENCE.md`.

For an auditable JSON artifact, set `RELEASE_READINESS_REPORT` before running readiness:

```powershell
$env:RELEASE_READINESS_REPORT='artifacts/release-readiness.json'
npm run release:readiness
```

After local verification, create a handoff bundle:

```powershell
npm run release:bundle
$env:RELEASE_BUNDLE_SMOKE_REPORT='artifacts/release-bundle-smoke.json'
npm run smoke:release-bundle
```

For external evidence collection after real frontend/backend URLs and a physical Android phone are available:

```powershell
$env:SMOKE_FRONTEND_URL='https://your-frontend.example'
$env:SMOKE_BACKEND_URL='https://your-api.example'
$env:EXTERNAL_EVIDENCE_REPORT='artifacts/external-evidence-collection.json'
npm run release:collect-external
```

`npm run release:collect-external -- -PlanOnly` prints the same sequence without running external checks.

Equivalent manual sequence:

```powershell
npm run lint:web
npm run test:web
npm run test:api
npm run smoke:api
npm run smoke:backend-deploy-config
npm run smoke:static-config
npm run build:web
npm run smoke:frontend-api-base
npm run smoke:pwa-config
npm run smoke:text-encoding
npm run smoke:secrets
npm run smoke:local-deploy
npm run smoke:android:manifest
npm run cap:sync
cd apps\web\android
.\gradlew.bat assembleDebug --no-daemon
cd ..\..\..
npm run smoke:apk
```

Expected evidence:

- Web lint passes.
- Web tests pass.
- FastAPI tests pass.
- FastAPI tests verify default prompts and local fallbacks are readable UTF-8 Chinese rather than mojibake, and include scene-specific JSON instructions.
- FastAPI tests include concurrent SQLite write serialization so simultaneous server-record writes do not drop records.
- `npm run smoke:api` passes against a real local uvicorn process and temporary SQLite database, including readable profile summary, server-record restore, single-record delete, missing-record 404, and final empty-page verification.
- `npm run smoke:backend-deploy-config` verifies `.env.example` files, Dockerfile, Docker Compose, Render persistent SQLite disk, health checks, secret env placeholders, and deployment-document variable consistency.
- `npm run smoke:static-config` verifies Cloudflare Pages and Vercel cache headers keep HTML/service worker/manifest revalidating while hashed assets are immutable.
- `npm run smoke:frontend-api-base` verifies the built Web/PWA `dist` bundle contains the expected API base URL; local verification defaults this to `http://localhost:8000`, while hosted deployment should set `EXPECTED_FRONTEND_API_BASE` or `SMOKE_BACKEND_URL`.
- `npm run smoke:pwa-config` verifies Vite PWA prompt-update mode, standalone manifest, maskable icons, SPA fallback, service worker precache/navigation fallback, and vendor chunk split configuration.
- `npm run smoke:text-encoding` verifies frontend source, backend prompt/fallback/profile-summary files, key backend tests, smoke scripts, core docs, `apps/web/package.json`, Vite output, and Capacitor bundled assets contain normal Chinese text without common mojibake markers.
- `npm run smoke:secrets` scans Web/PWA production output and APK client assets for model API key variable names, known local secret values, and common `sk-...` key-like tokens.
- `npm run smoke:local-deploy` passes against built static frontend assets plus a temporary FastAPI/SQLite backend, including CORS, admin backup/restore, maintenance, and safe single-record delete-route checks.
- `npm run smoke:android:manifest` verifies Android manifest permissions without requiring a connected phone.
- `npm run smoke:android:manifest` also verifies the Web/PWA safety support source exposes `tel:` entries for `12356`, `110`, and `120`.
- `npm run smoke:apk` verifies the built APK contains Capacitor config, the required plugins, PWA manifest, service worker, index HTML, and referenced JS/CSS assets.
- `npm run smoke:android:remote-assets` verifies remote hosted frontend mode writes `CAP_SERVER_URL` into the debug APK, records `server_url_host`, `server_url_is_https`, and `server_url_is_placeholder`, then restores bundled-assets mode. This local smoke has passed with the placeholder URL `https://example.micro-action-coach.test`; rerun it with a real deployed frontend URL before release.
- Remote hosted frontend release mode uses `https://` for `CAP_SERVER_URL`; public `http://` hosts are rejected unless `CAP_ALLOW_CLEAR_TEXT=true` is intentionally set for trusted local debugging.
- `npm run smoke:deepseek` passes when `DEEPSEEK_API_KEY` is available; this is the required real-provider evidence for DeepSeek beyond mocked payload tests.
- `npm run smoke:deploy` passes when `SMOKE_FRONTEND_URL` and `SMOKE_BACKEND_URL` point to the deployed frontend/backend, including live cache-header checks for hosted HTML, manifest, service worker, and one referenced hashed JS/CSS asset.
- The deployed frontend smoke verifies the hosted JavaScript bundle contains `SMOKE_BACKEND_URL` as the configured API base and does not keep the localhost API fallback for hosted backends.
- `npm run smoke:frontend-api-base` can be run immediately after `npm run build:web` and before upload to prove the static `dist` bundle already contains the target backend URL.
- Vite production build succeeds and generates PWA assets.
- Capacitor sync succeeds.
- Android debug APK builds at `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.
- `npm run verify:local` completes without running `cap:sync` and Gradle in parallel, includes the frontend API base smoke after the Web/PWA build, and includes the local deployment smoke after the Web/PWA build.
- `npm run release:readiness` reports current local artifacts, the local verification report, plus the external release checks: real DeepSeek, deployed smoke, remote hosted frontend Android shell smoke, and physical Android phone smoke.
- `RELEASE_READINESS_REPORT` writes a JSON artifact containing every readiness check, suggested command, remaining external evidence key, APK SHA-256/size, local verification report hash, and Web/PWA production artifact summary.
- `npm run release:bundle` writes `artifacts/release-*/` containing the debug APK, readiness JSON, manifest, valid local verification evidence under `local-evidence/`, and valid external evidence reports under `external-evidence/`; invalid DeepSeek/deployment reports, emulator Android reports, and placeholder/unverified remote-frontend reports are copied only as `supplemental_evidence`, not as completed external evidence.
- `npm run smoke:release-bundle` verifies the latest bundle manifest, file hashes, APK, readiness report, local verification evidence, valid DeepSeek evidence, supplemental evidence, and explicit remaining external blockers.
- `npm run release:collect-external` orchestrates the external evidence reports without changing their acceptance criteria; missing deployed URLs or missing non-emulator physical devices are recorded as partial/skipped evidence.

## Backend API

Verify on the target backend host:

- `GET /health` returns `status=ok`, active provider, model, active provider configuration status, and configured provider count.
- `GET /readyz` returns `status=ok` only when SQLite is reachable and schema version matches the backend expectation, without exposing API keys or database paths.
- `GET /api/diagnostics` returns SQLite connectivity, schema version, WAL mode, busy timeout, foreign keys, page counts, server record status, and deployment preflight checks without API keys or absolute database paths.
- `GET /api/models/providers` shows provider status without exposing API keys.
- `GET /api/models/config` returns the active runtime provider and model.
- `PUT /api/models/config` can switch provider/model when `ADMIN_TOKEN` is configured and `X-Admin-Token` is supplied.
- `GET /api/prompts` returns all prompt keys.
- `PUT /api/prompts/{key}` updates prompts when authorized.
- Default backend prompts contain readable Chinese JSON-output rules for procrastination, encouragement, creation, relationship, and daily review scenes.
- `POST /api/ai/action` returns a 3-minute-or-less action card or local fallback.
- `POST /api/ai/review` returns a daily review summary or local fallback.
- `POST /api/ai/chat` supports encouragement and creation scenes.
- `POST /api/ai/relationship` returns gentle/direct/boundary scripts.
- `POST /api/ai/*` with high-risk input returns safety support content, does not send ordinary productivity advice, and does not save the original text.
- `POST /api/ai/*` sanitizes request context before model proxying, strips selected conversation/profile fields when profile or history context is disabled, and blocks high-risk content found inside context before cloud model calls.
- Requests containing `context.historyEnabled=false` or `context.serverRecordEnabled=false` do not write server-side SQLite records.
- `GET /api/records/page` returns `records`, `total_records`, `limit`, `offset`, `next_offset`, and `has_more`.
- `GET /api/records/export` exports the current server-side record set, with admin token when configured.
- `GET /api/admin/backup` exports a full server backup containing all records, stats, prompt overrides, and runtime model config, with admin token when configured.
- `POST /api/admin/restore` imports a full server backup in `merge` or `replace` mode, with admin token when configured.
- `POST /api/admin/maintenance` runs SQLite optimize and WAL checkpoint maintenance, with admin token when configured.
- `DELETE /api/records/{id}` deletes one server-side AI record and returns 404 for missing ids, with admin token when configured.
- `DELETE /api/records` clears server-side AI records, with admin token when configured.

## Web/PWA

Verify in a desktop browser and mobile browser:

- First launch shows onboarding with product boundary, local storage default, and AI context disclosure.
- Home shows five scene cards.
- Home shows the "今日闭环" card, connecting the latest action, feedback status, today's review, and tomorrow's next step when local data exists.
- "我的 -> 画像摘要" shows local record count, action completion rate, review streak, recent patterns, and a next micro-action recommendation.
- Procrastination flow: enter task, choose reason, generate action, mark completed, and choose simpler version after "I did not do it".
- No configured model key shows a model setup notice and uses local fallback without calling AI endpoints.
- Daily review flow generates a summary, allows editing, saves, and appears in history.
- Encouragement, creation, and relationship scenes accept input and return appropriate coach output.
- Encouragement phrases saved from the encouragement coach appear in "我的 -> 鼓励短句" and can be cleared.
- Encouragement and creation action cards can be marked as "I did a little" or changed to a lighter version, updating the local action task status.
- "我的 -> 行动卡历史" shows recent local action cards, their status, steps, result note, and supports marking one action card completed, changing it to a lighter version, or deleting it.
- Safety support sheet shows trusted-contact suggestion, `12356`, `110`, and `120` dialing entries.
- High-risk input opens safety support and does not show ordinary productivity advice.
- High-risk detection covers common Chinese and English self-harm/other-harm phrasing, including "撑不下去", "不想继续活", "I want to die", and "hurt someone".
- Urgent Level 4 high-risk input keeps `risk_level=4` through the backend safety response instead of being downgraded to Level 3.
- "我的 -> 后端连接" can change API Base URL and run diagnostics.
- "我的 -> 模型代理" shows provider status and can update runtime provider/model when authorized.
- "我的 -> 提示词管理" can update prompts when authorized.
- "我的 -> 服务端记录" toggles per-request server-side persistence.
- "我的 -> 服务端数据" shows stats, pagination, scene filter, single-record delete, record export, full server backup export/import, database maintenance, and clear actions.
- Local export downloads JSON containing local records, conversations, actions, reviews, relationship drafts, and minimal safety events.
- Local import can restore an exported JSON by replacing local records, conversations, messages, actions, reviews, relationship drafts, and safety events without changing preferences or server-side records.
- Local clear removes local records without clearing preferences or server-side records.
- PWA update prompt appears after a new service worker version is available.
- Offline-ready prompt appears after assets are cached.
- Generated service worker precaches the app shell and uses an `index.html` navigation fallback for deep links.

## Capacitor Android

Verify on an Android phone:

- Run `npm run smoke:android` with one USB-debugging Android device connected; it installs the debug APK, launches the app, confirms the package becomes foreground, and checks installed permissions.
- The physical Android smoke also verifies the safety hotline `tel:` entries and confirms Android can resolve `ACTION_DIAL` intents for `12356`, `110`, and `120`.
- Emulator smoke evidence is useful but does not replace final physical-phone verification.
- Debug APK installs and launches.
- App can run in bundled web assets mode.
- `npm run smoke:apk` passes after `assembleDebug`, proving the APK contains bundled PWA assets and does not pin a remote `server.url` by default.
- App can run in remote hosted frontend mode when built after `CAP_SERVER_URL` is set.
- `npm run smoke:android:remote-assets` verifies the APK pins the expected remote frontend URL and then restores bundled mode; set `-ServerUrl` on the underlying PowerShell script to test a concrete deployed frontend URL. The placeholder remote-mode smoke has passed locally and proves the shell configuration path works.
- Placeholder remote-mode smoke reports, including the default `https://example.micro-action-coach.test` URL, are useful local configuration checks but do not count as final remote hosted frontend release evidence.
- Remote hosted frontend release APK uses an HTTPS `CAP_SERVER_URL`; local cleartext debugging is limited to localhost/private LAN ranges or an explicit `CAP_ALLOW_CLEAR_TEXT=true` override.
- Remote hosted frontend mode can receive frontend updates without reinstalling the APK.
- Android 13+ notification permission prompt appears when scheduling notifications.
- First onboarding completion schedules the default daily review reminder at `21:30` unless reminders are disabled.
- Returning users restore the saved daily review reminder when the app starts.
- Daily review notification tap opens the review tab.
- Start-action notification tap opens the procrastination coach.
- Encouragement notification tap opens the encouragement coach.
- Network status pill reflects online/offline state.
- Runtime backend URL change works from the installed app.
- `ACTION_DIAL` opens for `12356`, `110`, and `120`; the app does not request call permission.

## Privacy And Safety

Verify with generated records and exports:

- Phone numbers and emails are redacted before cloud AI requests and before server-side record storage.
- Turning off local history prevents saving local message/review history.
- Turning off server-side records prevents FastAPI/SQLite writes while still allowing AI calls.
- Turning off profile context prevents selected conversation `conversationId` and `recentMessages` from being sent with new AI requests.
- The backend repeats the same protection for older or malicious clients by removing history/profile context and redacting nested phone/email/address strings before building model prompts.
- High-risk input is intercepted before cloud model calls.
- High-risk text inside request context is also intercepted before cloud model calls.
- High-risk original text is not saved locally or server-side.
- Local high-risk events store only scene, risk level, and timestamp; they do not write a normal local record, conversation message, action card, review, or original text.
- Level 3/4 distinction is preserved for high-risk safety responses.
- Level 4 safety responses use stronger urgent wording for concrete plan/tool/place signals while still showing `110`, `120`, and `12356`.
- Provider API keys never appear in frontend storage, app UI, diagnostics, provider status, local export, or server export.
- Production Web/PWA output and Android APK client assets pass `npm run smoke:secrets`, including checks against any currently configured local secret environment values.

## Real Model Provider

Verify with a valid DeepSeek API key:

```powershell
$env:DEEPSEEK_API_KEY='...'
$env:DEEPSEEK_SMOKE_REPORT='artifacts/deepseek-smoke.json'
npm run smoke:deepseek
```

Expected evidence:

- The real DeepSeek endpoint returns parseable JSON through the backend provider adapter.
- The result is low risk for a normal productivity input.
- The result includes a non-empty reply and an action card at or under 3 minutes.
- The smoke request uses `server_record_enabled=False` and temporary SQLite storage.

## Deployment

Verify deployment-specific behavior:

- Scripted deployment smoke:

```powershell
$env:SMOKE_FRONTEND_URL='https://your-frontend.example'
$env:SMOKE_BACKEND_URL='https://your-backend.example'
$env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'
npm run smoke:deploy
```

Optional deployed AI endpoint check:

```powershell
$env:SMOKE_DEPLOY_AI='true'
npm run smoke:deploy
```

If the backend requires `ADMIN_TOKEN` for full backup checks:

```powershell
$env:SMOKE_ADMIN_TOKEN='...'
npm run smoke:deploy
```

For a machine-readable deployed evidence file:

```powershell
$env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'
npm run smoke:deploy
```

- Backend deploy has `CORS_ORIGINS` set to the hosted frontend origin.
- Frontend deploy has `VITE_API_BASE_URL` set to the backend origin.
- Backend persistent SQLite path or volume is configured for VPS/Docker/Render/Railway/Fly.io; Render uses a persistent disk mounted at `/data` and `DATABASE_URL=sqlite:////data/micro_action_coach.db`.
- Frontend SPA fallback works on deep refresh.
- PWA cache headers are applied.
- `GET /api/diagnostics` from the deployed frontend succeeds.
- `npm run smoke:deploy` verifies hosted frontend HTML, PWA manifest, service worker, live PWA cache headers, immutable hashed asset cache headers, frontend API base configuration, backend health, short-lived backend cache headers, response-time headers, diagnostics, deployment preflight checks, provider registry, records page metadata, cursor pagination, record stats, readable profile summary, CORS preflight, high-risk safety interception, and optional admin full-backup export/merge-restore plus SQLite maintenance and safe single-record delete-route checks.
- `SMOKE_DEPLOY_REPORT` writes a JSON artifact with frontend/backend URLs, optional AI/admin check flags, checks run, timestamp, and final status.
- `DEEPSEEK_SMOKE_REPORT` writes a JSON artifact proving a real DeepSeek action-card response without recording the API key.
- `ANDROID_SMOKE_REPORT` writes a JSON artifact containing device model/serial, explicit `device.is_emulator`, APK metadata, foreground-launch check, and permission checks. Release readiness and bundle scripts count it as physical-phone evidence only when `device.is_emulator=false` and the serial is not emulator-like.
- The physical Android report must include APK SHA-256, `safety_tel_links`, `dial_intent_resolvable`, and no `CALL_PHONE` permission before release readiness and bundle scripts count it as completed phone evidence.
- `ANDROID_REMOTE_SMOKE_REPORT` writes a JSON artifact proving the Android shell can pin the deployed frontend URL, verify remote-mode APK assets, and restore bundled-assets mode.
- Release readiness and bundle scripts count `ANDROID_REMOTE_SMOKE_REPORT` as remote hosted frontend evidence only when it explicitly records `server_url_is_https=true`, `server_url_is_placeholder=false`, uses a real deployed `https://` frontend URL, records `remote_server_config.url` matching that URL, records restored bundled mode with no `server.url`, and includes SHA-256 summaries for both the remote-mode APK and restored bundled APK; placeholder, non-HTTPS, old-format, or incomplete reports remain supplemental.
- Android shell can point to the deployed frontend with `CAP_SERVER_URL`.
- Android app can change backend API host at runtime after installation.

## Current Known Non-Completion Items

- Full physical Android phone verification is still required; emulator install/launch smoke has passed locally.
- Deployed frontend/backend smoke verification is still required.
- Remote hosted frontend Android shell smoke with a real deployed frontend URL is still required.
- Real DeepSeek provider smoke has passed when `artifacts/deepseek-smoke.json` is present and `status=ok`; rerun it if the provider key/model changes.
