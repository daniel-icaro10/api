// SIS SMPE - telas (SPA sem dependencias)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtN = n => (n ?? 0).toLocaleString("pt-BR");
const fmtPct = n => ((n || 0) * 100).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + "%";
const fmtBRL = n => (n || 0).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});
const fmtData = d => d ? d.slice(0, 10).split("-").reverse().join("/") : "";
const fmtCPF = c => c && c.length === 11 ? `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}` : (c || "");
const agora = () => new Date().toLocaleString("pt-BR");

async function api(url, opts = {}) {
  const o = {...opts};
  if (o.body && !(o.body instanceof FormData)) { o.headers = {"Content-Type": "application/json"}; o.body = JSON.stringify(o.body); }
  const r = await fetch(url, o);
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.detail || msg; } catch {}
    toast("Erro: " + msg); throw new Error(msg);
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : r;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 3500); }
function modal(html) { $("#modalBody").innerHTML = html; if (!$("#modal").open) $("#modal").showModal(); }
function closeModal() { $("#modal").close(); }
function drawer(html) { $("#drawerPanel").innerHTML = html; $("#drawer").classList.add("open"); }
function closeDrawer() { $("#drawer").classList.remove("open"); }
$("#drawer").addEventListener("click", e => { if (e.target.id === "drawer") closeDrawer(); });
$("#menuBtn").onclick = () => $(".side").classList.toggle("open");

const PEND = {
  sem_cpf: ["Sem CPF", "b-warn"], divergente: ["CPF divergente", "b-err"], cpf_invalido: ["CPF inválido", "b-err"],
  cpf_duplicado: ["CPF duplicado", "b-err"], nome_duplicado: ["Nome duplicado", "b-warn"], sem_mae: ["Sem mãe", "b-warn"],
  critica_smtt: ["Crítica SMTT", "b-err"],
};
// legenda do validador oficial SMPE (AlunoCriticaUtf8.exe)
const LEGENDA = {0: "Escola deve ser informada e ser um número inteiro", 1: "Nome do aluno deve ser informado",
  2: "Nome da mãe deve ser informado", 3: "Sexo deve ser M ou F", 4: "Curso deve ser informado",
  5: "Grau deve ser de 1 a 3", 6: "Série/período deve ser de 1 a 9", 7: "Turno deve ser M, V, N ou I",
  8: "Matrícula deve ser informada", 9: "Data de nascimento válida com 8 dígitos", 10: "Endereço deve ser informado",
  11: "Bairro deve ser informado", 12: "Cidade deve ser informada", 13: "Nome do pai inválido", 14: "CPF é requerido",
  15: "CPF duplicado", 16: "CPF inválido", 17: "Quantidade de colunas diferente do layout (375)"};
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
  return `<select id="${id}"><option value="">Selecione a escola…</option>${ESCOLAS.map(e =>
    `<option value="${e.id}" ${+sel === e.id ? "selected" : ""}>${e.id} · ${esc(e.nome)}</option>`).join("")}</select>`;
}
const lembrarEscola = id => { try { localStorage.setItem("smpe.escola", id); } catch {} };
const ultimaEscola = () => { try { return localStorage.getItem("smpe.escola") || ""; } catch { return ""; } };

// ------------------------------------------------------------------ roteador
const ROUTES = {painel, migracao, escolas, remessas, critica, relatorios, orcamento, bases, busca};
const TITLES = {painel: "Painel", migracao: "Migração por escola", escolas: "Cadastro de escolas", remessas: "Remessas SMTT", critica: "Criticar remessa",
  relatorios: "Relatórios", orcamento: "Orçamento", bases: "Bases e importação", busca: "Localizar estudante"};
const CRUMBS = {painel: "Visão geral da migração nas escolas", migracao: "Cruzamento de CPF GEDUC × Censo × SMTT",
  escolas: "Unidades de ensino e vínculo com o GEDUC", remessas: "Arquivos enviados ao banco de dados da SMTT", critica: "Mesmas regras do validador oficial SMPE (AlunoCritica)",
  relatorios: "Listas para conferência e preenchimento pela escola", orcamento: "Valores por escola",
  bases: "Planilha SIS SMPE e bases de origem", busca: "Toda a rede municipal"};
