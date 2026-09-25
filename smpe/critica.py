"""Critica de remessa SMPE, espelhando o validador oficial AlunoCriticaUtf8.exe (Modulo Critica v2019.2.1).

Regras extraidas da legenda do proprio validador (analise estatica do executavel)."""
import codecs
import re
from datetime import date

from .util import cpf_valido, nome_completo

LEGENDA = {
    0: "ESCOLA DEVE SER INFORMADA E DEVER SER UM NUMERO INTEIRO",
    1: "NOME DO ALUNO DEVE SER INFORMADO",
    2: "NOME DA MAE DO ALUNO DEVER SER INFORMADO",
    3: "SEXO DEVE SER INFORMADO E DEVE SER M OU F",
    4: "CURSO DEVE SER INFORMADO",
    5: "GRAU DEVE SER INFORMADO E PODE TER OS VALORES ATRIBUIDOS DE 1 A 3",
    6: "SERIE/PERIODO DEVER SER INFORMADO E DEVE TER OS VALORES ATRIBUIDOS DE 1 A 9",
    7: "TURNO DEVE SER INFORMADO E DEVE SER M OU V OU N OU I",
    8: "MATRICULA DEVE SER INFORMADA",
    9: "DATA DE NASCIMENTO DEVE SER INFORMADA E DEVE SER UMA DATA VALIDA COM 8 DIGITOS",
    10: "ENDERECO DEVE SER INFORMADO",
    11: "BAIRRO DEVE SER INFORMADO",
    12: "CIDADE DEVE SER INFORMADA",
    13: "NOME DO PAI INVALIDO",
    14: "CPF E REQUERIDO",
    15: "CPF DUPLICADO",
    16: "CPF INVALIDO",
    17: "QUANTIDADE DE COLUNAS DIFERENTE DO LAYOUT",
    18: "NOME DA MAE DEVE TER NOME E SOBRENOME",  # regra do SIS SMPE (nao existe no validador oficial)
}
OBS = ["A - CPF OBRIGATORIO COM 11 POSICOES", "B - O FORMATO DO ARQUIVO NAO ACEITA LINHAS EM BRANCO",
       "C - AS LINHAS DEVEM CONTER 375 COLUNAS"]

LAYOUT = [  # (campo, tamanho) - identico ao cds_dados do validador / aba NUM.CARACT
    ("COD_INSTITUICAO", 4), ("NOME_ESTUDANTE", 50), ("MAE", 50), ("PAI", 50), ("SEXO", 1), ("CURSO", 25),
    ("GRAU", 1), ("SERIE_PERIODO", 1), ("TURNO", 1), ("TURMA", 5), ("MATRICULA", 12), ("DT_NASCIMENTO", 8),
    ("ENDERECO", 50), ("BAIRRO", 30), ("CIDADE", 20), ("CEP", 8), ("FONE", 10), ("NUMERO_RG", 20),
    ("ORGAO_EXP", 10), ("DATA_EXP", 8), ("CPF", 11),
]
TAM_LINHA = sum(t for _, t in LAYOUT)  # 375
DATA_MIN = date(1910, 1, 1)


def _data_ok(v: str) -> bool:
    if not re.fullmatch(r"\d{8}", v or ""):
        return False
    try:
        d = date(int(v[4:]), int(v[2:4]), int(v[:2]))
    except ValueError:
        return False
    return DATA_MIN <= d <= date.today()


def criticar_campos(c: dict) -> list[int]:
    """Codigos da legenda violados por um registro (sem a checagem de duplicidade, que e por arquivo)."""
    v = {k: str(c.get(k) or "").strip().upper() for k, _ in LAYOUT}
    e = []
    if not v["COD_INSTITUICAO"].isdigit():
        e.append(0)
    if not v["NOME_ESTUDANTE"]:
        e.append(1)
    if not v["MAE"]:
        e.append(2)
    elif not nome_completo(v["MAE"]):
        e.append(18)
    if v["SEXO"] not in ("M", "F"):
        e.append(3)
    if not v["CURSO"]:
        e.append(4)
    if v["GRAU"] not in ("1", "2", "3"):
        e.append(5)
    if v["SERIE_PERIODO"] not in tuple("123456789"):
        e.append(6)
    if v["TURNO"] not in ("M", "V", "N", "I"):
        e.append(7)
    if not v["MATRICULA"]:
        e.append(8)
    if not _data_ok(v["DT_NASCIMENTO"]):
        e.append(9)
    if not v["ENDERECO"]:
        e.append(10)
    if not v["BAIRRO"]:
        e.append(11)
    if not v["CIDADE"]:
        e.append(12)
    # o criterio exato do validador nao aparece nos textos do executavel: aproximacao = digitos/simbolos
    if v["PAI"] and any(not (ch.isalpha() or ch in " .'-") for ch in v["PAI"]):
        e.append(13)
    if not v["CPF"]:
        e.append(14)
    elif len(v["CPF"]) != 11 or not v["CPF"].isdigit() or not cpf_valido(v["CPF"]):
        e.append(16)
    return e


