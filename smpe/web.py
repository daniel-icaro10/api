"""API + telas do SIS SMPE."""
import difflib
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import traceback
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import critica, db, exportar, fichas, importer, logic, pdf
from .util import chave_nome, cpf_valido, norm_cpf, norm_nome, so_digitos

@asynccontextmanager
async def _ciclo(_app):
    _recupera_admin()
    yield


app = FastAPI(title="SIS SMPE", lifespan=_ciclo)
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")
_import = {"rodando": False, "msg": [], "erro": None, "base": "", "arquivo": "", "inicio": 0, "etapa": ""}
_import_thread: threading.Thread | None = None


def _import_status() -> dict:
    """Estado da importacao; se a tarefa morreu sem avisar (ex.: reinicio), libera para uma nova."""
    if _import["rodando"] and _import_thread is not None and not _import_thread.is_alive():
        _import.update(rodando=False, erro=_import["erro"] or "A importação foi interrompida. Envie o arquivo de novo.")
    return {**_import, "segundos": int(time.time() - _import["inicio"]) if _import["inicio"] else 0}


@app.exception_handler(Exception)
async def erro_interno(request: Request, ex: Exception):
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": f"Erro interno no servidor ({type(ex).__name__}: {str(ex)[:300]})"})


@app.middleware("http")
async def sem_cache_das_telas(request: Request, call_next):
    """O navegador sempre confere se a pagina e os arquivos mudaram (evita tela antiga apos atualizar o sistema)."""
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


# ------------------------------------------------------------------ acesso (perfis admin e instituicao)

COOKIE = "smpe_sessao"
SESSAO_HORAS = 12


def _hash(senha: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"pbkdf2${salt}${h}"


def _confere(senha: str, guardado: str) -> bool:
    try:
        _, salt, _h = guardado.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_hash(senha, salt), guardado)


EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def _norm_login(login: str) -> str:
    """O usuario e o e-mail, sem diferenca de maiusculas. Logins antigos por CPF aceitam ponto e traco."""
    login = login.strip().lower()
    return so_digitos(login) if re.fullmatch(r"[\d.\-\s]+", login) else login


def _email_ok(login: str) -> bool:
    return bool(EMAIL_RE.fullmatch(login))


def _valida_senha(senha: str):
    if len(senha) < 6:
        raise HTTPException(400, "A senha deve ter ao menos 6 caracteres")


def _admin_inicial(con):
    """Cria o administrador a partir de SMPE_ADMIN_LOGIN/SMPE_ADMIN_SENHA, se o banco ainda nao tiver usuarios."""
    login, senha = os.environ.get("SMPE_ADMIN_LOGIN", "").strip().lower(), os.environ.get("SMPE_ADMIN_SENHA", "")
    if login and senha and not con.execute("SELECT 1 FROM usuarios LIMIT 1").fetchone():
        with con:
            con.execute("INSERT INTO usuarios (login, senha_hash, perfil) VALUES (?,?,'admin')", (login, _hash(senha)))


def _recupera_admin():
    """Recuperacao de acesso: com SMPE_RESET_LOGIN e SMPE_RESET_SENHA definidas (ex.: no Render), cria esse
    administrador ou redefine a senha dele ao iniciar. Depois de entrar, apague as duas variaveis."""
    login = _norm_login(os.environ.get("SMPE_RESET_LOGIN", ""))
    senha = os.environ.get("SMPE_RESET_SENHA", "")
    if not (login or senha):
        return
    if not _email_ok(login) or len(senha) < 6:
        print("SMPE_RESET_LOGIN deve ser um e-mail e SMPE_RESET_SENHA ter ao menos 6 caracteres; recuperação ignorada")
        return
    con = db.connect()
    r = con.execute("SELECT id FROM usuarios WHERE login=?", (login,)).fetchone()
    with con:
        if r:
            con.execute("UPDATE usuarios SET senha_hash=?, perfil='admin' WHERE id=?", (_hash(senha), r["id"]))
            con.execute("DELETE FROM sessoes WHERE usuario_id=?", (r["id"],))
            con.execute("DELETE FROM usuario_escolas WHERE usuario_id=?", (r["id"],))
        else:
            con.execute("INSERT INTO usuarios (login, senha_hash, perfil) VALUES (?,?,'admin')", (login, _hash(senha)))
    print(f"Recuperação de acesso: administrador {login} {'com senha redefinida' if r else 'criado'}. "
          "Apague SMPE_RESET_LOGIN e SMPE_RESET_SENHA.")


def _bloqueio_msg(motivo: str) -> str:
    return "Acesso da instituição bloqueado" + (f": {motivo}" if motivo else "") + ". Procure o suporte."


def _instituicoes(con, uid: int) -> list[dict]:
    return [dict(r) for r in con.execute(
        """SELECT e.id, e.nome, e.bloqueado, e.motivo_bloqueio FROM usuario_escolas ue
           JOIN escolas e ON e.id = ue.escola_id WHERE ue.usuario_id=? ORDER BY e.nome""", (uid,))]


def _escopo(insts: list[dict], preferida: int | None) -> dict:
    """Instituicao ativa do usuario (a preferida, se continuar liberada) e as que ele pode alternar."""
    if not insts:
        raise HTTPException(403, "Acesso sem instituição vinculada. Procure o administrador.")
    livres = [e for e in insts if not e["bloqueado"]]
    if not livres:
        raise HTTPException(403, _bloqueio_msg(insts[0]["motivo_bloqueio"]))
    ativa = next((e for e in livres if e["id"] == preferida), livres[0])
    return {"escola_id": ativa["id"], "escola_nome": ativa["nome"],
            "escolas": [{"id": e["id"], "nome": e["nome"]} for e in livres]}


def usuario(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Faça login")
    con = db.connect()
    r = con.execute("""SELECT u.id, u.login, u.perfil, s.expira, s.escola_id ativa FROM sessoes s
                       JOIN usuarios u ON u.id = s.usuario_id WHERE s.token=?""", (token,)).fetchone()
    if not r or r["expira"] < time.time():
        raise HTTPException(401, "Sessão expirada, faça login novamente")
    u = {**dict(r), "token": token}
    if u["perfil"] == "admin":
        return {**u, "escola_id": None, "escola_nome": "", "escolas": []}
    return {**u, **_escopo(_instituicoes(con, u["id"]), u["ativa"])}


def admin(u: dict = Depends(usuario)) -> dict:
    if u["perfil"] != "admin":
        raise HTTPException(403, "Somente o administrador pode fazer isso")
    return u


def _eh_admin(u: dict) -> bool:
    return u["perfil"] == "admin"


def _escola(con, eid: int, u: dict | None = None):
    if u and not _eh_admin(u) and eid != u["escola_id"]:
        raise HTTPException(403, "Sem acesso a esta instituição")
    e = con.execute("SELECT * FROM escolas WHERE id=?", (eid,)).fetchone()
    if not e:
        raise HTTPException(404, "Instituição não encontrada")
    return e


def _checa_aluno(con, u: dict, id_aluno: str):
    if not _eh_admin(u) and not logic.aluno_na_escola(con, _escola(con, u["escola_id"]), id_aluno):
        raise HTTPException(403, "Aluno de outra instituição")


def _sessao_json(u: dict) -> dict:
    return {"login": u["login"], "perfil": u["perfil"], "escola_id": u.get("escola_id"),
            "escola_nome": u.get("escola_nome") or "", "escolas": u.get("escolas") or []}


class LoginIn(BaseModel):
    login: str
    senha: str


@app.get("/api/publico")
def publico():
    """Informacoes da tela de login (sem autenticacao)."""
    con = db.connect()
    _admin_inicial(con)
    return {"precisa_setup": not con.execute("SELECT 1 FROM usuarios LIMIT 1").fetchone(),
            "whatsapp": so_digitos(db.get_config(con, "whatsapp")), "suporte_texto": db.get_config(con, "suporte_texto")}


def _abre_sessao(con, request: Request, response: Response, uid: int, escola_id: int | None = None):
    token = secrets.token_urlsafe(32)
    with con:
        con.execute("DELETE FROM sessoes WHERE expira < ?", (time.time(),))
        con.execute("INSERT INTO sessoes (token, usuario_id, expira, escola_id) VALUES (?,?,?,?)",
                    (token, uid, time.time() + SESSAO_HORAS * 3600, escola_id))
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    # sem max_age: cookie de sessao, apagado ao fechar o navegador (o servidor ainda expira em SESSAO_HORAS)
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=https)


