"""PDFs do modulo Servidores: Registro Individual de Frequencia (layout do FREQUENCIA ... POLO.pdf da SEMED),
Declaracao de Efetivo Exercicio e Endereco Profissional e etiquetas dos aniversariantes do mes.

Coordenadas em pontos a partir do topo da pagina A4 (595 x 842), medidas no PDF de frequencia da SEMED."""
import calendar
import io
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.colors import HexColor, black
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from .pdf import _cabe
from .servidores import MESES, abreviado, mes_ano
from .util import sem_acento

BRASAO = Path(__file__).parent / "modelos" / "brasao_sao_luis.png"
LARG, ALT = A4
FONTE, NEGRITO = "Helvetica", "Helvetica-Bold"
VERMELHO = HexColor("#e00000")
CINZA = HexColor("#d9d9d9")
CINZA_CLARO = HexColor("#f0f0f0")
CABECALHO = [("PREFEITURA DE SÃO LUÍS", NEGRITO), ("SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED", FONTE),
             ("Secretaria Adjunta de Administração e Finanças", FONTE), ("Coordenação de Recursos Humanos", FONTE)]
ORGAO = "SECRETARIA MUNICIPAL DE EDUCAÇÃO – SEMED"
SEMANA = {5: "Sábado", 6: "Domingo"}


class _Pag:
    """Canvas com y a partir do topo."""

    def __init__(self, c):
        self.c = c

    def caixa(self, x0, y0, x1, y1, fundo=None):
        if fundo:
            self.c.setFillColor(fundo)
            self.c.rect(x0, ALT - y1, x1 - x0, y1 - y0, stroke=1, fill=1)
            self.c.setFillColor(black)
        else:
            self.c.rect(x0, ALT - y1, x1 - x0, y1 - y0)

    def texto(self, x0, x1, y0, y1, s, fonte=FONTE, tam=9.5, al="e", cor=black):
        """Texto centralizado na vertical da celula; encolhe para caber na largura."""
        s, tam = _cabe(str(s or ""), x1 - x0 - 6, fonte, tam)
        self.c.setFont(fonte, tam)
        self.c.setFillColor(cor)
        y = ALT - (y0 + y1) / 2 - tam * 0.35
        if al == "c":
            self.c.drawCentredString((x0 + x1) / 2, y, s)
        elif al == "d":
            self.c.drawRightString(x1 - 3, y, s)
        else:
            self.c.drawString(x0 + 3, y, s)
        self.c.setFillColor(black)


def _brasao(c, centro_x: float, topo: float, altura: float):
    if BRASAO.exists():
        img = ImageReader(str(BRASAO))
        w, h = img.getSize()
        larg = altura * w / h
        c.drawImage(img, centro_x - larg / 2, ALT - topo - altura, larg, altura, mask="auto")


def _cabecalho(c, topo: float = 8):
    _brasao(c, LARG / 2, topo, 34)
    for i, (t, f) in enumerate(CABECALHO):
        c.setFont(f, 10.5)
        c.drawCentredString(LARG / 2, ALT - (topo + 44 + i * 13.4), t)


# ------------------------------------------------------------------ registro individual de frequencia

ESQ, DIR = 25, 564
COL_DIA = [25, 46, 110, 310, 366, 564]  # N. | hora entrada | rubrica | hora saida | rubrica
LINHA = 14.75


