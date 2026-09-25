"""Copia um banco SQLite local (data/smpe.db) para o Postgres definido em DATABASE_URL."""
import sqlite3
from pathlib import Path

from . import db

# ordem respeitando as chaves estrangeiras
TABELAS = ["escolas", "usuarios", "geduc", "censo", "smtt", "status_alunos", "ajustes", "alunos_manuais", "lotes",
           "lote_alunos", "arquivos_finais", "arquivos_config", "config", "importacoes"]
COM_SEQUENCIA = ["escolas", "usuarios", "geduc", "censo", "smtt", "status_alunos", "alunos_manuais", "lotes",
                 "arquivos_finais", "importacoes"]


def _num(v, tipo: str):
    if v is None or v == "":
        return None
    return int(v) if tipo == "integer" else float(v)


def migrar(arquivo: str, substituir: bool = False, log=print) -> dict:
    if not db.DATABASE_URL:
        raise SystemExit("Defina DATABASE_URL com a URL do Postgres de destino")
    if not Path(arquivo).is_file():
        raise SystemExit(f"Arquivo nao encontrado: {arquivo}")
    src = sqlite3.connect(arquivo)
    src.row_factory = sqlite3.Row
    dst = db.connect()

    existentes = {t: dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABELAS if t != "config"}
    if any(existentes.values()) and not substituir:
        raise SystemExit(f"O Postgres ja tem dados {existentes}. Use --substituir para apagar e copiar de novo.")

    tipos = {(r[0], r[1]): r[2] for r in dst.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'")}
    out = {}
    with dst:
        dst.execute(f"TRUNCATE {', '.join(TABELAS)} CASCADE")
        for t in TABELAS:
            cols_src = {r[1] for r in src.execute(f"PRAGMA table_info({t})")}
            cols = [c for (tab, c) in tipos if tab == t and c in cols_src]
            if not cols:  # tabela que nao existia no SQLite de origem
                out[t] = 0
                continue
            numericas = {c for c in cols if tipos[(t, c)] in ("integer", "double precision")}
            rows = [[_num(r[c], tipos[(t, c)]) if c in numericas else r[c] for c in cols]
                    for r in src.execute(f"SELECT {', '.join(cols)} FROM {t}")]
            if rows:
                dst.executemany(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", rows)
            out[t] = len(rows)
            log(f"{t}: {len(rows)} linhas")
        for t in COM_SEQUENCIA:
            dst.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE(MAX(id), 1), "
                        f"MAX(id) IS NOT NULL) FROM {t}")

    diferentes = {t: (n, dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t, n in out.items()}
    diferentes = {t: v for t, v in diferentes.items() if v[0] != v[1]}
    if diferentes:
        raise SystemExit(f"Contagens diferentes apos a copia (origem, destino): {diferentes}")
    log("Migracao concluida: contagens conferem com o SQLite")
    return out
