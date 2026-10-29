# Política de segurança

O Axis roda na conta da Cloudflare de cada usuário, então uma
vulnerabilidade pode expor os dados pessoais de alguém. Obrigado por relatar de
forma responsável.

## Versões com suporte

Só a última versão publicada do `create-talorys`, e o agente que ele instala,
recebe correções de segurança. Os usuários atualizam com
`npx create-talorys@latest update`.

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Relate de forma privada pelo GitHub:
**Security → Report a vulnerability** neste repositório
([relato privado de vulnerabilidades](https://docs.github.com/pt/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Inclua, por favor:

- o componente afetado (instalador, Worker do agente, Pages Function, app web)
- os passos para reproduzir ou uma prova de conceito
- o impacto e, se tiver, uma sugestão de correção

Procuramos confirmar o recebimento em até 3 dias úteis e publicar a correção e
o aviso de segurança em até 30 dias, conforme a gravidade. Damos o crédito a
você, a menos que prefira o contrário.

## Escopo

Dentro do escopo, por exemplo:

- contornar a autenticação ou a sessão, CSRF, contornar o limite de tentativas
  de login
- alcançar o Worker do agente, o armazenamento dele ou o binding de IA sem a
  sessão do dono
- segredos ou credenciais vazados para o navegador, logs, `talorys.json` ou
  exportações
- prompt injection que faça o agente executar ações de escrita ou destrutivas
  sem a confirmação do dono, ou escapar das restrições das ferramentas
- o instalador excluir ou sobrescrever dados ou recursos da Cloudflare que não
  são dele
- qualquer coisa que ligue em silêncio recursos pagos da Cloudflare

Fora do escopo:

- vulnerabilidades na plataforma da Cloudflare (relate à
  [Cloudflare](https://hackerone.com/cloudflare))
- ataques que precisem de uma conta da Cloudflare ou de um dispositivo do dono
  já comprometidos
- o próprio dono ultrapassar as cotas do plano gratuito
- falta de proteção adicional sem impacto demonstrado

## Dados pessoais na sua instalação

O seu Axis registra a atividade de acesso (endereço IP, localização
aproximada informada pela Cloudflare, user agent) no seu próprio Durable
Object, para proteger a sua conta. Os detalhes ficam 90 dias por padrão; depois
disso, só contagens diárias por país. Você pode exportá-los ou excluí-los em
**Configurações → Segurança**. Nada é enviado ao projeto nem a terceiros. Veja
[docs/security.md#atividade-de-acesso](docs/security.md#atividade-de-acesso).

O desenho e o modelo de ameaças estão descritos em
[docs/security.md](docs/security.md).
