-- ChatCraft schema. Run once in the Supabase SQL editor (works on self-hosted Supabase too).

-- ───────── Tables ─────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  name text check (name is null or length(name) <= 60),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','image','audio')),
  body text,
  media_url text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'text' and body is not null and length(body) between 1 and 4000)
    or (kind in ('image','audio') and media_url is not null)
  )
);
create index on public.messages (conversation_id, created_at desc);

create table public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (length(emoji) <= 16),
  primary key (message_id, user_id, emoji)
);

-- ───────── Helper functions ─────────
create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members
                 where conversation_id = cid and user_id = auth.uid());
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, lower(new.raw_user_meta_data->>'username'), new.raw_user_meta_data->>'username');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(p_username));
$$;

create or replace function public.get_or_create_dm(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_other = auth.uid() then raise exception 'cannot message yourself'; end if;
  select c.id into cid from public.conversations c
   where not c.is_group
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other)
   limit 1;
  if cid is null then
    insert into public.conversations (is_group, created_by) values (false, auth.uid()) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, auth.uid()), (cid, p_other);
  end if;
  return cid;
end $$;

create or replace function public.create_group(p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'group name required'; end if;
  insert into public.conversations (is_group, name, created_by) values (true, trim(p_name), auth.uid()) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id)
    select cid, u from unnest(array_append(p_members, auth.uid())) as u group by u;
  return cid;
end $$;

create or replace function public.mark_read(p_conversation uuid) returns void
language sql security invoker as $$
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation and user_id = auth.uid();
$$;

create or replace function public.conversation_summaries()
returns table (cid uuid, last_body text, last_kind text, last_at timestamptz, last_sender uuid, unread bigint)
language sql stable security invoker as $$
  select cm.conversation_id, lm.body, lm.kind, lm.created_at, lm.sender_id,
         (select count(*) from public.messages m
           where m.conversation_id = cm.conversation_id
             and m.created_at > cm.last_read_at and m.sender_id <> auth.uid())
  from public.conversation_members cm
  left join lateral (
    select m.body, m.kind, m.created_at, m.sender_id from public.messages m
     where m.conversation_id = cm.conversation_id order by m.created_at desc limit 1
  ) lm on true
  where cm.user_id = auth.uid();
$$;

revoke execute on function public.get_or_create_dm(uuid), public.create_group(text, uuid[]),
  public.mark_read(uuid), public.conversation_summaries() from public, anon;
grant execute on function public.get_or_create_dm(uuid), public.create_group(text, uuid[]),
  public.mark_read(uuid), public.conversation_summaries() to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- ───────── Row Level Security ─────────
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;

create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read conversations" on public.conversations
  for select to authenticated using (public.is_member(id));

create policy "members read membership" on public.conversation_members
  for select to authenticated using (public.is_member(conversation_id));
create policy "update own read marker" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member(conversation_id));
create policy "members send messages" on public.messages
  for insert to authenticated with check (sender_id = auth.uid() and public.is_member(conversation_id));

create policy "members read reactions" on public.reactions
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
create policy "members add own reactions" on public.reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
create policy "remove own reactions" on public.reactions
  for delete to authenticated using (user_id = auth.uid());

-- ───────── Realtime ─────────
alter publication supabase_realtime add table public.messages, public.reactions, public.conversation_members;

-- ───────── Storage (photos + voice notes) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', true, 5242880,
        array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/ogg'])
on conflict (id) do nothing;

create policy "members upload chat media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-media' and public.is_member(((storage.foldername(name))[1])::uuid));
