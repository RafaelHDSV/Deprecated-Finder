import { MAX_ITEMS, oldGreeting } from './legacy-api'

export function buildWelcome(user: string): string {
  return oldGreeting(user)
}

export function getLimit(): number {
  return MAX_ITEMS
}