def _folha(c, s: dict, ano: int, mes: int, feriados: dict[int, tuple[str, str]]):
    p = _Pag(c)
    c.setLineWidth(0.6)
    _cabecalho(c)
    # titulo
    y0, y1 = 107, 122
    p.caixa(ESQ, y0, 310, y1); p.caixa(310, y0, 366, y1); p.caixa(366, y0, DIR, y1)
    p.texto(ESQ, 310, y0, y1, "REGISTRO INDIVIDUAL DE FREQUENCIA", NEGRITO, 11, "c")
    p.texto(310, 366, y0, y1, "Mês/Ano:", tam=10)
    p.texto(366, DIR, y0, y1, mes_ano(ano, mes), tam=10)
    # identificacao do servidor
    linhas = [("Órgão Municipal:", ORGAO, None, None), ("Unidade(Lotação):", s.get("lotacao"), None, None),
              ("Nome:", s.get("nome"), None, None), ("Matrícula:", s.get("matricula"), "Cargo:", s.get("cargo")),
              ("Turno:", s.get("turno"), "Função:", s.get("funcao") or s.get("cargo"))]
    y = 128
    for i, (r1, v1, r2, v2) in enumerate(linhas):
        y1 = y + 14.7
        p.caixa(ESQ, y, 110, y1)
        p.texto(ESQ, 110, y, y1, r1, FONTE if i < 2 else NEGRITO, 9.5, "d")
        if r2:
            p.caixa(110, y, 245, y1); p.caixa(245, y, 310, y1); p.caixa(310, y, DIR, y1)
            p.texto(110, 245, y, y1, v1)
            p.texto(245, 310, y, y1, r2, NEGRITO, 9.5, "d")
            p.texto(310, DIR, y, y1, v2)
        else:
            p.caixa(110, y, DIR, y1)
            p.texto(110, DIR, y, y1, v1, NEGRITO if i == 0 else FONTE, 9.5, "c" if i == 0 else "e")
        y = y1
    # horario de trabalho
    p.caixa(ESQ, 208, DIR, 224)
    p.texto(ESQ, DIR, 208, 224, "HORÁRIO DE TRABALHO", NEGRITO, 9.5, "c")
    n, he, re_, hs, rs, fim = COL_DIA
    p.caixa(n, 224, he, 254)
    p.texto(n, he, 224, 254, "Nº", tam=9.5, al="c")
    p.caixa(he, 224, hs, 239, CINZA); p.caixa(hs, 224, fim, 239, CINZA)
    p.texto(he, hs, 224, 239, "ENTRADA", NEGRITO, 9.5, "c")
    p.texto(hs, fim, 224, 239, "SAÍDA", NEGRITO, 9.5, "c")
    for a, b, t in ((he, re_, "Hora"), (re_, hs, "Rubrica"), (hs, rs, "Hora"), (rs, fim, "Rubrica")):
        p.caixa(a, 239, b, 254)
        p.texto(a, b, 239, 254, t, NEGRITO, 9.5, "c")
    dias = calendar.monthrange(ano, mes)[1]
    for d in range(1, 32):
        y0 = 254 + (d - 1) * LINHA
        y1 = y0 + LINHA
        if d > dias:  # mes com menos de 31 dias: linha apagada
            for a, b in zip(COL_DIA, COL_DIA[1:]):
                p.caixa(a, y0, b, y1, CINZA_CLARO)
            continue
        for a, b in zip(COL_DIA, COL_DIA[1:]):
            p.caixa(a, y0, b, y1)
        p.texto(n, he, y0, y1, d, tam=9.5, al="c")
        marca = feriados.get(d) or ((SEMANA[w], SEMANA[w]) if (w := date(ano, mes, d).weekday()) in SEMANA else None)
        if marca:
            p.texto(re_, hs, y0, y1, marca[0], tam=9.5, al="c", cor=VERMELHO)
            p.texto(rs, fim, y0, y1, marca[1], tam=9.5, al="c", cor=VERMELHO)
    # assinaturas
    meio = (ESQ + DIR) / 2
    p.caixa(ESQ, 730, meio, 818); p.caixa(meio, 730, DIR, 818)
    for x0, x1, chefia, cargo in ((ESQ, meio, "Chefia Imediata:", "Chefe Imediato"),
                                  (meio, DIR, "Chefia Recursos Humanos:", "Coordenador de Recursos Humanos")):
        c.setFont(FONTE, 9.5)
        c.drawString(x0 + 5, ALT - 742, chefia)
        c.drawString(x0 + 5, ALT - 756, "São Luís, ____ /____ /_______")
        c.line(x0 + 35, ALT - 790, x1 - 35, ALT - 790)
        c.drawCentredString((x0 + x1) / 2, ALT - 803, cargo)


