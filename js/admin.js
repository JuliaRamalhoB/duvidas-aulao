// Painel da professora: aprovar alunos, importar questões por CSV e
// contagem de questões por tema.
// (A interface só aparece ao admin, mas a proteção real é o RLS.)

let adminUiReady = false;
let pendingProfiles = [];   // alunos à espera de aprovação
let csvQuestions = [];      // questões válidas prontas a importar

// Chamado por app.js sempre que a secção "Painel" é aberta.
function openAdminPanel() {
  if (!isAdmin()) {
    return;
  }
  setupAdminUi();
  loadPendingProfiles();
  loadStudentProgress();
  loadQuestionCounts();
}

// Limpa dados sensíveis (emails) ao sair da conta.
function clearAdminPanel() {
  pendingProfiles = [];
  csvQuestions = [];
  $("pending-list").textContent = "";
  $("pending-status").textContent = "";
  $("counts-list").textContent = "";
  $("progress-list").textContent = "";
  $("progress-status").textContent = "";
  $("csv-result").textContent = "";
  $("csv-file").value = "";
  $("btn-import").hidden = true;
}

function setupAdminUi() {
  if (adminUiReady) {
    return;
  }
  adminUiReady = true;
  $("btn-refresh-pending").addEventListener("click", loadPendingProfiles);
  $("btn-approve-all").addEventListener("click", approveAll);
  $("btn-refresh-counts").addEventListener("click", loadQuestionCounts);
  $("btn-refresh-progress").addEventListener("click", loadStudentProgress);
  $("csv-file").addEventListener("change", handleCsvFile);
  $("btn-import").addEventListener("click", handleImport);
}

// ---------------------------------------------------------------------
// Aprovar alunos
// ---------------------------------------------------------------------
async function loadPendingProfiles() {
  $("pending-status").textContent = "Carregando…";
  hideMessage($("pending-admin-message"));

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, display_name, email, created_at")
    .eq("approved", false)
    .eq("role", "student")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    $("pending-status").textContent = "Não foi possível carregar a lista.";
    return;
  }
  pendingProfiles = data;
  renderPendingProfiles();
}

function renderPendingProfiles() {
  const list = $("pending-list");
  list.textContent = "";

  for (const person of pendingProfiles) {
    const item = makeEl("div", "person");
    const info = makeEl("div", "person-info");
    info.append(
      makeEl("strong", null, person.display_name),
      makeEl("span", "person-email", person.email),
      makeEl("span", "person-date", "Cadastro: " + formatDateTime(person.created_at))
    );

    const button = makeEl("button", "btn-small btn-small-primary", "Aprovar");
    button.type = "button";
    button.addEventListener("click", () => approveProfiles([person.id], button));

    item.append(info, button);
    list.append(item);
  }

  const total = pendingProfiles.length;
  $("pending-status").textContent =
    total === 0 ? "Nenhum aluno aguardando." : total + (total === 1 ? " aluno aguardando." : " alunos aguardando.");
  $("btn-approve-all").hidden = total < 2;
}

async function approveProfiles(ids, button) {
  if (button) {
    button.disabled = true;
  }
  hideMessage($("pending-admin-message"));

  const { data, error } = await supabaseClient
    .from("profiles")
    .update({ approved: true })
    .in("id", ids)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error(error);
    showMessage($("pending-admin-message"), "Não foi possível aprovar. Tente de novo.", true);
    if (button) {
      button.disabled = false;
    }
    return;
  }
  await loadPendingProfiles();
}

async function approveAll() {
  const total = pendingProfiles.length;
  if (total === 0 || !confirm("Aprovar os " + total + " alunos da lista?")) {
    return;
  }
  await approveProfiles(pendingProfiles.map((p) => p.id), $("btn-approve-all"));
  $("btn-approve-all").disabled = false;
}

// ---------------------------------------------------------------------
// Desempenho de cada aluno (acertos e erros)
// ---------------------------------------------------------------------
// O Supabase devolve no máximo 1000 linhas por pedido, por isso as
// tentativas são lidas em páginas.
async function fetchAllAttempts() {
  const pageSize = 1000;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseClient
      .from("attempts")
      .select("id, user_id, chosen, is_correct, created_at, questions(statement, correct, theme_id)")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) {
      throw error;
    }
    all.push(...data);
    if (data.length < pageSize) {
      return all;
    }
  }
}

