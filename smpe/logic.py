"""Regras de negocio da planilha SIS SMPE: cruzamento de CPF, pendencias, remessa SMTT e orcamento."""
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from datetime import datetime

from . import db
from .critica import LAYOUT, LEGENDA, TAM_LINHA, criticar_campos
from .util import chave_nome, cpf_valido, mascara_cpf, nome_completo, norm_cpf, norm_nome, sem_acento, so_digitos

DIVERGENTE = "DIVERGENTE"


def consolidar(*fontes: str) -> str:
    """Formula da coluna AO (aba ESCOLA), estendida a qualquer numero de fontes (GEDUC, CENSO, SMTT, status).
    Vale a maioria; se so uma fonte tem CPF, usa ela; se as fontes empatam ou discordam, DIVERGENTE."""
    votos = Counter(f for f in fontes if f).most_common()
    if not votos:
        return ""
    if len(votos) > 1 and votos[0][1] == votos[1][1]:
        return DIVERGENTE
    return votos[0][0]


class Bases:
    """Indices em memoria das bases auxiliares (CENSO, SMTT, status, ajustes, remessas)."""

    def __init__(self, con):
        # por nome e por nome sem particulas; o ID_ALUNO do Alunos por status NAO e o do GEDUC (outra numeracao)
        self.censo, self.censo_ch = _indices(con, "censo")
        self.smtt, self.smtt_ch = _indices(con, "smtt")
        self.status_nome, self.status_ch = _indices(con, "status_alunos")
        self.status_escola = defaultdict(list)
        for rs in self.status_nome.values():
            for r in rs:
                self.status_escola[norm_nome(r["escola"])].append(r)
        self.ajustes = {r["id_aluno"]: dict(r) for r in con.execute("SELECT * FROM ajustes")}
        self.migrados = defaultdict(list)
        for r in con.execute("""SELECT la.id_aluno, l.id, l.criado_em, l.escola_id FROM lote_alunos la
                                JOIN lotes l ON l.id = la.lote_id ORDER BY l.id"""):
            self.migrados[r["id_aluno"]].append({"lote": r["id"], "em": r["criado_em"], "escola_id": r["escola_id"]})


def _indices(con, tabela: str) -> tuple[dict, dict]:
    por_nome, por_chave = defaultdict(list), defaultdict(list)
    for r in con.execute(f"SELECT * FROM {tabela}"):
        d = dict(r)
        por_nome[d["nome_norm"]].append(d)
        por_chave[chave_nome(d["nome_norm"])].append(d)
    return por_nome, por_chave


def achar(por_nome: dict, por_chave: dict, nn: str, nasc: str, campo_nasc: str) -> dict | None:
    """Registro do aluno em outra base: pelo nome (ver _pick) ou, se nao achar, pelo nome sem as particulas com a
    mesma data de nascimento (grafias como 'DANILO DE AMORIM' x 'DANILO AMORIM')."""
    c = _pick(por_nome.get(nn, []), nasc, campo_nasc)
    if c or not nasc:
        return c
    iguais = [x for x in por_chave.get(chave_nome(nn), []) if (x.get(campo_nasc) or "")[:10] == nasc]
    return iguais[0] if len(iguais) == 1 else None


def _pick(cands: list[dict], nasc: str, campo_nasc: str) -> dict | None:
    """Registro de outra base com o mesmo nome: prefere o de mesma data de nascimento e descarta os de data
    diferente (homonimo, possivelmente de outra instituicao). Sem data de um dos lados, vale o nome."""
    if not nasc:
        return cands[0] if cands else None
    iguais = [c for c in cands if (c.get(campo_nasc) or "")[:10] == nasc]
    sem_data = [c for c in cands if not c.get(campo_nasc)]
    return (iguais or sem_data or [None])[0]


def filtro_escola(escola) -> tuple[str, list]:
    nome = norm_nome(escola["geduc_nome"] or escola["nome"])
    if escola["inep"]:
        return "(escola_norm = ? OR inep_escola = ?)", [nome, escola["inep"]]
    return "escola_norm = ?", [nome]


