import { DeprecatedItem } from '../model/DeprecatedItem'

class DeprecatedStore {
  private items: DeprecatedItem[] = []

  set(items: DeprecatedItem[]) {
    this.items = items
  }

  getAll() {
    return this.items
  }

  clear() {
    this.items = []
  }
}

export const deprecatedStore = new DeprecatedStore()
