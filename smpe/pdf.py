"""PDF da remessa: "Relacao simplificada de estudantes", no layout do relatorio oficial da SMTT
(cabecalho da Central de Atendimento ao Estudante, com a logo do sistema no lugar da logo da Prefeitura)."""
import hashlib
import io
from datetime import datetime, timedelta, timezone

from reportlab.lib.colors import HexColor, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .critica import decodificar, parse_linha
from .util import fmt_cpf

SAO_LUIS = timezone(timedelta(hours=-3))  # sem horario de verao
AZUL = HexColor("#1f3b73")
LINHA_COR = HexColor("#9aa3ad")
CABECALHO = ["CENTRAL DE ATENDIMENTO AO ESTUDANTE", "PROCESSO DE HABILITAÇÃO DE ESTUDANTE",
             "AO BENEFÍCIO DA MEIA PASSAGEM"]
TITULO = "RELAÇÃO SIMPLIFICADA DE ESTUDANTES"
# colunas: (titulo, largura em pt, alinhamento)
COLUNAS = [("LINHA", 30, "c"), ("NOME DO ESTUDANTE", 202, "e"), ("CPF", 72, "c"), ("DATA NASC", 50, "c"),
           ("MÃE", 181, "e")]
ESQ, DIR = 30, 565
ALT_LINHA = 14.2
FONTE, FONTE_N = "Helvetica", "Helvetica-Bold"


def alunos_do_txt(conteudo: bytes) -> list[dict]:
    """Registros do arquivo de remessa (o que de fato foi enviado a SMTT), em ordem alfabetica."""
    texto, _ = decodificar(bytes(conteudo))
    out = []
    for linha in texto.split("\n"):
        linha = linha.rstrip("\r")
        if not linha.strip():
            continue
        c = {k: v.strip() for k, v in parse_linha(linha).items()}
        d = c["DT_NASCIMENTO"]
        out.append({"nome": c["NOME_ESTUDANTE"], "cpf": fmt_cpf(c["CPF"]), "mae": c["MAE"],
                    "nasc": f"{d[:2]}/{d[2:4]}/{d[4:]}" if len(d) == 8 else d})
    return sorted(out, key=lambda a: a["nome"])


def codigo_verificacao(conteudo: bytes) -> str:
    """SHA-1 do TXT em grupos de 4 (mesmo formato do codigo no rodape do relatorio oficial)."""
    h = hashlib.sha1(bytes(conteudo)).hexdigest().upper()
    return "-".join(h[i:i + 4] for i in range(0, 40, 4))


def _cabe(texto: str, largura: float, fonte: str, tam: float, minimo: float = 5.2) -> tuple[str, float]:
    """Reduz a fonte (e, no limite, corta o texto) para caber na coluna."""
    while tam > minimo and stringWidth(texto, fonte, tam) > largura:
        tam -= 0.2
    while texto and stringWidth(texto, fonte, tam) > largura:
        texto = texto[:-1]
    return texto, tam


def _le_logo(logo: bytes | None):
    """Logo reduzida a 600 px de largura (nitida na impressao e sem pesar no arquivo)."""
    if not logo:
        return None
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(logo))
        im.thumbnail((600, 600))
        out = io.BytesIO()
        im.save(out, "PNG", optimize=True)
        return ImageReader(io.BytesIO(out.getvalue()))
    except Exception:  # formato que nao da para ler (ex.: SVG): segue sem logo
        return None


def _logo(c, img, x: float, y_topo: float, max_w: float = 150, max_h: float = 44):
    if not img:
        return
    w, h = img.getSize()
    esc = min(max_w / w, max_h / h)
    c.drawImage(img, x, y_topo - h * esc, w * esc, h * esc, mask="auto")


