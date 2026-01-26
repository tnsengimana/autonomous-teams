import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  primaryKey,
  jsonb,
  real,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { AdapterAccountType } from 'next-auth/adapters';

// ============================================================================
// NextAuth.js Required Tables
// ============================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ]
);

// ============================================================================
// Application Tables
// ============================================================================

export const userApiKeys = pgTable('user_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'openai', 'anthropic'
  encryptedKey: text('encrypted_key').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  purpose: text('purpose'),
  status: text('status').notNull().default('active'), // 'active', 'paused', 'archived'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const aides = pgTable('aides', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  purpose: text('purpose'),
  status: text('status').notNull().default('active'), // 'active', 'paused', 'archived'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id')
    .references(() => teams.id, { onDelete: 'cascade' }), // NOW NULLABLE - agent belongs to team OR aide
  aideId: uuid('aide_id')
    .references(() => aides.id, { onDelete: 'cascade' }), // NEW - agent belongs to team OR aide
  parentAgentId: uuid('parent_agent_id').references((): AnyPgColumn => agents.id, { onDelete: 'cascade' }), // null for team leads
  name: text('name').notNull(),
  type: text('type').notNull(), // 'lead' | 'subordinate'
  systemPrompt: text('system_prompt'),
  status: text('status').notNull().default('idle'), // 'idle', 'running', 'paused'
  leadNextRunAt: timestamp('lead_next_run_at', { mode: 'date' }), // Only used for lead agents (team leads, aide leads)
  backoffNextRunAt: timestamp('backoff_next_run_at', { mode: 'date' }),
  backoffAttemptCount: integer('backoff_attempt_count').notNull().default(0),
  lastCompletedAt: timestamp('last_completed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('agents_lead_next_run_at_idx').on(table.leadNextRunAt),
  index('agents_backoff_next_run_at_idx').on(table.backoffNextRunAt),
  index('agents_aide_id_idx').on(table.aideId),
]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('foreground'), // 'foreground' | 'background'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'summary'
  content: text('content').notNull(),
  thinking: text('thinking'), // for extended thinking/reasoning
  toolCalls: jsonb('tool_calls'), // For assistant messages with tool calls
  toolCallId: text('tool_call_id'), // For tool role - links result to call
  previousMessageId: uuid('previous_message_id').references((): AnyPgColumn => messages.id), // Linked list for compaction
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'preference' | 'insight' | 'fact'
  content: text('content').notNull(),
  sourceMessageId: uuid('source_message_id').references(() => messages.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  briefingId: uuid('briefing_id').references(() => briefings.id, {
    onDelete: 'set null',
  }),
  type: text('type').notNull(), // 'briefing' | 'feedback'
  title: text('title').notNull(),
  content: text('content').notNull(),
  readAt: timestamp('read_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const briefings = pgTable(
  'briefings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').references(() => teams.id, {
      onDelete: 'cascade',
    }),
    aideId: uuid('aide_id').references(() => aides.id, {
      onDelete: 'cascade',
    }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('briefings_user_id_idx').on(table.userId),
    index('briefings_team_id_idx').on(table.teamId),
    index('briefings_aide_id_idx').on(table.aideId),
    index('briefings_agent_id_idx').on(table.agentId),
  ]
);

export const agentTasks = pgTable('agent_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id')
    .references(() => teams.id, { onDelete: 'cascade' }), // NOW NULLABLE - task belongs to team OR aide
  aideId: uuid('aide_id')
    .references(() => aides.id, { onDelete: 'cascade' }), // NEW - task belongs to team OR aide
  assignedToId: uuid('assigned_to_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  assignedById: uuid('assigned_by_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  task: text('task').notNull(),
  result: text('result'),
  status: text('status').notNull().default('pending'), // 'pending', 'completed'
  source: text('source').notNull().default('delegation'), // 'delegation' | 'user' | 'system' | 'self'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

// ============================================================================
// Knowledge Items (Professional Knowledge)
// ============================================================================

// Knowledge Items - professional knowledge extracted from background conversations
export const knowledgeItems = pgTable('knowledge_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'fact', 'technique', 'pattern', 'lesson'
  content: text('content').notNull(),
  sourceConversationId: uuid('source_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  confidence: real('confidence'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('knowledge_items_agent_id_idx').on(table.agentId),
]);

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  apiKeys: many(userApiKeys),
  teams: many(teams),
  aides: many(aides),
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

export const teamsRelations = relations(teams, ({ one, many }) => ({
  user: one(users, {
    fields: [teams.userId],
    references: [users.id],
  }),
  agents: many(agents),
  briefings: many(briefings),
  agentTasks: many(agentTasks),
}));

export const aidesRelations = relations(aides, ({ one, many }) => ({
  user: one(users, {
    fields: [aides.userId],
    references: [users.id],
  }),
  agents: many(agents),
  briefings: many(briefings),
  agentTasks: many(agentTasks),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  team: one(teams, {
    fields: [agents.teamId],
    references: [teams.id],
  }),
  aide: one(aides, {
    fields: [agents.aideId],
    references: [aides.id],
  }),
  parentAgent: one(agents, {
    fields: [agents.parentAgentId],
    references: [agents.id],
    relationName: 'agentHierarchy',
  }),
  childAgents: many(agents, {
    relationName: 'agentHierarchy',
  }),
  conversations: many(conversations),
  memories: many(memories),
  inboxItems: many(inboxItems),
  briefings: many(briefings),
  assignedTasks: many(agentTasks, {
    relationName: 'assignedTasks',
  }),
  delegatedTasks: many(agentTasks, {
    relationName: 'delegatedTasks',
  }),
  knowledgeItems: many(knowledgeItems),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  messages: many(messages),
  knowledgeItems: many(knowledgeItems),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  previousMessage: one(messages, {
    fields: [messages.previousMessageId],
    references: [messages.id],
    relationName: 'messageChain',
  }),
  nextMessages: many(messages, {
    relationName: 'messageChain',
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
  team: one(teams, {
    fields: [briefings.teamId],
    references: [teams.id],
  }),
  aide: one(aides, {
    fields: [briefings.aideId],
    references: [aides.id],
  }),
  agent: one(agents, {
    fields: [briefings.agentId],
    references: [agents.id],
  }),
}));

export const agentTasksRelations = relations(agentTasks, ({ one }) => ({
  team: one(teams, {
    fields: [agentTasks.teamId],
    references: [teams.id],
  }),
  aide: one(aides, {
    fields: [agentTasks.aideId],
    references: [aides.id],
  }),
  assignedTo: one(agents, {
    fields: [agentTasks.assignedToId],
    references: [agents.id],
    relationName: 'assignedTasks',
  }),
  assignedBy: one(agents, {
    fields: [agentTasks.assignedById],
    references: [agents.id],
    relationName: 'delegatedTasks',
  }),
}));

export const knowledgeItemsRelations = relations(knowledgeItems, ({ one }) => ({
  agent: one(agents, {
    fields: [knowledgeItems.agentId],
    references: [agents.id],
  }),
  sourceConversation: one(conversations, {
    fields: [knowledgeItems.sourceConversationId],
    references: [conversations.id],
  }),
}));
