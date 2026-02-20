# Deployment Guide

This guide explains how to deploy and operate the Farmer Survey stack using Docker Compose.

## 1) Prerequisites

- Docker Desktop installed and running
- Docker Compose v2 (`docker compose`)
- Public HTTPS URL for WhatsApp webhook (for local machine use `ngrok`)

## 2) Environment setup

Create backend environment file from template:

```bash
copy backend\.env.example backend\.env
```

Then edit `backend/.env` and set at minimum:

- `MONGODB_URI` (for compose use `mongodb://mongo:27017/farmer_survey`)
- `MONGODB_DB_NAME`
- `JWT_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_WEBHOOK_URL`
- `TTS_PROVIDER` (`elevenlabs` or `none`)
- `ELEVENLABS_API_KEY` (if using `elevenlabs`)
- `GROQ_API_KEY` (for AI endpoints)

## 3) Start deployment

From project root:

```bash
docker compose up --build -d
```

Services:

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- MongoDB: mongodb://localhost:27017

## 4) Verify deployment

Check service state:

```bash
docker compose ps
```

Check backend startup logs:

```bash
docker compose logs backend --tail 200
```

Healthy startup should include lines similar to:

- `MongoDB connection established`
- `Survey schema ensured on startup`
- `Server running on http://localhost:3000`
- `WhatsApp configured: true` (if credentials are valid)

## 5) Webhook setup notes

If using `ngrok`, set in `backend/.env`:

```env
WHATSAPP_WEBHOOK_URL=https://<your-ngrok-domain>/webhook
```

Then make sure Meta webhook configuration uses:

- Callback URL: `https://<your-ngrok-domain>/webhook`
- Verify token: same value as `WHATSAPP_VERIFY_TOKEN`

## 6) Common issues

### A) `WhatsApp configuration incomplete`
Cause: missing `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN`.
Fix: set both in `backend/.env`, then restart backend.

### B) `No surveys found in DB`
Cause: empty survey/question collections.
Fix: create survey and questions from Survey Editor/API.

### C) `No TTS provider configured`
Cause: `TTS_PROVIDER=none`.
Fix: set `TTS_PROVIDER=elevenlabs` and provide `ELEVENLABS_API_KEY`.

### D) Webhook receives `statuses` only (`sent`, `read`)
Cause: these are delivery receipts, not farmer reply messages.
Fix: no action required; test by sending a real text/audio reply from phone.

## 7) Update / redeploy

After code or env changes:

```bash
docker compose up --build -d
```

If you changed only env and want to force recreate backend:

```bash
docker compose up -d --force-recreate backend
```

## 8) Stop / cleanup

Stop all services:

```bash
docker compose down
```

Stop and remove volumes (deletes Mongo data):

```bash
docker compose down -v
```

## 9) Optional production hardening checklist

- Use strong secrets for `JWT_SECRET` and admin keys
- Store secrets in a secret manager (not plain `.env` in repo)
- Put backend behind HTTPS reverse proxy
- Restrict MongoDB exposure/network access
- Enable monitoring + alerting
- Configure regular DB backups
