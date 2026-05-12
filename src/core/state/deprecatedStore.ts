import { DeprecatedItem } from '../model/DeprecatedItem'
import { normalizePathForComparison } from '../util/pathComparison'

type Listener = () => void

class DeprecatedStore {
  private items: DeprecatedItem[] = []
  private listeners = new Set<Listener>()

  set(items: DeprecatedItem[]) {
    this.items = items
    this.emit()
  }

  updateFile(filePath: string, items: DeprecatedItem[]) {
    const normalized = normalizePathForComparison(filePath)
    this.items = this.items.filter(
      (item) => normalizePathForComparison(item.filePath) !== normalized
    )
    this.items.push(...items)
    this.emit()
  }

  removeFile(filePath: string) {
    const normalized = normalizePathForComparison(filePath)
    this.items = this.items.filter(
      (item) => normalizePathForComparison(item.filePath) !== normalized
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

export const deprecatedStore = new DeprecatedStore()
