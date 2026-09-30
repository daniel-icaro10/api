# SIS SMPE (web)

Versão web da planilha **SIS SMPE 2026.4.xlsm**. O sistema faz a migração de estudantes da rede municipal para o cadastro da SMTT: cruza o CPF das bases GEDUC, Censo, SMTT e Alunos por status, aponta as pendências de cada instituição, gera a remessa em layout fixo e calcula o orçamento.

## Como usar

1. Dê dois cliques em `abrir.bat`. Ele instala as dependências que faltarem e abre o sistema em http://127.0.0.1:8010.
2. No primeiro acesso, informe o e-mail e crie a senha do **administrador**.
3. Em **Bases e importação**, envie a planilha `.xlsm` completa ou cada base separada (`.xlsx`, `.xls` ou `.csv`). O cabeçalho pode estar em qualquer uma das primeiras 50 linhas e em qualquer aba do arquivo.
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
- **Recuperação de acesso**: defina `SMPE_RESET_LOGIN` (e-mail) e `SMPE_RESET_SENHA` (nova senha, mínimo 6 caracteres) e reinicie o sistema. Ele cria esse administrador ou redefine a senha dele, se já existir. Depois de entrar, apague as duas variáveis, porque enquanto elas existirem a senha volta a ser redefinida a cada reinício.
- O usuário é o **e-mail** (maiúsculas e minúsculas não fazem diferença). Todo usuário novo, inclusive o primeiro administrador, precisa ter um e-mail válido. Logins antigos (CPF ou outro formato) continuam funcionando até o administrador trocá-los pelo e-mail em **Usuários**.
- A sessão termina quando o navegador é fechado e dura no máximo 12 horas. As senhas são guardadas com hash PBKDF2.

**Publicar numa VPS com cPanel/WHM (Hostinger)**: veja [deploy/LEIA-ME-VPS.md](deploy/LEIA-ME-VPS.md). O sistema roda como serviço (`deploy/smpe.service`), o Apache do cPanel encaminha o domínio para ele e os dados do Render são copiados com `python -m smpe migrar "URL-do-Postgres-de-origem"`.

Para importar pela linha de comando: `python -m smpe importar "C:\...\SIS SMPE 2026.4.xlsm"`

## Equivalência planilha → sistema

