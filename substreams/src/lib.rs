mod abi;
mod pb;

use std::collections::HashSet;
use substreams::errors::Error;
use substreams::store::{StoreGet, StoreGetInt64, StoreNew, StoreSetIfNotExists, StoreSetIfNotExistsInt64};
use substreams::Hex;
use substreams_ethereum::pb::eth::v2 as eth;
use substreams_ethereum::Event;

use pb::finch::v1 as finch;
use pb::sf::substreams::sink::entity::v1 as entity;

fn hex0x(b: &[u8]) -> String { format!("0x{}", Hex::encode(b)) }
fn addr(s: &str) -> Vec<u8> { hex::decode(s.trim().trim_start_matches("0x")).unwrap_or_default() }

// ---- params ----------------------------------------------------------------
// Every filter address comes from module params, never a hardcoded constant, so
// the module is reusable for another hook / token set (Composable Products track).
//   factory=0x..&hook=0x..&fee_escrow=0x..&distributor=0x..&tokens=0x..,0x..,..
struct Cfg {
    factory: Vec<u8>,
    hook: Vec<u8>,
    fee_escrow: Vec<u8>,
    distributor: Vec<u8>,
    tokens: HashSet<Vec<u8>>,
    pairing: HashSet<Vec<u8>>,
}

fn parse_cfg(params: &str) -> Cfg {
    let mut factory = vec![]; let mut hook = vec![];
    let mut fee_escrow = vec![]; let mut distributor = vec![];
    let mut tokens = HashSet::new();
    let mut pairing_extra: Vec<Vec<u8>> = vec![];
    for kv in params.split('&') {
        let mut it = kv.splitn(2, '=');
        match (it.next(), it.next()) {
            (Some("factory"), Some(v)) => factory = addr(v),
            (Some("hook"), Some(v)) => hook = addr(v),
            (Some("fee_escrow"), Some(v)) => fee_escrow = addr(v),
            (Some("distributor"), Some(v)) => distributor = addr(v),
            (Some("tokens"), Some(v)) => { for t in v.split(',') { tokens.insert(addr(t)); } }
            (Some("pairing"), Some(v)) => { for t in v.split(',') { pairing_extra.push(addr(t)); } }
            _ => {}
        }
    }
    // pairing assets = watched tokens + explicit quote assets (WETH/USDG) + zero.
    // The launched side of a pool is whichever currency is NOT in here (null when
    // ambiguous). Quote assets need not be Transfer-watched to serve this role.
    let mut pairing = tokens.clone();
    pairing.insert(vec![0u8; 20]);
    for p in pairing_extra { pairing.insert(p); }
    Cfg { factory, hook, fee_escrow, distributor, tokens, pairing }
}

fn label(c: &Cfg, a: &[u8]) -> String {
    if a == c.fee_escrow.as_slice()  { return "Pons V2 FeeEscrow".into() }
    if a == c.distributor.as_slice() { return "Pons fee claim contract".into() }
    if a == c.factory.as_slice()     { return "Pons launch factory".into() }
    if a == c.hook.as_slice()        { return "Pons Meme Hook".into() }
    String::new()
}

