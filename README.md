# SIS SMPE (web)

Versão web da planilha **SIS SMPE 2026.4.xlsm**. O sistema faz a migração de estudantes da rede municipal para o cadastro da SMTT: cruza o CPF das bases GEDUC, Censo e SMTT, aponta as pendências de cada escola, gera a remessa em layout fixo e calcula o orçamento.

## Como usar

1. Dê dois cliques em `abrir.bat`. O sistema abre em http://127.0.0.1:8010.
2. Em **Bases e importação**, envie a planilha `.xlsm` completa ou cada base separada (`.xlsx`/`.csv`).
3. Em **Escolas**, confira o **vínculo GEDUC** das escolas marcadas "0 — vincular", que são as que têm nome diferente no GEDUC.
4. Em **Migração**, escolha a escola, filtre as pendências e corrija os alunos clicando neles. Depois selecione os aptos e clique em **Gerar remessa SMTT**.

Para importar pela linha de comando: `python -m smpe importar "C:\...\SIS SMPE 2026.4.xlsm"`

## Equivalência planilha → sistema

| Planilha | Sistema |
|---|---|
| MENU / botão "Localizar Estudante" | Painel + busca no topo, em toda a rede, por nome ou CPF |
| CAD_ESCOLA | Escolas: cadastro com código SMTT, INEP e vínculo GEDUC |
| ESCOLA (filtro avançado + colunas AG:AO) | Migração: cruzamento GEDUC × Censo × SMTT e CPF consolidado |
| Botões CPF divergente / com CPF / sem CPF / duplicado / mãe não informada | Abas de filtro da Migração |
| REL_SEM_CPF / REL_SEM_MAE / REL_SIMPLIFICADA | Relatórios para imprimir (o simplificado mostra o CPF mascarado) |
| ALUNO + ENTRADA + NUM.CARACT | Remessa SMTT: arquivo `INST_<cód>_REM_<nº>.txt` em UTF-8 com BOM, 21 campos, 375 colunas |
| AlunoCriticaUtf8.exe (validador oficial SMPE) | Criticar remessa: mesmas críticas de 0 a 17 e regras A a C, com relatório `CRITICA_*.txt` |
| ORÇAMENTO | Orçamento: migrados × preço unitário + peticionamento − desconto |
| GEDUC, CENSO, SMTT, ALUNOS_POR_STATUS | Bases e importação |

## Regra do CPF consolidado (mesma fórmula da coluna AO)

- Se as três fontes concordam, ou se duas concordam, vale a maioria.
- Se só uma fonte tem CPF, vale essa fonte.
- Se as fontes com CPF discordam entre si, o aluno fica como **DIVERGENTE**.
- A correção informada no sistema tem prioridade sobre as bases. Ela substitui o preenchimento em papel dos relatórios.
- O cruzamento é feito pelo **nome do aluno**, como os PROCV da planilha. Quando há nomes iguais, o sistema escolhe o registro com a mesma data de nascimento.

## Melhorias em relação à planilha

- Verificação dos dígitos do CPF, com a pendência **CPF inválido**.
- CPF repetido entre alunos da mesma escola marcado como **CPF duplicado**.
- Histórico de remessas. Cada aluno enviado fica marcado como migrado, e o orçamento conta os migrados reais.
- A remessa rejeita aluno sem CPF válido, sem data de nascimento ou de escola sem código SMTT, e avisa quando algum campo é truncado.

## Crítica da remessa (validador oficial SMPE)

As regras foram extraídas por análise estática do `AlunoCriticaUtf8.exe` (Módulo Crítica v2019.2.1), sem executar o programa:

| Cód. | Regra |
|---|---|
| 0 | Escola informada e numérica |
| 1 / 2 | Nome do aluno e nome da mãe obrigatórios |
| 3 | Sexo M ou F |
| 4 | Curso informado |
| 5 | Grau de 1 a 3 |
| 6 | Série/período de 1 a 9 |
| 7 | Turno M, V, N ou I |
| 8 | Matrícula informada |
| 9 | Nascimento com data válida de 8 dígitos |
| 10–12 | Endereço, bairro e cidade obrigatórios |
| 13 | Nome do pai inválido |
| 14–16 | CPF obrigatório, CPF duplicado e CPF inválido |
| 17 | Linha com número de colunas diferente de 375 |

Também são rejeitados arquivos que não estão em UTF-8 e arquivos com linhas em branco.

Na Migração, o aluno que seria rejeitado recebe a pendência **Crítica SMTT**, com o código da regra, e não entra na remessa.

Ressalvas:
- A regra 13 é uma aproximação. O validador não expõe o critério em texto, então o sistema trata como inválido o nome do pai que tiver dígitos ou símbolos.
- O BOM do UTF-8 pode ser desligado com a configuração `remessa_bom=0`.

Na importação, o sistema corrige automaticamente os nomes com acentuação corrompida na origem (por exemplo, "ANTÃ”NIO" vira "ANTÔNIO").

## Dados

O banco fica em `data/smpe.db` (SQLite). As bases têm dados pessoais de estudantes menores de idade. O servidor atende só este computador (127.0.0.1) e não tem login. Não exponha o sistema na rede sem antes incluir autenticação.
