# System Flow & Architecture 📘

## 🔎 Purpose
This document is the canonical flow/architecture guide for the Farmer Survey Analytics platform. It contains:
- Component responsibilities and directory mapping
- Data model with collections and key fields
- End-to-end runtime sequences (onboarding, answering, audio handling, analytics)
- Diagrams (Mermaid) suitable for conversion to PNG/SVG
- Operational notes and troubleshooting tips

---

## 🧩 Top-level components (map to code)
- WhatsApp (Meta Cloud / Business API) — inbound webhooks, outbound messages
- Backend: Express server (./backend/src)
  - Routes: `routes/*.js` (whatsappRoutes.js, analyticsRoutes.js, qcRoutes.js, aiRoutes.js)
  - Controllers: `controllers/*Controller.js`
  - Services: `services/*` (surveyEngine.js, audioService.js, analyticsService.js, aiChatService.js)
  - Config: `config/mongoConfig.js` (Mongo connection)
- Frontend: Vite + React (./frontend/src)
  - Pages / Components: `components/*` (AnalyticsDashboard, FarmerTracker, SurveyMonitor, AIChatPanel, QCAudioPanel)
  - UI primitives: `components/ui/*` (Skeleton, EmptyState, ErrorBanner)
  - Theme: `ThemeToggle.jsx` and CSS variables in `App.css`
- MongoDB — collections: `questions`, `questionTransitions`, `farmers`, `surveySessions`, `answers`, `audio`, `regions`
- Storage: `audio_storage/` folder (or S3 in production)

---

## 🗄 Data Model (Detailed)
- `questions`: { id, sequence, text, options[], translations, hasVoice, isMandatory }
- `questionTransitions`: { fromId, toId, type: 'next'|'next_if_option', optionIndex? }
- `farmers`: { phoneNumber, preferredLanguage, region, invitedAt, createdAt }
- `surveySessions`: { id, phoneNumber, status: 'in_progress'|'completed'|'dropped', createdAt, completedAt }
- `answers`: { id, phoneNumber, sessionId, questionId, selectedOptionIndex, selectedOption, responseMode: 'text'|'voice', audioId?, createdAt }
- `audio`: { id, mediaId, filePath, fileName, mimeType, fileSize, sha256, createdAt }

Notes:
- `phoneNumber` is the farmer's primary identifier — treat carefully (PII).
- The `questionTransitions` table encodes conditional flows (preferred over graph DB for simplicity).

---

## 🔁 Runtime Sequences (Detailed)

### A. Onboarding (User: "START")
sequenceDiagram
  participant User as Farmer (WhatsApp)
  participant WA as WhatsApp Cloud
  participant Server as Express
  participant Controller as WhatsAppController
  participant Survey as SurveyEngine
  participant DB as MongoDB

  User->>WA: "START"
  WA->>Server: POST /webhook (message)
  Server->>Controller: handleIncomingMessage(payload)
  Controller->>DB: dedupe by messageId
  alt new user
    Controller->>Survey: create surveySession(phone)
    Controller->>DB: upsert farmer (phone, default region/language)
    Controller->>WA: send first question
  else existing user
    Controller->>Survey: resume session and send next question
  end

### B. Numeric Answer (1 / 2 / 3 ...)
sequenceDiagram
  participant User
  participant WA
  participant Server
  participant Controller
  participant Survey
  participant DB

  User->>WA: "2"
  WA->>Server: webhook
  Server->>Controller: validate & map to session
  Controller->>Survey: lookup question by session
  Controller->>DB: insert answer
  Controller->>Survey: compute next question (check `next_if_option`)
  opt next exists
    Controller->>WA: send next question
  else none
    Controller->>DB: mark session completed
    Controller->>WA: send completion message
  end

### C. Audio/Voice Flow
sequenceDiagram
  participant User
  participant WA
  participant Server
  participant AudioSvc
  participant DB

  User->>WA: voice message (mediaId)
  WA->>Server: webhook (media ref)
  Server->>AudioSvc: fetch media (mediaId)
  AudioSvc->>Disk: write file to AUDIO_STORAGE_PATH
  AudioSvc->>DB: insert audio doc
  Server->>DB: create answer placeholder (responseMode:'voice')
  Later -> Server: user sends numeric confirmation
  Server->>DB: update answer with selectedOption and mark complete

### D. Analytics & Aggregation
sequenceDiagram
  participant Frontend
  participant Server
  participant AnalyticsSvc
  participant DB

  Frontend->>Server: GET /api/analytics/summary
  Server->>AnalyticsSvc: run aggregation pipelines
  AnalyticsSvc->>DB: aggregate (answers, farmers, sessions)
  AnalyticsSvc-->>Server: results
  Server-->>Frontend: JSON results

Notes: region normalization and completionPct computed in `analyticsService.getRegionStats` and aggregated again in frontend as a safety net.

---

## ⚙️ API Surface (important endpoints)
- `POST /api/whatsapp/webhook` — inbound messages from WhatsApp
- `POST /api/whatsapp/invite` — send an invite to a phone or generate QR
- `GET /api/analytics/summary` — dashboard summary, crop distribution, region stats
- `GET /api/analytics/recent` — recent activity (latest answers)
- `GET /api/analytics/export` — xlsx export
- `GET /api/analytics/kpis` — KPI metrics (range: daily|weekly|monthly)
- `GET /api/qc/audio` — list audio items for QC
- `GET /api/qc/audio/:id/file` — stream audio file
- `POST /api/ai/chat` — ask the AI to summarize or analyze selected data

---

## 🧰 Dev workflow & commands
- `cd backend` → `npm install` → `npm run dev` (nodemon)
- `cd frontend` → `npm install` → `npm run dev` (Vite)
- `npm --prefix frontend run build` → build static assets
- `npm start` in backend to run production server

### Seeding & testing
- `node backend/scripts/seedDatabase.js` — seeds questions and test farmers
- Use Postman/curl to test webhook flows before connecting WhatsApp

---

## 🛠 Debugging tips
- If Analytics % look wrong: open Analytics page → "Show Raw Data" → check `regionStats` object; if region strings vary (telangana vs Telangana vs andhra_pradesh) the UI will collapse/normalize them.
- If audio missing: check `AUDIO_STORAGE_PATH` and `audio` collection; audit logs for fetch errors from WhatsApp.
- For webhook deliveries, check request signature and message dedupe logs (stored in `logs/webhooks` if enabled).

---

## ✅ Operational recommendations
- Add Sentry for errors, Prometheus for metrics, and central logging (ELK/Datadog)
- Move audio to S3/GCS and keep only metadata in DB
- Add database migrations or a repair job that can normalize `farmers.region`

---

If you'd like, I can add a diagram PNG and a `SETUP.md` (production checklist). Tell me which export format you prefer (PNG or SVG).