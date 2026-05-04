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

// Constantes (mesmas do dadosBeta)
const LIMITE_VEL = 90      // km/h
const PRECO_DIESEL = 6.50  // R$/L
const CONSUMO_PARADO = 3.5 // L/h em marcha lenta

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

// Helper: agrega métricas de um conjunto de mensagens
function agregar(msgs) {
  if (msgs.length === 0) return null

  // Ordena por dt asc pra calcular intervalos corretamente
  const ordenado = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))

  let paradoMin = 0
  let excessoVelMin = 0
  let velMax = 0
  let odmMin = Infinity
  let odmMax = -Infinity
  let frenagensBruscas = 0
  let aceleracoesBruscas = 0

  for (let i = 0; i < ordenado.length; i++) {
    const m = ordenado[i]
    const proxima = ordenado[i + 1]

    // Intervalo até a próxima mensagem (em minutos)
    const deltaMin = proxima
      ? Math.min(5, Math.max(0, (new Date(proxima.dt) - new Date(m.dt)) / 60000))
      : 1 // última mensagem: assume 1 min

    // Marcha lenta: ignição ligada (evt4=1) e velocidade ~0
    if (m.evt4 === 1 && (m.vel === null || m.vel < 1)) {
      paradoMin += deltaMin
    }

    // Excesso de velocidade: evt34 OU vel > limite
    if (m.evt34 || (m.vel && m.vel > LIMITE_VEL)) {
      excessoVelMin += deltaMin
    }

    if (m.vel && m.vel > velMax) velMax = m.vel
    if (m.odm && m.odm > 0 && m.odm < odmMin) odmMin = m.odm
    if (m.odm && m.odm > odmMax) odmMax = m.odm
    if (m.evt16) frenagensBruscas++
    if (m.evt17) aceleracoesBruscas++
  }

  paradoMin = Math.round(paradoMin)
  excessoVelMin = Math.round(excessoVelMin)
  const kmRodadoHoje = (odmMin !== Infinity && odmMax > 0) ? odmMax - odmMin : 0

  return {
    paradoMin,
    excessoVelMin,
    velMax: Math.round(velMax),
    kmRodado: kmRodadoHoje,
    frenagensBruscas,
    aceleracoesBruscas,
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
// Categorias:
//   1. Marcha lenta (consolidada) — combustível desperdiçado
//   2. Excesso de velocidade (1 linha por evento) — combustível extra
//   3. Frenagens bruscas (consolidadas) — desgaste de freios
//   4. Acelerações bruscas (consolidadas) — combustível extra
//   5. Parada longa motor desligado (contexto operacional, sem custo)
// =========================================================================
const PARADA_MIN_MIN = 10
const CUSTO_FRENAGEM     = 3.00     // R$/evento (pastilhas/discos)
const CUSTO_ACELERACAO   = 1.50     // R$/evento (combustível extra)
const CONSUMO_EXTRA_EXC  = 5.4      // L/h extra durante excesso (~15% acima)

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

// montarDiario(msgs, paradoMinTotal)
// Só ocorrências com IMPACTO FINANCEIRO DIRETO:
//   1. Marcha lenta — combustível desperdiçado (motor ligado parado)
//   2. Pico de velocidade — combustível extra (cada bloco contínuo)
// Cada linha tem local da ocorrência (mostrado embaixo na UI).
function montarDiario(msgs, paradoMinTotal = 0) {
  if (!msgs || msgs.length === 0) {
    return [{ h: '—', cor: '#888', ev: 'Sem mensagens nesse dia', det: '', local: '', custo: 0 }]
  }
  const ord = [...msgs].sort((a, b) => new Date(a.dt) - new Date(b.dt))
  const ocorr = []

  // 1. MARCHA LENTA — consolidada, com local do maior bloco
  if (paradoMinTotal >= 5) {
    const custo = (paradoMinTotal / 60) * CONSUMO_PARADO * PRECO_DIESEL
    const localMaior = encontrarMaiorBlocoMarchaLenta(ord)
    ocorr.push({
      h: fmtDur(paradoMinTotal),
      cor: '#D9A21B',
      ev: 'Caminhão parado com motor ligado',
      det: `${fmtDur(paradoMinTotal)} de marcha lenta no dia · combustível desperdiçado`,
      local: localMaior || '—',
      custo: Math.round(custo * 100) / 100,
    })
  }

  // 2. PICOS DE VELOCIDADE (cada janela contínua = 1 linha)
  let excEm = null
  for (const m of ord) {
    const vel = Number(m.vel) || 0
    const emExc = m.evt34 || vel > LIMITE_VEL
    if (emExc) {
      if (!excEm) excEm = { dtIni: m.dt, dtFim: m.dt, velMax: vel || LIMITE_VEL, mun: m.mun, uf: m.uf }
      else {
        excEm.dtFim = m.dt
        if (vel > excEm.velMax) { excEm.velMax = vel; excEm.mun = m.mun; excEm.uf = m.uf }
      }
    } else if (excEm) { pushExcesso(ocorr, excEm); excEm = null }
  }
  if (excEm) pushExcesso(ocorr, excEm)

  // Ordena por custo desc (maior impacto primeiro)
  ocorr.sort((a, b) => (b.custo || 0) - (a.custo || 0))

  if (ocorr.length === 0) {
    return [{ h: '✓', cor: '#1D9E75', ev: 'Sem ocorrências de impacto nesse dia', det: '', local: '', custo: 0 }]
  }
  return ocorr
}

function pushExcesso(arr, ex) {
  const durMin = Math.max(1, Math.round((new Date(ex.dtFim) - new Date(ex.dtIni)) / 60000))
  const custo = (CONSUMO_EXTRA_EXC / 60) * durMin * PRECO_DIESEL
  arr.push({
    h: fmtDur(durMin),
    cor: '#E55B3C',
    ev: `Pico de velocidade — ${Math.round(ex.velMax)} km/h`,
    det: `${durMin} min acima do limite de ${LIMITE_VEL} km/h · combustível extra`,
    local: ex.mun ? `${ex.mun}/${ex.uf}` : '—',
    custo: Math.round(custo * 100) / 100,
  })
}

// Encontra o maior bloco contínuo de marcha lenta (vel<1 + motor ligado)
// e devolve o local desse bloco, pra mostrar no card "marcha lenta total".
function encontrarMaiorBlocoMarchaLenta(ord) {
  let melhor = null
  let atual = null
  for (const m of ord) {
    const vel = Number(m.vel) || 0
    if (m.evt4 === 1 && vel < 1) {
      if (!atual) atual = { dtIni: m.dt, dtFim: m.dt, mun: m.mun, uf: m.uf }
      else atual.dtFim = m.dt
    } else if (atual) {
      const dur = (new Date(atual.dtFim) - new Date(atual.dtIni)) / 60000
      if (!melhor || dur > melhor.dur) melhor = { dur, mun: atual.mun, uf: atual.uf }
      atual = null
    }
  }
  if (atual) {
    const dur = (new Date(atual.dtFim) - new Date(atual.dtIni)) / 60000
    if (!melhor || dur > melhor.dur) melhor = { dur, mun: atual.mun, uf: atual.uf }
  }
  return melhor && melhor.mun ? `${melhor.mun}/${melhor.uf}` : null
}

// =========================================================================
// Detecção de VIAGENS — agrupa atividade do dia em viagens lógicas.
// Algoritmo (desenhado pelo João, abr/2026):
//   - Detecta INÍCIO de viagem quando o caminhão começa a se mover
//   - Filtra falso positivo: viagens < 3 km ou < 5 min são descartadas
//   - Continuidade: parou < 4h → mesma viagem (almoço, abastecimento, espera)
//   - Parou >= 4h → avalia 3 condições de fim:
//       1) Voltou ao ponto inicial (raio 1 km)
//       2) Distância total < 3 km (não saiu mesmo)
//       3) Ficou parado no destino > 1h (destino estável)
//     Se alguma for verdadeira → fim da viagem. Senão → continua.
// =========================================================================
const RAIO_RETORNO_KM     = 1.0   // raio (km) pra "voltou ao início"
const PARADA_LONGA_MIN    = 240   // parada >= 4h dispara avaliação de fim
const DESTINO_ESTAVEL_MIN = 60    // parada >= 1h num lugar = destino
const VIAGEM_MIN_KM       = 3     // viagens menores que isso são lixo
const VIAGEM_MIN_DUR_MIN  = 5     // viagens curtas demais são lixo
const PARADA_REGISTRO_MIN = 10    // paradas curtas (>= 10min) viram evento

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

// "YYYY-MM-DD" em Brasília
function dataBrasilia(d = new Date()) {
  const ms = d.getTime() + (-3) * 3600_000
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
    // Busca mensagens do dia (desde 00:00 hoje, fuso de Brasília)
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const desde = hoje.toISOString()

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

      return {
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
        diario: montarDiario(minhasMsgs, ag.paradoMin),
        viagens: detectarViagens(minhasMsgs),
      }
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

    return res.status(200).json({
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
    })
  } catch (err) {
    console.error('Erro em /api/dados:', err)
    return res.status(500).json({ erro: err.message })
  }
}
