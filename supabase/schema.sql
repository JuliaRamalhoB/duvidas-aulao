-- =====================================================================
-- Plataforma de dúvidas para aulão — esquema da base de dados (Fase 1)
--
-- Como usar: colar este ficheiro inteiro no SQL Editor do Supabase e
-- carregar em "Run". Pode ser executado várias vezes sem erros: as
-- tabelas só são criadas se não existirem, e as funções, políticas e
-- triggers são recriados.
--
-- Nota: se uma tabela já existir, alterações às suas colunas ou CHECKs
-- feitas aqui NÃO são aplicadas de novo (o "if not exists" salta-a).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

-- Perfil de cada utilizador (1 linha por conta do Supabase Auth).
-- Mudança em relação ao SPEC: guardamos também o email aqui, porque o
-- painel da professora precisa de mostrar nome + email, e a tabela
-- auth.users não é acessível pela API.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  email        text not null check (char_length(email) <= 254),
  role         text not null default 'student' check (role in ('student', 'admin')),
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Temas: disciplina > tópico > subtópico (opcional).
-- "nulls not distinct" faz com que (Matemática, Geometria, NULL) só
-- possa existir uma vez (sem isto, o Postgres aceitaria duplicados).
create table if not exists public.themes (
  id         bigint generated always as identity primary key,
  discipline text not null check (char_length(discipline) between 1 and 100),
  topic      text not null check (char_length(topic) between 1 and 100),
  subtopic   text check (subtopic is null or char_length(subtopic) between 1 and 100),
  created_at timestamptz not null default now(),
  constraint themes_unique unique nulls not distinct (discipline, topic, subtopic)
);

-- Dúvidas. Propositadamente SEM coluna de autor (anonimato).
create table if not exists public.doubts (
  id                bigint generated always as identity primary key,
  theme_id          bigint not null references public.themes (id),
  body              text not null check (char_length(body) between 1 and 1000),
  status            text not null default 'pending' check (status in ('pending', 'answered')),
  answer_body       text check (answer_body is null or char_length(answer_body) between 1 and 5000),
  answered_in_class boolean not null default false,
  answered_at       timestamptz,
  hidden            boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists doubts_created_at_idx on public.doubts (created_at desc);
create index if not exists doubts_theme_id_idx on public.doubts (theme_id);

-- Tabela privada: quem escreveu cada dúvida.
create table if not exists public.doubt_authors (
  doubt_id  bigint primary key references public.doubts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade
);

create index if not exists doubt_authors_author_id_idx on public.doubt_authors (author_id);

-- Banco de questões de escolha múltipla.
create table if not exists public.questions (
  id          bigint generated always as identity primary key,
  theme_id    bigint not null references public.themes (id),
  statement   text not null check (char_length(statement) between 1 and 3000),
  option_a    text not null check (char_length(option_a) between 1 and 1000),
  option_b    text not null check (char_length(option_b) between 1 and 1000),
  option_c    text not null check (char_length(option_c) between 1 and 1000),
  option_d    text not null check (char_length(option_d) between 1 and 1000),
  option_e    text check (option_e is null or char_length(option_e) between 1 and 1000),
  correct     text not null check (correct in ('A', 'B', 'C', 'D', 'E')),
  explanation text not null check (char_length(explanation) between 1 and 5000),
  created_at  timestamptz not null default now(),
  -- Se a correta for E, a alternativa E tem de existir.
  constraint questions_correct_exists check (correct <> 'E' or option_e is not null)
);

create index if not exists questions_theme_id_idx on public.questions (theme_id);

-- Tentativas dos alunos na prática.
create table if not exists public.attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  question_id bigint not null references public.questions (id) on delete cascade,
  chosen      text not null check (chosen in ('A', 'B', 'C', 'D', 'E')),
  is_correct  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists attempts_user_question_idx on public.attempts (user_id, question_id);


-- ---------------------------------------------------------------------
-- 2. FUNÇÕES AUXILIARES (usadas nas políticas RLS)
-- ---------------------------------------------------------------------
-- "security definer" = a função corre com permissões do dono, por isso
-- consegue ler profiles sem cair nas próprias regras RLS (evita ciclos).
-- "set search_path = ''" é uma proteção recomendada pelo Supabase.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Aprovado = a professora aprovou a conta (o admin conta sempre como aprovado).
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (approved or role = 'admin')
  );
