// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ComputeAuditTrail
 * @notice Records 0G Compute inference provenance permanently on-chain.
 *
 * Each OmniVault AI audit triggers multiple inference calls on 0G Compute
 * Network (Intel TDX / TeeTLS attested). This contract logs a tamper-proof
 * summary of each audit's compute footprint as an EVM event, queryable on
 * any block explorer.
 *
 * Verification:
 *   1. Retrieve the event for a projectId from this contract.
 *   2. Re-compute: keccak256(toUtf8Bytes(JSON.stringify(sortedRequestIds)))
 *   3. Compare with the on-chain requestsHash — any mismatch means the list was altered.
 */
contract ComputeAuditTrail {
    event ComputeProvenanceLogged(
        uint256 indexed projectId,
        address indexed provider,
        string  model,
        bool    teeVerified,
        uint256 inferenceCount,
        bytes32 requestsHash
    );

    /**
     * @notice Log compute provenance for a completed AI audit.
     * @param projectId      OmniVault project ID (matches InvestmentManager).
     * @param provider       0G Compute provider address from x_0g_trace.
     * @param model          Model name used for inference (e.g. "qwen/qwen-2.5-7b-instruct").
     * @param teeVerified    Whether TEE attestation was confirmed (x_0g_trace.tee_verified).
     * @param inferenceCount Total number of inference calls made during this audit.
     * @param requestsHash   keccak256(JSON.stringify(sorted request IDs)) for verification.
     */
    function logProvenance(
        uint256 projectId,
        address provider,
        string  calldata model,
        bool    teeVerified,
        uint256 inferenceCount,
        bytes32 requestsHash
    ) external {
        emit ComputeProvenanceLogged(
            projectId,
            provider,
            model,
            teeVerified,
            inferenceCount,
            requestsHash
        );
    }
}
