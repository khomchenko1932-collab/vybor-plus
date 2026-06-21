create table if not exists public.choice_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.choice_history enable row level security;

create policy "Users can read own history" on public.choice_history for select using (auth.uid() = user_id);
create policy "Users can insert own history" on public.choice_history for insert with check (auth.uid() = user_id);
create policy "Users can update own history" on public.choice_history for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own history" on public.choice_history for delete using (auth.uid() = user_id);