$$;


-- ---------------------------------------------------------------------
-- 3. TRIGGERS
-- ---------------------------------------------------------------------

-- 3a. Ao registar uma conta nova, cria o perfil como aluno pendente.
-- O role e o approved são SEMPRE fixos aqui: ignoramos qualquer valor
-- que venha do frontend (só lemos o nome).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
  if v_name = '' then
    v_name := 'Sem nome';
  end if;

  insert into public.profiles (id, display_name, email, role, approved)
  values (new.id, v_name, coalesce(new.email, ''), 'student', false)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 3b. Proteção extra: só o admin pode mudar role, approved, id ou email.
-- (A política RLS já impede alunos de fazer UPDATE em profiles; isto é
-- uma segunda barreira, para o caso de alguém mexer nas políticas.)
-- Quando corres SQL no SQL Editor, auth.uid() é NULL, por isso o
-- comando para te tornares admin continua a funcionar.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.approved is distinct from old.approved
       or new.id is distinct from old.id
       or new.email is distinct from old.email then
      raise exception 'Sem permissão para alterar estes campos do perfil.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();


-- 3c. Estado da dúvida calculado automaticamente:
--   - tem resposta em texto OU "respondida em aula"  -> 'answered'
--   - caso contrário                                  -> 'pending'
-- Também preenche answered_at na primeira vez que fica respondida.
create or replace function public.set_doubt_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Resposta só com espaços conta como "sem resposta".
  if new.answer_body is not null and trim(new.answer_body) = '' then
    new.answer_body := null;
  end if;

  if new.answer_body is not null or new.answered_in_class then
    new.status := 'answered';
    if tg_op = 'INSERT' or old.status <> 'answered' or new.answered_at is null then
      new.answered_at := now();
    end if;
  else
    new.status := 'pending';
    new.answered_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_doubt_status on public.doubts;
create trigger set_doubt_status
  before insert or update on public.doubts
  for each row execute function public.set_doubt_status();


-- 3d. Tentativas: a base de dados calcula se acertou (não confia no
-- navegador) e fixa o aluno e a hora.
create or replace function public.set_attempt_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correct text;
begin
  select correct into v_correct from public.questions where id = new.question_id;
  if v_correct is null then
    raise exception 'Questão não encontrada.';
  end if;

  new.user_id    := auth.uid();
  new.is_correct := (new.chosen = v_correct);
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists set_attempt_fields on public.attempts;
create trigger set_attempt_fields
  before insert on public.attempts
  for each row execute function public.set_attempt_fields();


-- ---------------------------------------------------------------------
-- 4. FUNÇÃO PARA CRIAR DÚVIDA (chamada pelo frontend via RPC)
-- ---------------------------------------------------------------------
-- Insere em doubts e doubt_authors na mesma operação. Os alunos não têm
-- permissão de INSERT direto nessas tabelas: só por aqui.
create or replace function public.create_doubt(p_theme_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body     text;
  v_doubt_id bigint;
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception 'A tua conta ainda não foi aprovada.';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) = 0 then
    raise exception 'A dúvida não pode estar vazia.';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'A dúvida tem mais de 1000 caracteres.';
  end if;

  if not exists (select 1 from public.themes where id = p_theme_id) then
    raise exception 'Tema inválido.';
  end if;

  -- Anti-spam (Fase 6): no máximo 5 dúvidas por minuto por aluno.
  -- Sem isto, um script podia encher o mural com milhares de dúvidas.
  if (
    select count(*)
    from public.doubt_authors da
    join public.doubts d on d.id = da.doubt_id
    where da.author_id = auth.uid()
      and d.created_at > now() - interval '1 minute'
  ) >= 5 then
    raise exception 'RATE_LIMIT: muitas dúvidas seguidas.';
  end if;

  insert into public.doubts (theme_id, body)
  values (p_theme_id, v_body)
  returning id into v_doubt_id;

  insert into public.doubt_authors (doubt_id, author_id)
  values (v_doubt_id, auth.uid());

  return v_doubt_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 4b. IMPORTAR QUESTÕES (Fase 4) — tudo ou nada