// ---- map_raw: decode everything, pool activity UNFILTERED ------------------
#[substreams::handlers::map]
fn map_raw(params: String, block: eth::Block) -> Result<finch::Events, Error> {
    let c = parse_cfg(&params);
    let mut ev = finch::Events::default();
    let ts = block.timestamp_seconds();
    let bn = block.number;

    for trx in block.transactions() {
        let tx = hex0x(&trx.hash);
        for (log, _call) in trx.logs_with_calls() {
            let a = log.address.as_slice();

            if a == c.factory.as_slice() {
                if let Some(e) = abi::pons_v2_factory::events::TokenLaunched::match_and_decode(log) {
                    ev.token_launches.push(finch::TokenLaunch {
                        token: hex0x(&e.token), curve: hex0x(&e.curve), deployer: hex0x(&e.deployer),
                        pair_token: hex0x(&e.pair_token),
                        launch_config_id: e.launch_config_id.to_string(),
                        graduation_threshold: e.graduation_threshold.to_string(),
                        block: bn, timestamp: ts, tx_hash: tx.clone(),
                    });
                } else if let Some(e) = abi::pons_v2_factory::events::PoolGraduated::match_and_decode(log) {
                    ev.graduations.push(finch::Graduation { token: hex0x(&e.token), kind: "PoolGraduated".into(),
                        amount: e.token_amount.to_string(), block: bn, timestamp: ts, tx_hash: tx.clone() });
                } else if let Some(e) = abi::pons_v2_factory::events::GraduationTokensPermanentlyLocked::match_and_decode(log) {
                    ev.graduations.push(finch::Graduation { token: hex0x(&e.token), kind: "GraduationTokensPermanentlyLocked".into(),
                        amount: e.amount.to_string(), block: bn, timestamp: ts, tx_hash: tx.clone() });
                } else if let Some(e) = abi::pons_v2_factory::events::LaunchSwept::match_and_decode(log) {
                    ev.graduations.push(finch::Graduation { token: hex0x(&e.token), kind: "LaunchSwept".into(),
                        amount: e.token_out.to_string(), block: bn, timestamp: ts, tx_hash: tx.clone() });
                }
                continue;
            }

            // Uniswap V4 PoolManager — Initialize carries the hook, filter here.
            if let Some(e) = abi::pool_manager::events::Initialize::match_and_decode(log) {
                if e.hooks != c.hook { continue; }
                let (c0, c1) = (e.currency0.to_vec(), e.currency1.to_vec());
                let c0p = c.pairing.contains(&c0);
                let c1p = c.pairing.contains(&c1);
                let token = if c0p && !c1p { hex0x(&c1) } else if c1p && !c0p { hex0x(&c0) } else { String::new() };
                ev.pool_initializes.push(finch::PoolInitialize {
                    pool_id: hex0x(&e.id), currency0: hex0x(&c0), currency1: hex0x(&c1), token,
                    hook: hex0x(&e.hooks), fee: e.fee.to_u64() as u32, tick_spacing: e.tick_spacing.to_i32(),
                    sqrt_price_x96: e.sqrt_price_x96.to_string(), tick: e.tick.to_i32(),
                    block: bn, timestamp: ts, tx_hash: tx.clone(),
                });
                continue;
            }
            if let Some(e) = abi::pool_manager::events::Swap::match_and_decode(log) {
                ev.pool_swaps.push(finch::PoolSwap {
                    pool_id: hex0x(&e.id), sender: hex0x(&e.sender),
                    amount0: e.amount0.to_string(), amount1: e.amount1.to_string(),
                    sqrt_price_x96: e.sqrt_price_x96.to_string(), liquidity: e.liquidity.to_string(),
                    tick: e.tick.to_i32(), fee: e.fee.to_u64() as u32,
                    block: bn, timestamp: ts, tx_hash: tx.clone(), log_index: log.index,
                });
                continue;
            }
            if let Some(e) = abi::pool_manager::events::ModifyLiquidity::match_and_decode(log) {
                ev.pool_modify_liquidity.push(finch::PoolModifyLiquidity {
                    pool_id: hex0x(&e.id), sender: hex0x(&e.sender),
                    tick_lower: e.tick_lower.to_i32(), tick_upper: e.tick_upper.to_i32(),
                    liquidity_delta: e.liquidity_delta.to_string(),
                    block: bn, timestamp: ts, tx_hash: tx.clone(), log_index: log.index,
                });
                continue;
            }

            // ERC-20 Transfer on the watched token list
            if c.tokens.contains(&log.address) {
                if let Some(e) = abi::erc20::events::Transfer::match_and_decode(log) {
                    ev.transfers.push(finch::Transfer {
                        token: hex0x(a), from: hex0x(&e.from), to: hex0x(&e.to), amount: e.value.to_string(),
                        from_label: label(&c, &e.from), to_label: label(&c, &e.to),
                        block: bn, timestamp: ts, tx_hash: tx.clone(), log_index: log.index,
                    });
                }
            }
        }
    }
    Ok(ev)
}

// ---- store of Meme-Hook pool ids -----------------------------------------
#[substreams::handlers::store]
fn store_meme_pools(raw: finch::Events, s: StoreSetIfNotExistsInt64) {
    for p in raw.pool_initializes { s.set_if_not_exists(0, &p.pool_id, &1); }
}

// ---- map_bot: everything the Finch bot reads, nothing it doesn't ----------
// map_raw minus pool_swaps / pool_modify_liquidity. Those are every Uniswap V4
// swap on the chain (unfiltered) — the bot never queries them, and their write
// volume is what a small managed Postgres (Aiven free tier) can't keep up with.
#[substreams::handlers::map]
fn map_bot(raw: finch::Events) -> Result<finch::Events, Error> {
    Ok(finch::Events {
        token_launches: raw.token_launches,
        graduations: raw.graduations,
        pool_initializes: raw.pool_initializes,
        pool_swaps: vec![],
        pool_modify_liquidity: vec![],
        transfers: raw.transfers,
    })
}

