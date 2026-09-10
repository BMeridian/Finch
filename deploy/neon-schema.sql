-- Neon Postgres schema layer on top of what `substreams sink postgres` creates.
--
-- The sink OWNS transfer / tokenlaunch / graduation / poolinitialize / poolswap /
-- poolmodifyliquidity and WIPES them on any cursorless start. So the Goldsky
-- history seed (bot/scripts/seed-from-goldsky.mjs) writes to parallel *_s tables,
-- and the bot reads q_* views that UNION both.
--
-- Run once, after `substreams sink postgres setup … map_events` has created the
-- base tables:
--   psql "$DATABASE_URL" -f deploy/neon-schema.sql

create table if not exists transfer_s       (like transfer       including defaults);
create table if not exists tokenlaunch_s    (like tokenlaunch    including defaults);
create table if not exists graduation_s     (like graduation     including defaults);
create table if not exists poolinitialize_s (like poolinitialize including defaults);

create or replace view q_transfer       as select * from transfer       union all select * from transfer_s;
create or replace view q_tokenlaunch    as select * from tokenlaunch    union all select * from tokenlaunch_s;
create or replace view q_graduation     as select * from graduation     union all select * from graduation_s;
create or replace view q_poolinitialize as select * from poolinitialize union all select * from poolinitialize_s;

-- helpful indexes on the seed tables (the sink builds its own on the base tables)
create index if not exists transfer_s_to_idx   on transfer_s (lower("to"));
create index if not exists transfer_s_from_idx on transfer_s (lower("from"));
create index if not exists transfer_s_tx_idx   on transfer_s (lower(tx_hash));
create index if not exists tokenlaunch_s_ts_idx on tokenlaunch_s (timestamp);
create index if not exists tokenlaunch_s_pair_idx on tokenlaunch_s (lower(pair_token));
create index if not exists graduation_s_token_idx on graduation_s (lower(token));
create index if not exists poolinitialize_s_c0_idx on poolinitialize_s (lower(currency0));
create index if not exists poolinitialize_s_c1_idx on poolinitialize_s (lower(currency1));
