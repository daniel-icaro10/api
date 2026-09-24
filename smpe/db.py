"""Banco do SIS SMPE: SQLite local ou Postgres (quando DATABASE_URL estiver definida, ex.: Render)."""
import os
import re
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "smpe.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS escolas (
    id INTEGER PRIMARY KEY,           -- ID usado na planilha (CAD_ESCOLA)
    nome TEXT NOT NULL,
    cod_smtt TEXT DEFAULT '',
    inep TEXT DEFAULT '',
    geduc_nome TEXT DEFAULT '',       -- nome da escola como aparece no GEDUC (vazio = igual ao nome)
    nivel TEXT DEFAULT 'ENSINO FUNDAMENTAL',
    matriculados_info INTEGER,        -- matriculados informados pela escola (orcamento); vazio = GEDUC
    peticionamento REAL DEFAULT 0,
    desconto REAL DEFAULT 0
);

-- Base GEDUC: todos os alunos da rede
CREATE TABLE IF NOT EXISTS geduc (
    id INTEGER PRIMARY KEY,
    inep_escola TEXT, escola TEXT, nucleo TEXT, modalidade TEXT, id_ano_serie TEXT,
    aluno TEXT, mae TEXT, pai TEXT, genero TEXT, ano_serie TEXT, turno TEXT, turma TEXT,
    id_aluno TEXT, dt_nasc TEXT, rua TEXT, numero TEXT, bairro TEXT, cidade TEXT, cep TEXT, cpf TEXT,
    nome_norm TEXT, escola_norm TEXT
);
CREATE INDEX IF NOT EXISTS ix_geduc_escola ON geduc(escola_norm);
CREATE INDEX IF NOT EXISTS ix_geduc_inep ON geduc(inep_escola);
CREATE INDEX IF NOT EXISTS ix_geduc_nome ON geduc(nome_norm);
CREATE INDEX IF NOT EXISTS ix_geduc_idaluno ON geduc(id_aluno);

-- Base Educacenso
CREATE TABLE IF NOT EXISTS censo (
    id INTEGER PRIMARY KEY, id_inep TEXT, aluno TEXT, dt_nasc TEXT, cor TEXT, sexo TEXT, cpf TEXT, nome_norm TEXT
);
CREATE INDEX IF NOT EXISTS ix_censo_nome ON censo(nome_norm);

-- Base SMTT (cadastro de transporte)
CREATE TABLE IF NOT EXISTS smtt (
    id INTEGER PRIMARY KEY, portaria TEXT, escola TEXT, id_smtt TEXT, grau TEXT, periodo TEXT, turma TEXT,
    matricula TEXT, cartao TEXT, estudante TEXT, nascido TEXT, cpf TEXT, rg TEXT, org_exp TEXT, data_exp TEXT,
    sexo TEXT, telefone TEXT, celular TEXT, email TEXT, cep TEXT, endereco TEXT, complemento TEXT, numero TEXT,
    bairro TEXT, cidade TEXT, uf TEXT, mae TEXT, pai TEXT, cadastrado TEXT, alterado TEXT, curso TEXT,
    tipo TEXT, modalidade TEXT, nome_norm TEXT
);
CREATE INDEX IF NOT EXISTS ix_smtt_nome ON smtt(nome_norm);

-- Base "Alunos por status" (exportacao por escola com situacao, telefone, NIS...)
CREATE TABLE IF NOT EXISTS status_alunos (
    id INTEGER PRIMARY KEY, escola TEXT, turma TEXT, turno TEXT, id_aluno TEXT, inep_aluno TEXT, aluno TEXT,
    matricula TEXT, nascimento TEXT, idade TEXT, sexo TEXT, cor TEXT, nis TEXT, situacao TEXT, mae TEXT, pai TEXT,
    endereco TEXT, numero TEXT, bairro TEXT, certidao TEXT, cpf TEXT, telefone TEXT, nome_norm TEXT
);
CREATE INDEX IF NOT EXISTS ix_status_nome ON status_alunos(nome_norm);
CREATE INDEX IF NOT EXISTS ix_status_idaluno ON status_alunos(id_aluno);

