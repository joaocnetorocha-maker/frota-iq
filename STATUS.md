# FrotaIQ — Status do Projeto

> **Como usar este arquivo:** No início de cada sessão com Claude, peça pra ele ler `STATUS.md`. No fim da sessão, peça pra atualizar este arquivo com o que mudou. Assim nada se perde entre sessões.

**Última atualização:** 27/04/2026

---

## Visão geral

- **Nome:** FrotaIQ
- **Tese:** transformar dados de rastreamento em economia, controle e decisões simples para operações de transporte
- **MVP rodando em:** https://frota-iq.vercel.app
- **Repo:** https://github.com/joaocnetorocha-maker/frota-iq
- **Stack:** React + Vite (frontend) / Node.js (scripts backend)
- **Frota real:** 13 motoristas/veículos cadastrados

---

## O que já está pronto

- Frontend rodando em produção (Vercel) com 3 telas: **Painel**, **Relatório**, **Configurações**
- 13 motoristas reais cadastrados no sistema
- **Modo Beta** implementado em `src/dadosBeta.js` — gera dados simulados realistas pra mostrar o protótipo a potenciais clientes enquanto a API ONIXSAT não vem. Toggle escondido via URL: `?beta=on` ativa, `?beta=off` desativa. Banner amarelo "MODO DEMONSTRAÇÃO" aparece no topo quando ativo. Quando ONIXSAT liberar, criar `dadosReais.js` com a mesma forma e trocar o import no `App.jsx`.
- Data/hora dinâmica no header (antes estava hardcoded "23 abr 2025")
- Script `resumo-diario.cjs` com:
  - Lógica de resumo diário (marcha lenta, perda em R$, ranking de veículos, projeção mensal)
  - HTML do email já desenhado e estilizado
  - Cron schedule pra disparar todo dia às 7h (timezone São Paulo)
  - Integração com nodemailer (Gmail SMTP) — **não funcionando, ver Bloqueios**
- Script `teste-onix.cjs` com:
  - Estrutura básica pra integração com webservice ONIXSAT
  - URL: `webservice.newrastreamentoonline.com.br`
  - Formato: SOAP/XML via POST
  - Resposta tratada com gzip/zlib
  - Logs detalhados e timeout de 15s

---

## Bloqueios atuais

### 1. Email diário não envia (erro Gmail 535)

- nodemailer com Gmail retorna `535-5.7.8 Username and Password not accepted`
- 2FA já está ativada na conta `joaocnetorocha@gmail.com`
- Senha de app gerada (`olvr vppg taxl xiey`) está sendo rejeitada — provável que tenha sido revogada
- **Decisão:** migrar para **Resend** (resend.com) em vez de insistir no Gmail
- **Próximo passo:** João criar conta no Resend, gerar API key, Claude ajusta o script

### 2. Integração ONIXSAT bloqueada — esperando Trucks liberar Webservice/API

- Trucks enviou credenciais que funcionam no portal (`joaocarlos` / `jcnr.15`)
- API do webservice rejeita as mesmas credenciais com erro: *"Atributos para leitura de requisição inválidos. (Atributos, login e/ou senha incorretos.)"*
- Verificado com João dentro do portal: **não existe permissão de Webservice/API editável pelo cliente**, nem no usuário, nem no perfil "adm", nem em privilégios
- Diego (atendimento Trucks via WhatsApp) pediu pra mandar email pra `celulasp@truckscontrol.com.br` com documentação técnica do que precisamos.

