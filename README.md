# Dúvidas do Aulão

Plataforma para alunos enviarem dúvidas de forma anónima (para os colegas) durante um aulão de revisão, e praticarem com questões de escolha múltipla.

- Frontend: HTML + CSS + JavaScript puro (sem build), publicado no GitHub Pages.
- Backend: Supabase (Postgres + Auth + Realtime). Toda a segurança está em RLS e funções SQL — ver `supabase/schema.sql`.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | A página (todos os ecrãs). |
| `css/style.css` | Estilos (pensados para telemóvel). |
| `js/config.js` | **Project URL e chave publishable do Supabase.** |
| `js/app.js` | Conta (login/registo), ecrã de espera, navegação. |
| `js/forum.js` | Fórum de dúvidas. |
| `js/practice.js` | Prática com questões. |
| `js/admin.js`, `js/csv.js` | Painel da professora e importação CSV. |
| `js/themes.js`, `js/ui.js` | Seletores de tema e funções de interface. |
| `supabase/schema.sql` | Base de dados completa (pode ser corrida várias vezes). |
| `exemplos/questoes-exemplo.csv` | CSV de exemplo para importar questões. |
| `testes/ataque-aluno.js` | Teste de segurança para correr na consola do navegador. |

## 1. Configurar o Supabase (uma vez)

1. Cria um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor → + New query**: cola o conteúdo de `supabase/schema.sql` e clica em **Run**. No fim deve aparecer uma tabela com 6 linhas, todas com `rls_ativa = true`.
3. **Authentication → Sign In / Providers → Email**:
   - **Enable Email provider**: ligado.
   - **Confirm email**: desligado.
   - Clica em **Save**.
4. Preenche `js/config.js` com os valores de **Project Settings**:
   - **Data API** → Project URL (só `https://xxxx.supabase.co`, sem `/rest/v1/`).
   - **API Keys** → Publishable key (`sb_publishable_...`).
   - ⚠️ Nunca uses a *secret* / *service_role* key.
5. Se mudares de projeto Supabase, troca também o endereço em `connect-src` na linha `Content-Security-Policy` do `index.html`.

### Tornar-te professora (admin)

Cria a tua conta no site e depois, no **SQL Editor**:

```sql
update public.profiles
set role = 'admin', approved = true
where email = 'o-teu-email@exemplo.com';
```

## 2. Correr localmente

Na pasta do projeto (onde está o `index.html`):

```
python -m http.server 8000
```

(Se `python` não for reconhecido no Windows, usa `py -m http.server 8000`.)

Abre **http://localhost:8000**. A janela do terminal tem de ficar aberta; `Ctrl+C` pára o servidor.

Não abras o `index.html` com duplo clique: tem de ser através do servidor.

## 3. Publicar no GitHub Pages

1. Envia o código para o GitHub:
   ```
   git add .
   git commit -m "Atualização"
   git push origin main
   ```
2. No GitHub, abre o repositório → **Settings** → **Pages** (menu da esquerda).
3. Em **Build and deployment**:
   - **Source**: *Deploy from a branch*.
   - **Branch**: `main` e pasta `/ (root)` → **Save**.
4. Espera 1–2 minutos e recarrega a página **Settings → Pages**: aparece *"Your site is live at https://<utilizador>.github.io/<repositório>/"*.
5. Cada `git push` para `main` volta a publicar automaticamente (demora ~1 minuto).

O GitHub Pages gratuito exige que o repositório seja **público**. Isso é seguro: a chave publishable é pública por natureza e a proteção dos dados está no RLS do Supabase.

## 4. Durante e depois do aulão

- **Aprovar alunos**: aba **Painel** → *Alunos aguardando aprovação* → *Aprovar todos*.
- **Fechar novos registos** depois do aulão (opcional): **Authentication → Sign In / Providers → User Signups** → desliga *Allow new users to sign up*.
- As dúvidas e respostas continuam disponíveis para os alunos aprovados.

## 5. Teste de segurança

Entra no site com uma conta de **aluno**, abre **F12 → Console**, cola o conteúdo de `testes/ataque-aluno.js` e carrega Enter. Todas as linhas da tabela devem ter ✅.
