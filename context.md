# Contexto do projeto — Deprecated Finder

> Documento de contexto persistente. Lido automaticamente em todas as sessões de desenvolvimento (regra `ai-context.mdc`). Atualizar sempre que houver mudança estrutural relevante.

## Visão geral

Extensão VS Code / Cursor que:

1. Varre o workspace e detecta símbolos marcados com `@deprecated` no JSDoc.
2. Extrai do próprio texto da tag a sugestão de substituição.
3. Permite ao usuário corrigir cada ocorrência (ou todas) com um clique, atualizando identificador **e** import quando aplicável.
4. Re-escaneia automaticamente o arquivo salvo (não o workspace inteiro).
5. Lista também o **próprio símbolo** na declaração quando há `@deprecated` no JSDoc (não só usos), para APIs recém-marcadas sem chamadas no arquivo.
6. Oferece Quick Fix (lightbulb) no editor.

Linguagens suportadas: `.ts`, `.tsx`, `.js`, `.jsx`.

Issue de origem: `.issues/github/ISSUE-001-deprecated-finder.md`.

## Stack

- **npm** como gerenciador oficial (`package-lock.json`; CI com `npm ci`)
- Configurações `deprecatedFinder.showScanSummary` e `deprecatedFinder.verboseLogging` (`package.json` → Settings); diagnóstico verboso e avisos do scan no painel **Output → Deprecated Finder**
- Durante `scanForDeprecated`, saves disparam `scanSingleFile` em modo **fila + flush** (sem `updateFile` intermédio) — ver `context.md` fluxo e README **Scan behavior**
- TypeScript (`commonjs`, target ES2020)
- VS Code Extension API (`@types/vscode ^1.100`)
- TypeScript Compiler API (`typescript` em `dependencies`, runtime)
- ESLint + `typescript-eslint` + `@stylistic/eslint-plugin`
- Sem testes automatizados ainda

## Estrutura de pastas

```
src/
  extension.ts                          # entry point: comandos, listeners, providers
  logging/
    deprecatedFinderLog.ts              # Output channel; scan diagnostics / warn / error
  core/
    model/DeprecatedItem.ts             # tipos: DeprecatedItem, ImportInfo
    state/deprecatedStore.ts            # store em memória + pub/sub para a UI
    scanner/
      workspaceScanner.ts               # findFiles glob (.ts/.tsx/.js/.jsx)
      deprecatedScanner.ts              # ts.Program; scanForDeprecated() e scanSingleFile()
      tsDeprecatedScanner.ts            # AST visitor; @deprecated + resolução de props JSX pelo tipo da tag (ex.: antd Modal)
      suggestionParser.ts               # regex livres → suggestion: string | undefined
      importResolver.ts                 # identifica import de origem do símbolo
    fix/
      fixEngine.ts                      # WorkspaceEdit: identificador + import
    util/
      pathComparison.ts                 # normalizePathForComparison (Win vs POSIX)
  providers/
    DeprecatedViewProvider.ts           # webview da sidebar (lista agrupada por arquivo)
    DeprecatedCodeActionProvider.ts     # Quick Fix lightbulb no editor
  ui/
    deprecatedPanel.ts                  # WebviewPanel tabular alternativo
    deprecatedPanelHtml.ts              # HTML do painel tabular

out/                                    # build output (gitignored)
.vscode/                                # versionado: launch, tasks, extensions (recomendações)
.issues/github/                         # documentos de proposta/issue (gitignored)
```

## Fluxo de execução

### Coordenação scan completo vs incremental

Enquanto `scanForDeprecated` está ativo (`fullWorkspaceScanDepth > 0`), chamadas a `scanSingleFile` **não** fazem `deprecatedStore.updateFile` de imediato: o path entra numa fila deduplicada por `normalizePathForComparison`. Quando o scan completo mais externo termina (`finally` após `set`), corre-se **flush**: `scanSingleFile` para cada path em fila, atualizando ficheiros que mudaram durante o scan global. Evita lista “mista” (um ficheiro novo + resto antigo). Ver README **Scan behavior**.

