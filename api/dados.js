// =============================================================================
// /api/dados.js — Serve os dados agregados pro frontend FrotaIQ
// =============================================================================
// O frontend chama essa rota a cada 30s pra atualizar o painel.
// Aqui a gente:
//   1. Lê veículos cadastrados (tabela veiculos)
//   2. Lê mensagens do dia (tabela mensagens_cb)
//   3. Agrega por veículo: paradoMin, excessoVelMin, kmRodado, posição atual
//   4. Calcula score e status (mesma fórmula do dadosBeta)
//   5. Retorna no MESMO formato que getVeiculosBeta() devolvia
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// =============================================================================
// CONSTANTES — calibração de toda a pipeline anti-falso-positivo
// =============================================================================
const LIMITE_VEL     = 90      // km/h — limite de velocidade considerado excesso
const PRECO_DIESEL   = 6.50    // R$/L
const CONSUMO_PARADO = 3.5     // L/h em marcha lenta

// === Sanity bounds (recusa valores fisicamente impossíveis) ===
// Coordenadas: bounds geográficos do Brasil + margem
const LAT_MIN = -34, LAT_MAX = 6     // Brasil vai de Chuí a Roraima
const LON_MIN = -74, LON_MAX = -28   // Brasil vai do Acre à Paraíba
const VEL_MAX_FISICA   = 200          // km/h — descarte total (telemetria errada)
const VEL_MAX_PLAUSIVEL = 140         // km/h — limite operacional p/ caminhão pesado;
                                      // entre 140 e 200 conta como SUSPEITA: não
                                      // penaliza score nem entra em bloco de excesso,
                                      // mas mantém o valor pra análise/diagnóstico
const ODM_MAX_VALIDO = 9_999_999      // km — odômetro absurdo
const KM_MAX_DIA     = 1500           // km/dia — limite físico de operação rodoviária

// Dedup temporal: 2 msgs do MESMO veículo com timestamp idêntico
// (retry da ONIXSAT) são consolidadas
const DEDUP_INTERVALO_MS = 1   // 1ms = mesmo timestamp

// === Marcha lenta (bloco precisa passar nos 3 testes) ===
const ML_DURACAO_MIN  = 5      // min — descarga, abastecimento, descanso ar-cond passam disso
const ML_RAIO_M       = 50     // m   — absorve jitter normal de GPS (~10–20m mesmo parado)
const ML_DELTA_ODM_KM = 0.1    // km  — 100m no tacógrafo já é movimento de verdade

// === Excesso de velocidade — REGRA CONSERVADORA (AND, não OR) ===
// Bloco só vira evento real se preencher:
//   (≥2 amostras consecutivas acima do limite) E (≥30s de duração CERTA)
//   OU evt34 emitido pela própria ONIXSAT (autoridade do equipamento).
// O AND é importante: 2 amostras isoladas espaçadas 5s ainda é ruído.
const EXC_MIN_AMOSTRAS  = 2
const EXC_DURACAO_MIN_S = 30

// === GAP de telemetria — quebra bloco quando rastreador perde sinal ==========
// Se duas msgs CONSECUTIVAS no mesmo bloco têm Δt > MAX_GAP_BLOCO_S OU salto de
// posição > MAX_GAP_BLOCO_M, o bloco é dividido. Isso evita o caso clássico de:
//   msg t0 (parado, motor ligado) → [perde sinal 2h, andando estrada] → msg t1
//   (parado, motor ligado, 100 km de distância). Sem essa quebra, o sistema
//   contava as 2h do gap como marcha lenta — mesmo o caminhão tendo viajado.
const MAX_GAP_BLOCO_S = 300      // 5 min — telemetria normal vem a cada 30-60s
const MAX_GAP_BLOCO_M = 10_000   // 10 km — salto inequívoco de posição = viajou offline

// === Detecção de viagem ===
const VIAGEM_MIN_KM        = 5    // viagens menores que isso são lixo (ex: manobra de pátio)
const VIAGEM_MIN_DUR_MIN   = 15   // viagens curtas demais são lixo (ex: teste de motor)
const RAIO_RETORNO_KM      = 1.0  // raio (km) pra "voltou ao início"
const PARADA_LONGA_MIN     = 240  // parada >= 4h dispara avaliação de fim
const DESTINO_ESTAVEL_MIN  = 60   // parada >= 1h num lugar = destino
const PARADA_REGISTRO_MIN  = 10   // paradas curtas (>= 10min) viram evento

// =============================================================================
// HELPERS GEOMÉTRICOS / SANITIZAÇÃO
// =============================================================================

// Distância em metros entre 2 pontos (haversine simplificada)
function distanciaM(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0
  const R = 6371000 // raio da Terra (m)
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
  if (lat === 0 && lon === 0) return false  // null disfarçado de zero (Atlântico)
  if (lat < LAT_MIN || lat > LAT_MAX) return false
  if (lon < LON_MIN || lon > LON_MAX) return false
  return true
}

