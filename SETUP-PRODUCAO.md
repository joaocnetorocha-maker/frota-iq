# FrotaIQ — Setup de Produção (Tempo Real)

Esse guia te leva do FrotaIQ-com-dados-simulados pro FrotaIQ-com-dados-reais
da ONIXSAT, em **tempo real, 24/7, custo R$ 0**.

Arquitetura final:
```
ONIXSAT (webservice)
       ↑ poll a cada 1-2 min
[Vercel /api/coletar]  ←──── chamado por cron-job.org (gatilho grátis)
       ↓ insert
[Supabase]  (banco PostgreSQL grátis)
       ↑ select
[Vercel /api/dados]  ←──── chamado pelo frontend a cada 30s
       ↓ JSON
[FrotaIQ React]  (UI atual)
```

---

## Etapa 1 — Criar conta no Supabase (5 min)

1. Acesse https://supabase.com → "Start your project" → cria conta com GitHub.
2. Clique em **New project**:
   - Name: `frota-iq`
   - Database password: **gere uma senha forte e GUARDA num lugar seguro**
   - Region: **South America (São Paulo)** — mais perto, mais rápido
   - Plano: **Free**
3. Aguarda ~2 min até o projeto subir.
4. Vai em **SQL Editor** (ícone de banco de dados na barra esquerda) → **New query**.
5. Abre o arquivo `supabase-schema.sql` (raiz do projeto), copia TUDO, cola no editor e clica em **RUN** (canto direito embaixo). Deve aparecer "Success".
6. Vai em **Project Settings** (engrenagem) → **API**. Copia esses dois valores:
   - **Project URL** (algo tipo `https://xxxx.supabase.co`)
   - **service_role key** (sob o título "Project API keys" → "Reveal" e copia a service_role, NÃO a anon)
   - **Atenção:** a `service_role` é admin total. Trate como senha.

---

## Etapa 2 — Configurar variáveis na Vercel (3 min)

1. Acesse https://vercel.com → entra no projeto **frota-iq**.
2. Vai em **Settings** → **Environment Variables**.
3. Adiciona uma por uma, em **All Environments** (Production, Preview, Development):

   | Nome                  | Valor                                           |
   |-----------------------|-------------------------------------------------|
   | `ONIX_LOGIN`          | `12978611000198`                                |
   | `ONIX_SENHA`          | `112498`                                        |
   | `SUPABASE_URL`        | (cole aqui o Project URL do passo 1.6)          |
   | `SUPABASE_SERVICE_KEY`| (cole aqui a service_role key do passo 1.6)     |
   | `CRON_SECRET`         | uma senha aleatória grande (ver dica abaixo)    |

   **Pra gerar o `CRON_SECRET`** rode no terminal do Mac:
   ```
   openssl rand -hex 32
   ```
   Vai sair algo tipo `a3f5d8...64 caracteres`. Esse é o seu CRON_SECRET. Copia e guarda.

4. **Save**. Não precisa redesployar agora — o próximo `git push` vai trazer o código novo já com as envs aplicadas.

---

## Etapa 3 — Push do código pra Vercel (2 min)

No terminal do Mac, dentro de `/Users/joaoprado/Documents/FROTA IQ`:

```
npm install
git add api supabase-schema.sql vercel.json src/dadosReais.js .gitignore .env.example package.json package-lock.json SETUP-PRODUCAO.md
git -c user.email="joaocnetorocha@gmail.com" -c user.name="Joao Rocha" commit -m "feat: integração ONIXSAT em tempo real (Supabase + cron)"
git push origin main
```

A Vercel vai fazer build automático. Aguarda ~1 min.

---

## Etapa 4 — Sincronizar veículos (1 chamada manual)

Depois que a Vercel terminar o deploy, roda **uma vez** essa chamada pra povoar
a tabela `veiculos` com os 16 caminhões da ONIX:

```
curl -X POST https://frota-iq.vercel.app/api/sincronizar-veiculos \
  -H "Authorization: Bearer SEU_CRON_SECRET_AQUI"
```

