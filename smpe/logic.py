"""Regras de negocio da planilha SIS SMPE: cruzamento de CPF, pendencias, remessa SMTT e orcamento."""
import re
from collections import Counter, defaultdict
import codecs

from . import db
from .critica import LAYOUT, LEGENDA, TAM_LINHA, criticar_campos
from .util import cpf_valido, mascara_cpf, nome_completo, norm_cpf, norm_nome, sem_acento, so_digitos

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
        self.censo = defaultdict(list)
        for r in con.execute("SELECT * FROM censo"):
            self.censo[r["nome_norm"]].append(dict(r))
        self.smtt = defaultdict(list)
        for r in con.execute("SELECT * FROM smtt"):
            self.smtt[r["nome_norm"]].append(dict(r))
        self.status_id, self.status_nome = {}, defaultdict(list)
        for r in con.execute("SELECT * FROM status_alunos"):
            d = dict(r)
            if d["id_aluno"]:
                self.status_id[d["id_aluno"]] = d
            self.status_nome[d["nome_norm"]].append(d)
        self.ajustes = {r["id_aluno"]: dict(r) for r in con.execute("SELECT * FROM ajustes")}
        self.migrados = defaultdict(list)
        for r in con.execute("""SELECT la.id_aluno, l.id, l.criado_em, l.escola_id FROM lote_alunos la
                                JOIN lotes l ON l.id = la.lote_id ORDER BY l.id"""):
            self.migrados[r["id_aluno"]].append({"lote": r["id"], "em": r["criado_em"], "escola_id": r["escola_id"]})


def _pick(cands: list[dict], nasc: str, campo_nasc: str) -> dict | None:
    """Varios registros com o mesmo nome: prefere o de mesma data de nascimento."""
    if not cands:
        return None
    if len(cands) > 1 and nasc:
        for c in cands:
            if (c.get(campo_nasc) or "")[:10] == nasc:
                return c
    return cands[0]


def filtro_escola(escola) -> tuple[str, list]:
    nome = norm_nome(escola["geduc_nome"] or escola["nome"])
    if escola["inep"]:
        return "(escola_norm = ? OR inep_escola = ?)", [nome, escola["inep"]]
    return "escola_norm = ?", [nome]


# campos do aluno que a instituicao pode corrigir (tabela ajustes) antes de reprocessar
CAMPOS_AJUSTE = ("aluno", "pai", "genero", "dt_nasc", "ano_serie", "turno", "turma", "matricula", "rua", "numero",
                 "bairro", "cidade", "cep")


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


def alunos_da_escola(con, escola, bases: Bases | None = None) -> list[dict]:
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
        c = _pick(bases.censo.get(nn, []), nasc, "dt_nasc")
        s = _pick(bases.smtt.get(nn, []), nasc, "nascido")
        st = bases.status_id.get(g["id_aluno"]) or _pick(bases.status_nome.get(nn, []), nasc, "nascimento")
        cpf_g, cpf_c, cpf_s = g["cpf"] or "", (c or {}).get("cpf") or "", (s or {}).get("cpf") or ""
        cpf_st = norm_cpf((st or {}).get("cpf"))
        cpf_m = norm_cpf(aj.get("cpf"))
        cpf = cpf_m or consolidar(cpf_g, cpf_c, cpf_s, cpf_st)
        mae = (aj.get("mae") or g["mae"] or (st or {}).get("mae") or "").strip()
        out.append({
            "id_aluno": g["id_aluno"], "aluno": g["aluno"].strip(), "nome_norm": nn, "dt_nasc": nasc,
            "genero": g["genero"], "ano_serie": g["ano_serie"], "turno": g["turno"], "turma": g["turma"],
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
        a["pendencias"] = p
        a["apto"] = (a["cpf"] not in ("", DIVERGENTE) and not a["criticas"]
                     and not {"cpf_invalido", "cpf_duplicado", "sem_mae", "mae_incompleta"} & set(p))
    return out


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
        "SEXO": (a["genero"] or " ")[:1], "CURSO": escola["nivel"] or "ENSINO FUNDAMENTAL", "GRAU": "1",
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
        v = str(campos.get(nome) or "").upper()
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
        linhas.append(linha)
        itens.append({"id_aluno": i, "aluno": a["aluno"], "cpf": a["cpf"], "campos": campos, "avisos": avisos,
                      "codigos": sorted(set(cods)), "erros": [f"({x}) {LEGENDA[x]}" for x in sorted(set(cods))]})
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
    # o validador oficial so aceita UTF-8 (AlunoCriticaUtf8); BOM configuravel (padrao: com BOM)
    linhas = [linha_remessa(i["campos"], True)[0] for i in validos]
    conteudo = ("\r\n".join(linhas) + "\r\n").encode("utf-8")
    if db.get_config(con, "remessa_bom", "1") == "1":
        conteudo = codecs.BOM_UTF8 + conteudo
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
    """So entram no orcamento alunos com CPF: a base e o total de matriculados com CPF consolidado."""
    res = res or resumo(alunos_da_escola(con, escola))
    preco = float(db.get_config(con, "preco_unitario", "0.43"))
    matric = escola["matriculados_info"] or res["com_cpf"]
    migr = con.execute("""SELECT COUNT(DISTINCT la.id_aluno) FROM lote_alunos la JOIN lotes l ON l.id = la.lote_id
                          WHERE l.escola_id = ? AND COALESCE(la.cpf, '') <> ''""", (escola["id"],)).fetchone()[0]
    pet, desc = escola["peticionamento"] or 0, escola["desconto"] or 0
    return {"matriculados": matric, "migrados": migr, "nao_migrados": max(matric - migr, 0),
            "indice": round(migr / matric, 4) if matric else 0, "preco_unitario": preco,
            "subtotal": round(migr * preco, 2), "peticionamento": pet, "desconto": desc,
            "total": round(migr * preco + pet - desc, 2)}


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