// Sanitiza array de mensagens da ONIXSAT — aplicado ANTES de qualquer agregação:
//   - Coordenadas inválidas (null, 0/0, fora do Brasil) viram null
//   - Velocidades absurdas (negativo, > 200 km/h) viram null
//   - Velocidades implausíveis (140 < vel <= 200): mantém valor mas marca
//     velSuspeita=true (não conta no score, não entra em bloco de excesso,
//     mas continua visível nos picos suspeitos pra diagnóstico)
//   - Odômetros absurdos (negativos, > 9.999.999) viram null
//   - Mensagens com mesmo timestamp (retry) são consolidadas
function sanitizarMensagens(msgs) {
  if (!msgs || msgs.length === 0) return []
  const ord = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))
  const out = []
  let ultimoMs = -1
  for (const m of ord) {
    const tMs = new Date(m.dt).getTime()
    // Dedup: msgs em < DEDUP_INTERVALO_MS são consideradas a mesma
    if (tMs - ultimoMs < DEDUP_INTERVALO_MS) continue

    const sane = { ...m, velSuspeita: false }
    if (!gpsValido(sane.lat, sane.lon)) {
      sane.lat = null
      sane.lon = null
    }
    if (sane.vel == null || sane.vel < 0 || sane.vel > VEL_MAX_FISICA) {
      sane.vel = null
    } else if (sane.vel > VEL_MAX_PLAUSIVEL) {
      // Implausível pra caminhão pesado mas tecnicamente possível — flag
      sane.velSuspeita = true
    }
    if (sane.odm == null || sane.odm <= 0 || sane.odm > ODM_MAX_VALIDO) {
      sane.odm = null
    }
    out.push(sane)
    ultimoMs = tMs
  }
  return out
}

// Quebra as msgs em blocos contínuos de excesso de velocidade.
// Bloco só é "válido" (real) se:
//   - tem ao menos EXC_MIN_AMOSTRAS mensagens consecutivas acima do limite, OU
//   - dura ao menos EXC_DURACAO_MIN_S segundos, OU
//   - tem evt34 confirmado pela própria ONIXSAT (autoridade do equipamento)
// Spike isolado (1 amostra com vel=130 e próxima com vel=0) é descartado.
function blocosExcesso(msgsOrd) {
  const blocos = []
  let bloco = null
  const fechar = (proxIdx) => {
    if (!bloco) return
    const ini = bloco.msgs[0]
    const fim = bloco.msgs[bloco.msgs.length - 1]
    const proxima = msgsOrd[proxIdx]
    // duracaoCertaS: tempo CONHECIDO acima do limite — só conta o intervalo
    // entre a primeira e a última msg do bloco. Se for 1 msg só, é 0
    // (não temos como afirmar que ficou X segundos acima).
    bloco.duracaoCertaS = (new Date(fim.dt) - new Date(ini.dt)) / 1000
    // duracaoEstimadaS: estimativa pra exibição (até a próxima msg ou +60s).
    // Mas se a próxima msg está a > MAX_GAP_BLOCO_S (gap de telemetria), NÃO
    // conta o gap como tempo de excesso — usa só o intervalo conhecido + 60s.
    const dtUltimo = new Date(fim.dt).getTime()
    const fimEfetivo = (proxima && (new Date(proxima.dt).getTime() - dtUltimo) / 1000 <= MAX_GAP_BLOCO_S)
      ? new Date(proxima.dt)
      : new Date(dtUltimo + 60_000)
    bloco.duracaoS = (fimEfetivo - new Date(ini.dt)) / 1000
    bloco.duracaoMin = bloco.duracaoS / 60
    bloco.qtdMsgs = bloco.msgs.length
    bloco.temEvt34 = bloco.msgs.some(m => m.evt34)
    bloco.velMax = bloco.msgs.reduce((mx, m) => Math.max(mx, m.vel ?? 0), 0)
    // Local: pega da msg de pico (onde aconteceu a velocidade máxima)
    const msgPico = bloco.msgs.reduce((p, m) => ((m.vel ?? 0) > (p?.vel ?? 0) ? m : p), bloco.msgs[0])
    bloco.mun = msgPico.mun
    bloco.uf = msgPico.uf
    bloco.dtPico = msgPico.dt
    // Validação CONSERVADORA (AND, não OR):
    //   - 2+ amostras consecutivas E ≥30s de duração certa entre elas, OU
    //   - evt34 confirmado pela própria ONIXSAT (autoridade do equipamento)
    // 2 amostras isoladas separadas por 5s ainda é considerado ruído —
    // o motorista precisa ter sustentado a velocidade alta por pelo menos 30s
    // pra a infração ser tratada como real.
    bloco.valido =
      (bloco.qtdMsgs >= EXC_MIN_AMOSTRAS && bloco.duracaoCertaS >= EXC_DURACAO_MIN_S) ||
      bloco.temEvt34
    blocos.push(bloco)
    bloco = null
  }
  for (let i = 0; i < msgsOrd.length; i++) {
    const m = msgsOrd[i]
    // Suspeitas (vel > 140) NÃO entram em bloco de excesso pra penalização —
    // só evt34 da ONIXSAT pode validar bloco com vel suspeita
    const velAcima = m.vel != null && m.vel > LIMITE_VEL && !m.velSuspeita
    const acima = velAcima || m.evt34 === 1
    if (acima) {
      // Gap de telemetria: se a msg anterior do bloco está a > 5min OU > 10km
      // de distância, fecha o bloco atual e começa um novo. Evita "costurar"
      // dois eventos de excesso separados por longo período sem sinal.
      if (bloco) {
        const ult = bloco.msgs[bloco.msgs.length - 1]
        const dtSec = (new Date(m.dt) - new Date(ult.dt)) / 1000
        const distM = distanciaM(ult.lat, ult.lon, m.lat, m.lon)
        if (dtSec > MAX_GAP_BLOCO_S || distM > MAX_GAP_BLOCO_M) {
          fechar(msgsOrd.length)  // fecha sem usar m como proxima
        }
      }
      if (!bloco) bloco = { msgs: [] }
      bloco.msgs.push(m)
    } else if (bloco) {
      fechar(i)
    }
  }
  if (bloco) fechar(msgsOrd.length)
  return blocos
}

