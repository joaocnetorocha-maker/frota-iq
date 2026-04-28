// dadosBeta.js — Modo demonstração FrotaIQ
// Gera dados simulados realistas que variam conforme a hora do dia.
// USO: apenas para mostrar o protótipo a potenciais clientes enquanto
// a API ONIXSAT não está liberada. Quando a API real chegar, criar
// `dadosReais.js` com a mesma forma e trocar o import no App.jsx.

const veiculosBase = [
  { placa:'ONA-0964', carreta:'BUP-3259', motorista:'Alexandre F.',     frota:'59977', perfil:'ruim'  },
  { placa:'EPU-6518', carreta:'FUY-8940', motorista:'Jose Claudio S.',  frota:'50400', perfil:'medio' },
  { placa:'BRY-8J52', carreta:'DBC-5C58', motorista:'Marcos Barros',    frota:'52528', perfil:'bom'   },
  { placa:'DEI-3F49', carreta:'FFF-6476', motorista:'Jose Wilson',      frota:'52555', perfil:'medio' },
  { placa:'FRY-8849', carreta:'FDB-7457', motorista:'Clodoaldo P.',     frota:'52742', perfil:'bom'   },
  { placa:'FME-3030', carreta:'IGO-9738', motorista:'Fabiano Barros',   frota:'52787', perfil:'medio' },
  { placa:'BYJ-8J52', carreta:'BTB-3706', motorista:'Claudio Cordeiro', frota:'52799', perfil:'bom'   },
  { placa:'FPQ-7910', carreta:'CWQ-3781', motorista:'Fabio Alexandre',  frota:'52902', perfil:'medio' },
  { placa:'BPO-8J52', carreta:'BWS-3510', motorista:'Helio Virgens',    frota:'58513', perfil:'medio' },
  { placa:'MIH-9D87', carreta:'DVT-5536', motorista:'Vagner Alves',     frota:'58516', perfil:'ruim'  },
  { placa:'FRV-7030', carreta:'CYN-9548', motorista:'Jose Sidney',      frota:'58588', perfil:'bom'   },
  { placa:'FDB-1A70', carreta:'BXF-4030', motorista:'Franklin Costa',   frota:'59975', perfil:'medio' },
  { placa:'GUX-1032', carreta:'BWS-3032', motorista:'Icaro',            frota:'21366', perfil:'medio' },
]

// Hash determinístico — mesma placa + mesmo dia gera os mesmos números.
// Assim a UI não fica "tremendo" a cada re-render.
function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}
function rng(seed, offset = 0) {
  return ((seed + offset * 2654435761) >>> 0) % 1000 / 1000
}

const ROTAS = [
  'SP → Campinas',
  'SP → Santos',
  'SP → São José dos Campos',
  'SP → Sorocaba',
  'SP → Ribeirão Preto',
  'Local — Grande SP',
]

