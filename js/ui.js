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
function setMathText(element, text) {
  element.textContent = text;
  if (typeof renderMathInElement === "function") {
    renderMathInElement(element, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}