def frequencia(servidores: list[dict], ano: int, mes: int, feriados: dict[int, tuple[str, str]]) -> bytes:
    """Uma pagina por servidor."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Registro individual de frequência - {mes_ano(ano, mes)}")
    c.setAuthor("SIS SMPE")
    for s in servidores:
        _folha(c, s, ano, mes, feriados)
        c.showPage()
    c.save()
    return buf.getvalue()


# ------------------------------------------------------------------ declaracao de efetivo exercicio
# layout da aba DECLARACAO do SGI Servidor.xlsm: logo "Sao Luis | SEMED" no cabecalho, dados da escola (o endereco
# profissional), texto da declaracao e a faixa com a silhueta da cidade no rodape (imagens extraidas da planilha)

DECL_CABECALHO = Path(__file__).parent / "modelos" / "declaracao_cabecalho.jpg"
DECL_RODAPE = Path(__file__).parent / "modelos" / "declaracao_rodape.jpg"
ITALICO = "Helvetica-Oblique"


def _data_extenso(d: date) -> str:
    return f"{d.day} de {MESES[d.month - 1].lower()} de {d.year}"


def _imagem(c, arquivo: Path, x: float, topo: float, larg: float):
    if arquivo.exists():
        img = ImageReader(str(arquivo))
        w, h = img.getSize()
        c.drawImage(img, x, ALT - topo - larg * h / w, larg, larg * h / w)


def _endereco(escola: dict) -> str:
    """Como na tabela ESCOLA da planilha: 'Rua da Companhia, 100 - CEP: 65.045-230 - Anil São Luís -MA'."""
    cep = escola.get("cep") or ""
    partes = [escola.get("endereco") or "",
              f"CEP: {cep[:2]}.{cep[2:5]}-{cep[5:]}" if len(cep) == 8 else "",
              " ".join(x for x in (escola.get("bairro"), escola.get("municipio")) if x)]
    return " - ".join(x for x in partes if x)


def _etapa(lotacao: str) -> str:
    """'Ensino Fundamental', 'Educação Infantil'... pelo nome da escola (UEB ENS FUND, CRECHE, UEI...)."""
    k = sem_acento(lotacao).upper()
    if "FUND" in k:
        return "Ensino Fundamental"
    if any(x in k for x in ("INFANTIL", "CRECHE", "UEI ", "U E I")) or k.startswith("UEI"):
        return "Educação Infantil"
    return "Ensino"


def declaracao(s: dict, escola: dict | None, hoje: date, docente: bool | None = None) -> bytes:
    """escola: instituicao cadastrada com o mesmo nome da lotacao (endereco, CEP, e-mail e INEP do cabecalho).
    docente: modelo Professor (True) ou Administrativo (False); None decide pelo quadro e pelos dados de docencia."""
    escola = escola or {}
    fem, masc = s.get("sexo") == "FEMININO", s.get("sexo") == "MASCULINO"
    g = (lambda f, m, x: f if fem else m if masc else x)
    if docente is None:
        docente = s.get("quadro") == "MAGISTÉRIO" or any(s.get(k) for k in ("tipo_ensino", "atuacao", "componente"))
    e = lambda v: f"<b>{escape(str(v))}</b>"
    cargo = s.get("funcao") or s.get("cargo") or "—"
    horas = s.get("horas_semanais") or s.get("carga_horaria")

    paragrafos = [
        f"Declaro, para os devidos fins de comprovação, que {g('a servidora', 'o servidor', 'o(a) servidor(a)')} "
        f"{e(s.get('nome', ''))}, {g('inscrita', 'inscrito', 'inscrito(a)')} na matrícula nº {e(s.get('matricula') or '—')}, "
        f"se encontra em efetivo exercício no cargo/função de {e(cargo)}."]
    itens = []
    if docente:
        itens = [escape(s[k]) for k in ("tipo_ensino", "atuacao") if s.get(k)]
        if s.get("componente"):
            itens.append("Docente responsável pela(s) disciplina(s)/componente(s) curricular(es) de "
                         f"{escape(s['componente'])}.")
    jornada = []
    if horas:
        jornada.append(f"cumpre uma carga horária semanal de {e(str(horas) + 'h')}")
    if s.get("turno"):
        jornada.append(f"atuando no turno {e(s['turno'])}")
    if jornada:
        quem = g("A referida", "O referido", "O(A) referido(a)") + " " + (
            "docente" if docente else g("servidora", "servidor", "servidor(a)"))
        paragrafos.append(f"{quem} {', '.join(jornada)}" + (", conforme a especificação abaixo:" if itens else "."))
    if not docente:  # modelo dos administrativos enviado pela SEMED (com "servidor(a)" no lugar de "funcionaria")
        servidor = g("servidora", "servidor", "servidor(a)")
        partes = [f"Declaro, para os devidos fins de comprovação, que {g('a', 'o', 'o(a)')} {servidor} "
                  f"{e(s.get('nome', ''))}, matrícula nº {e(s.get('matricula') or '—')}, é {servidor} deste "
                  f"Estabelecimento de {_etapa(s.get('lotacao') or '')}, desenvolvendo suas atividades de {e(cargo)}"]
        if s.get("turno"):
            partes.append(f"no turno {e(s['turno'])}")
        if horas:
            partes.append(f"com uma carga horária semanal de {e(str(horas) + 'h')}")
        paragrafos = [", ".join(partes) + "."]

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Declaração de efetivo exercício - {s.get('nome', '')}")
    c.setAuthor("SIS SMPE")
    _imagem(c, DECL_CABECALHO, (LARG - 210) / 2, 10, 210)
    y = 92
    c.setFont(FONTE, 9)
    for t in ("PREFEITURA MUNICIPAL DE SÃO LUÍS", "SECRETARIA MUNICIPAL DE EDUCAÇÃO – SEMED"):
        c.drawCentredString(LARG / 2, ALT - y, t)
        y += 13.5
    y += 9
    escola_linhas = [s.get("lotacao") or "", _endereco(escola), escola.get("email") or "",
                     f"INEP:   {escola['inep']}" if escola.get("inep") else ""]
    for t in escola_linhas:
        if t:
            t, tam = _cabe(t, LARG - 80, FONTE, 9)
            c.setFont(FONTE, tam)
            c.drawCentredString(LARG / 2, ALT - y, t)
            y += 14.5
    y = max(y + 50, 256)
    c.setFont(NEGRITO, 11.5)
    c.drawCentredString(LARG / 2, ALT - y, "DECLARAÇÃO DE EFETIVO EXERCÍCIO E ENDEREÇO PROFISSIONAL")
    y += 50
    corpo = ParagraphStyle("d", fontName=FONTE, fontSize=11.5, leading=23.5, alignment=TA_JUSTIFY, firstLineIndent=48)
    espec = ParagraphStyle("i", parent=corpo, fontName=ITALICO, firstLineIndent=0, leftIndent=48, alignment=TA_LEFT)
    esq, larg = 43, LARG - 86
    for txt, st in [(t, corpo) for t in paragrafos] + [(t, espec) for t in itens]:
        par = Paragraph(txt, st)
        _, h = par.wrap(larg, ALT)
        par.drawOn(c, esq, ALT - y - h + 16)
        y += h
    y += 42
    c.setFont(FONTE, 11.5)
    c.drawCentredString(LARG / 2, ALT - y, f"São Luís/MA, {_data_extenso(hoje)}.")
    y += 48
    c.setLineWidth(0.6)
    c.line(LARG / 2 - 140, ALT - y, LARG / 2 + 140, ALT - y)
    if not docente:
        c.setFont(NEGRITO, 11.5)
        c.drawCentredString(LARG / 2, ALT - y - 16, "GESTOR")
    _imagem(c, DECL_RODAPE, 0, ALT - 18 - LARG * 189 / 834, LARG)
    c.showPage()
    c.save()
    return buf.getvalue()


# ------------------------------------------------------------------ etiquetas dos aniversariantes

# folha A4 com 14 etiquetas de 99,0 x 38,1 mm (Pimaco A4363 / 6182)
ETQ = {"colunas": 2, "linhas": 7, "larg": 99.0 * mm, "alt": 38.1 * mm, "topo": 15.15 * mm, "esq": 4.65 * mm,
       "vao": 2.7 * mm}


def etiquetas(servidores: list[dict], pular: int = 0, guias: bool = False) -> bytes:
    """pular: etiquetas ja usadas no inicio da primeira folha. guias: contorno para conferir em papel comum."""
    por_folha = ETQ["colunas"] * ETQ["linhas"]
    itens = [None] * max(0, min(pular, por_folha - 1)) + list(servidores)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Etiquetas dos aniversariantes")
    c.setAuthor("SIS SMPE")
    for i, s in enumerate(itens):
        if i and i % por_folha == 0:
            c.showPage()
        k = i % por_folha
        col, lin = k % ETQ["colunas"], k // ETQ["colunas"]
        x = ETQ["esq"] + col * (ETQ["larg"] + ETQ["vao"])
        y = ALT - ETQ["topo"] - (lin + 1) * ETQ["alt"]
        if guias:
            c.setStrokeColor(CINZA)
            c.roundRect(x, y, ETQ["larg"], ETQ["alt"], 6)
            c.setStrokeColor(black)
        if not s:
            continue
        cx, larg = x + ETQ["larg"] / 2, ETQ["larg"] - 16
        nome, tam = _cabe(abreviado(s.get("nome", "")), larg, NEGRITO, 15)
        c.setFont(NEGRITO, tam)
        c.drawCentredString(cx, y + ETQ["alt"] - 32, nome)
        cargo, tam = _cabe(s.get("funcao") or s.get("cargo") or "", larg, FONTE, 8.5)
        c.setFont(FONTE, tam)
        c.drawCentredString(cx, y + ETQ["alt"] - 46, cargo)
        try:
            dn = date.fromisoformat(s.get("dt_nasc", "")[:10])
            niver = f"{dn.day:02d}/{dn.month:02d}"
        except ValueError:
            niver = ""
        c.setFont(NEGRITO, 12)
        c.setFillColor(VERMELHO)
        c.drawCentredString(cx, y + 22, niver)
        c.setFillColor(black)
        lot, tam = _cabe(s.get("lotacao") or "", larg, FONTE, 7.5)
        c.setFont(FONTE, tam)
        c.drawCentredString(cx, y + 10, lot)
    if not itens:
        c.setFont(FONTE, 11)
        c.drawCentredString(LARG / 2, ALT / 2, "Nenhum aniversariante no filtro escolhido.")
    c.showPage()
    c.save()
    return buf.getvalue()
