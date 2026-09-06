pub mod finch {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/finch.v1.rs"));
    }
}

pub mod sf {
    pub mod substreams {
        pub mod sink {
            pub mod entity {
                pub mod v1 {
                    include!(concat!(env!("OUT_DIR"), "/sf.substreams.sink.entity.v1.rs"));
                }
            }
        }
    }
}
