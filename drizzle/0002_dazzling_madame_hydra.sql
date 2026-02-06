ALTER TABLE "worker_iterations" ADD COLUMN "observer_output" jsonb;--> statement-breakpoint
ALTER TABLE "worker_iterations" DROP COLUMN "observer_observations";