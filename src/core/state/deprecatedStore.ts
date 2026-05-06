import { DeprecatedItem } from '../model/DeprecatedItem'

type Listener = () => void

class DeprecatedStore {
  private items: DeprecatedItem[] = []
  private listeners = new Set<Listener>()

  set(items: DeprecatedItem[]) {
    this.items = items
    this.emit()
  }

  updateFile(filePath: string, items: DeprecatedItem[]) {
    const normalized = normalizePath(filePath)
    this.items = this.items.filter(
      (item) => normalizePath(item.filePath) !== normalized
    )
    this.items.push(...items)
    this.emit()
  }

  removeFile(filePath: string) {
    const normalized = normalizePath(filePath)
    this.items = this.items.filter(
      (item) => normalizePath(item.filePath) !== normalized
    )
    this.emit()
  }

  getAll(): DeprecatedItem[] {
    return this.items
  }

  getById(id: string): DeprecatedItem | undefined {
    return this.items.find((item) => item.id === id)
  }

  clear() {
    this.items = []
    this.emit()
  }

  onChange(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

export const deprecatedStore = new DeprecatedStore()
