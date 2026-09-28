"""Importacao das bases (planilha SIS SMPE completa ou arquivos avulsos .xlsx/.xlsm/.csv)."""
import csv
import io
import re
import warnings
from html.parser import HTMLParser
from xml.etree import ElementTree
from pathlib import Path

import openpyxl

from . import db
from .util import norm_cpf, norm_nome, sem_acento, to_date, txt

warnings.filterwarnings("ignore", module="openpyxl")

# base -> (aba padrao na planilha, coluna(s) obrigatoria(s), {coluna_db: [cabecalhos aceitos]})
BASES = {
    "escolas": ("CAD_ESCOLA", "ESCOLA", {
        "id": ["ID.:", "ID"], "nome": ["ESCOLA"], "cod_smtt": ["COD_SMTT", "COD SMTT"],
        "inep": ["CODIGO DO INEP", "INEP"]}),
    "geduc": ("GEDUC", "ALUNO", {
        "inep_escola": ["INEP_ESCOLA"], "escola": ["ESCOLA"], "nucleo": ["NUCLEO"], "modalidade": ["MODALIDADE"],
        "id_ano_serie": ["ID_ANO_SERIE"], "aluno": ["ALUNO"], "mae": ["MAE"], "pai": ["PAI"], "genero": ["GENERO"],
        "ano_serie": ["ANO_SERIE"], "turno": ["TURNO"], "turma": ["TURMA"], "id_aluno": ["ID_ALUNO"],
        "dt_nasc": ["DT_NASCIMENTO"], "rua": ["RUA"], "numero": ["NUMERO"], "bairro": ["BAIRRO"],
        "cidade": ["CIDADE"], "cep": ["CEP", "CEP_ALUNO", "CEP ALUNO"], "cpf": ["CPF_ALUNO", "CPF"],
        "telefone": ["TELEFONE", "TELEFONE_ALUNO", "CELULAR", "FONE"]}),
    "censo": ("CENSO", "NOME DO ALUNO", {
        "id_inep": ["IDENTIFICACAO UNICA"], "aluno": ["NOME DO ALUNO"], "dt_nasc": ["DATA DE NASCIMENTO"],
        "cor": ["COR/RACA"], "sexo": ["SEXO"], "cpf": ["CPF"]}),
    "smtt": ("SMTT", "ESTUDANTE", {
        "portaria": ["PORTARIA"], "escola": ["REVISADO"], "id_smtt": ["ID"], "grau": ["GRAU"], "periodo": ["PERIODO"],
        "turma": ["TURMA"], "matricula": ["MATRICULA"], "cartao": ["CARTAO"], "estudante": ["ESTUDANTE"],
        "nascido": ["NASCIDO"], "cpf": ["CPF"], "rg": ["RG"], "org_exp": ["ORG EXP"], "data_exp": ["DATA EXP"],
        "sexo": ["SEXO"], "telefone": ["TELEFONE"], "celular": ["CELULAR"], "email": ["EMAIL"], "cep": ["CEP"],
        "endereco": ["ENDERECO"], "complemento": ["COMPLEMENTO"], "numero": ["NUMERO"], "bairro": ["BAIRRO"],
        "cidade": ["CIDADE"], "uf": ["UF"], "mae": ["MAE"], "pai": ["PAI"], "cadastrado": ["CADASTRADO"],
        "alterado": ["ALTERDADO", "ALTERADO"], "curso": ["CURSO"], "tipo": ["TIPO"], "modalidade": ["MODALIDADE"]}),
    "status_alunos": (" ALUNOS_POR_STATUS", ["ALUNO", "NOME_ALUNO", "NOME DO ALUNO"], {
        "escola": ["ESCOLA"], "turma": ["TURMA"], "turno": ["TURNO"], "id_aluno": ["ID_ALUNO"],
        "inep_aluno": ["INEP_ALUNO"], "aluno": ["ALUNO", "NOME_ALUNO", "NOME DO ALUNO"], "matricula": ["MATRICULA"],
        "nascimento": ["NASCIMENTO", "DT_NASCIMENTO", "DATA DE NASCIMENTO", "DATA_NASCIMENTO"],
        "idade": ["IDADE"], "sexo": ["SEXO"], "cor": ["COR"], "nis": ["NIS"], "situacao": ["SITUACAO"],
        "mae": ["NOME_MAE", "NOME DA MAE", "MAE"], "pai": ["NOME_PAI", "NOME DO PAI", "PAI"],
        "endereco": ["ENDERECO_ALUNO", "ENDERECO"], "numero": ["NUMERO"], "bairro": ["BAIRRO"],
        "certidao": ["CERTIDAO_NASCIMENTO", "CERTIDAO"], "cpf": ["CPF_ALUNO", "CPF"],
        "telefone": ["TELEFONE", "TELEFONE_ALUNO", "CELULAR", "FONE"]}),
}
DATE_COLS = {"dt_nasc", "nascido", "data_exp", "nascimento"}
CPF_COLS = {"cpf"}
NOME_COL = {"geduc": "aluno", "censo": "aluno", "smtt": "estudante", "status_alunos": "aluno"}
LABELS = {"escolas": "Cadastro de instituições", "geduc": "GEDUC", "censo": "Censo escolar", "smtt": "SMTT",
          "status_alunos": "Alunos por status"}


