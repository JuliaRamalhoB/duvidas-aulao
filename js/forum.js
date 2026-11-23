// Fórum de dúvidas: enviar dúvida, mural com atualização automática,
// filtros, "Minhas dúvidas" e ações da professora.

let forumUiReady = false;   // os botões/formulários já foram ligados?
let forumRunning = false;   // o fórum está ativo (utilizador dentro da app)?
let feedDoubts = [];        // dúvidas que o utilizador pode ver
let myDoubtIds = new Set(); // ids das dúvidas escritas por mim

let newDoubtPicker = null;
let filterPicker = null;

let realtimeChannel = null;
let pollTimer = null;      // polling de 5 s (só se o Realtime falhar)
let safetyTimer = null;    // recarrega a cada 30 s, por segurança
let reloadTimer = null;    // agrupa vários eventos seguidos num só reload

let editingDoubtId = null; // a professora está a escrever uma resposta?
let reloadWaiting = false; // chegou atualização enquanto ela escrevia

const DOUBT_COLUMNS =
  "id, theme_id, body, status, answer_body, answered_in_class, answered_at, hidden, created_at";

// ---------------------------------------------------------------------
// Arranque e paragem (chamados por app.js)
// ---------------------------------------------------------------------
async function startForum() {
  if (forumRunning) {
    scheduleReload();
    return;
  }
  forumRunning = true;
  setupForumUi();

  $("feed-status").textContent = "Carregando dúvidas…";
  try {
    await loadThemes();
  } catch (error) {
    console.error(error);
    $("feed-status").textContent = "Não foi possível carregar os temas. Recarregue a página.";
    return;
  }

  newDoubtPicker = createThemePicker($("new-doubt-theme"), { idPrefix: "new", mode: "form" });
  filterPicker = createThemePicker($("filter-theme"), {
    idPrefix: "filter",
    mode: "filter",
    onChange: renderFeed,
  });

  await reloadDoubts();
  await subscribeRealtime();
  safetyTimer = setInterval(scheduleReload, 30000);
}

function stopForum() {
  forumRunning = false;
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  clearInterval(pollTimer);
  clearInterval(safetyTimer);
  clearTimeout(reloadTimer);
  pollTimer = null;
  safetyTimer = null;
  feedDoubts = [];
  myDoubtIds = new Set();
  editingDoubtId = null;
  reloadWaiting = false;
  $("feed-list").textContent = "";
  $("mine-list").textContent = "";
}

// Liga os eventos dos elementos fixos do HTML (só uma vez).
function setupForumUi() {
  if (forumUiReady) {
    return;
  }
  forumUiReady = true;

  $("form-new-doubt").addEventListener("submit", handleNewDoubt);
  $("new-doubt-body").addEventListener("input", updateNewDoubtHelpers);
  $("filter-status").addEventListener("change", renderFeed);
}

// ---------------------------------------------------------------------
// Atualização automática (Realtime + polling de reserva)
// ---------------------------------------------------------------------
async function subscribeRealtime() {
  // Garante que o Realtime usa o token do utilizador (para o RLS funcionar).
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    supabaseClient.realtime.setAuth(data.session.access_token);
  }

  realtimeChannel = supabaseClient
    .channel("doubts-feed")
    .on("postgres_changes", { event: "*", schema: "public", table: "doubts" }, scheduleReload)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        stopPolling();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (forumRunning) {
          startPolling();
        }
      }
    });
}

function startPolling() {
  if (!pollTimer) {
    pollTimer = setInterval(scheduleReload, 5000);
  }
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// Pede um reload daqui a meio segundo (vários eventos seguidos = 1 reload).
function scheduleReload() {
  if (!forumRunning) {
    return;
  }
  if (editingDoubtId !== null) {
    reloadWaiting = true; // não apagar o que a professora está a escrever
    return;
  }
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadDoubts, 500);
}

// ---------------------------------------------------------------------
// Carregar dados
// ---------------------------------------------------------------------
async function reloadDoubts() {
  const doubtsQuery = supabaseClient
    .from("doubts")
    .select(DOUBT_COLUMNS)
    .order("created_at", { ascending: false });

  // Filtro por author_id é obrigatório: o admin consegue ler todas as linhas.
  const mineQuery = supabaseClient
    .from("doubt_authors")
    .select("doubt_id")
    .eq("author_id", currentProfile.id);

  const [doubtsResult, mineResult] = await Promise.all([doubtsQuery, mineQuery]);

  if (!forumRunning) {
    return; // o utilizador saiu enquanto carregava
  }
  if (doubtsResult.error || mineResult.error) {
    console.error(doubtsResult.error || mineResult.error);
    $("feed-status").textContent = "Não foi possível carregar as dúvidas. Tentando de novo em instantes…";
    return;
  }

  feedDoubts = doubtsResult.data;
  myDoubtIds = new Set(mineResult.data.map((row) => row.doubt_id));

  // Se aparecer um tema novo (ex.: importado), recarrega a lista de temas.
  if (feedDoubts.some((d) => !findThemeById(d.theme_id))) {
    try {
      await loadThemes();
      refreshThemePickers();
    } catch (error) {
      console.error(error);
    }
  }

  renderFeed();
  renderMine();
}

