CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_dojo_id" uuid NOT NULL,
	"parent_dojo_id" uuid,
	"parent_branch_id" uuid,
	"founder_name" text NOT NULL,
	"generation" integer NOT NULL,
	"region_id" uuid NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"own_graduates" integer DEFAULT 0 NOT NULL,
	"style_vector" jsonb NOT NULL,
	"patronized" boolean DEFAULT false NOT NULL,
	"loyalty" double precision DEFAULT 70 NOT NULL,
	"founded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_graduation_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attacker_dojo_id" uuid NOT NULL,
	"defender_dojo_id" uuid NOT NULL,
	"seed" bigint NOT NULL,
	"attacker_snapshot" jsonb NOT NULL,
	"defender_snapshot" jsonb NOT NULL,
	"result" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dojos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"region_id" uuid NOT NULL,
	"tuition" bigint DEFAULT 500 NOT NULL,
	"energy" integer NOT NULL,
	"energy_updated_at" timestamp with time zone NOT NULL,
	"focus" integer NOT NULL,
	"focus_updated_at" timestamp with time zone NOT NULL,
	"style_vector" jsonb DEFAULT '{"striking":0,"grappling":0,"internal":0,"weapons":0,"aggression":0,"patience":0,"precision":0,"power":0}'::jsonb NOT NULL,
	"style_crystallized" boolean DEFAULT false NOT NULL,
	"style_name" text,
	"reputation" integer DEFAULT 0 NOT NULL,
	"shield_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dojos_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "drill_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"dojo_id" uuid NOT NULL,
	"category" text NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dojo_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"headmaster_name" text NOT NULL,
	"nationality" text NOT NULL,
	"technique" integer DEFAULT 5 NOT NULL,
	"mental" integer DEFAULT 5 NOT NULL,
	"presence" integer DEFAULT 5 NOT NULL,
	"stamina" integer DEFAULT 5 NOT NULL,
	"discipline" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "players_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"recruit_quality" integer NOT NULL,
	"scroll_families" text[] NOT NULL,
	"character_vector" jsonb NOT NULL,
	"unlock_tier" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "scrolls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dojo_id" uuid NOT NULL,
	"family" text NOT NULL,
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dojo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strength" integer NOT NULL,
	"speed" integer NOT NULL,
	"technique" integer NOT NULL,
	"stamina" integer NOT NULL,
	"mental" integer NOT NULL,
	"apt_striking" integer NOT NULL,
	"apt_grappling" integer NOT NULL,
	"apt_internal" integer NOT NULL,
	"apt_weapons" integer NOT NULL,
	"temperament" text NOT NULL,
	"background" text DEFAULT '' NOT NULL,
	"belt" integer DEFAULT 0 NOT NULL,
	"curriculum_stage" integer DEFAULT 0 NOT NULL,
	"curriculum_progress" integer DEFAULT 0 NOT NULL,
	"loyalty" integer DEFAULT 70 NOT NULL,
	"condition" text DEFAULT 'healthy' NOT NULL,
	"recovers_at" timestamp with time zone,
	"injury_count" integer DEFAULT 0 NOT NULL,
	"poachable_until" timestamp with time zone,
	"is_graduated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "techniques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dojo_id" uuid NOT NULL,
	"family" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_root_dojo_id_dojos_id_fk" FOREIGN KEY ("root_dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_dojo_id_dojos_id_fk" FOREIGN KEY ("parent_dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_branch_id_fk" FOREIGN KEY ("parent_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_attacker_dojo_id_dojos_id_fk" FOREIGN KEY ("attacker_dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_defender_dojo_id_dojos_id_fk" FOREIGN KEY ("defender_dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dojos" ADD CONSTRAINT "dojos_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dojos" ADD CONSTRAINT "dojos_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill_log" ADD CONSTRAINT "drill_log_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill_log" ADD CONSTRAINT "drill_log_dojo_id_dojos_id_fk" FOREIGN KEY ("dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_dojo_id_dojos_id_fk" FOREIGN KEY ("dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrolls" ADD CONSTRAINT "scrolls_dojo_id_dojos_id_fk" FOREIGN KEY ("dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_dojo_id_dojos_id_fk" FOREIGN KEY ("dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "techniques" ADD CONSTRAINT "techniques_dojo_id_dojos_id_fk" FOREIGN KEY ("dojo_id") REFERENCES "public"."dojos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branches_root_idx" ON "branches" USING btree ("root_dojo_id");--> statement-breakpoint
CREATE INDEX "branches_region_idx" ON "branches" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "branches_parent_branch_idx" ON "branches" USING btree ("parent_branch_id");--> statement-breakpoint
CREATE INDEX "challenges_attacker_idx" ON "challenges" USING btree ("attacker_dojo_id");--> statement-breakpoint
CREATE INDEX "challenges_defender_idx" ON "challenges" USING btree ("defender_dojo_id");--> statement-breakpoint
CREATE INDEX "dojos_region_idx" ON "dojos" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "drill_log_dojo_idx" ON "drill_log" USING btree ("dojo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_dojo_kind_idx" ON "facilities" USING btree ("dojo_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "players_handle_lower_idx" ON "players" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "scrolls_dojo_family_index_idx" ON "scrolls" USING btree ("dojo_id","family","index");--> statement-breakpoint
CREATE INDEX "students_dojo_idx" ON "students" USING btree ("dojo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "techniques_dojo_family_idx" ON "techniques" USING btree ("dojo_id","family");