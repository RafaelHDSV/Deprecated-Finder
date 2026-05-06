import * as ts from 'typescript'
import { ImportInfo } from '../model/DeprecatedItem'

/**
 * Walks the source file imports and tries to find which import statement
 * brings the given symbol into scope. Returns the import info or undefined
 * when the symbol is not imported (e.g. globally declared, locally defined,
 * or imported in a way we don't track yet).
 *
 * `suggestedModule` is honored when present — it overrides the resolved
 * moduleSpecifier so callers can drive a module change as part of the fix.
 */
export function resolveImportInfo(
  sourceFile: ts.SourceFile,
  symbol: ts.Symbol,
  suggestedModule?: string
): ImportInfo | undefined {
  const symbolName = symbol.getName()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }

    const moduleSpecifier = getModuleSpecifier(statement)
    if (!moduleSpecifier) {
      continue
    }

    const clause = statement.importClause
    if (!clause) {
      continue
    }

    if (clause.name && clause.name.text === symbolName) {
      return {
        moduleSpecifier: suggestedModule ?? moduleSpecifier,
        importedName: symbolName,
        isDefault: true,
        isNamespace: false
      }
    }

    const namedBindings = clause.namedBindings
    if (!namedBindings) {
      continue
    }

    if (ts.isNamespaceImport(namedBindings)) {
      if (namedBindings.name.text === symbolName) {
        return {
          moduleSpecifier: suggestedModule ?? moduleSpecifier,
          importedName: symbolName,
          isDefault: false,
          isNamespace: true
        }
      }
      continue
    }

    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const localName = element.name.text
        const importedName = element.propertyName?.text ?? localName

        if (localName === symbolName) {
          return {
            moduleSpecifier: suggestedModule ?? moduleSpecifier,
            importedName,
            isDefault: false,
            isNamespace: false
          }
        }
      }
    }
  }

  return undefined
}

function getModuleSpecifier(node: ts.ImportDeclaration): string | undefined {
  if (!ts.isStringLiteral(node.moduleSpecifier)) {
    return undefined
  }
  return node.moduleSpecifier.text
}