Substitui `SEU_CRON_SECRET_AQUI` pelo valor que você gerou na etapa 2.

Resposta esperada:
```json
{ "ok": true, "sincronizados": 16, "placas": ["DVT5637", "DVT6098", ...] }
```

---

## Etapa 5 — Configurar cron-job.org (5 min)

1. Acesse https://cron-job.org → "Sign up free".
2. Confirma email.
3. **Cronjobs** → **Create cronjob**.

   **Job 1 — Coletor (mensagens em tempo real):**
   - Title: `FrotaIQ - Coletar mensagens ONIX`
   - URL: `https://frota-iq.vercel.app/api/coletar`
   - Schedule: **Every 2 minutes** (Custom → */2 * * * *)
   - Em **Advanced** → **Request method**: POST
   - Em **Advanced** → **Request headers**, adiciona:
     - Header name: `Authorization`
     - Header value: `Bearer SEU_CRON_SECRET_AQUI`
   - Save.

   **Job 2 — Sincronizar veículos (1x por dia):**
   - Title: `FrotaIQ - Sincronizar cadastro de veículos`
   - URL: `https://frota-iq.vercel.app/api/sincronizar-veiculos`
   - Schedule: **Every day at 06:00**
   - Method: POST + mesmo header `Authorization`
   - Save.

4. Volta no dashboard do cron-job.org. O Job 1 vai começar a rodar em até 2 min.
   Em "Last execution" deve aparecer **200 OK**.

---

## Etapa 6 — Validar que tá funcionando

**No Supabase**, vai em **Table Editor**:
- Tabela `veiculos`: 16 linhas com placas e motoristas.
- Tabela `coleta_estado`: linha 1 com `ultima_coleta_em` recente e `ultima_coleta_status = ok`.
- Tabela `mensagens_cb`: começa a encher rápido (centenas de mensagens em poucos minutos).

**No FrotaIQ** (https://frota-iq.vercel.app/api/dados):
- Deve retornar JSON com `ok: true` e o array `frota` populado.

---

## Etapa 7 — Trocar o frontend pra usar dados reais

Depois que `/api/dados` tiver respondendo certinho com os 16 caminhões, é trocar
o import no `src/App.jsx`:

```js
// ANTES
import { getVeiculosBeta, getResumoSemanaBeta, isBetaAtivo } from './dadosBeta'

// DEPOIS (passa a usar dados reais)
import { getVeiculosReais as getVeiculos, getResumoSemanaReais as getResumoSemana } from './dadosReais'
```

E adaptar o uso pra `await` (o `dadosReais.js` é assíncrono — precisa `useEffect`
+ `useState` em vez de chamar direto no render). Esse passo a gente faz junto
quando os dados estiverem chegando.

---

## Resolução de problemas

**`/api/coletar` retorna 401:** o header `Authorization` tá errado ou o
`CRON_SECRET` na Vercel diferente do configurado no cron-job.org.

**`/api/coletar` retorna 500 com "ONIX HTTP ...":** credenciais ONIX_LOGIN/SENHA
erradas ou IP da Vercel sendo bloqueado pela Trucks (raro, mas possível). Se
acontecer, abrir ticket pro suporte da Trucks pedindo liberação.

**`mensagens_cb` cresce demais:** depois de 30 dias dá uns ~6 milhões de linhas.
O plano grátis do Supabase aguenta 500 MB. Quando chegar perto, criar um job
que apaga mensagens com mais de 60 dias.

---

## Custos (resumo)

| Serviço          | Plano            | Custo/mês |
|------------------|------------------|-----------|
| Vercel           | Hobby (grátis)   | R$ 0      |
| Supabase         | Free             | R$ 0      |
| cron-job.org     | Free             | R$ 0      |
| **TOTAL**        |                  | **R$ 0**  |

Quando a transportadora crescer e o uso passar dos limites grátis, migrar
pra Vercel Pro (US$ 20/mês = R$ ~100) e Supabase Pro (US$ 25/mês = R$ ~125).