// Quebra as msgs em blocos contínuos de "motor ligado + parado" (vel<1).
// Cada bloco vem com início/fim, duração em min, deslocamento GPS e Δodômetro.
// Só considera o bloco "marcha lenta de verdade" se passar nos 3 testes acima.
function blocosMarchaLenta(msgsOrd) {
  const blocos = []
  let bloco = null

  const fechar = (proxIdx) => {
    if (!bloco) return
    const ini = bloco.msgs[0]
    const fim = bloco.msgs[bloco.msgs.length - 1]
    // Duração: do início do bloco até a próxima mensagem (que já não é parada),
    // ou +1 min se é o fim do dia. Se a próxima msg está a > MAX_GAP_BLOCO_S
    // (gap de telemetria), NÃO usa ela como fim — o gap não conta como parado.
    const proxima = msgsOrd[proxIdx]
    const dtUltimo = new Date(fim.dt).getTime()
    const fimEfetivo = (proxima && (new Date(proxima.dt).getTime() - dtUltimo) / 1000 <= MAX_GAP_BLOCO_S)
      ? new Date(proxima.dt)
      : new Date(dtUltimo + 60_000)
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
      // GAP de telemetria: se rastreador perdeu sinal entre a última msg do
      // bloco atual e essa nova msg (Δt > 5min OU salto > 10km), o caminhão
      // pode ter rodado offline. Fecha o bloco atual SEM contar o gap como
      // marcha lenta, e começa um novo bloco a partir desta msg.
      // Esse fix elimina o falso positivo clássico:
      //   "chegou parado em A → perdeu sinal → voltou parado em B (100km)"
      //   Sem isso, o sistema contava todas as horas do gap como motor ligado.
      if (bloco) {
        const ult = bloco.msgs[bloco.msgs.length - 1]
        const dtSec = (new Date(m.dt) - new Date(ult.dt)) / 1000
        const distM = distanciaM(ult.lat, ult.lon, m.lat, m.lon)
        if (dtSec > MAX_GAP_BLOCO_S || distM > MAX_GAP_BLOCO_M) {
          fechar(msgsOrd.length)  // fecha sem proxima → gap não conta
        }
      }
      if (!bloco) bloco = { msgs: [] }
      bloco.msgs.push(m)
    } else if (bloco) {
      fechar(i)
    }
  }
  if (bloco) fechar(msgsOrd.length)
  return blocos
}

// Helper: cria o objeto "vazio" pra um veículo sem mensagens hoje
function veiculoVazio(v) {
  return {
    placa: v.placa || '—',
    motorista: v.motorista || 'Não vinculado',
    frota: v.placa || String(v.vei_id),
    veiID: v.vei_id,
    chassi: v.chassi,
    status: 'verde',
    statusTxt: 'Sem dados',
    vel: '0 km/h',
    velMax: 0,
    limiteVel: LIMITE_VEL,
    excessoVelMin: 0,
    kmDesvio: 0,
    ignicao: false,
    parado: '—',
    paradoMin: 0,
    perdaHoje: 0,
    perdaSemana: 0,
    km: '0 km',
    score: null,
    posicao: null,
    rota: '—',
    modelo: 'Cavalo',
    alertaTipo: null,
    alertaTitulo: '',
    alertaDesc: '',
    diario: [{ h: '—', cor: '#888', ev: 'Sem mensagens nas últimas horas', det: '' }],
    viagens: [],
  }
}