# campos do aluno que a instituicao pode corrigir (tabela ajustes) antes de reprocessar
CAMPOS_AJUSTE = ("aluno", "pai", "genero", "dt_nasc", "ano_serie", "turno", "turma", "matricula", "rua", "numero",
                 "bairro", "cidade", "cep", "grau", "curso")


def manual_como_geduc(m: dict) -> dict:
    """Aluno cadastrado individualmente, no mesmo formato de uma linha do GEDUC."""
    return {**m, "id_aluno": f"M{m['id']}", "modalidade": "", "manual": True}


def aluno_base(con, id_aluno: str) -> dict | None:
    """Linha do GEDUC ou do cadastro individual (id_aluno 'M<id>')."""
    if id_aluno.startswith("M") and id_aluno[1:].isdigit():
        r = con.execute("SELECT * FROM alunos_manuais WHERE id=?", (int(id_aluno[1:]),)).fetchone()
        return manual_como_geduc(dict(r)) if r else None
    r = con.execute("SELECT * FROM geduc WHERE id_aluno=?", (id_aluno,)).fetchone()
    return dict(r) if r else None


def aluno_na_escola(con, escola, id_aluno: str) -> bool:
    if id_aluno.startswith("M") and id_aluno[1:].isdigit():
        return bool(con.execute("SELECT 1 FROM alunos_manuais WHERE id=? AND escola_id=?",
                                (int(id_aluno[1:]), escola["id"])).fetchone())
    where, args = filtro_escola(escola)
    return bool(con.execute(f"SELECT 1 FROM geduc WHERE id_aluno=? AND {where}", [id_aluno, *args]).fetchone())


def nomes_da_escola(escola) -> set[str]:
    """Nomes normalizados com que a instituicao aparece nas bases (vinculo GEDUC e nome do cadastro)."""
    return {norm_nome(escola["geduc_nome"] or escola["nome"]), norm_nome(escola["nome"])}


def status_da_escola(bases: Bases, escola) -> list[dict]:
    return [s for n in nomes_da_escola(escola) for s in bases.status_escola.get(n, [])]


def pelo_status(escola) -> str:
    """Data em que os matriculados passaram a seguir o Alunos por status da instituicao (vazio = GEDUC)."""
    try:
        return escola["status_atualizado_em"] or ""
    except (KeyError, IndexError):
        return ""


def _casar_status(alunos: list[dict], status: list[dict]) -> tuple[list, list, list]:
    """Cruza os matriculados com o Alunos por status pelo nome e data de nascimento (o ID_ALUNO do Alunos por
    status e de outra numeracao) -> (so no status, so no sistema, mesmo aluno com o nome escrito diferente)."""
    def chave(nome, nasc):
        return chave_nome(nome), (nasc or "")[:10]

    sis = {chave(a["nome_norm"], a["dt_nasc"]) for a in alunos}
    sis_nome = {chave_nome(a["nome_norm"]) for a in alunos}
    st_keys = {chave(s["nome_norm"], s["nascimento"]) for s in status}
    st_nome = {chave_nome(s["nome_norm"]) for s in status}

    def casa(k, conj, conj_nome, tem_data):  # sem data de um dos lados, vale o nome
        return k in conj or (not tem_data and k[0] in conj_nome)

    so_status = [s for s in status if not casa(chave(s["nome_norm"], s["nascimento"]), sis, sis_nome, bool(s["nascimento"]))]
    so_sistema = [a for a in alunos
                  if status and not casa(chave(a["nome_norm"], a["dt_nasc"]), st_keys, st_nome, bool(a["dt_nasc"]))]
    # mesmo aluno com o nome digitado de outro jeito: mesma data de nascimento e nome muito parecido
    nome_diferente = []
    for s in list(so_status):
        cands = [(SequenceMatcher(None, chave_nome(s["aluno"]), chave_nome(a["aluno"])).ratio(), a) for a in so_sistema
                 if s["nascimento"] and a["dt_nasc"] == s["nascimento"]]
        sim, a = max(cands, key=lambda x: x[0], default=(0, None))
        if a and sim >= 0.8:
            nome_diferente.append((s, a, round(sim, 2)))
            so_status.remove(s)
            so_sistema.remove(a)
    return so_status, so_sistema, nome_diferente