function gerarVeiculo(base, agora) {
  const hora = agora.getHours()
  const dia = agora.toDateString()
  const seed = hash(base.placa + dia)

  // Perfil define a "agressividade" do desperdício
  const multPerfil = base.perfil === 'ruim' ? 18 : base.perfil === 'medio' ? 6 : 1.5
  const probIgnicao = base.perfil === 'ruim' ? 0.85 : base.perfil === 'medio' ? 0.7 : 0.6

  // Ignição mais provável dentro do expediente (6h–19h)
  const dentroExpediente = hora >= 6 && hora < 19
  const ignicao = dentroExpediente && rng(seed, 1) < probIgnicao

  // Velocidade só faz sentido com motor ligado
  const vel = ignicao ? Math.floor(rng(seed, 2) * 80) : 0

  // Marcha lenta acumulada cresce com as horas decorridas no dia
  const horasDecorridas = Math.max(0, hora - 6)
  let paradoMin = Math.floor(horasDecorridas * multPerfil * (0.7 + rng(seed, 3) * 0.6))

  // Sexta-feira tende a ser pior (padrão real de operação)
  if (agora.getDay() === 5) paradoMin = Math.floor(paradoMin * 1.3)

  // Perda em R$: paradoHoras × consumo (3,5 L/h) × diesel (R$ 6,50)
  const perdaHoje = Math.round((paradoMin / 60) * 3.5 * 6.50 * 100) / 100

  // === Excesso de velocidade ===
  // Limite considerado: 90 km/h (rodovia). Pico do dia + minutos acima.
  const limiteVel = 90
  const probExcesso = base.perfil === 'ruim' ? 0.75 : base.perfil === 'medio' ? 0.4 : 0.15
  const teveExcesso = ignicao && rng(seed, 8) < probExcesso
  const velMax = ignicao
    ? Math.floor(75 + rng(seed, 9) * (base.perfil === 'ruim' ? 40 : base.perfil === 'medio' ? 22 : 12))
    : 0
  const excessoVelMin = teveExcesso
    ? Math.floor(rng(seed, 10) * (base.perfil === 'ruim' ? 28 : base.perfil === 'medio' ? 12 : 4)) + 1
    : 0

  // === KM fora da rota ===
  // Quanto o veículo se desviou do trajeto planejado no dia (km).
  const kmDesvio = ignicao
    ? Math.floor(rng(seed, 11) * (base.perfil === 'ruim' ? 38 : base.perfil === 'medio' ? 14 : 4))
    : 0

  // === Score composto 0–100 ===
  // Fonte única de verdade pra status visual. Pondera 3 dimensões:
  //   - marcha lenta: peso forte (problema crônico, custo direto)
  //   - excesso de velocidade: peso médio (multas, desgaste, segurança)
  //   - desvio de rota: peso leve (combustível, prazo, segurança)
  // Score = 95 - paradoMin × 0.55 - excessoVelMin × 0.9 - kmDesvio × 0.4
  const score = Math.max(0, Math.min(100, Math.round(
    95 - paradoMin * 0.55 - excessoVelMin * 0.9 - kmDesvio * 0.4
  )))

  // Status do card vem do score pra cor do dot bater com o número exibido:
  //   score 80+      → verde   (Normal)
  //   score 60–79    → amarelo (Atenção)
  //   score < 60     → vermelho (Crítico)
  let status, statusTxt
  if (score < 60)      { status = 'vermelho'; statusTxt = 'Crítico' }
  else if (score < 80) { status = 'amarelo';  statusTxt = 'Atenção' }
  else                 { status = 'verde';    statusTxt = 'Normal'  }

  const km = ignicao
    ? `${Math.floor(rng(seed, 4) * 350 + 80)} km`
    : `${Math.floor(rng(seed, 4) * 150)} km`

  const perdaSemana = Math.round(perdaHoje * (4 + rng(seed, 5) * 2))

  const horasParado = Math.floor(paradoMin / 60)
  const minParado   = paradoMin % 60
  const parado = paradoMin === 0
    ? '0 min'
    : horasParado > 0
      ? `${horasParado}h ${minParado}min`
      : `${minParado} min`

  // Alertas só pra amarelo/vermelho
  let alertaTipo = null, alertaTitulo = '', alertaDesc = ''
  if (status === 'vermelho') {
    alertaTipo = 'critico'
    alertaTitulo = `Marcha lenta acima do limite — ${parado}`
    alertaDesc   = `Veículo parado com motor ligado por mais de 1h. Perda estimada: R$ ${perdaHoje.toFixed(2)}`
  } else if (status === 'amarelo') {
    alertaTipo = 'atencao'
    alertaTitulo = `Marcha lenta moderada — ${parado}`
    alertaDesc   = `Acima da média esperada para o horário. Recomenda-se acompanhar evolução.`
  }

  const rota = ignicao ? ROTAS[Math.floor(rng(seed, 6) * ROTAS.length)] : '—'

  const diario = gerarDiario(base, agora, paradoMin, ignicao, seed)

  return {
    ...base,
    status, statusTxt,
    vel: `${vel} km/h`,
    velMax, limiteVel, excessoVelMin,
    kmDesvio,
    ignicao,
    parado, paradoMin,
    perdaHoje, perdaSemana,
    km,
    alertaTipo, alertaTitulo, alertaDesc,
    modelo: 'Cavalo',
    rota,
    diario,
  }
}

