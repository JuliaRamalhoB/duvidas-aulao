// Temas (disciplina > tópico > subtópico) e os seletores em cascata.
// Usado no fórum (enviar dúvida e filtros) e, mais tarde, na prática.

let allThemes = []; // lista de { id, discipline, topic, subtopic }

async function loadThemes() {
  const { data, error } = await supabaseClient
    .from("themes")
    .select("id, discipline, topic, subtopic");
  if (error) {
    throw error;
  }
  allThemes = data;
}

function findThemeById(id) {
  return allThemes.find((t) => t.id === id) || null;
}

// Texto do tema, ex.: "Matemática › Geometria".
function themeLabel(theme) {
  if (!theme) {
    return "Tema";
  }
  const parts = [theme.discipline, theme.topic];
  if (theme.subtopic) {
    parts.push(theme.subtopic);
  }
  return parts.join(" › ");
}

// Valores únicos, sem vazios, por ordem alfabética.
function uniqueSorted(values) {
  const unique = [...new Set(values.filter((v) => v))];
  return unique.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Cria um <label> + <select> dentro do container.
function makeLabeledSelect(container, id, labelText) {
  const label = makeEl("label", null, labelText);
  label.htmlFor = id;
  const select = document.createElement("select");
  select.id = id;
  container.append(label, select);
  return select;
}

// Preenche um <select> com uma primeira opção (valor "") e depois os valores.
function fillSelect(select, firstLabel, values, keepValue) {
  select.textContent = "";
  select.append(new Option(firstLabel, ""));
  for (const value of values) {
    select.append(new Option(value, value));
  }
  select.value = values.includes(keepValue) ? keepValue : "";
}

// Textos da primeira opção de cada seletor, conforme o modo.
const PICKER_TEXTS = {
  // escolher o tema de uma dúvida
  form: {
    discipline: "Escolha a disciplina",
    topic: "Escolha o tópico",
    subtopic: "Nenhum (geral do tópico)",
    subtopicLabel: "Subtópico (opcional)",
  },
  // filtrar o mural
  filter: { discipline: "Todas", topic: "Todos", subtopic: "Todos", subtopicLabel: "Subtópico" },
  // escolher o tema para praticar ("Todos" = todos os subtópicos do tópico)
  practice: {
    discipline: "Escolha a disciplina",
    topic: "Escolha o tópico",
    subtopic: "Todos os subtópicos",
    subtopicLabel: "Subtópico (opcional)",
  },
};

// Cria os 3 seletores em cascata.
// options.mode: "form", "filter" ou "practice" (ver PICKER_TEXTS)
// options.onChange: função chamada quando a escolha muda (opcional)
function createThemePicker(container, options) {
  const texts = PICKER_TEXTS[options.mode];
  const prefix = options.idPrefix;

  container.textContent = "";
  const disciplineSelect = makeLabeledSelect(container, prefix + "-discipline", "Disciplina");
  const topicSelect = makeLabeledSelect(container, prefix + "-topic", "Tópico");
  const subtopicSelect = makeLabeledSelect(container, prefix + "-subtopic", texts.subtopicLabel);

  function updateOptions() {
    const discipline = disciplineSelect.value;
    const topic = topicSelect.value;
    const subtopic = subtopicSelect.value;

    fillSelect(
      disciplineSelect,
      texts.discipline,
      uniqueSorted(allThemes.map((t) => t.discipline)),
      discipline
    );

    const topics = uniqueSorted(
      allThemes.filter((t) => t.discipline === disciplineSelect.value).map((t) => t.topic)
    );
    fillSelect(topicSelect, texts.topic, topics, topic);
    topicSelect.disabled = disciplineSelect.value === "";

    const subtopics = uniqueSorted(
      allThemes
        .filter((t) => t.discipline === disciplineSelect.value && t.topic === topicSelect.value)
        .map((t) => t.subtopic)
    );
    fillSelect(subtopicSelect, texts.subtopic, subtopics, subtopic);
    subtopicSelect.disabled = topicSelect.value === "" || subtopics.length === 0;
  }

  function handleChange() {
    updateOptions();
    if (options.onChange) {
      options.onChange();
    }
  }

  disciplineSelect.addEventListener("change", handleChange);
  topicSelect.addEventListener("change", handleChange);
  subtopicSelect.addEventListener("change", handleChange);
  updateOptions();

  return {
    // Escolha atual: { discipline, topic, subtopic } ("" = nada escolhido)
    getValues() {
      return {
        discipline: disciplineSelect.value,
        topic: topicSelect.value,
        subtopic: subtopicSelect.value,
      };
    },

    // id do tema exato escolhido (ou null se não existir essa linha).
    getThemeId() {
      const v = this.getValues();
      const theme = allThemes.find(
        (t) =>
          t.discipline === v.discipline &&
          t.topic === v.topic &&
          (t.subtopic || "") === v.subtopic
      );
      return theme ? theme.id : null;
    },

    // Para filtros: o tema passa no filtro atual?
    matches(theme) {
      const v = this.getValues();
      if (!theme) {
        return v.discipline === "";
      }
      if (v.discipline && theme.discipline !== v.discipline) return false;
      if (v.topic && theme.topic !== v.topic) return false;
      if (v.subtopic && theme.subtopic !== v.subtopic) return false;
      return true;
    },

    reset() {
      disciplineSelect.value = "";
      updateOptions();
    },

    // Reconstrói as opções (ex.: depois de recarregar allThemes).
    refresh: updateOptions,
  };
}
