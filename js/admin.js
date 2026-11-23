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
  loadQuestionCounts();
}

// Limpa dados sensíveis (emails) ao sair da conta.
function clearAdminPanel() {
  pendingProfiles = [];
  csvQuestions = [];
  $("pending-list").textContent = "";
  $("pending-status").textContent = "";
  $("counts-list").textContent = "";
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
