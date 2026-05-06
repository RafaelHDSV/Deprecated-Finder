export interface ImportInfo {
  moduleSpecifier: string
  importedName: string
  isDefault: boolean
  isNamespace: boolean
}

export interface DeprecatedItem {
  id: string
  name: string
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  message?: string
  suggestion?: string
  importInfo?: ImportInfo
  source: 'typescript' | 'jsdoc'
}
