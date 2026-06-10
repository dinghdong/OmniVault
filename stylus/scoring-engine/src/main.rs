// Wasm entry point — present only in the deployed binary build (not tests, not export-abi).
// `no_main` suppresses the standard Rust `start` shim; we provide a bare `main` instead.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]

// In the Wasm binary build we define a no-op `main` that satisfies the linker while
// keeping the binary minimal.  The real work is done by `user_entrypoint` which the
// Stylus SDK #[entrypoint] macro exports.
#[cfg(not(any(test, feature = "export-abi")))]
#[no_mangle]
pub extern "C" fn main() {}

// In the export-abi build we print the ABI to stdout.
#[cfg(feature = "export-abi")]
fn main() {
    scoring_engine::print_abi("MIT", "pragma solidity ^0.8.24;");
}
