# Demo workspace — Deprecated Finder

Projeto **mínimo** (5 ficheiros `.ts`) para gravar vídeo ou testar a extensão **sem esperar** por scan de monorepo grande.

## Como usar

1. No VS Code / Cursor: **File → Open Folder…** e escolhe esta pasta (`examples/demo-workspace`).
2. Instala / ativa a extensão **Deprecated Finder**.
3. Abre a vista na activity bar: o scan deve completar em **segundos**.

## O que há aqui

- `src/legacy-api.ts` — `oldGreeting` e `MAX_ITEMS` com `@deprecated` e sugestões **`formatUserGreeting`** e **`LIMIT_CAP`** (nomes **distintos** dos símbolos novos, para o Fix All nos usos não colidir com as declarações já existentes).
- `src/app.ts`, `src/reports.ts`, `src/widgets/format-banner.ts` — **usos** dessas APIs.

Não é obrigatório correr `npm install` só para a demo da extensão (não há dependências npm).

## Depois de **Fix all** (lista completa ou filtrada)

Continuam a aparecer **até dois** itens em `legacy-api.ts`: os **sítios de declaração** de `oldGreeting` e `MAX_ITEMS` (APIs ainda marcadas como obsoletas no JSDoc). Isto é **esperado** — a extensão também lista o próprio símbolo deprecado, não só os usos.

Para a lista ficar **vazia** na demo, remove ou comenta esses exports antigos (ou tira o `@deprecated`) depois de migrares os usos — passo manual opcional para o vídeo.

## Gravação de vídeo

Combina com o roteiro em `docs/roteiro-video-demonstracao.md`. Para vídeo curto (~90 s), corta blocos opcionais (Settings/Output, painel tabular) e mantém: scan → lista → Fix um → pesquisa → Fix all filtrado.