// Atualiza as opções dos seletores do fórum (depois de recarregar os temas).
function refreshThemePickers() {
  if (newDoubtPicker) newDoubtPicker.refresh();
  if (filterPicker) filterPicker.refresh();
}

// ---------------------------------------------------------------------
// Desenhar listas
// ---------------------------------------------------------------------
function renderFeed() {
  editingDoubtId = null; // redesenhar fecha qualquer resposta aberta
  const status = $("filter-status").value;

  const visible = feedDoubts.filter((doubt) => {
    if (status !== "all" && doubt.status !== status) return false;
    return filterPicker.matches(findThemeById(doubt.theme_id));
  });

  const list = $("feed-list");
  list.textContent = "";
  for (const doubt of visible) {
    list.append(renderDoubtCard(doubt, isAdmin()));
  }

  if (feedDoubts.length === 0) {
    $("feed-status").textContent = "Ainda não há dúvidas. Seja o primeiro a perguntar!";
  } else if (visible.length === 0) {
    $("feed-status").textContent = "Nenhuma dúvida com esses filtros.";
  } else if (visible.length === 1) {
    $("feed-status").textContent = "1 dúvida";
  } else {
    $("feed-status").textContent = visible.length + " dúvidas";
  }
}

function renderMine() {
  const mine = feedDoubts.filter((d) => myDoubtIds.has(d.id));
  const list = $("mine-list");
  list.textContent = "";
  for (const doubt of mine) {
    list.append(renderDoubtCard(doubt, false));
  }
  $("mine-status").textContent =
    mine.length === 0
      ? "Você ainda não enviou nenhuma dúvida."
      : "Você enviou " + mine.length + (mine.length === 1 ? " dúvida." : " dúvidas.");
}

// Cria o cartão de uma dúvida. withAdminActions = mostrar botões da professora.
function renderDoubtCard(doubt, withAdminActions) {
  const card = makeEl("article", "doubt-card");
  if (doubt.hidden) {
    card.classList.add("is-hidden");
  }

  // Cabeçalho: tema + data
  const header = makeEl("div", "doubt-header");
  header.append(
    makeEl("span", "doubt-theme", themeLabel(findThemeById(doubt.theme_id))),
    makeEl("span", "doubt-date", formatDateTime(doubt.created_at))
  );
  card.append(header);

  // Etiquetas de estado
  const badges = makeEl("div", "badges");
  if (doubt.status === "answered") {
    badges.append(makeEl("span", "badge badge-answered", "Respondida"));
  } else {
    badges.append(makeEl("span", "badge badge-pending", "Por responder"));
  }
  if (doubt.hidden) {
    badges.append(makeEl("span", "badge badge-hidden", "Oculta (alunos não veem)"));
  }
  card.append(badges);

  // Texto da dúvida
  const body = makeEl("div", "doubt-body math-text");
  setMathText(body, doubt.body);
  card.append(body);

  // Resposta
  if (doubt.answer_body) {
    const answer = makeEl("div", "answer");
    answer.append(makeEl("p", "answer-title", "Resposta da professora"));
    const answerText = makeEl("div", "math-text");
    setMathText(answerText, doubt.answer_body);
    answer.append(answerText);
    if (doubt.answered_at) {
      answer.append(makeEl("p", "answer-date", "Respondida em " + formatDateTime(doubt.answered_at)));
    }
    card.append(answer);
  } else if (doubt.answered_in_class) {
    const answer = makeEl("div", "answer");
    answer.append(makeEl("p", "answer-title", "Respondida em aula"));
    card.append(answer);
  }

  if (withAdminActions) {
    card.append(renderAdminActions(doubt));
  }
  return card;
}

// ---------------------------------------------------------------------
// Ações da professora
// (Os botões só aparecem para o admin, mas quem protege de verdade é o
//  RLS: um aluno que tente fazer UPDATE pela API não consegue.)
// ---------------------------------------------------------------------
function renderAdminActions(doubt) {
  const box = makeEl("div", "admin-actions");
  const buttons = makeEl("div", "action-row");
  const message = makeEl("p", "msg msg-error");
  message.hidden = true;
  message.setAttribute("role", "alert");

  const answerButton = makeEl("button", "btn-small", doubt.answer_body ? "Editar resposta" : "Responder");
  answerButton.type = "button";
  answerButton.addEventListener("click", () => openAnswerEditor(doubt, box, buttons, message));

  const inClassButton = makeEl("button", "btn-small", "Respondida em aula");
  inClassButton.type = "button";
  inClassButton.disabled = doubt.answered_in_class && !doubt.answer_body;
  inClassButton.addEventListener("click", async () => {
    if (doubt.answer_body && !confirm("Isso apaga a resposta escrita. Continuar?")) {
      return;
    }
    await updateDoubt(doubt.id, { answered_in_class: true, answer_body: null }, message);
  });

  const hideButton = makeEl("button", "btn-small", doubt.hidden ? "Restaurar" : "Ocultar");
  hideButton.type = "button";
  hideButton.addEventListener("click", async () => {
    await updateDoubt(doubt.id, { hidden: !doubt.hidden }, message);
  });

  buttons.append(answerButton, inClassButton, hideButton);
  box.append(buttons, message);
  return box;
}

