update villagers v
set last_visited_at = sub.max_created
from (
  select villager_id, max(created_at) as max_created
  from check_ins
  group by villager_id
) sub
where sub.villager_id = v.id;