@app.post("/api/setup")
def setup(d: LoginIn, request: Request, response: Response):
    """Primeiro acesso: cria o administrador quando ainda nao existe nenhum usuario."""
    con = db.connect()
    if con.execute("SELECT 1 FROM usuarios LIMIT 1").fetchone():
        raise HTTPException(400, "O administrador já foi criado")
    login = _norm_login(d.login)
    if not _email_ok(login):
        raise HTTPException(400, "O usuário deve ser um e-mail válido")
    _valida_senha(d.senha)
    with con:
        uid = con.execute("INSERT INTO usuarios (login, senha_hash, perfil) VALUES (?,?,'admin') RETURNING id",
                          (login, _hash(d.senha))).fetchone()[0]
    _abre_sessao(con, request, response, uid)
    return {"login": login, "perfil": "admin", "escola_id": None, "escola_nome": ""}


@app.post("/api/login")
def login(d: LoginIn, request: Request, response: Response):
    con = db.connect()
    r = con.execute("SELECT * FROM usuarios WHERE login=?", (_norm_login(d.login),)).fetchone()
    if not r or not _confere(d.senha, r["senha_hash"]):
        raise HTTPException(401, "Login ou senha inválidos")
    esc = {} if r["perfil"] == "admin" else _escopo(_instituicoes(con, r["id"]), None)
    _abre_sessao(con, request, response, r["id"], esc.get("escola_id"))
    return _sessao_json({**dict(r), **esc})


@app.post("/api/logout")
def logout(request: Request, response: Response):
    con = db.connect()
    with con:
        con.execute("DELETE FROM sessoes WHERE token=?", (request.cookies.get(COOKIE, ""),))
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/sessao")
def sessao(u: dict = Depends(usuario)):
    return _sessao_json(u)


class TrocaIn(BaseModel):
    escola_id: int


@app.put("/api/sessao/escola")
def trocar_instituicao(t: TrocaIn, u: dict = Depends(usuario)):
    """Usuario vinculado a varias instituicoes escolhe a instituicao ativa."""
    if _eh_admin(u) or t.escola_id not in {e["id"] for e in u["escolas"]}:
        raise HTTPException(403, "Sem acesso a esta instituição")
    con = db.connect()
    with con:
        con.execute("UPDATE sessoes SET escola_id=? WHERE token=?", (t.escola_id, u["token"]))
    return _sessao_json({**u, "escola_id": t.escola_id,
                         "escola_nome": next(e["nome"] for e in u["escolas"] if e["id"] == t.escola_id)})


# ------------------------------------------------------------------ usuarios (cadastrados pelo administrador)

class UsuarioIn(BaseModel):
    login: str
    senha: str = ""
    perfil: str = "instituicao"
    escolas: list[int] = []


def _usuarios(con) -> list[dict]:
    vinc = {}
    for r in con.execute("SELECT usuario_id, escola_id FROM usuario_escolas"):
        vinc.setdefault(r["usuario_id"], []).append(r["escola_id"])
    return [{"id": r["id"], "login": r["login"], "perfil": r["perfil"], "criado_em": r["criado_em"],
             "escolas": sorted(vinc.get(r["id"], []))}
            for r in con.execute("SELECT * FROM usuarios ORDER BY perfil, login")]


def _valida_usuario(con, d: UsuarioIn, uid: int | None) -> str:
    login = _norm_login(d.login)
    atual = con.execute("SELECT login FROM usuarios WHERE id=?", (uid,)).fetchone() if uid else None
    if not (atual and atual["login"] == login) and not _email_ok(login):  # logins antigos continuam valendo
        raise HTTPException(400, "O usuário deve ser um e-mail válido")
    if d.perfil not in ("admin", "instituicao"):
        raise HTTPException(400, "Perfil inválido")
    outro = con.execute("SELECT id FROM usuarios WHERE login=?", (login,)).fetchone()
    if outro and outro["id"] != uid:
        raise HTTPException(400, f"Já existe usuário com o e-mail {login}")
    if d.senha or uid is None:
        _valida_senha(d.senha)
    if d.perfil == "instituicao":
        if not d.escolas:
            raise HTTPException(400, "Vincule o usuário a ao menos uma instituição")
        existentes = {r["id"] for r in con.execute("SELECT id FROM escolas")}
        if set(d.escolas) - existentes:
            raise HTTPException(400, "Instituição não encontrada")
    return login


def _grava_vinculos(con, uid: int, d: UsuarioIn):
    con.execute("DELETE FROM usuario_escolas WHERE usuario_id=?", (uid,))
    if d.perfil == "instituicao":
        con.executemany("INSERT INTO usuario_escolas (usuario_id, escola_id) VALUES (?,?)",
                        [(uid, e) for e in sorted(set(d.escolas))])


@app.get("/api/usuarios")
def listar_usuarios(u: dict = Depends(admin)):
    return _usuarios(db.connect())


@app.post("/api/usuarios")
def criar_usuario(d: UsuarioIn, u: dict = Depends(admin)):
    con = db.connect()
    login = _valida_usuario(con, d, None)
    with con:
        uid = con.execute("INSERT INTO usuarios (login, senha_hash, perfil) VALUES (?,?,?) RETURNING id",
                          (login, _hash(d.senha), d.perfil)).fetchone()[0]
        _grava_vinculos(con, uid, d)
    return {"id": uid}


@app.put("/api/usuarios/{uid}")
def editar_usuario(uid: int, d: UsuarioIn, u: dict = Depends(admin)):
    """Senha vazia mantem a atual."""
    con = db.connect()
    if not con.execute("SELECT 1 FROM usuarios WHERE id=?", (uid,)).fetchone():
        raise HTTPException(404, "Usuário não encontrado")
    if uid == u["id"] and d.perfil != "admin":
        raise HTTPException(400, "Você não pode tirar o seu próprio perfil de administrador")
    login = _valida_usuario(con, d, uid)
    with con:
        con.execute("UPDATE usuarios SET login=?, perfil=? WHERE id=?", (login, d.perfil, uid))
        if d.senha:
            con.execute("UPDATE usuarios SET senha_hash=? WHERE id=?", (_hash(d.senha), uid))
            con.execute("DELETE FROM sessoes WHERE usuario_id=? AND token<>?", (uid, u["token"]))
        _grava_vinculos(con, uid, d)
    return {"ok": True}


@app.delete("/api/usuarios/{uid}")
def excluir_usuario(uid: int, u: dict = Depends(admin)):
    if uid == u["id"]:
        raise HTTPException(400, "Você não pode excluir o próprio usuário")
    con = db.connect()
    with con:
        con.execute("DELETE FROM usuarios WHERE id=?", (uid,))
    return {"ok": True}


class SenhaIn(BaseModel):
    atual: str
    nova: str