function openAnswerEditor(doubt, box, buttons, message) {
  editingDoubtId = doubt.id;
  buttons.hidden = true;

  const form = makeEl("form", "answer-form");
  const textareaId = "answer-" + doubt.id;
  const label = makeEl("label", null, "Resposta (aceita fórmulas com $...$)");
  label.htmlFor = textareaId;
  const textarea = document.createElement("textarea");
  textarea.id = textareaId;
  textarea.rows = 5;
  textarea.maxLength = 5000;
  textarea.value = doubt.answer_body || "";
  const hint = makeEl("p", "hint", "Deixe vazio e salve para voltar a “Por responder”.");

  const row = makeEl("div", "action-row");
  const saveButton = makeEl("button", "btn-small btn-small-primary", "Salvar resposta");
  saveButton.type = "submit";
  const cancelButton = makeEl("button", "btn-small", "Cancelar");
  cancelButton.type = "button";
  row.append(saveButton, cancelButton);

  form.append(label, textarea, hint, row);
  box.insertBefore(form, message);
  textarea.focus();

  function closeEditor() {
    form.remove();
    buttons.hidden = false;
    editingDoubtId = null;
    if (reloadWaiting) {
      reloadWaiting = false;
      scheduleReload();
    }
  }

  cancelButton.addEventListener("click", closeEditor);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    const text = textarea.value.trim();
    // Resposta em texto: deixa de ser "em aula". O estado muda sozinho na base de dados.
    const ok = await updateDoubt(doubt.id, { answer_body: text || null, answered_in_class: false }, message);
    saveButton.disabled = false;
    if (ok) {
      closeEditor();
    }
  });
}

// Faz UPDATE numa dúvida. Devolve true se correu bem.
async function updateDoubt(doubtId, changes, messageElement) {
  hideMessage(messageElement);
  const { data, error } = await supabaseClient
    .from("doubts")
    .update(changes)
    .eq("id", doubtId)
    .select("id");

  if (error || !data || data.length === 0) {
    // Sem erro mas 0 linhas = o RLS bloqueou (sem permissão).
    console.error(error);
    showMessage(messageElement, "Não foi possível salvar. Tente de novo.", true);
    return false;
  }
  scheduleReload();
  return true;
}

// ---------------------------------------------------------------------
// Enviar dúvida
// ---------------------------------------------------------------------
let previewTimer = null;

function updateNewDoubtHelpers() {
  const text = $("new-doubt-body").value;
  $("new-doubt-count").textContent = text.length;

  // Pré-visualização das fórmulas (espera 300 ms depois de parar de digitar)
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const hasText = text.trim() !== "";
    $("new-doubt-preview-box").hidden = !hasText;
    if (hasText) {
      setMathText($("new-doubt-preview"), text);
    }
  }, 300);
}

async function handleNewDoubt(event) {
  event.preventDefault();
  const message = $("new-doubt-message");
  const button = event.target.querySelector("button[type=submit]");
  const values = newDoubtPicker.getValues();
  const body = $("new-doubt-body").value.trim();

  if (!values.discipline || !values.topic) {
    showMessage(message, "Escolha a disciplina e o tópico.", true);
    return;
  }
  const themeId = newDoubtPicker.getThemeId();
  if (themeId === null) {
    showMessage(message, "Esse tópico precisa de um subtópico. Escolha um na lista.", true);
    return;
  }
  if (!body) {
    showMessage(message, "Escreva sua dúvida.", true);
    return;
  }
  if (body.length > 1000) {
    showMessage(message, "A dúvida pode ter no máximo 1000 caracteres.", true);
    return;
  }

  button.disabled = true;
  showMessage(message, "Enviando…", false);

  const { error } = await supabaseClient.rpc("create_doubt", {
    p_theme_id: themeId,
    p_body: body,
  });

  button.disabled = false;
  if (error) {
    console.error(error);
    const text = (error.message || "").includes("RATE_LIMIT")
      ? "Você enviou muitas dúvidas seguidas. Espere um minuto e tente de novo."
      : "Não foi possível enviar a dúvida. Tente de novo.";
    showMessage(message, text, true);
    return;
  }

  $("new-doubt-body").value = "";
  updateNewDoubtHelpers();
  showMessage(message, "Dúvida enviada! Ela aparece no mural sem o seu nome.", false);
  scheduleReload();
}
