// =============================================================================
// /api/fechar-dia.js — Snapshot diário (rodar 23:55 Brasília via cron-job.org)
// =============================================================================
// Lê todas as mensagens do dia, agrega por veículo, salva 1 linha por veículo
// na tabela historico_dia. Permite consultar dias passados sem recalcular.
//
// Uso:
//   POST /api/fechar-dia                  → fecha o dia de HOJE (Brasília)
//   POST /api/fechar-dia?data=2026-04-28  → fecha um dia específico
//
// Auth (mesmo padrão dos outros):
//   Authorization: Bearer <CRON_SECRET>
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const LIMITE_VEL = 90      // km/h
const PRECO_DIESEL = 6.50  // R$/L
const CONSUMO_PARADO = 3.5 // L/h em marcha lenta
const TZ_OFFSET_HOURS = -3 // Brasília

// "YYYY-MM-DD" em Brasília a partir de uma data UTC
function dataBrasilia(d = new Date()) {
  const ms = d.getTime() + TZ_OFFSET_HOURS * 3600_000
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Início e fim (UTC) de um dia local de Brasília
function intervaloDoDia(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number)
  // 00:00 BRT = 03:00 UTC
  const inicio = new Date(Date.UTC(y, m - 1, d, -TZ_OFFSET_HOURS, 0, 0, 0))
  const fim    = new Date(Date.UTC(y, m - 1, d + 1, -TZ_OFFSET_HOURS, 0, 0, 0))
  return { inicio: inicio.toISOString(), fim: fim.toISOString() }
}

function agregar(msgs) {
  if (msgs.length === 0) return null
  const ordenado = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))

  let paradoMin = 0, excessoVelMin = 0, velMax = 0
  let odmMin = Infinity, odmMax = -Infinity

  for (let i = 0; i < ordenado.length; i++) {
    const m = ordenado[i]
    const proxima = ordenado[i + 1]
    const deltaMin = proxima
      ? Math.min(5, Math.max(0, (new Date(proxima.dt) - new Date(m.dt)) / 60000))
      : 1

    if (m.evt4 === 1 && (m.vel === null || m.vel < 1)) paradoMin += deltaMin
    if (m.evt34 || (m.vel && m.vel > LIMITE_VEL))      excessoVelMin += deltaMin

    if (m.vel && m.vel > velMax) velMax = m.vel
    if (m.odm && m.odm > 0 && m.odm < odmMin) odmMin = m.odm
    if (m.odm && m.odm > odmMax) odmMax = m.odm
  }

  return {
    paradoMin: Math.round(paradoMin),
    excessoVelMin: Math.round(excessoVelMin),
    velMax: Math.round(velMax),
    kmRodado: (odmMin !== Infinity && odmMax > 0) ? odmMax - odmMin : 0,
    ultima: ordenado[ordenado.length - 1],
  }
}

function calcularScore(p, e) {
  return Math.max(0, Math.min(100, Math.round(95 - p * 0.55 - e * 0.9)))
}

function statusDoScore(score) {
  if (score < 60) return { status: 'vermelho', statusTxt: 'Crítico' }
  if (score < 80) return { status: 'amarelo',  statusTxt: 'Atenção' }
  return                  { status: 'verde',   statusTxt: 'Normal'  }
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'unauthorized' })
  }

  // Determina qual dia fechar
  // - Sem query: dia de HOJE em Brasília (cron roda 23:55 BRT, então fecha o dia que está acabando)
  // - Com ?data=YYYY-MM-DD: aquele dia específico (útil pra reprocessar)
  const dataAlvo = (req.query?.data) || dataBrasilia()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAlvo)) {
    return res.status(400).json({ erro: 'data inválida (use YYYY-MM-DD)' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  try {
    const { inicio, fim } = intervaloDoDia(dataAlvo)

    // Busca veículos
    const { data: veiculos, error: errVei } = await supabase
      .from('veiculos').select('vei_id, placa, motorista')
    if (errVei) throw new Error('erro veiculos: ' + errVei.message)

    // Busca mensagens do dia paginando (Supabase tem cap default de 1000/query)
    let todasMsgs = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data: msgs, error: errMsg } = await supabase
        .from('mensagens_cb')
        .select('vei_id, dt, mun, uf, vel, evt4, evt34, odm')
        .gte('dt', inicio)
        .lt('dt', fim)
        .order('dt', { ascending: true })
        .range(from, from + PAGE - 1)
      if (errMsg) throw new Error('erro msgs: ' + errMsg.message)
      todasMsgs = todasMsgs.concat(msgs || [])
      if (!msgs || msgs.length < PAGE) break
      from += PAGE
    }

    // Agrupa por veiID
    const msgsPorVei = {}
    for (const m of todasMsgs) {
      if (!msgsPorVei[m.vei_id]) msgsPorVei[m.vei_id] = []
      msgsPorVei[m.vei_id].push(m)
    }

    // Monta linhas pro upsert
    const linhas = (veiculos || []).map(v => {
      const minhasMsgs = msgsPorVei[v.vei_id] || []
      const ag = agregar(minhasMsgs)

      if (!ag) {
        // Sem dados nesse dia
        return {
          data: dataAlvo, vei_id: v.vei_id,
          placa: v.placa, motorista: v.motorista,
          parado_min: 0, excesso_vel_min: 0, km_rodado: 0, vel_max: 0,
          perda: 0, score: null, status: 'verde', status_txt: 'Sem dados',
          ignicao_final: false, posicao_final: null,
        }
      }

      const score = calcularScore(ag.paradoMin, ag.excessoVelMin)
      const { status, statusTxt } = statusDoScore(score)
      const perda = Math.round((ag.paradoMin / 60) * CONSUMO_PARADO * PRECO_DIESEL * 100) / 100

      return {
        data: dataAlvo, vei_id: v.vei_id,
        placa: v.placa, motorista: v.motorista,
        parado_min: ag.paradoMin,
        excesso_vel_min: ag.excessoVelMin,
        km_rodado: ag.kmRodado,
        vel_max: ag.velMax,
        perda,
        score, status, status_txt: statusTxt,
        ignicao_final: ag.ultima.evt4 === 1,
        posicao_final: ag.ultima.mun ? `${ag.ultima.mun}/${ag.ultima.uf}` : null,
      }
    })

    const { error: errUp } = await supabase
      .from('historico_dia')
      .upsert(linhas, { onConflict: 'data,vei_id' })
    if (errUp) throw new Error('erro upsert: ' + errUp.message)

    return res.status(200).json({
      ok: true,
      data: dataAlvo,
      veiculos: linhas.length,
      msgs_processadas: todasMsgs.length,
      perda_total: Math.round(linhas.reduce((s, l) => s + Number(l.perda || 0), 0) * 100) / 100,
    })
  } catch (err) {
    console.error('Erro em /api/fechar-dia:', err)
    return res.status(500).json({ erro: err.message })
  }
}