-- Correcoes informadas pela escola (substitui os formularios REL_SEM_CPF / REL_SEM_MAE)
CREATE TABLE IF NOT EXISTS ajustes (
    id_aluno TEXT PRIMARY KEY,
    cpf TEXT, mae TEXT, rg TEXT, org_exp TEXT, data_exp TEXT, telefone TEXT, obs TEXT,
    atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- Remessas geradas para a SMTT
CREATE TABLE IF NOT EXISTS lotes (
    id INTEGER PRIMARY KEY,
    escola_id INTEGER NOT NULL REFERENCES escolas(id),
    num_remessa INTEGER,
    criado_em TEXT DEFAULT (datetime('now','localtime')),
    n_alunos INTEGER NOT NULL,
    arquivo TEXT NOT NULL,
    conteudo BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS lote_alunos (
    lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
    id_aluno TEXT NOT NULL,
    nome TEXT, cpf TEXT,
    PRIMARY KEY (lote_id, id_aluno)
);

CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
INSERT OR IGNORE INTO config VALUES ('preco_unitario', '0.43');
INSERT OR IGNORE INTO config VALUES ('remessa_bom', '1');

CREATE TABLE IF NOT EXISTS importacoes (
    id INTEGER PRIMARY KEY, base TEXT, arquivo TEXT, linhas INTEGER,
    importado_em TEXT DEFAULT (datetime('now','localtime'))
);
"""


DATABASE_URL = os.environ.get("DATABASE_URL", "")
# horario local de Sao Luis (UTC-3); o servidor do Render roda em UTC
AGORA_PG = "to_char(now() AT TIME ZONE 'America/Fortaleza', 'YYYY-MM-DD HH24:MI:SS')"
AGORA_SQLITE = "datetime('now','localtime')"


def _schema_pg() -> str:
    s = SCHEMA.replace("id INTEGER PRIMARY KEY", "id SERIAL PRIMARY KEY")
    s = s.replace(AGORA_SQLITE, AGORA_PG).replace(" BLOB ", " BYTEA ").replace(" REAL ", " DOUBLE PRECISION ")
    return re.sub(r"INSERT OR IGNORE INTO (.*?);", r"INSERT INTO \1 ON CONFLICT DO NOTHING;", s)


class Row(tuple):
    """Linha acessivel por indice e por nome, como sqlite3.Row."""

    def __new__(cls, values, cols, idx):
        r = super().__new__(cls, values)
        r._cols, r._idx = cols, idx
        return r

    def __getitem__(self, k):
        return tuple.__getitem__(self, self._idx[k] if isinstance(k, str) else k)

    def keys(self):
        return self._cols


def _row_factory(cur):
    cols = [c.name for c in cur.description or []]
    idx = {c: i for i, c in enumerate(cols)}
    return lambda values: Row(values, cols, idx)


def _sql_pg(sql: str, has_params: bool) -> str:
    sql = sql.replace(AGORA_SQLITE, AGORA_PG)
    if has_params:
        sql = sql.replace("%", "%%").replace("?", "%s")
    return sql


class PgConnection:
    """Adapta o psycopg a interface do sqlite3 usada no sistema (placeholders ?, `with con:` = transacao)."""

    def __init__(self, con):
        self._con = con
        self._tx = []

    def execute(self, sql: str, params=None):
        return self._con.execute(_sql_pg(sql, params is not None), params)

    def executemany(self, sql: str, seq):
        cur = self._con.cursor()
        cur.executemany(_sql_pg(sql, True), seq)
        return cur

    def __enter__(self):
        tx = self._con.transaction()
        tx.__enter__()
        self._tx.append(tx)
        return self

    def __exit__(self, *exc):
        return self._tx.pop().__exit__(*exc)

    def close(self):
        self._con.close()


_schema_ok = False
_schema_lock = threading.Lock()


def _connect_pg() -> PgConnection:
    global _schema_ok
    import psycopg

    con = PgConnection(psycopg.connect(DATABASE_URL, autocommit=True, row_factory=_row_factory))
    if not _schema_ok:
        with _schema_lock:
            if not _schema_ok:
                con.execute(_schema_pg())
                _schema_ok = True
    return con


def connect():
    if DATABASE_URL:
        return _connect_pg()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=60, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.executescript(SCHEMA)
    if "num_remessa" not in {r[1] for r in con.execute("PRAGMA table_info(lotes)")}:
        con.execute("ALTER TABLE lotes ADD COLUMN num_remessa INTEGER")
    return con


def get_config(con, chave: str, default: str = "") -> str:
    r = con.execute("SELECT valor FROM config WHERE chave=?", (chave,)).fetchone()
    return r[0] if r else default
