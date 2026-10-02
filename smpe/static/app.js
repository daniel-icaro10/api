// SIS SMPE - telas (SPA sem dependencias)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtN = n => (n ?? 0).toLocaleString("pt-BR");
const fmtPct = n => ((n || 0) * 100).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + "%";
const fmtBRL = n => (n || 0).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});
const fmtData = d => d ? d.slice(0, 10).split("-").reverse().join("/") : "";
const fmtCNPJ = c => c && c.length === 14 ? `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}` : (c || "");
const fmtLogin = l => /^\d{11}$/.test(l || "") ? fmtCPF(l) : (l || "");
const fmtCPF = c => c && c.length === 11 ? `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}` : (c || "");
const agora = () => new Date().toLocaleString("pt-BR");
const fmtDH = s => s ? fmtData(s) + (s.length > 10 ? " " + s.slice(11, 16) : "") : "";  // "AAAA-MM-DD HH:MM:SS" -> "DD/MM/AAAA HH:MM"
const icDl = `<svg class="i"><use href="#i-download"/></svg>`;

// download padrao das tabelas: cada tela registra XLS[id] = () => ({titulo, subtitulo, colunas: [[titulo, tipo]], linhas})
// tipos: texto, numero, decimal, moeda, pct, data, datahora, cpf. Sempre baixa a lista inteira (todas as paginas) com os filtros.
const XLS = {};
const btnXls = id => `<button type="button" class="btn-dl" data-xls="${id}" title="Baixar a lista completa em Excel (todas as páginas, com os filtros aplicados)">${icDl}Baixar Excel</button>`;
async function baixarXls(id, botao) {
  const t = XLS[id]?.();
  if (!t) return;
  if (!t.linhas.length) return toast("Nada para baixar: a tabela está vazia");
  botao.disabled = true;
  try {
    const r = await api("/api/exportar", {method: "POST", body: {titulo: t.titulo, subtitulo: t.subtitulo || "",
      colunas: t.colunas.map(([titulo, tipo = "texto"]) => ({titulo, tipo})), linhas: t.linhas.map(l => l.map(v => v ?? ""))}});
    const nome = (r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "planilha.xlsx";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob()); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Planilha baixada: ${fmtN(t.linhas.length)} linha(s)`);
  } finally { botao.disabled = false; }
}
document.addEventListener("click", e => { const b = e.target.closest("[data-xls]"); if (b) baixarXls(b.dataset.xls, b); });

async function api(url, opts = {}) {
  const o = {...opts};
  if (o.body && !(o.body instanceof FormData)) { o.headers = {"Content-Type": "application/json"}; o.body = JSON.stringify(o.body); }
  const r = await fetch(url, o);
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = Array.isArray(j.detail) ? j.detail.map(d => `${(d.loc || []).slice(-1)[0] || ""}: ${d.msg}`).join("; ") : j.detail || msg; } catch {}
    if (!opts.semLogin && (r.status === 401 || (r.status === 403 && msg.startsWith("Acesso ")))) {
      mostrarLogin(url === "/api/sessao" ? "" : msg); throw new Error(msg);
    }
    if (!opts.semLogin) toast("Erro: " + msg);
    throw new Error(msg);
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : r;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 3500); }
function modal(html) { $("#modalBody").innerHTML = html; if (!$("#modal").open) $("#modal").showModal(); }
function closeModal() { $("#modal").close(); }
function drawer(html) { $("#drawerPanel").innerHTML = html; $("#drawer").classList.add("open"); }
function closeDrawer() { $("#drawer").classList.remove("open"); }
$("#drawer").addEventListener("click", e => { if (e.target.id === "drawer") closeDrawer(); });

// ------------------------------------------------------------------ acesso (admin / instituicao)
let SESSAO = null, PUBLICO = {};
const ehAdmin = () => SESSAO?.perfil === "admin";
const ehRH = () => SESSAO?.perfil === "rh";
const iniciais = n => (n || "?").split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const waLink = n => `https://wa.me/${n.length <= 11 ? "55" + n : n}`;
function mostrarLogin(msg = "") {
  SESSAO = null; ESCOLAS = [];
  const setup = !!PUBLICO.precisa_setup;
  $("#loginTitulo").textContent = setup ? "Primeiro acesso" : "Entrar";
  $("#loginSub").textContent = setup ? "Informe o e-mail e crie a senha do administrador do sistema." : "Acesse com o seu e-mail e a sua senha.";
  $("#loginConf").hidden = !setup; $("#loginConf input").required = setup;
  $("#loginBtn").textContent = setup ? "Criar administrador" : "Entrar";
  $("#loginMsg").textContent = msg; $("#loginMsg").hidden = !msg;
  closeDrawer(); if ($("#modal").open) closeModal();
  $("#login").hidden = false;
}
$("#loginForm").onsubmit = async ev => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target)), erro = m => { $("#loginMsg").textContent = m; $("#loginMsg").hidden = false; };
  if (PUBLICO.precisa_setup && f.senha !== f.senha2) return erro("As senhas não conferem.");
  try { SESSAO = await api(PUBLICO.precisa_setup ? "/api/setup" : "/api/login", {method: "POST", body: {login: f.login, senha: f.senha}, semLogin: true}); }
  catch (e) { return erro(e.message); }
  PUBLICO.precisa_setup = false; ev.target.reset(); entrar();
};
function entrar() {
  $("#login").hidden = true;
  document.body.classList.toggle("inst", SESSAO.perfil === "instituicao");
  document.body.classList.toggle("rh", ehRH());
  const nome = ehAdmin() ? "Administrador" : ehRH() ? "Recursos Humanos" : SESSAO.escola_nome;
  $("#userNome").textContent = nome; $("#userNome").title = nome;
  $("#userPerfil").textContent = ehAdmin() ? `${fmtLogin(SESSAO.login)} · acesso total` : ehRH() ? `RH · ${fmtLogin(SESSAO.login)}` : `Instituição · ${fmtLogin(SESSAO.login)}`;
  $("#userAv").textContent = iniciais(nome);
  $("#buscaInput").placeholder = ehAdmin() ? "Localizar estudante por nome ou CPF…" : "Localizar estudante da instituição…";
  const escs = SESSAO.escolas || [];
  $("#trocaEsc").innerHTML = escs.length > 1 ? `<div class="um-label">Trocar instituição</div>` + escs.map(e =>
    `<button class="um-esc ${e.id === SESSAO.escola_id ? "active" : ""}" data-esc="${e.id}">${esc(e.nome)}</button>`).join("") : "";
  $("#userPerfil").textContent += escs.length > 1 ? ` · ${escs.length} instituições` : "";
  router();
}
$("#trocaEsc").onclick = async ev => {
  const b = ev.target.closest("[data-esc]");
  if (!b || +b.dataset.esc === SESSAO.escola_id) return;
  SESSAO = await api("/api/sessao/escola", {method: "PUT", body: {escola_id: +b.dataset.esc}});
  MIG = null; await loadEscolas(); toast("Instituição ativa: " + SESSAO.escola_nome);
  location.hash = "#/painel"; entrar();
};
function aplicarPublico() {
  const wa = PUBLICO.whatsapp;
  $("#waBtn").hidden = !wa; if (wa) $("#waBtn").href = waLink(wa);
  $("#loginSup").innerHTML = `<a href="#" data-sup>Suporte</a>${wa ? `<a href="${waLink(wa)}" target="_blank" rel="noopener">Suporte via WhatsApp</a>` : ""}`;
}
function suporte() {
  const wa = PUBLICO.whatsapp, txt = PUBLICO.suporte_texto;
  modal(`<div class="mh"><h2>Suporte</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <div class="mb"><p style="white-space:pre-line;margin-top:0">${esc(txt) || "Em caso de dúvidas ou problemas no sistema, entre em contato com a equipe responsável pelo SIS SMPE."}</p>
      ${wa ? `<a class="btn primary" href="${waLink(wa)}" target="_blank" rel="noopener"><svg class="i"><use href="#i-whatsapp"/></svg>Falar pelo WhatsApp</a>` : ""}</div>`);
}
$("#supBtn").onclick = e => { e.preventDefault(); suporte(); };
$("#loginSup").onclick = e => { if (e.target.matches("[data-sup]")) { e.preventDefault(); suporte(); } };
$("#userBtn").onclick = e => { e.stopPropagation(); $("#userMenu").hidden = !$("#userMenu").hidden; };
document.addEventListener("click", () => { $("#userMenu").hidden = true; });
$("#sairBtn").onclick = async () => { await api("/api/logout", {method: "POST"}); location.hash = ""; mostrarLogin(); };
$("#senhaBtn").onclick = () => {
  modal(`<div class="mh"><h2>Alterar senha</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <form id="fSenha"><div class="mb form">
      <div class="full"><label>Senha atual</label><input name="atual" type="password" required autocomplete="current-password"></div>
      <div><label>Nova senha (mín. 6 caracteres)</label><input name="nova" type="password" minlength="6" required autocomplete="new-password"></div>
      <div><label>Confirme a nova senha</label><input name="nova2" type="password" required autocomplete="new-password"></div>
    </div><div class="mf"><button type="button" onclick="closeModal()">Cancelar</button><button class="primary">Salvar</button></div></form>`);
  $("#fSenha").onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    if (f.nova !== f.nova2) return toast("As senhas não conferem");
    await api("/api/senha", {method: "PUT", body: {atual: f.atual, nova: f.nova}});
    closeModal(); toast("Senha alterada");
  };
};
const refreshLogo = () => $$("img.logo-img, .doc-head img").forEach(i => i.src = "/api/logo?t=" + Date.now());
$("#menuBtn").onclick = () => $(".side").classList.toggle("open");

const PEND = {
  sem_cpf: ["Sem CPF", "b-warn"], divergente: ["CPF divergente", "b-err"], cpf_invalido: ["CPF inválido", "b-err"],
  cpf_duplicado: ["CPF duplicado", "b-err"], nome_duplicado: ["Nome duplicado", "b-warn"], sem_mae: ["Sem mãe", "b-warn"],
  mae_incompleta: ["Mãe sem sobrenome", "b-warn"],
  critica_smtt: ["Crítica SMTT", "b-err"],
  nao_cursando: ["Não cursando", "b-err"],
};
// legenda do validador oficial SMPE (AlunoCriticaUtf8.exe)
const LEGENDA = {0: "Instituição deve ser informada e ser um número inteiro", 1: "Nome do aluno deve ser informado",
  2: "Nome da mãe deve ser informado", 3: "Sexo deve ser M ou F", 4: "Curso deve ser informado",
  5: "Grau deve ser de 1 a 3", 6: "Série/período deve ser de 1 a 9", 7: "Turno deve ser M, V, N ou I",
  8: "Matrícula deve ser informada", 9: "Data de nascimento válida com 8 dígitos", 10: "Endereço deve ser informado",
  11: "Bairro deve ser informado", 12: "Cidade deve ser informada", 13: "Nome do pai inválido", 14: "CPF é requerido",
  15: "CPF duplicado", 16: "CPF inválido", 17: "Quantidade de colunas diferente do layout (375)",
  18: "Nome da mãe deve ter nome e sobrenome (regra do SIS SMPE)"};
const pendTxt = a => a.pendencias.map(k => k === "critica_smtt" ? `Crítica SMTT ${(a.criticas || []).map(x => `(${x})`).join("")}` : PEND[k][0]).join("; ");
const codBadges = cs => (cs || []).map(k => `<span class="badge b-err" title="${esc(LEGENDA[k])}">(${k}) ${esc(LEGENDA[k])}</span>`).join("");
const pendBadges = (p, crit) => p.map(k => k === "critica_smtt" && crit?.length
  ? `<span class="badge b-err" title="${esc(crit.map(x => `(${x}) ${LEGENDA[x]}`).join("\n"))}">Crítica SMTT ${crit.map(x => `(${x})`).join("")}</span>`
  : `<span class="badge ${PEND[k][1]}">${PEND[k][0]}</span>`).join("");

