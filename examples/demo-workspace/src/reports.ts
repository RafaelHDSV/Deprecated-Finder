import { oldGreeting } from './legacy-api'

const lines: string[] = []

export function addLine(name: string) {
  lines.push(oldGreeting(name))
}

export function snapshot(): readonly string[] {
  return lines
}
