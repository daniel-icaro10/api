# SIS SMPE (web)

Versão web da planilha **SIS SMPE 2026.4.xlsm**. O sistema faz a migração de estudantes da rede municipal para o cadastro da SMTT: cruza o CPF das bases GEDUC, Censo, SMTT e Alunos por status, aponta as pendências de cada instituição, gera a remessa em layout fixo e calcula o orçamento.

## Como usar

1. Dê dois cliques em `abrir.bat`. O sistema abre em http://127.0.0.1:8010.
2. No primeiro acesso, crie o login e a senha do **administrador**.
3. Em **Bases e importação**, envie a planilha `.xlsm` completa ou cada base separada (`.xlsx`/`.csv`).
4. Em **Instituições**, confira o **vínculo GEDUC** das instituições marcadas "0 — vincular", que são as que têm nome diferente no GEDUC. Em **Usuários**, crie os logins e vincule cada um a uma ou mais instituições.
5. Em **Matriculado**, escolha a instituição, filtre as pendências e clique em **Corrigir** para editar a informação incorreta. Ao salvar, o aluno é reprocessado na hora. Depois selecione os aptos e clique em **Gerar remessa SMTT**.

## Perfis de acesso

| Perfil | Pode |
|---|---|
| Administrador | Tudo: cadastrar instituições e usuários, bloquear e desbloquear, gerar orçamentos, importar bases e mudar as configurações (logo, suporte, WhatsApp, preço) |
| Instituição | Vê só os alunos das instituições vinculadas ao usuário: Painel, Matriculado (correções e cadastro individual), Remessas, arquivo do processamento final, Criticar remessa e Relatórios. Não cadastra instituições nem gera orçamentos |

- O administrador cadastra os usuários em **Usuários** e vincula cada um a uma ou mais instituições.
- O nome da instituição ativa aparece no canto superior direito. Quem tem mais de uma instituição troca a ativa pelo menu desse canto, que também tem alterar senha e sair.
- **Bloqueio**: em Instituições, o botão **Bloquear** impede o acesso à instituição (por exemplo, por pendência de pagamento). O usuário vinculado a outras instituições continua entrando nelas; quem só tem instituições bloqueadas vê o motivo na tela de login e é desconectado na próxima ação.
- O administrador também pode ser criado pelas variáveis `SMPE_ADMIN_LOGIN` e `SMPE_ADMIN_SENHA`, quando o banco ainda não tem nenhum usuário.
- A sessão dura 12 horas. As senhas são guardadas com hash PBKDF2.

Para importar pela linha de comando: `python -m smpe importar "C:\...\SIS SMPE 2026.4.xlsm"`

## Equivalência planilha → sistema

| Planilha | Sistema |
|---|---|
| MENU / botão "Localizar Estudante" | Painel + busca no topo, por nome ou CPF (a instituição busca só nos próprios alunos) |
| CAD_ESCOLA | Instituições: cadastro com código SMTT, INEP, vínculo GEDUC, acesso e bloqueio |
| ESCOLA (filtro avançado + colunas AG:AO) | Matriculado: cruzamento GEDUC × Censo × SMTT × Status e CPF consolidado |
| Botões CPF divergente / com CPF / sem CPF / duplicado / mãe não informada | Abas de filtro do Matriculado |
| REL_SEM_CPF / REL_SEM_MAE / REL_SIMPLIFICADA | Relatórios para imprimir (o simplificado mostra o CPF mascarado) |
| ALUNO + ENTRADA + NUM.CARACT | Remessa SMTT: arquivo `INST_<cód>_REM_<nº>.txt` em UTF-8 com BOM, 21 campos, 375 colunas |
| AlunoCriticaUtf8.exe (validador oficial SMPE) | Criticar remessa: mesmas críticas de 0 a 17 e regras A a C, com relatório `CRITICA_*.txt`, mais a crítica 18 (mãe com nome e sobrenome) |
| ORÇAMENTO | Orçamento (só administrador): migrados com CPF × preço unitário + peticionamento − desconto |
| GEDUC, CENSO, SMTT, ALUNOS_POR_STATUS | Bases e importação |