def _h(v) -> str:
    """Cabecalho normalizado: sem acento, maiusculo, '_' igual a espaco (ex.: 'Nome_Mãe' = 'NOME MAE')."""
    return re.sub(r"\s+", " ", sem_acento(txt(v)).upper().replace("_", " ")).strip()


def _obrigatorias(base: str) -> set[str]:
    o = BASES[base][1]
    return {_h(x) for x in ([o] if isinstance(o, str) else o)}


LINHAS_CABECALHO = 50  # exportacoes do GEDUC trazem titulo, filtros e totais antes do cabecalho


def _find_header(rows: list[tuple], base: str) -> int:
    obrig = _obrigatorias(base)
    for i, r in enumerate(rows[:LINHAS_CABECALHO]):
        if obrig & {_h(c) for c in r}:
            return i
    # mostra o que foi lido para a pessoa identificar o arquivo ou a coluna com outro nome
    lidas = [[txt(c)[:30] for c in r if txt(c)] for r in rows[:LINHAS_CABECALHO]]
    lidas = [r for r in lidas if r][:3]
    visto = " | ".join(", ".join(r[:8]) + ("…" if len(r) > 8 else "") for r in lidas) or "nenhum texto"
    raise ValueError(f"Cabeçalho não encontrado: a planilha precisa ter a coluna {' ou '.join(sorted(obrig))} "
                     f"nas primeiras {LINHAS_CABECALHO} linhas. Início do arquivo: {visto[:400]}")


def _map_columns(header: tuple, cols: dict) -> dict[str, int]:
    hn = [_h(c) for c in header]
    out = {}
    for col, aliases in cols.items():
        for a in aliases:
            if _h(a) in hn:
                out[col] = hn.index(_h(a))
                break
    return out


def _clean(base: str, col: str, v):
    if col in DATE_COLS:
        return to_date(v)
    if col in CPF_COLS:
        return norm_cpf(v)
    # quebras de linha e tabulacoes viram espaco (a remessa e um TXT de linhas fixas); o Postgres recusa o nulo
    return re.sub(r"\s+", " ", txt(v).replace("\x00", "")).strip()


def _rows_to_records(base: str, rows_iter) -> list[dict]:
    cols = BASES[base][2]
    rows_iter = iter(rows_iter)
    head = []
    for r in rows_iter:
        head.append(r)
        if len(head) >= LINHAS_CABECALHO:
            break
    hi = _find_header(head, base)
    cmap = _map_columns(head[hi], cols)
    nome_idx = cmap.get(NOME_COL.get(base, "nome"))
    recs = []

    def conv(r):
        if nome_idx is None or nome_idx >= len(r) or not txt(r[nome_idx]):
            return None
        return {c: _clean(base, c, r[i] if i < len(r) else None) for c, i in cmap.items()}

    for r in head[hi + 1:]:
        x = conv(r)
        if x:
            recs.append(x)
    for r in rows_iter:
        x = conv(r)
        if x:
            recs.append(x)
    if not recs:  # evita apagar a base atual com um arquivo vazio ou errado
        raise ValueError(f"Nenhum registro encontrado abaixo do cabeçalho (linha {hi + 1})")
    return recs


