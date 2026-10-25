-- Access is now stored as overrides: only where a teammate differs from their job's preset.
-- Until now a save wrote the whole preset, which froze people on the preset of the day. Each stored
-- level that equals the job's previous preset is dropped, so the job's current preset applies;
-- anything an admin set differently stays. Fresh databases have no rows and skip this.
WITH old(role, preset) AS (VALUES
  ('admin', '{"orders":3,"intake":3,"finance":3,"fulfilment":3,"shipping":3,"returns":3,"customers":3,"money":3,"insights":3,"channels":3,"team":3,"settings":3,"stock":3,"procurement":3,"warehouse":3,"merch":3}'::jsonb),
  ('ops', '{"orders":3,"intake":3,"finance":2,"fulfilment":3,"shipping":3,"returns":3,"customers":2,"money":2,"insights":3,"channels":2,"team":1,"settings":3,"stock":2,"procurement":1,"warehouse":3,"merch":1}'::jsonb),
  ('supply', '{"orders":1,"fulfilment":1,"shipping":1,"returns":1,"customers":0,"money":2,"insights":2,"channels":1,"settings":2,"stock":3,"procurement":3,"warehouse":3,"merch":2}'::jsonb),
  ('planner', '{"orders":1,"customers":0,"money":2,"insights":2,"stock":3,"procurement":2,"warehouse":1,"merch":1}'::jsonb),
  ('buyer', '{"orders":1,"customers":0,"money":2,"insights":1,"stock":1,"procurement":2,"warehouse":1}'::jsonb),
  ('warehouse', '{"orders":1,"fulfilment":2,"returns":1,"customers":0,"money":0,"stock":1,"warehouse":2}'::jsonb),
  ('merchandiser', '{"orders":1,"customers":0,"money":1,"insights":1,"stock":1,"merch":3}'::jsonb),
  ('care', '{"orders":2,"intake":2,"finance":0,"fulfilment":1,"shipping":1,"returns":2,"customers":2,"money":1,"insights":1,"stock":1}'::jsonb),
  ('finance', '{"orders":2,"intake":1,"finance":3,"fulfilment":1,"shipping":1,"returns":1,"customers":1,"money":3,"insights":2,"stock":1,"procurement":1}'::jsonb),
  ('fulfilment', '{"orders":1,"fulfilment":2,"shipping":1,"returns":1,"customers":1,"money":0,"stock":1,"warehouse":2}'::jsonb),
  ('shipping', '{"orders":2,"fulfilment":1,"shipping":2,"returns":1,"customers":2,"money":1,"insights":1}'::jsonb),
  ('returns', '{"orders":1,"fulfilment":1,"shipping":1,"returns":2,"customers":1,"money":1,"stock":1,"warehouse":1}'::jsonb),
  ('marketing', '{"orders":1,"customers":0,"money":1,"insights":1,"stock":1,"merch":2}'::jsonb),
  ('viewer', '{"orders":1,"intake":1,"finance":1,"fulfilment":1,"shipping":1,"returns":1,"customers":2,"money":1,"insights":1,"channels":1,"team":1,"settings":1,"stock":1,"procurement":1,"warehouse":1,"merch":1}'::jsonb)
)
UPDATE "users" t SET scopes = COALESCE(
  (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(t.scopes) e WHERE NOT (o.preset ? e.key AND o.preset -> e.key = e.value)),
  '{}'::jsonb
)
FROM old o WHERE o.role = t.role;
--> statement-breakpoint
WITH old(role, preset) AS (VALUES
  ('admin', '{"orders":3,"intake":3,"finance":3,"fulfilment":3,"shipping":3,"returns":3,"customers":3,"money":3,"insights":3,"channels":3,"team":3,"settings":3,"stock":3,"procurement":3,"warehouse":3,"merch":3}'::jsonb),
  ('ops', '{"orders":3,"intake":3,"finance":2,"fulfilment":3,"shipping":3,"returns":3,"customers":2,"money":2,"insights":3,"channels":2,"team":1,"settings":3,"stock":2,"procurement":1,"warehouse":3,"merch":1}'::jsonb),
  ('supply', '{"orders":1,"fulfilment":1,"shipping":1,"returns":1,"customers":0,"money":2,"insights":2,"channels":1,"settings":2,"stock":3,"procurement":3,"warehouse":3,"merch":2}'::jsonb),
  ('planner', '{"orders":1,"customers":0,"money":2,"insights":2,"stock":3,"procurement":2,"warehouse":1,"merch":1}'::jsonb),
  ('buyer', '{"orders":1,"customers":0,"money":2,"insights":1,"stock":1,"procurement":2,"warehouse":1}'::jsonb),
  ('warehouse', '{"orders":1,"fulfilment":2,"returns":1,"customers":0,"money":0,"stock":1,"warehouse":2}'::jsonb),
  ('merchandiser', '{"orders":1,"customers":0,"money":1,"insights":1,"stock":1,"merch":3}'::jsonb),
  ('care', '{"orders":2,"intake":2,"finance":0,"fulfilment":1,"shipping":1,"returns":2,"customers":2,"money":1,"insights":1,"stock":1}'::jsonb),
  ('finance', '{"orders":2,"intake":1,"finance":3,"fulfilment":1,"shipping":1,"returns":1,"customers":1,"money":3,"insights":2,"stock":1,"procurement":1}'::jsonb),
  ('fulfilment', '{"orders":1,"fulfilment":2,"shipping":1,"returns":1,"customers":1,"money":0,"stock":1,"warehouse":2}'::jsonb),
  ('shipping', '{"orders":2,"fulfilment":1,"shipping":2,"returns":1,"customers":2,"money":1,"insights":1}'::jsonb),
  ('returns', '{"orders":1,"fulfilment":1,"shipping":1,"returns":2,"customers":1,"money":1,"stock":1,"warehouse":1}'::jsonb),
  ('marketing', '{"orders":1,"customers":0,"money":1,"insights":1,"stock":1,"merch":2}'::jsonb),
  ('viewer', '{"orders":1,"intake":1,"finance":1,"fulfilment":1,"shipping":1,"returns":1,"customers":2,"money":1,"insights":1,"channels":1,"team":1,"settings":1,"stock":1,"procurement":1,"warehouse":1,"merch":1}'::jsonb)
)
UPDATE "invitations" t SET scopes = COALESCE(
  (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(t.scopes) e WHERE NOT (o.preset ? e.key AND o.preset -> e.key = e.value)),
  '{}'::jsonb
)
FROM old o WHERE o.role = t.role;
