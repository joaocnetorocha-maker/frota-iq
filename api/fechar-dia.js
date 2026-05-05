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

// =============================================================================
// CONSTANTES — calibração de toda a pipeline anti-falso-positivo
// MANTER ESTE BLOCO IDÊNTICO AO DE /api/dados.js
// =============================================================================
const LIMITE_VEL     = 90     // km/h
const PRECO_DIESEL   = 6.50   // R$/L
const CONSUMO_PARADO = 3.5    // L/h em marcha lenta
const TZ_OFFSET_HOURS = -3    // Brasília

// === Sanity bounds ===
const LAT_MIN = -34, LAT_MAX = 6
const LON_MIN = -74, LON_MAX = -28
const VEL_MAX_FISICA    = 200    // descarta totalmente
const VEL_MAX_PLAUSIVEL = 140    // 140-200: marca como suspeita (não penaliza)
const ODM_MAX_VALIDO = 9_999_999
const KM_MAX_DIA     = 1500
const DEDUP_INTERVALO_MS = 1

// === Marcha lenta (3 testes simultâneos) ===
const ML_DURACAO_MIN  = 5    // min
const ML_RAIO_M       = 50   // m
const ML_DELTA_ODM_KM = 0.1  // km

// === Excesso de velocidade — REGRA CONSERVADORA (AND, não OR) ===
// (≥2 amostras consecutivas) E (≥30s de duração CERTA), OU evt34 da ONIXSAT
const EXC_MIN_AMOSTRAS  = 2
const EXC_DURACAO_MIN_S = 30

// === Detecção de viagem ===
const VIAGEM_MIN_KM        = 5
const VIAGEM_MIN_DUR_MIN   = 15
const RAIO_RETORNO_KM      = 1.0
const PARADA_LONGA_MIN     = 240
const DESTINO_ESTAVEL_MIN  = 60
const PARADA_REGISTRO_MIN  = 10

// =============================================================================
// HELPERS GEOMÉTRICOS / SANITIZAÇÃO
// =============================================================================
function distanciaM(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0
  const R = 6371000
  const toRad = (g) => (g * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function gpsValido(lat, lon) {
  if (lat == null || lon == null) return false
  if (lat === 0 && lon === 0) return false
  if (lat < LAT_MIN || lat > LAT_MAX) return false
  if (lon < LON_MIN || lon > LON_MAX) return false
  return true
}

// Sanitiza msgs ANTES de qualquer agregação:
//  - GPS inválido (null, 0/0, fora do Brasil) → lat/lon = null
//  - Velocidades absurdas (negativo, > 200) → null
//  - Odômetros absurdos (≤0, > 9.999.999) → null
//  - Dedup: msgs com mesmo timestamp (retry) consolidadas
function sanitizarMensagens(msgs) {
  if (!msgs || msgs.length === 0) return []
  const ord = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))
  const out = []
  let ultimoMs = -1
  for (const m of ord) {
    const tMs = new Date(m.dt).getTime()
    if (tMs - ultimoMs < DEDUP_INTERVALO_MS) continue
    const sane = { ...m, velSuspeita: false }
    if (!gpsValido(sane.lat, sane.lon)) { sane.lat = null; sane.lon = null }
    if (sane.vel == null || sane.vel < 0 || sane.vel > VEL_MAX_FISICA) sane.vel = null
    else if (sane.vel > VEL_MAX_PLAUSIVEL) sane.velSuspeita = true   // 140-200: implausível
    if (sane.odm == null || sane.odm <= 0 || sane.odm > ODM_MAX_VALIDO) sane.odm = null
    out.push(sane)
    ultimoMs = tMs
  }
  return out
}

