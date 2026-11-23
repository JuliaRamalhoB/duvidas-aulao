// Lógica principal: ligação ao Supabase, conta (registo/login/logout),
// ecrã de espera e navegação entre secções.
//
// Regra de segurança: todo o texto vindo da base de dados é posto na
// página com textContent (nunca innerHTML), para evitar XSS.

// ---------------------------------------------------------------------
// Estado global simples
// ---------------------------------------------------------------------
let supabaseClient = null;
let currentProfile = null; // perfil do utilizador com login (ou null)

// Atalho para document.getElementById
function $(id) {
  return document.getElementById(id);
}

// ---------------------------------------------------------------------
// Ecrãs
// ---------------------------------------------------------------------
const SCREENS = ["screen-loading", "screen-error", "screen-auth", "screen-pending", "screen-app"];

// Mostra um ecrã e esconde os outros.
function showScreen(screenId) {
  for (const id of SCREENS) {
    $(id).hidden = id !== screenId;
  }
}

function showFatalError(text) {
  $("error-text").textContent = text;
  showScreen("screen-error");
}

// Mostra uma mensagem num elemento <p class="msg">.
// isError = true pinta de vermelho.
function showMessage(element, text, isError) {
  element.textContent = text;
  element.classList.toggle("msg-error", Boolean(isError));
  element.hidden = false;
}

function hideMessage(element) {
  element.hidden = true;
  element.textContent = "";
}

// ---------------------------------------------------------------------
// Tradução das mensagens de erro do Supabase Auth
// ---------------------------------------------------------------------
function translateAuthError(error) {
  const msg = (error && error.message ? error.message : "").toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "Email ou senha incorretos.";
  }
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "Já existe uma conta com este email. Use a aba “Entrar”.";
  }
  if (msg.includes("password should be at least") || msg.includes("weak password")) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }
  if (msg.includes("unable to validate email") || msg.includes("invalid format") || (msg.includes("email address") && msg.includes("invalid"))) {
    return "Esse email não parece válido.";
  }
  if (msg.includes("email not confirmed")) {
    return "Este email ainda não foi confirmado. Avise a professora.";
  }
  if (msg.includes("rate limit") || msg.includes("too many")) {
    return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "Sem conexão com o servidor. Verifique sua internet.";
  }
  if (msg.includes("signups not allowed") || msg.includes("logins are disabled") || msg.includes("provider is not enabled")) {
    return "O cadastro por email está desativado no Supabase. Avise a professora.";
  }
  // Erro desconhecido: mostra os detalhes na consola (F12) para ajudar a depurar.
  console.error("Erro do Supabase Auth:", error);
  return "Não foi possível concluir. Tente de novo.";
}

// ---------------------------------------------------------------------
// Perfil e decisão de qual ecrã mostrar
// ---------------------------------------------------------------------

// Lê o perfil do utilizador com login. Devolve o perfil ou null.
async function loadProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, display_name, role, approved")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

function isAdmin() {
  return currentProfile !== null && currentProfile.role === "admin";
}

function isApproved() {
  return currentProfile !== null && (currentProfile.approved || isAdmin());
}

// Decide o ecrã a mostrar conforme a sessão e o perfil.
async function renderForSession(session) {
  if (!session) {
    stopForum();
    clearAdminPanel();
    clearPractice();
    currentProfile = null;
    showScreen("screen-auth");
    return;
  }

  showScreen("screen-loading");

  try {
    currentProfile = await loadProfile(session.user.id);
  } catch (error) {
    console.error(error);
    showFatalError("Não foi possível carregar seu perfil. Verifique sua internet e tente de novo.");
    return;
  }

  if (!currentProfile) {
    // Não devia acontecer: o trigger cria o perfil no registo.
    showFatalError("Seu perfil não foi encontrado. Avise a professora.");
    return;
  }

  if (!isApproved()) {
    stopForum();
    clearAdminPanel();
    clearPractice();
    $("pending-name").textContent = currentProfile.display_name;
    hideMessage($("pending-message"));
    showScreen("screen-pending");
    return;
  }

  $("user-name").textContent = currentProfile.display_name;
  $("nav-admin").hidden = !isAdmin();
  showScreen("screen-app");
  showSectionFromHash();
  startForum();
}

// ---------------------------------------------------------------------
// Navegação entre secções (usa o # do endereço, ex.: index.html#mine)
// ---------------------------------------------------------------------
const SECTIONS = ["feed", "mine", "practice", "admin"];