// ------------------------------------------------------------------ paginacao (componente unico para todas as listagens)
const PAGS = {};
function paginar(key, itens, rerender, tamanho = 25) {
  const st = PAGS[key] ||= {pagina: 1, tamanho};
  st.rerender = rerender;
  const total = itens.length, paginas = Math.max(1, Math.ceil(total / st.tamanho));
  st.pagina = Math.min(Math.max(1, st.pagina), paginas);
  const ini = (st.pagina - 1) * st.tamanho;
  return {itens: itens.slice(ini, ini + st.tamanho), html: pagerHtml(key, st, total, paginas, ini)};
}
const resetPag = key => { if (PAGS[key]) PAGS[key].pagina = 1; };
function pagerHtml(key, st, total, paginas, ini) {
  if (!total) return "";
  const p = st.pagina, nums = [];
  for (let i = 1; i <= paginas; i++) {
    if (i === 1 || i === paginas || Math.abs(i - p) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return `<div class="pager" data-key="${key}">
    <span class="muted">Mostrando <b>${fmtN(ini + 1)}–${fmtN(Math.min(ini + st.tamanho, total))}</b> de <b>${fmtN(total)}</b></span>
    <span class="spacer"></span>
    <label class="pg-size">Por página <select data-pgsize>${[10, 25, 50, 100].map(n => `<option ${n === st.tamanho ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    ${paginas > 1 ? `<div class="pg-btns">
      <button data-pg="${p - 1}" ${p === 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>
      ${nums.map(n => n === "…" ? `<span class="pg-gap">…</span>` : `<button data-pg="${n}" class="${n === p ? "active" : ""}">${n}</button>`).join("")}
      <button data-pg="${p + 1}" ${p === paginas ? "disabled" : ""} aria-label="Próxima página">›</button></div>` : ""}
  </div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest(".pager [data-pg]");
  if (!b || b.disabled) return;
  const st = PAGS[b.closest(".pager").dataset.key];
  st.pagina = +b.dataset.pg; st.rerender();
});
document.addEventListener("change", e => {
  if (!e.target.matches(".pager [data-pgsize]")) return;
  const st = PAGS[e.target.closest(".pager").dataset.key];
  st.tamanho = +e.target.value; st.pagina = 1; st.rerender();
});

let ESCOLAS = [];
async function loadEscolas() { ESCOLAS = await api("/api/escolas"); return ESCOLAS; }
function escolaSelect(id, sel) {
  return `<select id="${id}"><option value="">Selecione a instituição…</option>${ESCOLAS.map(e =>
    `<option value="${e.id}" ${+sel === e.id ? "selected" : ""}>${e.id} · ${esc(e.nome)}</option>`).join("")}</select>`;
}
const lembrarEscola = id => { try { localStorage.setItem("smpe.escola", id); } catch {} };
const ultimaEscola = () => {
  if (SESSAO && !ehAdmin()) return String(SESSAO.escola_id);
  try { return localStorage.getItem("smpe.escola") || ""; } catch { return ""; }
};

// ------------------------------------------------------------------ roteador
const ROUTES = {painel, migracao, escolas, remessas, critica, relatorios, orcamento, bases, busca, config, usuarios,
  servidores, frequencia, aniversariantes, feriados};
const SO_ADMIN = new Set(["escolas", "orcamento", "bases", "config", "usuarios"]);
const DO_RH = new Set(["servidores", "frequencia", "aniversariantes", "feriados"]);  // perfil RH (e o administrador)
const SO_RH = new Set(["feriados"]);  // a instituicao usa o resto do modulo, so com os servidores dela
const TITLES = {painel: "Painel", migracao: "Matriculado", escolas: "Cadastro de instituições", remessas: "Remessas SMTT", critica: "Criticar remessa",
  relatorios: "Relatórios", orcamento: "Orçamento", bases: "Bases e importação", busca: "Localizar estudante", config: "Configurações",
  usuarios: "Usuários", servidores: "Servidores", frequencia: "Folha de frequência", aniversariantes: "Aniversariantes do mês",
  feriados: "Feriados e pontos facultativos"};
const CRUMBS = {painel: "Visão geral da migração nas instituições", migracao: "Alunos matriculados · cruzamento de CPF GEDUC × Censo × SMTT × Status",
  escolas: "Instituições de ensino, acesso e vínculo com o GEDUC", remessas: "Arquivos enviados ao banco de dados da SMTT", critica: "Mesmas regras do validador oficial SMPE (AlunoCritica)",
  relatorios: "Listas para conferência e preenchimento pela instituição", orcamento: "Valores por instituição (somente alunos com CPF)",
  bases: "Planilha SIS SMPE e bases de origem", busca: "Toda a rede municipal", config: "Identidade visual, suporte e orçamento",
  usuarios: "Logins, perfis e instituições vinculadas", servidores: "Cadastro dos servidores da SEMED (base GEDUC + RH)",
  frequencia: "Registro individual de frequência por mês", aniversariantes: "Lista e etiquetas dos aniversariantes",
  feriados: "Datas marcadas em vermelho na folha de frequência"};
async function router() {
  if (!SESSAO) return;
  const [path, qs = ""] = location.hash.replace(/^#\/?/, "").split("?");
  let [nome = "painel", arg] = path.split("/");
  if (SO_ADMIN.has(nome) && !ehAdmin()) nome = "painel";
  if (ehRH() && !DO_RH.has(nome)) nome = "servidores";
  if (SO_RH.has(nome) && !ehAdmin() && !ehRH()) nome = "servidores";
  const fn = ROUTES[nome] || painel;
  $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.r === nome));
  $("#title").textContent = TITLES[nome] || "Painel";
  $("#crumb").textContent = (nome === "busca" || DO_RH.has(nome)) && SESSAO.perfil === "instituicao" ? SESSAO.escola_nome : CRUMBS[nome] || "SIS SMPE";
  $(".side").classList.remove("open");
  closeDrawer();
  $("#view").innerHTML = `<div class="empty">Carregando…</div>`;
  if (!ESCOLAS.length && !ehRH()) await loadEscolas();
  try { await fn(arg, new URLSearchParams(qs)); }
  catch (e) { $("#view").innerHTML = `<div class="empty">Não foi possível carregar: ${esc(e.message)}</div>`; }
}
addEventListener("hashchange", router);
$("#buscaForm").onsubmit = e => { e.preventDefault(); const q = $("#buscaInput").value.trim(); if (q) location.hash = "#/busca?q=" + encodeURIComponent(q); };

// ------------------------------------------------------------------ painel
async function painel() {
  const d = await api("/api/painel");
  const t = d.totais;
  const semBase = !d.bases.geduc;
  $("#view").innerHTML = `
    ${semBase ? `<div class="alert warn">Nenhuma base importada ainda. Vá em <a href="#/bases">Bases e importação</a> e envie a planilha SIS SMPE.</div>` : ""}
    ${t.sem_vinculo ? `<div class="alert warn">${t.sem_vinculo} instituição(ões) sem alunos encontrados no GEDUC${ehAdmin() ? ` — confira o vínculo em <a href="#/escolas">Instituições</a>` : ""}.</div>` : ""}
    <div class="grid kpis k4">
      ${ehAdmin() ? `<div class="kpi"><div class="l">Instituições</div><div class="v">${fmtN(t.escolas)}</div></div>`
        : `<div class="kpi ok"><div class="l">Aptos para a remessa</div><div class="v">${fmtN(t.aptos)}</div></div>`}
      <div class="kpi hero"><div class="l">Matriculados (GEDUC)</div><div class="v">${fmtN(t.matriculados)}</div></div>
      <div class="kpi ok"><div class="l">Com CPF consolidado</div><div class="v">${fmtN(t.com_cpf)}</div><div class="s">${fmtPct(t.indice_cpf)}</div></div>
      <div class="kpi warn"><div class="l">Sem CPF</div><div class="v">${fmtN(t.sem_cpf)}</div></div>
      <div class="kpi err"><div class="l">CPF divergente</div><div class="v">${fmtN(t.divergentes)}</div></div>
      <div class="kpi err"><div class="l">CPF inválido</div><div class="v">${fmtN(t.cpf_invalido)}</div></div>
      <div class="kpi"><div class="l">Sem mãe / sem sobrenome</div><div class="v">${fmtN(t.sem_mae + t.mae_incompleta)}</div></div>
      <div class="kpi ok"><div class="l">Migrados p/ SMTT</div><div class="v">${fmtN(t.migrados)}</div><div class="s">${fmtN(d.lotes.n)} remessa(s)</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Situação por instituição</h2><span class="spacer"></span>
        <input id="fEsc" placeholder="Filtrar instituição…" style="width:240px">${btnXls("painel")}</div>
      <div class="table-wrap" style="max-height:none"><table id="tbEsc"><thead><tr>
        <th>ID</th><th>Instituição</th><th>Cód. SMTT</th><th class="num">Matric.</th><th class="num">Com CPF</th><th>Índice CPF</th>
        <th class="num">Sem CPF</th><th class="num">Diverg.</th><th class="num">Sem mãe</th><th class="num">Aptos</th><th class="num">Migrados</th>
      </tr></thead><tbody id="tbEscBody"></tbody></table></div><div id="pgEsc"></div>
    </div>
    <p class="muted" style="margin-top:12px">Bases: GEDUC ${fmtN(d.bases.geduc)} · Censo ${fmtN(d.bases.censo)} · SMTT ${fmtN(d.bases.smtt)} · Alunos por status ${fmtN(d.bases.status_alunos)}</p>`;
  $("#tbEsc").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#/migracao/" + tr.dataset.id; };
  const rowEsc = e => `<tr class="click" data-id="${e.id}" data-n="${esc(e.nome.toLowerCase())}">
        <td>${e.id}</td><td>${esc(e.nome)} ${e.matriculados ? "" : `<span class="badge b-warn">sem vínculo GEDUC</span>`}${e.bloqueado ? `<span class="badge b-err">bloqueada</span>` : ""}</td>
        <td class="mono">${esc(e.cod_smtt) || `<span class="badge b-err">sem código</span>`}</td>
        <td class="num">${fmtN(e.matriculados)}</td><td class="num">${fmtN(e.com_cpf)}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap"><div class="bar"><span style="width:${e.indice_cpf * 100}%"></span></div><span class="muted">${fmtPct(e.indice_cpf)}</span></div></td>
        <td class="num">${e.sem_cpf || ""}</td><td class="num">${e.divergentes ? `<b style="color:var(--err)">${e.divergentes}</b>` : ""}</td>
        <td class="num">${(e.sem_mae + e.mae_incompleta) || ""}</td><td class="num">${fmtN(e.aptos)}</td><td class="num">${e.migrados ? fmtN(e.migrados) : ""}</td>
      </tr>`;
  const filtradas = () => { const q = $("#fEsc").value.toLowerCase(); return d.escolas.filter(e => e.nome.toLowerCase().includes(q)); };
  XLS.painel = () => ({titulo: "Situação por instituição", subtitulo: $("#fEsc").value && `Filtro: ${$("#fEsc").value}`,
    colunas: [["ID", "numero"], ["Instituição"], ["Cód. SMTT"], ["Matriculados", "numero"], ["Com CPF", "numero"], ["Índice CPF", "pct"],
      ["Sem CPF", "numero"], ["CPF divergente", "numero"], ["Sem mãe / sem sobrenome", "numero"], ["Aptos", "numero"], ["Migrados", "numero"], ["Situação"]],
    linhas: filtradas().map(e => [e.id, e.nome, e.cod_smtt, e.matriculados, e.com_cpf, e.indice_cpf, e.sem_cpf, e.divergentes,
      e.sem_mae + e.mae_incompleta, e.aptos, e.migrados, e.bloqueado ? "Bloqueada" : "Ativa"])});
  const renderEsc = () => {
    const pg = paginar("painel", filtradas(), renderEsc);
    $("#tbEscBody").innerHTML = pg.itens.map(rowEsc).join("") || `<tr><td colspan="11" class="empty">Nenhuma instituição encontrada.</td></tr>`;
    $("#pgEsc").innerHTML = pg.html;
  };
  $("#fEsc").oninput = () => { resetPag("painel"); renderEsc(); };
  renderEsc();
}

// ------------------------------------------------------------------ migracao
const FILTROS = [
  ["todos", "Todos", () => true], ["aptos", "Aptos", a => a.apto], ["nao_migrados", "Aptos não migrados", a => a.apto && !a.migrado],
  ["migrados", "Migrados", a => a.migrado], ["sem_cpf", "Sem CPF", a => a.pendencias.includes("sem_cpf")],
  ["divergente", "CPF divergente", a => a.pendencias.includes("divergente")], ["cpf_invalido", "CPF inválido", a => a.pendencias.includes("cpf_invalido")],
  ["cpf_duplicado", "CPF duplicado", a => a.pendencias.includes("cpf_duplicado")], ["nome_duplicado", "Nome duplicado", a => a.pendencias.includes("nome_duplicado")],
  ["sem_mae", "Sem mãe", a => a.pendencias.includes("sem_mae")],
  ["mae_incompleta", "Mãe sem sobrenome", a => a.pendencias.includes("mae_incompleta")],
  ["critica_smtt", "Crítica SMTT", a => a.pendencias.includes("critica_smtt")],
  ["nao_cursando", "Não cursando", a => a.pendencias.includes("nao_cursando")],
  ["manuais", "Cadastro individual", a => a.manual],
];
let MIG = null;
async function migracao(eid) {
  eid = eid || ultimaEscola();
  if (!eid) {
    $("#view").innerHTML = `<div class="card card-b"><label>Instituição</label>${escolaSelect("selEsc")}</div>`;
    $("#selEsc").onchange = e => location.hash = "#/migracao/" + e.target.value;
    return;
  }
  lembrarEscola(eid);
  const d = await api(`/api/escolas/${eid}/alunos`);
  if (MIG?.eid !== eid) resetPag("mig");
  MIG = {d, filtro: MIG?.eid === eid ? MIG.filtro : "todos", q: "", turma: "", sel: new Set(), eid};
  const r = d.resumo, e = d.escola;
  $("#view").innerHTML = `
    <div class="row" style="margin-bottom:14px"><div style="min-width:320px;flex:1;max-width:560px">${escolaSelect("selEsc", eid)}</div>
      <span class="muted">Cód. SMTT <b class="mono">${esc(e.cod_smtt) || "—"}</b> · INEP <b class="mono">${esc(e.inep) || "—"}</b></span>
      <span class="spacer"></span>
      <button id="btnNovoAluno">Cadastrar aluno</button>
      <button id="btnStatus" data-admin title="Zera os matriculados e atualiza com o arquivo Alunos por status da instituição">Atualizar pelo Alunos por status</button>
      <a class="btn" href="#/relatorios/${eid}">Relatórios</a><a class="btn" href="#/orcamento/${eid}" data-admin>Orçamento</a></div>
    ${!r.matriculados ? `<div class="alert warn">Nenhum aluno do GEDUC encontrado para esta instituição.${ehAdmin() ? ` Ajuste o <b>vínculo GEDUC</b> em <a href="#/escolas">Instituições</a>.` : ""}</div>` : ""}
    ${!e.cod_smtt ? `<div class="alert warn">Instituição sem código SMTT: a remessa exige o código da instituição (4 dígitos).</div>` : ""}
    <div id="confStatus"></div>
    <div class="grid kpis">
      <div class="kpi hero"><div class="l">Matriculados</div><div class="v">${fmtN(r.matriculados)}</div></div>
      <div class="kpi ok"><div class="l">Com CPF</div><div class="v">${fmtN(r.com_cpf)}</div><div class="s">índice ${fmtPct(r.indice_cpf)}</div></div>
      <div class="kpi warn"><div class="l">Sem CPF</div><div class="v">${fmtN(r.sem_cpf)}</div></div>
      <div class="kpi err"><div class="l">CPF divergente</div><div class="v">${fmtN(r.divergentes)}</div><div class="s">${fmtPct(r.indice_divergencia)}</div></div>
      <div class="kpi"><div class="l">Sem mãe / sem sobrenome</div><div class="v">${fmtN(r.sem_mae + r.mae_incompleta)}</div></div>
      <div class="kpi ok"><div class="l">Aptos / migrados</div><div class="v">${fmtN(r.aptos)}</div><div class="s">${fmtN(r.migrados)} já migrados</div></div>
    </div>
    <div class="card">
      <div class="card-h"><div class="tabs" id="tabs" style="flex:1"></div>${btnXls("alunos")}</div>
      <div class="card-h">
        <input id="qAluno" placeholder="Buscar aluno, mãe ou CPF…" style="max-width:300px">
        <select id="fTurma" style="max-width:220px"><option value="">Todas as turmas</option>${[...new Set(d.alunos.map(a => a.turma))].sort().map(t => `<option>${esc(t)}</option>`).join("")}</select>
        <span class="spacer"></span><span class="muted" id="selInfo"></span>
        <button id="btnSelAptos">Selecionar aptos não migrados</button>
        <button class="primary" id="btnRemessa" disabled>Gerar remessa SMTT</button>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th><input type="checkbox" id="chkAll" style="width:auto" title="Marcar/desmarcar todos os alunos do filtro atual (todas as páginas)"></th><th>Aluno</th><th>Nasc.</th><th>Turma / turno</th><th>Mãe</th>
        <th>CPF consolidado</th><th>Pendências</th><th>CPF GEDUC</th><th>CPF Censo</th><th>CPF SMTT</th><th>CPF Status</th><th>SMTT</th>
      </tr></thead><tbody id="tbAlunos"></tbody></table></div><div id="pgAlunos"></div>
    </div>`;
  $("#selEsc").onchange = ev => location.hash = "#/migracao/" + ev.target.value;
  $("#qAluno").oninput = ev => { MIG.q = ev.target.value.trim().toUpperCase(); resetPag("mig"); renderAlunos(); };
  $("#fTurma").onchange = ev => { MIG.turma = ev.target.value; resetPag("mig"); renderAlunos(); };
  $("#btnSelAptos").onclick = () => { d.alunos.filter(a => a.apto && !a.migrado).forEach(a => MIG.sel.add(a.id_aluno)); renderAlunos(); };
  $("#chkAll").onchange = ev => { visiveis().forEach(a => ev.target.checked ? MIG.sel.add(a.id_aluno) : MIG.sel.delete(a.id_aluno)); renderAlunos(); };
  $("#btnRemessa").onclick = () => previaRemessa(eid, [...MIG.sel]);
  $("#btnNovoAluno").onclick = () => novoAluno(eid);
  $("#btnStatus").onclick = () => modalAtualizarStatus(eid, e);
  XLS.alunos = () => ({titulo: `Matriculados - ${e.nome}`,
    subtitulo: [FILTROS.find(x => x[0] === MIG.filtro)[1], MIG.turma && `Turma ${MIG.turma}`, MIG.q && `Busca: ${MIG.q}`].filter(Boolean).join(" · "),
    colunas: [["ID aluno"], ["Aluno"], ["Nascimento", "data"], ["Turma"], ["Turno"], ["Mãe"], ["CPF consolidado", "cpf"], ["Pendências"], ["Apto"],
      ["Migrado"], ["CPF GEDUC", "cpf"], ["CPF Censo", "cpf"], ["CPF SMTT", "cpf"], ["CPF Status", "cpf"], ["Situação"], ["Telefone"]],
    linhas: visiveis().map(a => [a.id_aluno, a.aluno, a.dt_nasc, a.turma, a.turno, a.mae, a.cpf, pendTxt(a), a.apto ? "Sim" : "Não",
      a.migrado ? "Sim" : "Não", a.cpf_geduc, a.cpf_censo, a.cpf_smtt, a.cpf_status, a.situacao, a.telefone])});
  $("#tbAlunos").onclick = ev => {
    if (ev.target.type === "checkbox") { ev.target.checked ? MIG.sel.add(ev.target.value) : MIG.sel.delete(ev.target.value); updSel(); return; }
    const tr = ev.target.closest("tr[data-id]"); if (tr) abrirAluno(tr.dataset.id);
  };
  renderAlunos();
  conferenciaStatus(eid);
}
// matriculados do sistema (GEDUC + cadastro individual) x base "Alunos por status" da instituicao
async function conferenciaStatus(eid) {
  let c;
  try { c = await api(`/api/escolas/${eid}/conferencia`, {semLogin: true}); } catch { return; }
  const box = $("#confStatus");
  if (!box || !c.total_status || MIG?.eid !== eid) return;
  const semGeduc = c.so_status.filter(x => !x.outra_escola).length, outra = c.so_status.length - semGeduc;
  const nd = c.nome_diferente || [];
  const fora = c.fora || [];
  const pelo = c.pelo_status ? `Matriculados conforme o <b>Alunos por status</b> atualizado em ${fmtDH(c.pelo_status)}.
    ${fora.length ? `${fmtN(fora.length)} aluno(s) do GEDUC ou do cadastro individual não estão no arquivo e ficaram fora da contagem.` : ""}` : "";
  if (!c.so_status.length && !c.so_sistema.length && !nd.length) {
    box.innerHTML = `<div class="alert info conf"><div>${pelo || `Confere com o <b>Alunos por status</b>: ${fmtN(c.total_status)} aluno(s) nas duas bases.`}</div>
      ${fora.length ? `<button class="btn-sm" id="verConf">Ver fora da contagem</button>` : ""}</div>`;
    if (fora.length) $("#verConf").onclick = () => modalConferencia(eid, c);
    return;
  }
  box.innerHTML = `<div class="alert warn conf"><div><b>Matriculados diferentes do Alunos por status.</b>
      O sistema tem <b>${fmtN(c.total_sistema)}</b> matriculado(s) (GEDUC + cadastro individual) e o Alunos por status da instituição tem <b>${fmtN(c.total_status)}</b>.
      ${fmtN(c.em_ambos)} estão nas duas bases.${pelo ? `<br>${pelo}` : ""}<br>
      Só no Alunos por status: <b>${fmtN(c.so_status.length)}</b>${c.so_status.length ? ` (${fmtN(semGeduc)} fora do GEDUC, ${fmtN(outra)} no GEDUC de outra instituição)` : ""} ·
      Só no sistema: <b>${fmtN(c.so_sistema.length)}</b>${nd.length ? ` · Mesmo aluno com o nome escrito diferente: <b>${fmtN(nd.length)}</b>` : ""}</div>
      <button class="btn-sm" id="verConf">Ver diferenças</button></div>`;
  $("#verConf").onclick = () => modalConferencia(eid, c);
}
function modalConferencia(eid, c) {
  const cadastrados = new Set();
  XLS.conf_status = () => ({titulo: "Só no Alunos por status", subtitulo: MIG?.d.escola.nome,
    colunas: [["Aluno"], ["Nascimento", "data"], ["Turma"], ["Turno"], ["Mãe"], ["CPF", "cpf"], ["Situação"], ["No GEDUC em"]],
    linhas: c.so_status.map(s => [s.aluno, s.nascimento, s.turma, s.turno, s.mae, s.cpf, s.situacao, s.outra_escola || "não está no GEDUC"])});
  XLS.conf_sistema = () => ({titulo: "Só no sistema", subtitulo: MIG?.d.escola.nome,
    colunas: [["ID aluno"], ["Aluno"], ["Nascimento", "data"], ["Turma"], ["Turno"], ["Origem"]],
    linhas: c.so_sistema.map(a => [a.id_aluno, a.aluno, a.dt_nasc, a.turma, a.turno, a.manual ? "Cadastro individual" : "GEDUC"])});
  const linhaS = (s, i) => `<tr><td><b>${esc(s.aluno)}</b><div class="muted">${esc(s.mae) || "—"}</div></td><td>${fmtData(s.nascimento)}</td>
      <td>${esc(s.turma)}<div class="muted">${esc(s.turno)}</div></td><td class="mono">${fmtCPF(s.cpf) || "—"}</td>
      <td>${s.outra_escola ? `<span class="badge b-warn quebra" title="Pode ser transferência">GEDUC: ${esc(s.outra_escola)}</span>` : `<span class="badge b-mute">não está no GEDUC</span>`}</td>
      <td class="acoes">${cadastrados.has(i) ? `<span class="badge b-ok">cadastrado</span>` : `<button class="btn-sm" data-cad="${i}" title="Cria o aluno no cadastro individual com os dados do Alunos por status">Cadastrar</button>`}</td></tr>`;
  const nd = c.nome_diferente || [], corrigidos = new Set();
  XLS.conf_nome = () => ({titulo: "Mesmo aluno com nome diferente", subtitulo: MIG?.d.escola.nome,
    colunas: [["Nascimento", "data"], ["Nome no Alunos por status"], ["Nome no sistema"], ["ID aluno"], ["Semelhança", "pct"]],
    linhas: nd.map(x => [x.status.nascimento, x.status.aluno, x.sistema.aluno, x.sistema.id_aluno, x.similaridade])});
  const render = () => modal(`<div class="mh"><h2>Conferência com o Alunos por status</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <div class="mb">
      <p class="muted" style="margin-top:0">O cruzamento é pelo nome e pela data de nascimento (o ID_ALUNO do Alunos por status é de outra numeração). Diferenças comuns: aluno matriculado depois da extração do GEDUC, transferência ou nome escrito de outro jeito.</p>
      ${nd.length ? `<div class="row" style="margin-bottom:8px"><h3 style="margin:0">Mesmo aluno com o nome escrito diferente (${fmtN(nd.length)})</h3><span class="spacer"></span>${btnXls("conf_nome")}</div>
        <table><thead><tr><th>Nascimento</th><th>No Alunos por status</th><th>No sistema</th><th></th></tr></thead><tbody>
        ${nd.map((x, i) => `<tr><td>${fmtData(x.status.nascimento)}</td><td><b>${esc(x.status.aluno)}</b></td><td>${esc(x.sistema.aluno)}</td>
          <td class="acoes"><div class="row">${x.sistema.manual ? "" : corrigidos.has(i) ? `<span class="badge b-ok">nome corrigido</span>` : `<button class="btn-sm" data-nome="${i}" title="Grava como correção do aluno o nome como está no Alunos por status">Usar este nome</button>`}<button class="btn-sm" data-al="${esc(x.sistema.id_aluno)}">Abrir</button></div></td></tr>`).join("")}</tbody></table>
        <p class="muted">Não cadastre esses alunos de novo: já estão no sistema. Confira qual grafia está certa e, se for a do Alunos por status, clique em “Usar este nome”.</p>` : ""}
      <div class="row" style="margin-bottom:8px"><h3 style="margin:0">Só no Alunos por status (${fmtN(c.so_status.length)})</h3><span class="spacer"></span>${c.so_status.length ? btnXls("conf_status") : ""}</div>
      ${c.so_status.length ? `<table class="tb-conf"><thead><tr><th>Aluno / mãe</th><th>Nasc.</th><th>Turma</th><th>CPF</th><th>GEDUC</th><th></th></tr></thead><tbody>${c.so_status.map(linhaS).join("")}</tbody></table>
        <p class="muted">“Cadastrar” cria o aluno no <b>cadastro individual</b> desta instituição com os dados do Alunos por status. Confira antes os que aparecem no GEDUC de outra instituição (podem ser transferências).</p>` : `<p class="muted">Nenhum.</p>`}
      ${(c.fora || []).length ? `<div class="row" style="margin:18px 0 8px"><h3 style="margin:0">Fora da contagem (${fmtN(c.fora.length)})</h3></div>
        <table><thead><tr><th>Aluno</th><th>Nasc.</th><th>Turma</th><th>Origem</th></tr></thead><tbody>${c.fora.map(a => `<tr class="click" data-al="${esc(a.id_aluno)}"><td><b>${esc(a.aluno)}</b></td><td>${fmtData(a.dt_nasc)}</td><td>${esc(a.turma)}<div class="muted">${esc(a.turno)}</div></td><td>${a.manual ? "Cadastro individual" : "GEDUC"}</td></tr>`).join("")}</tbody></table>
        <p class="muted">Não estão no Alunos por status atualizado em ${fmtDH(c.pelo_status)} (ou estão repetidos) e não contam como matriculados.</p>` : ""}
      <div class="row" style="margin:18px 0 8px"><h3 style="margin:0">Só no sistema (${fmtN(c.so_sistema.length)})</h3><span class="spacer"></span>${c.so_sistema.length ? btnXls("conf_sistema") : ""}</div>
      ${c.so_sistema.length ? `<table><thead><tr><th>Aluno</th><th>Nasc.</th><th>Turma</th><th>Origem</th></tr></thead><tbody>${c.so_sistema.map(a => `<tr class="click" data-al="${esc(a.id_aluno)}"><td><b>${esc(a.aluno)}</b></td><td>${fmtData(a.dt_nasc)}</td><td>${esc(a.turma)}<div class="muted">${esc(a.turno)}</div></td><td>${a.manual ? "Cadastro individual" : "GEDUC"}</td></tr>`).join("")}</tbody></table>
        <p class="muted">Podem ter saído da instituição ou estar com o nome ou a data de nascimento diferente no Alunos por status. Clique para abrir o aluno.</p>` : `<p class="muted">Nenhum.</p>`}
    </div>
    <div class="mf"><button onclick="closeModal()">Fechar</button></div>`);
  render();
  $("#modalBody").onclick = async ev => {
    const al = ev.target.closest("[data-al]");
    if (al) { closeModal(); return abrirAluno(al.dataset.al); }
    const bn = ev.target.closest("[data-nome]");
    if (bn) {
      const x = nd[+bn.dataset.nome], d = await api(`/api/alunos/${encodeURIComponent(x.sistema.id_aluno)}`);
      const atual = Object.fromEntries(Object.entries(d.ajuste || {}).map(([k, v]) => [k, v ?? ""]));
      bn.disabled = true;
      try {
        await api(`/api/alunos/${encodeURIComponent(x.sistema.id_aluno)}/ajuste`, {method: "PUT", body: {...atual, aluno: x.status.aluno}});
        corrigidos.add(+bn.dataset.nome); cadastrados.add(-1); toast("Nome corrigido"); render();
      } catch { bn.disabled = false; }
      return;
    }
    const b = ev.target.closest("[data-cad]");
    if (!b) return;
    const s = c.so_status[+b.dataset.cad], cpf = (s.cpf || "").replace(/\D/g, "");
    b.disabled = true;
    try {
      await api(`/api/escolas/${eid}/alunos`, {method: "POST", body: {aluno: s.aluno, mae: s.mae, pai: s.pai, genero: (s.sexo || "").slice(0, 1),
        dt_nasc: s.nascimento, turma: s.turma, turno: s.turno, matricula: s.matricula, rua: s.endereco, numero: s.numero, bairro: s.bairro,
        cidade: "SAO LUIS", cpf: cpf.length === 11 ? cpf : "", telefone: s.telefone}});
      cadastrados.add(+b.dataset.cad); toast(`${s.aluno} cadastrado`); render();
    } catch { b.disabled = false; }
  };
  $("#modal").addEventListener("close", () => { if (cadastrados.size && MIG?.eid === eid) migracao(eid); }, {once: true});
}
// botao da tela Matriculado: troca o Alunos por status so desta instituicao e os matriculados passam a ser os do arquivo
function modalAtualizarStatus(eid, e) {
  modal(`<div class="mh"><h2>Atualizar pelo Alunos por status</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <div class="mb"><p style="margin-top:0">${esc(e.nome)}</p>
      <p class="muted">Zera o Alunos por status <b>desta instituição</b> e grava o do arquivo. Os matriculados passam a ser só os alunos do arquivo:</p>
      <ul class="muted"><li>quem está no GEDUC ou no cadastro individual e não está no arquivo sai da contagem (não é apagado);</li>
        <li>quem está no arquivo e falta no sistema é incluído no cadastro individual;</li>
        <li>as outras instituições não mudam. Continua valendo quando o GEDUC for importado de novo.</li></ul>
      ${e.status_atualizado_em ? `<div class="alert info">Atualizado pela última vez em ${fmtDH(e.status_atualizado_em)}.
        <button class="btn-sm" id="btnDesfazerSt">Voltar a contar pelo GEDUC</button></div>` : ""}
      <form id="fStatus" class="row" style="align-items:flex-end"><div style="flex:1"><label>Arquivo Alunos por status (.xlsx, .xls ou .csv)</label>
        <input type="file" name="arquivo" accept=".xlsx,.xlsm,.xls,.csv" required></div>
        <button class="primary">Zerar e atualizar</button></form><div id="stMsg"></div></div>`);
  $("#fStatus").onsubmit = async ev => {
    ev.preventDefault();
    if (!confirm(`Zerar os matriculados de ${e.nome} e atualizar com este arquivo?`)) return;
    const b = ev.target.querySelector("button"); b.disabled = true;
    $("#stMsg").innerHTML = `<div class="alert info">Processando…</div>`;
    try {
      const r = await api(`/api/escolas/${eid}/status`, {method: "POST", body: new FormData(ev.target)});
      closeModal();
      toast(`${fmtN(r.matriculados)} matriculado(s): ${fmtN(r.linhas)} no arquivo, ${fmtN(r.cadastrados)} incluído(s), ${fmtN(r.fora)} fora da contagem`
        + (r.ignoradas ? ` · ${fmtN(r.ignoradas)} linha(s) de outras instituições ignoradas` : ""));
      migracao(eid);
    } catch (ex) { $("#stMsg").innerHTML = `<div class="alert warn">${esc(ex.message)}</div>`; b.disabled = false; }
  };
  if ($("#btnDesfazerSt")) $("#btnDesfazerSt").onclick = async () => {
    if (!confirm("Voltar a contar os matriculados pelo GEDUC + cadastro individual?")) return;
    await api(`/api/escolas/${eid}/status`, {method: "DELETE"}); closeModal(); toast("Matriculados voltaram a seguir o GEDUC"); migracao(eid);
  };
}
function visiveis() {
  const f = FILTROS.find(x => x[0] === MIG.filtro)[2];
  const q = MIG.q, qd = q.replace(/\D/g, "");
  return MIG.d.alunos.filter(a => f(a) && (!MIG.turma || a.turma === MIG.turma) &&
    (!q || a.aluno.toUpperCase().includes(q) || (a.mae || "").toUpperCase().includes(q) || (qd.length >= 3 && a.cpf.includes(qd))));
}
function updSel() {
  $("#selInfo").textContent = MIG.sel.size ? `${fmtN(MIG.sel.size)} selecionado(s)` : "";
  $("#btnRemessa").disabled = !MIG.sel.size;
}
function renderAlunos() {
  $("#tabs").innerHTML = FILTROS.map(([k, l, f]) => `<button class="tab ${MIG.filtro === k ? "active" : ""}" data-f="${k}">${l} <span class="n">${fmtN(MIG.d.alunos.filter(f).length)}</span></button>`).join("");
  $$("#tabs .tab").forEach(b => b.onclick = () => { MIG.filtro = b.dataset.f; resetPag("mig"); renderAlunos(); });
  const lista = visiveis(), pg = paginar("mig", lista, renderAlunos, 50);
  const cpfCell = (c, ref) => c ? `<span class="mono ${ref && c !== ref ? "cpf-div" : ""}">${fmtCPF(c)}</span>` : `<span class="muted">—</span>`;
  $("#tbAlunos").innerHTML = lista.length ? pg.itens.map(a => `<tr class="click" data-id="${esc(a.id_aluno)}">
    <td><input type="checkbox" value="${esc(a.id_aluno)}" ${MIG.sel.has(a.id_aluno) ? "checked" : ""} style="width:auto"></td>
    <td><b>${esc(a.aluno)}</b>${a.manual ? ` <span class="badge b-info" title="Cadastrado individualmente pela instituição">individual</span>` : ""}${a.situacao ? `<div class="muted">${esc(a.situacao)}</div>` : ""}</td>
    <td>${fmtData(a.dt_nasc)}</td><td>${esc(a.turma)}<div class="muted">${esc(a.turno)}</div></td>
    <td>${esc(a.mae) || `<span class="muted">—</span>`}</td>
    <td>${a.cpf === "DIVERGENTE" ? `<span class="badge b-err">DIVERGENTE</span>` : a.cpf ? `<b class="mono">${fmtCPF(a.cpf)}</b>${a.cpf_manual ? ` <span class="badge b-info" title="Informado manualmente">manual</span>` : ""}` : `<span class="muted">—</span>`}</td>
    <td><div class="pend-cell">${pendBadges(a.pendencias, a.criticas)}${a.pendencias.length ? `<button class="btn-sm" title="Editar a informação incorreta e reprocessar">Corrigir</button>` : ""}</div></td>
    <td>${cpfCell(a.cpf_geduc, a.cpf)}</td><td>${cpfCell(a.cpf_censo, a.cpf)}</td><td>${cpfCell(a.cpf_smtt, a.cpf)}</td><td>${cpfCell(a.cpf_status, a.cpf)}</td>
    <td>${a.migrado ? `<span class="badge b-ok">migrado</span>` : a.no_smtt ? `<span class="badge b-mute">já na base SMTT</span>` : ""}</td>
  </tr>`).join("") : `<tr><td colspan="12" class="empty">Nenhum aluno neste filtro.</td></tr>`;
  $("#pgAlunos").innerHTML = pg.html;
  updSel();
}

// campos do aluno (correcao da instituicao ou cadastro individual): [nome, rotulo, tipo, classe]
const CAMPOS_ALUNO = [
  ["Identificação"], ["aluno", "Nome do aluno", "text", "full"], ["cpf", "CPF", "cpf"], ["dt_nasc", "Data de nascimento", "date"],
  ["genero", "Sexo", "sexo"], ["telefone", "Telefone", "text"],
  ["Filiação"], ["mae", "Nome da mãe (nome e sobrenome)", "text", "full"], ["pai", "Nome do pai", "text", "full"],
  ["Dados escolares"], ["curso", "Tipo de ensino", "curso"], ["grau", "Grau", "grau"], ["ano_serie", "Série / ano", "text"], ["turno", "Turno", "turno"], ["turma", "Turma", "text"], ["matricula", "Matrícula", "text"],
  ["Endereço"], ["rua", "Endereço (rua)", "text", "full"], ["numero", "Número", "text"], ["bairro", "Bairro", "text"],
  ["cidade", "Cidade", "text"], ["cep", "CEP", "text"],
  ["Documentos"], ["rg", "RG", "text"], ["org_exp", "Órgão expedidor", "text"], ["data_exp", "Data de expedição", "date"],
];
// campo com problema, a partir das pendencias e dos codigos de critica
const CRIT_CAMPO = {1: "aluno", 3: "genero", 4: "curso", 5: "grau", 6: "ano_serie", 7: "turno", 8: "matricula", 9: "dt_nasc", 10: "rua", 11: "bairro", 12: "cidade", 13: "pai"};
function camposComErro(a) {
  if (!a) return new Set();
  const s = new Set((a.criticas || []).map(c => CRIT_CAMPO[c]).filter(Boolean));
  if (a.pendencias.some(p => ["sem_cpf", "divergente", "cpf_invalido", "cpf_duplicado"].includes(p))) s.add("cpf");
  if (a.pendencias.some(p => ["sem_mae", "mae_incompleta"].includes(p))) s.add("mae");
  return s;
}
const TIPOS_ENSINO = ["ENSINO FUNDAMENTAL", "ENSINO MEDIO", "EDUCACAO INFANTIL", "EJA"];
// cursos da instituicao (aba Cursos) ou, sem cadastro, os tipos de ensino padrao
const cursosDa = eid => { const cs = ESCOLAS.find(e => e.id === +eid)?.cursos || []; return cs.length ? cs : TIPOS_ENSINO.map(c => ({curso: c, grau: ""})); };
// tamanho maximo de cada campo no layout da remessa (375 colunas); endereco = rua + ", " + numero
const LIMITES = {aluno: 50, mae: 50, pai: 50, bairro: 30, cidade: 20, matricula: 12, rg: 20, org_exp: 10};
function contadores(f) {
  const lim = k => k === "rua" ? 50 - (f.numero?.value.trim() ? f.numero.value.trim().length + 2 : 0) : LIMITES[k];
  const campos = [...Object.keys(LIMITES), "rua"].map(k => f[k]).filter(Boolean);
  const upd = () => campos.forEach(i => {
    const box = i.closest("div"), max = lim(i.name), n = i.value.trim().length;
    let c = box.querySelector(".cnt");
    if (!c) { c = document.createElement("small"); c.className = "cnt"; box.querySelector("label").append(c); }
    c.textContent = `${n}/${max}`; c.classList.toggle("over", n > max);
    box.classList.toggle("campo-longo", n > max);
    c.title = n > max ? `Excede ${n - max} caractere(s): o excesso é cortado na remessa. Apague o que sobrar.` : "Caracteres usados / máximo do layout";
  });
  f.addEventListener("input", upd); upd();
}
function formAluno(vals, base, erros, extra = "", cursos = cursosDa()) {
  const ph = k => base[k] ? `base: ${k === "cpf" ? fmtCPF(base[k]) : k.includes("dt") ? fmtData(base[k]) : base[k]}` : "";
  const sel = (k, ops) => `<select name="${k}"><option value="">${esc(ph(k) || "—")}</option>${ops.map(([v, l]) => `<option value="${v}" ${(vals[k] || "").toUpperCase().startsWith(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  return CAMPOS_ALUNO.map(([k, l, t, cls]) => !l ? `<h3 class="full" style="margin:8px 0 0">${k}</h3>` :
    `<div class="${cls || ""} ${erros.has(k) ? "campo-err" : ""}"><label>${l}</label>${
      t === "sexo" ? sel(k, [["M", "Masculino"], ["F", "Feminino"]]) :
      t === "turno" ? sel(k, [["M", "Matutino"], ["V", "Vespertino"], ["N", "Noturno"], ["I", "Integral"]]) :
      t === "grau" ? sel(k, [["1", "1"], ["2", "2"], ["3", "3"]]) :
      t === "curso" ? sel(k, [...new Set([...cursos.map(c => c.curso), vals[k]].filter(Boolean))].map(v => [v, v])) :
      `<input name="${k}" type="${t === "date" ? "date" : "text"}" value="${esc(t === "cpf" ? fmtCPF(vals[k] || "") : vals[k] || "")}" placeholder="${esc(ph(k))}">`}</div>`).join("") + extra;
}
// depois de salvar: recarrega a lista (reprocessa pendencias e criticas) e reabre o aluno
async function reprocessar(id) {
  if (!MIG) { toast("Salvo"); closeDrawer(); return; }
  await migracao(MIG.eid);
  const a = MIG.d.alunos.find(x => x.id_aluno === id);
  if (!a) { toast("Salvo"); closeDrawer(); return; }
  toast(a.apto ? "Reprocessado: aluno apto para a remessa" : `Reprocessado: ainda com ${a.pendencias.length} pendência(s)`);
  abrirAluno(id);
}
// ao escolher o curso, o grau acompanha o cadastrado na instituicao
function grauDoCurso(f, cursos) {
  f.curso.addEventListener("change", () => { const c = cursos.find(x => x.curso === f.curso.value); if (c?.grau) f.grau.value = c.grau; });
}
async function novoAluno(eid) {
  drawer(`<div class="dh"><div style="flex:1"><h2>Cadastrar aluno</h2><div class="muted">Cadastro individual, fora da base GEDUC</div></div>
      <button onclick="closeDrawer()">Fechar</button></div>
    <div class="db"><form id="fNovo" class="form">${formAluno({cidade: "SAO LUIS", curso: cursosDa(eid)[0].curso, grau: cursosDa(eid)[0].grau || "1"}, {}, new Set(), "", cursosDa(eid))}
      <div class="full row"><button class="primary">Cadastrar e processar</button></div></form></div>`);
  $("#fNovo [name=aluno]").required = true;
  contadores($("#fNovo")); grauDoCurso($("#fNovo"), cursosDa(eid));
  $("#fNovo").onsubmit = async ev => {
    ev.preventDefault();
    const r = await api(`/api/escolas/${eid}/alunos`, {method: "POST", body: Object.fromEntries(new FormData(ev.target))});
    reprocessar(r.id_aluno);
  };
}

async function abrirAluno(id) {
  const [d, a] = [await api(`/api/alunos/${encodeURIComponent(id)}`), MIG?.d.alunos.find(x => x.id_aluno === id)];
  const g = d.geduc, aj = d.ajuste || {}, manual = !!g.manual, erros = camposComErro(a);
  const src = (t, rows, f) => `<h3>${t}</h3>` + (rows.length ? rows.map(f).join("<hr style='border:0;border-top:1px dashed var(--line)'>") : `<p class="muted">Não encontrado nesta base (cruzamento por nome).</p>`);
  const eidAluno = manual ? g.escola_id : MIG?.eid, cursos = cursosDa(eidAluno);
  // valor atual de cada campo (correcao, cruzamento das bases ou GEDUC): a instituicao edita em cima dele
  const atual = Object.fromEntries(CAMPOS_ALUNO.filter(c => c[1]).map(([k]) => [k, aj[k] || (a && k !== "cpf" ? a[k] : "") || g[k] || ""]));
  atual.cpf = aj.cpf || (a && a.cpf !== "DIVERGENTE" ? a.cpf : "");
  const vals = manual ? g : atual;
  drawer(`<div class="dh"><div style="flex:1"><h2>${esc(a?.aluno || g.aluno)}</h2><div class="muted">${manual ? "Cadastro individual" : esc(g.escola)} · ${esc(g.turma)} · ID ${esc(g.id_aluno)}</div>
      ${a ? `<div style="margin-top:6px">${pendBadges(a.pendencias, a.criticas)}${a.migrado ? `<span class="badge b-ok">migrado</span>` : ""}${a.apto ? `<span class="badge b-ok">apto</span>` : ""}</div>` : ""}</div>
      <button onclick="closeDrawer()">Fechar</button></div>
    <div class="db">
      ${a ? `<div class="alert ${a.cpf === "DIVERGENTE" ? "warn" : "info"}">CPF consolidado: <b class="mono">${a.cpf === "DIVERGENTE" ? "DIVERGENTE" : fmtCPF(a.cpf) || "—"}</b>
        ${a.cpf === "DIVERGENTE" ? " — as bases discordam; informe o CPF correto abaixo." : ""}</div>
        ${a.criticas.length ? `<div class="alert warn"><b>Será rejeitado pelo validador SMTT:</b><br>${a.criticas.map(x => `(${x}) ${esc(LEGENDA[x])}`).join("<br>")}
          <br><small>Corrija os campos destacados abaixo e clique em “Salvar e reprocessar”.</small></div>` : ""}` : ""}
      <h3>${manual ? "Cadastro do aluno" : "Correções da instituição"}</h3>
      ${manual ? "" : `<p class="muted" style="margin-top:0">Os campos mostram a informação atual. Edite só o que estiver incorreto (por exemplo, apague os caracteres que sobram). Só os campos alterados viram correção.</p>`}
      <form id="fAj" class="form">
        ${formAluno(vals, manual ? {} : {...g, telefone: a?.telefone || "", rg: a?.rg || "", org_exp: a?.org_exp || "", data_exp: a?.data_exp || "", matricula: a?.matricula || ""}, erros,
          manual ? "" : `<div class="full"><label>Observação</label><input name="obs" value="${esc(aj.obs || "")}"></div>`, cursos)}
        <div class="full row"><button class="primary">Salvar e reprocessar</button>
          ${manual ? `<button type="button" class="danger" id="excluirAluno">Excluir aluno</button>`
            : d.ajuste ? `<button type="button" class="danger" id="limparAj">Remover correções</button>` : ""}
          <span class="muted">${manual ? "" : "Correções têm prioridade sobre as bases."}</span></div>
      </form>
      ${manual ? "" : src("GEDUC", [g], x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Nascimento</dt><dd>${fmtData(x.dt_nasc)}</dd>
        <dt>Mãe</dt><dd>${esc(x.mae) || "—"}</dd><dt>Pai</dt><dd>${esc(x.pai) || "—"}</dd><dt>Série/turno</dt><dd>${esc(x.ano_serie)} · ${esc(x.turno)}</dd>
        <dt>Endereço</dt><dd>${esc([x.rua, x.numero, x.bairro, x.cidade].filter(Boolean).join(", "))}</dd><dt>CEP</dt><dd class="mono">${esc(x.cep) || "—"}</dd>
        <dt>Telefone</dt><dd>${esc(x.telefone) || "—"}</dd></dl>`)}
      ${src("Censo escolar", d.censo, x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Nascimento</dt><dd>${fmtData(x.dt_nasc)}</dd><dt>ID INEP</dt><dd class="mono">${esc(x.id_inep)}</dd><dt>Cor/raça</dt><dd>${esc(x.cor)}</dd></dl>`)}
      ${src("SMTT", d.smtt, x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Instituição</dt><dd>${esc(x.escola)}</dd><dt>Cartão</dt><dd class="mono">${esc(x.cartao) || "—"}</dd>
        <dt>RG</dt><dd>${esc(x.rg) || "—"} ${esc(x.org_exp)}</dd><dt>Celular</dt><dd>${esc(x.celular || x.telefone) || "—"}</dd><dt>Cadastrado</dt><dd>${esc(x.cadastrado)}</dd></dl>`)}
      ${src("Alunos por status", d.status, x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Situação</dt><dd>${esc(x.situacao) || "—"}</dd>
        <dt>Telefone</dt><dd>${esc(x.telefone) || "—"}</dd><dt>Mãe</dt><dd>${esc(x.mae) || "—"}</dd></dl>`)}
      ${d.lotes.length ? `<h3>Remessas</h3>${d.lotes.map(l => `<div class="row" style="gap:8px;margin-bottom:6px"><span>#${l.id} · ${fmtDH(l.criado_em)} · <span class="mono">${esc(l.arquivo)}</span></span><span class="spacer"></span><a class="btn-dl btn-sm" href="/api/lotes/${l.id}/arquivo">${icDl}TXT</a><a class="btn-dl btn-sm" href="/api/lotes/${l.id}/pdf">${icDl}PDF</a></div>`).join("")}` : ""}
    </div>`);
  const fAj = $("#fAj"), inicial = Object.fromEntries(new FormData(fAj));
  contadores(fAj); grauDoCurso(fAj, cursos);
  fAj.onsubmit = async ev => {
    ev.preventDefault();
    let body = Object.fromEntries(new FormData(ev.target));
    // campo sem alteracao e sem correcao anterior continua vindo das bases
    if (!manual) body = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, k === "obs" || v !== inicial[k] || aj[k] ? v : ""]));
    if (manual) await api(`/api/alunos-manuais/${g.id}`, {method: "PUT", body});
    else await api(`/api/alunos/${encodeURIComponent(id)}/ajuste`, {method: "PUT", body});
    reprocessar(id);
  };
  const lim = $("#limparAj");
  if (lim) lim.onclick = async () => { await api(`/api/alunos/${encodeURIComponent(id)}/ajuste`, {method: "PUT", body: {}}); reprocessar(id); };
  const exc = $("#excluirAluno");
  if (exc) exc.onclick = async () => {
    if (!confirm("Excluir este aluno do cadastro individual?")) return;
    await api(`/api/alunos-manuais/${g.id}`, {method: "DELETE"}); toast("Aluno excluído"); closeDrawer(); if (MIG) migracao(MIG.eid);
  };
}