// Blocos contínuos de excesso de velocidade.
// Bloco "válido" se: ≥2 amostras consecutivas, OU ≥30s, OU evt34 confirmado.
function blocosExcesso(msgsOrd) {
  const blocos = []
  let bloco = null
  const fechar = (proxIdx) => {
    if (!bloco) return
    const ini = bloco.msgs[0]
    const fim = bloco.msgs[bloco.msgs.length - 1]
    const proxima = msgsOrd[proxIdx]
    // duracaoCertaS: tempo CONHECIDO acima do limite (só msg[0]→msg[N-1])
    bloco.duracaoCertaS = (new Date(fim.dt) - new Date(ini.dt)) / 1000
    const fimEfetivo = proxima ? new Date(proxima.dt) : new Date(new Date(fim.dt).getTime() + 60_000)
    bloco.duracaoS = (fimEfetivo - new Date(ini.dt)) / 1000
    bloco.duracaoMin = bloco.duracaoS / 60
    bloco.qtdMsgs = bloco.msgs.length
    bloco.temEvt34 = bloco.msgs.some(m => m.evt34)
    bloco.velMax = bloco.msgs.reduce((mx, m) => Math.max(mx, m.vel ?? 0), 0)
    const msgPico = bloco.msgs.reduce((p, m) => ((m.vel ?? 0) > (p?.vel ?? 0) ? m : p), bloco.msgs[0])
    bloco.mun = msgPico.mun
    bloco.uf = msgPico.uf
    bloco.dtPico = msgPico.dt
    // Validação CONSERVADORA (AND, não OR):
    // ≥2 amostras consecutivas E ≥30s de duração certa, OU evt34 confirmado
    bloco.valido =
      (bloco.qtdMsgs >= EXC_MIN_AMOSTRAS && bloco.duracaoCertaS >= EXC_DURACAO_MIN_S) ||
      bloco.temEvt34
    blocos.push(bloco)
    bloco = null
  }
  for (let i = 0; i < msgsOrd.length; i++) {
    const m = msgsOrd[i]
    // Suspeitas (vel > 140) NÃO entram em bloco — só evt34 valida nesses casos
    const velAcima = m.vel != null && m.vel > LIMITE_VEL && !m.velSuspeita
    const acima = velAcima || m.evt34 === 1
    if (acima) {
      if (!bloco) bloco = { msgs: [] }
      bloco.msgs.push(m)
    } else if (bloco) {
      fechar(i)
    }
  }
  if (bloco) fechar(msgsOrd.length)
  return blocos
}

function blocosMarchaLenta(msgsOrd) {
  const blocos = []
  let bloco = null
  const fechar = (proxIdx) => {
    if (!bloco) return
    const ini = bloco.msgs[0]
    const fim = bloco.msgs[bloco.msgs.length - 1]
    const proxima = msgsOrd[proxIdx]
    const fimEfetivo = proxima ? new Date(proxima.dt) : new Date(new Date(fim.dt).getTime() + 60_000)
    const duracaoMin = (fimEfetivo - new Date(ini.dt)) / 60000
    const deslocM = distanciaM(ini.lat, ini.lon, fim.lat, fim.lon)
    const dOdm = (fim.odm && ini.odm) ? Math.max(0, fim.odm - ini.odm) : 0
    bloco.duracaoMin = duracaoMin
    bloco.deslocM = deslocM
    bloco.dOdm = dOdm
    bloco.valido =
      duracaoMin >= ML_DURACAO_MIN &&
      deslocM <= ML_RAIO_M &&
      dOdm <= ML_DELTA_ODM_KM
    blocos.push(bloco)
    bloco = null
  }
  for (let i = 0; i < msgsOrd.length; i++) {
    const m = msgsOrd[i]
    const parado = m.evt4 === 1 && (m.vel === null || m.vel < 1)
    if (parado) {
      if (!bloco) bloco = { msgs: [] }
      bloco.msgs.push(m)
    } else if (bloco) {
      fechar(i)
    }
  }
  if (bloco) fechar(msgsOrd.length)
  return blocos
}

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