```
ativação                ┐
   ↓                    │     re-scan manual              save de arquivo
scanForDeprecated()     │  scanForDeprecated()         scanSingleFile(uri)
   ↓                    │     ↓                            ↓
ts.createProgram        │  ts.createProgram             ts.Program (cache) ou novo
   ↓                    │     ↓                            ↓
tsDeprecatedScanner     │  tsDeprecatedScanner          tsDeprecatedScanner
   ↓                    │     ↓                            ↓
deprecatedStore.set()   │  deprecatedStore.set()        durante scan global: fila;
                        │     ↓                         após set: updateFile() no flush
                        │  store.onChange → re-render webview
```

## Convenções importantes

- **Sem semicolons** no código TS (convenção pré-existente do projeto). ESLint ainda emite warnings de `@stylistic/semi`, mas é apenas warn.
- **Aspas simples** em strings.
- Indentação: **2 espaços**.
- Comentários só onde explicam intent / trade-off, nunca narrando o código.
- Logs de debug usam o prefixo `[Deprecated Finder]`.
- **Comparação de caminhos** entre APIs (VS Code / TypeScript): ver `CONTRIBUTING.md` e `src/core/util/pathComparison.ts` (`normalizePathForComparison`).

## Comandos VS Code expostos

Comandos com **Não** em «Visível na palette» usam `when: false` em `package.json` para não poluir `Ctrl+Shift+P`; continuam acessíveis pela webview, Quick Fix e `executeCommand`.

| ID | Título (palette) | Visível na palette? | Como é invocado |
|---|---|---|---|
| `deprecatedFinder.scan` | Deprecated Finder: Scan workspace | Sim | Palette; botão **Re-scan** na sidebar ou painel tabular |
| `deprecatedFinder.openPanel` | Deprecated Finder: Open panel | Sim | Palette (ou atalho definido pelo utilizador) |
| `deprecatedFinder.fixAll` | Deprecated Finder: Fix all | Sim | Palette; **Fix all** na sidebar ou painel tabular |
| `deprecatedFinder.fixItem` | Deprecated Finder: Fix item | Não | **Fix** na sidebar/painel; Quick Fix no editor. Args: `itemId: string` |
| `deprecatedFinder.openFile` | Deprecated Finder: Open file at line | Não | Clique numa linha de resultado. Args: `filePath` (absoluto), `line` (1-based) |

## Padrões de sugestão reconhecidos no `@deprecated`

`use X instead`, `replaced by X`, `replaced with X`, `in favor of X`, `utilize X`, `prefer X`, `{@link X}`. Quando nenhum padrão bate, `suggestion` é `undefined` e o botão Fix fica desabilitado.

## Progresso na varredura

- Fase **indeterminada** enquanto o TypeScript monta o `Program` (`createProgram`), onde o custo costuma concentrar-se em workspaces grandes.
- Fase **determinada** (`analisando i / N` arquivos raiz) durante o passe que lê cada `SourceFile` do workspace.

## Limitações conhecidas (v0.1)

- Re-escrita de import só funciona para imports diretos no mesmo arquivo (named, default, namespace). Barrel files / re-exports não são tratados.
- Quando a API substituta tem assinatura diferente, o fix substitui apenas o nome — usuário precisa revisar parâmetros manualmente.
- Não há cache persistente entre sessões.
- Sem testes automatizados ainda.

## Build & publicação

```bash
npm install          # ou `npm ci` em clone limpo (igual ao CI)
npm run compile      # tsc → ./out
npm run lint
```

Para empacotar: `npx vsce package`. Para publicar no Marketplace: `npx vsce publish` (requer publisher configurado).

Depurar no VS Code/Cursor: configuração **Run Extension** em `.vscode/launch.json` (tarefa padrão de build: `npm run watch` via `tasks.json`).

O Cursor é compatível nativamente com extensões `.vsix` e do Marketplace — não há build/publish separado.