async function router() {
  const [path, qs = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [nome = "painel", arg] = path.split("/");
  const fn = ROUTES[nome] || painel;
  $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.r === nome));
  $("#title").textContent = TITLES[nome] || "Painel";
  $("#crumb").textContent = CRUMBS[nome] || "SIS SMPE";
  $(".side").classList.remove("open");
  closeDrawer();
  $("#view").innerHTML = `<div class="empty">Carregando…</div>`;
  if (!ESCOLAS.length) await loadEscolas();
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
    ${t.sem_vinculo ? `<div class="alert warn">${t.sem_vinculo} escola(s) sem alunos encontrados no GEDUC — confira o vínculo em <a href="#/escolas">Escolas</a>.</div>` : ""}
    <div class="grid kpis k4">
      <div class="kpi"><div class="l">Escolas</div><div class="v">${fmtN(t.escolas)}</div></div>
      <div class="kpi hero"><div class="l">Matriculados (GEDUC)</div><div class="v">${fmtN(t.matriculados)}</div></div>
      <div class="kpi ok"><div class="l">Com CPF consolidado</div><div class="v">${fmtN(t.com_cpf)}</div><div class="s">${fmtPct(t.indice_cpf)}</div></div>
      <div class="kpi warn"><div class="l">Sem CPF</div><div class="v">${fmtN(t.sem_cpf)}</div></div>
      <div class="kpi err"><div class="l">CPF divergente</div><div class="v">${fmtN(t.divergentes)}</div></div>
      <div class="kpi err"><div class="l">CPF inválido</div><div class="v">${fmtN(t.cpf_invalido)}</div></div>
      <div class="kpi"><div class="l">Sem mãe</div><div class="v">${fmtN(t.sem_mae)}</div></div>
      <div class="kpi ok"><div class="l">Migrados p/ SMTT</div><div class="v">${fmtN(t.migrados)}</div><div class="s">${fmtN(d.lotes.n)} remessa(s)</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Situação por escola</h2><span class="spacer"></span>
        <input id="fEsc" placeholder="Filtrar escola…" style="width:240px"></div>
      <div class="table-wrap" style="max-height:none"><table id="tbEsc"><thead><tr>
        <th>ID</th><th>Escola</th><th>Cód. SMTT</th><th class="num">Matric.</th><th class="num">Com CPF</th><th>Índice CPF</th>
        <th class="num">Sem CPF</th><th class="num">Diverg.</th><th class="num">Sem mãe</th><th class="num">Aptos</th><th class="num">Migrados</th>
      </tr></thead><tbody id="tbEscBody"></tbody></table></div><div id="pgEsc"></div>
    </div>
    <p class="muted" style="margin-top:12px">Bases: GEDUC ${fmtN(d.bases.geduc)} · Censo ${fmtN(d.bases.censo)} · SMTT ${fmtN(d.bases.smtt)} · Alunos por status ${fmtN(d.bases.status_alunos)}</p>`;
  $("#tbEsc").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#/migracao/" + tr.dataset.id; };
  const rowEsc = e => `<tr class="click" data-id="${e.id}" data-n="${esc(e.nome.toLowerCase())}">
        <td>${e.id}</td><td>${esc(e.nome)} ${e.matriculados ? "" : `<span class="badge b-warn">sem vínculo GEDUC</span>`}</td>
        <td class="mono">${esc(e.cod_smtt) || `<span class="badge b-err">sem código</span>`}</td>
        <td class="num">${fmtN(e.matriculados)}</td><td class="num">${fmtN(e.com_cpf)}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap"><div class="bar"><span style="width:${e.indice_cpf * 100}%"></span></div><span class="muted">${fmtPct(e.indice_cpf)}</span></div></td>
        <td class="num">${e.sem_cpf || ""}</td><td class="num">${e.divergentes ? `<b style="color:var(--err)">${e.divergentes}</b>` : ""}</td>
        <td class="num">${e.sem_mae || ""}</td><td class="num">${fmtN(e.aptos)}</td><td class="num">${e.migrados ? fmtN(e.migrados) : ""}</td>
      </tr>`;
  const renderEsc = () => {
    const q = $("#fEsc").value.toLowerCase(), pg = paginar("painel", d.escolas.filter(e => e.nome.toLowerCase().includes(q)), renderEsc);
    $("#tbEscBody").innerHTML = pg.itens.map(rowEsc).join("") || `<tr><td colspan="11" class="empty">Nenhuma escola encontrada.</td></tr>`;
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
  ["critica_smtt", "Crítica SMTT", a => a.pendencias.includes("critica_smtt")],
];
let MIG = null;
async function migracao(eid) {
  eid = eid || ultimaEscola();
  if (!eid) {
    $("#view").innerHTML = `<div class="card card-b"><label>Escola</label>${escolaSelect("selEsc")}</div>`;
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
      <a class="btn" href="#/relatorios/${eid}">Relatórios</a><a class="btn" href="#/orcamento/${eid}">Orçamento</a></div>
    ${!r.matriculados ? `<div class="alert warn">Nenhum aluno do GEDUC encontrado para esta escola. Ajuste o <b>vínculo GEDUC</b> em <a href="#/escolas">Escolas</a>.</div>` : ""}
    ${!e.cod_smtt ? `<div class="alert warn">Escola sem código SMTT: a remessa exige o código da instituição (4 dígitos).</div>` : ""}
    <div class="grid kpis">
      <div class="kpi hero"><div class="l">Matriculados</div><div class="v">${fmtN(r.matriculados)}</div></div>
      <div class="kpi ok"><div class="l">Com CPF</div><div class="v">${fmtN(r.com_cpf)}</div><div class="s">índice ${fmtPct(r.indice_cpf)}</div></div>
      <div class="kpi warn"><div class="l">Sem CPF</div><div class="v">${fmtN(r.sem_cpf)}</div></div>
      <div class="kpi err"><div class="l">CPF divergente</div><div class="v">${fmtN(r.divergentes)}</div><div class="s">${fmtPct(r.indice_divergencia)}</div></div>
      <div class="kpi"><div class="l">Sem mãe</div><div class="v">${fmtN(r.sem_mae)}</div></div>
      <div class="kpi ok"><div class="l">Aptos / migrados</div><div class="v">${fmtN(r.aptos)}</div><div class="s">${fmtN(r.migrados)} já migrados</div></div>
    </div>
    <div class="card">
      <div class="card-h"><div class="tabs" id="tabs"></div></div>
      <div class="card-h">
        <input id="qAluno" placeholder="Buscar aluno, mãe ou CPF…" style="max-width:300px">
        <select id="fTurma" style="max-width:220px"><option value="">Todas as turmas</option>${[...new Set(d.alunos.map(a => a.turma))].sort().map(t => `<option>${esc(t)}</option>`).join("")}</select>
        <span class="spacer"></span><span class="muted" id="selInfo"></span>
        <button id="btnSelAptos">Selecionar aptos não migrados</button>
        <button class="primary" id="btnRemessa" disabled>Gerar remessa SMTT</button>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th><input type="checkbox" id="chkAll" style="width:auto" title="Marcar/desmarcar todos os alunos do filtro atual (todas as páginas)"></th><th>Aluno</th><th>Nasc.</th><th>Turma / turno</th><th>Mãe</th>
        <th>CPF GEDUC</th><th>CPF Censo</th><th>CPF SMTT</th><th>CPF consolidado</th><th>Pendências</th><th>SMTT</th>
      </tr></thead><tbody id="tbAlunos"></tbody></table></div><div id="pgAlunos"></div>
    </div>`;
  $("#selEsc").onchange = ev => location.hash = "#/migracao/" + ev.target.value;
  $("#qAluno").oninput = ev => { MIG.q = ev.target.value.trim().toUpperCase(); resetPag("mig"); renderAlunos(); };
  $("#fTurma").onchange = ev => { MIG.turma = ev.target.value; resetPag("mig"); renderAlunos(); };
  $("#btnSelAptos").onclick = () => { d.alunos.filter(a => a.apto && !a.migrado).forEach(a => MIG.sel.add(a.id_aluno)); renderAlunos(); };
  $("#chkAll").onchange = ev => { visiveis().forEach(a => ev.target.checked ? MIG.sel.add(a.id_aluno) : MIG.sel.delete(a.id_aluno)); renderAlunos(); };
  $("#btnRemessa").onclick = () => previaRemessa(eid, [...MIG.sel]);
  $("#tbAlunos").onclick = ev => {
    if (ev.target.type === "checkbox") { ev.target.checked ? MIG.sel.add(ev.target.value) : MIG.sel.delete(ev.target.value); updSel(); return; }
    const tr = ev.target.closest("tr[data-id]"); if (tr) abrirAluno(tr.dataset.id);
  };
  renderAlunos();
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
    <td><b>${esc(a.aluno)}</b>${a.situacao ? `<div class="muted">${esc(a.situacao)}</div>` : ""}</td>
    <td>${fmtData(a.dt_nasc)}</td><td>${esc(a.turma)}<div class="muted">${esc(a.turno)}</div></td>
    <td>${esc(a.mae) || `<span class="muted">—</span>`}</td>
    <td>${cpfCell(a.cpf_geduc, a.cpf)}</td><td>${cpfCell(a.cpf_censo, a.cpf)}</td><td>${cpfCell(a.cpf_smtt, a.cpf)}</td>
    <td>${a.cpf === "DIVERGENTE" ? `<span class="badge b-err">DIVERGENTE</span>` : a.cpf ? `<b class="mono">${fmtCPF(a.cpf)}</b>${a.cpf_manual ? ` <span class="badge b-info" title="Informado manualmente">manual</span>` : ""}` : `<span class="muted">—</span>`}</td>
    <td>${pendBadges(a.pendencias, a.criticas)}</td>
    <td>${a.migrado ? `<span class="badge b-ok">migrado</span>` : a.no_smtt ? `<span class="badge b-mute">já na base SMTT</span>` : ""}</td>
  </tr>`).join("") : `<tr><td colspan="11" class="empty">Nenhum aluno neste filtro.</td></tr>`;
  $("#pgAlunos").innerHTML = pg.html;
  updSel();
}

async function abrirAluno(id) {
  const [d, a] = [await api(`/api/alunos/${encodeURIComponent(id)}`), MIG?.d.alunos.find(x => x.id_aluno === id)];
  const g = d.geduc, aj = d.ajuste || {};
  const src = (t, rows, f) => `<h3>${t}</h3>` + (rows.length ? rows.map(f).join("<hr style='border:0;border-top:1px dashed var(--line)'>") : `<p class="muted">Não encontrado nesta base (cruzamento por nome).</p>`);
  drawer(`<div class="dh"><div style="flex:1"><h2>${esc(g.aluno)}</h2><div class="muted">${esc(g.escola)} · ${esc(g.turma)} · ID ${esc(g.id_aluno)}</div>
      ${a ? `<div style="margin-top:6px">${pendBadges(a.pendencias, a.criticas)}${a.migrado ? `<span class="badge b-ok">migrado</span>` : ""}</div>` : ""}</div>
      <button onclick="closeDrawer()">Fechar</button></div>
    <div class="db">
      ${a ? `<div class="alert ${a.cpf === "DIVERGENTE" ? "warn" : "info"}">CPF consolidado: <b class="mono">${a.cpf === "DIVERGENTE" ? "DIVERGENTE" : fmtCPF(a.cpf) || "—"}</b>
        ${a.cpf === "DIVERGENTE" ? " — as bases discordam; informe o CPF correto abaixo." : ""}</div>
        ${a.criticas.length ? `<div class="alert warn"><b>Será rejeitado pelo validador SMTT:</b><br>${a.criticas.map(x => `(${x}) ${esc(LEGENDA[x])}`).join("<br>")}
          <br><small>Corrija no GEDUC e reimporte a base (endereço, bairro, série, sexo, turno, nascimento).</small></div>` : ""}` : ""}
      <h3>Correções da escola</h3>
      <form id="fAj" class="form">
        <div><label>CPF correto</label><input name="cpf" value="${esc(fmtCPF(aj.cpf || ""))}" placeholder="000.000.000-00"></div>
        <div><label>Telefone</label><input name="telefone" value="${esc(aj.telefone || "")}"></div>
        <div class="full"><label>Nome da mãe</label><input name="mae" value="${esc(aj.mae || "")}" placeholder="${esc(g.mae || "Não informada no GEDUC")}"></div>
        <div><label>RG</label><input name="rg" value="${esc(aj.rg || "")}"></div>
        <div><label>Órgão expedidor</label><input name="org_exp" value="${esc(aj.org_exp || "")}" placeholder="SSP"></div>
        <div><label>Data de expedição</label><input type="date" name="data_exp" value="${esc(aj.data_exp || "")}"></div>
        <div class="full"><label>Observação</label><input name="obs" value="${esc(aj.obs || "")}"></div>
        <div class="full row"><button class="primary">Salvar correções</button>${d.ajuste ? `<button type="button" class="danger" id="limparAj">Remover correções</button>` : ""}
          <span class="muted">Correções têm prioridade sobre as bases.</span></div>
      </form>
      ${src("GEDUC", [g], x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Nascimento</dt><dd>${fmtData(x.dt_nasc)}</dd>
        <dt>Mãe</dt><dd>${esc(x.mae) || "—"}</dd><dt>Pai</dt><dd>${esc(x.pai) || "—"}</dd><dt>Série/turno</dt><dd>${esc(x.ano_serie)} · ${esc(x.turno)}</dd>
        <dt>Endereço</dt><dd>${esc([x.rua, x.numero, x.bairro, x.cidade, x.cep].filter(Boolean).join(", "))}</dd></dl>`)}
      ${src("Censo escolar", d.censo, x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Nascimento</dt><dd>${fmtData(x.dt_nasc)}</dd><dt>ID INEP</dt><dd class="mono">${esc(x.id_inep)}</dd><dt>Cor/raça</dt><dd>${esc(x.cor)}</dd></dl>`)}
      ${src("SMTT", d.smtt, x => `<dl class="src"><dt>CPF</dt><dd class="mono">${fmtCPF(x.cpf) || "—"}</dd><dt>Escola</dt><dd>${esc(x.escola)}</dd><dt>Cartão</dt><dd class="mono">${esc(x.cartao) || "—"}</dd>
        <dt>RG</dt><dd>${esc(x.rg) || "—"} ${esc(x.org_exp)}</dd><dt>Celular</dt><dd>${esc(x.celular || x.telefone) || "—"}</dd><dt>Cadastrado</dt><dd>${esc(x.cadastrado)}</dd></dl>`)}
      ${d.lotes.length ? `<h3>Remessas</h3>${d.lotes.map(l => `<div>#${l.id} · ${esc(l.criado_em)} · <a href="/api/lotes/${l.id}/arquivo">${esc(l.arquivo)}</a></div>`).join("")}` : ""}
    </div>`);
  $("#fAj").onsubmit = async ev => {
    ev.preventDefault();
    await api(`/api/alunos/${encodeURIComponent(id)}/ajuste`, {method: "PUT", body: Object.fromEntries(new FormData(ev.target))});
    toast("Correções salvas"); closeDrawer(); if (MIG) migracao(MIG.eid);
  };
  const lim = $("#limparAj");
  if (lim) lim.onclick = async () => { await api(`/api/alunos/${encodeURIComponent(id)}/ajuste`, {method: "PUT", body: {}}); toast("Correções removidas"); closeDrawer(); if (MIG) migracao(MIG.eid); };
}

async function previaRemessa(eid, ids) {
  const p = await api(`/api/escolas/${eid}/remessa/previa`, {method: "POST", body: {ids, remover_acentos: true}});
  const ok = p.itens.filter(i => !i.erros.length), rej = p.itens.filter(i => i.erros.length), av = ok.filter(i => i.avisos.length);
  modal(`<div class="mh"><h2>Remessa SMTT — prévia</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <div class="mb">
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi ok"><div class="l">Serão enviados</div><div class="v">${fmtN(ok.length)}</div></div>
        <div class="kpi err"><div class="l">Rejeitados</div><div class="v">${fmtN(rej.length)}</div></div>
        <div class="kpi warn"><div class="l">Com campos truncados</div><div class="v">${fmtN(av.length)}</div></div>
      </div>
      <p class="muted">Layout oficial SMPE: ${p.tam_linha} colunas por linha, ${p.layout.length} campos, UTF-8, sem acentos. Arquivo <b class="mono">INST_&lt;código&gt;_REM_&lt;nº&gt;.txt</b>. Os alunos passam pelas mesmas críticas do validador AlunoCritica.</p>
      ${rej.length ? `<h3>Rejeitados</h3><table><tbody>${rej.map(i => `<tr><td>${esc(i.aluno)}</td><td>${i.erros.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table>` : ""}
      ${av.length ? `<h3>Avisos</h3><table><tbody>${av.slice(0, 50).map(i => `<tr><td>${esc(i.aluno)}</td><td class="muted">${i.avisos.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table>` : ""}
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
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>${ESCOLAS.length} escolas</h2><span class="spacer"></span>
      <input id="fE" placeholder="Filtrar…" style="width:220px"><button class="primary" id="novaEsc">Nova escola</button></div>
    <div class="table-wrap" style="max-height:none"><table id="tbE"><thead><tr><th>ID</th><th>Escola</th><th>Cód. SMTT</th><th>INEP</th><th>Vínculo GEDUC</th><th class="num">Alunos GEDUC</th><th></th></tr></thead>
    <tbody id="tbEBody"></tbody></table></div><div id="pgE"></div></div>`;
  const rowE = e => `<tr data-n="${esc(e.nome.toLowerCase())}"><td>${e.id}</td><td>${esc(e.nome)}</td><td class="mono">${esc(e.cod_smtt)}</td><td class="mono">${esc(e.inep)}</td>
      <td>${e.geduc_nome ? esc(e.geduc_nome) : `<span class="muted">mesmo nome</span>`}</td>
      <td class="num">${res[e.id]?.matriculados ? fmtN(res[e.id].matriculados) : `<span class="badge b-warn">0 — vincular</span>`}</td>
      <td><button data-ed="${e.id}">Editar</button></td></tr>`;
  const renderE = () => {
    const q = $("#fE").value.toLowerCase(), pg = paginar("escolas", ESCOLAS.filter(e => e.nome.toLowerCase().includes(q) || String(e.id) === q), renderE);
    $("#tbEBody").innerHTML = pg.itens.map(rowE).join("") || `<tr><td colspan="7" class="empty">Nenhuma escola encontrada.</td></tr>`;
    $("#pgE").innerHTML = pg.html;
  };
  $("#fE").oninput = () => { resetPag("escolas"); renderE(); };
  renderE();
  $("#novaEsc").onclick = () => editarEscola(null);
  $("#tbE").onclick = ev => { const b = ev.target.closest("[data-ed]"); if (b) editarEscola(+b.dataset.ed); };
}
async function editarEscola(id) {
  const e = ESCOLAS.find(x => x.id === id) || {nome: "", cod_smtt: "", inep: "", geduc_nome: "", nivel: "ENSINO FUNDAMENTAL"};
  const sug = e.nome ? await api("/api/geduc/escolas?sugerir_para=" + encodeURIComponent(e.nome)) : await api("/api/geduc/escolas");
  modal(`<div class="mh"><h2>${id ? "Editar escola" : "Nova escola"}</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div>
    <form id="fEsc"><div class="mb form">
      <div><label>ID</label><input name="id" type="number" value="${id ?? ""}" ${id ? "disabled" : ""} placeholder="automático"></div>
      <div><label>Nível de ensino (campo CURSO da remessa)</label><input name="nivel" value="${esc(e.nivel)}"></div>
      <div class="full"><label>Nome da escola</label><input name="nome" required value="${esc(e.nome)}"></div>
      <div><label>Código SMTT (4 dígitos)</label><input name="cod_smtt" value="${esc(e.cod_smtt)}" maxlength="4"></div>
      <div><label>Código INEP</label><input name="inep" value="${esc(e.inep)}"></div>
      <div class="full"><label>Vínculo com o GEDUC (nome da escola na base GEDUC)</label>
        <select name="geduc_nome"><option value="">Usar o mesmo nome do cadastro</option>${sug.slice(0, 400).map(s =>
          `<option value="${esc(s.escola)}" ${s.escola.trim() === (e.geduc_nome || "").trim() ? "selected" : ""}>${esc(s.escola)} — ${fmtN(s.alunos)} alunos${s.similaridade != null ? ` (${Math.round(s.similaridade * 100)}%)` : ""}</option>`).join("")}</select>
        <small class="muted">Ordenado por semelhança com o nome. Também cruza pelo INEP, se informado.</small></div>
    </div>
    <div class="mf">${id ? `<button type="button" class="danger" id="delEsc">Excluir</button><span class="spacer"></span>` : ""}<button type="button" onclick="closeModal()">Cancelar</button><button class="primary">Salvar</button></div></form>`);
  $("#fEsc").onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const body = {...e, ...f, id: id || (f.id ? +f.id : null)};
    if (id) await api(`/api/escolas/${id}`, {method: "PUT", body}); else await api("/api/escolas", {method: "POST", body});
    closeModal(); toast("Escola salva"); escolas();
  };
  const del = $("#delEsc");
  if (del) del.onclick = async () => { if (confirm("Excluir esta escola do cadastro?")) { await api(`/api/escolas/${id}`, {method: "DELETE"}); closeModal(); escolas(); } };
}

// ------------------------------------------------------------------ remessas
async function remessas(_, qs) {
  const eid = qs.get("escola") || "";
  const ls = await api("/api/lotes" + (eid ? "?escola_id=" + eid : ""));
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>Remessas geradas</h2><span class="spacer"></span><div style="width:360px">${escolaSelect("selEscR", eid)}</div></div>
    ${ls.length ? `<div class="table-wrap" style="max-height:none"><table id="tbL"><thead><tr><th>#</th><th>Escola</th><th>Gerada em</th><th class="num">Alunos</th><th>Arquivo</th><th></th></tr></thead><tbody id="tbLBody"></tbody></table></div><div id="pgL"></div>` : `<div class="empty">Nenhuma remessa gerada. Selecione alunos em <a href="#/migracao">Migração</a> e clique em “Gerar remessa SMTT”.</div>`}</div>`;
  $("#selEscR").onchange = ev => { resetPag("remessas"); location.hash = "#/remessas?escola=" + ev.target.value; };
  const rowL = l => `<tr><td>${l.id}</td><td>${esc(l.escola)}</td><td>${esc(l.criado_em)}</td><td class="num">${fmtN(l.n_alunos)}</td>
      <td class="mono">${esc(l.arquivo)}</td><td class="row" style="gap:6px"><a class="btn" href="/api/lotes/${l.id}/arquivo">Baixar</a><a class="btn" href="#/critica?lote=${l.id}">Criticar</a><button data-ver="${l.id}">Alunos</button><button class="danger" data-del="${l.id}">Excluir</button></td></tr>`;
  const renderL = () => { const pg = paginar("remessas", ls, renderL); if ($("#tbLBody")) { $("#tbLBody").innerHTML = pg.itens.map(rowL).join(""); $("#pgL").innerHTML = pg.html; } };
  renderL();
  const tb = $("#tbL");
  if (tb) tb.onclick = async ev => {
    const v = ev.target.dataset.ver, d = ev.target.dataset.del;
    if (v) {
      const al = await api(`/api/lotes/${v}/alunos`);
      const ver = () => { const pg = paginar("lote", al, ver, 25);
        modal(`<div class="mh"><h2>Remessa #${v} — ${al.length} alunos</h2><span class="spacer"></span><button onclick="closeModal()">×</button></div><div class="mb"><table><thead><tr><th>Aluno</th><th>CPF</th></tr></thead><tbody>${pg.itens.map(a => `<tr><td>${esc(a.nome)}</td><td class="mono">${fmtCPF(a.cpf)}</td></tr>`).join("")}</tbody></table>${pg.html}</div>`); };
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
      <button id="baixarCrit" class="primary">Baixar relatório de crítica</button></div>
      ${erros.length ? `<div class="table-wrap"><table><thead><tr><th>Linha</th><th>Nome do estudante</th><th>CPF</th><th>Nascimento</th><th>Colunas</th><th>Críticas</th></tr></thead><tbody id="tbCrit"></tbody></table></div><div id="pgCrit"></div>` : `<div class="empty">Nenhum registro com crítica.</div>`}</div>
    <div class="card"><div class="card-h"><h2>Legenda explicativa</h2></div><div class="table-wrap" style="max-height:none"><table><thead><tr><th>Cód.</th><th>Regra</th><th class="num">Ocorrências</th></tr></thead><tbody>
      ${Object.entries(LEGENDA).map(([k, v]) => `<tr><td><b>(${k})</b></td><td>${esc(v)}</td><td class="num">${cont[k] ? `<b style="color:var(--err)">${cont[k]}</b>` : "—"}</td></tr>`).join("")}
      ${r.obs.map(o => `<tr><td></td><td class="muted" colspan="2">${esc(o)}</td></tr>`).join("")}</tbody></table></div></div>`;
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
    row: (a, i) => [i, esc(a.aluno) + (a.divergente ? ' <small>(CPF divergente)</small>' : ""), fmtData(a.dt_nasc), a.sexo, esc(a.mae), esc(a.turma), `<span class="fill"></span>`]},
  sem_mae: {t: "RELAÇÃO SIMPLIFICADA DE ESTUDANTES SEM MÃE", cols: ["LINHA", "NOME DO ESTUDANTE", "DATA NASC", "SEXO", "INFORME A MÃE", "TURMA", "CPF"],
    row: (a, i) => [i, esc(a.aluno), fmtData(a.dt_nasc), a.sexo, `<span class="fill"></span>`, esc(a.turma), fmtCPF(a.cpf)]},
  simplificada: {t: "RELAÇÃO SIMPLIFICADA DE ESTUDANTES", cols: ["LINHA", "NOME DO ESTUDANTE", "CPF", "DATA NASC", "MÃE"],
    row: (a, i) => [i, esc(a.aluno), `<span class="mono">${a.cpf_mascarado || "—"}</span>`, fmtData(a.dt_nasc), esc(a.mae)]},
};
async function relatorios(eid, qs) {
  eid = eid || ultimaEscola();
  const tipo = qs.get("tipo") || "sem_cpf";
  $("#view").innerHTML = `<div class="row no-print" style="margin-bottom:14px"><div style="width:420px">${escolaSelect("selEscRel", eid)}</div>
      <div class="tabs">${Object.entries({sem_cpf: "Sem CPF", sem_mae: "Sem mãe", simplificada: "Simplificada (CPF mascarado)"}).map(([k, l]) =>
        `<button class="tab ${k === tipo ? "active" : ""}" data-t="${k}">${l}</button>`).join("")}</div>
      <span class="spacer"></span><button class="primary" onclick="print()" ${eid ? "" : "disabled"}>Imprimir</button></div><div id="relDoc"></div>`;
  $("#selEscRel").onchange = ev => location.hash = `#/relatorios/${ev.target.value}?tipo=${tipo}`;
  $$(".tabs .tab").forEach(b => b.onclick = () => location.hash = `#/relatorios/${eid}?tipo=${b.dataset.t}`);
  if (!eid) { $("#relDoc").innerHTML = `<div class="empty">Selecione uma escola.</div>`; return; }
  lembrarEscola(eid);
  const d = await api(`/api/escolas/${eid}/relatorio/${tipo}`), R = RELS[tipo], e = d.escola;
  $("#relDoc").innerHTML = `<div class="doc"><div class="doc-head"><img src="/static/logo.png" alt=""><h2>${R.t} - ${new Date().getFullYear()}</h2></div>
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
  $("#view").innerHTML = `<div class="row no-print" style="margin-bottom:14px"><div style="width:420px">${escolaSelect("selEscO", eid)}</div>
    <label style="margin:0">Preço unitário (R$)</label><input id="preco" type="number" step="0.01" min="0" value="${esc(cfg.preco_unitario)}" style="width:110px">
    <span class="spacer"></span><button class="primary" onclick="print()" ${eid ? "" : "disabled"}>Imprimir</button></div><div id="orcDoc"></div>`;
  $("#selEscO").onchange = ev => location.hash = "#/orcamento/" + ev.target.value;
  $("#preco").onchange = async ev => { await api("/api/config", {method: "PUT", body: {preco_unitario: ev.target.value}}); toast("Preço atualizado"); if (eid) render(await api(`/api/escolas/${eid}/orcamento`)); };
  if (!eid) { $("#orcDoc").innerHTML = `<div class="empty">Selecione uma escola.</div>`; return; }
  lembrarEscola(eid);
  const render = o => {
    $("#orcDoc").innerHTML = `<div class="doc"><div class="doc-head"><img src="/static/logo.png" alt=""><h2>ORÇAMENTO — MIGRAÇÃO DE ESTUDANTES (SMTT)</h2></div>
      <div class="dmeta"><span><b>ESCOLA:</b> ${esc(o.escola.nome)}</span><span><b>COD. SMTT:</b> ${esc(o.escola.cod_smtt)}</span><span><b>DATA:</b> ${agora()}</span></div>
      <table><thead><tr><th>Matriculados</th><th>Alunos migrados</th><th>Não migrados</th><th>Índice de migração</th><th>Valor</th></tr></thead>
      <tbody><tr><td class="num">${fmtN(o.matriculados)}</td><td class="num">${fmtN(o.migrados)}</td><td class="num">${fmtN(o.nao_migrados)}</td><td class="num">${fmtPct(o.indice)}</td><td class="num"><b>${fmtBRL(o.total)}</b></td></tr></tbody></table>
      <br><table><thead><tr><th>Descrição</th><th class="num">Preço unitário</th><th class="num">Qtd</th><th class="num">Valor</th></tr></thead><tbody>
        <tr><td>Alunos matriculados com CPF (migrados)</td><td class="num">${fmtBRL(o.preco_unitario)}</td><td class="num">${fmtN(o.migrados)}</td><td class="num">${fmtBRL(o.subtotal)}</td></tr>
        <tr><td>Peticionamento</td><td></td><td class="num">1</td><td class="num">${fmtBRL(o.peticionamento)}</td></tr>
        <tr><td>Desconto</td><td></td><td></td><td class="num">− ${fmtBRL(o.desconto)}</td></tr>
        <tr><td colspan="3"><b>Valor total</b></td><td class="num"><b>${fmtBRL(o.total)}</b></td></tr></tbody></table>
      <div class="note">Estudante: vá até a secretaria de sua escola e verifique se seu nome foi encaminhado pela equipe de TI para o banco de dados da SMTT.</div></div>
      <div class="card card-b no-print" style="max-width:960px;margin:14px auto 0"><form id="fOrc" class="row">
        <div><label>Matriculados informados (vazio = GEDUC)</label><input name="matriculados_info" type="number" min="0" value="${o.escola.matriculados_info ?? ""}" style="width:180px"></div>
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
        <div class="card-b"><p class="muted" style="margin-top:0">Aba/arquivo: <b>${esc(b.aba)}</b> (.xlsx, .xlsm ou .csv)</p>
        <div class="drop" data-base="${k}"><svg class="i"><use href="#i-upload"/></svg>Arraste ou <label style="display:inline;color:var(--accent);cursor:pointer">escolha o arquivo<input type="file" accept=".xlsx,.xlsm,.csv" hidden></label></div></div></div>`).join("")}
    </div>
    <div id="impStatus"></div>
    <div class="card"><div class="card-h"><h2>Histórico de importações</h2></div>
      <div class="table-wrap" style="max-height:none"><table><thead><tr><th>Quando</th><th>Base</th><th>Arquivo</th><th class="num">Linhas</th></tr></thead><tbody id="tbHist"></tbody></table></div><div id="pgHist"></div></div>`;
  const renderH = () => { const pg = paginar("hist", d.historico, renderH, 10);
    $("#tbHist").innerHTML = pg.itens.map(h => `<tr><td>${esc(h.importado_em)}</td><td>${esc(d.bases[h.base]?.label || h.base)}</td><td>${esc(h.arquivo)}</td><td class="num">${fmtN(h.linhas)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nenhuma importação.</td></tr>`;
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
async function enviar(base, file) {
  const fd = new FormData(); fd.append("base", base); fd.append("arquivo", file);
  $("#impStatus").innerHTML = `<div class="alert info">Enviando ${esc(file.name)}…</div>`;
  await api("/api/importar", {method: "POST", body: fd});
  acompanhar();
}
function acompanhar() {
  const h = setInterval(async () => {
    const s = (await api("/api/importacoes")).status;
    $("#impStatus").innerHTML = `<div class="alert ${s.erro ? "warn" : "info"}">${s.rodando ? "Importando… " : s.erro ? "Falha: " + esc(s.erro) : "Importação concluída. "}${s.msg.map(esc).join(" · ")}</div>`;
    if (!s.rodando) { clearInterval(h); if (!s.erro) { await loadEscolas(); setTimeout(bases, 1500); } }
  }, 1500);
}

// ------------------------------------------------------------------ busca
async function busca(_, qs) {
  const q = qs.get("q") || "";
  $("#buscaInput").value = q;
  const rs = q ? await api("/api/alunos/busca?q=" + encodeURIComponent(q)) : [];
  $("#view").innerHTML = `<div class="card"><div class="card-h"><h2>${rs.length ? `${fmtN(rs.length)}${rs.length === 1000 ? "+" : ""} resultado(s) para “${esc(q)}”` : q ? `Estudante não localizado: “${esc(q)}”` : "Digite um nome ou CPF na busca acima"}</h2></div>
    ${rs.length ? `<div class="table-wrap" style="max-height:none"><table id="tbB"><thead><tr><th>Aluno</th><th>Nasc.</th><th>Escola</th><th>Turma</th><th>Mãe</th><th>CPF (GEDUC)</th><th></th></tr></thead><tbody id="tbBBody"></tbody></table></div><div id="pgB"></div>` : ""}</div>`;
  const rowB = r => `<tr><td><b>${esc(r.aluno)}</b></td><td>${fmtData(r.dt_nasc)}</td><td>${esc(r.escola)}</td><td>${esc(r.turma)} · ${esc(r.turno)}</td><td>${esc(r.mae)}</td><td class="mono">${fmtCPF(r.cpf_geduc)}</td>
      <td>${r.escola_id ? `<a class="btn" href="#/migracao/${r.escola_id}">Abrir escola</a>` : `<button data-id="${esc(r.id_aluno)}">Detalhes</button>`}</td></tr>`;
  const renderB = () => { const pg = paginar("busca", rs, renderB); if ($("#tbBBody")) { $("#tbBBody").innerHTML = pg.itens.map(rowB).join(""); $("#pgB").innerHTML = pg.html; } };
  resetPag("busca"); renderB();
  const tb = $("#tbB"); if (tb) tb.onclick = ev => { const id = ev.target.dataset.id; if (id) { MIG = null; abrirAluno(id); } };
}

router();
