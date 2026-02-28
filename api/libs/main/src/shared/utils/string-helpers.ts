/**
 * String helper utilities shared across services.
 */

/**
 * Escapes special regex characters in a string.
 * Use when building regex patterns from user input.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gets the prefixed collection name based on SHARED_PREFIX env var.
 * All collections are prefixed: {SHARED_PREFIX}_{collection_name}
 */
export function getCollectionName(name: string): string {
  return process.env.SHARED_PREFIX ? `${process.env.SHARED_PREFIX}_${name}` : name;
}