// agregar() — sanitiza, deriva blocos confirmados e retorna métricas confiáveis.
// Pipeline anti-falso-positivo idêntica à de /api/dados.js (manter sincronizado).
function agregar(msgs) {
  if (!msgs || msgs.length === 0) return null

  const ordenado = sanitizarMensagens(msgs)
  if (ordenado.length === 0) return null

  let odmMin = Infinity, odmMax = -Infinity
  let frenagensBruscas = 0, aceleracoesBruscas = 0

  // === Métricas LEGACY pra modo paralelo (gravadas no snapshot) ===
  let excessoVelMinLegacy = 0
  let velMaxLegacy = 0
  let paradoMinLegacy = 0
  let blocoParadoLegacy = null

  for (let i = 0; i < ordenado.length; i++) {
    const m = ordenado[i]
    if (m.odm != null && m.odm < odmMin) odmMin = m.odm
    if (m.odm != null && m.odm > odmMax) odmMax = m.odm
    if (m.evt16) frenagensBruscas++
    if (m.evt17) aceleracoesBruscas++

    const proxima = ordenado[i + 1]
    const deltaMin = proxima
      ? Math.min(5, Math.max(0, (new Date(proxima.dt) - new Date(m.dt)) / 60000))
      : 1
    if (m.evt34 || (m.vel != null && m.vel > LIMITE_VEL)) excessoVelMinLegacy += deltaMin
    if (m.vel != null && m.vel > velMaxLegacy) velMaxLegacy = m.vel
    const paradoLeg = m.evt4 === 1 && (m.vel === null || m.vel < 1)
    if (paradoLeg) {
      if (!blocoParadoLegacy) blocoParadoLegacy = { ini: m.dt }
    } else if (blocoParadoLegacy) {
      paradoMinLegacy += (new Date(m.dt) - new Date(blocoParadoLegacy.ini)) / 60000
      blocoParadoLegacy = null
    }
  }
  if (blocoParadoLegacy) {
    const ult = ordenado[ordenado.length - 1]
    paradoMinLegacy += (new Date(ult.dt) - new Date(blocoParadoLegacy.ini)) / 60000
  }

  // === Marcha lenta REAL (3 testes) ===
  const blocosML = blocosMarchaLenta(ordenado)
  const blocosMLValidos = blocosML.filter(b => b.valido)
  const paradoMin = Math.round(
    blocosMLValidos.reduce((s, b) => s + b.duracaoMin, 0)
  )

  // === Excesso de velocidade REAL (blocos confirmados) ===
  const blocosExc = blocosExcesso(ordenado)
  const blocosExcValidos = blocosExc.filter(b => b.valido)
  const excessoVelMin = Math.round(
    blocosExcValidos.reduce((s, b) => s + b.duracaoMin, 0)
  )

  // === Picos suspeitos (140 < vel <= 200) — diagnóstico ===
  const picosSuspeitos = ordenado
    .filter(m => m.velSuspeita)
    .map(m => ({
      dt: m.dt,
      vel: Math.round(m.vel),
      mun: m.mun || null,
      uf: m.uf || null,
    }))

  // velMax: pico de blocos confirmados; sem excesso, máximo das NÃO suspeitas
  let velMax = 0
  if (blocosExcValidos.length > 0) {
    velMax = Math.max(...blocosExcValidos.map(b => b.velMax))
  } else {
    for (const m of ordenado) {
      if (m.vel != null && !m.velSuspeita && m.vel > velMax) velMax = m.vel
    }
  }

  // === KM rodado com sanity check ===
  let kmRodadoHoje = 0
  let kmFlag = null
  if (odmMin !== Infinity && odmMax > 0) {
    const bruto = odmMax - odmMin
    if (bruto < 0) { kmRodadoHoje = 0; kmFlag = 'odometro_negativo' }
    else if (bruto > KM_MAX_DIA) { kmRodadoHoje = KM_MAX_DIA; kmFlag = 'odometro_capado' }
    else kmRodadoHoje = bruto
  }

  return {
    paradoMin,
    excessoVelMin,
    velMax: Math.round(velMax),
    kmRodado: Math.round(kmRodadoHoje),
    kmFlag,
    frenagensBruscas,
    aceleracoesBruscas,
    picosSuspeitos,
    ultima: ordenado[ordenado.length - 1],
    blocosMarchaLenta: blocosMLValidos,
    blocosExcesso: blocosExcValidos,
    msgsSanitizadas: ordenado,
    legacy: {
      paradoMin: Math.round(paradoMinLegacy),
      excessoVelMin: Math.round(excessoVelMinLegacy),
      velMax: Math.round(velMaxLegacy),
    },
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
// Diário de IMPACTO — mesmo algoritmo do /api/dados.js
// Recebe blocos JÁ FILTRADOS (ML + excesso). Não filtra de novo.
// =========================================================================
const CONSUMO_EXTRA_EXC  = 5.4

function fmtHora(dt) {
  return new Date(dt).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}
function fmtLocal(m) { return m && m.mun ? `${m.mun}/${m.uf}` : '—' }
function fmtDur(min) {
  const h = Math.floor(min / 60), mm = Math.round(min % 60)
  return h > 0 ? `${h}h ${mm}min` : `${Math.round(min)} min`
}
function fmtBR(v) {
  return `R$ ${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')}`
}

function montarDiario(msgs, paradoMinTotal = 0, blocosML = [], blocosExc = []) {
  if (!msgs || msgs.length === 0) {
    return [{ h: '—', cor: '#888', ev: 'Sem mensagens nesse dia', det: '', custo: 0 }]
  }
  const ocorr = []

  // 1. MARCHA LENTA — 1 linha consolidada (com R$ + local do maior bloco)
  if (paradoMinTotal >= 5 && blocosML.length > 0) {
    const custo = (paradoMinTotal / 60) * CONSUMO_PARADO * PRECO_DIESEL
    const maior = blocosML.reduce((a, b) => (a.duracaoMin > b.duracaoMin ? a : b))
    const mIni = maior.msgs[0]
    const localMaior = (mIni && mIni.mun) ? `${mIni.mun}/${mIni.uf}` : '—'
    ocorr.push({
      h: fmtDur(paradoMinTotal),
      cor: '#D9A21B',
      ev: `Motor ligado parado · ${fmtBR(custo)}`,
      det: localMaior,
      custo: Math.round(custo * 100) / 100,
    })
  }

  // 2. PICOS DE VELOCIDADE — 1 linha por bloco confirmado
  for (const b of blocosExc) {
    const durMin = Math.max(1, Math.round(b.duracaoMin))
    const custo = (CONSUMO_EXTRA_EXC / 60) * durMin * PRECO_DIESEL
    ocorr.push({
      h: fmtHora(b.dtPico),
      cor: '#E55B3C',
      ev: `Pico ${Math.round(b.velMax)} km/h por ${durMin} min · ${fmtBR(custo)}`,
      det: b.mun ? `${b.mun}/${b.uf}` : '—',
      custo: Math.round(custo * 100) / 100,
    })
  }

  ocorr.sort((a, b) => (b.custo || 0) - (a.custo || 0))

  if (ocorr.length === 0) {
    return [{ h: '✓', cor: '#1D9E75', ev: 'Sem ocorrências de impacto nesse dia', det: '', custo: 0 }]
  }
  return ocorr
}

// =========================================================================
// Detecção de VIAGENS — mesmo algoritmo do /api/dados (constantes no topo)
// =========================================================================
function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lat2 == null || lon1 == null || lon2 == null) return null
  const toRad = x => (x * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function novaViagemEstado(m) {
  const v0 = m.vel ?? 0
  return {
    inicioMsg: m, fimMsg: m,
    velMax: v0, velSoma: v0, velContagem: v0 > 0 ? 1 : 0,
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
      const diario = montarDiario(
        ag.msgsSanitizadas || minhasMsgs,
        ag.paradoMin,
        ag.blocosMarchaLenta || [],
        ag.blocosExcesso || []
      )
      const viagens = detectarViagens(ag.msgsSanitizadas || minhasMsgs)

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
        // Diagnóstico/comparação — persistido no snapshot histórico
        // (colunas opcionais; banco aceita jsonb null se não existirem)
        diagnostico: {
          kmFlag: ag.kmFlag || null,
          picosSuspeitos: ag.picosSuspeitos,
          legacy: ag.legacy,
        },
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