def _fora_do_status(alunos: list[dict], status: list[dict]) -> list[dict]:
    """Matriculados que nao estao no Alunos por status, mais os repetidos (GEDUC e cadastro individual com o mesmo
    nome e nascimento: fica o cadastro individual)."""
    fora = _casar_status(alunos, status)[1]
    ids = {a["id_aluno"] for a in fora}
    vistos = set()
    for a in sorted(alunos, key=lambda a: not a.get("manual")):
        if a["id_aluno"] in ids:
            continue
        k = chave_nome(a["nome_norm"]), (a["dt_nasc"] or "")[:10]
        if k in vistos:
            fora.append(a)
        vistos.add(k)
    return fora


def cursando(a: dict) -> bool:
    """So migra quem esta com situacao CURSANDO no Alunos por status (sem situacao conhecida nao bloqueia)."""
    s = sem_acento(a.get("situacao") or "").upper().strip()
    return not s or s == "CURSANDO"


def alunos_da_escola(con, escola, bases: Bases | None = None, todos: bool = False) -> list[dict]:
    """Matriculados: GEDUC + cadastro individual; se a instituicao foi atualizada pelo Alunos por status, so os que
    estao nele (todos=True ignora esse filtro)."""
    bases = bases or Bases(con)
    where, args = filtro_escola(escola)
    rows = [dict(r) for r in con.execute(f"SELECT * FROM geduc WHERE {where} ORDER BY aluno", args)]
    rows += [manual_como_geduc(dict(r)) for r in con.execute(
        "SELECT * FROM alunos_manuais WHERE escola_id=? ORDER BY aluno", (escola["id"],))]
    out = []
    for g in rows:
        aj = bases.ajustes.get(g["id_aluno"], {})
        corrigidos = [k for k in CAMPOS_AJUSTE if aj.get(k)]
        g.update({k: aj[k] for k in corrigidos})
        nn = norm_nome(g["aluno"]) if "aluno" in corrigidos else g["nome_norm"]
        nasc = g["dt_nasc"]
        c = achar(bases.censo, bases.censo_ch, nn, nasc, "dt_nasc")
        s = achar(bases.smtt, bases.smtt_ch, nn, nasc, "nascido")
        st = achar(bases.status_nome, bases.status_ch, nn, nasc, "nascimento")
        cpf_g, cpf_c, cpf_s = g["cpf"] or "", (c or {}).get("cpf") or "", (s or {}).get("cpf") or ""
        cpf_st = norm_cpf((st or {}).get("cpf"))
        cpf_m = norm_cpf(aj.get("cpf"))
        cpf = cpf_m or consolidar(cpf_g, cpf_c, cpf_s, cpf_st)
        mae = (aj.get("mae") or g["mae"] or (st or {}).get("mae") or "").strip()
        out.append({
            "id_aluno": g["id_aluno"], "aluno": g["aluno"].strip(), "nome_norm": nn, "dt_nasc": nasc,
            "genero": g["genero"], "ano_serie": g["ano_serie"], "turno": g["turno"], "turma": g["turma"],
            "grau": g.get("grau") or "", "curso": g.get("curso") or "",
            "modalidade": g["modalidade"], "mae": mae, "pai": (g["pai"] or "").strip(),
            "rua": g["rua"], "numero": g["numero"], "bairro": g["bairro"], "cidade": g["cidade"], "cep": g["cep"],
            "cpf_geduc": cpf_g, "cpf_censo": cpf_c, "cpf_smtt": cpf_s, "cpf_status": cpf_st, "cpf_manual": cpf_m,
            "cpf": cpf, "manual": bool(g.get("manual")), "corrigidos": corrigidos,
            "situacao": (st or {}).get("situacao") or "",
            "matricula": g.get("matricula") or (st or {}).get("matricula") or "",
            "telefone": aj.get("telefone") or g.get("telefone") or (st or {}).get("telefone")
                        or (s or {}).get("celular") or (s or {}).get("telefone") or "",
            "rg": aj.get("rg") or g.get("rg") or (s or {}).get("rg") or "",
            "org_exp": aj.get("org_exp") or g.get("org_exp") or (s or {}).get("org_exp") or "",
            "data_exp": aj.get("data_exp") or g.get("data_exp") or (s or {}).get("data_exp") or "",
            "cartao_smtt": (s or {}).get("cartao") or "", "no_smtt": bool(s), "no_censo": bool(c),
            "obs": aj.get("obs") or "",
            "migrado": bool(bases.migrados.get(g["id_aluno"])),
            "lotes": [m["lote"] for m in bases.migrados.get(g["id_aluno"], [])],
        })
    status = status_da_escola(bases, escola) if pelo_status(escola) and not todos else []
    if status:
        fora = {a["id_aluno"] for a in _fora_do_status(out, status)}
        out = [a for a in out if a["id_aluno"] not in fora]
    # pendencias (equivalentes aos filtros/formatacoes da aba ESCOLA)
    nomes = Counter(a["nome_norm"] for a in out)
    cpfs = Counter(a["cpf"] for a in out if a["cpf"] and a["cpf"] != DIVERGENTE)
    for a in out:
        p = []
        if not a["cpf"]:
            p.append("sem_cpf")
        elif a["cpf"] == DIVERGENTE:
            p.append("divergente")
        else:
            if not cpf_valido(a["cpf"]):
                p.append("cpf_invalido")
            if cpfs[a["cpf"]] > 1:
                p.append("cpf_duplicado")
        if nomes[a["nome_norm"]] > 1:
            p.append("nome_duplicado")
        if not a["mae"]:
            p.append("sem_mae")
        elif not nome_completo(a["mae"]):
            p.append("mae_incompleta")
        # criticas do validador oficial (CPF e mae ja cobertos pelas pendencias acima)
        # 0 = codigo da escola (alerta no nivel da escola, nao do aluno)
        a["criticas"] = [x for x in criticar_campos(campos_remessa(escola, a)) if x not in (0, 2, 14, 16, 18)]
        if a["criticas"]:
            p.append("critica_smtt")
        if not cursando(a):
            p.append("nao_cursando")
        a["pendencias"] = p
        a["apto"] = (a["cpf"] not in ("", DIVERGENTE) and not a["criticas"]
                     and not {"cpf_invalido", "cpf_duplicado", "sem_mae", "mae_incompleta", "nao_cursando"} & set(p))
    return out


