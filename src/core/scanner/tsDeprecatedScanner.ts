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
    const symbol = checker.getSymbolAtLocation(node)

    if (symbol) {
      const tags = symbol.getJsDocTags()
      const deprecatedTag = tags.find((tag) => tag.name === 'deprecated')

      if (deprecatedTag) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        )

        deprecatedItems.push({
          id: `${symbol.getName()}-${line}-${character}`,
          name: symbol.getName(),
          filePath,
          line: line + 1,
          column: character + 1,
          message: deprecatedTag.text?.map((t) => t.text).join(' '),
          source: 'typescript'
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return deprecatedItems
}