async function loadStudentProgress() {
  const button = $("btn-refresh-progress");
  button.disabled = true;
  $("progress-status").textContent = "Carregando…";

  try {
    const [studentsResult, attempts] = await Promise.all([
      supabaseClient
        .from("profiles")
        .select("id, display_name, email")
        .eq("role", "student")
        .eq("approved", true)
        .order("display_name", { ascending: true }),
      fetchAllAttempts(),
      allThemes.length === 0 ? loadThemes() : null,
    ]);
    if (studentsResult.error) {
      throw studentsResult.error;
    }
    renderStudentProgress(studentsResult.data, attempts);
  } catch (error) {
    console.error(error);
    $("progress-status").textContent = "Não foi possível carregar o desempenho.";
  } finally {
    button.disabled = false;
  }
}

function renderStudentProgress(students, attempts) {
  const byStudent = new Map(students.map((s) => [s.id, []]));
  for (const attempt of attempts) {
    const list = byStudent.get(attempt.user_id);
    if (list) {
      list.push(attempt); // já vêm da mais recente para a mais antiga
    }
  }

  const list = $("progress-list");
  list.textContent = "";

  for (const student of students) {
    const own = byStudent.get(student.id);
    const right = own.filter((a) => a.is_correct).length;
    const wrong = own.length - right;

    const item = makeEl("details", "progress-student");
    const summary = makeEl("summary", "progress-summary");
    const info = makeEl("div", "person-info");
    info.append(
      makeEl("strong", null, student.display_name),
      makeEl("span", "person-email", student.email)
    );
    const score = makeEl("div", "progress-score");
    if (own.length === 0) {
      score.append(makeEl("span", "progress-none", "ainda não respondeu"));
    } else {
      score.append(
        makeEl("span", "progress-right", "✓ " + right),
        makeEl("span", "progress-wrong", "✗ " + wrong),
        makeEl("span", "progress-pct", Math.round((right / own.length) * 100) + "%")
      );
    }
    summary.append(info, score);
    item.append(summary);

    if (own.length > 0) {
      const ul = makeEl("ul", "progress-attempts");
      for (const attempt of own) {
        ul.append(renderAttemptItem(attempt));
      }
      item.append(ul);
    }
    list.append(item);
  }

  const active = students.filter((s) => byStudent.get(s.id).length > 0).length;
  $("progress-status").textContent =
    students.length === 0
      ? "Nenhum aluno aprovado ainda."
      : active + " de " + students.length + (students.length === 1 ? " aluno" : " alunos") +
        " já responderam questões.";
}

function renderAttemptItem(attempt) {
  const li = makeEl("li", attempt.is_correct ? "progress-attempt is-right" : "progress-attempt is-wrong");
  const question = attempt.questions;

  const head = makeEl("div", "progress-attempt-head");
  head.append(makeEl("span", "progress-mark", attempt.is_correct ? "Acertou" : "Errou"));
  const theme = question ? findThemeById(question.theme_id) : null;
  if (theme) {
    head.append(makeEl("span", "progress-theme", themeLabel(theme)));
  }
  head.append(makeEl("span", "person-date", formatDateTime(attempt.created_at)));

  const statement = makeEl("p", "progress-statement");
  setMathText(statement, question ? question.statement : "(questão apagada)");

  const answer = makeEl("p", "progress-answer",
    attempt.is_correct || !question
      ? "Marcou " + attempt.chosen
      : "Marcou " + attempt.chosen + " · correta: " + question.correct);

  li.append(head, statement, answer);
  return li;
}