// Helper: agrega métricas de um conjunto de mensagens.
// IMPORTANTE: passa as msgs por sanitizarMensagens() antes de qualquer cálculo,
// pra rejeitar GPS inválido, velocidades absurdas, odômetros corrompidos e
// duplicatas exatas. Toda a pipeline depois só vê dados confiáveis.
function agregar(msgs) {
  if (!msgs || msgs.length === 0) return null

  const ordenado = sanitizarMensagens(msgs)
  if (ordenado.length === 0) return null

  let odmMin = Infinity
  let odmMax = -Infinity
  let frenagensBruscas = 0
  let aceleracoesBruscas = 0

  // === LEGACY (modo paralelo de validação) =================================
  // Reproduz o cálculo da pipeline antiga (sem filtros) pra que o gestor
  // possa comparar lado a lado o quanto era falso positivo. Esses números
  // NUNCA são usados pra score nem pra alertas — só ficam expostos no
  // payload via /api/dados?compare=1
  let excessoVelMinLegacy = 0
  let velMaxLegacy = 0
  let paradoMinLegacy = 0
  let blocoParadoLegacyAtual = null
  // ==========================================================================

  for (let i = 0; i < ordenado.length; i++) {
    const m = ordenado[i]
    if (m.odm != null && m.odm < odmMin) odmMin = m.odm
    if (m.odm != null && m.odm > odmMax) odmMax = m.odm
    if (m.evt16) frenagensBruscas++
    if (m.evt17) aceleracoesBruscas++

    // --- legacy: excesso = qualquer msg acima do limite, deltaMin até a próxima
    const proxima = ordenado[i + 1]
    const deltaMin = proxima
      ? Math.min(5, Math.max(0, (new Date(proxima.dt) - new Date(m.dt)) / 60000))
      : 1
    if (m.evt34 || (m.vel != null && m.vel > LIMITE_VEL)) {
      excessoVelMinLegacy += deltaMin
    }
    // --- legacy: velMax = pico bruto (qualquer msg, mesmo suspeita)
    if (m.vel != null && m.vel > velMaxLegacy) velMaxLegacy = m.vel
    // --- legacy: marcha lenta = qualquer evt4=1 + vel<1 sem filtro
    const paradoLegacy = m.evt4 === 1 && (m.vel === null || m.vel < 1)
    if (paradoLegacy) {
      if (!blocoParadoLegacyAtual) blocoParadoLegacyAtual = { ini: m.dt }
    } else if (blocoParadoLegacyAtual) {
      paradoMinLegacy += (new Date(m.dt) - new Date(blocoParadoLegacyAtual.ini)) / 60000
      blocoParadoLegacyAtual = null
    }
  }
  if (blocoParadoLegacyAtual) {
    const ult = ordenado[ordenado.length - 1]
    paradoMinLegacy += (new Date(ult.dt) - new Date(blocoParadoLegacyAtual.ini)) / 60000
  }

  // === Marcha lenta REAL: só blocos contínuos que passam nos 3 testes ===
  const blocosML = blocosMarchaLenta(ordenado)
  const blocosMLValidos = blocosML.filter(b => b.valido)
  const paradoMin = Math.round(
    blocosMLValidos.reduce((s, b) => s + b.duracaoMin, 0)
  )

  // === Excesso de velocidade REAL: só blocos confirmados ===
  // (≥2 amostras E ≥30s, ou evt34 da própria ONIXSAT)
  const blocosExc = blocosExcesso(ordenado)
  const blocosExcValidos = blocosExc.filter(b => b.valido)
  const excessoVelMin = Math.round(
    blocosExcValidos.reduce((s, b) => s + b.duracaoMin, 0)
  )

  // === Picos SUSPEITOS (140 < vel <= 200) — não penalizam mas ficam visíveis
  // como sinal de alerta de telemetria pra investigação manual ===
  const picosSuspeitos = ordenado
    .filter(m => m.velSuspeita)
    .map(m => ({
      dt: m.dt,
      vel: Math.round(m.vel),
      mun: m.mun || null,
      uf: m.uf || null,
    }))

  // === velMax: pico das mensagens dentro de blocos de excesso CONFIRMADOS ===
  // Spike isolado, msg suspeita (>140) e telemetria errada são descartados.
  // Sem excesso confirmado, usa o máximo das msgs NÃO suspeitas.
  let velMax = 0
  if (blocosExcValidos.length > 0) {
    velMax = Math.max(...blocosExcValidos.map(b => b.velMax))
  } else {
    for (const m of ordenado) {
      if (m.vel != null && !m.velSuspeita && m.vel > velMax) velMax = m.vel
    }
  }

  // === KM rodado com sanity check ===
  // Se a diferença for absurda (>1500 km/dia), capa em KM_MAX_DIA e flagga.
  let kmRodadoHoje = 0
  let kmFlag = null
  if (odmMin !== Infinity && odmMax > 0) {
    const bruto = odmMax - odmMin
    if (bruto < 0) {
      kmRodadoHoje = 0
      kmFlag = 'odometro_negativo'
    } else if (bruto > KM_MAX_DIA) {
      kmRodadoHoje = KM_MAX_DIA
      kmFlag = 'odometro_capado'
    } else {
      kmRodadoHoje = bruto
    }
  }

  return {
    paradoMin,
    excessoVelMin,
    velMax: Math.round(velMax),
    kmRodado: Math.round(kmRodadoHoje),
    kmFlag,
    frenagensBruscas,
    aceleracoesBruscas,
    picosSuspeitos,                       // diagnóstico — telemetria fora do padrão
    blocosMarchaLenta: blocosMLValidos,   // pra usar no diário (maior bloco + local)
    blocosExcesso: blocosExcValidos,      // pra usar no diário (1 linha por pico real)
    msgsSanitizadas: ordenado,            // pra detectarViagens reusar input limpo
    // === Modo paralelo (?compare=1) — números da pipeline antiga p/ comparar ===
    legacy: {
      paradoMin: Math.round(paradoMinLegacy),
      excessoVelMin: Math.round(excessoVelMinLegacy),
      velMax: Math.round(velMaxLegacy),
    },
  }
}

