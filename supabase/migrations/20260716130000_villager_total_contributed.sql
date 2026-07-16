-- Computed column for PostgREST/Supabase: selecting `total_contributed` on
-- villagers runs this SQL aggregate (sum of paid check-in intent amounts).
create or replace function total_contributed(villagers)
returns integer
language sql
stable
parallel safe
as $$
  select coalesce(sum(c.intent_amount), 0)::integer
  from check_ins c
  where c.villager_id = $1.id
    and c.status = 'paid';
$$;
