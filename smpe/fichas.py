"""Fichas da SMTT (Central de Atendimento ao Estudante) preenchidas sobre os PDFs oficiais em smpe/modelos.

Coordenadas em pontos a partir do topo da pagina (A4: 595,32 x 841,92), medidas nos proprios modelos."""
import io
from datetime import date
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .util import fmt_cpf

MODELOS = Path(__file__).parent / "modelos"
ALTURA = 841.92
FONTE, NEGRITO = "Helvetica", "Helvetica-Bold"
COR = (0.05, 0.1, 0.35)  # azul-escuro, para distinguir do impresso

TIPOS_ENSINO = ["Educação Infantil", "Ensino Fundamental I", "Ensino Fundamental II", "Ensino Médio", "Pré-Vestibular",
                "Educação Especial", "Educação Profissional", "Educação de Jovens e Adultos (EJA)", "Ensino Superior",
                "Outro"]  # codigo = posicao + 1 (legenda da relacao de cursos)
MODALIDADES = ["Presencial", "Semipresencial", "À distância (100% EAD)"]
TURNOS = ["M", "V", "N", "I"]
REDES = ["MUNICIPAL", "ESTADUAL", "FEDERAL", "PARTICULAR", "FILANTROPICA"]
COMPLEMENTARES = ["salas", "vagas", "alunos", "professores", "funcionarios"]
DOCUMENTOS = ["ato_criacao", "termo_reconhecimento", "alvara"]


def _fmt_data(iso: str) -> str:
    try:
        return date.fromisoformat((iso or "")[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return iso or ""


def _fmt_cnpj(c: str) -> str:
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}" if len(c or "") == 14 else (c or "")


def _fmt_cep(c: str) -> str:
    return f"{c[:5]}-{c[5:]}" if len(c or "") == 8 else (c or "")


def _num(v) -> str:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return ""
    return str(n) if n or v in (0, "0") else ""


class _Tela:
    """Canvas com coordenadas a partir do topo e texto que encolhe para caber no campo."""

    def __init__(self, c: canvas.Canvas):
        self.c = c
        c.setFillColorRGB(*COR)

    def txt(self, x, y, s, largura=None, tam=9, fonte=FONTE, alinhar="esq"):
        s = str(s or "").strip()
        if not s:
            return
        if largura:
            while tam > 5 and stringWidth(s, fonte, tam) > largura:
                tam -= 0.25
            while stringWidth(s, fonte, tam) > largura and len(s) > 1:
                s = s[:-1]
        self.c.setFont(fonte, tam)
        yy = ALTURA - y
        if alinhar == "centro":
            self.c.drawCentredString(x, yy, s)
        else:
            self.c.drawString(x, yy, s)

    def centro(self, x, y_centro, s, largura=None, tam=8.5, fonte=FONTE):
        self.txt(x, y_centro + tam * 0.35, s, largura, tam, fonte, "centro")


def _gerar(modelo: str, paginas: list) -> bytes:
    """paginas: lista de funcoes que desenham cada pagina (recebem _Tela) sobre uma copia do modelo."""
    saida = PdfWriter()
    for desenhar in paginas:
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(595.32, ALTURA))
        desenhar(_Tela(c))
        c.save()
        base = PdfReader(MODELOS / modelo).pages[0]  # copia nova do modelo a cada pagina
        base.merge_page(PdfReader(io.BytesIO(buf.getvalue())).pages[0])
        saida.add_page(base)
    out = io.BytesIO()
    saida.write(out)
    return out.getvalue()


# ---------------------------------------------------------------- ficha de cadastro da instituicao de ensino

CNPJ_X = [43.2, 60.2, 77.4, 94.4, 111.4, 128.4, 145.4, 162.4, 179.4, 196.6, 213.9, 230.4, 246.9, 263.4]
CODIGO_X = [325.1, 341.1, 357.0, 373.0]
REDE_Y = [362.6, 377.1, 391.5, 406.0, 420.4]
SALAS_X = ([186.4, 218.9, 251.4, 283.9, 316.1], [424.5, 457.0, 489.5, 522.0, 554.2])  # MAT VESP NOT INT N.SALAS
COMPL_X = [154.9, 184.8, 214.7, 244.6, 277.2]  # MAT VESP NOT INTRG TOTAL
COMPL_Y = [475.0, 490.1, 505.2, 520.3, 535.5]
DOC_X = [426.8, 484.0, 541.3]  # numero, data de expedicao, validade
DOC_Y = [475.0, 497.7, 520.3]


