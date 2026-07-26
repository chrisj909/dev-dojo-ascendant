-- The roster cap, enforced by the database. GDD §4.1, SPEC §7 test 3.
--
-- GDD §4.1: "Hard cap. This is a dojo, not a barracks. The cap is what makes
-- each student legible and each graduation meaningful — you feel the empty
-- mat." A cap checked only in whichever code path remembers to check it is a
-- convention, not a cap. This is the same argument as the RLS policies: the
-- database is where an invariant belongs when breaking it corrupts the game.
--
-- SPEC §7 test 3 names three routes past it — recruiting, poaching, and
-- graduation reversal. They are two SQL operations, so one trigger covers all
-- three:
--
--   recruiting           INSERT
--   poaching             UPDATE of dojo_id       (Phase 5, GDD §8.4)
--   graduation reversal  UPDATE of is_graduated  (Phase 6, GDD §9.1)

-- Seed the caps from ROSTER_CAP_BY_TIER = [8, 9, 10, 11, 12].
-- `npm run db:seed` rewrites these from lib/constants.ts, and an integration
-- test asserts the two agree — a number living in both a migration and a
-- constants file is exactly how STARTING_TUITION drifted for a whole phase.
INSERT INTO public.roster_caps (tier, cap) VALUES (0, 8), (1, 9), (2, 10), (3, 11), (4, 12)
  ON CONFLICT (tier) DO UPDATE SET cap = excluded.cap;
--> statement-breakpoint

-- World-readable reference data, like regions. RLS on so `app_user` is held to
-- the read-only policy; FORCE deliberately off so seeding as the owner works.
ALTER TABLE public.roster_caps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS roster_caps_world_read ON public.roster_caps;--> statement-breakpoint
CREATE POLICY roster_caps_world_read ON public.roster_caps FOR SELECT USING (true);--> statement-breakpoint
GRANT SELECT ON public.roster_caps TO app_user;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.enforce_roster_cap() RETURNS trigger
  LANGUAGE plpgsql
  -- SECURITY DEFINER so the count is the TRUE count. Running as the caller,
  -- row-level security would hide other players' rows and — worse — hide the
  -- caller's own rows from any context without an identity set, so the trigger
  -- would cheerfully report a roster of zero and let the cap be blown past.
  -- An integrity check must see everything or it is not one.
  SECURITY DEFINER
  -- SECURITY DEFINER without a pinned search_path is a privilege-escalation
  -- hole: the caller controls resolution and can shadow `count` or a table.
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  dojo_tier  int;
  allowed    int;
  in_use     int;
BEGIN
  -- A graduate has left the roster permanently (GDD §9.1), so they never
  -- consume a place and nothing needs checking.
  IF NEW.is_graduated THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only the two transitions that can consume a place matter:
  -- arriving in a different dojo, or ceasing to be graduated. Everything else
  -- (a drill, an injury, a loyalty tick) must not pay for this check.
  IF TG_OP = 'UPDATE'
     AND OLD.dojo_id = NEW.dojo_id
     AND OLD.is_graduated = NEW.is_graduated THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO dojo_tier FROM public.dojos WHERE id = NEW.dojo_id;
  IF dojo_tier IS NULL THEN
    -- No such dojo. The foreign key will reject this; do not mask it with a
    -- confusing message about capacity.
    RETURN NEW;
  END IF;

  -- Serialise per dojo. Without this, two concurrent recruits both read
  -- cap - 1 under READ COMMITTED and both succeed, which is precisely the
  -- "hard cap" that turns out not to be hard. The lock is released at the end
  -- of the transaction and is scoped to one dojo, so unrelated players never
  -- contend.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.dojo_id::text));

  SELECT cap INTO allowed FROM public.roster_caps WHERE tier = dojo_tier;
  IF allowed IS NULL THEN
    -- A tier with no configured cap. Fail closed on the lowest cap rather than
    -- letting an unconfigured tier mean "unlimited".
    SELECT min(cap) INTO allowed FROM public.roster_caps;
  END IF;

  SELECT count(*) INTO in_use
  FROM public.students
  WHERE dojo_id = NEW.dojo_id
    AND is_graduated = false
    AND id <> NEW.id;

  IF in_use + 1 > allowed THEN
    RAISE EXCEPTION
      'roster cap exceeded: this dojo allows % active students at tier %', allowed, dojo_tier
      USING ERRCODE = 'check_violation',
            HINT = 'Graduate a student, or raise the dojo tier.';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS students_roster_cap ON public.students;--> statement-breakpoint
CREATE TRIGGER students_roster_cap
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION app.enforce_roster_cap();
