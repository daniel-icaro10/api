"""API + telas do SIS SMPE."""
import difflib
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import critica, db, importer, logic
from .util import norm_cpf, norm_nome

app = FastAPI(title="SIS SMPE")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")
_import = {"rodando": False, "msg": [], "erro": None}


def _escola(con, eid: int):
    e = con.execute("SELECT * FROM escolas WHERE id=?", (eid,)).fetchone()
    if not e:
        raise HTTPException(404, "Escola nao encontrada")
    return e


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


# ------------------------------------------------------------------ painel

@app.get("/api/painel")
def painel():
    con = db.connect()
    bases = logic.Bases(con)
    escolas = []
    for e in con.execute("SELECT * FROM escolas ORDER BY id"):
        r = logic.resumo(logic.alunos_da_escola(con, e, bases))
        escolas.append({"id": e["id"], "nome": e["nome"], "cod_smtt": e["cod_smtt"], **r})
    tot = {k: sum(x[k] for x in escolas) for k in
           ("matriculados", "com_cpf", "sem_cpf", "divergentes", "cpf_invalido", "sem_mae", "aptos", "migrados")}
    tot["indice_cpf"] = round(tot["com_cpf"] / tot["matriculados"], 4) if tot["matriculados"] else 0
    tot["escolas"] = len(escolas)
    tot["sem_vinculo"] = sum(1 for x in escolas if not x["matriculados"])
    bases_info = {b: con.execute(f"SELECT COUNT(*) FROM {b}").fetchone()[0]
                  for b in ("geduc", "censo", "smtt", "status_alunos")}
    ult = {r["base"]: r["importado_em"] for r in con.execute(
        "SELECT base, MAX(importado_em) importado_em FROM importacoes GROUP BY base")}
    lotes = con.execute("SELECT COUNT(*), CAST(COALESCE(SUM(n_alunos),0) AS INTEGER) FROM lotes").fetchone()
    return {"totais": tot, "escolas": escolas, "bases": bases_info, "ultima_importacao": ult,
            "lotes": {"n": lotes[0], "alunos": lotes[1]}}


# ------------------------------------------------------------------ escolas

class EscolaIn(BaseModel):
    id: int | None = None
    nome: str
    cod_smtt: str = ""
    inep: str = ""
    geduc_nome: str = ""
    nivel: str = "ENSINO FUNDAMENTAL"
    matriculados_info: int | None = None
    peticionamento: float = 0
    desconto: float = 0


@app.get("/api/escolas")
def listar_escolas():
    con = db.connect()
    return [dict(r) for r in con.execute("SELECT * FROM escolas ORDER BY id")]


@app.post("/api/escolas")
def criar_escola(e: EscolaIn):
    con = db.connect()
    eid = e.id or (con.execute("SELECT COALESCE(MAX(id),0)+1 FROM escolas").fetchone()[0])
    if con.execute("SELECT 1 FROM escolas WHERE id=?", (eid,)).fetchone():
        raise HTTPException(400, f"Ja existe escola com ID {eid}")
    with con:
        con.execute("""INSERT INTO escolas (id, nome, cod_smtt, inep, geduc_nome, nivel, matriculados_info,
                       peticionamento, desconto) VALUES (?,?,?,?,?,?,?,?,?)""",
                    (eid, e.nome.strip(), e.cod_smtt.strip(), e.inep.strip(), e.geduc_nome.strip(), e.nivel,
                     e.matriculados_info, e.peticionamento, e.desconto))
    return {"id": eid}


@app.put("/api/escolas/{eid}")
def editar_escola(eid: int, e: EscolaIn):
    con = db.connect()
    _escola(con, eid)
    with con:
        con.execute("""UPDATE escolas SET nome=?, cod_smtt=?, inep=?, geduc_nome=?, nivel=?, matriculados_info=?,
                       peticionamento=?, desconto=? WHERE id=?""",
                    (e.nome.strip(), e.cod_smtt.strip(), e.inep.strip(), e.geduc_nome.strip(), e.nivel,
                     e.matriculados_info, e.peticionamento, e.desconto, eid))
    return {"ok": True}


