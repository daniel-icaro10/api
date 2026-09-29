# Publicar o SIS SMPE na VPS da Hostinger (cPanel/WHM)

O sistema roda como um serviço na própria VPS (em `127.0.0.1:8010`, invisível de fora) e o Apache do cPanel entrega o domínio principal para ele, com HTTPS. O banco é um PostgreSQL na VPS.

Tempo estimado: 30 a 60 minutos. Você vai precisar de:

- **Senha root da VPS**: no hPanel da Hostinger, **VPS → Gerenciar → Visão geral → Acesso SSH** (lá também dá para redefinir a senha root).
- **WHM**: `https://IP-DA-VPS:2087`, usuário `root`.
- **URL externa do banco do Render** (para trazer os dados): Render → `sis-smpe-db` → **Connect → External Database URL**.

Nos comandos abaixo, troque `smpe` pelo usuário do cPanel e `seudominio.com.br` pelo domínio.

## 1. Conta do cPanel e domínio

1. No WHM, abra **Account Functions → Create a New Account** (se ainda não houver uma conta para o domínio). Domínio: `seudominio.com.br`; usuário: por exemplo `smpe`.
2. No painel de DNS do domínio (Hostinger → **Domínios → DNS**), aponte o registro **A** de `@` e de `www` para o IP da VPS.
3. Quando o DNS propagar, gere o certificado: WHM → **SSL/TLS → Manage AutoSSL → Run AutoSSL** para a conta (ou cPanel da conta → **SSL/TLS Status → Run AutoSSL**).

## 2. PostgreSQL

1. WHM → **SQL Services → Configure PostgreSQL** → **Install PostgreSQL** (se ainda não estiver instalado) e defina a senha do usuário `postgres` quando pedir.
2. No cPanel da conta, abra **Bancos de dados PostgreSQL**:
   - crie o banco `smpe` (vira `smpe_smpe`, o cPanel põe o usuário na frente);
   - crie o usuário `smpe` com uma senha forte (vira `smpe_smpe`);
   - em **Adicionar usuário ao banco**, ligue o usuário ao banco.

## 3. Módulos do Apache

WHM → **Software → EasyApache 4 → Customize → Apache Modules**: confirme que `mod_proxy`, `mod_proxy_http` e `mod_headers` estão marcados (normalmente já estão) e clique em **Provision** se mudar algo.

## 4. Instalar o sistema

Entre na VPS por SSH como root (no Windows, abra o PowerShell):

```
ssh root@IP-DA-VPS
```

Baixe o instalador e rode:

```
curl -fsSLO https://raw.githubusercontent.com/daniel-icaro10/api/main/deploy/instalar.sh
bash instalar.sh smpe seudominio.com.br
```

Na primeira vez ele termina pedindo a configuração do banco. Edite o arquivo:

```
nano /home/smpe/sis-smpe/deploy/smpe.env
```

e troque a linha `DATABASE_URL` pelos dados do passo 2, por exemplo:

```
DATABASE_URL=postgresql://smpe_smpe:SENHA-DO-BANCO@localhost:5432/smpe_smpe
```

(Se a senha tiver `@`, `:` ou `/`, troque por `%40`, `%3A` e `%2F`.) Salve com **Ctrl+O**, **Enter**, **Ctrl+X** e rode o instalador de novo:

```
bash instalar.sh smpe seudominio.com.br
```

Ele termina com **"OK: sistema no ar"**. O banco é criado vazio nessa hora.

## 5. Trazer os dados do Render

Com o sistema instalado, copie tudo do Render (alunos, instituições, usuários, remessas, fichas...):

```
cd /home/smpe/sis-smpe
sudo -u smpe bash -c 'set -a; . deploy/smpe.env; set +a; .venv/bin/python -m smpe migrar "URL-EXTERNA-DO-RENDER?sslmode=require" --substituir'
systemctl restart smpe
```

A cópia confere as contagens de cada tabela no final ("Migracao concluida: contagens conferem"). Os usuários e senhas continuam os mesmos; só será preciso entrar de novo.

## 6. Conferir

Abra `https://seudominio.com.br`, entre e confira o Painel, uma instituição no Matriculado e uma remessa. Depois disso, o Render pode ser desligado (o banco gratuito expira em 24/10/2026 de qualquer forma).

## Atualizar depois (a cada correção enviada ao GitHub)

```
ssh root@IP-DA-VPS
bash /home/smpe/sis-smpe/deploy/atualizar.sh smpe
```

## Comandos úteis

| Para | Comando |
|---|---|
| Ver se está rodando | `systemctl status smpe` |
| Ver os erros (log) | `journalctl -u smpe -n 100 --no-pager` |
| Acompanhar o log ao vivo | `journalctl -u smpe -f` |
| Reiniciar | `systemctl restart smpe` |
| Recuperar o acesso do admin | preencha `SMPE_RESET_LOGIN` e `SMPE_RESET_SENHA` em `deploy/smpe.env`, `systemctl restart smpe`, entre e apague as duas linhas |

Backup do banco (gera `smpe-AAAA-MM-DD.dump` na pasta do usuário):

```
sudo -u smpe bash -c 'cd ~/sis-smpe; set -a; . deploy/smpe.env; set +a; pg_dump -Fc -f ~/smpe-$(date +%F).dump "$DATABASE_URL"'
```

## Se algo der errado

- **Página do cPanel ou "Index of" no lugar do sistema**: as regras do Apache não entraram. Rode o instalador de novo e confira o passo 3.
- **Erro 503 / Service Unavailable**: o serviço está parado. Veja `journalctl -u smpe -n 50 --no-pager`.
- **Erro de senha do banco no log**: confira usuário, senha e nome do banco em `deploy/smpe.env` (com o prefixo do cPanel).
- **Certificado inválido**: o DNS ainda não apontava para a VPS quando o AutoSSL rodou. Rode o AutoSSL de novo.