def _texto(data: bytes) -> str:
    """Arquivo de texto em UTF-8, UTF-16 ("Texto Unicode" do Excel) ou ANSI (cp1252)."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    amostra = data[:2000]
    if len(amostra) > 20 and amostra[1::2].count(0) > len(amostra) // 4:  # UTF-16 sem BOM
        return data.decode("utf-16-le" if amostra[1] == 0 else "utf-16-be", errors="replace")
    text = data.decode("utf-8-sig", errors="replace")
    if text.count("\ufffd") > 5:
        text = data.decode("cp1252", errors="replace")
    return text


def _csv_rows(text: str) -> list[list]:
    # fim de linha: \r\n (Windows), \n ou so \r (Mac/Excel antigo); \r solto no meio da linha vira espaco
    text = text.replace("\r\n", "\n").replace("\r", "\n" if "\n" not in text else " ")
    amostra = text[:100000]
    sep = max(";,\t", key=amostra.count)  # separador mais frequente (as linhas de titulo nao tem nenhum)
    return list(csv.reader(io.StringIO(text, newline=""), delimiter=sep))


class _Tabela(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(tuple(self.row))
            self.row = None

    def handle_data(self, d):
        if self.cell is not None:
            self.cell.append(d)


def _html_rows(text: str) -> list[tuple]:
    """'.xls' que na verdade e uma tabela HTML (exportacao comum de sistemas web como o GEDUC)."""
    p = _Tabela()
    p.feed(text)
    return p.rows


def _xls_sheets(data: bytes) -> list[tuple[str, list]]:
    """Excel 97-2003 (.xls)."""
    import xlrd

    wb = xlrd.open_workbook(file_contents=data)
    out = []
    for sh in wb.sheets():
        rows = []
        for i in range(sh.nrows):
            row = []
            for c in sh.row(i):
                v = c.value
                if c.ctype == xlrd.XL_CELL_DATE:
                    try:
                        v = xlrd.xldate.xldate_as_datetime(v, wb.datemode)
                    except (ValueError, OverflowError):
                        pass
                row.append(v)
            rows.append(tuple(row))
        out.append((sh.name, rows))
    return out


SS = "{urn:schemas-microsoft-com:office:spreadsheet}"


def _xml_sheets(text: str) -> list[tuple[str, list]]:
    """'.xls' que na verdade e XML do Excel 2003 (SpreadsheetML), outra exportacao comum de sistemas web."""
    raiz = ElementTree.fromstring(re.sub(r"^\s*<\?xml[^>]*\?>", "", text))
    out = []
    for ws in raiz.iter(SS + "Worksheet"):
        rows = []
        for row in ws.iter(SS + "Row"):
            cels, j = [], 0
            for c in row.iter(SS + "Cell"):
                idx = c.get(SS + "Index")
                if idx and idx.isdigit():  # celulas vazias puladas
                    cels += [None] * (int(idx) - 1 - j)
                    j = int(idx) - 1
                d = c.find(SS + "Data")
                v = "".join(d.itertext()) if d is not None else None
                if d is not None and d.get(SS + "Type") == "Number":
                    try:
                        f = float(v)
                        v = int(f) if f.is_integer() else f
                    except ValueError:
                        pass
                cels.append(v)
                j += 1
            rows.append(tuple(cels))
        out.append((ws.get(SS + "Name") or "Planilha", rows))
    return out


def _sheets(filename: str, data: bytes) -> list[tuple[str, list]]:
    """(aba, linhas) de arquivos que nao sao xlsx; o formato e identificado pelo conteudo, nao so pela extensao."""
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":  # xls antigo
        return _xls_sheets(data)
    text = _texto(data)
    inicio = text[:200000].lower()
    if "urn:schemas-microsoft-com:office:spreadsheet" in inicio and "<workbook" in inicio:
        try:
            return _xml_sheets(text)
        except ElementTree.ParseError as ex:
            raise ValueError(f"Arquivo XML do Excel inválido: {ex}") from ex
    if "<table" in inicio:
        return [(Path(filename).stem, _html_rows(text))]
    if "\x00" not in text[:1000]:
        return [(Path(filename).stem, _csv_rows(text))]
    raise ValueError("Formato de arquivo não reconhecido. Envie .xlsx, .xlsm, .xls ou .csv")


def read_file(base: str, filename: str, data: bytes, sheet: str | None = None) -> list[dict]:
    """Base de um arquivo avulso: a aba com o nome padrao, se houver, ou a primeira aba que tenha o cabecalho."""
    alvo = _h(sheet or BASES[base][0])
    wb = None
    if data[:2] == b"PK":  # xlsx / xlsm: aba a aba, sem carregar o arquivo todo na memoria
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        abas = [(ws.title, ws) for ws in wb.worksheets]
    else:
        abas = _sheets(filename, data)
    abas.sort(key=lambda a: _h(a[0]) != alvo)
    erro = None
    try:
        for _, rows in abas:
            try:
                return _rows_to_records(base, rows.iter_rows(values_only=True) if wb else rows)
            except ValueError as ex:
                erro = erro or ex
    finally:
        if wb:
            wb.close()
    raise erro or ValueError("Arquivo sem abas")


def _aba(wb, base: str):
    alvo = _h(BASES[base][0])
    return next((wb[n] for n in wb.sheetnames if _h(n) == alvo), None)


def save(con, base: str, recs: list[dict], arquivo: str) -> int:
    with con:
        if base == "escolas":
            for r in recs:
                if not str(r.get("id", "")).isdigit():
                    continue
                con.execute("""INSERT INTO escolas (id, nome, cod_smtt, inep) VALUES (?,?,?,?)
                               ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, cod_smtt=excluded.cod_smtt,
                               inep=excluded.inep""",
                            (int(r["id"]), r["nome"], r.get("cod_smtt", ""), r.get("inep", "")))
        else:
            con.execute(f"DELETE FROM {base}")
            cols = list(BASES[base][2].keys())
            extra = ["nome_norm"] + (["escola_norm"] if base == "geduc" else [])
            nome_col = NOME_COL[base]
            linhas = ([r.get(c, "") for c in cols] + [norm_nome(r.get(nome_col))]
                      + ([norm_nome(r.get("escola"))] if base == "geduc" else []) for r in recs)
            if hasattr(con, "copy_rows"):  # Postgres
                con.copy_rows(base, cols + extra, linhas)
            else:
                sql = f"INSERT INTO {base} ({','.join(cols + extra)}) VALUES ({','.join('?' * (len(cols) + len(extra)))})"
                con.executemany(sql, list(linhas))
        con.execute("INSERT INTO importacoes (base, arquivo, linhas) VALUES (?,?,?)", (base, arquivo, len(recs)))
    return len(recs)


def import_workbook(path: str, bases: list[str] | None = None, log=print, etapa=lambda m: None) -> dict:
    """Importa a planilha SIS SMPE completa (todas as abas conhecidas)."""
    con = db.connect()
    data = Path(path).read_bytes()
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = {}
    for base in bases or list(BASES):
        ws = _aba(wb, base)
        if ws is None:
            log(f"{LABELS[base]}: aba '{BASES[base][0].strip()}' não encontrada, pulando")
            continue
        etapa(f"Lendo {LABELS[base]}")
        try:
            recs = _rows_to_records(base, ws.iter_rows(values_only=True))
        except ValueError as ex:  # aba vazia ou sem cabecalho: mantem a base atual e segue com as outras
            log(f"{LABELS[base]}: {ex}, base mantida")
            continue
        etapa(f"Gravando {LABELS[base]}: {len(recs)} linhas")
        out[base] = save(con, base, recs, Path(path).name)
        log(f"{LABELS[base]}: {out[base]} linhas")
    wb.close()
    return out