@app.delete("/api/escolas/{eid}")
def excluir_escola(eid: int):
    con = db.connect()
    if con.execute("SELECT 1 FROM lotes WHERE escola_id=?", (eid,)).fetchone():
        raise HTTPException(400, "Escola possui remessas geradas; exclua as remessas antes")
    with con:
        con.execute("DELETE FROM escolas WHERE id=?", (eid,))
    return {"ok": True}


@app.get("/api/geduc/escolas")
def escolas_geduc(sugerir_para: str = ""):
    """Escolas existentes no GEDUC (para vincular o cadastro), ordenadas por semelhanca com `sugerir_para`."""
    con = db.connect()
    rows = [dict(r) for r in con.execute(
        "SELECT MIN(escola) escola, MIN(inep_escola) inep_escola, COUNT(*) alunos FROM geduc GROUP BY escola_norm "
        "ORDER BY 1")]
    if sugerir_para:
        alvo = norm_nome(sugerir_para)
        for r in rows:
            r["similaridade"] = round(difflib.SequenceMatcher(None, alvo, norm_nome(r["escola"])).ratio(), 3)
        rows.sort(key=lambda r: -r["similaridade"])
    return rows


# ------------------------------------------------------------------ alunos / migracao

@app.get("/api/escolas/{eid}/alunos")
def alunos(eid: int):
    con = db.connect()
    e = _escola(con, eid)
    al = logic.alunos_da_escola(con, e)
    return {"escola": dict(e), "resumo": logic.resumo(al), "alunos": al}


class AjusteIn(BaseModel):
    cpf: str = ""
    mae: str = ""
    rg: str = ""
    org_exp: str = ""
    data_exp: str = ""
    telefone: str = ""
    obs: str = ""


@app.put("/api/alunos/{id_aluno}/ajuste")
def ajustar(id_aluno: str, a: AjusteIn):
    con = db.connect()
    if not con.execute("SELECT 1 FROM geduc WHERE id_aluno=?", (id_aluno,)).fetchone():
        raise HTTPException(404, "Aluno nao encontrado")
    cpf = norm_cpf(a.cpf)
    if a.cpf and len(cpf) != 11:
        raise HTTPException(400, "CPF deve ter 11 digitos")
    vals = (cpf, a.mae.strip().upper(), a.rg.strip(), a.org_exp.strip().upper(), a.data_exp, a.telefone.strip(),
            a.obs.strip())
    with con:
        if not any(vals):
            con.execute("DELETE FROM ajustes WHERE id_aluno=?", (id_aluno,))
        else:
            con.execute("""INSERT INTO ajustes (id_aluno, cpf, mae, rg, org_exp, data_exp, telefone, obs)
                           VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id_aluno) DO UPDATE SET cpf=excluded.cpf,
                           mae=excluded.mae, rg=excluded.rg, org_exp=excluded.org_exp, data_exp=excluded.data_exp,
                           telefone=excluded.telefone, obs=excluded.obs, atualizado_em=datetime('now','localtime')""",
                        (id_aluno, *vals))
    return {"ok": True}


@app.get("/api/alunos/busca")
def busca(q: str):
    """Botao 'Localizar Estudante' do MENU, em toda a rede."""
    con = db.connect()
    q = q.strip()
    if len(q) < 3:
        return []
    cpf = norm_cpf(q)
    if len(cpf) == 11 and q.replace(".", "").replace("-", "").isdigit():
        rows = con.execute("SELECT * FROM geduc WHERE cpf=? LIMIT 1000", (cpf,))
    else:
        rows = con.execute("SELECT * FROM geduc WHERE nome_norm LIKE ? ORDER BY aluno LIMIT 1000",
                           (f"%{norm_nome(q)}%",))
    escolas = [dict(e) for e in con.execute("SELECT * FROM escolas")]
    out = []
    for r in rows:
        esc = next((e for e in escolas if norm_nome(e["geduc_nome"] or e["nome"]) == r["escola_norm"]
                    or (e["inep"] and e["inep"] == r["inep_escola"])), None)
        out.append({"id_aluno": r["id_aluno"], "aluno": r["aluno"], "dt_nasc": r["dt_nasc"], "escola": r["escola"],
                    "turma": r["turma"], "turno": r["turno"], "mae": r["mae"], "cpf_geduc": r["cpf"],
                    "escola_id": esc["id"] if esc else None})
    return out