def conferencia_status(con, escola, bases: Bases | None = None) -> dict:
    """Matriculados no sistema (GEDUC + cadastro individual) x base Alunos por status da mesma instituicao."""
    bases = bases or Bases(con)
    alunos = alunos_da_escola(con, escola, bases, todos=True)
    status = status_da_escola(bases, escola)
    so_status, so_sistema, nd = _casar_status(alunos, status)
    desde = pelo_status(escola) if status else ""
    fora = _fora_do_status(alunos, status) if desde else []
    if desde:  # os que nao estao no Alunos por status ja nao contam como matriculados
        ids = {a["id_aluno"] for a in fora}
        so_sistema = []
        nd = [x for x in nd if x[1]["id_aluno"] not in ids]
    campos_s = ("aluno", "nascimento", "turma", "turno", "sexo", "mae", "pai", "cpf", "telefone", "matricula", "endereco",
                "numero", "bairro", "situacao")
    campos_a = ("id_aluno", "aluno", "dt_nasc", "turma", "turno", "manual", "cpf")

    def outra_escola(s):
        outra = [r["escola"] for r in con.execute("SELECT escola, dt_nasc FROM geduc WHERE nome_norm=?", (s["nome_norm"],))
                 if not s["nascimento"] or (r["dt_nasc"] or "")[:10] == s["nascimento"]]
        return outra[0] if outra else ""

    so_status = [{**{k: s.get(k) or "" for k in campos_s}, "outra_escola": outra_escola(s)} for s in so_status]
    so_sistema = [{k: a[k] for k in campos_a} for a in so_sistema]
    return {"total_sistema": len(alunos) - len(fora), "total_status": len(status),
            "em_ambos": len(status) - len(so_status) - len(nd),
            "nome_diferente": [{"status": {k: s.get(k) or "" for k in campos_s}, "sistema": {k: a[k] for k in campos_a},
                                "similaridade": sim} for s, a, sim in nd],
            "so_status": sorted(so_status, key=lambda x: x["aluno"]), "so_sistema": sorted(so_sistema, key=lambda x: x["aluno"]),
            "pelo_status": desde, "fora": sorted(({k: a[k] for k in campos_a} for a in fora), key=lambda x: x["aluno"])}


