export interface DeprecatedItem {
  id: string
  name: string
  filePath: string
  line: number
  column: number
  message?: string
  source: 'typescript' | 'jsdoc'
}
