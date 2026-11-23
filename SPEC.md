# Plataforma de dúvidas para aulão de revisão

## Contexto

Uma professora particular (Julia) vai dar um aulão de cerca de 3 horas, em grupo, para revisão da prova final de alunos do secundário (Matemática, Física, Química). Alguns alunos têm vergonha de perguntar à frente dos outros e não registam as dúvidas.

A plataforma permite:
- enviar dúvidas de forma **anónima para os colegas**, que aparecem num feed visível a todos;
- a professora responder (em texto ou "em aula");
- os alunos escolherem um tema e praticarem com 3 questões de escolha múltipla de um banco de questões, com gabarito comentado.

Escala: dezenas de alunos, uso concentrado durante 3 horas, mas as dúvidas e respostas ficam disponíveis depois da aula. Não há IA nem APIs pagas neste projeto.

## Decisões de stack (já tomadas, não mudar sem perguntar)

- **Frontend:** HTML + CSS + JavaScript puro. Sem framework e sem passo de build. Ficheiros estáticos publicáveis no GitHub Pages.
- **Bibliotecas por CDN:** `supabase-js` e KaTeX (fórmulas com `$...$` e `$$...$$`).
- **Backend:** Supabase (Postgres + Auth + Realtime), plano gratuito. Sem servidor próprio.
- **Chaves:** a chave pública (anon/publishable) pode estar no frontend, em `js/config.js`. Nenhuma chave secreta (`service_role`/secret) pode aparecer em qualquer ficheiro, commit ou instrução.
- **Segurança:** como o frontend é público, toda a segurança está em Row Level Security (RLS) e funções SQL no Supabase.
- **Idioma:** nomes de código (tabelas, colunas, funções, variáveis, ficheiros) em inglês. Textos visíveis ao utilizador em português. Comentários em português simples. Os textos da interface são em português do Brasil. Datas e horas são mostradas no fuso America/Sao_Paulo.
- **Quem lê o código:** a autora é estudante iniciante de Engenharia Informática. Prefere código simples e legível a soluções "espertas". Quando houver uma decisão com alternativas, escolhe a mais simples e diz porquê numa frase.

## Funcionalidades

### 1. Conta e acesso
- Registo e login com email + palavra-passe. Sem confirmação por email.
- No registo pede-se também o **nome** (para a professora saber quem aprovar).
- Conta nova fica **pendente**. Só acede ao conteúdo depois de a professora aprovar.
- Papéis: `student` e `admin`. O admin é definido manualmente na base de dados (a professora faz isso uma vez, com um comando SQL que deves fornecer).

### 2. Temas
- Hierarquia fixa de 3 níveis: **disciplina > tópico > subtópico** (ex.: Matemática > Combinatória > Arranjos). O subtópico é opcional.
- Seletores em cascata (dropdowns) reutilizados no fórum e na prática.
- Dados iniciais: disciplina Matemática, com os 6 tópicos: Sistemas lineares; Progressões; Estatística; Análise combinatória e binômio de Newton; Probabilidade; Geometria. Subtópicos ficam vazios por enquanto.

### 3. Fórum de dúvidas
- O aluno cria uma dúvida: tema (obrigatório até ao tópico) + texto (máximo 1000 caracteres). Fórmulas renderizadas com KaTeX.
- Feed com todas as dúvidas, mais recentes primeiro, que atualiza sozinho (Supabase Realtime; se der problemas, usar polling de 5 segundos).
- Filtros: por disciplina/tópico/subtópico e por estado (todas / por responder / respondidas).
- **Anonimato:** nenhum aluno consegue saber quem escreveu a dúvida de outro, nem pela interface nem pela API. O autor fica guardado numa tabela privada separada. O aluno vê as suas próprias dúvidas na aba "Minhas dúvidas".
- As dúvidas **nunca desaparecem** para os alunos. Só a professora pode ocultar e restaurar. Alunos não editam nem apagam.
- Estados: `pending` (por responder) e `answered`. A professora pode:
  - (a) escrever uma resposta em texto (aceita KaTeX), e o estado muda sozinho para `answered`;
  - (b) clicar em "Respondida em aula": estado `answered`, sem texto, mostrado como "Respondida em aula";
  - editar a resposta depois.
- Todos os alunos aprovados veem todas as dúvidas e respostas.

### 4. Prática (banco de questões)
- O aluno escolhe disciplina > tópico (> subtópico opcional) e recebe **3 questões** de escolha múltipla desse tema, aleatórias, dando prioridade às que ainda não respondeu.
- Se houver menos de 3, mostra as que existem. Botão "Mais 3". Se não houver nenhuma, mensagem simpática. Quando só restarem questões já respondidas, oferecer refazê-las (guarda nova tentativa).
- Cada questão tem enunciado (KaTeX), 4 ou 5 alternativas (A–D ou A–E). O aluno marca uma, clica **Confirmar** e só então vê se acertou, a correta e a **explicação comentada** (KaTeX). Depois de confirmar não pode mudar.
- Guardar cada tentativa (aluno, questão, escolhida, acertou, quando). Mostrar um resumo simples: "acertaste X de Y neste tema".
- É prática, não avaliação: não é preciso esconder o gabarito de quem abrir as ferramentas do navegador.

