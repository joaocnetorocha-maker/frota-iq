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

  // Resumo semanal pra tela Relatório (só faz sentido no beta)
  const resumoSemana = useMemo(
    () => (beta ? getResumoSemanaBeta() : null),
    [beta, agora]
  )

  const visiveis = veiculos.filter(v => frotaFiltro === 'Todas' || v.frota === frotaFiltro)
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

      {tela === 'painel' && (
        <>
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
            <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
              Mostrando {visiveis.length} {visiveis.length === 1 ? 'veículo' : 'veículos'}
            </span>
          </div>

          <div className="resumo-grid">
            <div className="metrica"><div className="metrica-label">Veículos ativos</div><div className="metrica-valor">{visiveis.length}</div><div className="metrica-sub">de {veiculos.length} na frota</div></div>
            <div className="metrica"><div className="metrica-label">Em rota agora</div><div className="metrica-valor">{visiveis.filter(v => v.ignicao).length}</div><div className="metrica-sub">motor ligado</div></div>
            <div className="metrica"><div className="metrica-label">Perda estimada hoje</div><div className="metrica-valor alerta">R$ {perdaTotal.toLocaleString('pt-BR')}</div><div className="metrica-sub">em marcha lenta</div></div>
            <div className="metrica"><div className="metrica-label">Alertas ativos</div><div className="metrica-valor alerta">{alertas}</div><div className="metrica-sub">{amarelos} amarelos, {criticos} crítico{criticos !== 1 ? 's' : ''}</div></div>
          </div>

          <div className="dois-col">
            <div className="card-box">
              <div className="secao-titulo">Ranking de desperdício — semana</div>
              {ranking.length === 0
                ? <div className="vazio">Sem dados — aguardando ONIXSAT</div>
                : ranking.map((r, i) => (
                  <div key={r.placa} className="ranking-item">
                    <div className="ranking-pos">{i + 1}</div>
                    <div className="ranking-info">
                      <div className="ranking-placa">{r.placa}</div>
                      <div className="ranking-motorista">{r.motorista} · Frota {r.frota}</div>
                      <div className="barra-bg"><div className="barra-fill" style={{width:`${Math.round((r.perdaSemana/maxPerda)*100)}%`}}></div></div>
                    </div>
                    <div className="ranking-valor">
                      <div className="ranking-reais">R$ {r.perdaSemana.toLocaleString('pt-BR')}</div>
                      <div className="ranking-tempo">esta semana</div>
                    </div>
                  </div>
                ))
              }
            </div>
            <div className="card-box">
              <div className="secao-titulo">Projeção de perda mensal</div>
              <div className="projecao-numero">R$ {projecaoMensal.toLocaleString('pt-BR')}</div>
              <div className="projecao-sub">Se o padrão continuar, sua frota perde esse valor em combustível este mês.</div>
              <div className="projecao-linha"><span className="pl-label">Média diária atual</span><span className="pl-valor">R$ {perdaTotal.toLocaleString('pt-BR')}</span></div>
              <div className="projecao-linha"><span className="pl-label">Projeção 30 dias</span><span className="pl-valor">R$ {projecaoMensal.toLocaleString('pt-BR')}</span></div>
              <div className="projecao-linha"><span className="pl-label">Diesel configurado</span><span className="pl-valor">R$ {config.precoDiesel.toFixed(2)}/L</span></div>
              <div className="economia-destaque">
                <div className="eco-label">Economia potencial com controle</div>
                <div className="eco-valor">R$ {economiaPotencial.toLocaleString('pt-BR')} / mês</div>
              </div>
            </div>
          </div>

          <div className="secao-titulo">Status da frota</div>
          <div className="legenda">
            <span className="leg-item"><span className="dot verde"></span>Normal</span>
            <span className="leg-item"><span className="dot amarelo"></span>Atenção</span>
            <span className="leg-item"><span className="dot vermelho"></span>Crítico</span>
          </div>
          <div className="frota-grid">
            {visiveis.map((ve) => {
              const idx = veiculos.indexOf(ve)
              return (
                <div key={ve.placa} className={`card-veiculo ${ve.status} ${idx === selecionado ? 'selecionado' : ''}`} onClick={() => setSelecionado(idx)}>
                  <div className="cv-placa">{ve.placa}</div>
                  <div className="cv-motorista">{ve.motorista}</div>
                  <div className="cv-carreta">Carreta: {ve.carreta}</div>
                  <div className="cv-status"><span className={`dot ${ve.status}`}></span><span className="cv-status-txt">{ve.statusTxt}</span></div>
                  <div className={`ignicao ${ve.ignicao ? 'on' : 'off'}`}>{ve.ignicao ? '● ligada' : '○ desligada'}</div>
                </div>
              )
            })}
          </div>

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
            <div className="secao-titulo">Relatório por veículo — semana</div>
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
                {veiculos.map(ve => (
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