@app.put("/api/senha")
def trocar_senha(d: SenhaIn, u: dict = Depends(usuario)):
    con = db.connect()
    r = con.execute("SELECT senha_hash FROM usuarios WHERE id=?", (u["id"],)).fetchone()
    if not _confere(d.atual, r["senha_hash"]):
        raise HTTPException(400, "Senha atual incorreta")
    _valida_senha(d.nova)
    with con:
        con.execute("UPDATE usuarios SET senha_hash=? WHERE id=?", (_hash(d.nova), u["id"]))
    return {"ok": True}


# ------------------------------------------------------------------ painel

@app.get("/api/painel")
def painel(u: dict = Depends(usuario)):
    con = db.connect()
    bases = logic.Bases(con)
    escolas = []
    sql, args = ("SELECT * FROM escolas ORDER BY id", []) if _eh_admin(u) else \
        ("SELECT * FROM escolas WHERE id=?", [u["escola_id"]])
    for e in con.execute(sql, args):
        r = logic.resumo(logic.alunos_da_escola(con, e, bases))
        escolas.append({"id": e["id"], "nome": e["nome"], "cod_smtt": e["cod_smtt"], "bloqueado": e["bloqueado"], **r})
    tot = {k: sum(x[k] for x in escolas) for k in
           ("matriculados", "com_cpf", "sem_cpf", "divergentes", "cpf_invalido", "sem_mae", "mae_incompleta", "aptos",
            "migrados")}
    tot["indice_cpf"] = round(tot["com_cpf"] / tot["matriculados"], 4) if tot["matriculados"] else 0
    tot["escolas"] = len(escolas)
    tot["sem_vinculo"] = sum(1 for x in escolas if not x["matriculados"])
    bases_info = {b: con.execute(f"SELECT COUNT(*) FROM {b}").fetchone()[0]
                  for b in ("geduc", "censo", "smtt", "status_alunos")}
    ult = {r["base"]: r["importado_em"] for r in con.execute(
        "SELECT base, MAX(importado_em) importado_em FROM importacoes GROUP BY base")}
    ids = [x["id"] for x in escolas] or [0]
    lotes = con.execute(f"""SELECT COUNT(*), CAST(COALESCE(SUM(n_alunos),0) AS INTEGER) FROM lotes
                            WHERE escola_id IN ({','.join('?' * len(ids))})""", ids).fetchone()
    return {"totais": tot, "escolas": escolas, "bases": bases_info, "ultima_importacao": ult,
            "lotes": {"n": lotes[0], "alunos": lotes[1]}}


# ------------------------------------------------------------------ instituicoes

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
    cnpj: str | None = ""
    email: str | None = ""
    endereco: str | None = ""
    bairro: str | None = ""
    municipio: str | None = ""
    cep: str | None = ""
    telefone: str | None = ""
    rede: str | None = ""
    ficha: dict | None = None  # salas por tipo de ensino/turno, informacoes complementares e documentos
    representantes: list["RepresentanteIn"] | None = None  # None = mantem os atuais
    cursos: list["CursoIn"] | None = None


class RepresentanteIn(BaseModel):
    nome: str = ""
    cpf: str | None = ""
    cargo: str | None = ""
    contato: str | None = ""
    email: str | None = ""
    rg: str | None = ""
    org_exp: str | None = ""
    data_exp: str | None = ""
    endereco: str | None = ""
    bairro: str | None = ""
    cep: str | None = ""
    municipio: str | None = ""
    funcao_ficha: str | None = ""  # diretor | adjunto (declaracao da ficha da instituicao)
    responsabilidade: dict | None = None  # {"1": ["M", "V"], ...}: tipo de ensino -> turnos


class CursoIn(BaseModel):
    curso: str = ""
    grau: str | None = "1"
    series: str | None = ""
    turnos: str | None = ""
    tipo_ensino: str | None = ""  # 1 a 10 (legenda da relacao de cursos da SMTT)
    modalidade: str | None = ""  # 1 presencial, 2 semipresencial, 3 a distancia


EscolaIn.model_rebuild()

ESCOLA_COLS = ("nome", "cod_smtt", "inep", "geduc_nome", "nivel", "matriculados_info", "peticionamento", "desconto",
               "cnpj", "email", "endereco", "bairro", "municipio", "cep", "telefone", "rede", "ficha")
REP_COLS = ("nome", "cpf", "cargo", "contato", "email", "rg", "org_exp", "data_exp", "endereco", "bairro", "cep",
            "municipio", "funcao_ficha", "responsabilidade")
CURSO_COLS = ("curso", "grau", "series", "turnos", "tipo_ensino", "modalidade")
TIPOS_ENSINO = [str(i) for i in range(1, 11)]


def _data_iso(v: str, campo: str) -> str:
    if not v:
        return ""
    try:
        return date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        raise HTTPException(400, f"{campo}: data inválida")


def _inteiro(v) -> int | None:
    if v in (None, ""):
        return None
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        raise HTTPException(400, f"Quantidade inválida: {v}")
    if n < 0 or n > 100000:
        raise HTTPException(400, f"Quantidade inválida: {v}")
    return n


MAX_SALAS = 150  # por tipo de ensino e turno: acima disso e numero de alunos digitado no lugar de salas


def _ficha_limpa(f: dict) -> str:
    """So as chaves conhecidas da ficha da instituicao, com numeros e datas validados."""
    salas = {}
    for i, k in enumerate(TIPOS_ENSINO):
        s = (f.get("salas") or {}).get(k) or {}
        v = {t: n for t in fichas.TURNOS if (n := _inteiro(s.get(t))) is not None and n}
        for t, n in v.items():
            if n > MAX_SALAS:
                raise HTTPException(400, f"{fichas.TIPOS_ENSINO[i]} ({t}): {n} salas. Informe a quantidade de SALAS de aula "
                                         "usadas em cada turno, não o número de alunos")
        if v:
            salas[k] = v  # o N. de salas e a soma dos turnos (calculado na ficha)
    compl = {}
    for k in fichas.COMPLEMENTARES:
        s = (f.get("complementares") or {}).get(k) or {}
        v = {t: n for t in fichas.TURNOS if (n := _inteiro(s.get(t))) is not None}
        if v:
            compl[k] = v
    if salas:  # "Salas de aula" por turno = soma do quadro de salas por tipo de ensino
        compl["salas"] = {t: n for t in fichas.TURNOS if (n := sum(s.get(t, 0) for s in salas.values()))}
    docs = {}
    for k in fichas.DOCUMENTOS:
        d = (f.get("documentos") or {}).get(k) or {}
        v = {"numero": str(d.get("numero") or "").strip().upper()[:40],
             "data": _data_iso(str(d.get("data") or "").strip(), "Documentação"),
             "validade": _data_iso(str(d.get("validade") or "").strip(), "Documentação")}
        if any(v.values()):
            docs[k] = v
    return json.dumps({"salas": salas, "complementares": compl, "documentos": docs}, ensure_ascii=False)


def _json(s) -> dict:
    try:
        return json.loads(s) if s else {}
    except (TypeError, ValueError):
        return {}


def _limpo(m: BaseModel) -> dict:
    """Campos de texto sem espacos nas pontas (None vira ''); numeros e listas ficam como vieram."""
    texto = {k for k, f in type(m).model_fields.items() if f.annotation in (str, str | None)}
    return {k: (v or "").strip() if k in texto else v for k, v in m.model_dump().items()}