### 5. Painel da professora (admin)
- Aprovar alunos pendentes (lista com nome e email).
- Ações no fórum: responder, "respondida em aula", ocultar/restaurar.
- **Importar questões por CSV** com as colunas: `discipline, topic, subtopic, statement, option_a, option_b, option_c, option_d, option_e, correct, explanation`.
  - Cria os temas que ainda não existirem.
  - Aceita `,` ou `;` como separador, UTF-8, ignora linhas vazias.
  - `option_e` é opcional. `correct` é uma letra (A–E) que tem de existir entre as alternativas preenchidas.
  - Valida e mostra os erros **por linha** sem importar nada se houver erros (tudo ou nada).
- Contagem de questões por tema (para ver lacunas no banco).

### 6. Interface
- Pensada primeiro para telemóvel (os alunos vão usar o telemóvel). Simples, legível, tema claro, botões grandes, labels e contraste acessíveis.
- Estados de carregamento e de erro claros, em português.

## Modelo de dados (sugestão; podes ajustar, mas explica as mudanças)

- `profiles` (id = id do utilizador auth, display_name, role, approved, created_at)
- `themes` (id, discipline, topic, subtopic nullable, único por combinação)
- `doubts` (id, theme_id, body, status, answer_body, answered_in_class, answered_at, hidden, created_at). **Sem coluna de autor.**
- `doubt_authors` (doubt_id, author_id). Tabela privada.
- `questions` (id, theme_id, statement, option_a..option_e, correct, explanation, created_at)
- `attempts` (id, user_id, question_id, chosen, is_correct, created_at)

Criar uma dúvida é feito por uma **função SQL** (RPC) que insere em `doubts` e `doubt_authors` na mesma operação. Alunos não têm permissão de INSERT direto nessas tabelas.

## Segurança (obrigatório)

- RLS ativa em **todas** as tabelas.
- Trigger no registo cria o perfil com `role = 'student'` e `approved = false`.
- Funções auxiliares `is_admin()` e `is_approved()` usadas nas políticas.
- Um aluno **não pode** alterar o próprio `role` nem `approved` (cuidado: é uma falha clássica).
- Aluno pendente não lê nada, exceto o próprio perfil.
- `themes` e `questions`: leitura para aprovados, escrita só admin.
- `doubts`: leitura para aprovados quando `hidden = false` (admin vê tudo). Alterações só pelo admin.
- `doubt_authors`: um aluno só lê as suas linhas; admin lê tudo; ninguém insere diretamente.
- `attempts`: o aluno insere e lê só as suas; admin lê todas.
- Limites de tamanho na base de dados (CHECK constraints), não só no formulário.
- **Nunca** injetar texto escrito por utilizadores com `innerHTML` sem o escapar. Usar `textContent` ou escapar antes de aplicar KaTeX (risco de XSS: as dúvidas são escritas por alunos).

## Forma de trabalho

- Trabalha **por fases** (abaixo). No fim de cada fase, pára e diz o que testar e como. Não avances sem eu confirmar.
- Quando eu tiver de fazer algo fora do código (colar SQL no Supabase, criar conta, etc.), dá o passo a passo exato, com os nomes dos menus.
- `supabase/schema.sql` deve ser um único ficheiro que eu cole no SQL Editor do Supabase, e que possa ser executado de novo sem erros sempre que possível.
- `README.md` com: como correr localmente (`python -m http.server`) e como publicar no GitHub Pages.
- Antes de dizer que algo funciona, verifica o que conseguires verificar e diz claramente o que **não** conseguiste testar.

## Fases

1. **Base de dados:** `supabase/schema.sql` (tabelas, RLS, função de criar dúvida, trigger de perfil, temas de exemplo) + comando para me tornar admin.
2. **Conta e estrutura:** `index.html`, CSS base, `js/config.js`, registo/login/logout, ecrã "à espera de aprovação", navegação entre secções.
3. **Fórum:** criar dúvida, feed com atualização automática, filtros, "Minhas dúvidas", e do lado da professora: responder, "respondida em aula", ocultar/restaurar.
4. **Painel admin:** aprovar alunos, importar questões por CSV com validação, contagem por tema.
5. **Prática:** escolher tema, 3 questões, confirmar, gabarito comentado, "Mais 3", resumo.
6. **Publicação e testes:** GitHub Pages, README, checklist de testes abaixo, revisão de segurança.

## Testes de aceitação (fase 6)

1. Conta pendente não vê nada além do ecrã de espera.
2. Com dois alunos A e B: B **não consegue** descobrir o autor de uma dúvida de A por nenhuma consulta (testar na interface e diretamente na API com o token de B).
3. Um aluno não consegue tornar-se admin nem aprovar-se a si próprio.
4. Uma dúvida com HTML/`<script>` aparece como texto, sem executar.
5. Uma dúvida nova aparece nos outros telemóveis em poucos segundos, sem recarregar.
6. Dúvida oculta desaparece para alunos, continua visível para a professora e pode ser restaurada.
7. Resposta em texto e "Respondida em aula" aparecem corretamente.
8. Prática: 3 questões, sem repetir até esgotar; a explicação só aparece depois de confirmar; não dá para mudar a resposta.
9. CSV com erros mostra as linhas com problema e não importa nada; CSV correto importa e cria temas novos.
10. KaTeX renderiza fórmulas em dúvidas, respostas, enunciados e explicações.
11. Layout usável num ecrã de telemóvel.
12. Nenhum ficheiro do projeto contém chave secreta.