def gerar(lote: dict, cod_instituicao: str, logo: bytes | None, agora: datetime | None = None) -> bytes:
    alunos = alunos_do_txt(lote["conteudo"])
    agora = agora or datetime.now(SAO_LUIS)
    codigo = codigo_verificacao(lote["conteudo"])
    alt_pag = A4[1]
    img = _le_logo(logo)  # uma imagem so, reaproveitada em todas as paginas
    topo_tabela = {True: 730, False: 750}  # primeira pagina tem a linha da instituicao
    fim_tabela, rodape_y = 40, 46
    por_pagina = {p: int((topo_tabela[p] - fim_tabela) // ALT_LINHA) - 1 for p in (True, False)}
    paginas, i = [], 0
    while i < len(alunos) or not paginas:
        n = por_pagina[not paginas]
        paginas.append(alunos[i:i + n])
        i += n

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"{TITULO} - {lote['arquivo']}")
    c.setAuthor("SIS SMPE")
    num = 0
    for p, itens in enumerate(paginas, 1):
        primeira = p == 1
        # cabecalho
        c.setStrokeColor(LINHA_COR)
        c.setLineWidth(0.6)
        c.rect(ESQ, alt_pag - 92, DIR - ESQ, 70)
        c.line(ESQ, alt_pag - 70, DIR, alt_pag - 70)
        _logo(c, img, ESQ + 8, alt_pag - 25)
        c.setFillColor(AZUL)
        c.setFont(FONTE_N, 10)
        for k, txt in enumerate(CABECALHO):
            c.drawRightString(DIR - 8, alt_pag - 36 - k * 12, txt)
        c.setFillColor(black)
        c.setFont(FONTE_N, 10.5)
        c.drawCentredString((ESQ + DIR) / 2, alt_pag - 85, TITULO)
        topo = topo_tabela[primeira]
        if primeira:
            c.rect(ESQ, topo, DIR - ESQ, 20)
            c.setFont(FONTE_N, 8.5)
            c.drawString(ESQ + 6, topo + 6.5, f"INSTITUIÇÃO: {cod_instituicao}")
            c.drawRightString(DIR - 6, topo + 6.5, f"DATA: {agora:%d/%m/%Y} HORA: {agora:%H:%M}")
        # tabela
        y = topo - ALT_LINHA
        linhas = [None] + itens  # None = linha de titulos
        for item in linhas:
            x = ESQ
            if item is None:
                vals, fonte = [t for t, _, _ in COLUNAS], FONTE_N
            else:
                num += 1
                vals, fonte = [str(num), item["nome"], item["cpf"], item["nasc"], item["mae"]], FONTE
            for (tit, larg, al), v in zip(COLUNAS, vals):
                c.rect(x, y, larg, ALT_LINHA)
                v, tam = _cabe(v, larg - 8, fonte, 7.2 if item is None else 7)
                c.setFont(fonte, tam)
                ty = y + (ALT_LINHA - tam) / 2 + 1
                if al == "c" or item is None and tit in ("CPF", "DATA NASC", "LINHA"):
                    c.drawCentredString(x + larg / 2, ty, v)
                else:
                    c.drawString(x + 4, ty, v)
                x += larg
            y -= ALT_LINHA
        # rodape
        c.line(ESQ, rodape_y - 10, DIR, rodape_y - 10)
        c.setFont(FONTE_N, 7)
        c.drawString(ESQ, rodape_y - 20, "NA PÁGINA / TOTAL:")
        c.setFont(FONTE, 7)
        c.drawString(ESQ + stringWidth("NA PÁGINA / TOTAL: ", FONTE_N, 7), rodape_y - 20, f"{len(itens)} / {len(alunos)}")
        c.setFont(FONTE_N, 6.5)
        c.drawCentredString((ESQ + DIR) / 2, rodape_y - 20, codigo)
        c.drawCentredString((ESQ + DIR) / 2, rodape_y - 29, f"SIS SMPE · {lote['arquivo']}")
        c.setFont(FONTE, 7)
        c.drawRightString(DIR, rodape_y - 20, f"PÁGINA: {p} de {len(paginas)}")
        c.showPage()
    c.save()
    return buf.getvalue()
