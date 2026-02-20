# 🌾 Farmer Survey Analytics — Technical Reference & Developer Guide

This README is the single source of truth for developers and operators. It complements `flow.md` (system flow diagrams and sequences).

---

## Project Overview

This README provides a technical reference and developer guide for the project. The `flow.md` file contains the flowcharts (Mermaid) and sequence diagrams. Read `flow.md` for the visual flow and these sections for operational details.

A WhatsApp-based survey system for conducting fast market research among farmers with:

- **Simple onboarding** (no forms, no OTP) - farmers reply "START"
- **MCQ surveys** with conditional skip logic
- **Multilingual support** (Telugu, Hindi, Kannada, Marathi, Tamil)
- **Geo-tagging** of responses
- **Quality control** via audio metadata and file storage
- **AI-powered analytics** (Groq LLM) for post-collection insights (analytics-only)
- **Chat interface** to query survey data

---

## Tech Stack

- **Backend:** Node.js + Express.js
- **Frontend:** Vite + React
- **Database:** MongoDB (collections modeled for survey graphs & responses)
- **Messaging:** WhatsApp Business API
- **AI:** Groq API (analytics only, NOT survey generation)
- **Export:** Excel (.xlsx)

---

## Architecture & Data Model

This project stores survey structure and responses in MongoDB collections (replacing Neo4j):

**Collections:**
- `questions` — Survey questions (id, sequence, text, options, translations)
- `questionTransitions` — Next/default and conditional transitions (fromId, toId, type, optionIndex)
- `farmers` — Farmer records: { phoneNumber, preferredLanguage, region, status, invitedAt, createdAt }
- `surveySessions` — Sessions per farmer: { id, phoneNumber, status, createdAt, completedAt }
- `answers` — Responses: { id, phoneNumber, sessionId, questionId, selectedOptionIndex, selectedOption, responseMode, audioId?, createdAt }
- `audio` — Audio metadata: { id, mediaId, filePath, mimeType, fileSize, sha256, createdAt }
- `regions` — Region metadata (language, area)

Notes:
- Audio files are stored on disk under `AUDIO_STORAGE_PATH` (default `./audio_storage`) and referenced in `audio.filePath`.
- `questionTransitions` encodes the conditional flow previously represented by graph relationships (e.g., `next` or `next_if_option`).

---

## Processing Flow (What happens on incoming messages)

1. WhatsApp webhook receives message payloads at `/api/whatsapp/webhook`.
2. The backend deduplicates messages (by message id) to avoid double-processing.
3. On `START` messages: language detection (region → script → default) and farmer onboarding:
   - Create or update `farmers` document
   - Create a new `surveySessions` document (status: `in_progress`)
   - Send the first question (or Q_LOCATION when region is missing)
4. On numeric responses (1, 2, 3...):
   - Validate option
   - Save an `answers` document
   - If voice answer existed as a pending `answers` entry, update it with selected option
   - Determine next question via `questionTransitions` (conditional or default)
   - Send next question or mark session `completed`
5. On audio messages: store audio file to disk, save `audio` record, create a `answers` placeholder (responseMode: `voice`, selectedOptionIndex: -1)
6. Admin/QC routes can list audio QC items and stream audio files for review (`/api/qc/audio`)
7. Analytics endpoints perform MongoDB aggregations to compute distributions, region stats, and exports
8. AI chat (`/api/ai/chat`) fetches filtered data and sends it (as data only) to Groq LLM for summarization. AI is only used for summarization/insights and must not fabricate responses.

---

## Setup & Installation

### Prerequisites
- Node.js v18+
- A MongoDB cluster (Atlas or self-hosted)
- WhatsApp Business API access (optional for full messaging)
- Groq API key (for AI chat)

### Backend Setup

1. Copy `backend/.env.example` → `backend/.env` and set required variables (see below).
2. Install dependencies

```bash
cd backend
npm install
```

3. Seed demo data (creates questions and sample farmers)

```bash
# Ensure MONGODB_URI and MONGODB_DB_NAME are set in .env
npm run seed
```

4. Generate TTS audio for all questions (optional)

```bash
# Requires Python 3 and these packages: python-dotenv, pymongo, requests
# Install: pip install python-dotenv pymongo requests
# Run the generator (saves files to AUDIO_STORAGE_PATH/tts_questions/ and upserts audio docs):
cd backend
npm run tts:generate

# Options: --force to regenerate, --dry-run to preview, --question-ids id1,id2 to target specific questions
```

5. Start the server

```bash
npm start        # production start
npm run dev      # development with nodemon
```

### Environment variables (important)

