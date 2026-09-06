fn main() {
    substreams_ethereum::Abigen::new("pons_v2_factory", "abi/pons_v2_factory.json")
        .expect("load pons abi").generate().expect("gen pons")
        .write_to_file("src/abi/pons_v2_factory.rs").expect("write pons abi");

    substreams_ethereum::Abigen::new("pool_manager", "abi/pool_manager.json")
        .expect("load poolmanager abi").generate().expect("gen poolmanager")
        .write_to_file("src/abi/pool_manager.rs").expect("write poolmanager abi");

    substreams_ethereum::Abigen::new("erc20", "abi/erc20.json")
        .expect("load erc20 abi").generate().expect("gen erc20")
        .write_to_file("src/abi/erc20.rs").expect("write erc20 abi");

    prost_build::compile_protos(&["proto/finch.proto", "proto/entity.proto"], &["proto/"])
        .expect("compile protos");
}
