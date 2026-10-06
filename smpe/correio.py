"""Envio de e-mail pelo SMTP configurado pelo administrador (ex.: Gmail com senha de app)."""
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from . import db
from .util import NOME_SISTEMA

PADRAO = {"smtp_host": "smtp.gmail.com", "smtp_porta": "587"}


def config(con) -> dict:
    c = {k: db.get_config(con, k, PADRAO.get(k, "")).strip()
         for k in ("smtp_host", "smtp_porta", "smtp_usuario", "smtp_senha", "smtp_remetente")}
    c["smtp_senha"] = c["smtp_senha"].replace(" ", "")  # o Google mostra a senha de app em blocos de 4
    return c


def configurado(con) -> bool:
    c = config(con)
    return bool(c["smtp_host"] and c["smtp_usuario"] and c["smtp_senha"])


def enviar(con, para: str, assunto: str, texto: str, html: str = ""):
    """Envia um e-mail; erros de conexao/autenticacao sobem como RuntimeError com mensagem amigavel."""
    c = config(con)
    if not (c["smtp_host"] and c["smtp_usuario"] and c["smtp_senha"]):
        raise RuntimeError("O envio de e-mail não está configurado (Configurações → E-mail SMTP)")
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = formataddr((c["smtp_remetente"] or NOME_SISTEMA, c["smtp_usuario"]))
    msg["To"] = para
    msg.set_content(texto)
    if html:
        msg.add_alternative(html, subtype="html")
    porta = int(c["smtp_porta"] or 587)
    ctx = ssl.create_default_context()
    try:
        if porta == 465:
            with smtplib.SMTP_SSL(c["smtp_host"], porta, timeout=20, context=ctx) as s:
                s.login(c["smtp_usuario"], c["smtp_senha"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(c["smtp_host"], porta, timeout=20) as s:
                s.starttls(context=ctx)
                s.login(c["smtp_usuario"], c["smtp_senha"])
                s.send_message(msg)
    except smtplib.SMTPAuthenticationError as ex:
        raise RuntimeError("O servidor de e-mail recusou o usuário/senha. No Gmail, use uma senha de app "
                           "(Conta Google → Segurança → Verificação em duas etapas → Senhas de app)") from ex
    except (smtplib.SMTPException, OSError) as ex:
        raise RuntimeError(f"Falha ao enviar o e-mail: {ex}") from ex
