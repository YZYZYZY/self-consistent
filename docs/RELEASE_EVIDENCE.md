# Release Evidence Runbook

Use this runbook after local verification passes and you are ready to collect the external evidence that cannot be produced without real credentials, deployed URLs, or a physical Android phone.

## 1. Local Baseline

```powershell
$env:VERIFY_LOCAL_REPORT='artifacts/local-verify.json'
npm run verify:local
$env:RELEASE_READINESS_REPORT='artifacts/release-readiness.json'
npm run release:readiness
```

`VERIFY_LOCAL_REPORT` writes a machine-readable local verification artifact covering lint, tests, local smokes, PWA build, frontend API base verification, Capacitor sync, Android build, APK asset smoke, and any skipped external checks. The readiness report lists local artifacts and remaining external checks. Final release mode should use:

```powershell
$env:RELEASE_READINESS_STRICT='true'
$env:RELEASE_READINESS_REPORT='artifacts/release-readiness-final.json'
npm run release:readiness
```

## 2. Real DeepSeek Evidence

```powershell
$env:DEEPSEEK_API_KEY='...'
$env:DEEPSEEK_SMOKE_REPORT='artifacts/deepseek-smoke.json'
npm run smoke:deepseek
```

Expected artifact:

- `artifacts/deepseek-smoke.json`
- `status` is `ok`
- `provider` is `deepseek`
- `api_key_recorded` is `false`
- `action_card.estimated_minutes` is less than or equal to 3

## 3. Deployed Frontend/Backend Evidence

You can run the remaining external checks as one evidence collection pass after setting the deployed URLs:

```powershell
$env:SMOKE_FRONTEND_URL='https://your-frontend.example'
$env:SMOKE_BACKEND_URL='https://your-api.example'
$env:OFFICIAL_URLS_REPORT='artifacts/official-urls.json'
npm run release:official-urls
npm run smoke:official-urls
$env:EXTERNAL_EVIDENCE_REPORT='artifacts/external-evidence-collection.json'
npm run release:collect-external
npm run smoke:external-evidence
```

Use plan mode first to see what will run and what is still missing:

```powershell
npm run release:collect-external -- -PlanOnly
npm run release:official-urls -- -PlanOnly -FrontendUrl 'https://your-frontend.example' -BackendUrl 'https://your-api.example'
```

`release:official-urls` is the explicit handoff from temporary/local URLs to hosted release URLs. It builds `apps/web/dist` with `VITE_API_BASE_URL=$env:SMOKE_BACKEND_URL`, runs `smoke:frontend-api-base`, runs deployed frontend/backend smoke unless `-SkipDeploySmoke` is passed, syncs Capacitor with `CAP_SERVER_URL=$env:SMOKE_FRONTEND_URL`, builds the debug APK unless `-SkipAndroidBuild` is passed, verifies the APK in remote mode, and writes `artifacts/official-urls.json`. By default it leaves the generated Android project pinned to the official frontend URL; pass `-RestoreBundled` only when preparing a bundled-assets APK instead of the remote hosted frontend shell. `smoke:official-urls` validates that report structure, release URLs, Vite backend URL, Capacitor frontend URL, step statuses, and final APK metadata are self-consistent.

The collector writes a machine-readable report and runs whichever checks have enough external prerequisites: frontend API base, deployed frontend/backend smoke, remote Android frontend smoke, physical Android phone smoke, and release readiness. It also writes `artifacts/release-readiness-external.json` and copies that summary into the collector report. It does not weaken readiness rules; missing URLs, a missing non-emulator physical phone, or any remaining readiness blocker keep the collection status `partial` rather than `ok`. Run `npm run smoke:external-evidence` after collection to verify the collector JSON status, required steps, and final readiness summary are self-consistent.

Before uploading the frontend bundle, build it with the deployed backend URL and verify the static assets:

```powershell
$env:VITE_API_BASE_URL='https://your-api.example'
npm run build:web
$env:EXPECTED_FRONTEND_API_BASE=$env:VITE_API_BASE_URL
npm run smoke:frontend-api-base
```

Expected local pre-deploy check:

- `apps/web/dist` exists
- the built JavaScript assets contain the deployed backend URL
- hosted builds do not keep the `http://localhost:8000` API fallback

```powershell
$env:SMOKE_FRONTEND_URL='https://your-frontend.example'
$env:SMOKE_BACKEND_URL='https://your-api.example'
$env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'
npm run smoke:deploy
```