// ---------------------------------------------------------------------
// Importar CSV
// ---------------------------------------------------------------------
async function handleCsvFile() {
  const result = $("csv-result");
  result.textContent = "";
  hideMessage($("import-message"));
  $("btn-import").hidden = true;
  csvQuestions = [];

  const file = $("csv-file").files[0];
  if (!file) {
    return;
  }

  const text = await file.text(); // lê como UTF-8
  const { questions, errors } = validateQuestionsCsv(text);

  if (errors.length > 0) {
    result.append(makeEl("p", "msg msg-error",
      "O arquivo tem " + errors.length + (errors.length === 1 ? " erro" : " erros") +
      ". Nada será importado. Corrija e escolha o arquivo de novo."));
    const list = makeEl("ul", "error-list");
    for (const err of errors) {
      const prefix = err.line > 0 ? "Linha " + err.line + ": " : "";
      list.append(makeEl("li", null, prefix + err.message));
    }
    result.append(list);
    return;
  }

  csvQuestions = questions;

  // Mostra os temas que vão ser criados (ajuda a apanhar erros de digitação).
  const newThemes = findNewThemes(questions);
  result.append(makeEl("p", "msg",
    "Tudo certo: " + questions.length + (questions.length === 1 ? " questão pronta" : " questões prontas") +
    " para importar."));
  if (newThemes.length > 0) {
    result.append(makeEl("p", "hint", "Temas novos que serão criados:"));
    const list = makeEl("ul", "theme-new-list");
    for (const label of newThemes) {
      list.append(makeEl("li", null, label));
    }
    result.append(list);
  }
  $("btn-import").hidden = false;
}

// Devolve os nomes dos temas do CSV que ainda não existem.
function findNewThemes(questions) {
  const existing = new Set(allThemes.map((t) => themeLabel(t)));
  const found = new Set();
  for (const q of questions) {
    const label = themeLabel({ discipline: q.discipline, topic: q.topic, subtopic: q.subtopic || null });
    if (!existing.has(label)) {
      found.add(label);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function handleImport() {
  if (csvQuestions.length === 0) {
    return;
  }
  const button = $("btn-import");
  const message = $("import-message");
  button.disabled = true;
  showMessage(message, "Importando…", false);

  const { data, error } = await supabaseClient.rpc("import_questions", { p_rows: csvQuestions });

  button.disabled = false;
  if (error) {
    console.error(error);
    showMessage(message, "A importação falhou e nada foi importado. Detalhe: " + error.message, true);
    return;
  }

  showMessage(message, data + (data === 1 ? " questão importada!" : " questões importadas!"), false);
  csvQuestions = [];
  button.hidden = true;
  $("csv-file").value = "";
  $("csv-result").textContent = "";

  // Atualiza temas (para os seletores) e a contagem.
  try {
    await loadThemes();
    refreshThemePickers();
  } catch (err) {
    console.error(err);
  }
  loadQuestionCounts();
}

// ---------------------------------------------------------------------
// Contagem de questões por tema
// ---------------------------------------------------------------------
async function loadQuestionCounts() {
  $("counts-status").textContent = "Carregando…";

  try {
    await loadThemes();
  } catch (error) {
    console.error(error);
    $("counts-status").textContent = "Não foi possível carregar a contagem.";
    return;
  }
  const { data, error } = await supabaseClient.rpc("question_counts");
  if (error) {
    console.error(error);
    $("counts-status").textContent = "Não foi possível carregar a contagem.";
    return;
  }

  const totals = new Map(data.map((row) => [row.theme_id, Number(row.total)]));
  const themes = [...allThemes].sort((a, b) => themeLabel(a).localeCompare(themeLabel(b), "pt-BR"));

  const list = $("counts-list");
  list.textContent = "";
  let empty = 0;
  let sum = 0;
  for (const theme of themes) {
    const total = totals.get(theme.id) || 0;
    sum += total;
    const item = makeEl("li", total === 0 ? "count-item is-empty" : "count-item");
    item.append(
      makeEl("span", null, themeLabel(theme)),
      makeEl("span", "count-number", total === 0 ? "sem questões" : String(total))
    );
    list.append(item);
    if (total === 0) {
      empty++;
    }
  }

  $("counts-status").textContent =
    sum + " questões no total. " +
    (empty === 0 ? "Todos os temas têm questões." : empty + (empty === 1 ? " tema sem questões." : " temas sem questões."));
}
