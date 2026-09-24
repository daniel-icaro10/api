"""Normalizacoes usadas no cruzamento das bases."""
import re
import unicodedata
from datetime import date, datetime


def sem_acento(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c))


def norm_nome(s) -> str:
    """Chave de cruzamento por nome (a planilha usa PROCV pelo nome do aluno)."""
    s = sem_acento(str(s or "")).upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", " ", s)).strip()


def norm_cpf(v) -> str:
    """Igual as colunas AK:AN da aba ESCOLA: tira pontuacao e completa zeros a esquerda (9/10 digitos)."""
    if v is None:
        return ""
    if isinstance(v, float):
        v = int(v)
    d = re.sub(r"\D", "", str(v))
    if not d or set(d) == {"0"}:
        return ""
    if len(d) in (9, 10):
        d = d.zfill(11)
    return d


def cpf_valido(cpf: str) -> bool:
    if len(cpf) != 11 or len(set(cpf)) == 1 or not cpf.isdigit():
        return False
    for n in (9, 10):
        s = sum(int(cpf[i]) * (n + 1 - i) for i in range(n))
        dv = (s * 10) % 11 % 10
        if dv != int(cpf[n]):
            return False
    return True


def fmt_cpf(cpf: str) -> str:
    return f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}" if len(cpf) == 11 else cpf


def mascara_cpf(cpf: str) -> str:
    """REL_SIMPLIFICADA: 3 primeiros + ****** + 3 ultimos."""
    return f"{cpf[:3]}******{cpf[-3:]}" if len(cpf) == 11 else ""


def to_date(v) -> str:
    """Retorna ISO (AAAA-MM-DD) ou ''."""
    if v is None or v == "":
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return s[:10]
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}"
    return ""


_MOJIBAKE = re.compile(r"[ÃÂ][\x80-\xbfŒœŠšŸŽžƒˆ˜–-™]")


def conserta_acentos(s: str) -> str:
    """Corrige texto UTF-8 que foi lido como ANSI na origem (ex.: 'ANTÃ”NIO' -> 'ANTÔNIO')."""
    def par(m):
        for enc in ("cp1252", "latin-1"):
            try:
                return m.group().encode(enc).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
        return m.group()

    for _ in range(2):  # 2 passadas: ha textos corrompidos duas vezes ('SÃƒO' -> 'SÃO' -> 'SÃO')
        if not _MOJIBAKE.search(s):
            break
        s = _MOJIBAKE.sub(par, s)
    return s


def txt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    return conserta_acentos(str(v).strip())


def so_digitos(v) -> str:
    return re.sub(r"\D", "", txt(v))
