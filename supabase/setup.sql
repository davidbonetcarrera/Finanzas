-- Finanzas personales · servidor de sincronización (Supabase)
-- Pegar entero en: Supabase → SQL Editor → New query → Run.
-- El servidor sólo guarda sobres CIFRADOS. Las tablas no son accesibles
-- directamente: sólo a través de estas funciones y con el código del hogar.

create table if not exists public.vaults (
  id text primary key,                 -- sha256 del código del hogar
  rev bigint not null,
  env jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.vault_history (
  id text not null,
  rev bigint not null,
  env jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (id, rev)
);
alter table public.vaults enable row level security;
alter table public.vault_history enable row level security;
revoke all on public.vaults, public.vault_history from anon, authenticated;

create or replace function public.vault_id(p_code text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'codigo no valido'; end if;
  return encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
end $$;

create or replace function public.vault_rev(p_code text) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select v.rev from public.vaults v where v.id = public.vault_id(p_code)), 0);
$$;

create or replace function public.get_vault(p_code text) returns table(rev bigint, env jsonb)
language sql stable security definer set search_path = '' as $$
  select v.rev, v.env from public.vaults v where v.id = public.vault_id(p_code);
$$;

create or replace function public.put_vault(p_code text, p_base bigint, p_env jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  h text := public.vault_id(p_code);
  cur bigint;
begin
  if pg_column_size(p_env) > 8000000 then raise exception 'demasiado grande'; end if;
  if p_env->>'app' is distinct from 'finanzas-personales' or p_env->>'ct' is null then raise exception 'formato'; end if;
  select v.rev into cur from public.vaults v where v.id = h for update;
  if cur is null then
    if p_base <> 0 then return -1; end if;
    insert into public.vaults(id, rev, env) values (h, 1, p_env) on conflict do nothing;
    if not found then return -1; end if;
    cur := 1;
  else
    if cur <> p_base then return -1; end if;
    cur := cur + 1;
    update public.vaults set rev = cur, env = p_env, updated_at = now() where id = h;
  end if;
  -- Historial de las últimas 30 versiones (para recuperar si algo sale mal)
  insert into public.vault_history(id, rev, env) values (h, cur, p_env);
  delete from public.vault_history where id = h and rev <= cur - 30;
  return cur;
end $$;

revoke all on function public.vault_id(text), public.vault_rev(text), public.get_vault(text), public.put_vault(text, bigint, jsonb) from public;
grant execute on function public.vault_rev(text), public.get_vault(text), public.put_vault(text, bigint, jsonb) to anon, authenticated;