function showSectionFromHash() {
  let name = location.hash.replace("#", "");

  // Secção desconhecida, ou "admin" para quem não é admin -> vai para o feed.
  // (Isto é só a interface; a proteção real está no RLS do Supabase.)
  if (!SECTIONS.includes(name) || (name === "admin" && !isAdmin())) {
    name = "feed";
  }

  for (const section of SECTIONS) {
    $("section-" + section).hidden = section !== name;
  }

  // Ao abrir o Painel, recarrega a lista de pendentes e a contagem.
  if (name === "admin") {
    openAdminPanel();
  }
  if (name === "practice") {
    openPractice();
  }

  for (const link of document.querySelectorAll(".app-nav a")) {
    const active = link.dataset.section === name;
    link.classList.toggle("active", active);
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

// ---------------------------------------------------------------------
// Abas Entrar / Criar conta
// ---------------------------------------------------------------------
function selectAuthTab(tab) {
  const isLogin = tab === "login";
  $("tab-login").classList.toggle("active", isLogin);
  $("tab-register").classList.toggle("active", !isLogin);
  $("tab-login").setAttribute("aria-selected", String(isLogin));
  $("tab-register").setAttribute("aria-selected", String(!isLogin));
  $("form-login").hidden = !isLogin;
  $("form-register").hidden = isLogin;
  hideMessage($("auth-message"));
}

// ---------------------------------------------------------------------
// Ações de conta
// ---------------------------------------------------------------------
async function handleLogin(event) {
  event.preventDefault();
  const message = $("auth-message");
  const button = event.target.querySelector("button[type=submit]");

  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  if (!email || !password) {
    showMessage(message, "Preencha o email e a senha.", true);
    return;
  }

  button.disabled = true;
  showMessage(message, "Entrando…", false);

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  button.disabled = false;
  if (error) {
    showMessage(message, translateAuthError(error), true);
    return;
  }
  hideMessage(message);
  // O resto acontece em onAuthStateChange.
}

async function handleRegister(event) {
  event.preventDefault();
  const message = $("auth-message");
  const button = event.target.querySelector("button[type=submit]");

  const name = $("register-name").value.trim();
  const email = $("register-email").value.trim();
  const password = $("register-password").value;

  if (!name || !email || !password) {
    showMessage(message, "Preencha nome, email e senha.", true);
    return;
  }
  if (name.length > 80) {
    showMessage(message, "O nome pode ter no máximo 80 caracteres.", true);
    return;
  }
  if (password.length < 6) {
    showMessage(message, "A senha precisa ter pelo menos 6 caracteres.", true);
    return;
  }

  button.disabled = true;
  showMessage(message, "Criando conta…", false);

  // O nome vai nos metadados; o trigger da base de dados copia-o para profiles.
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: name } },
  });

  button.disabled = false;
  if (error) {
    showMessage(message, translateAuthError(error), true);
    return;
  }

  if (!data.session) {
    // Acontece se a confirmação por email estiver ligada no Supabase.
    showMessage(
      message,
      "Conta criada, mas o sistema pediu confirmação por email. Avise a professora.",
      true
    );
    return;
  }
  hideMessage(message);
  // Com sessão, onAuthStateChange mostra o ecrã de espera.
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  location.hash = "";
  // onAuthStateChange mostra o ecrã de login.
}

async function handleCheckAgain() {
  const button = $("btn-check-again");
  const message = $("pending-message");
  button.disabled = true;

  const { data } = await supabaseClient.auth.getSession();
  await renderForSession(data.session);

  button.disabled = false;
  if (!isApproved() && !$("screen-pending").hidden) {
    showMessage(message, "Ainda não foi aprovado. Tente de novo daqui a pouco.", false);
  }
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
function start() {
  // Botão do ecrã de erro (sem onclick no HTML, por causa da CSP).
  $("btn-reload").addEventListener("click", () => location.reload());

  // Verifica se o config.js foi preenchido.
  if (
    typeof SUPABASE_URL === "undefined" ||
    typeof SUPABASE_PUBLISHABLE_KEY === "undefined" ||
    SUPABASE_URL.startsWith("COLE_AQUI") ||
    SUPABASE_PUBLISHABLE_KEY.startsWith("COLE_AQUI")
  ) {
    showFatalError("Configuração em falta: preencha o arquivo js/config.js.");
    return;
  }

  // O Project URL é só o endereço base, sem /rest/v1 nem / no fim.
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL)) {
    showFatalError(
      "O SUPABASE_URL em js/config.js deve ser só o endereço base, " +
      "por exemplo https://abcdefgh.supabase.co (sem /rest/v1/ no fim)."
    );
    return;
  }

  if (!window.supabase) {
    showFatalError("Não foi possível carregar a biblioteca do Supabase. Verifique sua internet.");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  // Ligar botões e formulários
  $("tab-login").addEventListener("click", () => selectAuthTab("login"));
  $("tab-register").addEventListener("click", () => selectAuthTab("register"));
  $("form-login").addEventListener("submit", handleLogin);
  $("form-register").addEventListener("submit", handleRegister);
  $("btn-check-again").addEventListener("click", handleCheckAgain);
  for (const button of document.querySelectorAll(".btn-logout")) {
    button.addEventListener("click", handleLogout);
  }
  window.addEventListener("hashchange", () => {
    if (!$("screen-app").hidden) {
      showSectionFromHash();
    }
  });

  // Reage a login, logout e ao carregar a página (INITIAL_SESSION).
  // O setTimeout evita chamar o Supabase dentro deste callback
  // (recomendação da documentação do supabase-js, para não bloquear).
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      return; // nada mudou para o ecrã
    }
    // O Supabase repete SIGNED_IN ao voltar ao separador; se já estamos
    // dentro com o mesmo utilizador, não recarregamos o ecrã.
    if (
      event === "SIGNED_IN" &&
      session &&
      currentProfile &&
      currentProfile.id === session.user.id &&
      $("screen-app").hidden === false
    ) {
      return;
    }
    setTimeout(() => renderForSession(session), 0);
  });
}

start();
