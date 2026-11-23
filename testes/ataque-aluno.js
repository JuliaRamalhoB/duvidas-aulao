// =====================================================================
// Teste de segurança: "aluno mal-intencionado"
//
// Como usar:
//   1. Abre o site e entra com uma conta de ALUNO (não a da professora).
//   2. Carrega F12 > separador "Console".
//   3. Cola este ficheiro inteiro e carrega Enter.
//      (Se o Chrome pedir, escreve primeiro "allow pasting" e Enter.)
//   4. No fim aparece uma tabela. Todas as linhas devem ter ok = "✅".
//
// O script tenta fazer coisas proibidas usando a API diretamente, com o
// token do aluno — exatamente o que um aluno esperto faria.
// Efeito secundário: pode gravar 1 tentativa de prática nesta conta.
// =====================================================================
(async () => {
  const sb = supabaseClient;
  const results = [];
  const check = (test, ok, detail) =>
    results.push({ teste: test, ok: ok ? "✅" : "❌ FALHA", detalhe: detail });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    console.error("Entra primeiro com uma conta de aluno.");
    return;
  }
  const me = user.id;
  const { data: myProfile } = await sb.from("profiles").select("*").eq("id", me).single();
  if (myProfile.role === "admin") {
    console.error("Estás com a conta da professora. Entra com uma conta de ALUNO.");
    return;
  }
  const approved = myProfile.approved;
  console.log("A testar como aluno " + (approved ? "APROVADO" : "PENDENTE") + "…");

  // ---------- Perfis: tornar-me admin / aprovar-me ----------
  {
    const r = await sb.from("profiles").update({ role: "admin", approved: true }).eq("id", me).select();
    const { data: after } = await sb.from("profiles").select("role, approved").eq("id", me).single();
    check(
      "Tornar-me admin / aprovar-me (UPDATE profiles)",
      after.role === "student" && after.approved === approved,
      "erro=" + (r.error ? r.error.message : "nenhum") + "; linhas alteradas=" + (r.data ? r.data.length : 0) +
        "; role agora=" + after.role + ", approved=" + after.approved
    );
  }
  {
    const r = await sb.from("profiles").select("id, email");
    const others = (r.data || []).filter((p) => p.id !== me);
    check("Ler perfis/emails de outros", others.length === 0, "perfis de outros visíveis: " + others.length);
  }
  {
    const r = await sb.from("profiles").insert({ id: crypto.randomUUID(), display_name: "x", email: "x@x", role: "admin", approved: true });
    check("Criar um perfil admin (INSERT profiles)", !!r.error, r.error ? r.error.message : "INSERT FOI ACEITE!");
  }

  if (!approved) {
    // ---------- Aluno pendente: não deve ler nada ----------
    for (const table of ["themes", "doubts", "questions", "doubt_authors", "attempts"]) {
      const r = await sb.from(table).select("*").limit(5);
      check("Pendente lê " + table, (r.data || []).length === 0, "linhas: " + (r.data || []).length);
    }
    const r = await sb.rpc("create_doubt", { p_theme_id: 1, p_body: "teste" });
    check("Pendente cria dúvida", !!r.error, r.error ? r.error.message : "DÚVIDA CRIADA!");
    console.table(results);
    return;
  }

  // ---------- Anonimato ----------
  {
    const r = await sb.from("doubt_authors").select("doubt_id, author_id");
    const others = (r.data || []).filter((row) => row.author_id !== me);
    check("Ler autores de dúvidas de outros (doubt_authors)", others.length === 0,
      "linhas minhas=" + ((r.data || []).length - others.length) + ", de outros=" + others.length);
  }
  {
    const r = await sb.from("doubts").select("id, doubt_authors(author_id)");
    const leaked = (r.data || []).filter((d) => {
      const a = d.doubt_authors;
      const rows = Array.isArray(a) ? a : a ? [a] : [];
      return rows.some((row) => row.author_id !== me);
    });
    check("Descobrir autor via JOIN doubts→doubt_authors", !r.error ? leaked.length === 0 : true,
      r.error ? "erro: " + r.error.message : "dúvidas com autor alheio visível: " + leaked.length);
  }
  {
    const r = await sb.from("doubts").select("*").limit(1);
    const cols = r.data && r.data[0] ? Object.keys(r.data[0]) : [];
    const bad = cols.filter((c) => /author|user/i.test(c));
    check("Coluna de autor na tabela doubts", bad.length === 0, "colunas: " + cols.join(", "));
  }
  {
    const r = await sb.from("doubt_authors").insert({ doubt_id: 1, author_id: me });
    check("Reivindicar a autoria de uma dúvida (INSERT doubt_authors)", !!r.error, r.error ? r.error.message : "INSERT FOI ACEITE!");
  }

  // ---------- Mexer nas dúvidas ----------
  const { data: someDoubts } = await sb.from("doubts").select("id, hidden").limit(1);
  const target = someDoubts && someDoubts[0];
  {
    const r = await sb.from("doubts").insert({ theme_id: 1, body: "inserida diretamente" });
    check("Criar dúvida sem passar pela função (INSERT doubts)", !!r.error, r.error ? r.error.message : "INSERT FOI ACEITE!");
  }
  if (target) {
    const r1 = await sb.from("doubts").update({ hidden: true, answer_body: "hackeado" }).eq("id", target.id).select();
    check("Ocultar/responder dúvida (UPDATE doubts)", !(r1.data && r1.data.length), "linhas alteradas: " + (r1.data ? r1.data.length : 0));
    const r2 = await sb.from("doubts").delete().eq("id", target.id).select();
    check("Apagar dúvida (DELETE doubts)", !(r2.data && r2.data.length), "linhas apagadas: " + (r2.data ? r2.data.length : 0));
  } else {
    check("Ocultar/apagar dúvida", true, "(sem dúvidas visíveis para testar — cria uma com outro aluno)");
  }
  {
    const r = await sb.from("doubts").select("id").eq("hidden", true);
    check("Ver dúvidas ocultas", (r.data || []).length === 0, "ocultas visíveis: " + (r.data || []).length);
  }
  {
    const r = await sb.rpc("create_doubt", { p_theme_id: 1, p_body: "x".repeat(1001) });
    check("Dúvida com 1001 caracteres", !!r.error, r.error ? r.error.message : "ACEITE!");
  }

  // ---------- Temas, questões, importação ----------
  {
    const r = await sb.from("themes").insert({ discipline: "Hack", topic: "Hack" });
    check("Criar tema (INSERT themes)", !!r.error, r.error ? r.error.message : "INSERT FOI ACEITE!");
  }
  {
    const r = await sb.from("questions").insert({
      theme_id: 1, statement: "x", option_a: "a", option_b: "b", option_c: "c", option_d: "d", correct: "A", explanation: "x",
    });
    check("Criar questão (INSERT questions)", !!r.error, r.error ? r.error.message : "INSERT FOI ACEITE!");
  }
  {
    const r = await sb.from("questions").update({ correct: "A" }).gt("id", 0).select();
    check("Alterar gabarito (UPDATE questions)", !(r.data && r.data.length), "linhas alteradas: " + (r.data ? r.data.length : 0));
  }
  {
    const r = await sb.rpc("import_questions", { p_rows: [] });
    check("Importar CSV (RPC import_questions)", !!r.error, r.error ? r.error.message : "ACEITE!");
  }

  // ---------- Tentativas ----------
  {
    const r = await sb.from("attempts").select("user_id");
    const others = (r.data || []).filter((a) => a.user_id !== me);
    check("Ler tentativas de outros (attempts)", others.length === 0, "de outros: " + others.length);
  }
  {
    const { data: qs } = await sb.from("questions").select("id, correct").limit(1);
    if (qs && qs[0]) {
      const wrong = qs[0].correct === "A" ? "B" : "A";
      const fakeUser = crypto.randomUUID();
      const r = await sb.from("attempts")
        .insert({ question_id: qs[0].id, chosen: wrong, is_correct: true, user_id: fakeUser })
        .select("user_id, is_correct").single();
      const ok = r.error || (r.data.user_id === me && r.data.is_correct === false);
      check("Falsificar tentativa (outro user_id + is_correct=true)", !!ok,
        r.error ? "recusada: " + r.error.message : "gravada como user_id=" + (r.data.user_id === me ? "EU" : "OUTRO") +
          ", is_correct=" + r.data.is_correct);
    }
  }

  // ---------- Funções auxiliares ----------
  {
    const r = await sb.rpc("is_admin");
    check("is_admin() devolve false", r.data === false, "devolveu " + JSON.stringify(r.data));
  }

  console.table(results);
  const fails = results.filter((r) => r.ok !== "✅").length;
  console.log(fails === 0 ? "✅ Todos os ataques foram bloqueados." : "❌ " + fails + " ataque(s) passaram! Manda-me a tabela.");
})();
