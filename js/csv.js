// Leitura e validação do CSV de questões.
// Não fala com o Supabase: recebe texto e devolve questões + erros.

const CSV_COLUMNS = [
  "discipline", "topic", "subtopic", "statement",
  "option_a", "option_b", "option_c", "option_d", "option_e",
  "correct", "explanation",
];

// Limites iguais aos CHECK da base de dados.
const CSV_LIMITS = {
  discipline: 100, topic: 100, subtopic: 100,
  statement: 3000,
  option_a: 1000, option_b: 1000, option_c: 1000, option_d: 1000, option_e: 1000,
  explanation: 5000,
};

const CSV_MAX_QUESTIONS = 1000;

// Divide o texto CSV em linhas e campos.
// Suporta campos entre aspas (com vírgulas, ; e quebras de linha lá dentro)
// e aspas duplicadas ("") para escrever uma aspa.
// Devolve { rows: [{ line, fields }], unclosedQuote }
// "line" é o número da linha no ficheiro onde o registo começa.
function parseCsv(text) {
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  // Separador: o que aparecer mais vezes na 1.ª linha (cabeçalho).
  const headerLine = text.split("\n")[0];
  const semicolons = headerLine.split(";").length - 1;
  const commas = headerLine.split(",").length - 1;
  const separator = semicolons > commas ? ";" : ",";

  const rows = [];
  let fields = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === separator) {
      fields.push(field);
      field = "";
    } else if (ch === "\n") {
      fields.push(field);
      rows.push({ line: rowStartLine, fields });
      fields = [];
      field = "";
      line++;
      rowStartLine = line;
    } else {
      field += ch;
    }
  }

  // Último registo (ficheiro sem quebra de linha no fim)
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    rows.push({ line: rowStartLine, fields });
  }

  return { rows, unclosedQuote: inQuotes };
}

// Valida o texto todo.
// Devolve { questions: [...], errors: [{ line, message }] }
// Se errors não estiver vazio, NÃO se deve importar nada.
function validateQuestionsCsv(text) {
  const errors = [];
  const questions = [];

  if (text.includes("�")) {
    errors.push({
      line: 0,
      message: "O arquivo não parece estar em UTF-8 (acentos estranhos). " +
        "No Excel, use “Salvar como” > “CSV UTF-8”.",
    });
    return { questions, errors };
  }

  const { rows, unclosedQuote } = parseCsv(text);

  // Ignora linhas vazias
  const nonEmpty = rows.filter((row) => row.fields.some((f) => f.trim() !== ""));
  if (nonEmpty.length === 0) {
    errors.push({ line: 0, message: "O arquivo está vazio." });
    return { questions, errors };
  }

  if (unclosedQuote) {
    errors.push({
      line: nonEmpty[nonEmpty.length - 1].line,
      message: "Há aspas (\") abertas que nunca são fechadas a partir desta linha.",
    });
  }

  // Cabeçalho
  const header = nonEmpty[0];
  const names = header.fields.map((f) => f.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !names.includes(c));
  const unknown = names.filter((n) => n !== "" && !CSV_COLUMNS.includes(n));
  if (missing.length > 0) {
    errors.push({ line: header.line, message: "Faltam colunas no cabeçalho: " + missing.join(", ") + "." });
  }
  if (unknown.length > 0) {
    errors.push({ line: header.line, message: "Colunas desconhecidas no cabeçalho: " + unknown.join(", ") + "." });
  }
  if (missing.length > 0 || unknown.length > 0) {
    return { questions: [], errors };
  }

  const dataRows = nonEmpty.slice(1);
  if (dataRows.length === 0) {
    errors.push({ line: header.line, message: "O arquivo só tem o cabeçalho, sem questões." });
    return { questions, errors };
  }
  if (dataRows.length > CSV_MAX_QUESTIONS) {
    errors.push({ line: 0, message: "No máximo " + CSV_MAX_QUESTIONS + " questões por arquivo." });
    return { questions: [], errors };
  }

  for (const row of dataRows) {
    const rowErrors = [];

    if (row.fields.length !== names.length) {
      errors.push({
        line: row.line,
        message: "Tem " + row.fields.length + " colunas, mas o cabeçalho tem " + names.length +
          ". Verifique o separador e as aspas.",
      });
      continue;
    }

    // Monta o objeto { discipline: "...", topic: "...", ... } com tudo aparado.
    const q = {};
    names.forEach((name, index) => {
      q[name] = row.fields[index].trim();
    });

    const required = ["discipline", "topic", "statement", "option_a", "option_b",
      "option_c", "option_d", "correct", "explanation"];
    for (const column of required) {
      if (q[column] === "") {
        rowErrors.push(column + " está vazio");
      }
    }

    for (const column of Object.keys(CSV_LIMITS)) {
      if (q[column].length > CSV_LIMITS[column]) {
        rowErrors.push(column + " tem mais de " + CSV_LIMITS[column] + " caracteres");
      }
    }

    q.correct = q.correct.toUpperCase();
    if (q.correct !== "") {
      if (!["A", "B", "C", "D", "E"].includes(q.correct)) {
        rowErrors.push("correct deve ser uma letra de A a E (está “" + q.correct + "”)");
      } else if (q["option_" + q.correct.toLowerCase()] === "") {
        rowErrors.push("correct é " + q.correct + ", mas option_" + q.correct.toLowerCase() + " está vazia");
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ line: row.line, message: rowErrors.join("; ") + "." });
    } else {
      questions.push(q);
    }
  }

  return { questions, errors };
}

// Exporta para os testes em Node (no navegador isto é ignorado).
if (typeof module !== "undefined") {
  module.exports = { parseCsv, validateQuestionsCsv };
}