- `PORT` (default: 3000)
- `MONGODB_URI` (e.g. mongodb+srv://username:password@cluster0.xyz.mongodb.net/?retryWrites=true&w=majority)
- `MONGODB_DB_NAME` (default: farmer_survey)
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `AUDIO_STORAGE_PATH` (default: ./audio_storage)
- `ENABLE_TRANSCRIPTION` (default: false) — set to `true` to enable STT job scheduling
- `STT_PROVIDER` — choose `groq` (default) or another provider
- `TTS_PROVIDER` — choose the TTS provider to use for outgoing audio: `elevenlabs` or `none`. When set to `elevenlabs`, also set `ELEVENLABS_API_KEY` and optionally `ELEVENLABS_VOICE_ID`.
- `TTS_TIMEOUT_MS` — request timeout for TTS provider (ms)
- `AUDIO_RETENTION_DAYS` — number of days to keep audio files (default: 30)
- `GROQ_API_KEY` (for AI chat)

---

## Running the Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173/

---

## Docker (Backend + Frontend + MongoDB)

The repository includes:
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`

Before running Docker, make sure backend env exists:

```bash
copy backend\.env.example backend\.env
```

Run the full stack:

```bash
docker compose up --build
```

Endpoints:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MongoDB: mongodb://localhost:27017

Stop services:

```bash
docker compose down
```

Stop and remove MongoDB volume:

```bash
docker compose down -v
```

For complete deployment steps (first-time setup, updates, logs, health checks, and webhook troubleshooting), see `DEPLOYMENT.md`.

---

## Testing the Flow

Use `curl` or Postman to POST simulated messages to `/api/whatsapp/webhook` (see example requests in the codebase). For seed data, default sample farmers seeded are:

- `+919876543210` — completed session
- `+919876543211` — in-progress
- `+919876543212` — onboarded

---

## Troubleshooting MongoDB connection (SRV / DNS issues)

If you see errors like:
```
querySrv ECONNREFUSED _mongodb._tcp.cluster0.kdbqgi6.mongodb.net
```
Try:

1. **Atlas IP Access**: Add your machine IP in MongoDB Atlas → Network Access (or temporarily allow `0.0.0.0/0` while testing).
2. **Use standard (non-SRV) connection string**: Atlas provides an alternative `mongodb://host1:27017,host2:27017/?replicaSet=...` URI; replace `MONGODB_URI` with that if SRV/DNS lookups fail on your network.
3. **Try another network** (mobile hotspot) to verify if ISP/DNS blocks SRV records.
4. **Confirm `MONGODB_URI` is correct**: username, password, and DB name must match.

---

## Security & Data Policies

- Phone number is used as the farmer identifier (not anonymous). For analytics, consider hashing or anonymizing phone numbers.
- AI is only used on collected/aggregated data (no generation or filling of missing responses).
- Audio files are stored locally by default; consider moving to S3/GCS for production.

---

## Key Design Decisions (summary)

- **MongoDB chosen** to simplify deployment and keep a document model for questions, transitions, and responses. Conditional logic is modeled in `questionTransitions`.
- **Language Auto-Detect** uses region → script → fallback sequence.
- **AI** (Groq) will only summarize data passed to it; it will not be given raw PII or permission to fabricate answers.

---

## Future Work

- Scale storage (S3 for audio), backups, and monitoring
- Add transcription & text-based QC
- More languages and improved localization testing
- Export improved reports and dashboards

---

## Admin: Survey Editor (new)

A new admin UI and API were added to manage survey questions, transitions, and translations.

API highlights:
- `GET /api/survey/questions` — list questions
- `GET /api/survey/questions/:id` — get a question
- `POST /api/survey/questions` — create question (Auto-translates to configured languages)
- `PUT /api/survey/questions/:id` — update question (auto-retranslate on edit by default)
- `DELETE /api/survey/questions/:id` — soft-delete question
- `POST /api/survey/questions/:id/translate` — explicit translate call (languages in body)
- `POST /api/survey/questions/resequence` — reorder questions (body: { orderedIds: [...] })

Admin endpoints are protected via `ADMIN_API_KEY` (send via header `x-admin-api-key`).

Frontend:
- `Survey Editor` route available in the app navigation for admins to add/edit questions and manage flows.

---


---

**Last Updated:** 2026-02-10

---

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Neo4j
NEO4J_URI=neo4j+s://[your-aura-instance-id].databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=[your-password]

# WhatsApp
WHATSAPP_ACCESS_TOKEN=[your-token]
WHATSAPP_PHONE_NUMBER_ID=[your-phone-id]
WHATSAPP_VERIFY_TOKEN=farmer_survey_pilot_2026

# Groq (Phase 4)
GROQ_API_KEY=[your-key]
GROQ_MODEL=openai/gpt-oss-120b

# Storage
AUDIO_STORAGE_PATH=./audio_storage
ENABLE_TRANSCRIPTION=false
```

---

## Production Considerations (Future)

- [ ] HTTPS + TLS for webhooks
- [ ] Rate limiting on WhatsApp messages
- [ ] Database backups (Neo4j Aura backup)
- [ ] Logging & monitoring (Winston/Datadog)
- [ ] Error tracking (Sentry)
- [ ] Load balancing for high farmer volume
- [ ] Audio storage in S3/GCS instead of local FS
- [ ] Encryption for sensitive farmer data (GDPR)

---

## FAQ

**Q: Can farmers respond with voice?**
A: Phase 2. Phase 1 is numeric text (1, 2, 3) only.

**Q: Can AI generate answers for missing data?**
A: NO. This violates core constraint. AI is used ONLY AFTER collection for analytics.

**Q: Can farmers switch languages mid-survey?**
A: Not yet. Phase 2 improvement.

**Q: How many farmers can we handle?**
A: MVP tested with 3-10 farmers. Production scale (10K+) requires:
- Database indexing
- Connection pooling
- Message queue (RabbitMQ)
- Load balancer

**Q: Is farmer data really anonymous?**
A: Phone number is ID (not anonymous). For true anonymity, hash phone numbers in analytics.

**Q: Can we use WhatsApp Web instead of Business API?**
A: Not recommended. Business API is official, supported, scalable. WhatsApp Web blocks bots.

---

## Support & Documentation

- **Neo4j Docs:** https://neo4j.com/docs/
- **WhatsApp API:** https://developers.facebook.com/docs/whatsapp/
- **Groq API:** https://console.groq.com/docs/
- **Express.js:** https://expressjs.com/
- **React:** https://react.dev/

---

## License

MIT - Free to use, modify, and distribute.

---

## Authors & Contributors

Built as MVP for farmer survey platform (Feb 2026).

---

**Last Updated:** 2026-02-06
**Status:** Phase 1 Complete (Testing)