// ---- map_events: pool activity filtered to known Meme-Hook pools ----------
#[substreams::handlers::map]
fn map_events(raw: finch::Events, pools: StoreGetInt64) -> Result<finch::Events, Error> {
    let known = |id: &str| pools.get_last(id).is_some();
    Ok(finch::Events {
        token_launches: raw.token_launches,
        graduations: raw.graduations,
        pool_initializes: raw.pool_initializes,
        pool_swaps: raw.pool_swaps.into_iter().filter(|s| known(&s.pool_id)).collect(),
        pool_modify_liquidity: raw.pool_modify_liquidity.into_iter().filter(|m| known(&m.pool_id)).collect(),
        transfers: raw.transfers,
    })
}

// ---- graph_out: EntityChanges for the Subgraph sink ----------------------
fn f_str(name: &str, v: &str) -> entity::Field {
    entity::Field { name: name.into(), old_value: None,
        new_value: Some(entity::Value { typed: Some(entity::value::Typed::String(v.to_string())) }) }
}
fn f_bigint(name: &str, v: &str) -> entity::Field {
    entity::Field { name: name.into(), old_value: None,
        new_value: Some(entity::Value { typed: Some(entity::value::Typed::Bigint(v.to_string())) }) }
}
fn f_bool(name: &str, v: bool) -> entity::Field {
    entity::Field { name: name.into(), old_value: None,
        new_value: Some(entity::Value { typed: Some(entity::value::Typed::Bool(v)) }) }
}

#[substreams::handlers::map]
fn graph_out(ev: finch::Events) -> Result<entity::EntityChanges, Error> {
    let mut out = entity::EntityChanges::default();
    let create = entity::entity_change::Operation::Create as i32;
    let mut push = |entity_name: &str, id: String, fields: Vec<entity::Field>| {
        out.entity_changes.push(entity::EntityChange { entity: entity_name.into(), id, ordinal: 0, operation: create, fields });
    };

    for l in ev.token_launches {
        push("TokenLaunch", l.token.clone(), vec![
            f_str("token", &l.token), f_str("curve", &l.curve), f_str("creator", &l.deployer),
            f_str("pairToken", &l.pair_token), f_bigint("graduationThreshold", &l.graduation_threshold),
            f_bigint("block", &l.block.to_string()), f_bigint("timestamp", &l.timestamp.to_string()),
            f_str("txHash", &l.tx_hash), f_bool("graduated", false),
        ]);
    }
    for p in ev.pool_initializes {
        push("Pool", p.pool_id.clone(), vec![
            f_str("token", &p.token), f_str("currency0", &p.currency0), f_str("currency1", &p.currency1),
            f_str("hook", &p.hook), f_bigint("createdAtBlock", &p.block.to_string()),
        ]);
    }
    for s in ev.pool_swaps {
        push("SwapEvent", format!("{}-{}", s.tx_hash, s.log_index), vec![
            f_str("pool", &s.pool_id), f_str("sender", &s.sender),
            f_bigint("amount0", &s.amount0), f_bigint("amount1", &s.amount1),
            f_bigint("sqrtPriceX96", &s.sqrt_price_x96), f_bigint("liquidity", &s.liquidity),
            f_bigint("timestamp", &s.timestamp.to_string()),
        ]);
    }
    for m in ev.pool_modify_liquidity {
        push("LiquidityEvent", format!("{}-{}", m.tx_hash, m.log_index), vec![
            f_str("pool", &m.pool_id), f_str("provider", &m.sender),
            f_bigint("liquidityDelta", &m.liquidity_delta),
            f_bigint("timestamp", &m.timestamp.to_string()),
        ]);
    }
    for t in ev.transfers {
        push("Transfer", format!("{}-{}", t.tx_hash, t.log_index), vec![
            f_str("token", &t.token), f_str("from", &t.from), f_str("to", &t.to),
            f_bigint("amount", &t.amount),
            f_str("fromLabel", &t.from_label), f_str("toLabel", &t.to_label),
            f_str("txHash", &t.tx_hash), f_bigint("block", &t.block.to_string()),
            f_bigint("timestamp", &t.timestamp.to_string()),
        ]);
    }
    Ok(out)
}
