ALTER TABLE "graph_edges" DROP CONSTRAINT "graph_edges_source_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "graph_nodes" DROP CONSTRAINT "graph_nodes_source_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "graph_edges" DROP COLUMN "source_conversation_id";--> statement-breakpoint
ALTER TABLE "graph_nodes" DROP COLUMN "source_conversation_id";