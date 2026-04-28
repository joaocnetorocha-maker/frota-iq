# Email para Eduardo Munhoz (Trucks Control / TCsat) — Liberação de credenciais Webservice ONIXSAT

**Para:** Eduardo.santos@tcsat.com.br
**Assunto:** Solicitação de credenciais do Webservice ONIXSAT — Cliente João Carlos Neto Rocha

---

Olá Eduardo, tudo bem?

Meu nome é João Carlos Neto Rocha, sou cliente Trucks (login `joaocarlos`, frota de 13 veículos). Seu contato me foi passado pelo Gustavo (atendimento Trucks) como o consultor responsável por liberação de Webservice de integração.

Encaminho a solicitação formal das credenciais do Webservice ONIXSAT, baseada na documentação oficial disponível em **https://suporte.truckscontrol.com.br/integracao/** (manual de Integração WebService, versão 6.7).

## Identificação do cliente

- **Cliente:** João Carlos Neto Rocha
- **Email cadastrado:** joaocarlosnetorocha@gmail.com
- **Login do portal:** joaocarlos
- **Plataforma:** ONIXSAT New Enterprise
- **Frota:** 13 veículos cadastrados

## O que solicito

Após estudar o manual oficial, identifiquei que preciso de credenciais específicas para o Webservice, distintas das credenciais do portal. Especificamente:

1. **Login do Webservice (numérico)** — conforme exemplo da documentação (`<login>12345678910</login>`), entendo que o login esperado é o CPF ou CNPJ do cliente. Por favor, confirmar e enviar.
2. **Senha do Webservice** — separada da senha de acesso ao portal.
3. **Confirmação do espelhamento** — a documentação indica que as requisições retornam *"informações dos equipamentos espelhados para sua conta"*. Peço confirmação de que os 13 veículos da minha frota estão espelhados para a conta que receberá as credenciais. Caso ainda não estejam, peço que o espelhamento seja feito.
4. **Formato de compressão** — manter o padrão **ZIP** (item 4 da seção "XML para Requisições"). Se preferirem GZIP, também atendo.

## Requisições que pretendo utilizar

Para fins de implementação, planejo consumir inicialmente:

- `RequestVeiculo` — para listar os veículos da conta e validar conexão
- `RequestMensagemCB` — para receber as mensagens dos veículos (lat/lon, velocidade, eventos de ignição, hodômetro)
- `RequestTelemetria` — caso disponível na conta, para coletar dados de marcha lenta

**Endpoint de produção:** `https://webservice.newrastreamentoonline.com.br` (HTTPS, conforme exigido desde 04/09/2023).

## Contexto técnico já validado

Já fiz testes preliminares contra o endpoint e confirmo:

- O endpoint **responde** corretamente às requisições POST que envio
- O XML segue o formato documentado (`<RequestVeiculo>` com `<login>`, `<senha>`)
- Atualmente recebo o **erro código 1**: *"Atributos para leitura de requisição inválidos. (Atributos, login e/ou senha incorretos.)"* — confirmando que a estrutura do XML está aceita pelo servidor; o que falta apenas são as credenciais corretas.

Em outras palavras, do meu lado a integração está pronta para funcionar assim que receber as credenciais válidas.

Fico no aguardo do retorno. Qualquer informação adicional que precise sobre minha conta para liberar a integração, é só pedir. Pode me chamar também pelo telefone abaixo se for mais prático.

Atenciosamente,

**João Carlos Neto Rocha**
📧 joaocarlosnetorocha@gmail.com
📱 (11) 99966-6630
