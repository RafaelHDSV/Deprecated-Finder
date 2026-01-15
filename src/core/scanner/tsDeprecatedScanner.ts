import * as ts from 'typescript'
import * as vscode from 'vscode'
import { DeprecatedItem } from '../model/DeprecatedItem'

export function scanFileForDeprecated(
  filePath: string,
  program: ts.Program,
  sourceFile: ts.SourceFile
): DeprecatedItem[] {
  const checker = program.getTypeChecker()
  const deprecatedItems: DeprecatedItem[] = []

  function visit(node: ts.Node) {
    if (!ts.isIdentifier(node)) {
      ts.forEachChild(node, visit)
      return
    }

    const symbol = checker.getSymbolAtLocation(node)
    if (!symbol) return

    const declarations = symbol.getDeclarations() ?? []

    const isDeprecated = declarations.some((decl) => {
      const jsDocTags = ts.getJSDocTags(decl)
      return jsDocTags.some((tag) => tag.tagName.text === 'deprecated')
    })

    if (isDeprecated) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart()
      )

      deprecatedItems.push({
        id: `${symbol.getName()}-${sourceFile.fileName}-${line}-${character}`,
        name: symbol.getName(),
        filePath,
        line: line + 1,
        column: character + 1,
        message: 'This API is deprecated',
        source: 'typescript'
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return deprecatedItems
}
