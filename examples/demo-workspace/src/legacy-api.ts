/**
 * Prefer {@link newGreeting} for user-facing strings.
 * @deprecated use newGreeting instead
 */
export function oldGreeting(name: string): string {
  return `Hello, ${name}`
}

export function newGreeting(name: string): string {
  return `Hi there, ${name}!`
}

/** @deprecated replaced by MAX_ITEMS_V2 */
export const MAX_ITEMS = 10

export const MAX_ITEMS_V2 = 100
