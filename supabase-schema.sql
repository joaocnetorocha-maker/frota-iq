-- =============================================================================
-- FrotaIQ — Schema do banco Supabase
-- =============================================================================
-- Como usar:
--   1. Cria projeto grátis em supabase.com
--   2. Vai em "SQL Editor" no menu lateral
--   3. Cola TODO esse arquivo e clica em RUN
--   4. Pronto, banco preparado pra receber dados da ONIXSAT.
-- =============================================================================

-- Tabela 1: VEICULOS
-- Espelho da resposta de RequestVeiculo (rodada periodicamente)
create table if not exists veiculos (
  vei_id        bigint primary key,
  placa         text,
  motorista     text,
  chassi        text,
  ident         text,
  eqp           int,
  ult_manut     timestamptz,
  atualizado_em timestamptz default now()
);

-- Tabela 2: MENSAGENS_CB
-- Cada linha é uma mensagem do computador de bordo (RequestMensagemCB)
-- mId é único, então ON CONFLICT DO NOTHING evita duplicar.
create table if not exists mensagens_cb (
  m_id        bigint primary key,           -- mId do XML
  vei_id      bigint not null,
  dt          timestamptz not null,         -- data/hora da mensagem
  lat         numeric(10, 6),
  lon         numeric(10, 6),
  mun         text,
  uf          char(2),
  rod         text,
  rua         text,
  vel         numeric(6, 2),                -- km/h
  evt4        smallint,                     -- ignição (-1, 0, 1)
  evt34       boolean default false,        -- excesso vel GPS
  evt35       boolean default false,        -- excesso RPM
  evt54       boolean default false,        -- marcha lenta excedida
  evt67       boolean default false,        -- evento telemetria
  evt16       boolean default false,        -- frenagem brusca
  evt17       boolean default false,        -- aceleração brusca
  rpm         int,
  odm         int,
  mot         text,                         -- motorista identificado na msg
  mot_id      int,
  alrt_telem  text,
  raw_xml     text,                         -- backup da msg crua
  inserido_em timestamptz default now()
);

create index if not exists idx_mensagens_vei_dt on mensagens_cb (vei_id, dt desc);
create index if not exists idx_mensagens_dt on mensagens_cb (dt desc);

-- Tabela 3: COLETA_ESTADO
-- Guarda o estado da última coleta (mId pra paginar, último horário, etc)
create table if not exists coleta_estado (
  id                       smallint primary key default 1,
  ultimo_mid_cb            bigint default 1,
  ultima_coleta_em         timestamptz,
  ultima_coleta_status     text,
  ultima_coleta_qtd_msg    int default 0,
  ultima_coleta_erro       text,
  total_msgs_coletadas     bigint default 0
);

-- Insere a linha inicial (id=1) se não existir
insert into coleta_estado (id, ultimo_mid_cb)
values (1, 1)
on conflict (id) do nothing;

-- Tabela 4: HISTORICO_DIA
-- Snapshot diário (1 linha por veículo por dia). Populada por /api/fechar-dia
-- todo dia às 23:55 (Brasília). Permite olhar dias passados sem recalcular.
create table if not exists historico_dia (
  data            date    not null,           -- dia (YYYY-MM-DD, fuso Brasília)
  vei_id          bigint  not null,
  placa           text,
  motorista       text,
  parado_min      int     default 0,          -- marcha lenta total no dia
  excesso_vel_min int     default 0,          -- minutos acima do limite
  km_rodado       int     default 0,
  vel_max         int     default 0,
  perda           numeric(10, 2) default 0,   -- R$
  score           int,
  status          text,                       -- verde / amarelo / vermelho
  status_txt      text,
  ignicao_final   boolean default false,      -- estado da última msg do dia
  posicao_final   text,                       -- mun/uf da última msg
  diario          jsonb,                      -- linha do tempo de eventos do dia
  viagens         jsonb,                      -- viagens detectadas do dia
  fechado_em      timestamptz default now(),
  primary key (data, vei_id)
);

create index if not exists idx_historico_data on historico_dia (data desc);

-- =============================================================================
-- Tudo pronto. Próximo passo: configurar env vars na Vercel e cron-job.org
-- =============================================================================
