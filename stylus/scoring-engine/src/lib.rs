// ─────────────────────────────────────────────────────────────────────────────
// OmniVault — ScoringEngine (Arbitrum Stylus / Rust)
//
// Pure computation contract — stateless, no storage.
//
// Default weights (bps, sum = 10 000):
//   reliability  40 % = 4 000  — agent uptime, latency, error rate
//   quality      30 % = 3 000  — code / output quality
//   marketFit    30 % = 3 000  — business / market-fit
//
// All scores 0-100.  APPROVE when finalScore >= threshold (default 60).
// ─────────────────────────────────────────────────────────────────────────────

extern crate alloc;

use alloc::vec::Vec;
use stylus_sdk::{alloy_primitives::U256, prelude::*};

// ─── Constants ────────────────────────────────────────────────────────────────
pub const DEFAULT_W_RELIABILITY: u32 = 4_000;
pub const DEFAULT_W_QUALITY:     u32 = 3_000;
pub const DEFAULT_W_MARKET_FIT:  u32 = 3_000;
pub const WEIGHT_DENOM:          u32 = 10_000;
pub const DEFAULT_THRESHOLD:     u8  = 60;

// ─── Pure maths ───────────────────────────────────────────────────────────────
pub fn weighted_score(r: u8, q: u8, m: u8, w_r: u32, w_q: u32, w_m: u32) -> u8 {
    let n = (r as u64) * (w_r as u64)
          + (q as u64) * (w_q as u64)
          + (m as u64) * (w_m as u64);
    (n / WEIGHT_DENOM as u64).min(100) as u8
}

// ─── Validators ───────────────────────────────────────────────────────────────
pub fn validate_inputs(r: u8, q: u8, m: u8) -> Result<(), Vec<u8>> {
    if r > 100 || q > 100 || m > 100 {
        return Err(b"ScoringEngine: score out of range 0-100".to_vec());
    }
    Ok(())
}

pub fn validate_weights(w_r: u32, w_q: u32, w_m: u32) -> Result<(), Vec<u8>> {
    if w_r + w_q + w_m != WEIGHT_DENOM {
        return Err(b"ScoringEngine: weights must sum to 10000".to_vec());
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Stylus contract
// ─────────────────────────────────────────────────────────────────────────────
sol_storage! {
    #[entrypoint]
    pub struct ScoringEngine {}   // pure computation — no persistent storage
}

#[public]
impl ScoringEngine {
    /// Compute score with default 40/30/30 weights and threshold=60.
    ///
    /// Returns `(finalScore 0-100, approved)`.
    pub fn compute_score(&self, r: u8, q: u8, m: u8) -> Result<(u8, bool), Vec<u8>> {
        validate_inputs(r, q, m)?;
        let s = weighted_score(
            r, q, m,
            DEFAULT_W_RELIABILITY, DEFAULT_W_QUALITY, DEFAULT_W_MARKET_FIT,
        );
        Ok((s, s >= DEFAULT_THRESHOLD))
    }

    /// Compute score with caller-supplied weights (bps, must sum to 10 000)
    /// and a custom approval threshold.
    ///
    /// Returns `(finalScore 0-100, approved)`.
    pub fn compute_score_weighted(
        &self,
        r: u8, q: u8, m: u8,
        w_r: U256, w_q: U256, w_m: U256,
        threshold: u8,
    ) -> Result<(u8, bool), Vec<u8>> {
        validate_inputs(r, q, m)?;
        let (w_r32, w_q32, w_m32) = (w_r.to::<u32>(), w_q.to::<u32>(), w_m.to::<u32>());
        validate_weights(w_r32, w_q32, w_m32)?;
        let s = weighted_score(r, q, m, w_r32, w_q32, w_m32);
        Ok((s, s >= threshold))
    }

    /// Returns the default config: `(wReliability, wQuality, wMarketFit, threshold)`.
    pub fn default_config(&self) -> Result<(U256, U256, U256, u8), Vec<u8>> {
        Ok((
            U256::from(DEFAULT_W_RELIABILITY),
            U256::from(DEFAULT_W_QUALITY),
            U256::from(DEFAULT_W_MARKET_FIT),
            DEFAULT_THRESHOLD,
        ))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — `cargo test`
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn s(r: u8, q: u8, m: u8) -> u8 {
        weighted_score(r, q, m, DEFAULT_W_RELIABILITY, DEFAULT_W_QUALITY, DEFAULT_W_MARKET_FIT)
    }

    #[test] fn all_zeros()    { assert_eq!(s(  0,  0,  0),  0); }
    #[test] fn all_hundreds() { assert_eq!(s(100,100,100),100); }
    #[test] fn equal_60()     { assert_eq!(s( 60, 60, 60), 60); }
    #[test] fn equal_75()     { assert_eq!(s( 75, 75, 75), 75); }

    #[test]
    fn weight_breakdown() {
        assert_eq!(s(100,  0,  0), 40);
        assert_eq!(s(  0,100,  0), 30);
        assert_eq!(s(  0,  0,100), 30);
    }

    #[test]
    fn threshold_boundary() {
        assert!(s(59,59,59) <  DEFAULT_THRESHOLD);
        assert!(s(60,60,60) >= DEFAULT_THRESHOLD);
    }

    #[test]
    fn high_quality_agent() {
        // (90×4000 + 85×3000 + 80×3000)/10000 = 85
        assert_eq!(s(90,85,80), 85);
    }

    #[test]
    fn borderline_agent() {
        // (50×4000 + 70×3000 + 65×3000)/10000 = 60 — barely approved
        assert_eq!(s(50,70,65), 60);
        assert!(s(50,70,65) >= DEFAULT_THRESHOLD);
    }

    #[test]
    fn rejected_agent() {
        // (30×4000 + 50×3000 + 40×3000)/10000 = 39
        assert_eq!(s(30,50,40), 39);
        assert!(s(30,50,40) < DEFAULT_THRESHOLD);
    }

    #[test]
    fn custom_equal_split() {
        // (80×3333 + 60×3333 + 40×3334)/10000 = 59
        assert_eq!(weighted_score(80,60,40, 3_333,3_333,3_334), 59);
    }

    #[test]
    fn clamp_at_100() {
        assert_eq!(weighted_score(100,100,100, 5_000,3_000,2_000), 100);
    }

    #[test]
    fn above_threshold() {
        // (70×4000 + 80×3000 + 75×3000)/10000 = 74
        assert_eq!(s(70,80,75), 74);
        assert!(s(70,80,75) >= DEFAULT_THRESHOLD);
    }

    #[test]
    fn validate_inputs_boundaries() {
        assert!(validate_inputs(0,0,0).is_ok());
        assert!(validate_inputs(100,100,100).is_ok());
        assert!(validate_inputs(101,0,0).is_err());
        assert!(validate_inputs(0,101,0).is_err());
        assert!(validate_inputs(0,0,101).is_err());
    }

    #[test]
    fn validate_weights_boundaries() {
        assert!(validate_weights(4_000, 3_000, 3_000).is_ok());
        assert!(validate_weights(10_000, 0, 0        ).is_ok());
        assert!(validate_weights(3_000, 3_000, 3_000).is_err()); // 9000
        assert!(validate_weights(0, 0, 0             ).is_err()); // 0
    }
}