function calcularScore(paradoMin, excessoVelMin, kmDesvio = 0) {
  return Math.max(0, Math.min(100, Math.round(
    95 - paradoMin * 0.55 - excessoVelMin * 0.9 - kmDesvio * 0.4
  )))
}

function statusDoScore(score) {
  if (score < 60) return { status: 'vermelho', statusTxt: 'Crítico' }
  if (score < 80) return { status: 'amarelo',  statusTxt: 'Atenção' }
  return                  { status: 'verde',   statusTxt: 'Normal'  }
}

function formatarParado(min) {
  if (min === 0) return '0 min'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}min` : `${m} min`
}

// =========================================================================
// Diário de IMPACTO do veículo — cada linha é uma ocorrência consolidada
// com custo estimado em R$. Formato pensado pra mensagem de WhatsApp pro
// gestor (ex: "🟡 Marcha lenta · 2h 35min · R$ 58,86").
// Só inclui ocorrências de IMPACTO FINANCEIRO DIRETO já confirmadas pelos
// filtros anti-falso-positivo:
//   1. Marcha lenta consolidada (blocos que passaram nos 3 testes)
//   2. Picos de velocidade confirmados (blocos com ≥2 amostras ou evt34)
// =========================================================================
const CONSUMO_EXTRA_EXC = 5.4   // L/h extra durante excesso (~15% acima)

function fmtHora(dt) {
  return new Date(dt).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}
function fmtLocal(m) {
  return m && m.mun ? `${m.mun}/${m.uf}` : '—'
}
function fmtDur(min) {
  const h = Math.floor(min / 60), mm = Math.round(min % 60)
  return h > 0 ? `${h}h ${mm}min` : `${Math.round(min)} min`
}
function fmtBR(v) {
  return `R$ ${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')}`
}

