ALTER TABLE "entities" ALTER COLUMN "conversation_system_prompt" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "classification_system_prompt" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "insight_synthesis_system_prompt" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "graph_construction_system_prompt" SET NOT NULL;