function gerarDiario(base, agora, paradoMin, ignicao, seed) {
  const hora = agora.getHours()
  const eventos = []

  if (hora >= 6) {
    eventos.push({
      h: '06:00', cor: '#1D9E75',
      ev: 'Ignição ligada — saída da garagem',
      det: `Motorista: ${base.motorista}`
    })
  }

  if (hora >= 7 && base.perfil === 'ruim') {
    eventos.push({
      h: '07:42', cor: '#D85A30',
      ev: 'Marcha lenta detectada',
      det: '12 min parado com motor ligado'
    })
  }

  if (hora >= 9) {
    const velMedia = 50 + Math.floor(rng(seed, 7) * 30)
    eventos.push({
      h: '09:15', cor: '#1D9E75',
      ev: 'Em rota',
      det: `Velocidade média: ${velMedia} km/h`
    })
  }

  if (hora >= 12) {
    eventos.push({
      h: '12:30', cor: '#FFC107',
      ev: 'Parada para refeição',
      det: '45 min — motor desligado'
    })
  }

  if (hora >= 14 && base.perfil !== 'bom') {
    eventos.push({
      h: '14:18', cor: '#D85A30',
      ev: 'Marcha lenta acumulada',
      det: `${Math.floor(paradoMin / 2)} min no dia`
    })
  }

  if (hora >= 16) {
    eventos.push({
      h: '16:00', cor: '#1D9E75',
      ev: 'Em rota — retorno',
      det: 'Rumo à garagem'
    })
  }

  if (ignicao && hora >= 17) {
    eventos.push({
      h: 'agora', cor: '#1D9E75',
      ev: 'Em rota',
      det: 'Última atualização há poucos minutos'
    })
  }

  return eventos.length > 0
    ? eventos
    : [{ h: '—', cor: '#888', ev: 'Sem eventos no momento', det: 'Veículo na garagem' }]
}

// === API pública do módulo ===

export function getVeiculosBeta() {
  const agora = new Date()
  return veiculosBase.map(b => gerarVeiculo(b, agora))
}

// Gera resumo agregado da semana — usado na tela Relatório.
// Distribui a perda pelos dias da semana com padrão realista
// (Sex pior, Dom zerado, etc) e calcula viagens, KM, perda total.
//
// Aceita um filtro opcional `frotaFiltro` (string com o número da frota,
// ou 'Todas' pra agregar tudo). Quando vem uma frota específica, todos os
// totais (perda, KM, viagens) ficam restritos a esse veículo.
export function getResumoSemanaBeta(frotaFiltro = 'Todas') {
  const agora = new Date()
  const todos = veiculosBase.map(b => gerarVeiculo(b, agora))
  const veiculos = frotaFiltro === 'Todas'
    ? todos
    : todos.filter(v => v.frota === frotaFiltro)

  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

  // Sem veículos no filtro: devolve resumo zerado (UI mostra graciosamente)
  if (veiculos.length === 0) {
    return {
      dias: labels.map(d => ({ dia: d, valor: 0 })),
      perdaSemana: 0,
      mediaPorVeiculo: 0,
      kmTotalSemana: 0,
      totalViagens: 0,
      veiculos: [],
    }
  }

  // Pesos por dia da semana (Seg=0 ... Dom=6)
  // Sex tipicamente é o pior dia, Dom não trabalha
  const pesosDia = [0.85, 0.95, 1.0, 1.05, 1.30, 0.45, 0.0]

  const perdaDiariaBase = veiculos.reduce((s, v) => s + v.perdaHoje, 0)

  const dias = labels.map((label, i) => {
    const seed = hash(label + agora.toDateString() + frotaFiltro)
    const variacao = 0.85 + rng(seed, 1) * 0.3   // ±15% de ruído
    const valor = Math.round(perdaDiariaBase * pesosDia[i] * variacao)
    return { dia: label, valor }
  })

  const perdaSemana = dias.reduce((s, d) => s + d.valor, 0)
  const mediaPorVeiculo = Math.round(perdaSemana / veiculos.length)

  // KM total da semana: cada veículo roda ~5x KM/dia em média (5 dias úteis)
  const kmTotalSemana = veiculos.reduce((s, v) => {
    const km = parseInt(String(v.km).replace(/\D/g, '')) || 0
    return s + km * 5
  }, 0)

  // Viagens: ~2,5 por veículo por dia útil em média
  const totalViagens = Math.round(veiculos.length * 5 * 2.5)

  return { dias, perdaSemana, mediaPorVeiculo, kmTotalSemana, totalViagens, veiculos }
}

// Toggle do modo beta:
//   ?beta=on  → ativa e salva no navegador
//   ?beta=off → desativa e remove do navegador
//   sem param → respeita o que estiver salvo
export function isBetaAtivo() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('beta') === 'on') {
      window.localStorage.setItem('frotaiq_beta', '1')
      return true
    }
    if (params.get('beta') === 'off') {
      window.localStorage.removeItem('frotaiq_beta')
      return false
    }
    return window.localStorage.getItem('frotaiq_beta') === '1'
  } catch (e) {
    return false
  }
}
