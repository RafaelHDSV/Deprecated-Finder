import { oldGreeting } from '../legacy-api'

export function formatBannerSubtitle(): string {
  return oldGreeting('visitor')
}