def _escola_vals(e: EscolaIn, atual=None) -> list:
    d = _limpo(e)
    if not d["nome"]:
        raise HTTPException(400, "Informe o nome da instituição")
    d["cnpj"], d["cep"] = so_digitos(d["cnpj"]), so_digitos(d["cep"])
    if d["cnpj"] and len(d["cnpj"]) != 14:
        raise HTTPException(400, "CNPJ deve ter 14 dígitos")
    if d["cep"] and len(d["cep"]) != 8:
        raise HTTPException(400, "CEP da instituição deve ter 8 dígitos")
    if d["email"] and not EMAIL_RE.fullmatch(d["email"]):
        raise HTTPException(400, "E-mail da instituição inválido")
    d["rede"] = d["rede"].upper()
    if d["rede"] and d["rede"] not in fichas.REDES:
        raise HTTPException(400, "Rede de ensino inválida")
    for k in ("endereco", "bairro", "municipio"):
        d[k] = d[k].upper()
    d["ficha"] = _ficha_limpa(e.ficha) if e.ficha is not None else ((atual["ficha"] if atual else "") or "")
    return [d[c] for c in ESCOLA_COLS]


def _representantes(e: EscolaIn) -> list[list] | None:
    if e.representantes is None:
        return None
    out = []
    for i, r in enumerate(e.representantes, 1):
        d = _limpo(r)
        if not any(d.values()):
            continue
        resp = d.pop("responsabilidade") or {}
        if not any(d.values()) and not resp:
            continue
        d["nome"], d["cargo"], d["cpf"] = d["nome"].upper(), d["cargo"].upper(), so_digitos(d["cpf"])
        for k in ("org_exp", "endereco", "bairro", "municipio"):
            d[k] = d[k].upper()
        d["cep"] = so_digitos(d["cep"])
        if not d["nome"]:
            raise HTTPException(400, f"Representante {i}: informe o nome")
        if d["cep"] and len(d["cep"]) != 8:
            raise HTTPException(400, f"Representante {d['nome']}: CEP deve ter 8 dígitos")
        d["data_exp"] = _data_iso(d["data_exp"], f"Representante {d['nome']}")
        if d["funcao_ficha"] not in ("", "diretor", "adjunto"):
            raise HTTPException(400, f"Representante {d['nome']}: função na ficha inválida")
        d["responsabilidade"] = json.dumps({k: [t for t in fichas.TURNOS if t in (resp.get(k) or [])]
                                            for k in TIPOS_ENSINO if set(resp.get(k) or []) & set(fichas.TURNOS)})
        if d["cpf"] and not cpf_valido(d["cpf"]):
            raise HTTPException(400, f"Representante {d['nome']}: CPF inválido")
        if d["email"] and not EMAIL_RE.fullmatch(d["email"]):
            raise HTTPException(400, f"Representante {d['nome']}: e-mail inválido")
        out.append([d[c] for c in REP_COLS])
    for f, nome in (("diretor", "Diretor(a) ou Reitor(a)"), ("adjunto", "Diretor(a) adjunto(a) ou Vice-reitor(a)")):
        if sum(1 for r in out if r[REP_COLS.index("funcao_ficha")] == f) > 1:
            raise HTTPException(400, f"Só um representante pode ser {nome} na ficha")
    return out


def _cursos(e: EscolaIn) -> list[list] | None:
    if e.cursos is None:
        return None
    out = []
    for i, c in enumerate(e.cursos, 1):
        d = _limpo(c)
        if not d["curso"] and not d["series"]:
            continue
        d["curso"], d["turnos"] = d["curso"].upper(), d["turnos"].upper()
        if not d["curso"]:
            raise HTTPException(400, f"Curso {i}: informe o nome do curso")
        if len(d["curso"]) > 25:
            raise HTTPException(400, f"Curso {d['curso']}: máximo de 25 caracteres (tamanho do campo CURSO da remessa)")
        if d["grau"] not in ("1", "2", "3"):
            raise HTTPException(400, f"Curso {d['curso']}: grau deve ser 1, 2 ou 3")
        if d["tipo_ensino"] not in ("", *TIPOS_ENSINO):
            raise HTTPException(400, f"Curso {d['curso']}: tipo de ensino inválido")
        if d["modalidade"] not in ("", "1", "2", "3"):
            raise HTTPException(400, f"Curso {d['curso']}: modalidade inválida")
        out.append([d[c] for c in CURSO_COLS])
    return out


def _grava_filhos(con, eid: int, reps: list | None, cursos: list | None):
    if reps is not None:
        con.execute("DELETE FROM representantes WHERE escola_id=?", (eid,))
        con.executemany(f"INSERT INTO representantes (escola_id, {', '.join(REP_COLS)}) "
                        f"VALUES ({', '.join('?' * (len(REP_COLS) + 1))})", [(eid, *r) for r in reps])
    if cursos is not None:
        con.execute("DELETE FROM escola_cursos WHERE escola_id=?", (eid,))
        con.executemany(f"INSERT INTO escola_cursos (escola_id, {', '.join(CURSO_COLS)}) "
                        f"VALUES ({', '.join('?' * (len(CURSO_COLS) + 1))})", [(eid, *c) for c in cursos])


def _com_filhos(con, rows) -> list[dict]:
    """Instituicoes com os representantes e cursos."""
    escolas = [dict(r) for r in rows]
    reps, cursos = {}, {}
    for r in con.execute("SELECT * FROM representantes ORDER BY id"):
        rep = {c: r[c] or "" for c in REP_COLS}
        rep["responsabilidade"] = _json(rep["responsabilidade"])
        reps.setdefault(r["escola_id"], []).append(rep)
    for r in con.execute("SELECT * FROM escola_cursos ORDER BY id"):
        cursos.setdefault(r["escola_id"], []).append({c: r[c] or "" for c in CURSO_COLS})
    for e in escolas:
        for k in ("gestor_nome", "gestor_cpf", "gestor_contato", "gestor_email"):  # migrados para representantes
            e.pop(k, None)
        e["representantes"], e["cursos"] = reps.get(e["id"], []), cursos.get(e["id"], [])
        e["ficha"] = _json(e.get("ficha"))
    return escolas


@app.get("/api/escolas")
def listar_escolas(u: dict = Depends(usuario)):
    con = db.connect()
    if not _eh_admin(u):
        return _com_filhos(con, con.execute("SELECT * FROM escolas WHERE id=?", (u["escola_id"],)))
    logins = {}
    for r in con.execute("""SELECT ue.escola_id, us.login FROM usuario_escolas ue
                            JOIN usuarios us ON us.id = ue.usuario_id ORDER BY us.login"""):
        logins.setdefault(r["escola_id"], []).append(r["login"])
    return [{**e, "logins": logins.get(e["id"], [])}
            for e in _com_filhos(con, con.execute("SELECT * FROM escolas ORDER BY id"))]


@app.post("/api/escolas")
def criar_escola(e: EscolaIn, u: dict = Depends(admin)):
    con = db.connect()
    eid = e.id or (con.execute("SELECT COALESCE(MAX(id),0)+1 FROM escolas").fetchone()[0])
    if con.execute("SELECT 1 FROM escolas WHERE id=?", (eid,)).fetchone():
        raise HTTPException(400, f"Já existe instituição com ID {eid}")
    vals, reps, cursos = _escola_vals(e), _representantes(e), _cursos(e)
    with con:
        con.execute(f"""INSERT INTO escolas (id, {', '.join(ESCOLA_COLS)})
                        VALUES ({', '.join('?' * (len(ESCOLA_COLS) + 1))})""", (eid, *vals))
        _grava_filhos(con, eid, reps, cursos)
    return {"id": eid}