-- ---------------------------------------------------------------------
-- Recebe uma lista JSON de questões (já validadas no navegador).
-- Uma chamada RPC é uma única transação: se UMA linha falhar, nada fica
-- gravado (nem questões nem temas novos).
-- "security invoker" = corre com as permissões de quem chama, por isso o
-- RLS continua a aplicar-se (só o admin consegue inserir).
create or replace function public.import_questions(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r            jsonb;
  v_discipline text;
  v_topic      text;
  v_subtopic   text;
  v_theme_id   bigint;
  v_count      integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Apenas a professora pode importar questões.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Formato inválido.';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'No máximo 1000 questões por importação.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_discipline := trim(r ->> 'discipline');
    v_topic      := trim(r ->> 'topic');
    v_subtopic   := nullif(trim(coalesce(r ->> 'subtopic', '')), '');

    -- Cria o tema "geral do tópico" (sem subtópico), para o tópico poder
    -- ser escolhido sozinho no fórum. Se já existir, não faz nada.
    insert into public.themes (discipline, topic, subtopic)
    values (v_discipline, v_topic, null)
    on conflict do nothing;

    if v_subtopic is not null then
      insert into public.themes (discipline, topic, subtopic)
      values (v_discipline, v_topic, v_subtopic)
      on conflict do nothing;
    end if;

    select id into v_theme_id
    from public.themes
    where discipline = v_discipline
      and topic = v_topic
      and subtopic is not distinct from v_subtopic;

    insert into public.questions
      (theme_id, statement, option_a, option_b, option_c, option_d, option_e, correct, explanation)
    values (
      v_theme_id,
      r ->> 'statement',
      r ->> 'option_a',
      r ->> 'option_b',
      r ->> 'option_c',
      r ->> 'option_d',
      nullif(trim(coalesce(r ->> 'option_e', '')), ''),
      upper(trim(r ->> 'correct')),
      r ->> 'explanation'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Número de questões por tema (para o painel da professora).
create or replace function public.question_counts()
returns table (theme_id bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select q.theme_id, count(*) from public.questions q group by q.theme_id;
$$;


-- ---------------------------------------------------------------------
-- 5. PERMISSÕES BASE (GRANT/REVOKE)
-- ---------------------------------------------------------------------
-- O RLS decide QUAIS linhas; os GRANTs decidem QUE operações existem.
-- Visitantes sem login (anon) não têm acesso a nada.

revoke all on public.profiles, public.themes, public.doubts,
              public.doubt_authors, public.questions, public.attempts
  from anon, authenticated;

grant select, update                 on public.profiles      to authenticated;
grant select, insert, update, delete on public.themes        to authenticated;
grant select, update                 on public.doubts        to authenticated;
grant select                         on public.doubt_authors to authenticated;
grant select, insert, update, delete on public.questions     to authenticated;
grant select, insert                 on public.attempts      to authenticated;

-- Funções: só utilizadores com login podem chamar; as de trigger ninguém.
revoke execute on function public.is_admin()                  from public, anon;
revoke execute on function public.is_approved()               from public, anon;
revoke execute on function public.create_doubt(bigint, text)  from public, anon;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.protect_profile_fields()    from public, anon, authenticated;
revoke execute on function public.set_doubt_status()          from public, anon, authenticated;
revoke execute on function public.set_attempt_fields()        from public, anon, authenticated;

grant execute on function public.is_admin()                 to authenticated;
grant execute on function public.is_approved()              to authenticated;
grant execute on function public.create_doubt(bigint, text) to authenticated;

revoke execute on function public.import_questions(jsonb) from public, anon;
revoke execute on function public.question_counts()       from public, anon;
grant  execute on function public.import_questions(jsonb) to authenticated;
grant  execute on function public.question_counts()       to authenticated;


-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) — ativa em TODAS as tabelas
-- ---------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.themes        enable row level security;
alter table public.doubts        enable row level security;
alter table public.doubt_authors enable row level security;
alter table public.questions     enable row level security;
alter table public.attempts      enable row level security;

-- profiles ------------------------------------------------------------
-- Cada um lê o próprio perfil (mesmo pendente); o admin lê todos.
-- Só o admin altera perfis (é assim que aprova alunos). Não há política
-- de INSERT (quem cria é o trigger) nem de DELETE.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- themes --------------------------------------------------------------
drop policy if exists themes_select on public.themes;
create policy themes_select on public.themes
  for select to authenticated
  using (public.is_approved());

drop policy if exists themes_insert_admin on public.themes;
create policy themes_insert_admin on public.themes
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists themes_update_admin on public.themes;
create policy themes_update_admin on public.themes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists themes_delete_admin on public.themes;
create policy themes_delete_admin on public.themes
  for delete to authenticated
  using (public.is_admin());

-- doubts --------------------------------------------------------------
-- Aprovados veem as não ocultas; o admin vê todas. Só o admin altera
-- (responder, respondida em aula, ocultar/restaurar). Ninguém apaga, e
-- ninguém insere diretamente (só via create_doubt).
drop policy if exists doubts_select on public.doubts;
create policy doubts_select on public.doubts
  for select to authenticated
  using ((public.is_approved() and hidden = false) or public.is_admin());

drop policy if exists doubts_update_admin on public.doubts;
create policy doubts_update_admin on public.doubts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- doubt_authors -------------------------------------------------------
-- O aluno só vê as linhas em que ele é o autor; o admin vê tudo.
-- Sem políticas de INSERT/UPDATE/DELETE: ninguém mexe diretamente.
drop policy if exists doubt_authors_select on public.doubt_authors;
create policy doubt_authors_select on public.doubt_authors
  for select to authenticated
  using ((author_id = auth.uid() and public.is_approved()) or public.is_admin());

-- questions -----------------------------------------------------------
drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
  for select to authenticated
  using (public.is_approved());

drop policy if exists questions_insert_admin on public.questions;
create policy questions_insert_admin on public.questions
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists questions_update_admin on public.questions;
create policy questions_update_admin on public.questions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists questions_delete_admin on public.questions;
create policy questions_delete_admin on public.questions
  for delete to authenticated
  using (public.is_admin());

-- attempts ------------------------------------------------------------
-- O aluno aprovado insere e lê só as suas; o admin lê todas.
drop policy if exists attempts_select on public.attempts;
create policy attempts_select on public.attempts
  for select to authenticated
  using ((user_id = auth.uid() and public.is_approved()) or public.is_admin());

drop policy if exists attempts_insert_own on public.attempts;
create policy attempts_insert_own on public.attempts
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());


-- ---------------------------------------------------------------------
-- 7. REALTIME — o feed de dúvidas atualiza sozinho
-- ---------------------------------------------------------------------
-- Só a tabela doubts entra no Realtime (o Realtime respeita o RLS).
-- doubt_authors NUNCA deve ser adicionada aqui.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'doubts'
  ) then
    alter publication supabase_realtime add table public.doubts;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. DADOS INICIAIS — temas de Matemática (subtópicos vazios)