| Planilha | Sistema |
|---|---|
| MENU / botão "Localizar Estudante" | Painel + busca no topo, por nome ou CPF (a instituição busca só nos próprios alunos) |
| CAD_ESCOLA | Instituições: cadastro em abas. **Dados cadastrais** (código SMTT, INEP, CNPJ, e-mail, curso padrão, vínculo GEDUC), **Representantes** (um ou mais: nome, CPF, cargo, contato e e-mail) e **Cursos** (um ou mais: curso, grau, séries e turnos). Também tem acesso e bloqueio |
| ESCOLA (filtro avançado + colunas AG:AO) | Matriculado: cruzamento GEDUC × Censo × SMTT × Status e CPF consolidado |
| Botões CPF divergente / com CPF / sem CPF / duplicado / mãe não informada | Abas de filtro do Matriculado |
| REL_SEM_CPF / REL_SEM_MAE / REL_SIMPLIFICADA | Relatórios para imprimir (o simplificado mostra o CPF mascarado) |
| ALUNO + ENTRADA + NUM.CARACT | Remessa SMTT: arquivo `INST_<cód>_REM_<nº>.txt` em UTF-8 com BOM, 21 campos, 375 colunas |
| Relação simplificada de estudantes (relatório oficial da SMTT) | Remessas → **Baixar PDF**: nome, CPF, nascimento e mãe de cada aluno da remessa, no layout oficial, com a logo do sistema e o código de verificação (SHA-1 do TXT) no rodapé |
| AlunoCriticaUtf8.exe (validador oficial SMPE) | Criticar remessa: mesmas críticas de 0 a 17 e regras A a C, com relatório `CRITICA_*.txt`, mais a crítica 18 (mãe com nome e sobrenome) |
| ORÇAMENTO | Orçamento (só administrador): matriculados com CPF × valor unitário por aluno + peticionamento − desconto |
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
- Histórico de remessas. Cada aluno enviado fica marcado como migrado, e o orçamento mostra os migrados e o índice de migração.
- **Mãe sem sobrenome**: o nome da mãe precisa ter nome e sobrenome (partículas como DA, DE e DOS não contam). O aluno sem isso não fica apto e, no arquivo, recebe a crítica 18.
- **Correção e reprocessamento**: a instituição corrige qualquer campo do aluno (nome, CPF, mãe, pai, sexo, nascimento, série, turno, turma, matrícula, endereço, CEP, telefone e documentos). Os campos já vêm preenchidos com a informação atual, e a instituição só edita o que está errado (por exemplo, apaga os caracteres que sobram no endereço). Só os campos alterados viram correção. Os campos com limite no layout da remessa mostram um contador de caracteres, que fica vermelho quando o texto passa do tamanho e seria cortado. Os campos com problema aparecem destacados, e o aluno é reprocessado ao salvar.
- **Cadastro individual**: a instituição cadastra, edita e exclui alunos que não estão no GEDUC (botão **Cadastrar aluno** no Matriculado). O formulário tem **Tipo de ensino** (campo CURSO da remessa) e **Grau** (1, 2 ou 3). As opções de Tipo de ensino são os cursos cadastrados na instituição, e o grau acompanha o do curso escolhido. Sem cursos cadastrados, a lista usa Ensino Fundamental, Ensino Médio, Educação Infantil e EJA. Esses alunos passam pelas mesmas regras e entram na remessa normalmente.
- **Telefone**: vem da correção, do GEDUC (coluna `TELEFONE`), da base Alunos por status ou do SMTT, nessa ordem. O sistema usa o primeiro número válido do campo e completa o DDD 98 quando falta.
- **CEP**: vem do GEDUC (coluna `CEP` ou `CEP_ALUNO`), a menos que a instituição corrija. Sem CEP, a remessa usa 65000000.
- **Orçamento só com CPF**: o valor é a quantidade de matriculados com CPF consolidado (ou o número informado no orçamento) × o valor unitário por aluno, mais o peticionamento e menos o desconto.
- **Arquivo do processamento final**: em Remessas, a instituição importa o TXT do processamento final junto com o PDF que contém os CPFs dos alunos (os dois são obrigatórios). Os arquivos ficam arquivados para download e não alteram a situação dos alunos.
- **Suporte e identidade visual**: em Configurações, o administrador troca a logo, define o texto da opção **Suporte** e o número do **WhatsApp**, que aparece como botão logo abaixo do Suporte.
- **Fichas da SMTT**: em **Instituições → Fichas** (e em **Relatórios → Fichas SMTT**, para a instituição) o sistema gera em PDF, no layout oficial da Central de Atendimento ao Estudante, a **Ficha de cadastro da instituição de ensino**, a **Relação de cursos da instituição** (36 cursos por página) e a **Ficha de cadastro do representante** (uma página por representante). Os dados vêm do cadastro da instituição: endereço, telefone e rede de ensino (Dados cadastrais), documentos, salas e informações complementares (Estrutura e documentos: informa-se a quantidade de **salas** por tipo de ensino e turno; o Nº de salas é a soma dos turnos e a linha "Salas de aula" é calculada a partir desse quadro), cursos com tipo de ensino e modalidade (Cursos) e representantes com RG, endereço, turnos de responsabilidade e quem assina como diretor(a) e adjunto(a) (Representantes). A janela de fichas mostra o que falta preencher em cada uma. Os modelos ficam em `smpe/modelos`.
- **Tabelas e downloads padronizados**: todas as tabelas têm o mesmo visual (cabeçalho fixo, linhas zebradas, datas DD/MM/AAAA e CPF formatado) e o botão **Baixar Excel**, que baixa a lista inteira (todas as páginas, com os filtros aplicados) em `.xlsx` no mesmo layout: título, filtro, data e usuário que gerou, cabeçalho azul, linhas zebradas, filtros, cabeçalho congelado, total de registros e impressão ajustada à largura. Os downloads de TXT e PDF usam o mesmo botão verde.
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
- A remessa é gravada em UTF-8 **sem BOM**: o validador oficial conta o BOM como caractere e reprova a primeira linha (376 colunas).
- Só entram na remessa os alunos com situação **Cursando** no Alunos por status. Quem tem outra situação (transferido, desistente etc.) recebe a pendência **Não cursando**. O aluno sem situação conhecida não é bloqueado.

Na importação, o sistema corrige automaticamente os nomes com acentuação corrompida na origem (por exemplo, "ANTÃ”NIO" vira "ANTÔNIO").

## Dados

O banco fica em `data/smpe.db` (SQLite). Quando a variável `DATABASE_URL` está definida (no Render, por exemplo), o sistema usa esse Postgres no lugar do SQLite. As bases têm dados pessoais de estudantes menores de idade. O acesso exige login (perfis administrador e instituição).
