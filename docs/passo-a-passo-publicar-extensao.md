# Passo a passo: publicar a extensão Deprecated Finder

Guia prático para gerar o `.vsix` localmente e publicar no **Visual Studio Marketplace** (VS Code e compatíveis, como Cursor). Ajuste nomes de publisher e IDs se forem diferentes dos teus.

---

## Pré-requisitos

1. **Conta Microsoft** ligada ao [Visual Studio Marketplace](https://marketplace.visualstudio.com/).
2. **Publisher** no Marketplace: cria em [Manage Publishers](https://marketplace.visualstudio.com/manage) se ainda não existir. O `publisher` em `package.json` tem de **coincidir** com o ID do publisher (hoje está `rafael` — altera se o teu for outro).
3. **Personal Access Token (PAT)** com permissão **Marketplace (Manage)**:
   - [Azure DevOps](https://dev.azure.com) → **User settings** → **Personal access tokens** → New token → escopo **Custom defined** → **Marketplace** → **Manage**.
   - Guarda o token num gestor de segredos; não commits no repositório.

4. **Node.js** e **npm** instalados (versão alinhada ao que usas no CI / no projeto).

---

## 1. Preparar o pacote no repositório

No diretório raiz do projeto:

```bash
npm ci
npm run compile
npm run lint
```

- O script `vscode:prepublish` em `package.json` já corre `npm run compile` antes de empacotar com a ferramenta oficial — útil para não publicar sem build.

Revisa antes de publicar:

- `version` em `package.json` (semver).
- `displayName`, `description`, `repository`, `license`, `engines.vscode`.
- `README.md` na raiz (o Marketplace mostra-o na página da extensão).
- `CHANGELOG.md` na raiz (recomendado pelo Marketplace; mantém o histórico de versões).
- Ícones em `media/` referenciados em `package.json`.

---

## 2. Instalar a ferramenta de empacotamento (`vsce`)

Usa o pacote mantido pela Microsoft:

```bash
npm install -g @vscode/vsce
```

Ou sem instalação global:

```bash
npx @vscode/vsce --version
```

---

## 3. Login no publisher (uma vez por máquina / token)

Define o token como variável de ambiente (PowerShell):

```powershell
$env:VSCE_PAT = "cole_aqui_o_pat"
```

No bash:

```bash
export VSCE_PAT="cole_aqui_o_pat"
```

Faz login (segue as instruções na consola):

```bash
npx @vscode/vsce login rafael
```

Substitui `rafael` pelo **ID exato** do teu publisher no Marketplace.

---

## 4. Gerar o ficheiro `.vsix` (instalação manual / teste)

```bash
npx @vscode/vsce package
```

Gera algo como `deprecated-finder-0.1.0.vsix` na raiz. Podes instalar em VS Code / Cursor:

- **Extensions** → **…** (menu) → **Install from VSIX…** → escolhe o ficheiro.

Útil para validar num segundo ambiente antes de publicar.

---

## 5. Publicar no Visual Studio Marketplace

Com o mesmo `VSCE_PAT` e já autenticado:

```bash
npx @vscode/vsce publish
```

Comportamento:

- Usa a `version` atual de `package.json`.
- Se a versão **já existir** no Marketplace, o publish falha — incrementa `version` (ex.: `0.1.1`) e volta a correr `publish`.

Bump explícito de versão antes de publicar:

```bash
npm version patch
npx @vscode/vsce publish
```

(`npm version` atualiza `package.json` e cria tag git se estiveres num repo git com working tree limpo — revê o comportamento antes de correr em branch partilhada.)

---

## 6. Depois de publicar

1. Abre a página da extensão no Marketplace e confirma README, ícone e descrição.
2. Testa **Install** a partir do Marketplace num perfil limpo ou segunda máquina.
3. Se usares **Open VSX** (VSCodium, etc.), o fluxo é outro (`npx ovsx publish` com token Open VSX) — só inclui este passo se quiseres suportar esse ecossistema.

---

## Checklist rápido

| Passo | Feito |
|--------|--------|
| `npm ci` + `compile` + `lint` | [ ] |
| `version` / changelog / README | [ ] |
| PAT com scope Marketplace (Manage) | [ ] |
| `vsce login <publisher>` | [ ] |
| `vsce package` e teste do `.vsix` | [ ] |
| `vsce publish` | [ ] |
| Verificação na página do Marketplace | [ ] |

---

## Problemas frequentes

- **“Publisher mismatch”** — o `publisher` em `package.json` tem de ser o mesmo ID que usaste no `vsce login`.
- **“Version already exists”** — sobe a versão em `package.json`.
- **Falha no `prepublish`** — corre `npm run compile` localmente e corrige erros de TypeScript antes de `package` / `publish`.
- **Token expirado** — gera novo PAT e volta a `vsce login`.

---

## Referências oficiais

- [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) (documentação VS Code).
- Pacote [`@vscode/vsce`](https://www.npmjs.com/package/@vscode/vsce).