@app.get("/api/alunos/{id_aluno}")
def detalhe_aluno(id_aluno: str):
    con = db.connect()
    g = con.execute("SELECT * FROM geduc WHERE id_aluno=?", (id_aluno,)).fetchone()
    if not g:
        raise HTTPException(404)
    nn = g["nome_norm"]
    return {"geduc": dict(g),
            "censo": [dict(r) for r in con.execute("SELECT * FROM censo WHERE nome_norm=?", (nn,))],
            "smtt": [dict(r) for r in con.execute("SELECT * FROM smtt WHERE nome_norm=?", (nn,))],
            "status": [dict(r) for r in con.execute(
                "SELECT * FROM status_alunos WHERE id_aluno=? OR nome_norm=?", (id_aluno, nn))],
            "ajuste": dict(r) if (r := con.execute("SELECT * FROM ajustes WHERE id_aluno=?", (id_aluno,)).fetchone())
            else None,
            "lotes": [dict(r) for r in con.execute(
                """SELECT l.id, l.criado_em, l.arquivo, e.nome escola FROM lote_alunos la JOIN lotes l ON l.id=la.lote_id
                   JOIN escolas e ON e.id=l.escola_id WHERE la.id_aluno=?""", (id_aluno,))]}


# ------------------------------------------------------------------ remessas

class RemessaIn(BaseModel):
    ids: list[str]
    remover_acentos: bool = True


@app.post("/api/escolas/{eid}/remessa/previa")
def previa(eid: int, body: RemessaIn):
    con = db.connect()
    r = logic.gerar_remessa(con, _escola(con, eid), body.ids, body.remover_acentos)
    return {"itens": r["itens"], "tam_linha": r["tam_linha"], "layout": logic.LAYOUT,
            "amostra": r["conteudo"].split("\r\n")[:5]}


@app.post("/api/escolas/{eid}/remessa")
def gerar(eid: int, body: RemessaIn):
    con = db.connect()
    e = _escola(con, eid)
    r = logic.gerar_remessa(con, e, body.ids, body.remover_acentos)
    try:
        lid = logic.salvar_lote(con, e, r)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {"lote_id": lid, "incluidos": sum(1 for i in r["itens"] if not i["erros"]),
            "rejeitados": [i for i in r["itens"] if i["erros"]]}


@app.get("/api/lotes")
def lotes(escola_id: int | None = None):
    con = db.connect()
    sql = """SELECT l.id, l.escola_id, e.nome escola, l.criado_em, l.n_alunos, l.arquivo FROM lotes l
             JOIN escolas e ON e.id = l.escola_id"""
    args = []
    if escola_id:
        sql += " WHERE l.escola_id=?"
        args.append(escola_id)
    return [dict(r) for r in con.execute(sql + " ORDER BY l.id DESC", args)]


@app.get("/api/lotes/{lid}/alunos")
def lote_alunos(lid: int):
    con = db.connect()
    return [dict(r) for r in con.execute("SELECT * FROM lote_alunos WHERE lote_id=? ORDER BY nome", (lid,))]


