"""Copia os dados de um banco de origem para o Postgres definido em DATABASE_URL.

A origem pode ser um arquivo SQLite (data/smpe.db) ou a URL de outro Postgres (ex.: o banco do Render ao mudar
para a VPS). A copia e feita pelo proprio sistema, sem pg_dump, entao a versao do Postgres de cada lado nao importa."""
import sqlite3
from pathlib import Path

from . import db

# ordem respeitando as chaves estrangeiras
TABELAS = ["escolas", "representantes", "escola_cursos", "usuarios", "usuario_escolas", "geduc", "censo", "smtt", "status_alunos", "ajustes", "alunos_manuais", "lotes",
           "lote_alunos", "arquivos_finais", "arquivos_config", "config", "importacoes", "servidores", "feriados"]
COM_SEQUENCIA = ["escolas", "representantes", "escola_cursos", "usuarios", "geduc", "censo", "smtt", "status_alunos", "alunos_manuais", "lotes",
                 "arquivos_finais", "importacoes", "servidores"]
LOTE = 5000  # linhas por vez (a base GEDUC tem dezenas de milhares)


def _num(v, tipo: str):
    if v is None or v == "":
        return None
    return int(v) if tipo == "integer" else float(v)


class _OrigemSqlite:
    def __init__(self, arquivo: str):
        if not Path(arquivo).is_file():
            raise SystemExit(f"Arquivo nao encontrado: {arquivo}")
        self.con = sqlite3.connect(arquivo)
        self.nome = "SQLite"

    def colunas(self, tabela: str) -> set[str]:
        return {r[1] for r in self.con.execute(f"PRAGMA table_info({tabela})")}

    def linhas(self, tabela: str, cols: list[str]):
        cur = self.con.execute(f"SELECT {', '.join(cols)} FROM {tabela}")
        while lote := cur.fetchmany(LOTE):
            yield lote


class _OrigemPostgres:
    def __init__(self, url: str):
        import psycopg

        if url == db.DATABASE_URL:
            raise SystemExit("A origem e o destino sao o mesmo banco")
        self.con = psycopg.connect(url)
        self.nome = "Postgres de origem"

    def colunas(self, tabela: str) -> set[str]:
        return {r[0] for r in self.con.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s",
            (tabela,))}

    def linhas(self, tabela: str, cols: list[str]):
        with self.con.cursor(name=f"copia_{tabela}") as cur:  # cursor no servidor: nao carrega a tabela inteira
            cur.execute(f"SELECT {', '.join(cols)} FROM {tabela}")
            while lote := cur.fetchmany(LOTE):
                yield lote


def migrar(origem: str, substituir: bool = False, log=print) -> dict:
    if not db.DATABASE_URL:
        raise SystemExit("Defina DATABASE_URL com a URL do Postgres de destino")
    src = _OrigemPostgres(origem) if origem.startswith(("postgres://", "postgresql://")) else _OrigemSqlite(origem)
    dst = db.connect()

    existentes = {t: dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABELAS if t != "config"}
    if any(existentes.values()) and not substituir:
        raise SystemExit(f"O Postgres de destino ja tem dados {existentes}. Use --substituir para apagar e copiar de novo.")

    tipos = {(r[0], r[1]): r[2] for r in dst.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'")}
    out = {}
    with dst:
        dst.execute(f"TRUNCATE {', '.join(TABELAS)} CASCADE")
        for t in TABELAS:
            cols_src = src.colunas(t)
            cols = [c for (tab, c) in tipos if tab == t and c in cols_src]
            if not cols:  # tabela que nao existia na origem
                out[t] = 0
                continue
            numericas = {c for c in cols if tipos[(t, c)] in ("integer", "double precision")}
            n = 0
            for lote in src.linhas(t, cols):
                rows = [[_num(v, tipos[(t, c)]) if c in numericas else (bytes(v) if isinstance(v, memoryview) else v)
                         for c, v in zip(cols, r)] for r in lote]
                dst.executemany(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", rows)
                n += len(rows)
            out[t] = n
            log(f"{t}: {n} linhas")
        for t in COM_SEQUENCIA:
            dst.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE(MAX(id), 1), "
                        f"MAX(id) IS NOT NULL) FROM {t}")

    diferentes = {t: (n, dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t, n in out.items()}
    diferentes = {t: v for t, v in diferentes.items() if v[0] != v[1]}
    if diferentes:
        raise SystemExit(f"Contagens diferentes apos a copia (origem, destino): {diferentes}")
    log(f"Migracao concluida: contagens conferem com o {src.nome}")
    return out