@app.put("/api/escolas/{eid}")
def editar_escola(eid: int, e: EscolaIn, u: dict = Depends(admin)):
    con = db.connect()
    atual = _escola(con, eid)
    vals, reps, cursos = _escola_vals(e, atual), _representantes(e), _cursos(e)
    with con:
        con.execute(f"UPDATE escolas SET {', '.join(f'{c}=?' for c in ESCOLA_COLS)} WHERE id=?", (*vals, eid))
        _grava_filhos(con, eid, reps, cursos)
    return {"ok": True}


@app.delete("/api/escolas/{eid}")
def excluir_escola(eid: int, u: dict = Depends(admin)):
    con = db.connect()
    if con.execute("SELECT 1 FROM lotes WHERE escola_id=?", (eid,)).fetchone():
        raise HTTPException(400, "Instituição possui remessas geradas; exclua as remessas antes")
    with con:
        con.execute("DELETE FROM escolas WHERE id=?", (eid,))
    return {"ok": True}


class BloqueioIn(BaseModel):
    bloqueado: bool
    motivo: str = ""


@app.put("/api/escolas/{eid}/bloqueio")
def bloquear(eid: int, b: BloqueioIn, u: dict = Depends(admin)):
    con = db.connect()
    _escola(con, eid)
    with con:  # sessoes abertas passam a receber 403 com o motivo (checagem em usuario())
        con.execute("UPDATE escolas SET bloqueado=?, motivo_bloqueio=? WHERE id=?",
                    (1 if b.bloqueado else 0, b.motivo.strip() if b.bloqueado else "", eid))
    return {"ok": True}


@app.get("/api/geduc/escolas")
def escolas_geduc(sugerir_para: str = "", u: dict = Depends(admin)):
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


# ------------------------------------------------------------------ alunos / matriculados

@app.get("/api/escolas/{eid}/conferencia")
def conferencia(eid: int, u: dict = Depends(usuario)):
    """Diferencas entre os matriculados do sistema e a base Alunos por status da instituicao."""
    con = db.connect()
    return logic.conferencia_status(con, _escola(con, eid, u))


@app.post("/api/escolas/{eid}/status")
async def atualizar_status(eid: int, arquivo: UploadFile = File(...), u: dict = Depends(admin)):
    """Zera o Alunos por status da instituicao e grava o do arquivo: os matriculados passam a ser so os alunos dele
    (quem esta no GEDUC e nao esta no arquivo sai da contagem; quem falta no sistema vai para o cadastro individual)."""
    data, nome = await arquivo.read(), arquivo.filename or "arquivo"
    con = db.connect()
    e = _escola(con, eid)
    try:
        recs = importer.read_file("status_alunos", nome, data)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    cur = con.execute("SELECT curso, grau FROM escola_cursos WHERE escola_id=? ORDER BY id", (eid,)).fetchone()
    with con:
        try:
            r = logic.substituir_status(con, e, recs, nome)
        except ValueError as ex:
            raise HTTPException(400, str(ex))
        novos = logic.conferencia_status(con, _escola(con, eid))["so_status"]
        for s in novos:
            cpf = norm_cpf(s["cpf"])
            a = AlunoIn(aluno=s["aluno"], mae=s["mae"], pai=s["pai"], genero=s["sexo"][:1], dt_nasc=s["nascimento"],
                        turma=s["turma"], turno=s["turno"], matricula=s["matricula"], rua=s["endereco"], numero=s["numero"],
                        bairro=s["bairro"], cpf=cpf if len(cpf) == 11 else "", telefone=s["telefone"],
                        **({"curso": cur["curso"], "grau": cur["grau"] or "1"} if cur else {}))
            con.execute(f"""INSERT INTO alunos_manuais (escola_id, {', '.join(MANUAL_COLS)}, nome_norm)
                            VALUES ({', '.join('?' * (len(MANUAL_COLS) + 2))})""", (eid, *_manual_vals(a)))
    c = logic.conferencia_status(con, _escola(con, eid))
    return {**r, "cadastrados": len(novos), "matriculados": c["total_sistema"], "fora": len(c["fora"])}


@app.delete("/api/escolas/{eid}/status")
def desfazer_status(eid: int, u: dict = Depends(admin)):
    """Volta a contar os matriculados pelo GEDUC + cadastro individual (o Alunos por status gravado fica)."""
    con = db.connect()
    _escola(con, eid)
    with con:
        con.execute("UPDATE escolas SET status_atualizado_em='' WHERE id=?", (eid,))
    return {"ok": True}


@app.get("/api/escolas/{eid}/alunos")
def alunos(eid: int, u: dict = Depends(usuario)):
    con = db.connect()
    e = _escola(con, eid, u)
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
    aluno: str = ""
    pai: str = ""
    genero: str = ""
    dt_nasc: str = ""
    ano_serie: str = ""
    turno: str = ""
    turma: str = ""
    matricula: str = ""
    rua: str = ""
    numero: str = ""
    bairro: str = ""
    cidade: str = ""
    cep: str = ""
    grau: str = ""
    curso: str = ""


AJ_COLS = ("cpf", "mae", "rg", "org_exp", "data_exp", "telefone", "obs") + logic.CAMPOS_AJUSTE
AJ_MAIUSC = {"mae", "org_exp", "aluno", "pai", "genero", "turno", "turma", "rua", "bairro", "cidade", "curso"}


def _valida_grau(grau: str):
    if (grau or "").strip() not in ("", "1", "2", "3"):
        raise HTTPException(400, "Grau deve ser 1, 2 ou 3")


@app.put("/api/alunos/{id_aluno}/ajuste")
def ajustar(id_aluno: str, a: AjusteIn, u: dict = Depends(usuario)):
    """Correcoes da instituicao; tem prioridade sobre as bases e o aluno e reprocessado na proxima consulta."""
    con = db.connect()
    g = logic.aluno_base(con, id_aluno)
    if not g:
        raise HTTPException(404, "Aluno não encontrado")
    if g.get("manual"):
        raise HTTPException(400, "Aluno do cadastro individual: edite o próprio cadastro")
    _checa_aluno(con, u, id_aluno)
    cpf = norm_cpf(a.cpf)
    if a.cpf and len(cpf) != 11:
        raise HTTPException(400, "CPF deve ter 11 dígitos")
    _valida_grau(a.grau)
    d = a.model_dump()
    d["cpf"], d["cep"] = cpf, so_digitos(a.cep)
    vals = [(d[c] or "").strip().upper() if c in AJ_MAIUSC else (d[c] or "").strip() for c in AJ_COLS]
    with con:
        if not any(vals):
            con.execute("DELETE FROM ajustes WHERE id_aluno=?", (id_aluno,))
        else:
            con.execute(f"""INSERT INTO ajustes (id_aluno, {', '.join(AJ_COLS)}) VALUES ({', '.join('?' * (len(AJ_COLS) + 1))})
                            ON CONFLICT(id_aluno) DO UPDATE SET {', '.join(f'{c}=excluded.{c}' for c in AJ_COLS)},
                            atualizado_em=datetime('now','localtime')""", (id_aluno, *vals))
    return {"ok": True}


class AlunoIn(BaseModel):
    aluno: str
    mae: str = ""
    pai: str = ""
    genero: str = ""
    dt_nasc: str = ""
    ano_serie: str = ""
    turno: str = ""
    turma: str = ""
    matricula: str = ""
    rua: str = ""
    numero: str = ""
    bairro: str = ""
    cidade: str = "SAO LUIS"
    cep: str = ""
    cpf: str = ""
    telefone: str = ""
    rg: str = ""
    org_exp: str = ""
    data_exp: str = ""
    grau: str = "1"
    curso: str = "ENSINO FUNDAMENTAL"


MANUAL_COLS = list(AlunoIn.model_fields)
MANUAL_MAIUSC = {"aluno", "mae", "pai", "genero", "turno", "turma", "rua", "bairro", "cidade", "org_exp", "curso"}