-- ---------------------------------------------------------------------
insert into public.themes (discipline, topic, subtopic) values
  ('Matemática', 'Sistemas lineares', null),
  ('Matemática', 'Progressões', null),
  ('Matemática', 'Estatística', null),
  ('Matemática', 'Análise combinatória e binômio de Newton', null),
  ('Matemática', 'Probabilidade', null),
  ('Matemática', 'Geometria', null)
on conflict do nothing;

commit;


-- ---------------------------------------------------------------------
-- 9. VERIFICAÇÃO — o resultado aparece em baixo, no SQL Editor
-- ---------------------------------------------------------------------
-- Deve mostrar 6 linhas, todas com rls_ativa = true.
select
  c.relname as tabela,
  c.relrowsecurity as rls_ativa,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'themes', 'doubts', 'doubt_authors', 'questions', 'attempts')
order by c.relname;


-- =====================================================================
-- COMANDO PARA TE TORNARES ADMIN (NÃO corre automaticamente)
-- =====================================================================
-- 1) Primeiro regista-te na aplicação (Fase 2) ou em
--    Authentication > Users > "Add user" no painel do Supabase.
-- 2) Depois, numa NOVA query do SQL Editor, cola só as linhas abaixo
--    (sem os "--" do início), troca o email pelo teu e corre:
--
-- update public.profiles
-- set role = 'admin', approved = true
-- where email = 'o-teu-email@exemplo.com';
--
-- Deve aparecer "Success. 1 row affected" (ou similar). Se disser 0 rows, o
-- email não coincide com o da conta: confirma em Authentication > Users.
-- =====================================================================
