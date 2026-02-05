import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  primaryKey,
  jsonb,
  index,
  type AnyPgColumn,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

// ============================================================================
// NextAuth.js Required Tables
// ============================================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ],
);

// ============================================================================
// Application Tables
// ============================================================================

export const userApiKeys = pgTable("user_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // 'openai', 'anthropic'
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose"),
    // Phase-specific system prompts (multi-phase architecture)
    conversationSystemPrompt: text("conversation_system_prompt").notNull(),
    classificationSystemPrompt: text("classification_system_prompt").notNull(),
    insightSynthesisSystemPrompt: text("insight_synthesis_system_prompt").notNull(),
    graphConstructionSystemPrompt: text("graph_construction_system_prompt").notNull(),
    status: text("status").notNull().default("active"), // 'active', 'paused', 'archived'
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("entities_user_id_idx").on(table.userId)],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'llm' | 'summary'
  content: jsonb("content").notNull(), // JSON structure depends on role (see MessageContent types)
  previousMessageId: uuid("previous_message_id").references(
    (): AnyPgColumn => messages.id,
  ), // Linked list for compaction
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'preference' | 'insight' | 'fact'
  content: text("content").notNull(),
  sourceMessageId: uuid("source_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const inboxItems = pgTable("inbox_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  briefingId: uuid("briefing_id").references(() => briefings.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(), // 'briefing' | 'feedback' | 'insight'
  title: text("title").notNull(),
  content: text("content").notNull(),
  readAt: timestamp("read_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("briefings_user_id_idx").on(table.userId),
    index("briefings_entity_id_idx").on(table.entityId),
  ],
);

// ============================================================================
// LLM Interactions (Background Trace)
// ============================================================================

export const llmInteractions = pgTable(
  "llm_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    systemPrompt: text("system_prompt").notNull(),
    phase: text("phase"), // 'classification' | 'insight_synthesis' | 'graph_construction'
    request: jsonb("request").notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (table) => [
    index("llm_interactions_entity_id_idx").on(table.entityId),
    index("llm_interactions_created_at_idx").on(table.createdAt),
  ],
);

// ============================================================================
// Knowledge Graph Type System
// ============================================================================

export const graphNodeTypes = pgTable(
  "graph_node_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }), // NULL = global type
    name: text("name").notNull(), // PascalCase, e.g., "Company", "Asset"
    description: text("description").notNull(),
    propertiesSchema: jsonb("properties_schema").notNull(), // JSON Schema for validation
    exampleProperties: jsonb("example_properties"), // For LLM few-shot learning
    notifyUser: boolean("notify_user").notNull().default(false), // Whether creating nodes of this type should notify user
    createdBy: text("created_by").notNull().default("system"), // 'system' | 'agent' | 'user'
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("graph_node_types_entity_id_idx").on(table.entityId)],
);

export const graphEdgeTypes = pgTable(
  "graph_edge_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }), // NULL = global type
    name: text("name").notNull(), // snake_case, e.g., "issued_by", "affects"
    description: text("description").notNull(),
    propertiesSchema: jsonb("properties_schema"), // JSON Schema for edge properties
    exampleProperties: jsonb("example_properties"), // For LLM few-shot learning
    createdBy: text("created_by").notNull().default("system"), // 'system' | 'agent' | 'user'
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("graph_edge_types_entity_id_idx").on(table.entityId)],
);

// Junction tables for edge type -> node type constraints (many-to-many)
export const graphEdgeTypeSourceTypes = pgTable(
  "graph_edge_type_source_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    edgeTypeId: uuid("edge_type_id")
      .notNull()
      .references(() => graphEdgeTypes.id, { onDelete: "cascade" }),
    nodeTypeId: uuid("node_type_id")
      .notNull()
      .references(() => graphNodeTypes.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("graph_edge_type_source_types_edge_idx").on(table.edgeTypeId),
    index("graph_edge_type_source_types_node_idx").on(table.nodeTypeId),
  ],
);

export const graphEdgeTypeTargetTypes = pgTable(
  "graph_edge_type_target_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    edgeTypeId: uuid("edge_type_id")
      .notNull()
      .references(() => graphEdgeTypes.id, { onDelete: "cascade" }),
    nodeTypeId: uuid("node_type_id")
      .notNull()
      .references(() => graphNodeTypes.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("graph_edge_type_target_types_edge_idx").on(table.edgeTypeId),
    index("graph_edge_type_target_types_node_idx").on(table.nodeTypeId),
  ],
);