## Regra do CPF consolidado (mesma fórmula da coluna AO)

- As fontes são GEDUC, Censo, SMTT e a base **Alunos por status** (a 4ª fonte, que também fornece o telefone).
- Vale o CPF que aparece em mais fontes. Se só uma fonte tem CPF, vale essa fonte.
- Se as fontes com CPF discordam entre si e nenhuma tem maioria (empate), o aluno fica como **DIVERGENTE**. Com três fontes, é a mesma fórmula da coluna AO.
- A correção informada no sistema tem prioridade sobre as bases. Ela substitui o preenchimento em papel dos relatórios.
- O cruzamento é feito pelo **nome do aluno**, como os PROCV da planilha, conferindo a data de nascimento: um registro com o mesmo nome e data diferente é de outro aluno (homônimo) e não entra no cruzamento. Sem data em uma das bases, vale só o nome.
- A instituição vê na ficha do aluno só o registro de cada base que entrou no cruzamento.

## Melhorias em relação à planilha

- Verificação dos dígitos do CPF, com a pendência **CPF inválido**.
- CPF repetido entre alunos da mesma escola marcado como **CPF duplicado**.
- Histórico de remessas. Cada aluno enviado fica marcado como migrado, e o orçamento conta os migrados reais.
- **Mãe sem sobrenome**: o nome da mãe precisa ter nome e sobrenome (partículas como DA, DE e DOS não contam). O aluno sem isso não fica apto e, no arquivo, recebe a crítica 18.
- **Correção e reprocessamento**: a instituição corrige qualquer campo do aluno (nome, CPF, mãe, pai, sexo, nascimento, série, turno, turma, matrícula, endereço, CEP, telefone e documentos). Os campos com problema aparecem destacados, e o aluno é reprocessado ao salvar.
- **Cadastro individual**: a instituição cadastra, edita e exclui alunos que não estão no GEDUC (botão **Cadastrar aluno** no Matriculado). Esses alunos passam pelas mesmas regras e entram na remessa normalmente.
- **Telefone**: vem da correção, do GEDUC (coluna `TELEFONE`), da base Alunos por status ou do SMTT, nessa ordem. O sistema usa o primeiro número válido do campo e completa o DDD 98 quando falta.
- **CEP**: vem do GEDUC (coluna `CEP` ou `CEP_ALUNO`), a menos que a instituição corrija. Sem CEP, a remessa usa 65000000.
- **Orçamento só com CPF**: a base do orçamento é o total de matriculados com CPF consolidado, e só contam os migrados com CPF.
- **Arquivo do processamento final**: em Remessas, a instituição importa o TXT do processamento final junto com o PDF que contém os CPFs dos alunos (os dois são obrigatórios). Os arquivos ficam arquivados para download e não alteram a situação dos alunos.
- **Suporte e identidade visual**: em Configurações, o administrador troca a logo, define o texto da opção **Suporte** e o número do **WhatsApp**, que aparece como botão logo abaixo do Suporte.
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
| 18 | Nome da mãe com nome e sobrenome (regra do SIS SMPE, não existe no validador oficial) |

Também são rejeitados arquivos que não estão em UTF-8 e arquivos com linhas em branco.

Na Migração, o aluno que seria rejeitado recebe a pendência **Crítica SMTT**, com o código da regra, e não entra na remessa.

Ressalvas:
- A regra 13 é uma aproximação. O validador não expõe o critério em texto, então o sistema trata como inválido o nome do pai que tiver dígitos ou símbolos.
- O BOM do UTF-8 pode ser desligado com a configuração `remessa_bom=0`.

Na importação, o sistema corrige automaticamente os nomes com acentuação corrompida na origem (por exemplo, "ANTÃ”NIO" vira "ANTÔNIO").

## Dados

O banco fica em `data/smpe.db` (SQLite). Quando a variável `DATABASE_URL` está definida (no Render, por exemplo), o sistema usa esse Postgres no lugar do SQLite. As bases têm dados pessoais de estudantes menores de idade. O acesso exige login (perfis administrador e instituição).
