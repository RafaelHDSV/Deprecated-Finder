# Passo a passo: publicar a extensão Deprecated Finder

Guia prático para gerar o `.vsix` localmente e publicar no **Visual Studio Marketplace** (VS Code e compatíveis, como Cursor). Ajuste nomes de publisher e IDs se forem diferentes dos teus.

---

## Pré-requisitos

1. **Conta Microsoft** ligada ao [Visual Studio Marketplace](https://marketplace.visualstudio.com/).
2. **Publisher** no Marketplace: cria em [Manage Publishers](https://marketplace.visualstudio.com/manage) se ainda não existir. O `publisher` em `package.json` tem de **coincidir** com o ID do publisher (hoje está `rafael` — altera se o teu for outro).
3. **Personal Access Token (PAT)** com permissão **Marketplace (Manage)** — o token **não** se cria no site do Marketplace; cria-se no **Azure DevOps** (conta Microsoft igual à do Marketplace). Vê a secção **[Azure DevOps e token (PAT)](#azure-devops-e-token-pat)** abaixo e, se não quiseres usar a CLI, **[Publicar só com o .vsix pelo site](#alternativa-publicar-apenas-com-o-vsix-pelo-site-do-marketplace)**.

4. **Node.js** e **npm** instalados (versão alinhada ao que usas no CI / no projeto).

---

## Azure DevOps e token (PAT)

O `dev.azure.com` por vezes “não deixa entrar” ou não mostra **Personal access tokens** até existir uma **organização** Azure DevOps (é gratuita e serve só como âncora para a tua conta).

1. **Criar uma organização** (se ainda não tiveres): segue [Create an organization](https://learn.microsoft.com/azure/devops/organizations/accounts/create-organization) (Microsoft Learn).
2. Abre o portal: [Azure DevOps](https://go.microsoft.com/fwlink/?LinkId=307137) (atalho oficial na documentação do VS Code) e **seleciona a organização**.
3. Canto **superior direito** → ícone da conta / **User settings** → **Personal access tokens** → **+ New Token**.
4. Em **Organizations**, escolhe **All accessible organizations** (recomendado para publicar no Marketplace; evita erro de permissão).
5. **Scopes** → **Custom defined** → **Show all scopes** → na lista, **Marketplace** → marca **Manage**.
6. **Create**, copia o token **na hora** (não volta a aparecer) e guarda-o num gestor de segredos.

**Atalho direto** (substitui `ORG` pelo nome da tua organização):

`https://dev.azure.com/ORG/_usersSettings/tokens`

**Se continuares bloqueado:** tenta janela **anónima/privada**, outro browser, ou desliga **VPN** / rede corporativa (alguns bloqueiam `dev.azure.com` ou o login Microsoft). Há relatos de **loop de login** a resolver com sessão limpa — vê [esta discussão](https://learn.microsoft.com/answers/questions/5823145/i-cant-get-a-pat-to-publish-extension-on-vscode) (Microsoft Q&A).

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

## Alternativa: publicar apenas com o `.vsix` pelo site do Marketplace

Se o objetivo é **só colocar a extensão no Marketplace** sem configurar PAT / `vsce login` na máquina:

1. Gera o pacote localmente: `npx @vscode/vsce package`.
2. Abre [Visual Studio Marketplace — Manage](https://marketplace.visualstudio.com/manage) e inicia sessão com a **mesma conta Microsoft** do publisher.
3. No painel do publisher, **cria a extensão** (se for a primeira vez) ou abre a extensão existente e usa a opção da interface para **carregar / atualizar** o ficheiro **`.vsix`** (o texto exacto do botão pode mudar).

Assim publicas **só com login web**; para automatizar (CI ou `vsce publish` na consola) o PAT continua a ser o método habitual.

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
| PAT com scope Marketplace (Manage) **ou** upload `.vsix` no site | [ ] |
| `vsce login <publisher>` (só se usares `vsce publish` na CLI) | [ ] |
| `vsce package` e teste do `.vsix` | [ ] |
| `vsce publish` | [ ] |
| Verificação na página do Marketplace | [ ] |

---

## Problemas frequentes

- **“Publisher mismatch”** — o `publisher` em `package.json` tem de ser o mesmo ID que usaste no `vsce login`.
- **“Version already exists”** — sobe a versão em `package.json`.
- **Falha no `prepublish`** — corre `npm run compile` localmente e corrige erros de TypeScript antes de `package` / `publish`.
- **Não consigo abrir o Azure DevOps / criar PAT** — cria primeiro uma [organização](https://learn.microsoft.com/azure/devops/organizations/accounts/create-organization); usa o portal [fwlink oficial](https://go.microsoft.com/fwlink/?LinkId=307137); em **Organizations** do token escolhe **All accessible organizations**; scope **Marketplace → Manage**. Se bastar uma publicação pontual, usa [upload do `.vsix` no Manage](#alternativa-publicar-apenas-com-o-vsix-pelo-site-do-marketplace).

---

## Referências oficiais

- [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) (documentação VS Code — inclui PAT e Marketplace).
- [Use personal access tokens](https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) (Azure DevOps).
- Pacote [`@vscode/vsce`](https://www.npmjs.com/package/@vscode/vsce).
