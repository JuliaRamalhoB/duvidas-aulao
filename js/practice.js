// Prática: escolher tema, receber 3 questões, confirmar, ver o gabarito
// comentado, "Mais 3" e resumo de acertos.

const PRACTICE_BATCH_SIZE = 3;

let practiceUiReady = false;
let practicePicker = null;

let practiceQuestions = [];   // todas as questões do tema escolhido
let answeredIds = new Set();  // questões que já respondi (alguma vez)
let practiceAttempts = [];    // minhas tentativas neste tema: { question_id, is_correct }
let seenIds = new Set();      // questões já mostradas nesta "volta"
let redoMode = false;         // true = estou a refazer questões já respondidas

// Chamado por app.js sempre que a secção "Praticar" é aberta.
async function openPractice() {
  if (!practiceUiReady) {
    practiceUiReady = true;
    $("btn-practice-start").addEventListener("click", startPracticeTheme);
    $("btn-practice-more").addEventListener("click", showNextBatch);
    $("btn-practice-redo").addEventListener("click", startRedo);
  }

  if (practicePicker) {
    practicePicker.refresh(); // pode haver temas novos (importados)
    return;
  }
  try {
    await loadThemes();
  } catch (error) {
    console.error(error);
    showMessage($("practice-message"), "Não foi possível carregar os temas. Recarregue a página.", true);
    return;
  }
  practicePicker = createThemePicker($("practice-theme"), {
    idPrefix: "practice",
    mode: "practice",
    onChange: clearPracticeResults, // mudou o tema -> limpa as questões antigas
  });
}

// Limpa tudo ao sair da conta.
function clearPractice() {
  clearPracticeResults();
  if (practicePicker) {
    practicePicker.reset();
  }
}

function clearPracticeResults() {
  practiceQuestions = [];
  answeredIds = new Set();
  practiceAttempts = [];
  seenIds = new Set();
  redoMode = false;
  $("practice-list").textContent = "";
  $("practice-status").textContent = "";
  $("practice-summary").hidden = true;
  $("btn-practice-more").hidden = true;
  $("practice-redo").hidden = true;
  hideMessage($("practice-message"));
}

// ---------------------------------------------------------------------
// Carregar o tema escolhido
// ---------------------------------------------------------------------
async function startPracticeTheme() {
  const values = practicePicker.getValues();
  if (!values.discipline || !values.topic) {
    showMessage($("practice-message"), "Escolha a disciplina e o tópico.", true);
    return;
  }

  clearPracticeResults();
  const button = $("btn-practice-start");
  button.disabled = true;
  $("practice-status").textContent = "Carregando questões…";

  // Todos os temas que encaixam na escolha (ex.: tópico + todos os subtópicos)
  const themeIds = allThemes.filter((t) => practicePicker.matches(t)).map((t) => t.id);

  const { data: questions, error } = await supabaseClient
    .from("questions")
    .select("id, theme_id, statement, option_a, option_b, option_c, option_d, option_e, correct, explanation")
    .in("theme_id", themeIds);

  if (error) {
    console.error(error);
    button.disabled = false;
    $("practice-status").textContent = "";
    showMessage($("practice-message"), "Não foi possível carregar as questões. Tente de novo.", true);
    return;
  }

  practiceQuestions = questions;

  if (questions.length > 0) {
    // As minhas tentativas nestas questões (o filtro por user_id é
    // obrigatório: o admin consegue ler as tentativas de todos).
    const { data: attempts, error: attemptsError } = await supabaseClient
      .from("attempts")
      .select("question_id, is_correct")
      .eq("user_id", currentProfile.id)
      .in("question_id", questions.map((q) => q.id));

    if (attemptsError) {
      console.error(attemptsError);
      button.disabled = false;
      $("practice-status").textContent = "";
      showMessage($("practice-message"), "Não foi possível carregar suas respostas anteriores. Tente de novo.", true);
      return;
    }
    practiceAttempts = attempts;
    answeredIds = new Set(attempts.map((a) => a.question_id));
  }

  button.disabled = false;
  updateSummary();

  if (questions.length === 0) {
    $("practice-status").textContent =
      "Ainda não há questões deste tema. A professora vai adicionar em breve — tente outro tema!";
    return;
  }
  showNextBatch();
}

// ---------------------------------------------------------------------
// Escolher as próximas 3 questões
// ---------------------------------------------------------------------

// Baralha uma lista (algoritmo de Fisher-Yates).
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Devolve as próximas questões, ou null se já respondi todas (modo normal).
function pickBatch() {
  let pool;
  if (!redoMode) {
    // Prioridade: questões que ainda não respondi.
    const unanswered = practiceQuestions.filter((q) => !answeredIds.has(q.id));
    if (unanswered.length === 0) {
      return null;
    }
    pool = unanswered.filter((q) => !seenIds.has(q.id));
    if (pool.length === 0) {
      // Já vi todas mas deixei algumas sem responder: volta a mostrá-las.
      seenIds = new Set();
      pool = unanswered;
    }
  } else {
    // Refazer: todas as questões, sem repetir até esgotar.
    pool = practiceQuestions.filter((q) => !seenIds.has(q.id));
    if (pool.length === 0) {
      seenIds = new Set();
      pool = practiceQuestions;
    }
  }

  const batch = shuffle(pool).slice(0, PRACTICE_BATCH_SIZE);
  for (const q of batch) {
    seenIds.add(q.id);
  }
  return batch;
}

