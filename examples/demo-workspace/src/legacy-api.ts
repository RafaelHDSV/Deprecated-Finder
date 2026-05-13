/**
 * Prefer formatUserGreeting for user-facing strings.
 * @deprecated use formatUserGreeting instead
 */
export function oldGreeting(name: string): string {
  return `Hello, ${name}`
}

export function formatUserGreeting(name: string): string {
  return `Hi there, ${name}!`
}

/** @deprecated use LIMIT_CAP instead */
export const MAX_ITEMS = 10

export const LIMIT_CAP = 100
