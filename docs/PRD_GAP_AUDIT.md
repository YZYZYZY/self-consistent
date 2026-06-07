# PRD Gap Audit

This audit compares the current Web/PWA + Capacitor Android shell + FastAPI implementation against the Android personal-version PRD dated 2026-06-01.

The architecture intentionally differs from the original native Android recommendation. The project now uses a hosted Web/PWA frontend wrapped by Capacitor plus a FastAPI backend because the current product constraint is Android usability, fast iteration, fewer APK reinstalls, and keeping model API keys out of the client.

## Completion Snapshot

- Local MVP loop: partially complete, about 93-95%.
- Full PRD v1 scope: partially complete, about 82-87%.
- Release-ready evidence: incomplete until deployed frontend/backend, remote hosted frontend Android shell, and physical Android phone smokes pass. Current local verification and release bundle evidence has been refreshed; real DeepSeek smoke evidence has been collected.

## PRD 31 Minimal Usable Version

| Requirement | Status | Evidence / Gap |
| --- | --- | --- |
| Procrastination emergency | Partial | Task input, explicit reason selection, 3-minute action card generation, complete/missed/simplify feedback, local fallback, local records, and automated UI tests for completed/missed/high-risk paths exist. Needs stronger manual/physical Android acceptance evidence. |
| Daily review | Partial | Review form, AI/local summary, direct local-template save without calling AI, edit/save/update, emotion weather, streak, history search/filter/detail/delete, high-risk non-persistence, and notification route exist. Automated UI tests cover direct local save, local fallback save, history edit, and high-risk safety storage. Needs physical notification evidence. |
| Local records | Done | IndexedDB/Dexie stores records, conversations, messages, action tasks, daily reviews, creation switch-back plans, encouragement phrase history, relationship expression drafts, and minimal high-risk safety events. Conversation history list/detail/delete, action-card history/feedback/delete, review delete, creation-plan save/complete/delete, encouragement phrase save/reuse/delete, relationship draft delete, filtered single-record local deletion, local export, and local import/replace restore exist. |
| Closed loop: task -> action -> result -> review -> next day | Partial | Core data flow, surfaced history/detail, action-card history/detail/complete/simplify/delete, creation-plan reuse, encouragement phrase reuse, the Home "今日闭环" card, and the Mine profile action advice now connect latest action, feedback status, today's review, tomorrow's next step, action completion rate, review streak, saved creation plans, saved encouragement phrases, and a next micro-action. Needs final real-device smoke. |

## PRD 25 First-Version Must-Haves

| Requirement | Status | Evidence / Gap |
| --- | --- | --- |
| Splash/start entry | Done | Capacitor native splash assets exist, and Web/PWA now shows a session-level branded launch layer with positioning, privacy boundary, and Android/PWA iteration copy. |
| First onboarding | Done | Multi-step product boundary, privacy/AI-context disclosure, main challenge, encouragement style, and review reminder initialization exist. |
| Home page | Done | Four tabs, five scene cards, recent counts, and the "今日闭环" status card exist. |
| Unified AI chat page | Partial | Unified scene routing plus conversation history list/detail/search/filter/delete/new conversation exist. History search covers title, scene, and message content. Selecting a history item continues the same local conversation, shows message count/detail, sends recent message context when profile/history context is enabled, and clears selected context after delete/new conversation. |
| Procrastination emergency | Partial | Guided task -> reason -> 3-minute action -> complete/missed/simplify flow exists, including non-punitive "missed" difficulty reduction and automated UI tests for completed/missed outcomes. Needs final manual/physical Android acceptance evidence. |
| Encouragement coach | Partial | Scene exists with AI/local fallback, style context, quick scenario options, evidence field, desired phrase field, saved encouragement phrase, local encouragement phrase library with reuse/delete, "我的" page phrase display/clear/history management, readable backend prompt/fallback rules, local action feedback for completed/lighter-version outcomes, and UI tests for structured fields, phrase persistence/reuse/delete, and conversation continuation. Needs final manual acceptance evidence. |
| Creation motivation | Partial | Scene exists with AI/local fallback, quick switching targets, scrolling/idle duration, energy-level structured fields, saved local switch-back plans with complete/delete history, readable backend prompt/fallback rules, local action feedback for completed/lighter-version outcomes, and UI tests for structured model input, switch-back plan persistence, and lighter-version action-card persistence. Needs final manual acceptance evidence. |
| Relationship analysis | Partial | Scene exists with privacy warning, quick focus options, fact/guess/emotion/need fields, gentle/direct/boundary scripts, saved local expression drafts, draft history/delete, relationship cool-down reminder, readable backend prompt/fallback rules, and UI tests for structured model input, draft save/delete, and cool-down reminder scheduling. Needs final manual acceptance evidence. |
| Daily review | Partial | Review form, editable summary, emotion weather, streak, history search/filter/detail/edit/delete, direct local-template save, local fallback save, and high-risk non-persistence exist. |
| Local database | Done | Dexie local DB plus FastAPI SQLite server DB are implemented, including paged server reads, stats, backup/restore, maintenance, bulk clear, and single-record server deletion. |
| Unified model proxy | Done | FastAPI exposes `/api/ai/chat`, `/api/ai/review`, `/api/ai/action`, and `/api/ai/relationship`; the provider catalog covers DeepSeek, OpenAI, Qwen, Moonshot, Zhipu, Claude gateway, Gemini gateway, and custom OpenAI-compatible providers without exposing API keys. |
| Local notifications | Partial | Daily review/start/encouragement/relationship cool-down notification scheduling and routing exist. Needs physical Android verification. |
| Settings page | Partial | API base, reminders, privacy toggles, profile toggle, onboarding preferences, saved encouragement phrase display/clear, encouragement phrase library reuse/delete, action-card history/complete/simplify/delete, creation-plan history/complete/delete, theme, font density, about/disclaimer, local record management, provider/prompt/server records, service-record single delete, local export/import/clear, actionable local profile summary that includes saved creation plans and encouragement phrases, and readable server profile-summary text covered by API tests, local API smoke, deploy-smoke, and expanded text-encoding tests for backend tests/smoke scripts exist. |
| API Key setting | Adapted | Key is intentionally backend-only. UI shows provider status and runtime provider/model management. This should remain the chosen architecture. |
| Data clear | Done | Local clear, single server-record delete, and server clear exist, with separate scopes. |
| Basic risk recognition | Partial | Local/backend high-risk interception, address/email/phone redaction, expanded Chinese/English self-harm and other-harm wording, Level 3/4 urgency preservation with stronger Level 4 safety response copy, frontend all five scenes storing only minimal local risk events without original text, backend all AI endpoints returning safety response without model call or server record, and tests exist. Needs human clinical-language review and manual verification. |