def substituir_status(con, escola, recs: list[dict], arquivo: str) -> dict:
    """Troca o Alunos por status so desta instituicao (as outras ficam como estao) e passa a contar como matriculados
    apenas os alunos do arquivo. Linhas de outras instituicoes no arquivo sao ignoradas. Rode dentro de `with con`."""
    from .importer import inserir

    alvo = nomes_da_escola(escola)
    nome = escola["geduc_nome"] or escola["nome"]
    for r in recs:
        if not norm_nome(r.get("escola")):
            r["escola"] = nome
    meus = [r for r in recs if norm_nome(r["escola"]) in alvo]
    if not meus:
        achadas = Counter(r["escola"] for r in recs).most_common(3)
        raise ValueError(f"Nenhum aluno de {escola['nome']} no arquivo. Instituições encontradas: "
                         + ", ".join(f"{e} ({n})" for e, n in achadas))
    antigos = [(r["id"],) for r in con.execute("SELECT id, escola FROM status_alunos") if norm_nome(r["escola"]) in alvo]
    con.executemany("DELETE FROM status_alunos WHERE id=?", antigos)
    inserir(con, "status_alunos", meus)
    con.execute("INSERT INTO importacoes (base, arquivo, linhas) VALUES (?,?,?)",
                ("status_alunos", f"{arquivo} ({escola['nome']})", len(meus)))
    con.execute("UPDATE escolas SET status_atualizado_em=? WHERE id=?",
                (datetime.now().strftime("%Y-%m-%d %H:%M"), escola["id"]))
    return {"linhas": len(meus), "anteriores": len(antigos), "ignoradas": len(recs) - len(meus)}


def resumo(alunos: list[dict]) -> dict:
    n = len(alunos)
    com_cpf = sum(1 for a in alunos if a["cpf"] and a["cpf"] != DIVERGENTE)
    cont = Counter(p for a in alunos for p in a["pendencias"])
    migr = sum(a["migrado"] for a in alunos)
    return {"matriculados": n, "com_cpf": com_cpf, "sem_cpf": cont["sem_cpf"], "divergentes": cont["divergente"],
            "cpf_invalido": cont["cpf_invalido"], "cpf_duplicado": cont["cpf_duplicado"],
            "nome_duplicado": cont["nome_duplicado"], "sem_mae": cont["sem_mae"],
            "mae_incompleta": cont["mae_incompleta"],
            "aptos": sum(a["apto"] for a in alunos), "migrados": migr,
            "indice_cpf": round(com_cpf / n, 4) if n else 0,
            "indice_divergencia": round(cont["divergente"] / n, 4) if n else 0}


# ---------------------------------------------------------------- remessa SMTT (abas ALUNO / ENTRADA / NUM.CARACT)

# LAYOUT (21 campos, 375 colunas) vem de critica.py, identico ao validador oficial


def _turno(t: str) -> str:
    t = sem_acento(t or "").upper().strip()
    for k, v in (("MAT", "M"), ("MANHA", "M"), ("VESP", "V"), ("TARDE", "V"), ("NOT", "N"), ("NOITE", "N"),
                 ("INT", "I")):
        if t.startswith(k):
            return v
    return t[:1] if t in ("M", "V", "N", "I") else " "


def _ddmmaaaa(iso: str) -> str:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    return f"{m[3]}{m[2]}{m[1]}" if m else ""


DDD_PADRAO = "98"  # Sao Luis


