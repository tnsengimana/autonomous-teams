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

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose"),
    // Phase-specific system prompts (multi-phase architecture)
    conversationSystemPrompt: text("conversation_system_prompt").notNull(),
    observerSystemPrompt: text("observer_system_prompt").notNull(),
    analysisGenerationSystemPrompt: text("analysis_generation_system_prompt").notNull(),
    adviceGenerationSystemPrompt: text("advice_generation_system_prompt").notNull(),
    knowledgeAcquisitionSystemPrompt: text("knowledge_acquisition_system_prompt"),
    graphConstructionSystemPrompt: text("graph_construction_system_prompt").notNull(),
    // Worker iteration interval in milliseconds
    iterationIntervalMs: integer("iteration_interval_ms").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("agents_user_id_idx").on(table.userId)],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
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
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
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
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  readAt: timestamp("read_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ============================================================================
// Worker Iterations (Background Processing Cycles)
// ============================================================================

export const workerIterations = pgTable(
  "worker_iterations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"), // 'running' | 'completed' | 'failed'
    observerOutput: jsonb("observer_output"), // Stores { queries: ObserverQuery[], insights: ObserverInsight[] }
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (table) => [
    index("worker_iterations_agent_id_idx").on(table.agentId),
    index("worker_iterations_created_at_idx").on(table.createdAt),
  ],
);

// ============================================================================
// LLM Interactions (Background Trace)
// ============================================================================

export const llmInteractions = pgTable(
  "llm_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    workerIterationId: uuid("worker_iteration_id").references(
      () => workerIterations.id,
      { onDelete: "cascade" },
    ),
    systemPrompt: text("system_prompt").notNull(),
    phase: text("phase"), // 'observer' | 'knowledge_acquisition' | 'graph_construction' | 'analysis_generation' | 'advice_generation' | 'conversation'
    request: jsonb("request").notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (table) => [
    index("llm_interactions_agent_id_idx").on(table.agentId),
    index("llm_interactions_worker_iteration_id_idx").on(table.workerIterationId),
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
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }), // NULL = global type
    name: text("name").notNull(), // Capitalized name, spaces allowed (e.g., "Company", "Market Event")
    description: text("description").notNull(),
    justification: text("justification").notNull(), // Why this type exists and why existing types were insufficient
    propertiesSchema: jsonb("properties_schema").notNull(), // JSON Schema for validation
    exampleProperties: jsonb("example_properties"), // For LLM few-shot learning
    createdBy: text("created_by").notNull().default("system"), // 'system' | 'agent' | 'user'
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("graph_node_types_agent_id_idx").on(table.agentId)],
);

export const graphEdgeTypes = pgTable(
  "graph_edge_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }), // NULL = global type
    name: text("name").notNull(), // snake_case, e.g., "issued_by", "affects"
    description: text("description").notNull(),
    justification: text("justification").notNull(), // Why this relationship type exists and why existing types were insufficient
    propertiesSchema: jsonb("properties_schema"), // JSON Schema for edge properties
    exampleProperties: jsonb("example_properties"), // For LLM few-shot learning
    createdBy: text("created_by").notNull().default("system"), // 'system' | 'agent' | 'user'
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("graph_edge_types_agent_id_idx").on(table.agentId)],
);

// ============================================================================
// Knowledge Graph Data
// ============================================================================

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // References graphNodeTypes.name
    name: text("name").notNull(), // Human-readable identifier
    properties: jsonb("properties").notNull().default({}), // Validated against type schema; temporal fields live here
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("graph_nodes_agent_id_idx").on(table.agentId),
    index("graph_nodes_type_idx").on(table.type),
    index("graph_nodes_agent_type_idx").on(table.agentId, table.type),
  ],
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // References graphEdgeTypes.name
    sourceId: uuid("source_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    properties: jsonb("properties").notNull().default({}), // Validated against type schema
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("graph_edges_agent_id_idx").on(table.agentId),
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
  agents: many(agents),
  inboxItems: many(inboxItems),
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

export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, {
    fields: [agents.userId],
    references: [users.id],
  }),
  conversations: many(conversations),
  memories: many(memories),
  inboxItems: many(inboxItems),
  workerIterations: many(workerIterations),
  llmInteractions: many(llmInteractions),
  graphNodeTypes: many(graphNodeTypes),
  graphEdgeTypes: many(graphEdgeTypes),
  graphNodes: many(graphNodes),
  graphEdges: many(graphEdges),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    agent: one(agents, {
      fields: [conversations.agentId],
      references: [agents.id],
    }),
    messages: many(messages),
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
  agent: one(agents, {
    fields: [memories.agentId],
    references: [agents.id],
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
  agent: one(agents, {
    fields: [inboxItems.agentId],
    references: [agents.id],
  }),
}));

export const workerIterationsRelations = relations(
  workerIterations,
  ({ one, many }) => ({
    agent: one(agents, {
      fields: [workerIterations.agentId],
      references: [agents.id],
    }),
    llmInteractions: many(llmInteractions),
  }),
);

export const llmInteractionsRelations = relations(
  llmInteractions,
  ({ one }) => ({
    agent: one(agents, {
      fields: [llmInteractions.agentId],
      references: [agents.id],
    }),
    workerIteration: one(workerIterations, {
      fields: [llmInteractions.workerIterationId],
      references: [workerIterations.id],
    }),
  }),
);

// ============================================================================
// Knowledge Graph Relations
// ============================================================================

export const graphNodeTypesRelations = relations(graphNodeTypes, ({ one }) => ({
  agent: one(agents, {
    fields: [graphNodeTypes.agentId],
    references: [agents.id],
  }),
}));

export const graphEdgeTypesRelations = relations(
  graphEdgeTypes,
  ({ one }) => ({
    agent: one(agents, {
      fields: [graphEdgeTypes.agentId],
      references: [agents.id],
    }),
  }),
);

export const graphNodesRelations = relations(graphNodes, ({ one, many }) => ({
  agent: one(agents, {
    fields: [graphNodes.agentId],
    references: [agents.id],
  }),
  outgoingEdges: many(graphEdges, { relationName: "sourceNode" }),
  incomingEdges: many(graphEdges, { relationName: "targetNode" }),
}));

export const graphEdgesRelations = relations(graphEdges, ({ one }) => ({
  agent: one(agents, {
    fields: [graphEdges.agentId],
    references: [agents.id],
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
}));