## PRD 29 Acceptance

| Area | Status | Evidence / Gap |
| --- | --- | --- |
| Basic acceptance | Partial | Web/PWA and APK build locally; latest bundle `artifacts/release-20260605-055234` includes refreshed local verification evidence, valid DeepSeek evidence, and APK SHA-256 `c3c5b62b1ab4846985cf080f19161bc582c82af129c96d1c9f721421977461b9`. Emulator Android smoke reports now explicitly record `device.is_emulator=true` and remain supplemental only; physical Android install/launch remains external. |
| Chat acceptance | Partial | AI/local replies, save path, visible history detail, title/message search, scene filter, message counts, new conversation reset, delete with selected-context clearing, and selected-conversation continuation exist. Needs final manual acceptance. |
| Procrastination acceptance | Partial | Reason-gated 3-minute action, completed feedback, missed-action difficulty reduction, and simpler fallback exist and are covered by frontend tests. Needs final manual/physical Android acceptance. |
| Daily review acceptance | Partial | Save/history/local fallback/high-risk non-persistence/notification routing exist. Needs physical notification tap evidence. |
| Privacy acceptance | Partial | Local history toggle, server record toggle, profile toggle, profile-disabled requests omitting selected conversation history context, backend context sanitization for older/malicious clients, address/email/phone redaction, high-risk events storing only scene/risk level/timestamp, single-record delete, clear/export, and backend-only API key wording exist. Needs manual acceptance. |
| Safety acceptance | Partial | High-risk flow, expanded Chinese/English risk wording, Level 3/4 handling, stronger Level 4 urgent copy, safety sheet, high-risk UI tests across procrastination/daily review/encouragement/creation/relationship scenes, and backend endpoint high-risk tests exist. Needs final manual verification. |

## External Evidence Still Required

- Deployed frontend/backend smoke: set `SMOKE_FRONTEND_URL`, `SMOKE_BACKEND_URL`, `SMOKE_DEPLOY_REPORT`, then run `npm run smoke:deploy`. The report must include `frontend_api_base`, proving the hosted frontend bundle points at the deployed backend instead of localhost.
- Physical Android phone smoke: connect one USB-debugging phone, set `ANDROID_SMOKE_REPORT`, then run `npm run smoke:android`. The report must include APK SHA-256, install/foreground/permission checks, safety `tel:` link checks, and `ACTION_DIAL` resolution for `12356`, `110`, and `120`.
- Remote hosted frontend Android smoke with the real frontend URL: set `ANDROID_REMOTE_SMOKE_REPORT`, then run `scripts\smoke_capacitor_remote.ps1 -ServerUrl $env:SMOKE_FRONTEND_URL`. The report must include explicit URL evidence fields (`server_url_host`, `server_url_is_https=true`, `server_url_is_placeholder=false`), the remote server URL snapshot, restored bundled-mode snapshot, and SHA-256 summaries for both APK builds.
- See `docs/RELEASE_EVIDENCE.md` for the exact external-evidence command sequence and expected JSON artifacts.

Completed external evidence:

- Real DeepSeek provider smoke passed with `artifacts/deepseek-smoke.json`; the report records `api_key_recorded=false` and a 1-minute action card.

## Next Implementation Priorities

1. Finish external evidence: deployed frontend/backend smoke report, physical Android phone smoke report, and remote Android frontend smoke.
2. Use the external evidence pass as the final manual acceptance sweep for remaining UI wording or Android-only interaction issues.
