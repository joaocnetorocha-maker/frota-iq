# VEBRAX

> Controle de gastos invisíveis da operação.
>
> **O que você não vê, você paga.**

VEBRAX identifica e elimina os custos que passam despercebidos no dia a dia da frota — marcha lenta, desvios de rota, excessos de velocidade, paradas atípicas. Cada minuto parado com motor ligado vira número, vira gráfico, vira ação.

## Stack

- React 19 + Vite
- Supabase (auth + dados agregados)
- Vercel (hosting + cron)
- ONIXSAT Webservice (telemetria de frota)

## Rodando local

```bash
npm install
npm run dev
```

## Deploy

Push pra `main` faz deploy automático na Vercel.

## Documentação

- `STATUS.md` — situação atual do projeto
- `SETUP-PRODUCAO.md` — guia de produção (Supabase + Vercel + cron)
- `email-trucks-webservice.md` — comunicação técnica com a ONIXSAT
