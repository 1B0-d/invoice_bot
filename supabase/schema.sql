create table if not exists public.user_settings (
  telegram_user_id text primary key,
  provider text,
  gemini_api_key text,
  openai_api_key text,
  google_sheet_id text,
  google_sheet_name text,
  column_mapping jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_history (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null,
  provider text not null,
  file_name text not null,
  mime_type text not null,
  storage_key text,
  storage_url text,
  status text not null,
  error_message text,
  extracted_invoice jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists document_history_telegram_user_id_idx
  on public.document_history (telegram_user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

drop trigger if exists document_history_set_updated_at on public.document_history;
create trigger document_history_set_updated_at
before update on public.document_history
for each row
execute function public.set_updated_at();
