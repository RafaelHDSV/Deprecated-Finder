# Roteiro: vídeo de demonstração (README, Marketplace, redes)

Objetivo: um vídeo curto e claro que mostre **problema → solução** e as funcionalidades principais do **Deprecated Finder**, para embeber no README (GitHub aceita ficheiros no repo + link ou GIF), na página do Marketplace e em posts (LinkedIn, etc.).

**Sugestão de duração total:** 2 a 4 minutos (até ~90 s se for só “teaser” para redes).

**Formato de exportação (README / web):** MP4 (H.264), 1920×1080 ou 1600×900, 30 fps, áudio claro ou legendas. Opcional: GIF curto (5–15 s) só para um trecho (ex.: Fix all), com tamanho de ficheiro controlado.

---

## Antes de gravar

1. **Workspace de demonstração:** projeto pequeno a médio com **vários** `@deprecated` reais ou de exemplo (ex.: props Ant Design, APIs com “use X instead” no JSDoc). Evita dados sensíveis (clientes, segredos).
2. **Tema do IDE:** claro ou escuro consistente; zoom da UI confortável (125–150% se necessário para leitura em mobile).
3. **Extensão:** build atual (`npm run compile`); se gravares contra o Host de desenvolvimento, garante que é a versão que queres mostrar.
4. **Limpeza:** fecha notificações irrelevantes; esconde painéis que não entram na história (Git, Problems), para não roubar foco.
5. **Áudio:** microfone estável; se não houver narração, prepara **legendas** ou texto sobreposto nos cortes.

---

## Estrutura do vídeo (roteiro)

### Bloco A — Abertura (15–30 s)

| Tempo aprox. | Imagem | Narração / texto no ecrã |
|----------------|--------|---------------------------|
| 0–10 s | Logo da extensão + ícone na activity bar | “Bibliotecas marcam APIs como deprecated no JSDoc — migrar à mão em centenas de ficheiros é lento e sujeito a erros.” |
| 10–20 s | Código com `@deprecated` no tooltip | “O Deprecated Finder junta tudo num só sítio e aplica a sugestão do autor da biblioteca.” |

**Call to action suave no fim do vídeo:** “Instala no VS Code / Cursor — link na descrição.”

---

### Bloco B — Scan e lista (45–60 s)

| Ordem | Ação no ecrã | O que dizer / legendar |
|-------|----------------|-------------------------|
| 1 | Abrir um workspace com `.ts` / `.tsx` | “Abro o projeto…” |
| 2 | Clicar no ícone **Deprecated Finder** na barra lateral | “A extensão varre o workspace.” |
| 3 | Mostrar a barra de progresso (incl. mensagens com grupo / tempo se for repo maior) | “Em projetos grandes vês progresso durante a compilação TypeScript.” |
| 4 | Lista agrupada por ficheiro com vários itens | “Cada linha é um uso (ou declaração) com `@deprecated`.” |

---

### Bloco C — Navegação e fix individual (30–45 s)

| Ordem | Ação no ecrã | O que dizer / legendar |
|-------|----------------|-------------------------|
| 1 | Clicar num item → salta para o ficheiro e linha | “Um clique abre o código.” |
| 2 | **Fix** num item com sugestão | “Corrijo uma ocorrência — identificador e import quando aplicável.” |
| 3 | (Opcional) Quick Fix `Ctrl+.` no editor | “Também podes usar o lightbulb no mesmo ficheiro.” |

---

### Bloco D — Pesquisa e Fix all filtrado (45–60 s)

| Ordem | Ação no ecrã | O que dizer / legendar |
|-------|----------------|-------------------------|
| 1 | Campo de pesquisa na sidebar — escrever parte do nome ou sugestão (ex.: fragmento da API) | “Filtro por símbolo, sugestão ou caminho.” |
| 2 | Mostrar o badge / contagem a mudar e **Fix all (N)** alinhado ao filtro | “O Fix all passa a valer só para o que está visível — útil para corrigir uma categoria de cada vez.” |
| 3 | Clicar **Fix all** (subconjunto) e esperar o progresso + toast | “Aplicação em lote e re-scan ao terminar.” |

**Nota para narração:** na paleta, “Fix all” sem contexto de filtro aplica ao store inteiro — só menciona se quiseres ser preciso para power users.

---

### Bloco E — Painel tabular (20–35 s)

| Ordem | Ação no ecrã | O que dizer / legendar |
|-------|----------------|-------------------------|
| 1 | Comando **Open panel** (paleta ou atalho se tiveres) | “Vista em tabela para ver tudo de relance.” |
| 2 | Pesquisa no painel + Fix all filtrado | “Mesmo fluxo de filtro e correção em massa.” |

---

### Bloco F — Settings e Output (20–30 s) — opcional

| Ordem | Ação no ecrã | O que dizer / legendar |
|-------|----------------|-------------------------|
| 1 | **Settings** → `deprecatedFinder.showScanSummary` / `verboseLogging` | “Controlas o toast de resumo e o log detalhado.” |
| 2 | **View → Output → Deprecated Finder** | “Diagnósticos e avisos do scan ficam aqui.” |

---

### Bloco G — Encerramento (10–20 s)

- Resumo numa frase: “Lista, filtra, corrige em massa, re-scan automático.”
- Ecrã final: nome da extensão + link GitHub / Marketplace + licença se quiseres.

---

## Checklist técnica na edição

- [ ] Cortar tempos mortos longos (especialmente scan grande — acelera ligeiramente ou mostra só início + fim com legenda “~2 min omitidos”).
- [ ] Cursor do rato visível; destaca cliques com highlight do gravador se possível.
- [ ] Música de fundo baixa ou ausente (Marketplace / README profissional).
- [ ] Legendas `.srt` ou texto embutido para ver sem som.
- [ ] Primeiro frame forte (thumbnail): logo + texto “Deprecated Finder”.

---

## Onde colocar o ficheiro no repositório

Sugestão:

- Vídeo: `docs/media/demo.mp4` (ou pasta `docs/videos/`) — adiciona `docs/media/` ao `.gitignore` **só se** o vídeo for muito grande para Git; nesse caso hospeda no GitHub **Releases**, Stream, ou YouTube não listado e linkas no README.
- README na raiz: secção **Demo** com link ou GIF.

Exemplo de snippet em `README.md`:

```markdown
## Demo

[Vídeo de demonstração (2 min)](./docs/media/demo.mp4)
```

---

## Variantes por canal

| Canal | Ajuste |
|--------|--------|
| **README / GitHub** | Vídeo curto ou GIF + link para versão longa no YouTube. |
| **Marketplace** | Usa o campo de vídeo do Marketplace (URL pública) se disponível na tua conta. |
| **LinkedIn** | 30–90 s, primeiros 3 s com gancho forte, legendas on. |

---

## Roteiro “uma página” (cola no teleprompter)

1. APIs deprecated no JSDoc — migração manual é chata.  
2. Deprecated Finder no VS Code / Cursor: ícone na barra lateral.  
3. Scan automático; lista por ficheiro; abrir código com um clique.  
4. Fix num item; opcional: Quick Fix no editor.  
5. Pesquisa; Fix all só no filtrado; depois re-scan.  
6. Painel em tabela com o mesmo fluxo.  
7. Settings e Output para quem quer controlo e diagnóstico.  
8. Instalação: Marketplace (ou link na descrição). Obrigado.
