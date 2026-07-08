# Setup

This bot now supports a stateless storage layout:

- `Supabase`: user settings and document history
- `Cloudflare R2`: original uploaded files
- `Google Sheets`: final invoice rows
- `Render/local runtime`: bot process only

## Environment variables

Use [.env.example](./.env.example) as the template.

Required:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (recommended for webhook mode)
- `GOOGLE_SCRIPT_URL`
- `SHEETS_WEBHOOK_SECRET`

Recommended:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Optional:

- `WEBHOOK_DOMAIN` (for local webhook testing or non-Render hosting)
- `WEBHOOK_PATH` (default: `/telegram/webhook`)
- `SUPABASE_USER_SETTINGS_TABLE` (default: `user_settings`)
- `SUPABASE_DOCUMENT_HISTORY_TABLE` (default: `document_history`)
- `R2_PUBLIC_BASE_URL`

## Supabase

1. Open the SQL editor in Supabase.
2. Run [supabase/schema.sql](./supabase/schema.sql).
3. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into `.env`.

If you already created the tables before the multilingual update, run the SQL again so `user_settings.language` is added.

If Supabase is not configured, user settings fall back to `data/user-settings.json`.

## R2

If R2 is configured, the bot uploads the original file before AI extraction.

If R2 upload fails, the bot still continues processing the invoice and logs the archive error.

## Local run

```bash
npm install
npm run build
npm run dev
```

## Render webhook deploy

The bot automatically switches to webhook mode when `WEBHOOK_DOMAIN` or Render's `RENDER_EXTERNAL_URL` is available.

Use Render `Web Service`, not `Background Worker`.

Recommended Render settings:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`
- Root Directory: `invoice-bot` (if your repository root is one level above this app)

For Render deployment, you usually do not need to set `WEBHOOK_DOMAIN` manually because the app can use `RENDER_EXTERNAL_URL`.