def _fone(v: str) -> str:
    """Primeiro telefone valido do campo, no formato do layout (10 posicoes: DDD + 8)."""
    for parte in re.split(r"[/,;|]| E | OU ", (v or "").upper()):
        d = so_digitos(parte)
        if len(d) > 11 and d.startswith("55"):  # +55
            d = d[2:]
        if len(d) in (8, 9):  # sem DDD
            d = DDD_PADRAO + d
        if len(d) == 11:  # celular com 9 digitos: layout tem 10 posicoes (DDD + 8)
            d = d[:2] + d[3:]
        if len(d) == 10:
            return d
    return ""


def _serie(a: dict) -> str:
    m = re.search(r"\d", a["ano_serie"] or "")
    return m.group(0) if m else (a["turma"] or " ")[:1]


def campos_remessa(escola, a: dict) -> dict:
    return {
        "COD_INSTITUICAO": so_digitos(escola["cod_smtt"]).zfill(4) if escola["cod_smtt"] else "",
        "NOME_ESTUDANTE": a["aluno"], "MAE": a["mae"], "PAI": a["pai"],
        "SEXO": (a["genero"] or " ")[:1], "CURSO": a.get("curso") or escola["nivel"] or "ENSINO FUNDAMENTAL", "GRAU": a.get("grau") or "1",
        "SERIE_PERIODO": _serie(a), "TURNO": _turno(a["turno"]), "TURMA": (a["turma"] or "")[:3],
        "MATRICULA": (a["matricula"] or a["id_aluno"] or "").strip(), "DT_NASCIMENTO": _ddmmaaaa(a["dt_nasc"]),
        "ENDERECO": ", ".join(x for x in (a["rua"], a["numero"]) if x), "BAIRRO": a["bairro"],
        "CIDADE": a["cidade"] or "SAO LUIS", "CEP": (so_digitos(a["cep"]) or "65000000").ljust(8, "0")[:8],
        "FONE": _fone(a["telefone"]), "NUMERO_RG": a["rg"],
        "ORGAO_EXP": f"{a['org_exp']} MA" if a["rg"] and a["org_exp"] and "MA" not in a["org_exp"] else
                     (a["org_exp"] or ("SSP MA" if a["rg"] else "")),
        "DATA_EXP": _ddmmaaaa(a["data_exp"]), "CPF": a["cpf"] if a["cpf"] != DIVERGENTE else "",
    }


def linha_remessa(campos: dict, remover_acentos: bool) -> tuple[str, list[str]]:
    avisos, partes = [], []
    for nome, tam in LAYOUT:
        v = re.sub(r"\s+", " ", str(campos.get(nome) or "")).strip().upper()  # quebra de linha partiria o registro
        if remover_acentos:
            v = sem_acento(v)
        if len(v) > tam:
            avisos.append(f"{nome} truncado ({len(v)} > {tam})")
            v = v[:tam]
        partes.append(v.ljust(tam))
    return "".join(partes), avisos


def gerar_remessa(con, escola, ids: list[str], remover_acentos: bool = True) -> dict:
    alunos = {a["id_aluno"]: a for a in alunos_da_escola(con, escola)}
    linhas, itens = [], []
    for i in ids:
        a = alunos.get(i)
        if not a:
            continue
        campos = campos_remessa(escola, a)
        linha, avisos = linha_remessa(campos, remover_acentos)
        cods = criticar_campos(campos)
        if a["cpf"] == DIVERGENTE:
            cods.append(14)
        elif "cpf_duplicado" in a["pendencias"]:
            cods.append(15)
        erros = [f"({x}) {LEGENDA[x]}" for x in sorted(set(cods))]
        if not cursando(a):
            erros.append(f"Situação {a['situacao']}: só alunos cursando entram na remessa")
        linhas.append(linha)
        itens.append({"id_aluno": i, "aluno": a["aluno"], "cpf": a["cpf"], "campos": campos, "avisos": avisos,
                      "codigos": sorted(set(cods)), "erros": erros})
    # CPF repetido dentro da propria remessa (critica 15)
    vistos = {}
    for it in itens:
        if it["campos"]["CPF"]:
            vistos.setdefault(it["campos"]["CPF"], []).append(it)
    for grupo in vistos.values():
        if len(grupo) > 1:
            for it in grupo:
                if 15 not in it["codigos"]:
                    it["codigos"].append(15)
                    it["erros"].append(f"(15) {LEGENDA[15]}")
    return {"itens": itens, "conteudo": "\r\n".join(linhas) + ("\r\n" if linhas else ""), "tam_linha": TAM_LINHA}