def _manual_vals(a: AlunoIn) -> list:
    d = a.model_dump()
    if not d["aluno"].strip():
        raise HTTPException(400, "Informe o nome do aluno")
    d["cpf"], d["cep"] = norm_cpf(d["cpf"]), so_digitos(d["cep"])
    if a.cpf and len(d["cpf"]) != 11:
        raise HTTPException(400, "CPF deve ter 11 dígitos")
    _valida_grau(a.grau)
    vals = [(d[c] or "").strip().upper() if c in MANUAL_MAIUSC else (d[c] or "").strip() for c in MANUAL_COLS]
    return vals + [norm_nome(d["aluno"])]


def _manual(con, mid: int, u: dict):
    r = con.execute("SELECT * FROM alunos_manuais WHERE id=?", (mid,)).fetchone()
    if not r:
        raise HTTPException(404, "Aluno não encontrado")
    _escola(con, r["escola_id"], u)
    return r


@app.post("/api/escolas/{eid}/alunos")
def cadastrar_aluno(eid: int, a: AlunoIn, u: dict = Depends(usuario)):
    """Cadastro individual de aluno (fora do GEDUC)."""
    con = db.connect()
    _escola(con, eid, u)
    vals = _manual_vals(a)
    with con:
        mid = con.execute(f"""INSERT INTO alunos_manuais (escola_id, {', '.join(MANUAL_COLS)}, nome_norm)
                              VALUES ({', '.join('?' * (len(MANUAL_COLS) + 2))}) RETURNING id""",
                          (eid, *vals)).fetchone()[0]
    return {"id_aluno": f"M{mid}"}


@app.put("/api/alunos-manuais/{mid}")
def editar_aluno(mid: int, a: AlunoIn, u: dict = Depends(usuario)):
    con = db.connect()
    _manual(con, mid, u)
    vals = _manual_vals(a)
    with con:
        con.execute(f"UPDATE alunos_manuais SET {', '.join(f'{c}=?' for c in MANUAL_COLS)}, nome_norm=? WHERE id=?",
                    (*vals, mid))
    return {"ok": True}


@app.delete("/api/alunos-manuais/{mid}")
def excluir_aluno(mid: int, u: dict = Depends(usuario)):
    con = db.connect()
    _manual(con, mid, u)
    if con.execute("SELECT 1 FROM lote_alunos WHERE id_aluno=?", (f"M{mid}",)).fetchone():
        raise HTTPException(400, "Aluno já enviado em remessa; exclua a remessa antes")
    with con:
        con.execute("DELETE FROM alunos_manuais WHERE id=?", (mid,))
    return {"ok": True}


@app.get("/api/alunos/busca")
def busca(q: str, u: dict = Depends(usuario)):
    """Botao 'Localizar Estudante' do MENU: toda a rede (admin) ou a propria instituicao."""
    con = db.connect()
    q = q.strip()
    if len(q) < 3:
        return []
    cpf = norm_cpf(q)
    por_cpf = len(cpf) == 11 and q.replace(".", "").replace("-", "").isdigit()
    cond, arg = ("cpf=?", cpf) if por_cpf else ("nome_norm LIKE ?", f"%{norm_nome(q)}%")
    w_g, a_g, w_m, a_m = "", [], "", []
    if not _eh_admin(u):
        where, args = logic.filtro_escola(_escola(con, u["escola_id"]))
        w_g, a_g, w_m, a_m = f" AND {where}", args, " AND escola_id=?", [u["escola_id"]]
    rows = con.execute(f"SELECT * FROM geduc WHERE {cond}{w_g} ORDER BY aluno LIMIT 1000", [arg, *a_g])
    manuais = con.execute(f"SELECT * FROM alunos_manuais WHERE {cond}{w_m} ORDER BY aluno", [arg, *a_m])
    escolas = [dict(e) for e in con.execute("SELECT * FROM escolas")]
    out = []
    for r in rows:
        esc = next((e for e in escolas if norm_nome(e["geduc_nome"] or e["nome"]) == r["escola_norm"]
                    or (e["inep"] and e["inep"] == r["inep_escola"])), None)
        out.append({"id_aluno": r["id_aluno"], "aluno": r["aluno"], "dt_nasc": r["dt_nasc"], "escola": r["escola"],
                    "turma": r["turma"], "turno": r["turno"], "mae": r["mae"], "cpf_geduc": r["cpf"],
                    "escola_id": esc["id"] if esc else None})
    nomes = {e["id"]: e["nome"] for e in escolas}
    for r in manuais:
        out.append({"id_aluno": f"M{r['id']}", "aluno": r["aluno"], "dt_nasc": r["dt_nasc"],
                    "escola": nomes.get(r["escola_id"], ""), "turma": r["turma"], "turno": r["turno"], "mae": r["mae"],
                    "cpf_geduc": r["cpf"], "escola_id": r["escola_id"], "manual": True})
    if not _eh_admin(u):
        out = [x for x in out if x["escola_id"] == u["escola_id"]]
    return out


@app.get("/api/alunos/{id_aluno}")
def detalhe_aluno(id_aluno: str, u: dict = Depends(usuario)):
    con = db.connect()
    g = logic.aluno_base(con, id_aluno)
    if not g:
        raise HTTPException(404)
    _checa_aluno(con, u, id_aluno)
    aj = con.execute("SELECT * FROM ajustes WHERE id_aluno=?", (id_aluno,)).fetchone()
    nn = norm_nome(aj["aluno"]) if aj and aj["aluno"] else g["nome_norm"]
    nasc = (aj["dt_nasc"] if aj and aj["dt_nasc"] else "") or g["dt_nasc"] or ""

    def registros(tabela, campo_nasc):
        """Mesmo nome, ou mesmo nome sem as particulas com a mesma data de nascimento (regra do cruzamento).
        O ID_ALUNO do Alunos por status e de outra numeracao e nao e usado."""
        rows = [dict(r) for r in con.execute(f"SELECT * FROM {tabela} WHERE nome_norm=? OR {campo_nasc} LIKE ?",
                                             (nn, f"{nasc}%" if nasc else "-"))]
        mesmo = [r for r in rows if r["nome_norm"] == nn]
        return mesmo or [r for r in rows if chave_nome(r["nome_norm"]) == chave_nome(nn)
                         and (r[campo_nasc] or "")[:10] == nasc]

    censo, smtt, status = registros("censo", "dt_nasc"), registros("smtt", "nascido"), registros("status_alunos", "nascimento")
    lotes = [dict(r) for r in con.execute(
        """SELECT l.id, l.escola_id, l.criado_em, l.arquivo, e.nome escola FROM lote_alunos la
           JOIN lotes l ON l.id=la.lote_id JOIN escolas e ON e.id=l.escola_id WHERE la.id_aluno=?""", (id_aluno,))]
    if not _eh_admin(u):
        # a instituicao ve so o registro usado no cruzamento (homonimos de outras instituicoes ficam de fora)
        um = lambda rows, campo: [x] if (x := logic._pick(rows, nasc, campo)) else []
        censo, smtt = um(censo, "dt_nasc"), um(smtt, "nascido")
        status = um(status, "nascimento")
        lotes = [x for x in lotes if x["escola_id"] == u["escola_id"]]
    return {"geduc": g, "censo": censo, "smtt": smtt, "status": status, "ajuste": dict(aj) if aj else None,
            "lotes": lotes}


# ------------------------------------------------------------------ remessas

class RemessaIn(BaseModel):
    ids: list[str]
    remover_acentos: bool = True