Optional checks:

```powershell
$env:SMOKE_DEPLOY_AI='true'
$env:SMOKE_ADMIN_TOKEN='...'
npm run smoke:deploy
```

Expected artifact:

- `artifacts/deploy-smoke.json`
- `status` is `ok`
- frontend/backend URLs are recorded
- `checks_run` includes frontend, frontend API base verification, backend, CORS, safety intercept, record stats, cursor pagination, and readable backend profile summary
- if `SMOKE_DEPLOY_AI=true`, `checks_run` includes `ai_action`
- if `SMOKE_ADMIN_TOKEN` is set, `checks_run` includes `admin_backup_restore`, `admin_maintenance`, and `admin_single_record_delete_route`

## 4. Physical Android Phone Evidence

Connect exactly one USB-debugging physical Android phone. If multiple devices are connected, set `ANDROID_SERIAL`.

```powershell
$env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'
npm run smoke:android
```

Expected artifact:

- `artifacts/android-smoke.json`
- `status` is `ok`
- `manifest_only` is `false`
- device serial/model are recorded and `device.is_emulator` is `false`
- `apk` includes path, size, and SHA-256
- checks include APK install, foreground launch, installed permission verification, safety `tel:` link verification, and `ACTION_DIAL` intent resolution for `12356`, `110`, and `120`
- installed permissions include Internet and notification support, and do not include call permission

An emulator run of `npm run smoke:android` is useful for local confidence, but it is not accepted as this physical-phone evidence. If `artifacts/android-smoke.json` contains `device.is_emulator=true` or an emulator-like serial such as `emulator-*`, `npm run release:bundle` copies it only as supplemental emulator evidence and keeps `android_device` in the missing external evidence list.

## 5. Remote Android Frontend Evidence

Use the deployed frontend URL to prove the Android shell can point at remote Web assets for faster iteration.

```powershell
$env:ANDROID_REMOTE_SMOKE_REPORT='artifacts/android-remote-assets-smoke.json'
powershell -ExecutionPolicy Bypass -File scripts\smoke_capacitor_remote.ps1 -ServerUrl $env:SMOKE_FRONTEND_URL
```

After this smoke, restore bundled mode if preparing a bundled debug APK:

```powershell
Remove-Item Env:\CAP_SERVER_URL -ErrorAction SilentlyContinue
npm run cap:sync
npm run smoke:apk
```

Expected artifact:

- `artifacts/android-remote-assets-smoke.json`
- `status` is `ok`
- `server_url` is the real deployed `https://` frontend URL
- `server_url_host` is the deployed frontend host, `server_url_is_https` is `true`, and `server_url_is_placeholder` is `false`
- `restored_bundled_mode` is `true`
- `remote_server_config.url` matches `server_url` and `remote_server_config.has_url` is `true`
- `restored_server_config.has_url` is `false` and `restored_server_config.android_scheme` is `https`
- `remote_apk` and `restored_apk` include path, size, and SHA-256 so the remote-mode APK and restored bundled APK can be audited separately
- checks include remote APK asset verification and bundled-mode restoration

The default placeholder URL `https://example.micro-action-coach.test` is acceptable only for local configuration confidence. Readiness and bundle scripts do not accept placeholder, non-HTTPS, old-format reports without explicit URL evidence fields, missing server snapshot, missing APK hash, or un-restored remote reports as final `android_remote_frontend` evidence; `npm run release:bundle` copies them only as supplemental unverified evidence and keeps the remote hosted frontend check missing.

## 6. Final Bundle

```powershell
npm run release:bundle
$env:RELEASE_BUNDLE_SMOKE_REPORT='artifacts/release-bundle-smoke.json'
npm run smoke:release-bundle
```

The bundle includes the APK, a readiness JSON report, a manifest with artifact hashes, a valid `local-verify.json` copied into `local-evidence/` when present, and valid external evidence reports copied into `external-evidence/`. If `artifacts/external-evidence-collection.json` exists, the bundle keeps it as supplemental collection evidence and `smoke:release-bundle` validates its status/readiness summary consistency. The manifest also lists missing, ignored, and supplemental evidence report keys so a partial handoff is explicit. `smoke:release-bundle` re-checks the latest bundle by default; set `RELEASE_BUNDLE_DIR` to inspect a specific bundle.
