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

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  parentAgentId: uuid('parent_agent_id').references((): AnyPgColumn => agents.id, { onDelete: 'cascade' }), // null for team leads
  name: text('name').notNull(),
  role: text('role').notNull(),
  systemPrompt: text('system_prompt'),
  status: text('status').notNull().default('idle'), // 'idle', 'running', 'paused'
  nextRunAt: timestamp('next_run_at', { mode: 'date' }),
  lastCompletedAt: timestamp('last_completed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('agents_next_run_at_idx').on(table.nextRunAt),
]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user', 'assistant', 'system'
  content: text('content').notNull(),
  thinking: text('thinking'), // for extended thinking/reasoning
  sequenceNumber: integer('sequence_number').notNull(),
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
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'insight', 'question', 'alert', etc.
  title: text('title').notNull(),
  content: text('content').notNull(),
  readAt: timestamp('read_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const agentTasks = pgTable('agent_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  assignedToId: uuid('assigned_to_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  assignedById: uuid('assigned_by_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  task: text('task').notNull(),
  result: text('result'),
  status: text('status').notNull().default('pending'), // 'pending', 'in_progress', 'completed', 'failed'
  source: text('source').notNull().default('delegation'), // 'delegation' | 'user' | 'system' | 'self'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

// ============================================================================
// Threads and Insights (Background Work)
// ============================================================================

// Threads - ephemeral work sessions
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'), // 'active', 'completed', 'compacted'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
}, (table) => [
  index('threads_agent_id_idx').on(table.agentId),
]);

// Thread messages
export const threadMessages = pgTable('thread_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' (agent as user), 'assistant' (LLM response), 'system'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'),
  sequenceNumber: integer('sequence_number').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('thread_messages_thread_id_idx').on(table.threadId),
]);

// Insights - professional knowledge extracted from work threads
export const insights = pgTable('insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'fact', 'technique', 'pattern', 'lesson'
  content: text('content').notNull(),
  sourceThreadId: uuid('source_thread_id').references(() => threads.id, { onDelete: 'set null' }),
  confidence: real('confidence'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('insights_agent_id_idx').on(table.agentId),
]);

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  apiKeys: many(userApiKeys),
  teams: many(teams),
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

export const teamsRelations = relations(teams, ({ one, many }) => ({
  user: one(users, {
    fields: [teams.userId],
    references: [users.id],
  }),
  agents: many(agents),
  inboxItems: many(inboxItems),
  agentTasks: many(agentTasks),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  team: one(teams, {
    fields: [agents.teamId],
    references: [teams.id],
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
  assignedTasks: many(agentTasks, {
    relationName: 'assignedTasks',
  }),
  delegatedTasks: many(agentTasks, {
    relationName: 'delegatedTasks',
  }),
  threads: many(threads),
  insights: many(insights),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
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
  team: one(teams, {
    fields: [inboxItems.teamId],
    references: [teams.id],
  }),
  agent: one(agents, {
    fields: [inboxItems.agentId],
    references: [agents.id],
  }),
}));

export const agentTasksRelations = relations(agentTasks, ({ one }) => ({
  team: one(teams, {
    fields: [agentTasks.teamId],
    references: [teams.id],
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

export const threadsRelations = relations(threads, ({ one, many }) => ({
  agent: one(agents, {
    fields: [threads.agentId],
    references: [agents.id],
  }),
  messages: many(threadMessages),
  insights: many(insights),
}));

export const threadMessagesRelations = relations(threadMessages, ({ one }) => ({
  thread: one(threads, {
    fields: [threadMessages.threadId],
    references: [threads.id],
  }),
}));

export const insightsRelations = relations(insights, ({ one }) => ({
  agent: one(agents, {
    fields: [insights.agentId],
    references: [agents.id],
  }),
  sourceThread: one(threads, {
    fields: [insights.sourceThreadId],
    references: [threads.id],
  }),
}));
