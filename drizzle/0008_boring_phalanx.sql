ALTER TABLE "thread_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "threads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "thread_messages" CASCADE;--> statement-breakpoint
DROP TABLE "threads" CASCADE;--> statement-breakpoint
ALTER TABLE "knowledge_items" RENAME COLUMN "source_thread_id" TO "source_conversation_id";--> statement-breakpoint
ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_source_thread_id_threads_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "mode" text DEFAULT 'foreground' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tool_call_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "previous_message_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_previous_message_id_messages_id_fk" FOREIGN KEY ("previous_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "sequence_number";