function showNextBatch() {
  const list = $("practice-list");
  list.textContent = "";
  hideMessage($("practice-message"));

  const batch = pickBatch();

  if (batch === null) {
    $("practice-status").textContent =
      practiceQuestions.length === 1
        ? "Você já respondeu a única questão deste tema!"
        : "Você já respondeu todas as " + practiceQuestions.length + " questões deste tema!";
    $("btn-practice-more").hidden = true;
    $("practice-redo").hidden = false;
    return;
  }

  $("practice-status").textContent = redoMode
    ? "Refazendo questões já respondidas (cada resposta conta como nova tentativa)."
    : "";
  batch.forEach((question, index) => {
    list.append(renderQuestionCard(question, index + 1));
  });
  $("btn-practice-more").hidden = false;
  $("practice-redo").hidden = true;

  // Leva o ecrã de volta ao topo da lista (útil no celular).
  list.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startRedo() {
  redoMode = true;
  seenIds = new Set();
  showNextBatch();
}

// ---------------------------------------------------------------------
// Cartão de uma questão
// ---------------------------------------------------------------------
function renderQuestionCard(question, number) {
  const card = makeEl("article", "question-card");

  const theme = findThemeById(question.theme_id);
  const header = makeEl("div", "doubt-header");
  header.append(
    makeEl("span", "doubt-theme", "Questão " + number),
    makeEl("span", "doubt-date", themeLabel(theme))
  );
  card.append(header);

  const statement = makeEl("div", "question-statement math-text");
  setMathText(statement, question.statement);
  card.append(statement);

  // Alternativas (A–D, ou A–E se houver option_e)
  const fieldset = makeEl("fieldset", "options");
  fieldset.append(makeEl("legend", "sr-only", "Escolha uma alternativa"));

  const letters = ["A", "B", "C", "D", "E"].filter(
    (letter) => question["option_" + letter.toLowerCase()]
  );
  const optionLabels = {};
  const radioName = "question-" + question.id;

  for (const letter of letters) {
    const label = makeEl("label", "option");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = radioName;
    radio.value = letter;
    const text = makeEl("span", "option-text math-text");
    setMathText(text, question["option_" + letter.toLowerCase()]);
    label.append(radio, makeEl("span", "option-letter", letter + ")"), text);
    fieldset.append(label);
    optionLabels[letter] = label;
  }
  card.append(fieldset);

  const confirmButton = makeEl("button", "btn", "Confirmar");
  confirmButton.type = "button";
  confirmButton.disabled = true;
  const feedback = makeEl("div", "feedback");
  feedback.hidden = true;
  feedback.setAttribute("role", "status");
  const message = makeEl("p", "msg msg-error");
  message.hidden = true;
  message.setAttribute("role", "alert");

  // Só deixa confirmar depois de escolher uma alternativa.
  fieldset.addEventListener("change", () => {
    confirmButton.disabled = false;
  });

  confirmButton.addEventListener("click", async () => {
    const chosenRadio = fieldset.querySelector("input:checked");
    if (!chosenRadio) {
      return;
    }
    const chosen = chosenRadio.value;

    // Bloqueia já, para não dar para mudar nem confirmar duas vezes.
    confirmButton.disabled = true;
    setRadiosDisabled(fieldset, true);
    hideMessage(message);

    // A base de dados calcula is_correct sozinha (trigger da Fase 1).
    const { data, error } = await supabaseClient
      .from("attempts")
      .insert({ question_id: question.id, chosen })
      .select("is_correct")
      .single();

    if (error) {
      console.error(error);
      showMessage(message, "Não foi possível salvar sua resposta. Tente de novo.", true);
      confirmButton.disabled = false;
      setRadiosDisabled(fieldset, false);
      return;
    }

    confirmButton.remove();
    showAnswer(question, chosen, data.is_correct, optionLabels, feedback);

    practiceAttempts.push({ question_id: question.id, is_correct: data.is_correct });
    answeredIds.add(question.id);
    updateSummary();
  });

  card.append(confirmButton, message, feedback);
  return card;
}

function setRadiosDisabled(fieldset, disabled) {
  for (const radio of fieldset.querySelectorAll("input")) {
    radio.disabled = disabled;
  }
}

// Mostra se acertou, a alternativa correta e a explicação.
function showAnswer(question, chosen, isCorrect, optionLabels, feedback) {
  optionLabels[question.correct].classList.add("is-correct");
  if (!isCorrect && optionLabels[chosen]) {
    optionLabels[chosen].classList.add("is-wrong");
  }

  feedback.textContent = "";
  feedback.classList.toggle("is-wrong", !isCorrect);
  feedback.append(
    makeEl(
      "p",
      "feedback-title",
      isCorrect ? "✔ Você acertou!" : "✘ Não foi dessa vez. A resposta correta é a " + question.correct + "."
    )
  );
  const explanation = makeEl("div", "math-text");
  setMathText(explanation, question.explanation);
  feedback.append(makeEl("p", "feedback-subtitle", "Explicação"), explanation);
  feedback.hidden = false;
}

// ---------------------------------------------------------------------
// Resumo "acertou X de Y neste tema"
// ---------------------------------------------------------------------
function updateSummary() {
  const summary = $("practice-summary");
  const total = practiceAttempts.length;
  if (practiceQuestions.length === 0 || total === 0) {
    summary.hidden = true;
    return;
  }
  const correct = practiceAttempts.filter((a) => a.is_correct).length;
  summary.textContent =
    "Neste tema você acertou " + correct + " de " + total +
    (total === 1 ? " resposta." : " respostas.");
  summary.hidden = false;
}