**🎯 DESCOBERTA CHAVE (27/04/2026):** Trucks mandou link da documentação oficial (https://suporte.truckscontrol.com.br/integracao/) e baixei o PDF (HelpIntegracao6.7.pdf, 216 páginas). Lendo o manual:

- **Erro código 1** está literalmente documentado e significa: *"Atributos, login e/ou senha incorretos"*. Confirma que a estrutura do XML está correta — o que falta são as credenciais.
- **O `<login>` esperado é NUMÉRICO** (CPF ou CNPJ). Os exemplos do manual usam `12345678910`. O usuário `joaocarlos` é login do portal, **não** do Webservice — são canais com credenciais separadas.
- **Resposta vem em ZIP por padrão** (não gzip). A gente só tratava gzip — `teste-onix.cjs` agora detecta os dois formatos pelos magic numbers.
- **Content-Type correto é `text/xml`** (a gente tinha `application/xml`). Já corrigido.
- **Endpoint correto:** `https://webservice.newrastreamentoonline.com.br` ✓
- **Espelhamento é o mecanismo certo:** os veículos precisam estar "espelhados pra conta de integração" pra aparecer nas requisições.

**Email atualizado pra Trucks** (em `email-trucks-webservice.md`) agora pede especificamente: login numérico (CPF/CNPJ), senha do Webservice (separada do portal), confirmação do espelhamento, formato de compressão.

- **Próximo passo:** João envia o email atualizado pra `celulasp@truckscontrol.com.br` e aguarda credenciais corretas. Quando chegarem: trocar as constantes `LOGIN` e `SENHA` em `teste-onix.cjs` e rodar `node teste-onix.cjs`.
- Mensagem oficial inicial enviada para Trucks em 24/04/2026; email atualizado em 27/04/2026.

---

## Credenciais e endpoints (referência)

> ⚠️ Senhas reais ficam no código local — aqui só o que é seguro registrar.

- **Gmail (envio email):** `joaocnetorocha@gmail.com` (com senha de app — atualmente quebrada)
- **ONIXSAT portal:** usuário `joaocarlos` / senha de portal — funciona
- **ONIXSAT webservice URL:** `https://webservice.newrastreamentoonline.com.br` (responde, mas rejeita auth — credencial do Webservice é diferente da do portal)
- **ONIXSAT webservice login:** ❌ ainda não temos — precisa ser NUMÉRICO (CPF/CNPJ) — aguardando Trucks enviar
- **ONIXSAT webservice senha:** ❌ ainda não temos — separada da senha do portal — aguardando Trucks enviar
- **Email recovery ONIXSAT:** `joaocarlosnetorocha@gmail.com`
- **Documentação oficial:** https://suporte.truckscontrol.com.br/integracao/ (PDF salvo localmente: `HelpIntegracao6.7.pdf` no upload do projeto)

---

## Decisões tomadas

- **Foco do MVP:** marcha lenta + tempo parado (dor mais clara, mais fácil de quantificar em R$)
- **Cobrança futura:** mensalidade fixa ou por veículo (definir depois de validar com primeiros pilotos)
- **Email transacional:** migrar pra Resend (decisão tomada em 24/04/2026)
- **Não vamos perder tempo com gambiarra de scraping do portal** enquanto API oficial não está liberada — usar dados simulados até lá

---

## Próximos passos imediatos (ordem de prioridade)

1. **[Em andamento]** Migrar envio de email pro Resend
2. **[Esperando resposta]** Trucks liberar API ONIXSAT + enviar credenciais e docs
3. Quando ONIXSAT liberar: integrar API e substituir dados simulados em `resumo-diario.cjs` por dados reais
4. Continuar refinando UI das 3 telas conforme feedback
5. Definir primeiros clientes pra rodar piloto (estratégia de validação da Bíblia)

---

## Arquivos chave do projeto

- `resumo-diario.cjs` — script do email diário (raiz)
- `teste-onix.cjs` — teste de conexão com API ONIXSAT (raiz)
- `src/App.jsx` — app React principal
- `src/App.css` — estilos
- `src/dadosBeta.js` — fonte de dados simulada (modo demonstração) — substituir por `dadosReais.js` quando a API ONIXSAT estiver liberada
- `email-trucks-webservice.md` — rascunho do email formal de pedido de liberação de Webservice pra `celulasp@truckscontrol.com.br`
- `STATUS.md` — este arquivo (manter atualizado!)
