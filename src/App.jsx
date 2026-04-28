import { useState, useMemo, useEffect } from 'react'
import './App.css'
import { getVeiculosBeta, getResumoSemanaBeta, isBetaAtivo } from './dadosBeta'

const veiculosVazios = [
  { placa:'ONA-0964', carreta:'BUP-3259', motorista:'Alexandre F.', frota:'59977', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'EPU-6518', carreta:'FUY-8940', motorista:'Jose Claudio S.', frota:'50400', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'BRY-8J52', carreta:'DBC-5C58', motorista:'Marcos Barros', frota:'52528', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'DEI-3F49', carreta:'FFF-6476', motorista:'Jose Wilson', frota:'52555', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'FRY-8849', carreta:'FDB-7457', motorista:'Clodoaldo P.', frota:'52742', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'FME-3030', carreta:'IGO-9738', motorista:'Fabiano Barros', frota:'52787', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'BYJ-8J52', carreta:'BTB-3706', motorista:'Claudio Cordeiro', frota:'52799', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'FPQ-7910', carreta:'CWQ-3781', motorista:'Fabio Alexandre', frota:'52902', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'BPO-8J52', carreta:'BWS-3510', motorista:'Helio Virgens', frota:'58513', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'MIH-9D87', carreta:'DVT-5536', motorista:'Vagner Alves', frota:'58516', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'FRV-7030', carreta:'CYN-9548', motorista:'Jose Sidney', frota:'58588', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'FDB-1A70', carreta:'BXF-4030', motorista:'Franklin Costa', frota:'59975', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
  { placa:'GUX-1032', carreta:'BWS-3032', motorista:'Icaro', frota:'21366', status:'verde', statusTxt:'Normal', vel:'0 km/h', ignicao:false, parado:'0 min', paradoMin:0, perdaHoje:0, km:'0 km', perdaSemana:0, alertaTipo:null, alertaTitulo:'', alertaDesc:'', modelo:'Cavalo', rota:'—', diario:[{h:'—',cor:'#1D9E75',ev:'Aguardando dados reais do ONIXSAT',det:'Conectar API para carregar histórico'}]},
]

const semana = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']

export default function App() {
  const [tela, setTela] = useState('painel')
  const [frotaFiltro, setFrotaFiltro] = useState('Todas')
  const [selecionado, setSelecionado] = useState(0)
  const [config, setConfig] = useState({
    consumoParado: 3.5,
    precoDiesel: 6.50,
    minMarcha: 5,
    nomeEmpresa: 'Minha Transportadora'
  })
  const [configTemp, setConfigTemp] = useState(config)
  const [salvo, setSalvo] = useState(false)
  const [beta] = useState(() => isBetaAtivo())
  const [agora, setAgora] = useState(() => new Date())

  // Atualiza data/hora a cada minuto e (no modo beta) força re-render dos dados simulados
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Fonte de dados: beta = simulado vivo / off = vazio aguardando ONIXSAT
  const veiculos = useMemo(
    () => (beta ? getVeiculosBeta() : veiculosVazios),
    [beta, agora]
  )

  // Resumo semanal pra tela Relatório — respeita o filtro de frota
  // (quando a frota é específica, todos os totais ficam restritos a ela)
  const resumoSemana = useMemo(
    () => (beta ? getResumoSemanaBeta(frotaFiltro) : null),
    [beta, agora, frotaFiltro]
  )

  const visiveis = veiculos.filter(v => frotaFiltro === 'Todas' || v.frota === frotaFiltro)

  // === Plano de Ação ===
  // Score 0–100 por motorista derivado do tempo em marcha lenta.
  // Quanto mais minutos parados com motor ligado, menor o score.
  const planoAcao = useMemo(() => {
    const calcScore = (paradoMin) =>
      Math.max(0, Math.min(100, Math.round(95 - paradoMin * 0.85)))

    const iniciaisDe = (nome) =>
      nome.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()

    const sugestao = (v) => {
      const primNome = v.motorista.split(' ')[0]
      // VERMELHO / CRÍTICO — score abaixo de 40
      if (v.score < 40) {
        return {
          nivel: 'critico',
          oQue: `Marcha lenta de ${v.parado} hoje. Perda projetada: R$ ${(v.perdaSemana * 4).toLocaleString('pt-BR')}/mês se o padrão continuar.`,
          acao: `Conversar HOJE com ${primNome} sobre desligar o motor em esperas e descargas. Reduzir 50% recupera cerca de R$ ${Math.round(v.perdaSemana * 2).toLocaleString('pt-BR')} no mês.`,
          exemplo: `Ex: "${primNome}, vi que ontem o motor ficou ligado ${v.parado} parado. Cada hora dessas custa cerca de R$ ${Math.round(3.5 * 6.5).toLocaleString('pt-BR')} de diesel. Combinamos de desligar sempre que parar mais de 5min?"`,
        }
      }
      // AMARELO ALTO — score entre 40 e 59
      if (v.score < 60) {
        return {
          nivel: 'atencao',
          oQue: `Tempo parado com motor ligado: ${v.parado}. Está acima da média da frota nesta semana.`,
          acao: `Acompanhar ${primNome} ao longo da semana. Alinhar boas práticas em paradas e dar feedback positivo se melhorar.`,
          exemplo: `Ex: "${primNome}, percebi que essa semana subiu um pouco o tempo parado com motor ligado. Tá tudo ok? Algum problema operacional ou cliente demorando? Se for hábito, vamos trabalhar pra reduzir."`,
        }
      }
      // AMARELO BAIXO — score entre 60 e 79
      if (v.score < 80) {
        return {
          nivel: 'observar',
          oQue: `Aumento leve de marcha lenta nesta semana (${v.parado}). Ainda dentro do aceitável, mas vale observar.`,
          acao: `Reforçar com ${primNome} a importância de desligar em paradas longas. Não exige conversa formal — pode ser no rádio mesmo.`,
          exemplo: `Ex: "${primNome}, beleza? Só um lembrete pra desligar o motor sempre que parar mais de 5min, tá? Tá indo bem, é só pra manter."`,
        }
      }
      // VERDE — score 80+
      return {
        nivel: 'ok',
        oQue: `Excelente desempenho esta semana. ${v.parado === '0 min' ? 'Sem marcha lenta registrada.' : `Apenas ${v.parado} de marcha lenta no dia.`}`,
        acao: `Manter o padrão. ${primNome} é referência de boa condução — vale reconhecer.`,
        exemplo: `Ex: "${primNome}, parabéns pelos números dessa semana. Você tá entre os melhores da frota em consumo. Continua assim!"`,
      }
    }

    const comScore = visiveis.map(v => {
      const score = calcScore(v.paradoMin)
      const base = { ...v, score, iniciais: iniciaisDe(v.motorista) }
      const sug = sugestao(base)
      return { ...base, ...sug }
    })

    const piorPrimeiro = [...comScore].sort((a, b) => a.score - b.score)
    const melhorPrimeiro = [...comScore].sort((a, b) => b.score - a.score)

    const dentroMeta = comScore.filter(v => v.score >= 80).length
    const scoreMedio = comScore.length === 0
      ? 0
      : Math.round(comScore.reduce((s, v) => s + v.score, 0) / comScore.length)
    const economiaSemana = Math.round(
      comScore.filter(v => v.status === 'verde').reduce((s, v) => s + v.perdaSemana * 0.4, 0)
    )

    // Lookup por placa pra buscar o plano de ação de qualquer veículo selecionado
    const porPlaca = {}
    comScore.forEach(c => { porPlaca[c.placa] = c })

    return {
      prioridades: piorPrimeiro.filter(v => v.score < 80).slice(0, 3),
      ranking: melhorPrimeiro,
      porPlaca,
      dentroMeta,
      scoreMedio,
      economiaSemana,
      total: comScore.length,
    }
  }, [visiveis])
  const v = veiculos[selecionado]
  const perdaTotal = visiveis.reduce((s, v) => s + v.perdaHoje, 0)
  const alertas = visiveis.filter(v => v.status !== 'verde').length
  const criticos = visiveis.filter(v => v.status === 'vermelho').length
  const amarelos = visiveis.filter(v => v.status === 'amarelo').length
  const ranking = [...visiveis].sort((a, b) => b.perdaSemana - a.perdaSemana).slice(0, 5)
  const maxPerda = ranking[0]?.perdaSemana || 1
  const projecaoMensal = Math.round(perdaTotal * 30)
  const economiaPotencial = Math.round(projecaoMensal * 0.6)

  const calcPerda = (min) => {
    const horas = min / 60
    return Math.round(horas * config.consumoParado * config.precoDiesel * 100) / 100
  }

  const salvarConfig = () => {
    setConfig({
      ...configTemp,
      precoDiesel: typeof configTemp.precoDiesel === 'number' ? configTemp.precoDiesel : parseInt(String(configTemp.precoDiesel).replace(/\D/g,'')) / 100,
consumoParado: typeof configTemp.consumoParado === 'number' ? configTemp.consumoParado : parseInt(String(configTemp.consumoParado).replace(/\D/g,'')) / 10,
    })
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  const formataDiesel = (val) => {
    const nums = String(Math.round(val * 100)).padStart(3,'0')
    const inteiro = nums.slice(0,-2).replace(/^0+/,'') || '0'
    return `${inteiro},${nums.slice(-2)}`
  }

  const formataConsumo = (val) => {
    const nums = String(Math.round(val * 10)).padStart(2,'0')
    const inteiro = nums.slice(0,-1).replace(/^0+/,'') || '0'
    return `${inteiro},${nums.slice(-1)}`
  }

  const frotas = ['Todas', ...new Set(veiculos.map(v => v.frota))]

  const dataHoraTxt = agora.toLocaleString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).replace(',', ' —')

  return (
    <div className="app">
      {beta && (
        <div style={{
          background: '#FFF4D6',
          borderBottom: '1px solid #E8B923',
          color: '#7A5A00',
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center',
          letterSpacing: '0.3px',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}>
          VISUALIZAÇÃO COM DADOS DE DEMONSTRAÇÃO · INTEGRAÇÃO ONIXSAT EM ANDAMENTO
        </div>
      )}
      <div className="topo">
        <div className="logo">frota<span>IQ</span></div>
        <nav className="nav">
          <button className={`nav-btn ${tela === 'painel' ? 'ativo' : ''}`} onClick={() => setTela('painel')}>Painel</button>
          <button className={`nav-btn ${tela === 'relatorio' ? 'ativo' : ''}`} onClick={() => setTela('relatorio')}>Relatório</button>
          <button className={`nav-btn ${tela === 'config' ? 'ativo' : ''}`} onClick={() => setTela('config')}>Configurações</button>
        </nav>
        <div className="data-hora">{dataHoraTxt}</div>
      </div>

      {(tela === 'painel' || tela === 'relatorio') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 0 18px',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
            Filtrar por frota:
          </span>
          <select
            value={frotaFiltro}
            onChange={(e) => setFrotaFiltro(e.target.value)}
            style={{
              padding: '8px 32px 8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: '#1a1a1a',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              minWidth: 200,
            }}
          >
            {frotas.map(f => (
              <option key={f} value={f}>
                {f === 'Todas' ? 'Todas as frotas' : `Frota ${f}`}
              </option>
            ))}
          </select>
          {frotaFiltro !== 'Todas' && (
            <button
              onClick={() => setFrotaFiltro('Todas')}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                color: '#666',
                background: 'transparent',
                border: '1px solid #ddd',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Limpar filtro
            </button>
          )}
          <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
            {tela === 'relatorio' ? 'Relatório de' : 'Mostrando'} {visiveis.length} {visiveis.length === 1 ? 'veículo' : 'veículos'}
          </span>
        </div>
      )}

      {tela === 'painel' && (
        <>
          {/* 3 KPIs principais — o que importa pro gestor saber em 5 segundos */}
          <div className="resumo-grid" style={{gridTemplateColumns:'repeat(3, 1fr)', marginBottom:'1.25rem'}}>
            <div className="metrica">
              <div className="metrica-label">Perda estimada hoje</div>
              <div className="metrica-valor alerta">R$ {perdaTotal.toLocaleString('pt-BR')}</div>
              <div className="metrica-sub">projeção mês: R$ {projecaoMensal.toLocaleString('pt-BR')}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Em rota agora</div>
              <div className="metrica-valor">{visiveis.filter(v => v.ignicao).length}<span style={{fontSize:18, color:'#888', fontWeight:400}}> / {visiveis.length}</span></div>
              <div className="metrica-sub">{alertas} {alertas === 1 ? 'alerta' : 'alertas'} ativo{alertas !== 1 ? 's' : ''}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Score médio da frota</div>
              <div className="metrica-valor" style={{color: planoAcao.scoreMedio >= 80 ? '#1D9E75' : planoAcao.scoreMedio >= 60 ? '#E8B923' : '#D85A30'}}>{planoAcao.scoreMedio}</div>
              <div className="metrica-sub">{planoAcao.dentroMeta} de {planoAcao.total} na meta</div>
            </div>
          </div>

          {/* Prioridade da semana — só aparece se tem alguém pra acompanhar */}
          {planoAcao.prioridades[0] && (() => {
            const p = planoAcao.prioridades[0]
            const corBadge = p.score < 40 ? '#D85A30' : p.score < 60 ? '#E8B923' : '#1D9E75'
            return (
              <div className="card-box" style={{
                border: `2px solid ${corBadge}`,
                marginBottom: '1.25rem',
                padding: '18px 22px',
              }}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, flexWrap:'wrap'}}>
                  <span style={{
                    background: corBadge + '22',
                    color: corBadge,
                    fontSize: 11,
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>Prioridade da semana</span>
                  <span style={{fontSize:13, color:'#666'}}>Maior oportunidade de economia</span>
                </div>

                <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:14}}>
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%',
                    background: corBadge + '22',
                    color: corBadge,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, fontSize: 15,
                    flexShrink: 0,
                  }}>{p.iniciais}</div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:16, fontWeight:600}}>{p.motorista}</div>
                    <div style={{fontSize:12, color:'#666', marginTop:2}}>
                      Veículo {p.placa} · Frota {p.frota}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:28, fontWeight:600, lineHeight:1, color:corBadge}}>{p.score}</div>
                    <div style={{fontSize:10, color:'#888', marginTop:2}}>de 100</div>
                  </div>
                </div>

                <div style={{fontSize:13, lineHeight:1.55, color:'#444', marginBottom:14}}>
                  <strong style={{color:'#1a1a1a'}}>Ação sugerida:</strong> {p.acao}
                </div>

                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  <button
                    onClick={() => alert(`Conversa com ${p.motorista} marcada como feita!`)}
                    style={{
                      flex:'1 1 180px', padding:'10px 14px', fontSize:13, fontWeight:500,
                      background:'#1a1a1a', color:'#fff', border:'none', borderRadius:8,
                      cursor:'pointer',
                    }}
                  >
                    Marcar como conversado
                  </button>
                  <button
                    onClick={() => {
                      const msg = `Olá ${p.motorista.split(' ')[0]}, notei que essa semana o tempo de marcha lenta tá acima da média. Bora alinhar amanhã? Em horários de espera e descarga, sempre desligar o motor reduz nosso custo de combustível bastante. Valeu!`
                      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                    }}
                    style={{
                      flex:'1 1 180px', padding:'10px 14px', fontSize:13, fontWeight:500,
                      background:'#fff', color:'#1a1a1a', border:'1px solid #ddd', borderRadius:8,
                      cursor:'pointer',
                    }}
                  >
                    Mandar WhatsApp
                  </button>
                </div>
              </div>
            )
          })()}

          {planoAcao.prioridades.length === 0 && planoAcao.total > 0 && (
            <div className="card-box" style={{marginBottom:'1.25rem', borderLeft:'4px solid #1D9E75', padding:'14px 18px'}}>
              <div style={{fontSize:14, fontWeight:600, color:'#0F6E56'}}>
                Frota toda dentro da meta nesta semana.
              </div>
              <div style={{fontSize:12, color:'#666', marginTop:4}}>
                Nenhum motorista exige conversa imediata. Continue acompanhando os indicadores.
              </div>
            </div>
          )}

          {/* Status da frota — cards de veículos, ordenados por score (pior primeiro) */}
          <div className="secao-titulo">Status da frota</div>
          <div className="legenda">
            <span className="leg-item"><span className="dot verde"></span>Normal</span>
            <span className="leg-item"><span className="dot amarelo"></span>Atenção</span>
            <span className="leg-item"><span className="dot vermelho"></span>Crítico</span>
          </div>
          <div className="frota-grid">
            {[...visiveis].sort((a, b) => {
              const sa = planoAcao.ranking.find(r => r.placa === a.placa)?.score ?? 95
              const sb = planoAcao.ranking.find(r => r.placa === b.placa)?.score ?? 95
              return sa - sb
            }).map((ve) => {
              const idx = veiculos.indexOf(ve)
              const score = planoAcao.ranking.find(r => r.placa === ve.placa)?.score ?? 95
              const corScore = score >= 80 ? '#1D9E75' : score >= 60 ? '#E8B923' : '#D85A30'
              return (
                <div
                  key={ve.placa}
                  className={`card-veiculo ${ve.status} ${idx === selecionado ? 'selecionado' : ''}`}
                  onClick={() => setSelecionado(idx)}
                  style={{position: 'relative'}}
                >
                  {/* Score no canto superior direito */}
                  <div style={{
                    position: 'absolute', top: 10, right: 12,
                    fontSize: 16, fontWeight: 700, color: corScore,
                    lineHeight: 1,
                  }}>
                    {score}
                    <span style={{fontSize: 9, color: '#999', fontWeight: 400, marginLeft: 2}}>/100</span>
                  </div>
                  <div className="cv-placa">{ve.placa}</div>
                  <div className="cv-motorista">{ve.motorista}</div>
                  <div className="cv-carreta">Carreta: {ve.carreta}</div>
                  <div className="cv-status">
                    <span className={`dot ${ve.status}`}></span>
                    <span className="cv-status-txt">{ve.statusTxt}</span>
                  </div>
                  <div className={`ignicao ${ve.ignicao ? 'on' : 'off'}`}>
                    {ve.ignicao ? '● ligada' : '○ desligada'}
                  </div>
                  {ve.paradoMin > 0 && (
                    <div style={{
                      fontSize: 11, color: '#888', marginTop: 6,
                      paddingTop: 6, borderTop: '1px solid #eee',
                    }}>
                      Parado: <strong style={{color: '#1a1a1a'}}>{ve.parado}</strong> · Perda hoje: <strong style={{color: '#D85A30'}}>R$ {calcPerda(ve.paradoMin).toFixed(0)}</strong>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Detalhe do veículo selecionado — só aparece se há um veículo selecionado e ele está no filtro */}
          {visiveis.includes(v) && (
            <>
              <div className="detalhe-painel">
                <div className="det-topo">
                  <div><div className="det-titulo">{v.placa} · Carreta {v.carreta}</div><div className="det-sub">Motorista: {v.motorista} · Frota: {v.frota}</div></div>
                  <span className={`badge ${v.status}`}>{v.statusTxt}</span>
                </div>
                <div className="det-grid">
                  <div className="det-item"><div className="det-label">Velocidade atual</div><div className="det-valor">{v.vel}</div></div>
                  <div className="det-item"><div className="det-label">Ignição</div><div className={`det-valor ${v.ignicao ? 'alerta' : ''}`}>{v.ignicao ? 'Ligada' : 'Desligada'}</div></div>
                  <div className="det-item"><div className="det-label">Tempo parado ligado</div><div className="det-valor alerta">{v.parado}</div></div>
                  <div className="det-item"><div className="det-label">Perda estimada</div><div className="det-valor alerta">R$ {calcPerda(v.paradoMin).toFixed(2)}</div></div>
                </div>
                {v.alertaTipo && (
                  <div className={`alerta-box ${v.alertaTipo}`}>
                    <div className="alerta-icone">⚠</div>
                    <div><div className="alerta-titulo">{v.alertaTitulo}</div><div className="alerta-desc">{v.alertaDesc}</div></div>
                  </div>
                )}

                {/* Plano de ação específico desse motorista — sempre aparece, com tom variando pelo score */}
                {planoAcao.porPlaca[v.placa] && (() => {
                  const p = planoAcao.porPlaca[v.placa]
                  const cor = p.score >= 80 ? '#1D9E75' : p.score >= 60 ? '#E8B923' : p.score >= 40 ? '#E89923' : '#D85A30'
                  const fundo = p.score >= 80 ? '#F0F8F4' : p.score >= 60 ? '#FFFAEB' : p.score >= 40 ? '#FFF4E5' : '#FDEBE3'
                  const titulo = p.nivel === 'critico' ? 'Ação imediata necessária'
                              : p.nivel === 'atencao' ? 'Atenção — acompanhar'
                              : p.nivel === 'observar' ? 'Observação — leve aumento'
                              : 'Reconhecimento — bom desempenho'
                  return (
                    <div style={{
                      background: fundo,
                      borderLeft: `4px solid ${cor}`,
                      borderRadius: 6,
                      padding: '14px 18px',
                      marginTop: 14,
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: 10, flexWrap: 'wrap', gap: 8,
                      }}>
                        <div style={{fontSize: 13, fontWeight: 700, color: cor, textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                          Plano de ação · {titulo}
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                          <span style={{fontSize: 11, color: '#888'}}>Score</span>
                          <span style={{fontSize: 18, fontWeight: 700, color: cor}}>{p.score}</span>
                          <span style={{fontSize: 10, color: '#999'}}>/100</span>
                        </div>
                      </div>

                      <div style={{marginBottom: 10}}>
                        <div style={{fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4}}>
                          O que aconteceu
                        </div>
                        <div style={{fontSize: 13, lineHeight: 1.5, color: '#1a1a1a'}}>{p.oQue}</div>
                      </div>

                      <div style={{marginBottom: 10}}>
                        <div style={{fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4}}>
                          Ação sugerida
                        </div>
                        <div style={{fontSize: 13, lineHeight: 1.5, color: '#1a1a1a'}}>{p.acao}</div>
                      </div>

                      <div style={{
                        background: '#fff',
                        borderRadius: 6,
                        padding: '10px 12px',
                        marginBottom: 12,
                        borderLeft: `2px solid ${cor}`,
                      }}>
                        <div style={{fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4}}>
                          Exemplo de conversa
                        </div>
                        <div style={{fontSize: 12, lineHeight: 1.55, color: '#444', fontStyle: 'italic'}}>
                          {p.exemplo}
                        </div>
                      </div>

                      {p.nivel !== 'ok' ? (
                        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                          <button
                            onClick={() => alert(`Conversa com ${v.motorista} marcada como feita!`)}
                            style={{
                              flex: '1 1 160px', padding: '9px 12px', fontSize: 12, fontWeight: 500,
                              background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            Marcar como conversado
                          </button>
                          <button
                            onClick={() => {
                              const primNome = v.motorista.split(' ')[0]
                              const msg = p.nivel === 'critico'
                                ? `Olá ${primNome}, precisamos conversar sobre o consumo essa semana. Vi que o motor ficou ligado ${v.parado} parado. Bora alinhar amanhã pra reduzir? Cada hora de marcha lenta custa caro. Valeu!`
                                : p.nivel === 'atencao'
                                  ? `Olá ${primNome}, notei um aumento no tempo de marcha lenta essa semana (${v.parado}). Tá tudo ok aí? Algum problema operacional? Bora alinhar pra voltar pro padrão. Valeu!`
                                  : `Oi ${primNome}, só um lembrete rápido: tenta desligar o motor sempre que parar mais de 5min, beleza? Tá indo bem, é só pra manter o consumo baixo. Valeu!`
                              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                            }}
                            style={{
                              flex: '1 1 160px', padding: '9px 12px', fontSize: 12, fontWeight: 500,
                              background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            Mandar WhatsApp
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            const primNome = v.motorista.split(' ')[0]
                            const msg = `Oi ${primNome}, parabéns pela semana! Você tá entre os melhores da frota em consumo. Continua assim, tá fazendo a diferença. Valeu!`
                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                          style={{
                            width: '100%', padding: '9px 12px', fontSize: 12, fontWeight: 500,
                            background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          Mandar elogio no WhatsApp
                        </button>
                      )}
                    </div>
                  )
                })()}

                <div className="mapa-placeholder">Mapa da rota · {v.rota}</div>
              </div>

              <div className="secao-titulo" style={{marginBottom:'10px'}}>Diário do veículo — {v.placa} hoje</div>
              <div className="diario">
                {v.diario.map((d, i) => (
                  <div key={i} className="diario-linha">
                    <div className="d-hora">{d.h}</div>
                    <div className="d-dot" style={{background: d.cor}}></div>
                    <div><div className="d-evento">{d.ev}</div><div className="d-detalhe">{d.det}</div></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tela === 'relatorio' && (
        <>
          <div className="secao-titulo" style={{marginBottom:'1rem'}}>Resumo semanal da frota</div>
          <div className="resumo-grid" style={{marginBottom:'1.5rem'}}>
            <div className="metrica">
              <div className="metrica-label">Total de viagens</div>
              <div className="metrica-valor">{resumoSemana ? resumoSemana.totalViagens : '—'}</div>
              <div className="metrica-sub">{resumoSemana ? 'esta semana' : 'aguardando ONIXSAT'}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">KM total rodado</div>
              <div className="metrica-valor">{resumoSemana ? `${resumoSemana.kmTotalSemana.toLocaleString('pt-BR')} km` : '—'}</div>
              <div className="metrica-sub">{resumoSemana ? 'esta semana' : 'aguardando ONIXSAT'}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Perda total semana</div>
              <div className="metrica-valor alerta">R$ {resumoSemana ? resumoSemana.perdaSemana.toLocaleString('pt-BR') : '0'}</div>
              <div className="metrica-sub">em marcha lenta</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Média por veículo</div>
              <div className="metrica-valor alerta">R$ {resumoSemana ? resumoSemana.mediaPorVeiculo.toLocaleString('pt-BR') : '0'}</div>
              <div className="metrica-sub">por semana</div>
            </div>
          </div>

          <div className="card-box" style={{marginBottom:'1.5rem'}}>
            <div className="secao-titulo">Desempenho por dia — esta semana</div>
            <div className="grafico-semana">
              {(resumoSemana ? resumoSemana.dias : semana.map(d => ({dia: d, valor: 0}))).map((d, i) => {
                const max = resumoSemana ? Math.max(...resumoSemana.dias.map(x => x.valor), 1) : 1
                const altura = resumoSemana ? Math.max(4, Math.round((d.valor / max) * 100)) : 4
                const isHoje = i === ((new Date().getDay() + 6) % 7) // converte Dom=0 → Seg=0
                return (
                  <div key={d.dia} className="grafico-col">
                    <div className="grafico-barra-wrap" style={{height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>
                      <div
                        className="grafico-barra"
                        style={{
                          height: `${altura}px`,
                          width: '70%',
                          background: d.valor === 0 ? '#f0f0f0' : (isHoje ? '#1D9E75' : '#D85A30'),
                          borderRadius: '4px 4px 0 0',
                          transition: 'height .3s ease',
                        }}
                      ></div>
                    </div>
                    <div className="grafico-label" style={{fontWeight: isHoje ? 600 : 400}}>{d.dia}</div>
                    <div className="grafico-valor">R$ {d.valor.toLocaleString('pt-BR')}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card-box">
            <div className="secao-titulo">
              {frotaFiltro === 'Todas'
                ? 'Relatório por veículo — semana'
                : `Relatório do veículo — Frota ${frotaFiltro}`}
            </div>
            {visiveis.length === 0 ? (
              <div className="vazio">Nenhum veículo corresponde ao filtro</div>
            ) : (
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cavalo</th>
                    <th>Carreta</th>
                    <th>Motorista</th>
                    <th>KM rodado</th>
                    <th>Tempo parado</th>
                    <th>Perda estimada</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(ve => (
                    <tr key={ve.placa}>
                      <td className="td-placa">{ve.placa}</td>
                      <td>{ve.carreta}</td>
                      <td>{ve.motorista}</td>
                      <td>{ve.km}</td>
                      <td>{ve.parado}</td>
                      <td className="td-perda">R$ {calcPerda(ve.paradoMin).toFixed(2)}</td>
                      <td><span className={`badge ${ve.status}`}>{ve.statusTxt}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tela === 'config' && (
        <>
          <div className="secao-titulo" style={{marginBottom:'1rem'}}>Configurações da operação</div>
          <div className="dois-col">
            <div className="card-box">
              <div className="secao-titulo">Parâmetros de cálculo</div>
              <div className="config-item">
                <label className="config-label">Nome da empresa</label>
                <input className="config-input" value={configTemp.nomeEmpresa} onChange={e => setConfigTemp({...configTemp, nomeEmpresa: e.target.value})} />
              </div>
              <div className="config-item">
                <label className="config-label">Preço do diesel (R$/litro)</label>
                <input className="config-input" value={formataDiesel(configTemp.precoDiesel)} onChange={e => { const nums = e.target.value.replace(/\D/g,''); setConfigTemp({...configTemp, precoDiesel: parseInt(nums||'0') / 100}) }} />
                <div className="config-hint">Atualize sempre que o preço mudar no seu posto</div>
              </div>
              <div className="config-item">
                <label className="config-label">Consumo médio parado (litros/hora)</label>
                <input className="config-input" value={formataConsumo(configTemp.consumoParado)} onChange={e => { const nums = e.target.value.replace(/\D/g,''); setConfigTemp({...configTemp, consumoParado: parseInt(nums||'0') / 10}) }} />
                <div className="config-hint">Média para caminhão pesado: 3,0 a 4,0 L/h</div>
              </div>
              <div className="config-item">
                <label className="config-label">Tempo mínimo para marcha lenta (minutos)</label>
                <input className="config-input" type="number" value={configTemp.minMarcha} onChange={e => setConfigTemp({...configTemp, minMarcha: parseInt(e.target.value)})} />
                <div className="config-hint">Paradas abaixo desse tempo são ignoradas</div>
              </div>
              <button className="btn-salvar" onClick={salvarConfig}>
                {salvo ? '✓ Salvo!' : 'Salvar configurações'}
              </button>
            </div>

            <div className="card-box">
              <div className="secao-titulo">Prévia do cálculo</div>
              <div className="previa-desc">Com as configurações atuais, veja quanto custa cada período de marcha lenta:</div>
              {[15, 30, 60, 120, 180].map(min => (
                <div key={min} className="previa-linha">
                  <span className="previa-label">{min < 60 ? `${min} minutos` : `${min/60}h parado`}</span>
                  <span className="previa-valor">R$ {(min/60 * config.consumoParado * config.precoDiesel).toFixed(2)}</span>
                </div>
              ))}
              <div className="previa-formula">
                <div className="formula-titulo">Fórmula usada</div>
                <div className="formula-txt">horas × {config.consumoParado}L/h × R$ {config.precoDiesel.toFixed(2)}/L</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