def parse_linha(linha: str) -> dict:
    out, p = {}, 0
    for nome, tam in LAYOUT:
        out[nome] = linha[p:p + tam]
        p += tam
    return out


def decodificar(data: bytes) -> tuple[str, dict]:
    info = {"bom": data.startswith(codecs.BOM_UTF8), "utf8": True}
    try:
        texto = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        info["utf8"] = False
        texto = data.decode("cp1252", errors="replace")
    return texto, info


def criticar_arquivo(data: bytes, nome_arquivo: str = "") -> dict:
    texto, info = decodificar(data)
    gerais = []
    if not info["utf8"]:
        gerais.append("ESTE SISTEMA SUPORTA APENAS ARQUIVO NO FORMATO UTF8 (arquivo nao e UTF-8 valido)")
    elif not info["bom"] and any(ord(ch) > 127 for ch in texto):
        gerais.append("Arquivo UTF-8 sem BOM com caracteres acentuados: o validador pode nao reconhecer a codificacao")
    m = re.match(r"^INST_(\d+)_REM_(\d+)\.txt$", nome_arquivo or "", re.I)
    if nome_arquivo and not m:
        gerais.append("Nome fora do padrao INST_<codigo>_REM_<numero>.txt")
    linhas = texto.split("\n")
    if linhas and linhas[-1] == "":
        linhas.pop()  # quebra final do arquivo
    registros, cpfs = [], {}
    brancos = 0
    for n, raw in enumerate(linhas, 1):
        linha = raw.rstrip("\r")
        if not linha.strip():
            brancos += 1
            registros.append({"linha": n, "campos": {}, "codigos": [], "branco": True, "colunas": len(linha)})
            continue
        campos = parse_linha(linha)
        cod = criticar_campos(campos)
        if len(linha) != TAM_LINHA:
            cod.append(17)
        cpf = campos["CPF"].strip()
        if cpf:
            cpfs.setdefault(cpf, []).append(len(registros))
        registros.append({"linha": n, "campos": {k: v.strip() for k, v in campos.items()}, "codigos": cod,
                          "branco": False, "colunas": len(linha)})
    for idxs in cpfs.values():
        if len(idxs) > 1:
            for i in idxs:
                registros[i]["codigos"].append(15)
    for r in registros:
        r["codigos"] = sorted(set(r["codigos"]))
    if brancos:
        gerais.append(f"O FORMATO DO ARQUIVO NAO ACEITA LINHAS EM BRANCO ({brancos} linha(s))")
    validos = [r for r in registros if not r["branco"]]
    ok = sum(1 for r in validos if not r["codigos"])
    impeditivos = [g for g in gerais if not g.startswith(("Arquivo UTF-8 sem BOM", "Nome fora"))]
    return {"arquivo": nome_arquivo, "codificacao": info, "gerais": gerais, "total": len(validos), "ok": ok,
            "nao_ok": len(validos) - ok, "registros": registros, "legenda": LEGENDA, "obs": OBS,
            "tam_linha": TAM_LINHA, "escola": m.group(1) if m else "", "remessa": m.group(2) if m else "",
            "aprovado": bool(validos) and not impeditivos and ok == len(validos)}


def relatorio_txt(res: dict) -> str:
    """Relatorio no mesmo formato do CRITICA_*.txt do validador."""
    L = ["RELATORIO DE CRITICA", "",
         "OS ALUNOS ABAIXO RELACIONADOS ESTAO COM ALGUNS DOS CAMPOS OBRIGATORIOS SEM PREENCHIMENTO OU COM VALORES INVALIDOS.",
         "AO LADO DE CADA CAMPO SEM PREENCHIMENTO OU COM VALOR INVALIDO EXISTE UM NUMERO ENTRE PARENTESES QUE INDICA QUE VALOR DEVE SER CORRIGIDO.",
         "FAVOR OBSERVAR A LEGENDA NO RODAPE DESTE ARQUIVO E CORRIGIR OS VALORES INVALIDOS.", ""]
    for g in res["gerais"]:
        L.append("*** " + g)
    L.append("")
    L.append(f"{'LINHA':<7}{'NOME':<52}{'CPF':<13}CODIGOS")
    for r in res["registros"]:
        if r["branco"]:
            L.append(f"{r['linha']:<7}{'(LINHA EM BRANCO)':<52}")
        elif r["codigos"]:
            L.append(f"{r['linha']:<7}{r['campos']['NOME_ESTUDANTE'][:50]:<52}{r['campos']['CPF']:<13}"
                     + " ".join(f"({c})" for c in r["codigos"]))
    L += ["", "LEGENDA EXPLICATIVA"] + [f"{k:<3}- {v}" for k, v in LEGENDA.items()]
    L += ["", f"TOTAL DE REGISTROS..: {res['total']}", f"   REGISTROS OK.....: {res['ok']}",
          f"   REGISTROS NAO OK.: {res['nao_ok']}", "", "OBS:"] + [" " + o for o in OBS]
    return "\r\n".join(L) + "\r\n"