@app.post("/api/escolas/{eid}/remessa/previa")
def previa(eid: int, body: RemessaIn, u: dict = Depends(usuario)):
    con = db.connect()
    r = logic.gerar_remessa(con, _escola(con, eid, u), body.ids, body.remover_acentos)
    return {"itens": r["itens"], "tam_linha": r["tam_linha"], "layout": logic.LAYOUT,
            "amostra": r["conteudo"].split("\r\n")[:5]}


@app.post("/api/escolas/{eid}/remessa")
def gerar(eid: int, body: RemessaIn, u: dict = Depends(usuario)):
    con = db.connect()
    e = _escola(con, eid, u)
    r = logic.gerar_remessa(con, e, body.ids, body.remover_acentos)
    try:
        lid = logic.salvar_lote(con, e, r)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {"lote_id": lid, "incluidos": sum(1 for i in r["itens"] if not i["erros"]),
            "rejeitados": [i for i in r["itens"] if i["erros"]]}


def _lote(con, lid: int, u: dict):
    r = con.execute("SELECT * FROM lotes WHERE id=?", (lid,)).fetchone()
    if not r:
        raise HTTPException(404)
    if not _eh_admin(u) and r["escola_id"] != u["escola_id"]:
        raise HTTPException(403, "Remessa de outra instituição")
    return r


@app.get("/api/lotes")
def lotes(escola_id: int | None = None, u: dict = Depends(usuario)):
    con = db.connect()
    if not _eh_admin(u):
        escola_id = u["escola_id"]
    sql = """SELECT l.id, l.escola_id, e.nome escola, l.criado_em, l.n_alunos, l.arquivo FROM lotes l
             JOIN escolas e ON e.id = l.escola_id"""
    args = []
    if escola_id:
        sql += " WHERE l.escola_id=?"
        args.append(escola_id)
    return [dict(r) for r in con.execute(sql + " ORDER BY l.id DESC", args)]


@app.get("/api/lotes/{lid}/alunos")
def lote_alunos(lid: int, u: dict = Depends(usuario)):
    con = db.connect()
    _lote(con, lid, u)
    return [dict(r) for r in con.execute("SELECT * FROM lote_alunos WHERE lote_id=? ORDER BY nome", (lid,))]


