# Email para Trucks Control — Liberação de credenciais Webservice ONIXSAT

**Para:** celulasp@truckscontrol.com.br
**Assunto:** Solicitação de credenciais do Webservice — Cliente João Carlos Neto Rocha

---

Prezados,

Conforme orientação do Diego (atendimento via WhatsApp) e seguindo a documentação oficial disponível em **https://suporte.truckscontrol.com.br/integracao/**, encaminho por este canal a solicitação formal das credenciais do Webservice ONIXSAT.

## Identificação

- **Cliente:** João Carlos Neto Rocha
- **Email cadastrado:** joaocarlosnetorocha@gmail.com
- **Login do portal:** joaocarlos
- **Plataforma:** ONIXSAT New Enterprise
- **Frota:** 13 veículos cadastrados

## O que solicito

Após estudar a documentação oficial (manual de Integração WebService, versão 6.7), identifiquei que preciso de credenciais específicas para o Webservice, distintas das credenciais do portal. Solicito:

1. **Login do Webservice (numérico)** — conforme exemplo da documentação (`<login>12345678910</login>`), entendo que o login esperado é o CPF ou CNPJ do cliente. Por favor, confirmar e enviar.
2. **Senha do Webservice** — separada da senha de acesso ao portal.
3. **Confirmação do espelhamento** — a documentação indica que as requisições retornam *"informações dos equipamentos espelhados para sua conta"*. Solicito confirmação de que os 13 veículos da minha frota estão espelhados para a conta que receberá as credenciais. Caso ainda não estejam, peço que o espelhamento seja feito.
4. **Formato de compressão** — manter o padrão **ZIP** (conforme item 4 da seção "XML para Requisições" do manual). Se preferirem GZIP, também atendo.

## Requisições que pretendo utilizar

Para fins de implementação, planejo consumir inicialmente:

- `RequestVeiculo` — para listar os veículos da conta e validar conexão
- `RequestMensagemCB` — para receber as mensagens dos veículos (lat/lon, velocidade, eventos de ignição, hodômetro)
- `RequestTelemetria` — caso disponível na conta, para coletar dados de marcha lenta

Endpoint de produção: `https://webservice.newrastreamentoonline.com.br` (HTTPS, conforme exigido desde 04/09/2023).

## Contexto técnico já validado

- O endpoint **responde** corretamente às requisições POST que envio
- O XML segue o formato documentado (`<RequestMensagemCB>` com `<login>`, `<senha>`, `<mId>`)
- Atualmente recebo o **erro código 1**: *"Atributos para leitura de requisição inválidos. (Atributos, login e/ou senha incorretos.)"* — confirmando que a estrutura do XML está aceita pelo servidor; o que falta são as credenciais corretas.

Fico no aguardo do retorno. Qualquer informação adicional sobre minha conta que precisem para liberar a integração, é só pedir.

Atenciosamente,

**João Carlos Neto Rocha**
joaocarlosnetorocha@gmail.com
[seu telefone aqui]
