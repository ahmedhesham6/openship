-- Default deploy target for new deployments. Nullable so existing rows mean
-- "no preference" — the deploy picker falls back to auto-selection (single
-- target wins, otherwise the user picks). Stored as text rather than an
-- enum so adding a new target later is a no-op for the DB.
ALTER TABLE "user_settings" ADD COLUMN "default_deploy_target" text;--> statement-breakpoint

-- Companion to default_deploy_target='server'. Free-form text (not an FK)
-- so the row survives the referenced server being deleted; the deploy
-- picker silently drops the default when the id no longer resolves.
ALTER TABLE "user_settings" ADD COLUMN "default_server_id" text;