async function previaRemessa(eid, ids) {
  const p = await api(`/api/escolas/${eid}/remessa/previa`, {method: "POST", body: {ids, remover_acentos: true}});
  const ok = p.itens.filter(i => !i.erros.length), rej = p.itens.filter(i => i.erros.length), av = ok.filter(i => i.avisos.length);
  XLS.previa = () => ({titulo: "Prévia da remessa SMTT", subtitulo: `${ok.length} enviado(s) · ${rej.length} rejeitado(s)`,
    colunas: [["Aluno"], ["CPF", "cpf"], ["Situação"], ["Motivos e avisos"]],
    linhas: p.itens.map(i => [i.aluno, i.cpf, i.erros.length ? "Rejeitado" : "Será enviado", [...i.erros, ...i.avisos].join("; ")])});
  modal(`<div class="mh"><h2>Remessa SMTT — prévia</h2><span class="spacer"></span>${btnXls("previa")}<button onclick="closeModal()">×</button></div>
    <div class="mb">
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi ok"><div class="l">Serão enviados</div><div class="v">${fmtN(ok.length)}</div></div>
        <div class="kpi err"><div class="l">Rejeitados</div><div class="v">${fmtN(rej.length)}</div></div>
        <div class="kpi warn"><div class="l">Com campos truncados</div><div class="v">${fmtN(av.length)}</div></div>
      </div>
      <p class="muted">Layout oficial SMPE: ${p.tam_linha} colunas por linha, ${p.layout.length} campos, UTF-8, sem acentos. Arquivo <b class="mono">INST_&lt;código&gt;_REM_&lt;nº&gt;.txt</b>. Os alunos passam pelas mesmas críticas do validador AlunoCritica.</p>
      ${rej.length ? `<h3>Rejeitados</h3><table><thead><tr><th>Aluno</th><th>Motivo</th></tr></thead><tbody>${rej.map(i => `<tr><td>${esc(i.aluno)}</td><td>${i.erros.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table>` : ""}
      ${av.length ? `<h3>Avisos</h3><table><thead><tr><th>Aluno</th><th>Aviso</th></tr></thead><tbody>${av.slice(0, 50).map(i => `<tr><td>${esc(i.aluno)}</td><td class="muted">${i.avisos.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table>` : ""}
      <h3>Amostra do arquivo</h3><pre class="linhas">${esc(p.amostra.join("\n"))}</pre>
    </div>
    <div class="mf"><button onclick="closeModal()">Cancelar</button><button class="primary" id="confRem" ${ok.length ? "" : "disabled"}>Gerar e baixar (${fmtN(ok.length)})</button></div>`);
  $("#confRem").onclick = async () => {
    const r = await api(`/api/escolas/${eid}/remessa`, {method: "POST", body: {ids, remover_acentos: true}});
    closeModal(); toast(`Remessa #${r.lote_id} gerada com ${r.incluidos} aluno(s)`);
    location.href = `/api/lotes/${r.lote_id}/arquivo`;
    setTimeout(() => migracao(eid), 600);
  };
}

// ------------------------------------------------------------------ escolas
async function escolas() {
  await loadEscolas();
  const pn = await api("/api/painel");
  const res = Object.fromEntries(pn.escolas.map(e => [e.id, e]));
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>${ESCOLAS.length} instituições</h2><span class="spacer"></span>
      <input id="fE" placeholder="Filtrar…" style="width:220px">${btnXls("escolas")}<button class="primary" id="novaEsc">Nova instituição</button></div>
    <div class="table-wrap" style="max-height:none"><table id="tbE"><thead><tr><th>ID</th><th>Instituição</th><th>Cód. SMTT</th><th>INEP</th><th>Vínculo GEDUC</th><th class="num">Alunos GEDUC</th><th>Usuários</th><th>Situação</th><th></th></tr></thead>
    <tbody id="tbEBody"></tbody></table></div><div id="pgE"></div></div>`;
  const rowE = e => `<tr data-n="${esc(e.nome.toLowerCase())}"><td>${e.id}</td><td>${esc(e.nome)}</td><td class="mono">${esc(e.cod_smtt)}</td><td class="mono">${esc(e.inep)}</td>
      <td>${e.geduc_nome ? esc(e.geduc_nome) : `<span class="muted">mesmo nome</span>`}</td>
      <td class="num">${res[e.id]?.matriculados ? fmtN(res[e.id].matriculados) : `<span class="badge b-warn">0 — vincular</span>`}</td>
      <td>${e.logins?.length ? e.logins.map(l => `<div>${esc(fmtLogin(l))}</div>`).join("") : `<span class="badge b-mute">sem usuário</span>`}</td>
      <td>${e.bloqueado ? `<span class="badge b-err" title="${esc(e.motivo_bloqueio)}">bloqueada</span><div class="muted">${esc(e.motivo_bloqueio)}</div>` : `<span class="badge b-ok">ativa</span>`}</td>
      <td class="acoes"><div class="row"><button class="btn-sm" data-ed="${e.id}">Editar</button><button class="btn-dl btn-sm" data-fi="${e.id}">${icDl}Fichas</button>
        <button data-bl="${e.id}" class="btn-sm ${e.bloqueado ? "" : "danger"}">${e.bloqueado ? "Desbloquear" : "Bloquear"}</button></div></td></tr>`;
  const filtradas = () => { const q = $("#fE").value.toLowerCase(); return ESCOLAS.filter(e => e.nome.toLowerCase().includes(q) || String(e.id) === q); };
  XLS.escolas = () => ({titulo: "Instituições", subtitulo: $("#fE").value && `Filtro: ${$("#fE").value}`,
    colunas: [["ID", "numero"], ["Instituição"], ["Cód. SMTT"], ["INEP"], ["CNPJ"], ["E-mail"], ["Vínculo GEDUC"], ["Alunos GEDUC", "numero"],
      ["Usuários"], ["Representantes"], ["Cursos"], ["Situação"]],
    linhas: filtradas().map(e => [e.id, e.nome, e.cod_smtt, e.inep, fmtCNPJ(e.cnpj), e.email, e.geduc_nome || "mesmo nome",
      res[e.id]?.matriculados || 0, (e.logins || []).map(fmtLogin).join("\n"),
      (e.representantes || []).map(r => [r.nome, r.cargo, r.contato, r.email].filter(Boolean).join(" · ")).join("\n"),
      (e.cursos || []).map(c => `${c.curso} (grau ${c.grau})`).join("\n"),
      e.bloqueado ? "Bloqueada" + (e.motivo_bloqueio ? `: ${e.motivo_bloqueio}` : "") : "Ativa"])});
  const renderE = () => {
    const pg = paginar("escolas", filtradas(), renderE);
    $("#tbEBody").innerHTML = pg.itens.map(rowE).join("") || `<tr><td colspan="9" class="empty">Nenhuma instituição encontrada.</td></tr>`;
    $("#pgE").innerHTML = pg.html;
  };
  $("#fE").oninput = () => { resetPag("escolas"); renderE(); };
  renderE();
  $("#novaEsc").onclick = () => editarEscola(null);
  $("#tbE").onclick = ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.ed) editarEscola(+b.dataset.ed);
    if (b.dataset.fi) fichasModal(+b.dataset.fi);
    if (b.dataset.bl) bloqueioEscola(+b.dataset.bl);
  };
}
async function bloqueioEscola(id) {
  const e = ESCOLAS.find(x => x.id === id);
  if (e.bloqueado) {
    if (!confirm(`Desbloquear o acesso de ${e.nome}?`)) return;
    await api(`/api/escolas/${id}/bloqueio`, {method: "PUT", body: {bloqueado: false}}); toast("Acesso desbloqueado"); return escolas();
  }
  modal(`<div class="mh"><h2>Bloquear acesso</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <form id="fBl"><div class="mb form">
      <div class="full"><p class="muted" style="margin:0">Ninguém entra em ${esc(e.nome)} até ela ser desbloqueada. Usuários vinculados só a ela não conseguem entrar no sistema, e o motivo aparece na tela de login.</p></div>
      <div class="full"><label>Motivo</label><select name="tipo"><option>Pendência de pagamento</option><option>Outro</option></select></div>
      <div class="full"><label>Detalhe (opcional)</label><input name="det" placeholder="Ex.: fatura de agosto em aberto"></div>
    </div><div class="mf"><button type="button" onclick="closeModal()">Cancelar</button><button class="primary">Bloquear</button></div></form>`);
  $("#fBl").onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const motivo = f.tipo === "Outro" ? f.det : [f.tipo, f.det].filter(Boolean).join(" — ");
    await api(`/api/escolas/${id}/bloqueio`, {method: "PUT", body: {bloqueado: true, motivo}});
    closeModal(); toast("Acesso bloqueado"); escolas();
  };
}
// formulario da instituicao em abas: dados cadastrais, representantes (varios), cursos (varios) e estrutura/documentos.
// Os campos seguem as fichas da SMTT (Central de Atendimento ao Estudante), geradas em PDF no layout oficial.
const TURNOS = [["M", "Matutino"], ["V", "Vespertino"], ["N", "Noturno"], ["I", "Integral"]];
const T4 = ["M", "V", "N", "I"];
const TIPOS_FICHA = ["Educação Infantil", "Ensino Fundamental I", "Ensino Fundamental II", "Ensino Médio", "Pré-Vestibular",
  "Educação Especial", "Educação Profissional", "Educação de Jovens e Adultos (EJA)", "Ensino Superior", "Outro"];  // codigo = posicao + 1
const MODALIDADES = ["Presencial", "Semipresencial", "À distância (100% EAD)"];
const REDES = [["MUNICIPAL", "Municipal"], ["ESTADUAL", "Estadual"], ["FEDERAL", "Federal"], ["PARTICULAR", "Particular"], ["FILANTROPICA", "Filantrópica"]];
const COMPLEMENTARES = [["salas", "Salas de aula"], ["vagas", "Vagas oferecidas"], ["alunos", "Alunos matriculados"], ["professores", "Professores"], ["funcionarios", "Funcionários"]];
const DOCUMENTOS = [["ato_criacao", "Ato de criação"], ["termo_reconhecimento", "Termo de reconhecimento ou autorização do ME/CEE/CME"], ["alvara", "Alvará de funcionamento"]];
const FUNCOES = [["diretor", "Diretor(a) ou Reitor(a)"], ["adjunto", "Diretor(a) adjunto(a) ou Vice-reitor(a)"]];
const opcoes = (ops, v) => ops.map(([o, l]) => `<option value="${o}" ${String(v ?? "") === o ? "selected" : ""}>${l}</option>`).join("");
const selK = (k, ops, v, vazio = "—") => `<select data-k="${k}"><option value="">${vazio}</option>${opcoes(ops, v)}</select>`;
const TIPO_OPTS = TIPOS_FICHA.map((t, i) => [String(i + 1), `${i + 1} · ${t}`]);
const numIn = (attr, v) => `<input type="number" min="0" step="1" ${attr} value="${v ?? ""}">`;

const repRow = (r = {}) => {
  const resp = r.responsabilidade || {}, n = Object.values(resp).reduce((s, v) => s + v.length, 0);
  return `<div class="sub-row rep-row"><div class="form">
    <div class="full"><label>Nome do representante</label><input data-k="nome" value="${esc(r.nome || "")}" required></div>
    <div><label>CPF</label><input data-k="cpf" value="${esc(fmtCPF(r.cpf || ""))}" inputmode="numeric"></div>
    <div><label>RG</label><input data-k="rg" value="${esc(r.rg || "")}"></div>
    <div><label>Órgão expedidor</label><input data-k="org_exp" value="${esc(r.org_exp || "")}" placeholder="Ex.: SSP/MA"></div>
    <div><label>Data de expedição</label><input data-k="data_exp" type="date" value="${esc(r.data_exp || "")}"></div>
    <div><label>Cargo / função</label><input data-k="cargo" value="${esc(r.cargo || "")}" placeholder="Ex.: Gestor(a), Secretário(a)"></div>
    <div><label>Assina a ficha da instituição como</label>${selK("funcao_ficha", FUNCOES, r.funcao_ficha, "Não assina")}</div>
    <div><label>Telefone</label><input data-k="contato" value="${esc(r.contato || "")}" placeholder="(98) 90000-0000"></div>
    <div><label>E-mail</label><input data-k="email" type="email" value="${esc(r.email || "")}"></div>
    <div class="full"><label>Endereço</label><input data-k="endereco" value="${esc(r.endereco || "")}" placeholder="Rua, número, complemento"></div>
    <div><label>Bairro</label><input data-k="bairro" value="${esc(r.bairro || "")}"></div>
    <div><label>CEP</label><input data-k="cep" value="${esc(r.cep || "")}" inputmode="numeric" placeholder="00000-000"></div>
    <div><label>Município</label><input data-k="municipio" value="${esc(r.municipio || "")}" placeholder="SAO LUIS"></div>
    <details class="full resp" ${n ? "open" : ""}><summary>Turno e tipo de ensino de responsabilidade do representante</summary>
      <table class="grade"><thead><tr><th>Tipo de ensino</th>${["MAT", "VESP", "NOT", "INTEG"].map(l => `<th>${l}</th>`).join("")}</tr></thead><tbody>
      ${TIPOS_FICHA.map((t, i) => `<tr><td>${t}</td>${T4.map(tn => `<td><input type="checkbox" data-resp="${i + 1}" value="${tn}" ${(resp[i + 1] || []).includes(tn) ? "checked" : ""}></td>`).join("")}</tr>`).join("")}
      </tbody></table></details>
  </div><button type="button" class="btn-sm danger sub-del">Remover</button></div>`;
};
const cursoRow = (c = {}) => `<div class="sub-row curso-row"><div class="form">
    <div class="full"><label>Descrição do curso</label><input data-k="curso" list="dlCursos" maxlength="25" value="${esc(c.curso || "")}" required></div>
    <div><label>Tipo de ensino (ficha SMTT)</label>${selK("tipo_ensino", TIPO_OPTS, c.tipo_ensino)}</div>
    <div><label>Modalidade</label>${selK("modalidade", MODALIDADES.map((m, i) => [String(i + 1), `${i + 1} · ${m}`]), c.modalidade)}</div>
    <div><label>Grau (remessa)</label><select data-k="grau">${["1", "2", "3"].map(g => `<option ${(c.grau || "1") === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
    <div><label>Séries / períodos</label><input data-k="series" value="${esc(c.series || "")}" placeholder="Ex.: 1 a 9"></div>
    <div class="full"><label>Turnos</label><div class="turnos">${TURNOS.map(([v, l]) => `<label><input type="checkbox" value="${v}" ${(c.turnos || "").split(",").includes(v) ? "checked" : ""}>${l}</label>`).join("")}</div></div>
  </div><button type="button" class="btn-sm danger sub-del">Remover</button></div>`;
function paneEstrutura(fc) {
  const salas = fc.salas || {}, compl = fc.complementares || {}, docs = fc.documentos || {};
  return `<p class="muted" style="margin-top:0">Quadros da <b>Ficha de cadastro da instituição de ensino</b>. Deixe em branco o que não se aplica.</p>
    <h3>Tipo de ensino e quantidade de salas por turno</h3>
    <div class="alert info" style="margin-bottom:10px">Informe <b>quantas salas de aula</b> cada tipo de ensino usa em cada turno (não o número de alunos).
      O <b>Nº salas</b> é a soma dos turnos, e a linha <b>Salas de aula</b> das informações complementares é preenchida a partir deste quadro.</div>
    <div class="table-wrap" style="max-height:none"><table class="grade"><thead><tr><th>Tipo de ensino</th>${TURNOS.map(([, l]) => `<th>${l}</th>`).join("")}<th>Nº salas</th></tr></thead><tbody>
      ${TIPOS_FICHA.map((t, i) => `<tr><td>${t}</td>${T4.map(k => `<td>${numIn(`data-sala="${i + 1}" data-t="${k}" max="150"`, salas[i + 1]?.[k])}</td>`).join("")}<td class="num"><b data-nsalas="${i + 1}"></b></td></tr>`).join("")}
      <tr class="soma"><td>Total por turno</td>${T4.map(tn => `<td class="num"><b data-tsala="${tn}"></b></td>`).join("")}<td class="num"><b data-tsala="total"></b></td></tr>
    </tbody></table></div>
    <h3>Informações complementares sobre a instituição</h3>
    <div class="table-wrap" style="max-height:none"><table class="grade"><thead><tr><th>Quantidade de</th>${TURNOS.map(([, l]) => `<th>${l}</th>`).join("")}<th>Total</th></tr></thead><tbody>
      ${COMPLEMENTARES.map(([k, l]) => `<tr><td>${l}</td>${T4.map(tn => `<td>${numIn(`data-compl="${k}" data-t="${tn}"`, compl[k]?.[tn])}</td>`).join("")}<td class="num"><b data-tot="${k}"></b></td></tr>`).join("")}
    </tbody></table></div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn-sm" id="alunosGeduc">Preencher “Alunos matriculados” com os alunos do sistema, por turno</button></div>
    <h3>Documentação</h3>
    <div class="table-wrap" style="max-height:none"><table class="grade"><thead><tr><th>Tipo</th><th>Número</th><th>Data de expedição</th><th>Validade</th></tr></thead><tbody>
      ${DOCUMENTOS.map(([k, l]) => `<tr><td class="doc-tipo">${l}</td><td><input data-doc="${k}" data-t="numero" value="${esc(docs[k]?.numero || "")}" style="width:130px" maxlength="40"></td>
        <td><input type="date" data-doc="${k}" data-t="data" value="${esc(docs[k]?.data || "")}"></td><td><input type="date" data-doc="${k}" data-t="validade" value="${esc(docs[k]?.validade || "")}"></td></tr>`).join("")}
    </tbody></table></div>`;
}
async function editarEscola(id) {
  const e = ESCOLAS.find(x => x.id === id) || {nome: "", cod_smtt: "", inep: "", geduc_nome: "", nivel: "ENSINO FUNDAMENTAL", municipio: "SAO LUIS", representantes: [], cursos: [], ficha: {}};
  const sug = e.nome ? await api("/api/geduc/escolas?sugerir_para=" + encodeURIComponent(e.nome)) : await api("/api/geduc/escolas");
  const abas = [["dados", "Dados cadastrais"], ["reps", "Representantes"], ["cursos", "Cursos"], ["estrutura", "Estrutura e documentos"]];
  modal(`<div class="mh"><h2>${id ? "Editar instituição" : "Nova instituição"}</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <form id="fEsc"><div class="mb">
      <div class="tabs" id="escTabs" style="margin-bottom:16px">${abas.map(([k, l], i) => `<button type="button" class="tab ${i ? "" : "active"}" data-aba="${k}">${l} <span class="n" data-n="${k}"></span></button>`).join("")}</div>
      <div class="form" data-pane="dados">
        <div><label>ID</label><input name="id" type="number" value="${id ?? ""}" ${id ? "disabled" : ""} placeholder="automático"></div>
        <div><label>Curso padrão (campo CURSO da remessa)</label><input name="nivel" list="dlCursos" maxlength="25" value="${esc(e.nivel)}"></div>
        <div class="full"><label>Nome da instituição</label><input name="nome" required value="${esc(e.nome)}"></div>
        <div><label>Código SMTT (4 dígitos)</label><input name="cod_smtt" value="${esc(e.cod_smtt)}" maxlength="4"></div>
        <div><label>Código INEP</label><input name="inep" value="${esc(e.inep)}"></div>
        <div><label>CNPJ</label><input name="cnpj" value="${esc(fmtCNPJ(e.cnpj))}" inputmode="numeric" placeholder="00.000.000/0000-00"></div>
        <div><label>Rede de ensino</label><select name="rede"><option value="">—</option>${opcoes(REDES, e.rede)}</select></div>
        <div class="full"><label>Endereço</label><input name="endereco" value="${esc(e.endereco || "")}" placeholder="Rua, número, complemento"></div>
        <div><label>Bairro</label><input name="bairro" value="${esc(e.bairro || "")}"></div>
        <div><label>Município</label><input name="municipio" value="${esc(e.municipio || "")}" placeholder="SAO LUIS"></div>
        <div><label>CEP</label><input name="cep" value="${esc(e.cep || "")}" inputmode="numeric" placeholder="00000-000"></div>
        <div><label>Telefone</label><input name="telefone" value="${esc(e.telefone || "")}" placeholder="(98) 3000-0000"></div>
        <div class="full"><label>E-mail</label><input name="email" type="email" value="${esc(e.email || "")}"></div>
        <div class="full"><label>Vínculo com o GEDUC (nome da instituição na base GEDUC)</label>
          <select name="geduc_nome"><option value="">Usar o mesmo nome do cadastro</option>${sug.slice(0, 400).map(s =>
            `<option value="${esc(s.escola)}" ${s.escola.trim() === (e.geduc_nome || "").trim() ? "selected" : ""}>${esc(s.escola)} — ${fmtN(s.alunos)} alunos${s.similaridade != null ? ` (${Math.round(s.similaridade * 100)}%)` : ""}</option>`).join("")}</select>
          <small class="muted">Ordenado por semelhança com o nome. Também cruza pelo INEP, se informado.</small></div>
      </div>
      <div data-pane="reps" hidden>
        <p class="muted" style="margin-top:0">Pessoas que respondem pela instituição. Cada uma gera uma <b>Ficha de cadastro do representante</b>. Marque quem assina a ficha da instituição como diretor(a) e como adjunto(a).</p>
        <div id="repList">${(e.representantes || []).map(repRow).join("")}</div>
        <button type="button" id="addRep">+ Adicionar representante</button>
      </div>
      <div data-pane="cursos" hidden>
        <p class="muted" style="margin-top:0">Cursos oferecidos. Formam a <b>Relação de cursos da instituição</b> e aparecem como opções de Tipo de ensino no cadastro e na correção dos alunos.</p>
        <div id="cursoList">${(e.cursos || []).map(cursoRow).join("")}</div>
        <button type="button" id="addCurso">+ Adicionar curso</button>
      </div>
      <div data-pane="estrutura" hidden>${paneEstrutura(e.ficha || {})}</div>
      <datalist id="dlCursos">${TIPOS_ENSINO.map(t => `<option value="${t}">`).join("")}</datalist>
    </div>
    <div class="mf">${id ? `<button type="button" class="danger" id="delEsc">Excluir</button><span class="spacer"></span>` : ""}<button type="button" onclick="closeModal()">Cancelar</button><button class="primary">Salvar</button></div></form>`);
  const f = $("#fEsc");
  const contar = () => { $("[data-n=reps]", f).textContent = $$(".rep-row", f).length || ""; $("[data-n=cursos]", f).textContent = $$(".curso-row", f).length || ""; };
  const mostrar = k => { $$("[data-pane]", f).forEach(p => p.hidden = p.dataset.pane !== k); $$("#escTabs .tab", f).forEach(b => b.classList.toggle("active", b.dataset.aba === k)); };
  $("#escTabs").onclick = ev => { const b = ev.target.closest("[data-aba]"); if (b) mostrar(b.dataset.aba); };
  // campo obrigatorio em aba escondida: abre a aba para o navegador mostrar o aviso
  f.addEventListener("invalid", ev => { const p = ev.target.closest("[data-pane]"); if (p?.hidden) { mostrar(p.dataset.pane); setTimeout(() => ev.target.reportValidity()); } }, true);
  $("#addRep").onclick = () => { $("#repList").insertAdjacentHTML("beforeend", repRow()); contar(); $("#repList .rep-row:last-child input").focus(); };
  $("#addCurso").onclick = () => { $("#cursoList").insertAdjacentHTML("beforeend", cursoRow()); contar(); $("#cursoList .curso-row:last-child input").focus(); };
  f.addEventListener("click", ev => { if (ev.target.matches(".sub-del")) { ev.target.closest(".sub-row").remove(); contar(); } });
  // totais das informacoes complementares
  const totais = () => {
    // quadro de salas: N. salas = soma dos turnos; "Salas de aula" (complementares) = soma de cada turno no quadro
    const salas = $$("[data-sala]", f), temSalas = salas.some(i => i.value !== "");
    salas.forEach(x => x.setCustomValidity(+x.value > 150 ? "Informe a quantidade de SALAS de aula neste turno, não o número de alunos" : ""));
    TIPOS_FICHA.forEach((_, i) => {
      const cel = salas.filter(x => x.dataset.sala === String(i + 1)), s = cel.reduce((a, x) => a + (+x.value || 0), 0);
      $(`[data-nsalas="${i + 1}"]`, f).textContent = s ? fmtN(s) : "";
    });
    T4.forEach(tn => {
      const s = salas.filter(x => x.dataset.t === tn).reduce((a, x) => a + (+x.value || 0), 0);
      $(`[data-tsala="${tn}"]`, f).textContent = s ? fmtN(s) : "";
      const c = $(`[data-compl="salas"][data-t="${tn}"]`, f);
      c.readOnly = temSalas; c.title = temSalas ? "Calculado a partir do quadro de salas por tipo de ensino" : "";
      if (temSalas) c.value = s || "";
    });
    const tot = salas.reduce((a, x) => a + (+x.value || 0), 0);
    $('[data-tsala="total"]', f).textContent = tot ? fmtN(tot) : "";
    COMPLEMENTARES.forEach(([k]) => {
      const s = $$(`[data-compl="${k}"]`, f).reduce((a, i) => a + (+i.value || 0), 0), vazio = $$(`[data-compl="${k}"]`, f).every(i => i.value === "");
      $(`[data-tot="${k}"]`, f).textContent = vazio ? "" : fmtN(s);
    });
  };
  f.addEventListener("input", ev => { if (ev.target.dataset.compl || ev.target.dataset.sala) totais(); });
  totais(); contar();
  $("#alunosGeduc").onclick = async () => {
    if (!id) return toast("Salve a instituição antes de buscar os alunos");
    const d = await api(`/api/escolas/${id}/alunos`), cont = {M: 0, V: 0, N: 0, I: 0};
    d.alunos.forEach(a => { const t = (a.turno || "").trim().toUpperCase()[0]; if (t in cont) cont[t]++; });
    T4.forEach(tn => { $(`[data-compl="alunos"][data-t="${tn}"]`, f).value = cont[tn] || ""; });
    totais(); toast(`${fmtN(d.alunos.length)} aluno(s) distribuídos por turno`);
  };
  const campos = row => Object.fromEntries($$("[data-k]", row).map(i => [i.dataset.k, i.value]));
  const grade = (attr) => { const o = {}; $$(`[data-${attr}]`, f).forEach(i => { if (i.value !== "") (o[i.dataset[attr]] ||= {})[i.dataset.t] = i.value; }); return o; };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const representantes = $$(".rep-row", f).map(row => {
      const resp = {};
      $$("[data-resp]:checked", row).forEach(c => (resp[c.dataset.resp] ||= []).push(c.value));
      return {...campos(row), responsabilidade: resp};
    });
    const cursos = $$(".curso-row", f).map(row => ({...campos(row), turnos: $$(".turnos input:checked", row).map(x => x.value).join(",")}));
    const ficha = {salas: grade("sala"), complementares: grade("compl"), documentos: grade("doc")};
    const body = {...e, ...d, id: id || (d.id ? +d.id : null), representantes, cursos, ficha};
    if (id) await api(`/api/escolas/${id}`, {method: "PUT", body}); else await api("/api/escolas", {method: "POST", body});
    closeModal(); toast("Instituição salva"); escolas();
  };
  const del = $("#delEsc");
  if (del) del.onclick = async () => { if (confirm("Excluir esta instituição? Os vínculos de usuários, os arquivos finais e os alunos do cadastro individual também serão excluídos.")) { await api(`/api/escolas/${id}`, {method: "DELETE"}); closeModal(); escolas(); } };
}

// fichas da SMTT: PDFs no layout oficial, com o que falta preencher em cada uma
async function fichasModal(eid) {
  if (!ESCOLAS.find(x => x.id === +eid)?.representantes) await loadEscolas();
  const e = ESCOLAS.find(x => x.id === +eid);
  if (!e) return toast("Instituição não encontrada");
  const reps = e.representantes || [], cursos = e.cursos || [], url = t => `/api/escolas/${eid}/ficha/${t}`;
  const falta = (cond, txt) => cond ? `<li>${txt}</li>` : "";
  const pend = lista => lista.join("") ? `<ul class="pend">${lista.join("")}</ul>` : `<p class="ok-txt">Tudo preenchido.</p>`;
  const inst = pend([falta(!e.cnpj, "CNPJ"), falta(!e.endereco || !e.bairro || !e.cep, "Endereço, bairro ou CEP"), falta(!e.telefone, "Telefone"),
    falta(!e.rede, "Rede de ensino"), falta(!Object.keys(e.ficha?.salas || {}).length, "Salas por tipo de ensino e turno (aba Estrutura e documentos)"),
    falta(!reps.some(r => r.funcao_ficha === "diretor"), "Representante marcado como Diretor(a) ou Reitor(a)")]);
  const curs = pend([falta(!cursos.length, "Nenhum curso cadastrado"), falta(cursos.some(c => !c.tipo_ensino || !c.modalidade), "Curso sem tipo de ensino ou modalidade")]);
  modal(`<div class="mh"><h2>Fichas da SMTT</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <div class="mb"><p class="muted" style="margin-top:0">${esc(e.nome)} · PDFs no layout da Central de Atendimento ao Estudante, prontos para imprimir e assinar. Usam os dados salvos no cadastro da instituição.</p>
      <div class="ficha-lista">
        <div class="ficha"><div><b>Ficha de cadastro da instituição de ensino</b>${inst}</div><a class="btn-dl" href="${url("instituicao")}">${icDl}PDF</a></div>
        <div class="ficha"><div><b>Relação de cursos da instituição</b> <span class="muted">(${cursos.length} curso(s))</span>${curs}</div><a class="btn-dl" href="${url("cursos")}">${icDl}PDF</a></div>
        <div class="ficha"><div><b>Ficha de cadastro do representante</b> <span class="muted">(uma página por representante)</span>
          ${reps.length ? `<ul class="reps">${reps.map((r, i) => `<li><span>${esc(r.nome)}${r.cargo ? ` · ${esc(r.cargo)}` : ""}${!r.cpf || !r.rg ? ` <span class="badge b-warn">falta ${!r.cpf ? "CPF" : "RG"}</span>` : ""}</span><a class="btn-dl btn-sm" href="${url("representantes")}?rep=${i}">${icDl}PDF</a></li>`).join("")}</ul>` : `<ul class="pend"><li>Nenhum representante cadastrado</li></ul>`}</div>
          <a class="btn-dl" href="${url("representantes")}">${icDl}Todos</a></div>
      </div>
      ${ehAdmin() ? `<p class="muted" style="margin-bottom:0">Para completar os dados, use <b>Instituições → Editar</b>.</p>` : `<p class="muted" style="margin-bottom:0">Para corrigir algum dado, fale com o administrador do sistema.</p>`}
    </div>`);
}

// ------------------------------------------------------------------ remessas
async function remessas(_, qs) {
  const eid = qs.get("escola") || "";
  const ls = await api("/api/lotes" + (eid ? "?escola_id=" + eid : ""));
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>Remessas geradas</h2><span class="spacer"></span>${ls.length ? btnXls("remessas") : ""}<div style="width:360px" data-admin>${escolaSelect("selEscR", eid)}</div></div>
    ${ls.length ? `<div class="table-wrap" style="max-height:none"><table id="tbL"><thead><tr><th>#</th><th>Instituição</th><th>Gerada em</th><th class="num">Alunos</th><th>Arquivo</th><th></th></tr></thead><tbody id="tbLBody"></tbody></table></div><div id="pgL"></div>` : `<div class="empty">Nenhuma remessa gerada. Selecione alunos em <a href="#/migracao">Matriculado</a> e clique em “Gerar remessa SMTT”.</div>`}</div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Arquivo do processamento final</h2><span class="spacer"></span>
      <span class="muted">TXT do processamento final + PDF com os CPFs dos alunos (os dois são obrigatórios)</span><span id="xlsFinais"></span></div>
      <div class="card-b"><form id="fFinal" class="row" style="align-items:flex-end">
        ${ehAdmin() ? `<div style="min-width:280px;flex:1"><label>Instituição</label>${escolaSelect("selEscF", eid)}</div>` : ""}
        <div style="flex:1;min-width:220px"><label>Arquivo TXT do processamento final</label><input type="file" name="txt" accept=".txt" required></div>
        <div style="flex:1;min-width:220px"><label>PDF com os CPFs dos alunos</label><input type="file" name="pdf" accept=".pdf,application/pdf" required></div>
        <button class="primary">Importar arquivos</button></form></div>
      <div id="finais"></div></div>`;
  $("#selEscR").onchange = ev => { resetPag("remessas"); location.hash = "#/remessas?escola=" + ev.target.value; };
  XLS.remessas = () => ({titulo: "Remessas SMTT", colunas: [["#", "numero"], ["Instituição"], ["Gerada em", "datahora"], ["Alunos", "numero"], ["Arquivo"]],
    linhas: ls.map(l => [l.id, l.escola, l.criado_em, l.n_alunos, l.arquivo])});
  const rowL = l => `<tr><td>${l.id}</td><td>${esc(l.escola)}</td><td>${fmtDH(l.criado_em)}</td><td class="num">${fmtN(l.n_alunos)}</td>
      <td class="mono">${esc(l.arquivo)}</td><td class="acoes"><div class="row"><a class="btn-dl btn-sm" href="/api/lotes/${l.id}/arquivo">${icDl}TXT</a><a class="btn-dl btn-sm" href="/api/lotes/${l.id}/pdf">${icDl}PDF</a><a class="btn btn-sm" href="#/critica?lote=${l.id}">Criticar</a><button class="btn-sm" data-ver="${l.id}">Alunos</button><button class="btn-sm danger" data-del="${l.id}">Excluir</button></div></td></tr>`;
  const renderL = () => { const pg = paginar("remessas", ls, renderL); if ($("#tbLBody")) { $("#tbLBody").innerHTML = pg.itens.map(rowL).join(""); $("#pgL").innerHTML = pg.html; } };
  renderL();
  const finais = async () => {
    const fs = await api("/api/arquivos-finais" + (eid ? "?escola_id=" + eid : ""));
    XLS.finais = () => ({titulo: "Arquivos do processamento final", colunas: [["#", "numero"], ["Instituição"], ["Importado em", "datahora"],
      ["Enviado por"], ["Arquivo TXT"], ["Registros", "numero"], ["PDF (CPFs)"]],
      linhas: fs.map(f => [f.id, f.escola, f.criado_em, fmtLogin(f.enviado_por), f.txt_nome, f.n_registros, f.pdf_nome])});
    $("#xlsFinais").innerHTML = fs.length ? btnXls("finais") : "";
    $("#finais").innerHTML = fs.length ? `<div class="table-wrap" style="max-height:none"><table><thead><tr><th>#</th><th>Instituição</th><th>Importado em</th><th>Por</th><th>TXT</th><th class="num">Registros</th><th>PDF (CPFs)</th><th></th></tr></thead><tbody>
      ${fs.map(f => `<tr><td>${f.id}</td><td>${esc(f.escola)}</td><td>${fmtDH(f.criado_em)}</td><td>${esc(fmtLogin(f.enviado_por))}</td>
        <td class="mono">${esc(f.txt_nome)}</td><td class="num">${fmtN(f.n_registros)}</td><td>${esc(f.pdf_nome)}</td>
        <td class="acoes"><div class="row"><a class="btn-dl btn-sm" href="/api/arquivos-finais/${f.id}/txt">${icDl}TXT</a><a class="btn-dl btn-sm" href="/api/arquivos-finais/${f.id}/pdf">${icDl}PDF</a><button class="btn-sm danger" data-delf="${f.id}">Excluir</button></div></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty" style="padding:24px">Nenhum arquivo final importado.</div>`;
  };
  finais();
  $("#finais").onclick = async ev => {
    const id = ev.target.dataset.delf;
    if (id && confirm(`Excluir o arquivo final #${id}?`)) { await api(`/api/arquivos-finais/${id}`, {method: "DELETE"}); toast("Arquivo excluído"); finais(); }
  };
  $("#fFinal").onsubmit = async ev => {
    ev.preventDefault();
    const esc_id = ehAdmin() ? $("#selEscF").value : SESSAO.escola_id;
    if (!esc_id) return toast("Selecione a instituição");
    const fd = new FormData(ev.target);
    const r = await api(`/api/escolas/${esc_id}/arquivos-finais`, {method: "POST", body: fd});
    ev.target.reset(); toast(`Arquivos importados (${fmtN(r.n_registros)} registro(s) no TXT)`); finais();
  };
  const tb = $("#tbL");
  if (tb) tb.onclick = async ev => {
    const v = ev.target.dataset.ver, d = ev.target.dataset.del;
    if (v) {
      const al = await api(`/api/lotes/${v}/alunos`);
      XLS.lote = () => ({titulo: `Remessa ${v} - alunos`, colunas: [["Aluno"], ["CPF", "cpf"]], linhas: al.map(a => [a.nome, a.cpf])});
      const ver = () => { const pg = paginar("lote", al, ver, 25);
        modal(`<div class="mh"><h2>Remessa #${v} — ${al.length} alunos</h2><span class="spacer"></span>${btnXls("lote")}<button onclick="closeModal()">×</button></div><div class="mb"><table><thead><tr><th>Aluno</th><th>CPF</th></tr></thead><tbody>${pg.itens.map(a => `<tr><td>${esc(a.nome)}</td><td class="mono">${fmtCPF(a.cpf)}</td></tr>`).join("")}</tbody></table>${pg.html}</div>`); };
      resetPag("lote"); ver();
    }
    if (d && confirm(`Excluir a remessa #${d}? Os alunos voltam a ficar como não migrados.`)) { await api(`/api/lotes/${d}`, {method: "DELETE"}); toast("Remessa excluída"); remessas(_, qs); }
  };
}

// ------------------------------------------------------------------ critica de remessa
async function critica(_, qs) {
  const lote = qs.get("lote");
  $("#view").innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Arquivo de remessa</h2><span class="spacer"></span>
      <span class="muted">Equivalente ao “Utilitário para validação de remessa em texto de 375 colunas” (SMPE)</span></div>
      <div class="card-b"><div class="drop" id="dropCrit"><svg class="i"><use href="#i-upload"/></svg>
        Arraste o arquivo <b>INST_xxxx_REM_nn.txt</b> aqui ou <label style="display:inline;color:var(--blue);cursor:pointer">escolha<input type="file" accept=".txt" hidden></label></div></div></div>
    <div id="critRes">${lote ? `<div class="empty">Criticando remessa #${esc(lote)}…</div>` : ""}</div>`;
  const dz = $("#dropCrit");
  const enviarCrit = async f => { if (!f) return; const fd = new FormData(); fd.append("arquivo", f); $("#critRes").innerHTML = `<div class="empty">Criticando…</div>`; renderCritica(await api("/api/critica", {method: "POST", body: fd})); };
  dz.querySelector("input").onchange = ev => enviarCrit(ev.target.files[0]);
  dz.ondragover = ev => { ev.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = ev => { ev.preventDefault(); dz.classList.remove("over"); enviarCrit(ev.dataTransfer.files[0]); };
  if (lote) renderCritica(await api(`/api/lotes/${lote}/critica`));
}
function renderCritica(r) {
  const erros = r.registros.filter(x => x.branco || x.codigos.length);
  const cont = {};
  erros.forEach(x => x.codigos.forEach(k => cont[k] = (cont[k] || 0) + 1));
  $("#critRes").innerHTML = `
    <div class="alert ${r.aprovado ? "info" : "warn"}" style="font-size:14px"><b>${r.aprovado ? "✔ Arquivo OK" : "✖ Arquivo com inconsistências"}</b> — ${esc(r.arquivo)}
      · codificação ${r.codificacao.utf8 ? "UTF-8" : "NÃO UTF-8"}${r.codificacao.bom ? " (com BOM)" : ""}</div>
    ${r.gerais.map(g => `<div class="alert warn">${esc(g)}</div>`).join("")}
    <div class="grid kpis">
      <div class="kpi hero"><div class="l">Total de registros</div><div class="v">${fmtN(r.total)}</div></div>
      <div class="kpi ok"><div class="l">Estudantes OK</div><div class="v">${fmtN(r.ok)}</div></div>
      <div class="kpi err"><div class="l">Estudantes não OK</div><div class="v">${fmtN(r.nao_ok)}</div></div>
      <div class="kpi"><div class="l">Colunas por linha</div><div class="v">${r.tam_linha}</div><div class="s">layout oficial</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Registros com crítica (${fmtN(erros.length)})</h2><span class="spacer"></span>
      ${btnXls("critica")}<button id="baixarCrit" class="btn-dl">${icDl}Baixar relatório TXT</button></div>
      ${erros.length ? `<div class="table-wrap"><table><thead><tr><th>Linha</th><th>Nome do estudante</th><th>CPF</th><th>Nascimento</th><th>Colunas</th><th>Críticas</th></tr></thead><tbody id="tbCrit"></tbody></table></div><div id="pgCrit"></div>` : `<div class="empty">Nenhum registro com crítica.</div>`}</div>
    <div class="card"><div class="card-h"><h2>Legenda explicativa</h2></div><div class="table-wrap" style="max-height:none"><table><thead><tr><th>Cód.</th><th>Regra</th><th class="num">Ocorrências</th></tr></thead><tbody>
      ${Object.entries(LEGENDA).map(([k, v]) => `<tr><td><b>(${k})</b></td><td>${esc(v)}</td><td class="num">${cont[k] ? `<b style="color:var(--err)">${cont[k]}</b>` : "—"}</td></tr>`).join("")}
      ${r.obs.map(o => `<tr><td></td><td class="muted" colspan="2">${esc(o)}</td></tr>`).join("")}</tbody></table></div></div>`;
  XLS.critica = () => ({titulo: `Crítica ${r.arquivo || "da remessa"}`, subtitulo: `${r.ok} registro(s) OK · ${r.nao_ok} com crítica`,
    colunas: [["Linha", "numero"], ["Nome do estudante"], ["CPF", "cpf"], ["Nascimento", "data"], ["Colunas", "numero"], ["Situação"], ["Críticas"]],
    linhas: r.registros.map(x => x.branco ? [x.linha, "(linha em branco)", "", "", x.colunas, "Com crítica", "O formato do arquivo não aceita linhas em branco"]
      : [x.linha, x.campos.NOME_ESTUDANTE, x.campos.CPF, x.campos.DT_NASCIMENTO.replace(/^(\d\d)(\d\d)(\d{4})$/, "$3-$2-$1"), x.colunas,
         x.codigos.length ? "Com crítica" : "OK", x.codigos.map(k => `(${k}) ${LEGENDA[k]}`).join("; ")])});
  const rowC = x => x.branco ? `<tr><td>${x.linha}</td><td colspan="5"><span class="badge b-err">Linha em branco</span></td></tr>` : `<tr><td>${x.linha}</td><td><b>${esc(x.campos.NOME_ESTUDANTE)}</b><div class="muted">Mãe: ${esc(x.campos.MAE) || "—"}</div></td>
        <td class="mono">${esc(x.campos.CPF) || "—"}</td><td class="mono">${esc(x.campos.DT_NASCIMENTO)}</td><td class="num">${x.colunas}</td><td>${codBadges(x.codigos)}</td></tr>`;
  const renderC = () => { const pg = paginar("critica", erros, renderC); if ($("#tbCrit")) { $("#tbCrit").innerHTML = pg.itens.map(rowC).join(""); $("#pgCrit").innerHTML = pg.html; } };
  resetPag("critica"); renderC();
  $("#baixarCrit").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.relatorio], {type: "text/plain;charset=utf-8"}));
    a.download = r.relatorio_nome; a.click();
  };
}

// ------------------------------------------------------------------ relatorios
const RELS = {
  sem_cpf: {t: "RELAÇÃO SIMPLIFICADA DE ESTUDANTES SEM CPF", cols: ["LINHA", "NOME DO ESTUDANTE", "DATA NASC", "SEXO", "MÃE", "TURMA", "INFORME O CPF"],
    row: (a, i) => [i, esc(a.aluno) + (a.divergente ? ' <small>(CPF divergente)</small>' : ""), fmtData(a.dt_nasc), a.sexo, esc(a.mae), esc(a.turma), `<span class="fill"></span>`],
    xcols: [["Linha", "numero"], ["Nome do estudante"], ["Data nasc.", "data"], ["Sexo"], ["Mãe"], ["Turma"], ["Observação"], ["Informe o CPF"]],
    xrow: (a, i) => [i, a.aluno, a.dt_nasc, a.sexo, a.mae, a.turma, a.divergente ? "CPF divergente" : "", ""]},
  sem_mae: {t: "RELAÇÃO SIMPLIFICADA DE ESTUDANTES SEM MÃE", cols: ["LINHA", "NOME DO ESTUDANTE", "DATA NASC", "SEXO", "INFORME A MÃE", "TURMA", "CPF"],
    row: (a, i) => [i, esc(a.aluno), fmtData(a.dt_nasc), a.sexo, `<span class="fill"></span>`, esc(a.turma), fmtCPF(a.cpf)],
    xcols: [["Linha", "numero"], ["Nome do estudante"], ["Data nasc.", "data"], ["Sexo"], ["Informe a mãe"], ["Turma"], ["CPF", "cpf"]],
    xrow: (a, i) => [i, a.aluno, a.dt_nasc, a.sexo, "", a.turma, a.cpf]},
  simplificada: {t: "RELAÇÃO SIMPLIFICADA DE ESTUDANTES", cols: ["LINHA", "NOME DO ESTUDANTE", "CPF", "DATA NASC", "MÃE"],
    row: (a, i) => [i, esc(a.aluno), `<span class="mono">${a.cpf_mascarado || "—"}</span>`, fmtData(a.dt_nasc), esc(a.mae)],
    xcols: [["Linha", "numero"], ["Nome do estudante"], ["CPF"], ["Data nasc.", "data"], ["Mãe"]],
    xrow: (a, i) => [i, a.aluno, a.cpf_mascarado, a.dt_nasc, a.mae]},
};
async function relatorios(eid, qs) {
  eid = eid || ultimaEscola();
  const tipo = qs.get("tipo") || "sem_cpf";
  $("#view").innerHTML = `<div class="row no-print" style="margin-bottom:14px"><div style="width:420px">${escolaSelect("selEscRel", eid)}</div>
      <div class="tabs">${Object.entries({sem_cpf: "Sem CPF", sem_mae: "Sem mãe", simplificada: "Simplificada (CPF mascarado)"}).map(([k, l]) =>
        `<button class="tab ${k === tipo ? "active" : ""}" data-t="${k}">${l}</button>`).join("")}</div>
      <span class="spacer"></span>${eid ? `<button type="button" class="btn-dl" id="btnFichas">${icDl}Fichas SMTT</button>${btnXls("relatorio")}` : ""}<button class="primary" onclick="print()" ${eid ? "" : "disabled"}>Imprimir</button></div><div id="relDoc"></div>`;
  if ($("#btnFichas")) $("#btnFichas").onclick = () => fichasModal(eid);
  $("#selEscRel").onchange = ev => location.hash = `#/relatorios/${ev.target.value}?tipo=${tipo}`;
  $$(".tabs .tab").forEach(b => b.onclick = () => location.hash = `#/relatorios/${eid}?tipo=${b.dataset.t}`);
  if (!eid) { $("#relDoc").innerHTML = `<div class="empty">Selecione uma instituição.</div>`; return; }
  lembrarEscola(eid);
  const d = await api(`/api/escolas/${eid}/relatorio/${tipo}`), R = RELS[tipo], e = d.escola;
  XLS.relatorio = () => ({titulo: `${R.t} - ${e.nome}`, subtitulo: `Cód. SMTT ${e.cod_smtt || "—"}`, colunas: R.xcols, linhas: d.itens.map((a, i) => R.xrow(a, i + 1))});
  $("#relDoc").innerHTML = `<div class="doc"><div class="doc-head"><img src="/api/logo" alt=""><h2>${R.t} - ${new Date().getFullYear()}</h2></div>
    <div class="dmeta"><span><b>COD:</b> ${esc(e.cod_smtt)}</span><span><b>INSTITUIÇÃO:</b> ${esc(e.nome)}</span><span><b>DATA/HORA:</b> ${agora()}</span><span><b>TOTAL:</b> ${d.itens.length}</span></div>
    ${d.itens.length ? `<table><thead><tr>${R.cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>
      ${d.itens.map((a, i) => `<tr>${R.row(a, i + 1).map(v => `<td>${v ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<p style="text-align:center">Nenhum estudante nesta situação.</p>`}
    ${tipo !== "simplificada" ? `<div class="note">Devolver preenchido à equipe responsável. As informações serão lançadas como correção no sistema.</div>` : ""}</div>`;
}

// ------------------------------------------------------------------ orcamento
async function orcamento(eid) {
  eid = eid || ultimaEscola();
  const cfg = await api("/api/config");
  $("#view").innerHTML = `<div class="row no-print" style="margin-bottom:14px"><div style="width:340px">${escolaSelect("selEscO", eid)}</div>
    <label style="margin:0">Valor unitário por aluno (R$)</label><input id="preco" type="number" step="0.01" min="0" value="${esc(cfg.preco_unitario)}" style="width:100px">
    <span class="spacer"></span>${eid ? btnXls("orcamento") : ""}<button class="primary" onclick="print()" ${eid ? "" : "disabled"}>Imprimir</button></div><div id="orcDoc"></div>`;
  $("#selEscO").onchange = ev => location.hash = "#/orcamento/" + ev.target.value;
  $("#preco").onchange = async ev => { await api("/api/config", {method: "PUT", body: {preco_unitario: ev.target.value}}); toast("Valor unitário atualizado"); if (eid) render(await api(`/api/escolas/${eid}/orcamento`)); };
  if (!eid) { $("#orcDoc").innerHTML = `<div class="empty">Selecione uma instituição.</div>`; return; }
  lembrarEscola(eid);
  const render = o => {
    XLS.orcamento = () => ({titulo: `Orçamento - ${o.escola.nome}`, subtitulo: `Cód. SMTT ${o.escola.cod_smtt || "—"} · ${o.matriculados} matriculados com CPF · índice ${fmtPct(o.indice)}`,
      colunas: [["Descrição"], ["Valor unitário por aluno", "moeda"], ["Qtd", "numero"], ["Valor", "moeda"]],
      linhas: [["Alunos matriculados com CPF", o.preco_unitario, o.matriculados, o.subtotal], ["Peticionamento", "", 1, o.peticionamento],
        ["Desconto", "", "", -o.desconto], ["Valor total", "", "", o.total]]});
    $("#orcDoc").innerHTML = `<div class="doc"><div class="doc-head"><img src="/api/logo" alt=""><h2>ORÇAMENTO — MIGRAÇÃO DE ESTUDANTES (SMTT)</h2></div>
      <div class="dmeta"><span><b>INSTITUIÇÃO:</b> ${esc(o.escola.nome)}</span><span><b>COD. SMTT:</b> ${esc(o.escola.cod_smtt)}</span><span><b>DATA:</b> ${agora()}</span></div>
      <table><thead><tr><th>Matriculados com CPF</th><th>Alunos migrados</th><th>Não migrados</th><th>Índice de migração</th><th>Valor</th></tr></thead>
      <tbody><tr><td class="num">${fmtN(o.matriculados)}</td><td class="num">${fmtN(o.migrados)}</td><td class="num">${fmtN(o.nao_migrados)}</td><td class="num">${fmtPct(o.indice)}</td><td class="num"><b>${fmtBRL(o.total)}</b></td></tr></tbody></table>
      <br><table><thead><tr><th>Descrição</th><th class="num">Valor unitário por aluno</th><th class="num">Qtd</th><th class="num">Valor</th></tr></thead><tbody>
        <tr><td>Alunos matriculados com CPF <small class="muted">(${fmtN(o.matriculados)} × ${fmtBRL(o.preco_unitario)})</small></td><td class="num">${fmtBRL(o.preco_unitario)}</td><td class="num">${fmtN(o.matriculados)}</td><td class="num">${fmtBRL(o.subtotal)}</td></tr>
        <tr><td>Peticionamento</td><td></td><td class="num">1</td><td class="num">${fmtBRL(o.peticionamento)}</td></tr>
        <tr><td>Desconto</td><td></td><td></td><td class="num">− ${fmtBRL(o.desconto)}</td></tr>
        <tr><td colspan="3"><b>Valor total</b></td><td class="num"><b>${fmtBRL(o.total)}</b></td></tr></tbody></table>
      <div class="note">Somente alunos com CPF cadastrado entram no orçamento.<br>Estudante: vá até a secretaria de sua escola e verifique se seu nome foi encaminhado pela equipe de TI para o banco de dados da SMTT.</div></div>
      <div class="card card-b no-print" style="max-width:960px;margin:14px auto 0"><form id="fOrc" class="row">
        <div><label>Matriculados com CPF informados (vazio = calculado)</label><input name="matriculados_info" type="number" min="0" value="${o.escola.matriculados_info ?? ""}" style="width:180px"></div>
        <div><label>Peticionamento (R$)</label><input name="peticionamento" type="number" step="0.01" min="0" value="${o.peticionamento}" style="width:150px"></div>
        <div><label>Desconto (R$)</label><input name="desconto" type="number" step="0.01" min="0" value="${o.desconto}" style="width:150px"></div>
        <button class="primary" style="align-self:flex-end">Atualizar orçamento</button></form></div>`;
    $("#fOrc").onsubmit = async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      render(await api(`/api/escolas/${eid}/orcamento`, {method: "PUT", body: {matriculados_info: f.matriculados_info ? +f.matriculados_info : null, peticionamento: +f.peticionamento || 0, desconto: +f.desconto || 0}}));
      toast("Orçamento atualizado");
    };
  };
  render(await api(`/api/escolas/${eid}/orcamento`));
}

// ------------------------------------------------------------------ bases / importacao
async function bases() {
  const d = await api("/api/importacoes");
  $("#view").innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Planilha SIS SMPE completa</h2></div><div class="card-b">
      <p class="muted" style="margin-top:0">Importa de uma vez as abas CAD_ESCOLA, GEDUC, CENSO, SMTT e ALUNOS_POR_STATUS do arquivo .xlsm. As bases são substituídas; correções e remessas são mantidas.</p>
      <div class="drop" data-base="planilha"><svg class="i"><use href="#i-upload"/></svg>Arraste o arquivo .xlsm aqui ou <label style="display:inline;color:var(--accent);cursor:pointer">escolha<input type="file" accept=".xlsm,.xlsx" hidden></label></div>
    </div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-bottom:16px">
      ${Object.entries(d.bases).map(([k, b]) => `<div class="card"><div class="card-h"><h2>${esc(b.label)}</h2><span class="spacer"></span><span class="badge b-mute">${fmtN(b.linhas)} linhas</span></div>
        <div class="card-b"><p class="muted" style="margin-top:0">Aba/arquivo: <b>${esc(b.aba)}</b> (.xlsx, .xlsm, .xls ou .csv)</p>
        <div class="drop" data-base="${k}"><svg class="i"><use href="#i-upload"/></svg>Arraste ou <label style="display:inline;color:var(--accent);cursor:pointer">escolha o arquivo<input type="file" accept=".xlsx,.xlsm,.xls,.csv" hidden></label></div></div></div>`).join("")}
    </div>
    <div id="impStatus"></div>
    <div class="card"><div class="card-h"><h2>Histórico de importações</h2><span class="spacer"></span>${btnXls("hist")}</div>
      <div class="table-wrap" style="max-height:none"><table><thead><tr><th>Quando</th><th>Base</th><th>Arquivo</th><th class="num">Linhas</th></tr></thead><tbody id="tbHist"></tbody></table></div><div id="pgHist"></div></div>`;
  XLS.hist = () => ({titulo: "Histórico de importações", colunas: [["Quando", "datahora"], ["Base"], ["Arquivo"], ["Linhas", "numero"]],
    linhas: d.historico.map(h => [h.importado_em, d.bases[h.base]?.label || BASE_ROTULO[h.base] || h.base, h.arquivo, h.linhas])});
  const renderH = () => { const pg = paginar("hist", d.historico, renderH, 10);
    $("#tbHist").innerHTML = pg.itens.map(h => `<tr><td>${fmtDH(h.importado_em)}</td><td>${esc(d.bases[h.base]?.label || BASE_ROTULO[h.base] || h.base)}</td><td>${esc(h.arquivo)}</td><td class="num">${fmtN(h.linhas)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nenhuma importação.</td></tr>`;
    $("#pgHist").innerHTML = pg.html; };
  resetPag("hist"); renderH();
  $$(".drop").forEach(dz => {
    const send = f => f && enviar(dz.dataset.base, f);
    dz.querySelector("input").onchange = ev => send(ev.target.files[0]);
    dz.ondragover = ev => { ev.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = ev => { ev.preventDefault(); dz.classList.remove("over"); send(ev.dataTransfer.files[0]); };
  });
  if (d.status.rodando) acompanhar();
}
let IMP_TIMER = null;
async function enviar(base, file) {
  const st = (await api("/api/importacoes")).status;
  if (st.rodando) { toast("Aguarde: já existe uma importação em andamento"); return acompanhar(); }
  const fd = new FormData(); fd.append("base", base); fd.append("arquivo", file);
  $("#impStatus").innerHTML = `<div class="alert info">Enviando ${esc(file.name)}…</div>`;
  try { await api("/api/importar", {method: "POST", body: fd, semLogin: true}); }
  catch (e) { if (!/em andamento/.test(e.message)) { $("#impStatus").innerHTML = `<div class="alert warn">Falha: ${esc(e.message)}</div>`; return; } }
  acompanhar();
}
const BASE_ROTULO = {planilha: "Planilha completa", escolas: "Cadastro de instituições", geduc: "GEDUC", censo: "Censo escolar", smtt: "SMTT", status_alunos: "Alunos por status", servidores: "Servidores (RH)"};
const fmtSeg = s => s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
function acompanhar() {
  clearInterval(IMP_TIMER);
  const passo = async () => {
    let s;
    try { s = (await api("/api/importacoes", {semLogin: true})).status; }
    catch { if ($("#impStatus")) $("#impStatus").innerHTML = `<div class="alert info">Servidor ocupado com a importação, aguardando resposta…</div>`; return; }
    const box = $("#impStatus");
    if (!box) return clearInterval(IMP_TIMER);  // saiu da tela
    const qual = `${BASE_ROTULO[s.base] || s.base}${s.arquivo ? ` (${esc(s.arquivo)})` : ""}`;
    box.innerHTML = s.rodando
      ? `<div class="alert info"><b>Importando ${qual}</b> · ${esc(s.etapa || "processando")} · ${fmtSeg(s.segundos)}<br><small>Bases grandes, como o GEDUC, podem levar alguns minutos no servidor. Pode continuar usando o sistema.</small>${s.msg.length ? `<br>${s.msg.map(esc).join(" · ")}` : ""}</div>`
      : `<div class="alert ${s.erro ? "warn" : "info"}">${s.erro ? "Falha: " + esc(s.erro) : "Importação concluída. "}${s.msg.map(esc).join(" · ")}</div>`;
    if (!s.rodando) { clearInterval(IMP_TIMER); if (!s.erro) { await loadEscolas(); setTimeout(() => $("#impStatus") && bases(), 2500); } }
  };
  IMP_TIMER = setInterval(passo, 2000); passo();
}

// ------------------------------------------------------------------ busca
async function busca(_, qs) {
  const q = qs.get("q") || "";
  $("#buscaInput").value = q;
  const rs = q ? await api("/api/alunos/busca?q=" + encodeURIComponent(q)) : [];
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>${rs.length ? `${fmtN(rs.length)}${rs.length === 1000 ? "+" : ""} resultado(s) para “${esc(q)}”` : q ? `Estudante não localizado: “${esc(q)}”` : "Digite um nome ou CPF na busca acima"}</h2>${rs.length ? `<span class="spacer"></span>${btnXls("busca")}` : ""}</div>
    ${rs.length ? `<div class="table-wrap" style="max-height:none"><table id="tbB"><thead><tr><th>Aluno</th><th>Nasc.</th><th>Instituição</th><th>Turma</th><th>Mãe</th><th>CPF (GEDUC)</th><th></th></tr></thead><tbody id="tbBBody"></tbody></table></div><div id="pgB"></div>` : ""}</div>`;
  XLS.busca = () => ({titulo: "Localizar estudante", subtitulo: `Busca: ${q}`,
    colunas: [["Aluno"], ["Nascimento", "data"], ["Instituição"], ["Turma"], ["Turno"], ["Mãe"], ["CPF (GEDUC)", "cpf"]],
    linhas: rs.map(r => [r.aluno, r.dt_nasc, r.escola, r.turma, r.turno, r.mae, r.cpf_geduc])});
  const rowB = r => `<tr><td><b>${esc(r.aluno)}</b>${r.manual ? ` <span class="badge b-info">individual</span>` : ""}</td><td>${fmtData(r.dt_nasc)}</td><td>${esc(r.escola)}</td><td>${esc(r.turma)} · ${esc(r.turno)}</td><td>${esc(r.mae)}</td><td class="mono">${fmtCPF(r.cpf_geduc)}</td>
      <td>${r.escola_id ? `<a class="btn btn-sm" href="#/migracao/${r.escola_id}">Abrir instituição</a>` : `<button class="btn-sm" data-id="${esc(r.id_aluno)}">Detalhes</button>`}</td></tr>`;
  const renderB = () => { const pg = paginar("busca", rs, renderB); if ($("#tbBBody")) { $("#tbBBody").innerHTML = pg.itens.map(rowB).join(""); $("#pgB").innerHTML = pg.html; } };
  resetPag("busca"); renderB();
  const tb = $("#tbB"); if (tb) tb.onclick = ev => { const id = ev.target.dataset.id; if (id) { MIG = null; abrirAluno(id); } };
}

// ------------------------------------------------------------------ configuracoes (admin)
async function config() {
  const cfg = await api("/api/config");
  $("#view").innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));align-items:start">
    <div class="card"><div class="card-h"><h2>Identidade visual</h2></div><div class="card-b">
      <div style="background:var(--soft);border:1px solid var(--line);border-radius:var(--radius-sm);padding:18px;text-align:center;margin-bottom:14px">
        <img class="logo-img" src="/api/logo?t=${Date.now()}" alt="Logo atual" style="max-width:240px;max-height:90px"></div>
      <form id="fLogo" class="row"><input type="file" name="arquivo" accept="image/png,image/jpeg,image/svg+xml,image/webp" required style="flex:1 1 100%">
        <button class="primary">Enviar nova logo</button><button type="button" id="logoPadrao">Restaurar padrão</button></form>
      <p class="muted" style="margin-bottom:0">PNG, JPG, SVG ou WEBP, até 2 MB. Usada no menu, na tela de login, nos relatórios e no orçamento.</p></div></div>
    <div class="card"><div class="card-h"><h2>Suporte</h2></div><form id="fSup" class="card-b form">
      <div class="full"><label>WhatsApp do suporte (com DDD)</label><input name="whatsapp" value="${esc(cfg.whatsapp || "")}" placeholder="(98) 99999-9999"></div>
      <div class="full"><label>Texto da opção Suporte</label><textarea name="suporte_texto" rows="4" placeholder="Horário de atendimento, e-mail, telefone…">${esc(cfg.suporte_texto || "")}</textarea></div>
      <div class="full"><button class="primary">Salvar suporte</button></div></form></div>
    <div class="card"><div class="card-h"><h2>Orçamento</h2></div><form id="fPreco" class="card-b row" style="align-items:flex-end">
      <div><label>Valor unitário por aluno com CPF (R$)</label><input name="preco_unitario" type="number" step="0.01" min="0" value="${esc(cfg.preco_unitario)}" style="width:180px"></div>
      <button class="primary">Salvar</button></form></div></div>`;
  $("#fLogo").onsubmit = async ev => {
    ev.preventDefault();
    await api("/api/logo", {method: "PUT", body: new FormData(ev.target)}); toast("Logo atualizada"); refreshLogo(); ev.target.reset();
  };
  $("#logoPadrao").onclick = async () => { await api("/api/logo", {method: "DELETE"}); toast("Logo padrão restaurada"); refreshLogo(); };
  $("#fSup").onsubmit = async ev => {
    ev.preventDefault();
    await api("/api/config", {method: "PUT", body: Object.fromEntries(new FormData(ev.target))});
    PUBLICO = await api("/api/publico"); aplicarPublico(); toast("Suporte salvo");
  };
  $("#fPreco").onsubmit = async ev => { ev.preventDefault(); await api("/api/config", {method: "PUT", body: Object.fromEntries(new FormData(ev.target))}); toast("Preço salvo"); };
}

// ------------------------------------------------------------------ usuarios (admin)
async function usuarios() {
  const [us] = [await api("/api/usuarios"), await loadEscolas()];
  const nomes = Object.fromEntries(ESCOLAS.map(e => [e.id, e.nome]));
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>${us.length} usuário(s)</h2><span class="spacer"></span>
      <input id="fU" placeholder="Filtrar e-mail ou instituição…" style="width:260px">${btnXls("usuarios")}<button class="primary" id="novoU">Novo usuário</button></div>
    <div class="table-wrap" style="max-height:none"><table id="tbU"><thead><tr><th>Usuário (e-mail)</th><th>Perfil</th><th>Instituições</th><th>Criado em</th><th></th></tr></thead>
    <tbody id="tbUBody"></tbody></table></div><div id="pgU"></div></div>`;
  const rowU = x => `<tr><td><b>${esc(fmtLogin(x.login))}</b>${x.login === SESSAO.login ? ` <span class="badge b-info">você</span>` : ""}</td>
      <td>${x.perfil === "admin" ? `<span class="badge b-info">Administrador</span>` : x.perfil === "rh" ? `<span class="badge b-ok">RH (servidores)</span>` : `<span class="badge b-mute">Instituição</span>`}</td>
      <td>${x.perfil === "admin" ? `<span class="muted">todas</span>` : x.perfil === "rh" ? `<span class="muted">—</span>` : x.escolas.map(id => `<div>${esc(nomes[id] || "#" + id)}${ESCOLAS.find(e => e.id === id)?.bloqueado ? ` <span class="badge b-err">bloqueada</span>` : ""}</div>`).join("")}</td>
      <td>${fmtDH(x.criado_em)}</td><td class="acoes"><button class="btn-sm" data-u="${x.id}">Editar</button></td></tr>`;
  const filtrados = () => {
    const q = $("#fU").value.toLowerCase(), qd = q.replace(/\D/g, "");
    return us.filter(x => x.login.includes(q) || (qd && x.login.includes(qd)) || x.escolas.some(id => (nomes[id] || "").toLowerCase().includes(q)));
  };
  XLS.usuarios = () => ({titulo: "Usuários", subtitulo: $("#fU").value && `Filtro: ${$("#fU").value}`,
    colunas: [["Usuário (e-mail)"], ["Perfil"], ["Instituições"], ["Criado em", "datahora"]],
    linhas: filtrados().map(x => [fmtLogin(x.login), PERFIS[x.perfil] || x.perfil,
      x.perfil === "admin" ? "Todas" : x.perfil === "rh" ? "" : x.escolas.map(id => nomes[id] || "#" + id).join("\n"), x.criado_em])});
  const renderU = () => {
    const pg = paginar("usuarios", filtrados(), renderU);
    $("#tbUBody").innerHTML = pg.itens.map(rowU).join("") || `<tr><td colspan="5" class="empty">Nenhum usuário encontrado.</td></tr>`;
    $("#pgU").innerHTML = pg.html;
  };
  $("#fU").oninput = () => { resetPag("usuarios"); renderU(); };
  renderU();
  $("#novoU").onclick = () => editarUsuario(null);
  $("#tbU").onclick = ev => { const b = ev.target.closest("[data-u]"); if (b) editarUsuario(us.find(x => x.id === +b.dataset.u)); };
}
const PERFIS = {admin: "Administrador", instituicao: "Instituição", rh: "RH (servidores)"};
function editarUsuario(x) {
  const novo = !x; x = x || {login: "", perfil: "instituicao", escolas: []};
  const proprio = x.login === SESSAO.login;
  modal(`<div class="mh"><h2>${novo ? "Novo usuário" : "Editar usuário"}</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <form id="fUsr"><div class="mb form">
      <div><label>E-mail (usuário)</label><input name="login" required value="${esc(x.login)}" autocomplete="off" inputmode="email" placeholder="nome@exemplo.com"></div>
      <div><label>${novo ? "Senha (mín. 6 caracteres)" : "Nova senha (vazio = manter a atual)"}</label><input name="senha" type="password" ${novo ? "required" : ""} minlength="6" autocomplete="new-password"></div>
      <div class="full"><label>Perfil</label><select name="perfil" ${proprio ? "disabled" : ""}>
        <option value="instituicao" ${x.perfil === "instituicao" ? "selected" : ""}>Instituição: acessa só as instituições vinculadas, sem cadastrar instituições nem gerar orçamentos</option>
        <option value="rh" ${x.perfil === "rh" ? "selected" : ""}>RH da SEMED: só o módulo Servidores (cadastro, frequência, declarações e aniversariantes)</option>
        <option value="admin" ${x.perfil === "admin" ? "selected" : ""}>Administrador: acesso total</option></select></div>
      <div class="full" id="boxEsc"><label>Instituições vinculadas <span id="nSel" class="muted"></span></label>
        <input id="fEscU" placeholder="Filtrar instituição…" style="margin-bottom:8px">
        <div class="chk-list">${ESCOLAS.map(e => `<label data-n="${esc(e.nome.toLowerCase())}"><input type="checkbox" name="escolas" value="${e.id}" ${x.escolas.includes(e.id) ? "checked" : ""}>
          ${e.id} · ${esc(e.nome)}${e.bloqueado ? ` <span class="badge b-err">bloqueada</span>` : ""}</label>`).join("") || `<span class="muted">Nenhuma instituição cadastrada.</span>`}</div>
        <small class="muted">Com mais de uma, o usuário troca a instituição ativa pelo menu no canto superior direito.</small></div>
    </div>
    <div class="mf">${!novo && !proprio ? `<button type="button" class="danger" id="delU">Excluir</button><span class="spacer"></span>` : ""}<button type="button" onclick="closeModal()">Cancelar</button><button class="primary">Salvar</button></div></form>`);
  const f = $("#fUsr");
  const upd = () => { $("#boxEsc").hidden = f.perfil.value !== "instituicao"; $("#nSel").textContent = `(${$$("[name=escolas]:checked", f).length} selecionada(s))`; };
  f.perfil.onchange = upd; f.onchange = upd; upd();
  $("#fEscU").oninput = ev => { const q = ev.target.value.toLowerCase(); $$(".chk-list label", f).forEach(l => l.hidden = !l.dataset.n.includes(q)); };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const body = {login: f.login.value, senha: f.senha.value, perfil: proprio ? "admin" : f.perfil.value,
      escolas: $$("[name=escolas]:checked", f).map(c => +c.value)};
    if (novo) await api("/api/usuarios", {method: "POST", body}); else await api(`/api/usuarios/${x.id}`, {method: "PUT", body});
    closeModal(); toast("Usuário salvo"); usuarios();
  };
  const del = $("#delU");
  if (del) del.onclick = async () => { if (confirm(`Excluir o usuário ${fmtLogin(x.login)}?`)) { await api(`/api/usuarios/${x.id}`, {method: "DELETE"}); closeModal(); toast("Usuário excluído"); usuarios(); } };
}

// ------------------------------------------------------------------ servidores (RH da SEMED)
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
let SRV = null;  // {servidores, opcoes, ultima_importacao}
async function loadServidores() { SRV = await api("/api/servidores"); return SRV; }
// baixa o PDF gerado pela API (GET ou POST com corpo)
async function baixarPdf(url, body, botao) {
  if (botao) botao.disabled = true;
  try {
    const r = await api(url, body ? {method: "POST", body} : {});
    const nome = (r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "documento.pdf";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob()); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } finally { if (botao) botao.disabled = false; }
}
const opts = (lista, sel, vazio = "") => `${vazio ? `<option value="">${vazio}</option>` : ""}${lista.map(v => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("")}`;
// filtros comuns das telas do RH: busca, lotacao, quadro, turno, setor e status
const FILTRO_SRV = [["lotacao", "Todas as instituições"], ["quadro", "Todos os quadros"], ["turno", "Todos os turnos"], ["setor", "Todos os setores"], ["status", "Todos os status"]];
function filtrosSrv(st) {
  return `<input data-f="q" placeholder="Nome, matrícula ou CPF…" value="${esc(st.q || "")}" style="max-width:240px">` +
    FILTRO_SRV.filter(([k]) => k !== "lotacao" || !SRV.instituicao).map(([k, l]) =>
      `<select data-f="${k}" style="max-width:${k === "lotacao" ? 300 : 220}px" title="${k === "lotacao" ? "Instituição" : ""}">${opts(SRV.opcoes[k], st[k], l)}</select>`).join("");
}
function ligarFiltros(box, st, render) {
  $$("[data-f]", box).forEach(el => el[el.tagName === "INPUT" ? "oninput" : "onchange"] = () => { st[el.dataset.f] = el.value.trim(); render(); });
}
function filtrar(lista, st) {
  const q = (st.q || "").toUpperCase(), qd = q.replace(/\D/g, "");
  return lista.filter(s => FILTRO_SRV.every(([k]) => !st[k] || s[k] === st[k]) &&
    (!q || s.nome.includes(q) || (qd && (s.matricula.includes(qd) || s.cpf.includes(qd)))));
}
const filtroTxt = st => [st.q && `Busca: ${st.q}`, ...FILTRO_SRV.map(([k]) => st[k])].filter(Boolean).join(" · ");
const pendSrv = s => [!s.lotacao && "sem lotação", !s.turno && "sem turno", !s.quadro && "sem quadro", !s.matricula && "sem matrícula", !s.dt_nasc && "sem nascimento"].filter(Boolean);

const ST_SRV = {status: "ATIVO"};
async function servidores() {
  await loadServidores();
  const l = SRV.servidores, ult = SRV.ultima_importacao;
  const n = (f) => l.filter(f).length;
  $("#view").innerHTML = `
    ${!l.length ? `<div class="alert warn">Nenhum servidor cadastrado. Importe a exportação de funcionários do GEDUC ou a planilha <b>SGI Servidor.xlsm</b> abaixo.</div>` : ""}
    <div class="grid kpis k4">
      <div class="kpi hero"><div class="l">Servidores</div><div class="v">${fmtN(l.length)}</div><div class="s">${fmtN(n(s => s.status === "ATIVO"))} ativos</div></div>
      <div class="kpi"><div class="l">Magistério</div><div class="v">${fmtN(n(s => s.quadro === "MAGISTÉRIO"))}</div></div>
      <div class="kpi"><div class="l">Técnico/administrativo</div><div class="v">${fmtN(n(s => s.quadro === "TÉCNICO/ADMINISTRATIVO"))}</div></div>
      <div class="kpi warn"><div class="l">Com dados a completar</div><div class="v">${fmtN(n(s => pendSrv(s).length))}</div><div class="s">lotação, turno, quadro…</div></div>
    </div>
    ${SRV.instituicao ? "" : `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Importar base</h2><span class="spacer"></span>
      ${ult ? `<span class="muted">Última: ${esc(ult.arquivo)} · ${fmtN(ult.linhas)} linhas · ${fmtDH(ult.importado_em)}</span>` : ""}</div>
      <div class="card-b"><p class="muted" style="margin-top:0">Exportação de funcionários do GEDUC (.csv, .xls ou .xlsx) ou a planilha SGI Servidor.xlsm (aba CADASTRO).
        O cadastro é atualizado pela matrícula: quem já existe tem os dados do GEDUC atualizados, sem perder o que o RH completou (turno, quadro, status, atuação…). Ninguém é apagado.</p>
      <div class="drop" id="dropSrv"><svg class="i"><use href="#i-upload"/></svg>Arraste o arquivo aqui ou <label style="display:inline;color:var(--accent);cursor:pointer">escolha<input type="file" accept=".xlsx,.xlsm,.xls,.csv" hidden></label></div>
      <div id="impSrv"></div></div></div>`}
    <div class="card"><div class="card-h" id="fSrv">${filtrosSrv(ST_SRV)}<span class="spacer"></span><button id="turnosSrv" title="Ação única: grava o turno informado na aba CADASTRO da planilha SGI Servidor para os servidores da instituição">Carregar turnos da planilha</button><input type="file" id="turnosArq" accept=".xlsx,.xlsm" hidden>${btnXls("servidores")}<button class="primary" id="novoSrv">Novo servidor</button></div>
      <div class="table-wrap" style="max-height:none"><table id="tbS"><thead><tr><th>Servidor</th><th>Matrícula</th><th>Cargo / função</th><th>Lotação</th><th>Turno</th><th>Quadro</th><th>Status</th><th></th></tr></thead>
      <tbody id="tbSBody"></tbody></table></div><div id="pgS"></div></div>`;
  const dz = $("#dropSrv"), envia = async f => {
    if (!f) return;
    const fd = new FormData(); fd.append("arquivo", f);
    $("#impSrv").innerHTML = `<div class="alert info" style="margin-top:12px">Importando ${esc(f.name)}…</div>`;
    try {
      const r = await api("/api/servidores/importar", {method: "POST", body: fd, semLogin: true});
      toast(`Importados ${fmtN(r.lidos)}: ${fmtN(r.novos)} novo(s), ${fmtN(r.atualizados)} atualizado(s)`);
      servidores();
    } catch (e) { $("#impSrv").innerHTML = `<div class="alert warn" style="margin-top:12px">Falha: ${esc(e.message)}</div>`; }
  };
  if (dz) {
    dz.querySelector("input").onchange = ev => envia(ev.target.files[0]);
    dz.ondragover = ev => { ev.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = ev => { ev.preventDefault(); dz.classList.remove("over"); envia(ev.dataTransfer.files[0]); };
  }
  // acao unica: turno da aba CADASTRO para os servidores da instituicao (a do usuario ou a escolhida no filtro)
  $("#turnosSrv").onclick = () => {
    const inst = SRV.instituicao || ST_SRV.lotacao;
    if (!inst) return toast("Escolha a instituição no filtro para carregar os turnos");
    if (!confirm(`Gravar o turno da planilha (aba CADASTRO) para os servidores de ${inst}? O turno atual deles será substituído.`)) return;
    $("#turnosArq").value = ""; $("#turnosArq").click();
  };
  $("#turnosArq").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append("arquivo", f); fd.append("lotacao", ST_SRV.lotacao || "");
    const b = $("#turnosSrv"); b.disabled = true; b.textContent = "Carregando turnos…";
    try {
      const r = await api("/api/servidores/turnos", {method: "POST", body: fd});
      await servidores();
      modal(`<div class="mh"><h2>Turnos carregados</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
        <div class="mb"><p><b>${fmtN(r.atualizados)}</b> servidor(es) com o turno gravado e <b>${fmtN(r.iguais)}</b> que já estavam com o turno da planilha, de ${fmtN(r.no_arquivo)} com turno na aba CADASTRO.</p>
        ${r.nao_encontrados.length ? `<div class="alert warn">${fmtN(r.nao_encontrados.length)} da planilha não estão no cadastro (importe a planilha para incluí-los):<br>${r.nao_encontrados.map(esc).join("<br>")}</div>` : ""}</div>`);
    } catch { b.disabled = false; b.textContent = "Carregar turnos da planilha"; }
  };
  const row = s => `<tr class="click" data-id="${s.id}"><td><b>${esc(s.nome)}</b>${pendSrv(s).map(p => ` <span class="badge b-warn">${p}</span>`).join("")}<div class="muted">${esc(s.setor)}</div></td>
      <td class="mono">${esc(s.matricula) || "—"}</td><td>${esc(s.cargo)}${s.funcao && s.funcao !== s.cargo ? `<div class="muted">${esc(s.funcao)}</div>` : ""}</td>
      <td>${esc(s.lotacao) || "—"}</td><td>${esc(s.turno) || "—"}</td><td>${esc(s.quadro) || "—"}</td>
      <td>${s.status === "INATIVO" ? `<span class="badge b-mute">inativo</span>` : `<span class="badge b-ok">ativo</span>`}</td>
      <td class="acoes"><div class="row"><button class="btn-sm" data-edit="${s.id}" title="Editar os dados do servidor">Editar</button>
        <button class="btn-dl btn-sm" data-decl="${s.id}" title="Declaração de efetivo exercício e endereço profissional">${icDl}Declaração</button>
        <button class="btn-dl btn-sm" data-freq="${s.id}" title="Folha de frequência do mês atual">${icDl}Frequência</button></div></td></tr>`;
  const lista = () => filtrar(l, ST_SRV);
  XLS.servidores = () => ({titulo: "Servidores", subtitulo: filtroTxt(ST_SRV),
    colunas: [["Nome"], ["CPF", "cpf"], ["Sexo"], ["Nascimento", "data"], ["Matrícula"], ["Cargo"], ["Função"], ["Lotação"], ["Setor"], ["Turno"], ["Quadro"],
      ["Regime de contratação"], ["Regime jurídico"], ["Situação funcional"], ["Carga horária"], ["Horas semanais"], ["Admissão", "data"], ["Status"],
      ["Tipo de ensino"], ["Atuação"], ["Componente curricular"], ["Formação"], ["Habilitação"]],
    linhas: lista().map(s => [s.nome, s.cpf, s.sexo, s.dt_nasc, s.matricula, s.cargo, s.funcao, s.lotacao, s.setor, s.turno, s.quadro,
      s.regime_contratacao, s.regime_juridico, s.situacao_funcional, s.carga_horaria, s.horas_semanais, s.dt_admissao, s.status,
      s.tipo_ensino, s.atuacao, s.componente, s.formacao, s.habilitacao])});
  const render = () => {
    const pg = paginar("servidores", lista(), render);
    $("#tbSBody").innerHTML = pg.itens.map(row).join("") || `<tr><td colspan="8" class="empty">Nenhum servidor encontrado.</td></tr>`;
    $("#pgS").innerHTML = pg.html;
  };
  ligarFiltros($("#fSrv"), ST_SRV, () => { resetPag("servidores"); render(); });
  render();
  $("#novoSrv").onclick = () => editarServidor(null);
  $("#tbS").onclick = ev => {
    const b = ev.target.closest("button");
    if (b?.dataset.decl) return declaracao(l.find(s => s.id === +b.dataset.decl));
    if (b?.dataset.freq) { const h = new Date(); return baixarPdf("/api/servidores/frequencia", {ano: h.getFullYear(), mes: h.getMonth() + 1, ids: [+b.dataset.freq]}, b); }
    const tr = ev.target.closest("tr[data-id]"); if (tr) editarServidor(l.find(s => s.id === +tr.dataset.id));
  };
}
// declaracao: como na aba DECLARACAO, pede tipo de ensino, atuacao e disciplina(s) (ja vem o que esta no cadastro)
function declaracao(s) {
  const lista = (k, v) => `<select name="${k}">${opts([...new Set([...SRV.opcoes[k], v].filter(Boolean))], v, "—")}</select>`;
  modal(`<div class="mh"><h2>Declaração</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <form class="mb form" id="fDecl"><div class="full"><b>${esc(s.nome)}</b><div class="muted">Matrícula ${esc(s.matricula) || "—"} · ${esc(s.lotacao) || "sem lotação"} · ${esc(s.turno) || "sem turno"}</div></div>
      <div class="full"><label>Tipo de ensino</label>${lista("tipo_ensino", s.tipo_ensino)}</div>
      <div class="full"><label>Atuação</label>${lista("atuacao", s.atuacao)}</div>
      <div class="full"><label>Disciplina(s)</label><input name="componente" value="${esc(s.componente)}" placeholder="Ex.: História/Geografia"></div>
      <div class="full muted">Ficam gravados no cadastro do servidor. Para quem não é docente, deixe em branco.</div>
      <div class="full row"><span class="spacer"></span><button class="primary">${icDl}Gerar declaração</button></div></form>`);
  $("#fDecl").onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target));
    await baixarPdf(`/api/servidores/${s.id}/declaracao`, body, ev.submitter);
    Object.assign(s, body); closeModal();
  };
}
const CAMPOS_SRV = [
  ["Identificação"], ["nome", "Nome do servidor", "text", "full"], ["cpf", "CPF", "cpf"], ["matricula", "Matrícula"], ["sexo", "Sexo", ["MASCULINO", "FEMININO"]],
  ["dt_nasc", "Data de nascimento", "date"],
  ["Lotação"], ["lotacao", "Lotação (escola / unidade)", "lista", "full"], ["setor", "Setor", "lista"], ["turno", "Turno", "turno"],
  ["quadro", "Quadro", "quadro"], ["status", "Status", "status"],
  ["Cargo e vínculo"], ["cargo", "Cargo", "lista"], ["funcao", "Função", "lista"], ["regime_contratacao", "Regime de contratação", "lista"],
  ["regime_juridico", "Regime jurídico", "lista"], ["situacao_funcional", "Situação funcional", "lista"], ["carga_horaria", "Carga horária (GEDUC)"],
  ["horas_semanais", "Horas semanais (declaração)"], ["dt_admissao", "Data de exercício (admissão)", "date"], ["orgao", "Órgão"],
  ["Docência (sai na declaração)"], ["tipo_ensino", "Tipo de ensino", "lista"], ["atuacao", "Atuação", "lista"],
  ["componente", "Disciplina(s)", "text", "full"], ["Formação"], ["formacao", "Formação (graduação)"], ["habilitacao", "Habilitação (curso)"],
];
function editarServidor(s) {
  const novo = !s; s = s || {status: "ATIVO", orgao: "SEMED"};
  const campo = ([k, l, t = "text", cls = ""]) => {
    if (!l) return `<h3 class="full" style="margin:8px 0 0">${k}</h3>`;
    const v = s[k] || "";
    const sel = lista => `<select name="${k}">${opts([...new Set([...lista, v].filter(Boolean))], v, "—")}</select>`;
    const ctl = k === "lotacao" && SRV.instituicao ? `<input name="${k}" value="${esc(v || SRV.opcoes.lotacao[0] || "")}" readonly>`
      : Array.isArray(t) ? sel(t) : t === "turno" || t === "quadro" || t === "status" ? sel(SRV.opcoes[t])
      : t === "lista" ? `<input name="${k}" list="dl_${k}" value="${esc(v)}" autocomplete="off"><datalist id="dl_${k}">${(SRV.opcoes[k] || []).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`
      : `<input name="${k}" type="${t === "date" ? "date" : "text"}" value="${esc(t === "cpf" ? fmtCPF(v) : v)}">`;
    return `<div class="${cls}"><label>${l}</label>${ctl}</div>`;
  };
  drawer(`<div class="dh"><div style="flex:1"><h2>${novo ? "Novo servidor" : esc(s.nome)}</h2>
      <div class="muted">${novo ? "Cadastro feito pelo RH" : `Matrícula ${esc(s.matricula) || "—"} · atualizado em ${fmtDH(s.atualizado_em)}`}</div>
      ${novo ? "" : `<div style="margin-top:6px">${pendSrv(s).map(p => `<span class="badge b-warn">${p}</span>`).join("")}</div>`}</div>
      <button onclick="closeDrawer()">Fechar</button></div>
    <div class="db">
      ${novo ? "" : `<div class="row" style="margin-bottom:12px"><button class="btn-dl" id="sDecl" type="button">${icDl}Declaração</button>
        <select id="sMes" style="width:auto">${MESES.map((m, i) => `<option value="${i + 1}" ${i === new Date().getMonth() ? "selected" : ""}>${m}</option>`).join("")}</select>
        <input id="sAno" type="number" value="${new Date().getFullYear()}" style="width:90px"><button class="btn-dl" id="sFreq">${icDl}Folha de frequência</button></div>`}
      <form id="fSrvEd" class="form">${CAMPOS_SRV.map(campo).join("")}
        <div class="full row"><button class="primary">Salvar</button>${novo || SRV.instituicao ? "" : `<span class="spacer"></span><button type="button" class="danger" id="sExc">Excluir</button>`}</div></form></div>`);
  const f = $("#fSrvEd");
  f.nome.required = true;
  f.onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    if (novo) await api("/api/servidores", {method: "POST", body}); else await api(`/api/servidores/${s.id}`, {method: "PUT", body});
    toast("Servidor salvo"); closeDrawer(); servidores();
  };
  if (novo) return;
  $("#sDecl").onclick = () => declaracao(s);
  $("#sFreq").onclick = ev => baixarPdf("/api/servidores/frequencia", {ano: +$("#sAno").value, mes: +$("#sMes").value, ids: [s.id]}, ev.currentTarget);
  if ($("#sExc")) $("#sExc").onclick = async () => {
    if (!confirm(`Excluir ${s.nome} do cadastro de servidores?`)) return;
    await api(`/api/servidores/${s.id}`, {method: "DELETE"}); toast("Servidor excluído"); closeDrawer(); servidores();
  };
}

const ST_FREQ = {status: "ATIVO", mes: new Date().getMonth() + 1, ano: new Date().getFullYear()};
async function frequencia() {
  await loadServidores();
  const st = ST_FREQ;
  $("#view").innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-b row">
      <div><label>Mês</label><select id="fMes">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === st.mes ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      <div><label>Ano</label><input id="fAno" type="number" value="${st.ano}" style="width:100px"></div>
      <div id="ferMes" style="flex:1;min-width:260px"></div></div></div>
    <div class="card"><div class="card-h" id="fFreq">${filtrosSrv(st)}</div>
      <div class="card-h"><span class="muted" id="selFreq"></span><span class="spacer"></span><button class="primary" id="gerarFreq">Gerar folhas em PDF</button></div>
      <div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="chkFreq" style="width:auto" checked title="Marcar/desmarcar todos do filtro"></th><th>Servidor</th><th>Matrícula</th><th>Cargo</th><th>Lotação</th><th>Turno</th></tr></thead>
      <tbody id="tbF"></tbody></table></div><div id="pgF"></div></div>`;
  const fora = new Set();  // desmarcados (por padrao todos do filtro vao no PDF)
  const lista = () => filtrar(SRV.servidores, st), marcados = () => lista().filter(s => !fora.has(s.id));
  const render = () => {
    const pg = paginar("freq", lista(), render, 50);
    $("#tbF").innerHTML = pg.itens.map(s => `<tr><td><input type="checkbox" value="${s.id}" ${fora.has(s.id) ? "" : "checked"} style="width:auto"></td>
      <td><b>${esc(s.nome)}</b>${!s.turno ? ` <span class="badge b-warn">sem turno</span>` : ""}</td><td class="mono">${esc(s.matricula)}</td><td>${esc(s.cargo)}</td><td>${esc(s.lotacao)}</td><td>${esc(s.turno)}</td></tr>`).join("")
      || `<tr><td colspan="6" class="empty">Nenhum servidor no filtro.</td></tr>`;
    $("#pgF").innerHTML = pg.html;
    $("#selFreq").textContent = `${fmtN(marcados().length)} folha(s) de ${MESES[st.mes - 1].toLowerCase()} de ${st.ano}: uma página por servidor, em ordem de lotação e nome`;
  };
  const feriadosMes = async () => {
    const ano = await api(`/api/feriados?ano=${st.ano}`), fs = ano.filter(f => +f.data.slice(5, 7) === st.mes);
    $("#ferMes").innerHTML = !ano.length ? `<div class="alert warn" style="margin:0">Nenhum feriado cadastrado em ${st.ano}. ${SRV.instituicao ? "Peça ao RH da SEMED para cadastrar os feriados" : `<a href="#/feriados?ano=${st.ano}">Cadastre os feriados</a>`} para marcá-los na folha.</div>`
      : `<label>Feriados e pontos facultativos do mês</label><div>${fs.map(f => `<span class="badge b-err">${fmtData(f.data).slice(0, 5)} · ${esc(f.descricao)}</span>`).join(" ") || `<span class="muted">nenhum</span>`}
        ${SRV.instituicao ? "" : `<a class="btn-sm btn" href="#/feriados?ano=${st.ano}" style="margin-left:6px">Editar feriados</a>`}</div>`;
  };
  ligarFiltros($("#fFreq"), st, () => { resetPag("freq"); render(); });
  $("#fMes").onchange = ev => { st.mes = +ev.target.value; render(); feriadosMes(); };
  $("#fAno").onchange = ev => { st.ano = +ev.target.value; render(); feriadosMes(); };
  $("#tbF").onchange = ev => { const id = +ev.target.value; ev.target.checked ? fora.delete(id) : fora.add(id); render(); };
  $("#chkFreq").onchange = ev => { lista().forEach(s => ev.target.checked ? fora.delete(s.id) : fora.add(s.id)); render(); };
  $("#gerarFreq").onclick = ev => {
    const ids = marcados().map(s => s.id);
    if (!ids.length) return toast("Nenhum servidor selecionado");
    baixarPdf("/api/servidores/frequencia", {ano: st.ano, mes: st.mes, ids}, ev.currentTarget);
  };
  render(); feriadosMes();
}

const ST_ANIV = {status: "ATIVO", mes: new Date().getMonth() + 1};
async function aniversariantes() {
  await loadServidores();
  const st = ST_ANIV, hoje = new Date();
  $("#view").innerHTML = `<div class="card"><div class="card-h" id="fAniv">
      <select id="aMes" style="max-width:160px">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === st.mes ? "selected" : ""}>${m}</option>`).join("")}</select>
      ${filtrosSrv(st)}</div>
    <div class="card-h"><span class="muted" id="nAniv"></span><span class="spacer"></span>
      <label class="row" style="margin:0;gap:6px" title="Etiquetas já usadas no início da primeira folha">Pular <input id="aPular" type="number" min="0" max="13" value="0" style="width:64px"> etiqueta(s)</label>
      <label class="row" style="margin:0;gap:6px"><input type="checkbox" id="aGuias" style="width:auto">contorno (papel comum)</label>
      ${btnXls("aniv")}<button class="primary" id="aEtq">${icDl}Etiquetas em PDF</button></div>
    <div class="table-wrap" style="max-height:none"><table><thead><tr><th>Dia</th><th>Servidor</th><th>Na etiqueta</th><th>Cargo / função</th><th>Lotação</th><th class="num">Idade</th></tr></thead>
    <tbody id="tbA"></tbody></table></div>
    <div class="card-b muted">Etiquetas A4 com 14 por folha (99 × 38,1 mm, como a Pimaco A4363/6182), na ordem do dia do aniversário.</div></div>`;
  const abrev = n => { const out = []; for (const p of n.split(/\s+/)) { out.push(p); if (out.filter(x => !["DA", "DE", "DO", "DAS", "DOS", "E", "D"].includes(x)).length === 2) break; }
    return out.map(x => ["DA", "DE", "DO", "DAS", "DOS", "E", "D"].includes(x) ? x.toLowerCase() : x[0] + x.slice(1).toLowerCase()).join(" "); };
  const idade = d => hoje.getFullYear() - +d.slice(0, 4);
  const lista = () => filtrar(SRV.servidores, st).filter(s => +s.dt_nasc.slice(5, 7) === st.mes).sort((a, b) => a.dt_nasc.slice(8, 10).localeCompare(b.dt_nasc.slice(8, 10)) || a.nome.localeCompare(b.nome));
  XLS.aniv = () => ({titulo: `Aniversariantes de ${MESES[st.mes - 1]}`, subtitulo: filtroTxt(st),
    colunas: [["Dia", "numero"], ["Servidor"], ["Na etiqueta"], ["Cargo"], ["Função"], ["Lotação"], ["Nascimento", "data"], ["Idade que completa", "numero"]],
    linhas: lista().map(s => [+s.dt_nasc.slice(8, 10), s.nome, abrev(s.nome), s.cargo, s.funcao, s.lotacao, s.dt_nasc, idade(s.dt_nasc)])});
  const render = () => {
    const l = lista();
    $("#nAniv").textContent = `${fmtN(l.length)} aniversariante(s) em ${MESES[st.mes - 1].toLowerCase()}`;
    $("#tbA").innerHTML = l.map(s => `<tr><td><b>${s.dt_nasc.slice(8, 10)}/${s.dt_nasc.slice(5, 7)}</b></td><td>${esc(s.nome)}</td><td>${esc(abrev(s.nome))}</td>
      <td>${esc(s.funcao || s.cargo)}</td><td>${esc(s.lotacao)}</td><td class="num">${idade(s.dt_nasc)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Nenhum aniversariante no filtro.</td></tr>`;
  };
  const semData = SRV.servidores.filter(s => !s.dt_nasc).length;
  if (semData) $("#nAniv").title = `${semData} servidor(es) sem data de nascimento não aparecem aqui`;
  ligarFiltros($("#fAniv"), st, render);
  $("#aMes").onchange = ev => { st.mes = +ev.target.value; render(); };
  $("#aEtq").onclick = ev => {
    const ids = lista().map(s => s.id);
    if (!ids.length) return toast("Nenhum aniversariante no filtro");
    baixarPdf("/api/servidores/etiquetas", {ids, pular: +$("#aPular").value || 0, guias: $("#aGuias").checked}, ev.currentTarget);
  };
  render();
}

async function feriados(_, qs) {
  const ano = +(qs.get("ano") || new Date().getFullYear());
  const fs = await api(`/api/feriados?ano=${ano}`);
  $("#view").innerHTML = `<div class="card"><div class="card-h">
      <label class="row" style="margin:0;gap:6px">Ano <input id="fdAno" type="number" value="${ano}" style="width:100px"></label>
      <span class="muted">${fmtN(fs.length)} data(s)</span><span class="spacer"></span>
      <button id="fdPadrao" title="Inclui os feriados nacionais, do Maranhão e de São Luís (as datas já cadastradas não mudam)">Incluir feriados padrão de ${ano}</button>${btnXls("feriados")}</div>
    <form class="card-h" id="fdNovo" style="flex-wrap:wrap">
      <input name="data" type="date" required style="width:170px" min="${ano}-01-01" max="${ano}-12-31">
      <input name="tipo" value="Feriado" list="dlTipo" style="width:180px" title="Sai na coluna Rubrica da entrada"><datalist id="dlTipo"><option>Feriado</option><option>Ponto facultativo</option><option>Recesso</option></datalist>
      <input name="descricao" placeholder="Descrição (ex.: Natal)" required style="flex:1;min-width:220px" maxlength="60">
      <button class="primary">Adicionar</button></form>
    <div class="table-wrap" style="max-height:none"><table id="tbFd"><thead><tr><th>Data</th><th>Dia da semana</th><th>Tipo (rubrica da entrada)</th><th>Descrição (rubrica da saída)</th><th></th></tr></thead><tbody>
      ${fs.map(f => `<tr><td>${fmtData(f.data)}</td><td>${SEMANA[new Date(f.data + "T12:00").getDay()]}</td><td>${esc(f.tipo)}</td><td>${esc(f.descricao)}</td>
        <td class="acoes"><div class="row"><button class="btn-sm" data-ed="${f.data}">Editar</button><button class="btn-sm danger" data-del="${f.data}">Excluir</button></div></td></tr>`).join("")
        || `<tr><td colspan="5" class="empty">Nenhum feriado cadastrado em ${ano}. Clique em “Incluir feriados padrão de ${ano}”.</td></tr>`}</tbody></table></div>
    <div class="card-b muted">Sábados e domingos já saem marcados na folha. Confira os pontos facultativos de cada ano pelo decreto da Prefeitura.</div></div>`;
  XLS.feriados = () => ({titulo: `Feriados ${ano}`, colunas: [["Data", "data"], ["Dia da semana"], ["Tipo"], ["Descrição"]],
    linhas: fs.map(f => [f.data, SEMANA[new Date(f.data + "T12:00").getDay()], f.tipo, f.descricao])});
  $("#fdAno").onchange = ev => location.hash = `#/feriados?ano=${ev.target.value}`;
  $("#fdPadrao").onclick = async () => { const r = await api("/api/feriados/padrao", {method: "POST", body: {ano}}); toast(`${r.incluidos} data(s) incluída(s)`); feriados(_, qs); };
  $("#fdNovo").onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    await api(`/api/feriados/${f.data}`, {method: "PUT", body: {tipo: f.tipo, descricao: f.descricao}}); toast("Feriado salvo"); feriados(_, qs);
  };
  $("#tbFd").onclick = async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.del) { if (!confirm(`Excluir ${fmtData(b.dataset.del)}?`)) return; await api(`/api/feriados/${b.dataset.del}`, {method: "DELETE"}); return feriados(_, qs); }
    const f = fs.find(x => x.data === b.dataset.ed), form = $("#fdNovo");
    form.data.value = f.data; form.tipo.value = f.tipo; form.descricao.value = f.descricao; form.descricao.focus();
  };
}

async function boot() {
  try { PUBLICO = await api("/api/publico"); } catch {}
  aplicarPublico();
  if (PUBLICO.precisa_setup) return mostrarLogin();
  try { SESSAO = await api("/api/sessao"); } catch { return; }  // sem sessao: api() ja abriu o login
  entrar();
}
boot();