@app.get("/api/lotes/{lid}/arquivo")
def baixar_lote(lid: int):
    con = db.connect()
    r = con.execute("SELECT arquivo, conteudo FROM lotes WHERE id=?", (lid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return Response(r["conteudo"], media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{r["arquivo"]}"'})


def _critica_resp(data: bytes, nome: str) -> dict:
    res = critica.criticar_arquivo(data, nome)
    res["relatorio"] = critica.relatorio_txt(res)
    res["relatorio_nome"] = "CRITICA_" + Path(nome or "remessa.txt").stem + ".txt"
    return res


@app.post("/api/critica")
async def criticar_upload(arquivo: UploadFile = File(...)):
    """Tela 'Criticar remessa': mesmas regras do validador oficial AlunoCriticaUtf8.exe."""
    return _critica_resp(await arquivo.read(), arquivo.filename or "")


@app.get("/api/lotes/{lid}/critica")
def criticar_lote(lid: int):
    con = db.connect()
    r = con.execute("SELECT arquivo, conteudo FROM lotes WHERE id=?", (lid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return _critica_resp(r["conteudo"], r["arquivo"])


@app.delete("/api/lotes/{lid}")
def excluir_lote(lid: int):
    con = db.connect()
    with con:
        con.execute("DELETE FROM lotes WHERE id=?", (lid,))
    return {"ok": True}


# ------------------------------------------------------------------ relatorios / orcamento

@app.get("/api/escolas/{eid}/relatorio/{tipo}")
def relatorio(eid: int, tipo: str):
    if tipo not in ("sem_cpf", "sem_mae", "simplificada"):
        raise HTTPException(400)
    con = db.connect()
    e = _escola(con, eid)
    return {"escola": dict(e), "itens": logic.relatorio(logic.alunos_da_escola(con, e), tipo)}


@app.get("/api/escolas/{eid}/orcamento")
def orcamento(eid: int):
    con = db.connect()
    e = _escola(con, eid)
    return {"escola": dict(e), **logic.orcamento(con, e)}


class OrcIn(BaseModel):
    matriculados_info: int | None = None
    peticionamento: float = 0
    desconto: float = 0


@app.put("/api/escolas/{eid}/orcamento")
def salvar_orcamento(eid: int, o: OrcIn):
    con = db.connect()
    _escola(con, eid)
    with con:
        con.execute("UPDATE escolas SET matriculados_info=?, peticionamento=?, desconto=? WHERE id=?",
                    (o.matriculados_info, o.peticionamento, o.desconto, eid))
    return orcamento(eid)


@app.get("/api/config")
def config():
    con = db.connect()
    return {r["chave"]: r["valor"] for r in con.execute("SELECT * FROM config")}


@app.put("/api/config")
def salvar_config(cfg: dict):
    con = db.connect()
    with con:
        for k, v in cfg.items():
            con.execute("INSERT INTO config VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
                        (k, str(v)))
    return config()


# ------------------------------------------------------------------ importacao

@app.get("/api/importacoes")
def importacoes():
    con = db.connect()
    return {"historico": [dict(r) for r in con.execute("SELECT * FROM importacoes ORDER BY id DESC LIMIT 1000")],
            "bases": {b: {"label": importer.LABELS[b], "aba": importer.BASES[b][0].strip(),
                          "linhas": con.execute(f"SELECT COUNT(*) FROM {b}").fetchone()[0]} for b in importer.BASES},
            "status": _import}


@app.post("/api/importar")
async def importar(base: str = Form(...), arquivo: UploadFile = File(...)):
    if _import["rodando"]:
        raise HTTPException(409, "Ja existe uma importacao em andamento")
    data = await arquivo.read()
    nome = arquivo.filename or "arquivo"

    def job():
        _import.update(rodando=True, msg=[], erro=None)
        try:
            con = db.connect()
            if base == "planilha":
                import tempfile

                with tempfile.NamedTemporaryFile(suffix=".xlsm", delete=False) as f:
                    f.write(data)
                importer.import_workbook(f.name, log=_import["msg"].append)
                Path(f.name).unlink(missing_ok=True)
            else:
                if base not in importer.BASES:
                    raise ValueError("Base desconhecida")
                recs = importer.read_file(base, nome, data)
                n = importer.save(con, base, recs, nome)
                _import["msg"].append(f"{importer.LABELS[base]}: {n} linhas")
        except Exception as ex:
            _import["erro"] = str(ex)
        finally:
            _import["rodando"] = False

    threading.Thread(target=job, daemon=True).start()
    return {"ok": True}
