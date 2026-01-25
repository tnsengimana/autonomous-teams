CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"source_thread_id" uuid,
	"confidence" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "source" text DEFAULT 'delegation' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "next_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_source_thread_id_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insights_agent_id_idx" ON "insights" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "thread_messages_thread_id_idx" ON "thread_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "threads_agent_id_idx" ON "threads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agents_next_run_at_idx" ON "agents" USING btree ("next_run_at");