// montarDiario(msgs, paradoMinTotal, blocosML, blocosExc)
// Recebe blocos JÁ FILTRADOS de marcha lenta e excesso (vindos de agregar()).
// Não filtra de novo — apenas formata pra UI/WhatsApp.
function montarDiario(msgs, paradoMinTotal = 0, blocosML = [], blocosExc = []) {
  if (!msgs || msgs.length === 0) {
    return [{ h: '—', cor: '#888', ev: 'Sem mensagens nesse dia', det: '', custo: 0 }]
  }
  const ocorr = []

  // 1. MARCHA LENTA — consolidada (1 linha com R$ + local do maior bloco)
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
// Detecção de VIAGENS — agrupa atividade do dia em viagens lógicas.
// Constantes (VIAGEM_MIN_KM, VIAGEM_MIN_DUR_MIN, RAIO_RETORNO_KM, etc) estão
// declaradas no bloco principal de constantes no topo do arquivo.
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
    inicio: {
      hora: fmtHora(v.inicioMsg.dt), local: fmtLocal(v.inicioMsg),
      lat: v.inicioMsg.lat, lon: v.inicioMsg.lon,
    },
    fim: {
      hora: fmtHora(v.fimMsg.dt), local: fmtLocal(v.fimMsg),
      lat: v.fimMsg.lat, lon: v.fimMsg.lon,
    },
    distanciaKm: Math.round(distKm),
    duracaoMin: durMin,
    velMax: Math.round(v.velMax),
    velMedia: v.velContagem > 0 ? Math.round(v.velSoma / v.velContagem) : 0,
    excessos: v.excessos.map(e => ({
      hora: fmtHora(e.dt), velPico: Math.round(e.velMax),
      local: e.mun ? `${e.mun}/${e.uf}` : '—',
    })),
    paradas: v.paradas.map(p => ({
      hora: fmtHora(p.dt), duracaoMin: p.duracaoMin,
      local: p.mun ? `${p.mun}/${p.uf}` : '—',
    })),
    freadas: v.freadas,
    aceleracoes: v.aceleracoes,
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
    // Filtro de falso positivo
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
      // Fecha parada aberta (se tinha) como evento dentro da viagem
      if (v && v.paradaAberta) {
        const dur = (new Date(m.dt) - new Date(v.paradaAberta.dt)) / 60000
        if (dur >= PARADA_REGISTRO_MIN) {
          v.paradas.push({
            dt: v.paradaAberta.dt, duracaoMin: Math.round(dur),
            mun: v.paradaAberta.mun, uf: v.paradaAberta.uf,
          })
        }
        v.paradaAberta = null
      }
      if (!v) v = novaViagemEstado(m)
      v.fimMsg = m
      if (m.vel > v.velMax) v.velMax = m.vel
      v.velSoma += m.vel; v.velContagem++
    } else if (v) {
      // Parado dentro de uma viagem
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
          // Fecha viagem no momento em que parou (e não conta a parada longa em si)
          v.fimMsg = v.paradaAberta.msgInicio
          v.paradaAberta = null
          fechar(voltouInicio ? 'voltou_origem' : naoSaiuQuase ? 'nao_saiu' : 'destino')
        }
      }
    }

    // Eventos da viagem (excessos, freadas, acelerações)
    if (v) {
      const emExc = m.evt34 || (m.vel && m.vel > LIMITE_VEL)
      if (emExc) {
        if (!v.excessoAberto) {
          v.excessoAberto = { dt: m.dt, velMax: m.vel || LIMITE_VEL, mun: m.mun, uf: m.uf }
        } else if (m.vel && m.vel > v.excessoAberto.velMax) {
          v.excessoAberto.velMax = m.vel
        }
      } else if (v.excessoAberto) {
        v.excessos.push(v.excessoAberto); v.excessoAberto = null
      }
      if (m.evt16) v.freadas++
      if (m.evt17) v.aceleracoes++
    }
  }

  // Viagem em aberto no fim do dia → "em andamento"
  if (v) { v.emAndamento = true; fechar('em_andamento') }

  return viagens
}

// Brasília = UTC-3 (sem horário de verão desde 2019)
const TZ_OFFSET_HOURS = -3

