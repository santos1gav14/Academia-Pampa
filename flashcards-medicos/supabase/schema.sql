-- Flashcards Médicos — schema inicial (Supabase / Postgres)
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase.

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- cria o profile automaticamente quando um usuário se cadastra
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============ SUBSCRIPTIONS ============
-- Só as Edge Functions (service role) escrevem aqui. O usuário só lê o próprio status.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mp_preapproval_id text unique,
  status text not null default 'pending'
    check (status in ('pending','active','paused','cancelled','expired')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- helper usada nas policies de conteúdo premium
create or replace function public.has_active_subscription(uid uuid)
returns boolean as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = uid
      and status = 'active'
      and (current_period_end is null or current_period_end > now())
  );
$$ language sql stable security definer set search_path = public;

-- ============ DECKS ============
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  specialty text,
  is_premium boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.decks enable row level security;

-- o catálogo (título/descrição) fica visível para qualquer usuário logado,
-- inclusive quem não assina: isso é o que vende a assinatura. O conteúdo
-- (flashcards) é que fica bloqueado abaixo.
create policy "decks_select_all_authenticated" on public.decks
  for select using (auth.uid() is not null);

create policy "decks_admin_insert" on public.decks
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create policy "decks_admin_update" on public.decks
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create policy "decks_admin_delete" on public.decks
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ============ FLASHCARDS ============
create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  front text not null,
  back text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.flashcards enable row level security;

create policy "flashcards_select_via_deck" on public.flashcards
  for select using (
    exists (
      select 1 from public.decks d
      where d.id = flashcards.deck_id
        and (
          d.is_premium = false
          or public.has_active_subscription(auth.uid())
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
        )
    )
  );

create policy "flashcards_admin_insert" on public.flashcards
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create policy "flashcards_admin_update" on public.flashcards
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create policy "flashcards_admin_delete" on public.flashcards
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ============ REVIEWS (estado de repetição espaçada por usuário/carta) ============
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  ease_factor real not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  due_date date not null default current_date,
  last_reviewed_at timestamptz,
  unique (user_id, flashcard_id)
);

alter table public.reviews enable row level security;

create policy "reviews_select_own" on public.reviews
  for select using (auth.uid() = user_id);

create policy "reviews_insert_own" on public.reviews
  for insert with check (auth.uid() = user_id);

create policy "reviews_update_own" on public.reviews
  for update using (auth.uid() = user_id);

create policy "reviews_delete_own" on public.reviews
  for delete using (auth.uid() = user_id);

-- ============ SEED: baralho demo gratuito ============
insert into public.decks (id, title, description, specialty, is_premium) values
  ('00000000-0000-0000-0000-000000000001',
   'Demo Gratuito: Cardiologia Básica',
   'Baralho de demonstração gratuito para testar a plataforma antes de assinar.',
   'Cardiologia', false);

insert into public.flashcards (deck_id, front, back, tags) values
  ('00000000-0000-0000-0000-000000000001',
   'Qual a tríade clássica do tamponamento cardíaco (Tríade de Beck)?',
   'Hipotensão, turgência jugular e bulhas cardíacas hipofonéticas.',
   array['cardiologia','emergencia']),
  ('00000000-0000-0000-0000-000000000001',
   'Qual o principal mecanismo de ação dos IECA (ex: Captopril, Enalapril)?',
   'Inibem a enzima conversora de angiotensina, reduzindo a formação de angiotensina II e a degradação de bradicinina.',
   array['cardiologia','farmacologia']),
  ('00000000-0000-0000-0000-000000000001',
   'No ECG, o que caracteriza uma Fibrilação Atrial?',
   'Ausência de ondas P organizadas, ritmo irregularmente irregular e ondas fibrilatórias (ondas f).',
   array['cardiologia','ecg']);

-- ============ Como virar admin (para gerenciar conteúdo pelo app) ============
-- Depois de criar sua conta pelo app, rode (trocando o e-mail):
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'seu-email@exemplo.com');
