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

// =========================================================================
// Diário do veículo — mesmo algoritmo do /api/dados (versão limpa)
// Eventos: ignição liga/desliga · excesso vel · parada >= 10 min sem
//          NENHUM movimento · frenagem · aceleração brusca
// =========================================================================
const PARADA_MIN_MIN = 10
const MAX_EVENTOS_DIARIO = 25

function fmtHora(dt) {
  return new Date(dt).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}
function fmtLocal(m) {
  return m && m.mun ? `${m.mun}/${m.uf}` : '—'
}

function montarDiario(msgs) {
  if (!msgs || msgs.length === 0) {
    return [{ h: '—', cor: '#888', ev: 'Sem mensagens nesse dia', det: '' }]
  }
  const ord = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))
  const eventos = []
  let ignAnt = null
  let excEm  = null   // { dt, velMax, mun, uf }
  let parEm  = null   // { dtIni, dtFim, mun, uf, ign }

  for (let i = 0; i < ord.length; i++) {
    const m = ord[i]
    const vel = Number(m.vel) || 0
    const semMov = vel < 1   // PARADA REAL: filtra trânsito

    if (ignAnt !== null && ignAnt !== m.evt4) {
      if (m.evt4 === 1) eventos.push({ h: fmtHora(m.dt), cor: '#1D9E75', ev: 'Ignição ligada', det: fmtLocal(m) })
      else if (ignAnt === 1) eventos.push({ h: fmtHora(m.dt), cor: '#666', ev: 'Ignição desligada', det: fmtLocal(m) })
    }
    ignAnt = m.evt4

    const emExc = m.evt34 || vel > LIMITE_VEL
    if (emExc) {
      if (!excEm) excEm = { dt: m.dt, velMax: vel || LIMITE_VEL, mun: m.mun, uf: m.uf }
      else if (vel > excEm.velMax) { excEm.velMax = vel; excEm.mun = m.mun; excEm.uf = m.uf }
    } else if (excEm) {
      eventos.push({
        h: fmtHora(excEm.dt), cor: '#E55B3C',
        ev: 'Excesso de velocidade',
        det: `Pico ${Math.round(excEm.velMax)} km/h${excEm.mun ? ` · ${excEm.mun}/${excEm.uf}` : ''}`,
      })
      excEm = null
    }

    if (semMov) {
      if (!parEm) parEm = { dtIni: m.dt, dtFim: m.dt, mun: m.mun, uf: m.uf, ign: m.evt4 === 1 }
      else parEm.dtFim = m.dt
    } else if (parEm) {
      const dur = (new Date(parEm.dtFim) - new Date(parEm.dtIni)) / 60000
      if (dur >= PARADA_MIN_MIN) {
        eventos.push({
          h: fmtHora(parEm.dtIni),
          cor: parEm.ign ? '#D9A21B' : '#666',
          ev: `Parado ${Math.round(dur)} min`,
          det: `${parEm.ign ? 'motor ligado' : 'motor desligado'}${parEm.mun ? ` · ${parEm.mun}/${parEm.uf}` : ''}`,
        })
      }
      parEm = null
    }

    if (m.evt16) eventos.push({ h: fmtHora(m.dt), cor: '#E55B3C', ev: 'Frenagem brusca', det: fmtLocal(m) })
    if (m.evt17) eventos.push({ h: fmtHora(m.dt), cor: '#E55B3C', ev: 'Aceleração brusca', det: fmtLocal(m) })
  }

  if (excEm) {
    eventos.push({
      h: fmtHora(excEm.dt), cor: '#E55B3C',
      ev: 'Excesso de velocidade',
      det: `Pico ${Math.round(excEm.velMax)} km/h${excEm.mun ? ` · ${excEm.mun}/${excEm.uf}` : ''}`,
    })
  }
  if (parEm) {
    const dur = (new Date(parEm.dtFim) - new Date(parEm.dtIni)) / 60000
    if (dur >= PARADA_MIN_MIN) {
      eventos.push({
        h: fmtHora(parEm.dtIni),
        cor: parEm.ign ? '#D9A21B' : '#666',
        ev: `Parado ${Math.round(dur)} min`,
        det: `${parEm.ign ? 'motor ligado' : 'motor desligado'}${parEm.mun ? ` · ${parEm.mun}/${parEm.uf}` : ''}`,
      })
    }
  }

  if (eventos.length === 0) {
    return [{ h: '—', cor: '#888', ev: 'Sem ocorrências relevantes nesse dia', det: '' }]
  }
  if (eventos.length > MAX_EVENTOS_DIARIO) return eventos.slice(eventos.length - MAX_EVENTOS_DIARIO)
  return eventos
}

// =========================================================================
// Detecção de VIAGENS — mesmo algoritmo do /api/dados
// =========================================================================
const RAIO_RETORNO_KM     = 1.0
const PARADA_LONGA_MIN    = 240
const DESTINO_ESTAVEL_MIN = 60
const VIAGEM_MIN_KM       = 3
const VIAGEM_MIN_DUR_MIN  = 5
const PARADA_REGISTRO_MIN = 10

function haversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lat2 || !lon1 || !lon2) return null
  const toRad = x => (x * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function novaViagemEstado(m) {
  return {
    inicioMsg: m, fimMsg: m,
    velMax: m.vel || 0, velSoma: m.vel || 0, velContagem: m.vel ? 1 : 0,
    excessoAberto: null, excessos: [],
    paradaAberta: null, paradas: [],
    freadas: 0, aceleracoes: 0,
    emAndamento: false,
  }
}

function resumirViagem(v) {
  if (v.excessoAberto) { v.excessos.push(v.excessoAberto); v.excessoAberto = null }
  const distKm = Math.max(0, (v.fimMsg.odm || 0) - (v.inicioMsg.odm || 0))
  const durMin = Math.round((new Date(v.fimMsg.dt) - new Date(v.inicioMsg.dt)) / 60000)
  return {
    inicio: { hora: fmtHora(v.inicioMsg.dt), local: fmtLocal(v.inicioMsg), lat: v.inicioMsg.lat, lon: v.inicioMsg.lon },
    fim: { hora: fmtHora(v.fimMsg.dt), local: fmtLocal(v.fimMsg), lat: v.fimMsg.lat, lon: v.fimMsg.lon },
    distanciaKm: Math.round(distKm),
    duracaoMin: durMin,
    velMax: Math.round(v.velMax),
    velMedia: v.velContagem > 0 ? Math.round(v.velSoma / v.velContagem) : 0,
    excessos: v.excessos.map(e => ({ hora: fmtHora(e.dt), velPico: Math.round(e.velMax), local: e.mun ? `${e.mun}/${e.uf}` : '—' })),
    paradas: v.paradas.map(p => ({ hora: fmtHora(p.dt), duracaoMin: p.duracaoMin, local: p.mun ? `${p.mun}/${p.uf}` : '—' })),
    freadas: v.freadas, aceleracoes: v.aceleracoes,
    emAndamento: !!v.emAndamento,
  }
}

function detectarViagens(msgs) {
  if (!msgs || msgs.length === 0) return []
  const ord = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))
  const viagens = []
  let v = null

  const fechar = (razao) => {
    if (!v) return
    const r = resumirViagem(v)
    if (r.distanciaKm >= VIAGEM_MIN_KM && r.duracaoMin >= VIAGEM_MIN_DUR_MIN) {
      r.razaoFim = razao
      viagens.push(r)
    }
    v = null
  }

  for (let i = 0; i < ord.length; i++) {
    const m = ord[i]
    const movendo = m.vel && m.vel >= 1

    if (movendo) {
      if (v && v.paradaAberta) {
        const dur = (new Date(m.dt) - new Date(v.paradaAberta.dt)) / 60000
        if (dur >= PARADA_REGISTRO_MIN) {
          v.paradas.push({ dt: v.paradaAberta.dt, duracaoMin: Math.round(dur), mun: v.paradaAberta.mun, uf: v.paradaAberta.uf })
        }
        v.paradaAberta = null
      }
      if (!v) v = novaViagemEstado(m)
      v.fimMsg = m
      if (m.vel > v.velMax) v.velMax = m.vel
      v.velSoma += m.vel; v.velContagem++
    } else if (v) {
      v.fimMsg = m
      if (!v.paradaAberta) {
        v.paradaAberta = { dt: m.dt, lat: m.lat, lon: m.lon, mun: m.mun, uf: m.uf, msgInicio: m }
      }
      const dur = (new Date(m.dt) - new Date(v.paradaAberta.dt)) / 60000
      if (dur >= PARADA_LONGA_MIN) {
        const distOdm = (m.odm || 0) - (v.inicioMsg.odm || 0)
        const distInicio = haversineKm(m.lat, m.lon, v.inicioMsg.lat, v.inicioMsg.lon)
        const voltouInicio = distInicio !== null && distInicio < RAIO_RETORNO_KM
        const naoSaiuQuase = distOdm < VIAGEM_MIN_KM
        const ficouNoDestino = dur >= DESTINO_ESTAVEL_MIN
        if (voltouInicio || naoSaiuQuase || ficouNoDestino) {
          v.fimMsg = v.paradaAberta.msgInicio
          v.paradaAberta = null
          fechar(voltouInicio ? 'voltou_origem' : naoSaiuQuase ? 'nao_saiu' : 'destino')
        }
      }
    }

    if (v) {
      const emExc = m.evt34 || (m.vel && m.vel > LIMITE_VEL)
      if (emExc) {
        if (!v.excessoAberto) v.excessoAberto = { dt: m.dt, velMax: m.vel || LIMITE_VEL, mun: m.mun, uf: m.uf }
        else if (m.vel && m.vel > v.excessoAberto.velMax) v.excessoAberto.velMax = m.vel
      } else if (v.excessoAberto) {
        v.excessos.push(v.excessoAberto); v.excessoAberto = null
      }
      if (m.evt16) v.freadas++
      if (m.evt17) v.aceleracoes++
    }
  }
  if (v) { v.emAndamento = true; fechar('em_andamento') }
  return viagens
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
        .select('vei_id, dt, lat, lon, mun, uf, vel, evt4, evt34, evt16, evt17, evt54, odm')
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
          diario: [{ h: '—', cor: '#888', ev: 'Sem mensagens nesse dia', det: '' }],
          viagens: [],
        }
      }

      const score = calcularScore(ag.paradoMin, ag.excessoVelMin)
      const { status, statusTxt } = statusDoScore(score)
      const perda = Math.round((ag.paradoMin / 60) * CONSUMO_PARADO * PRECO_DIESEL * 100) / 100
      const diario = montarDiario(minhasMsgs)
      const viagens = detectarViagens(minhasMsgs)

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
        diario,
        viagens,
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