// "YYYY-MM-DD" em Brasília
function dataBrasilia(d = new Date()) {
  const ms = d.getTime() + TZ_OFFSET_HOURS * 3600_000
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Início e fim (UTC, ISO string) de um dia local de Brasília
// Ex: "2026-05-05" → { inicio: "2026-05-05T03:00:00.000Z", fim: "2026-05-06T03:00:00.000Z" }
function intervaloDoDia(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number)
  const inicio = new Date(Date.UTC(y, m - 1, d, -TZ_OFFSET_HOURS, 0, 0, 0))
  const fim    = new Date(Date.UTC(y, m - 1, d + 1, -TZ_OFFSET_HOURS, 0, 0, 0))
  return { inicio: inicio.toISOString(), fim: fim.toISOString() }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30')

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Determina qual dia consultar
  const hojeBR = dataBrasilia()
  const dataConsulta = (req.query?.data) || hojeBR
  const ehHoje = dataConsulta === hojeBR
  // Modo comparação: ?compare=1 inclui pra cada veículo um campo `comparacao`
  // com os números que a pipeline antiga (sem filtros anti-falso-positivo)
  // teria reportado. Útil pra rodar lado a lado por uns dias antes do corte.
  const ehCompare = req.query?.compare === '1'

  try {
    // Busca todos os veículos cadastrados
    const { data: veiculos, error: errVei } = await supabase
      .from('veiculos')
      .select('*')

    if (errVei) throw new Error('Erro ao buscar veículos: ' + errVei.message)

    // === MODO HISTÓRICO: lê snapshot da tabela historico_dia ===
    if (!ehHoje) {
      const { data: hist, error: errHist } = await supabase
        .from('historico_dia')
        .select('*')
        .eq('data', dataConsulta)

      if (errHist) throw new Error('Erro histórico: ' + errHist.message)

      // Mapa por vei_id pra juntar com cadastro de veículos
      const histPorVei = {}
      for (const h of hist || []) histPorVei[h.vei_id] = h

      const frota = (veiculos || []).map(v => {
        const h = histPorVei[v.vei_id]
        if (!h) {
          return {
            ...veiculoVazio(v),
            statusTxt: 'Sem dados nesse dia',
          }
        }
        return {
          placa: v.placa || '—',
          motorista: h.motorista || v.motorista || 'Não vinculado',
          frota: v.placa || String(v.vei_id),
          veiID: v.vei_id, chassi: v.chassi, modelo: 'Cavalo',
          status: h.status, statusTxt: h.status_txt, score: h.score,
          vel: '—', velMax: h.vel_max, limiteVel: LIMITE_VEL,
          excessoVelMin: h.excesso_vel_min, kmDesvio: 0,
          ignicao: h.ignicao_final,
          parado: formatarParado(h.parado_min), paradoMin: h.parado_min,
          perdaHoje: Number(h.perda) || 0,
          perdaSemana: Math.round((Number(h.perda) || 0) * 5),
          km: `${h.km_rodado} km`,
          posicao: h.posicao_final,
          rota: h.posicao_final || '—',
          alertaTipo: h.status === 'vermelho' ? 'critico' : h.status === 'amarelo' ? 'atencao' : null,
          alertaTitulo: h.status !== 'verde'
            ? `Marcha lenta — ${formatarParado(h.parado_min)}` : '',
          alertaDesc: h.status === 'vermelho'
            ? `Perda no dia: R$ ${Number(h.perda).toFixed(2)}` : '',
          diario: Array.isArray(h.diario) && h.diario.length > 0
            ? h.diario
            : [{ h: '—', cor: '#888', ev: 'Snapshot sem diário detalhado', det: dataConsulta }],
          viagens: Array.isArray(h.viagens) ? h.viagens : [],
        }
      })

      const perdaTotal = frota.reduce((s, v) => s + (v.perdaHoje || 0), 0)
      const emRotaAgora = 0  // dia fechado, não tem "agora"

      return res.status(200).json({
        ok: true, modo: 'historico', data: dataConsulta,
        atualizadoEm: new Date().toISOString(),
        coleta: null,
        resumo: {
          totalVeiculos: frota.length,
          emRotaAgora,
          perdaTotalHoje: Math.round(perdaTotal * 100) / 100,
          scoreMedio: frota.length
            ? Math.round(frota.filter(v => v.score !== null).reduce((s, v) => s + v.score, 0)
                / Math.max(1, frota.filter(v => v.score !== null).length)) : 0,
        },
        frota,
      })
    }

    // === MODO TEMPO REAL: calcula em cima das mensagens do dia ===
    // Janela 00:00 → 23:59 do dia ATUAL em Brasília (servidor do Vercel roda em UTC,
    // por isso usamos intervaloDoDia em vez de setHours, que daria fuso errado)
    const { inicio: desde, fim: ateAmanha } = intervaloDoDia(hojeBR)

    // Pagina porque o Supabase free tier tem cap de 1000 linhas/query
    let msgs = []
    {
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data: parte, error: errMsg } = await supabase
          .from('mensagens_cb')
          .select('vei_id, dt, lat, lon, mun, uf, vel, evt4, evt34, evt54, evt16, evt17, odm, mot')
          .gte('dt', desde)
          .lt('dt', ateAmanha)
          .order('dt', { ascending: true })
          .range(from, from + PAGE - 1)
        if (errMsg) throw new Error('Erro ao buscar mensagens: ' + errMsg.message)
        msgs = msgs.concat(parte || [])
        if (!parte || parte.length < PAGE) break
        from += PAGE
      }
    }

    // Agrupa por veiID
    const msgsPorVei = {}
    for (const m of msgs || []) {
      if (!msgsPorVei[m.vei_id]) msgsPorVei[m.vei_id] = []
      msgsPorVei[m.vei_id].push(m)
    }

    // Monta o array de veículos no formato esperado pelo frontend
    const frota = (veiculos || []).map(v => {
      const minhasMsgs = msgsPorVei[v.vei_id] || []
      if (minhasMsgs.length === 0) return veiculoVazio(v)

      const ag = agregar(minhasMsgs)
      // Agora ordenamos asc, então a última msg é o índice final
      const ultima = minhasMsgs[minhasMsgs.length - 1]
      const score = calcularScore(ag.paradoMin, ag.excessoVelMin)
      const { status, statusTxt } = statusDoScore(score)

      const perdaHoje = Math.round((ag.paradoMin / 60) * CONSUMO_PARADO * PRECO_DIESEL * 100) / 100

      const veiculo = {
        placa: v.placa || '—',
        motorista: v.motorista || ultima.mot || 'Não vinculado',
        frota: v.placa || String(v.vei_id),
        veiID: v.vei_id,
        chassi: v.chassi,
        modelo: 'Cavalo',
        status, statusTxt,
        score,
        vel: `${Math.round(ultima.vel || 0)} km/h`,
        velMax: ag.velMax,
        limiteVel: LIMITE_VEL,
        excessoVelMin: ag.excessoVelMin,
        kmDesvio: 0,                         // ainda não temos rota planejada
        ignicao: ultima.evt4 === 1,
        parado: formatarParado(ag.paradoMin),
        paradoMin: ag.paradoMin,
        perdaHoje,
        perdaSemana: Math.round(perdaHoje * 5),
        km: `${ag.kmRodado} km`,
        posicao: ultima.mun ? `${ultima.mun}/${ultima.uf}` : null,
        lat: ultima.lat,
        lon: ultima.lon,
        rota: ultima.mun ? `${ultima.mun}/${ultima.uf}` : '—',
        alertaTipo: status === 'vermelho' ? 'critico' : status === 'amarelo' ? 'atencao' : null,
        alertaTitulo: status === 'vermelho'
          ? `Marcha lenta acima do limite — ${formatarParado(ag.paradoMin)}`
          : status === 'amarelo'
            ? `Marcha lenta moderada — ${formatarParado(ag.paradoMin)}`
            : '',
        alertaDesc: status === 'vermelho'
          ? `Perda estimada hoje: R$ ${perdaHoje.toFixed(2)}`
          : '',
        diario: montarDiario(
          ag.msgsSanitizadas || minhasMsgs,
          ag.paradoMin,
          ag.blocosMarchaLenta || [],
          ag.blocosExcesso || []
        ),
        viagens: detectarViagens(ag.msgsSanitizadas || minhasMsgs),
      }
      if (ehCompare) {
        veiculo.picosSuspeitos = ag.picosSuspeitos
        veiculo.kmFlag = ag.kmFlag
        veiculo.comparacao = {
          // Métricas que a pipeline ANTIGA teria reportado (sem filtros)
          paradoMinLegacy: ag.legacy.paradoMin,
          excessoVelMinLegacy: ag.legacy.excessoVelMin,
          velMaxLegacy: ag.legacy.velMax,
          // Diferenças (= o quanto era falso positivo)
          paradoMinFalsoPositivo: Math.max(0, ag.legacy.paradoMin - ag.paradoMin),
          excessoVelMinFalsoPositivo: Math.max(0, ag.legacy.excessoVelMin - ag.excessoVelMin),
          // R$ que o antigo teria reportado de perda
          perdaLegacy: Math.round((ag.legacy.paradoMin / 60) * CONSUMO_PARADO * PRECO_DIESEL * 100) / 100,
        }
      }
      return veiculo
    })

    // Resumo agregado
    const perdaTotalHoje = frota.reduce((s, v) => s + (v.perdaHoje || 0), 0)
    const emRotaAgora = frota.filter(v => v.ignicao).length

    // Busca status da última coleta
    const { data: estado } = await supabase
      .from('coleta_estado')
      .select('ultima_coleta_em, ultima_coleta_status, ultima_coleta_qtd_msg, total_msgs_coletadas')
      .eq('id', 1)
      .single()

    const resposta = {
      ok: true,
      atualizadoEm: new Date().toISOString(),
      coleta: estado || null,
      resumo: {
        totalVeiculos: frota.length,
        emRotaAgora,
        perdaTotalHoje: Math.round(perdaTotalHoje * 100) / 100,
        scoreMedio: frota.length
          ? Math.round(frota.filter(v => v.score !== null).reduce((s, v) => s + v.score, 0) / frota.filter(v => v.score !== null).length)
          : 0,
      },
      frota,
    }
    if (ehCompare) {
      // Resumo agregado da diferença entre pipelines pra comparação rápida
      const somaLegacy = frota.reduce((acc, v) => {
        const c = v.comparacao || {}
        return {
          parado: acc.parado + (c.paradoMinLegacy || 0),
          excesso: acc.excesso + (c.excessoVelMinLegacy || 0),
          perda: acc.perda + (c.perdaLegacy || 0),
        }
      }, { parado: 0, excesso: 0, perda: 0 })
      const somaNovo = frota.reduce((acc, v) => ({
        parado: acc.parado + (v.paradoMin || 0),
        excesso: acc.excesso + (v.excessoVelMin || 0),
        perda: acc.perda + (v.perdaHoje || 0),
      }), { parado: 0, excesso: 0, perda: 0 })
      resposta.comparacao = {
        modo: 'paralelo',
        descricao: 'Pipeline antiga (sem filtros) vs nova (anti-falso-positivo). Use por uns dias para validar a transição.',
        legacy: {
          paradoMinTotal: Math.round(somaLegacy.parado),
          excessoVelMinTotal: Math.round(somaLegacy.excesso),
          perdaTotal: Math.round(somaLegacy.perda * 100) / 100,
        },
        novo: {
          paradoMinTotal: Math.round(somaNovo.parado),
          excessoVelMinTotal: Math.round(somaNovo.excesso),
          perdaTotal: Math.round(somaNovo.perda * 100) / 100,
        },
        falsoPositivoEvitado: {
          paradoMin: Math.round(Math.max(0, somaLegacy.parado - somaNovo.parado)),
          excessoVelMin: Math.round(Math.max(0, somaLegacy.excesso - somaNovo.excesso)),
          perda: Math.round(Math.max(0, somaLegacy.perda - somaNovo.perda) * 100) / 100,
        },
      }
    }
    return res.status(200).json(resposta)
  } catch (err) {
    console.error('Erro em /api/dados:', err)
    return res.status(500).json({ erro: err.message })
  }
}