def ficha_instituicao(e: dict) -> bytes:
    ficha = e.get("ficha") or {}
    reps = e.get("representantes") or []
    diretor = next((r for r in reps if r.get("funcao_ficha") == "diretor"), None)
    adjunto = next((r for r in reps if r.get("funcao_ficha") == "adjunto"), None)

    def desenhar(t: _Tela):
        for x, ch in zip(CNPJ_X, (e.get("cnpj") or "")[:14]):
            t.centro(x + 8.5, 169.4, ch, tam=10)
        cod = (e.get("cod_smtt") or "").strip()
        for x, ch in zip(CODIGO_X, cod.zfill(4) if cod else ""):
            t.centro(x + 8, 169.3, ch, tam=10)
        t.txt(92, 216.8, e.get("nome"), 464)
        t.txt(92, 234.8, e.get("endereco"), 464)
        t.txt(92, 253.8, e.get("bairro"), 226)
        t.txt(382, 253.9, e.get("municipio"), 174)
        t.txt(95, 273.8, _fmt_cep(e.get("cep")), 100)
        t.txt(384, 274.1, e.get("telefone"), 172)
        t.txt(93, 292.2, e.get("email"), 226)
        if e.get("rede") in REDES:
            t.centro(90.8, REDE_Y[REDES.index(e["rede"])], "X", tam=10, fonte=NEGRITO)
        salas = ficha.get("salas") or {}
        for i in range(10):
            s = salas.get(str(i + 1)) or {}
            vals = [_num(s.get(k)) for k in TURNOS]
            total = _num(s.get("salas")) or (_num(sum(int(v) for v in vals if v)) if any(vals) else "")
            for x, v in zip(SALAS_X[i // 5], vals + [total]):
                t.centro(x, REDE_Y[i % 5], v)
        compl = ficha.get("complementares") or {}
        for y, k in zip(COMPL_Y, COMPLEMENTARES):
            s = compl.get(k) or {}
            vals = [_num(s.get(tn)) for tn in TURNOS]
            tot = sum(int(v) for v in vals if v)
            for x, v in zip(COMPL_X, vals + [str(tot) if any(vals) else ""]):
                t.centro(x, y, v)
        docs = ficha.get("documentos") or {}
        for y, k in zip(DOC_Y, DOCUMENTOS):
            d = docs.get(k) or {}
            t.centro(DOC_X[0], y, d.get("numero"), 54, tam=7.5)
            t.centro(DOC_X[1], y, _fmt_data(d.get("data")), 54, tam=7.5)
            t.centro(DOC_X[2], y, _fmt_data(d.get("validade")), 54, tam=7.5)
        if diretor:
            t.txt(156.5, 629.2, diretor.get("nome"), 168, tam=8.5, alinhar="centro")
        if adjunto:
            t.txt(157.6, 653.2, adjunto.get("nome"), 168, tam=8.5, alinhar="centro")

    return _gerar("ficha_instituicao.pdf", [desenhar])


# ---------------------------------------------------------------- relacao de cursos da instituicao de ensino

CURSOS_POR_PAGINA = 36


def ficha_cursos(e: dict) -> bytes:
    cursos = e.get("cursos") or []
    blocos = [cursos[i:i + CURSOS_POR_PAGINA] for i in range(0, len(cursos), CURSOS_POR_PAGINA)] or [[]]

    def pagina(bloco):
        def desenhar(t: _Tela):
            cod = (e.get("cod_smtt") or "").strip()
            t.txt(81, 161.8, cod.zfill(4) if cod else "", 45)
            t.txt(190, 161.8, e.get("nome"), 372)
            for k, c in enumerate(bloco):
                y = 201.75 + 14.5 * k + 7.25  # centro da linha k
                t.txt(66, y + 3, c.get("curso"), 354, tam=8.5)
                t.centro(464.3, y, c.get("tipo_ensino"))
                t.centro(537.6, y, c.get("modalidade"))
        return desenhar

    return _gerar("ficha_cursos.pdf", [pagina(b) for b in blocos])


# ---------------------------------------------------------------- ficha de cadastro do representante

RESP_X = ([157.1, 194.0, 230.8, 267.6], [438.9, 475.7, 512.6, 549.4])  # MAT VESP NOT INTEG
RESP_Y = [464.2, 480.6, 497.0, 513.3, 529.7]


def ficha_representantes(e: dict, indice: int | None = None) -> bytes:
    reps = e.get("representantes") or []
    if indice is not None:
        reps = reps[indice:indice + 1]
    cod = (e.get("cod_smtt") or "").strip()

    def pagina(r: dict):
        def desenhar(t: _Tela):
            t.txt(74, 201.8, cod.zfill(4) if cod else "", 48)
            t.txt(183, 201.8, e.get("nome"), 376)
            t.txt(61, 252.3, fmt_cpf(r.get("cpf") or ""), 109)
            t.txt(202, 252.3, r.get("rg"), 113)
            t.txt(368, 252.3, r.get("org_exp"), 48)
            t.txt(486, 252.3, _fmt_data(r.get("data_exp")), 74)
            t.txt(104, 272.3, r.get("nome"), 311)
            t.txt(102, 293.0, r.get("cargo"), 233)
            t.txt(81, 327.8, r.get("endereco"), 253)
            t.txt(81, 347.6, r.get("bairro"), 163)
            t.txt(277, 347.6, _fmt_cep(r.get("cep")), 77)
            t.txt(407, 347.6, r.get("municipio"), 153)
            t.txt(81, 366.9, r.get("contato"), 78, tam=8.5)
            t.txt(199, 366.9, r.get("email"), 155, tam=8.5)
            resp = r.get("responsabilidade") or {}
            for i in range(10):
                for x, tn in zip(RESP_X[i // 5], TURNOS):
                    if tn in (resp.get(str(i + 1)) or []):
                        t.centro(x, RESP_Y[i % 5], "X", tam=10, fonte=NEGRITO)
        return desenhar

    return _gerar("ficha_representante.pdf", [pagina(r) for r in reps] or [pagina({})])
