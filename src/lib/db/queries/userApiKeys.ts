import { eq, and } from 'drizzle-orm';
import { db } from '../client';
import { userApiKeys } from '../schema';
import type { UserApiKey, LLMProvider } from '@/lib/types';

/**
 * Get all API keys for a user
 */
export async function getUserApiKeys(userId: string): Promise<UserApiKey[]> {
  return db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId));
}

/**
 * Get API key for a specific provider
 */
export async function getUserApiKeyForProvider(
  userId: string,
  provider: LLMProvider
): Promise<UserApiKey | null> {
  const result = await db
    .select()
    .from(userApiKeys)
    .where(
      and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider))
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Create or update an API key for a provider
 */
export async function upsertUserApiKey(
  userId: string,
  provider: LLMProvider,
  encryptedKey: string
): Promise<UserApiKey> {
  const existing = await getUserApiKeyForProvider(userId, provider);

  if (existing) {
    await db
      .update(userApiKeys)
      .set({ encryptedKey, updatedAt: new Date() })
      .where(eq(userApiKeys.id, existing.id));

    return {
      ...existing,
      encryptedKey,
      updatedAt: new Date(),
    };
  }

  const result = await db
    .insert(userApiKeys)
    .values({
      userId,
      provider,
      encryptedKey,
    })
    .returning();

  return result[0];
}

/**
 * Delete an API key
 */
export async function deleteUserApiKey(
  userId: string,
  provider: LLMProvider
): Promise<void> {
  await db
    .delete(userApiKeys)
    .where(
      and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider))
    );
}

/**
 * Check if a user has an API key for a provider
 */
export async function hasApiKeyForProvider(
  userId: string,
  provider: LLMProvider
): Promise<boolean> {
  const key = await getUserApiKeyForProvider(userId, provider);
  return key !== null;
}

// ============================================================================
// Encryption utilities (placeholder - implement proper encryption in production)
// ============================================================================

/**
 * Encrypt an API key before storing
 * NOTE: This is a placeholder. In production, use proper encryption
 * with a secure key management system.
 */
export function encryptApiKey(apiKey: string): string {
  // TODO: Implement proper encryption using AES-256-GCM or similar
  // For now, just base64 encode (NOT secure for production!)
  return Buffer.from(apiKey).toString('base64');
}

/**
 * Decrypt an API key after retrieval
 * NOTE: This is a placeholder. In production, use proper decryption
 * with a secure key management system.
 */
export function decryptApiKey(encryptedKey: string): string {
  // TODO: Implement proper decryption
  // For now, just base64 decode
  return Buffer.from(encryptedKey, 'base64').toString('utf-8');
}
