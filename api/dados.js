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
          diario: [{ h: '—', cor: '#888', ev: 'Snapshot fechado do dia', det: dataConsulta }],
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

    const { data: msgs, error: errMsg } = await supabase
      .from('mensagens_cb')
      .select('vei_id, dt, lat, lon, mun, uf, vel, evt4, evt34, evt54, evt16, evt17, odm, mot')
      .gte('dt', desde)
      .order('dt', { ascending: false })
      .limit(50000)

    if (errMsg) throw new Error('Erro ao buscar mensagens: ' + errMsg.message)

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
      const ultima = minhasMsgs[0]   // mais recente (já ordenado desc)
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
        diario: [
          {
            h: new Date(ultima.dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            cor: ultima.evt4 === 1 ? '#1D9E75' : '#888',
            ev: ultima.evt4 === 1 ? 'Em rota' : 'Parado',
            det: `${ultima.mun || '—'}/${ultima.uf || '—'} · ${Math.round(ultima.vel || 0)} km/h`,
          }
        ],
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