def salvar_lote(con, escola, remessa: dict) -> int:
    validos = [i for i in remessa["itens"] if not i["erros"]]
    if not validos:
        raise ValueError("Nenhum aluno apto na selecao")
    # UTF-8 SEM BOM: o validador oficial (AlunoCriticaUtf8) conta o BOM como caractere e reprova a 1a linha
    # com 376 colunas; sem acentos o arquivo e ASCII puro
    linhas = [linha_remessa(i["campos"], True)[0] for i in validos]
    conteudo = ("\r\n".join(linhas) + "\r\n").encode("utf-8")
    seq = con.execute("SELECT COALESCE(MAX(num_remessa), 0) + 1 FROM lotes WHERE escola_id=?",
                      (escola["id"],)).fetchone()[0]
    nome = f"INST_{so_digitos(escola['cod_smtt']).zfill(4)}_REM_{seq:02d}.txt"
    with con:
        lid = con.execute("""INSERT INTO lotes (escola_id, num_remessa, n_alunos, arquivo, conteudo)
                             VALUES (?,?,?,?,?) RETURNING id""",
                          (escola["id"], seq, len(validos), nome, conteudo)).fetchone()[0]
        con.executemany("INSERT INTO lote_alunos (lote_id, id_aluno, nome, cpf) VALUES (?,?,?,?)",
                        [(lid, i["id_aluno"], i["aluno"], i["cpf"]) for i in validos])
    return lid


# ---------------------------------------------------------------- orcamento (aba ORCAMENTO)

def orcamento(con, escola, res: dict | None = None) -> dict:
    """Valor = matriculados com CPF (consolidado, ou o numero informado) x valor unitario por aluno
    + peticionamento - desconto. Os migrados aparecem so como acompanhamento."""
    res = res or resumo(alunos_da_escola(con, escola))
    preco = float(db.get_config(con, "preco_unitario", "0.43"))
    matric = escola["matriculados_info"] or res["com_cpf"]
    migr = con.execute("""SELECT COUNT(DISTINCT la.id_aluno) FROM lote_alunos la JOIN lotes l ON l.id = la.lote_id
                          WHERE l.escola_id = ? AND COALESCE(la.cpf, '') <> ''""", (escola["id"],)).fetchone()[0]
    pet, desc = escola["peticionamento"] or 0, escola["desconto"] or 0
    return {"matriculados": matric, "migrados": migr, "nao_migrados": max(matric - migr, 0),
            "indice": round(migr / matric, 4) if matric else 0, "preco_unitario": preco,
            "subtotal": round(matric * preco, 2), "peticionamento": pet, "desconto": desc,
            "total": round(matric * preco + pet - desc, 2)}


def relatorio(alunos: list[dict], tipo: str) -> list[dict]:
    if tipo == "sem_cpf":
        sel = [a for a in alunos if "sem_cpf" in a["pendencias"] or "divergente" in a["pendencias"]]
    elif tipo == "sem_mae":
        sel = [a for a in alunos if {"sem_mae", "mae_incompleta"} & set(a["pendencias"])]
    else:
        sel = alunos
    return [{"aluno": a["aluno"], "dt_nasc": a["dt_nasc"], "sexo": (a["genero"] or "")[:1], "mae": a["mae"],
             "turma": a["turma"], "cpf": a["cpf"] if a["cpf"] != DIVERGENTE else "",
             "cpf_mascarado": mascara_cpf(a["cpf"]) if a["cpf"] != DIVERGENTE else "",
             "divergente": a["cpf"] == DIVERGENTE} for a in sorted(sel, key=lambda x: x["nome_norm"])]