// ============================================================================
// Knowledge Graph Data
// ============================================================================

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // References graphNodeTypes.name
    name: text("name").notNull(), // Human-readable identifier
    properties: jsonb("properties").notNull().default({}), // Validated against type schema; temporal fields live here
    sourceConversationId: uuid("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("graph_nodes_entity_id_idx").on(table.entityId),
    index("graph_nodes_type_idx").on(table.type),
    index("graph_nodes_entity_type_idx").on(table.entityId, table.type),
  ],
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // References graphEdgeTypes.name
    sourceId: uuid("source_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    properties: jsonb("properties").notNull().default({}), // Validated against type schema
    sourceConversationId: uuid("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("graph_edges_entity_id_idx").on(table.entityId),
    index("graph_edges_type_idx").on(table.type),
    index("graph_edges_source_id_idx").on(table.sourceId),
    index("graph_edges_target_id_idx").on(table.targetId),
  ],
);

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  apiKeys: many(userApiKeys),
  entities: many(entities),
  inboxItems: many(inboxItems),
  briefings: many(briefings),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const userApiKeysRelations = relations(userApiKeys, ({ one }) => ({
  user: one(users, {
    fields: [userApiKeys.userId],
    references: [users.id],
  }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  user: one(users, {
    fields: [entities.userId],
    references: [users.id],
  }),
  conversations: many(conversations),
  memories: many(memories),
  inboxItems: many(inboxItems),
  briefings: many(briefings),
  llmInteractions: many(llmInteractions),
  graphNodeTypes: many(graphNodeTypes),
  graphEdgeTypes: many(graphEdgeTypes),
  graphNodes: many(graphNodes),
  graphEdges: many(graphEdges),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    entity: one(entities, {
      fields: [conversations.entityId],
      references: [entities.id],
    }),
    messages: many(messages),
    graphNodes: many(graphNodes),
    graphEdges: many(graphEdges),
  }),
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  previousMessage: one(messages, {
    fields: [messages.previousMessageId],
    references: [messages.id],
    relationName: "messageChain",
  }),
  nextMessages: many(messages, {
    relationName: "messageChain",
  }),
  sourceMemories: many(memories),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  entity: one(entities, {
    fields: [memories.entityId],
    references: [entities.id],
  }),
  sourceMessage: one(messages, {
    fields: [memories.sourceMessageId],
    references: [messages.id],
  }),
}));

export const inboxItemsRelations = relations(inboxItems, ({ one }) => ({
  user: one(users, {
    fields: [inboxItems.userId],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [inboxItems.entityId],
    references: [entities.id],
  }),
  briefing: one(briefings, {
    fields: [inboxItems.briefingId],
    references: [briefings.id],
  }),
}));

export const briefingsRelations = relations(briefings, ({ one }) => ({
  user: one(users, {
    fields: [briefings.userId],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [briefings.entityId],
    references: [entities.id],
  }),
}));

export const llmInteractionsRelations = relations(
  llmInteractions,
  ({ one }) => ({
    entity: one(entities, {
      fields: [llmInteractions.entityId],
      references: [entities.id],
    }),
  }),
);

// ============================================================================
// Knowledge Graph Relations
// ============================================================================

export const graphNodeTypesRelations = relations(graphNodeTypes, ({ one }) => ({
  entity: one(entities, {
    fields: [graphNodeTypes.entityId],
    references: [entities.id],
  }),
}));

export const graphEdgeTypesRelations = relations(
  graphEdgeTypes,
  ({ one, many }) => ({
    entity: one(entities, {
      fields: [graphEdgeTypes.entityId],
      references: [entities.id],
    }),
    sourceTypes: many(graphEdgeTypeSourceTypes),
    targetTypes: many(graphEdgeTypeTargetTypes),
  }),
);

export const graphEdgeTypeSourceTypesRelations = relations(
  graphEdgeTypeSourceTypes,
  ({ one }) => ({
    edgeType: one(graphEdgeTypes, {
      fields: [graphEdgeTypeSourceTypes.edgeTypeId],
      references: [graphEdgeTypes.id],
    }),
    nodeType: one(graphNodeTypes, {
      fields: [graphEdgeTypeSourceTypes.nodeTypeId],
      references: [graphNodeTypes.id],
    }),
  }),
);

export const graphEdgeTypeTargetTypesRelations = relations(
  graphEdgeTypeTargetTypes,
  ({ one }) => ({
    edgeType: one(graphEdgeTypes, {
      fields: [graphEdgeTypeTargetTypes.edgeTypeId],
      references: [graphEdgeTypes.id],
    }),
    nodeType: one(graphNodeTypes, {
      fields: [graphEdgeTypeTargetTypes.nodeTypeId],
      references: [graphNodeTypes.id],
    }),
  }),
);

export const graphNodesRelations = relations(graphNodes, ({ one, many }) => ({
  entity: one(entities, {
    fields: [graphNodes.entityId],
    references: [entities.id],
  }),
  sourceConversation: one(conversations, {
    fields: [graphNodes.sourceConversationId],
    references: [conversations.id],
  }),
  outgoingEdges: many(graphEdges, { relationName: "sourceNode" }),
  incomingEdges: many(graphEdges, { relationName: "targetNode" }),
}));

export const graphEdgesRelations = relations(graphEdges, ({ one }) => ({
  entity: one(entities, {
    fields: [graphEdges.entityId],
    references: [entities.id],
  }),
  sourceNode: one(graphNodes, {
    fields: [graphEdges.sourceId],
    references: [graphNodes.id],
    relationName: "sourceNode",
  }),
  targetNode: one(graphNodes, {
    fields: [graphEdges.targetId],
    references: [graphNodes.id],
    relationName: "targetNode",
  }),
  sourceConversation: one(conversations, {
    fields: [graphEdges.sourceConversationId],
    references: [conversations.id],
  }),
}));
