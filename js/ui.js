// Funções pequenas de interface, usadas em vários ficheiros.

// Cria um elemento com classe e texto (o texto entra SEMPRE como textContent,
// por isso nunca é interpretado como HTML -> sem risco de XSS).
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined && text !== null) {
    el.textContent = text;
  }
  return el;
}

// Formata uma data no fuso de São Paulo, ex.: "23/11/2026, 14:05".
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

function formatDateTime(isoText) {
  if (!isoText) {
    return "";
  }
  return dateFormatter.format(new Date(isoText));
}

// Põe texto num elemento e renderiza as fórmulas com KaTeX.
// Primeiro o texto entra com textContent (seguro); só depois o KaTeX
// procura $...$ e $$...$$ dentro desse texto.
//
// "R$" (dinheiro) NÃO é início de fórmula: cada "R$" vai para um
// <span class="no-math"> que o KaTeX ignora. Como o span separa o texto,
// o KaTeX também não junta o $ de "R$ 70" com o de "R$ 65".
function setMathText(element, text) {
  element.textContent = "";
  const parts = text.split("R$");
  parts.forEach((part, index) => {
    if (index > 0) {
      element.append(makeEl("span", "no-math", "R$"));
    }
    element.append(document.createTextNode(part));
  });

  if (typeof renderMathInElement === "function") {
    renderMathInElement(element, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      ignoredClasses: ["no-math"],
      throwOnError: false,
    });
  }
}
