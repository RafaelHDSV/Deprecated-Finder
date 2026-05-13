# Demo workspace — Deprecated Finder

Projeto **mínimo** (5 ficheiros `.ts`) para gravar vídeo ou testar a extensão **sem esperar** por scan de monorepo grande.

## Como usar

1. No VS Code / Cursor: **File → Open Folder…** e escolhe esta pasta (`examples/demo-workspace`).
2. Instala / ativa a extensão **Deprecated Finder**.
3. Abre a vista na activity bar: o scan deve completar em **segundos**.

## O que há aqui

- `src/legacy-api.ts` — função e constante marcadas com `@deprecated` e sugestão em texto livre.
- `src/app.ts`, `src/reports.ts`, `src/widgets/format-banner.ts` — **usos** dessas APIs (várias ocorrências para listar, filtrar e **Fix all**).

Não é obrigatório correr `npm install` só para a demo da extensão (não há dependências npm).

## Gravação de vídeo

Combina com o roteiro em `docs/roteiro-video-demonstracao.md`. Para vídeo curto (~90 s), corta blocos opcionais (Settings/Output, painel tabular) e mantém: scan → lista → Fix um → pesquisa → Fix all filtrado.