@app.get("/api/lotes/{lid}/arquivo")
def baixar_lote(lid: int, u: dict = Depends(usuario)):
    con = db.connect()
    r = _lote(con, lid, u)
    return Response(bytes(r["conteudo"]), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{r["arquivo"]}"'})


FICHAS = {"instituicao": ("FICHA_INSTITUICAO", fichas.ficha_instituicao), "cursos": ("RELACAO_CURSOS", fichas.ficha_cursos),
          "representantes": ("FICHA_REPRESENTANTE", fichas.ficha_representantes)}


@app.get("/api/escolas/{eid}/ficha/{tipo}")
def ficha_smtt(eid: int, tipo: str, rep: int | None = None, u: dict = Depends(usuario)):
    """Fichas da Central de Atendimento ao Estudante (SMTT) preenchidas com o cadastro da instituicao."""
    if tipo not in FICHAS:
        raise HTTPException(404)
    con = db.connect()
    e = _com_filhos(con, [_escola(con, eid, u)])[0]
    prefixo, gerar = FICHAS[tipo]
    conteudo = gerar(e, rep) if tipo == "representantes" else gerar(e)
    cod = so_digitos(e["cod_smtt"] or "") or str(eid)
    nome = f"{prefixo}_{cod}" + (f"_{rep + 1}" if rep is not None else "") + ".pdf"
    return Response(conteudo, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@app.get("/api/lotes/{lid}/pdf")
def pdf_lote(lid: int, u: dict = Depends(usuario)):
    """Relacao simplificada dos estudantes da remessa (com CPF), no layout do relatorio oficial."""
    con = db.connect()
    r = dict(_lote(con, lid, u))
    e = con.execute("SELECT cod_smtt FROM escolas WHERE id=?", (r["escola_id"],)).fetchone()
    conteudo = pdf.gerar(r, (e["cod_smtt"] if e else "") or "", _logo_bytes(con)[1])
    nome = Path(r["arquivo"]).stem + ".pdf"
    return Response(conteudo, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


def _critica_resp(data: bytes, nome: str) -> dict:
    res = critica.criticar_arquivo(data, nome)
    res["relatorio"] = critica.relatorio_txt(res)
    res["relatorio_nome"] = "CRITICA_" + Path(nome or "remessa.txt").stem + ".txt"
    return res


@app.post("/api/critica")
async def criticar_upload(arquivo: UploadFile = File(...), u: dict = Depends(usuario)):
    """Tela 'Criticar remessa': mesmas regras do validador oficial AlunoCriticaUtf8.exe."""
    return _critica_resp(await arquivo.read(), arquivo.filename or "")


@app.get("/api/lotes/{lid}/critica")
def criticar_lote(lid: int, u: dict = Depends(usuario)):
    con = db.connect()
    r = _lote(con, lid, u)
    return _critica_resp(bytes(r["conteudo"]), r["arquivo"])


@app.delete("/api/lotes/{lid}")
def excluir_lote(lid: int, u: dict = Depends(usuario)):
    con = db.connect()
    _lote(con, lid, u)
    with con:
        con.execute("DELETE FROM lotes WHERE id=?", (lid,))
    return {"ok": True}


# ------------------------------------------------------------------ arquivo do processamento final (TXT + PDF)

@app.post("/api/escolas/{eid}/arquivos-finais")
async def enviar_final(eid: int, txt: UploadFile = File(...), pdf: UploadFile = File(...),
                       u: dict = Depends(usuario)):
    """Arquiva o TXT do processamento final junto com o PDF que contem os CPFs dos alunos."""
    con = db.connect()
    _escola(con, eid, u)
    tb, pb = await txt.read(), await pdf.read()
    if not (txt.filename or "").lower().endswith(".txt"):
        raise HTTPException(400, "O arquivo do processamento final deve ser .txt")
    if not pb.startswith(b"%PDF"):
        raise HTTPException(400, "O arquivo com os CPFs dos alunos deve ser um PDF")
    n = critica.criticar_arquivo(tb, txt.filename)["total"]
    if not n:
        raise HTTPException(400, "O TXT não tem registros")
    with con:
        fid = con.execute("""INSERT INTO arquivos_finais (escola_id, enviado_por, txt_nome, txt, n_registros, pdf_nome, pdf)
                             VALUES (?,?,?,?,?,?,?) RETURNING id""",
                          (eid, u["login"], txt.filename, tb, n, pdf.filename or "cpfs.pdf", pb)).fetchone()[0]
    return {"id": fid, "n_registros": n}


def _final(con, fid: int, u: dict):
    r = con.execute("SELECT * FROM arquivos_finais WHERE id=?", (fid,)).fetchone()
    if not r:
        raise HTTPException(404)
    if not _eh_admin(u) and r["escola_id"] != u["escola_id"]:
        raise HTTPException(403, "Arquivo de outra instituição")
    return r


@app.get("/api/arquivos-finais")
def listar_finais(escola_id: int | None = None, u: dict = Depends(usuario)):
    con = db.connect()
    if not _eh_admin(u):
        escola_id = u["escola_id"]
    sql = """SELECT f.id, f.escola_id, e.nome escola, f.criado_em, f.enviado_por, f.txt_nome, f.n_registros, f.pdf_nome
             FROM arquivos_finais f JOIN escolas e ON e.id = f.escola_id"""
    args = []
    if escola_id:
        sql += " WHERE f.escola_id=?"
        args.append(escola_id)
    return [dict(r) for r in con.execute(sql + " ORDER BY f.id DESC", args)]


@app.get("/api/arquivos-finais/{fid}/{tipo}")
def baixar_final(fid: int, tipo: str, u: dict = Depends(usuario)):
    if tipo not in ("txt", "pdf"):
        raise HTTPException(400)
    con = db.connect()
    r = _final(con, fid, u)
    mt = "application/pdf" if tipo == "pdf" else "text/plain; charset=utf-8"
    return Response(bytes(r[tipo]), media_type=mt,
                    headers={"Content-Disposition": f'attachment; filename="{r[tipo + "_nome"]}"'})


@app.delete("/api/arquivos-finais/{fid}")
def excluir_final(fid: int, u: dict = Depends(usuario)):
    con = db.connect()
    _final(con, fid, u)
    with con:
        con.execute("DELETE FROM arquivos_finais WHERE id=?", (fid,))
    return {"ok": True}


# ------------------------------------------------------------------ relatorios / orcamento

@app.get("/api/escolas/{eid}/relatorio/{tipo}")
def relatorio(eid: int, tipo: str, u: dict = Depends(usuario)):
    if tipo not in ("sem_cpf", "sem_mae", "simplificada"):
        raise HTTPException(400)
    con = db.connect()
    e = _escola(con, eid, u)
    return {"escola": dict(e), "itens": logic.relatorio(logic.alunos_da_escola(con, e), tipo)}


@app.get("/api/escolas/{eid}/orcamento")
def orcamento(eid: int, u: dict = Depends(admin)):
    con = db.connect()
    e = _escola(con, eid)
    return {"escola": dict(e), **logic.orcamento(con, e)}


class OrcIn(BaseModel):
    matriculados_info: int | None = None
    peticionamento: float = 0
    desconto: float = 0


@app.put("/api/escolas/{eid}/orcamento")
def salvar_orcamento(eid: int, o: OrcIn, u: dict = Depends(admin)):
    con = db.connect()
    _escola(con, eid)
    with con:
        con.execute("UPDATE escolas SET matriculados_info=?, peticionamento=?, desconto=? WHERE id=?",
                    (o.matriculados_info, o.peticionamento, o.desconto, eid))
    return orcamento(eid, u)


@app.get("/api/config")
def config(u: dict = Depends(admin)):
    con = db.connect()
    return {r["chave"]: r["valor"] for r in con.execute("SELECT * FROM config")}


@app.put("/api/config")
def salvar_config(cfg: dict, u: dict = Depends(admin)):
    con = db.connect()
    with con:
        for k, v in cfg.items():
            con.execute("INSERT INTO config VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
                        (k, str(v)))
    return config(u)


LOGO_TIPOS = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}


def _logo_bytes(con) -> tuple[str, bytes]:
    r = con.execute("SELECT tipo, conteudo FROM arquivos_config WHERE chave='logo'").fetchone()
    return (r["tipo"], bytes(r["conteudo"])) if r else ("image/png", (STATIC / "logo.png").read_bytes())


@app.get("/api/logo")
def logo():
    """Logo configurada pelo administrador (ou a padrao do sistema)."""
    tipo, data = _logo_bytes(db.connect())
    return Response(data, media_type=tipo, headers={"Cache-Control": "no-cache"})


@app.put("/api/logo")
async def trocar_logo(arquivo: UploadFile = File(...), u: dict = Depends(admin)):
    if arquivo.content_type not in LOGO_TIPOS:
        raise HTTPException(400, "Envie a logo em PNG, JPG, SVG ou WEBP")
    data = await arquivo.read()
    if len(data) > 2_000_000:
        raise HTTPException(400, "Logo muito grande (máx. 2 MB)")
    con = db.connect()
    with con:
        con.execute("""INSERT INTO arquivos_config (chave, tipo, conteudo) VALUES ('logo',?,?)
                       ON CONFLICT(chave) DO UPDATE SET tipo=excluded.tipo, conteudo=excluded.conteudo""",
                    (arquivo.content_type, data))
    return {"ok": True}


@app.delete("/api/logo")
def logo_padrao(u: dict = Depends(admin)):
    con = db.connect()
    with con:
        con.execute("DELETE FROM arquivos_config WHERE chave='logo'")
    return {"ok": True}


# ------------------------------------------------------------------ exportacao das tabelas (Excel)

class ColunaIn(BaseModel):
    titulo: str
    tipo: str = "texto"


class ExportarIn(BaseModel):
    titulo: str
    subtitulo: str = ""
    colunas: list[ColunaIn]
    linhas: list[list]


@app.post("/api/exportar")
def exportar_tabela(d: ExportarIn, u: dict = Depends(usuario)):
    """Qualquer tabela da tela vira .xlsx no layout padrao (a tela envia so o que o usuario ja ve)."""
    if len(d.linhas) > 200_000:
        raise HTTPException(400, "Tabela grande demais para exportar")
    conteudo = exportar.gerar(d.titulo, [c.model_dump() for c in d.colunas], d.linhas, d.subtitulo, u["login"])
    nome = exportar.nome_arquivo(d.titulo)
    return Response(conteudo, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


# ------------------------------------------------------------------ importacao

@app.get("/api/importacoes")
def importacoes(u: dict = Depends(admin)):
    con = db.connect()
    return {"historico": [dict(r) for r in con.execute("SELECT * FROM importacoes ORDER BY id DESC LIMIT 1000")],
            "bases": {b: {"label": importer.LABELS[b], "aba": importer.BASES[b][0].strip(),
                          "linhas": con.execute(f"SELECT COUNT(*) FROM {b}").fetchone()[0]} for b in importer.BASES},
            "status": _import_status()}


@app.post("/api/importar")
async def importar(base: str = Form(...), arquivo: UploadFile = File(...), u: dict = Depends(admin)):
    global _import_thread
    st = _import_status()
    if st["rodando"]:
        rotulo = "Planilha completa" if st["base"] == "planilha" else importer.LABELS.get(st["base"], st["base"])
        raise HTTPException(409, f"Já existe uma importação em andamento ({rotulo}, há {st['segundos'] // 60} min "
                                 f"{st['segundos'] % 60} s). Aguarde terminar.")
    # antes do upload: impede duas importacoes ao mesmo tempo
    _import.update(rodando=True, msg=[], erro=None, base=base, arquivo=arquivo.filename or "", inicio=time.time(),
                   etapa="Recebendo o arquivo")
    try:
        data = await arquivo.read()
    except Exception:
        _import["rodando"] = False
        raise
    nome = arquivo.filename or "arquivo"

    def log(m: str):
        _import["msg"].append(m)
        _import["etapa"] = m

    def job():
        try:
            _import["etapa"] = "Lendo o arquivo"
            con = db.connect()
            if base == "planilha":
                import tempfile

                with tempfile.NamedTemporaryFile(suffix=".xlsm", delete=False) as f:
                    f.write(data)
                try:
                    importer.import_workbook(f.name, log=log, etapa=lambda m: _import.update(etapa=m))
                finally:
                    Path(f.name).unlink(missing_ok=True)
            else:
                if base not in importer.BASES:
                    raise ValueError("Base desconhecida")
                recs = importer.read_file(base, nome, data)
                _import["etapa"] = f"Gravando {len(recs)} linhas no banco"
                n = importer.save(con, base, recs, nome)
                log(f"{importer.LABELS[base]}: {n} linhas")
        except Exception as ex:
            traceback.print_exc()
            _import["erro"] = str(ex) if isinstance(ex, ValueError) else f"{type(ex).__name__}: {ex}"
        finally:
            _import.update(rodando=False, etapa="")

    _import_thread = threading.Thread(target=job, daemon=True)
    _import_thread.start()
    return {"ok": True}
