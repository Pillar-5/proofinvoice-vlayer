// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {InvoiceClaim, InvoiceClaimLib} from "./libraries/InvoiceClaim.sol";

/// @title InvoiceRegistry
/// @notice Minimal on-chain registry of invoice claims that have been consumed by a
///         vlayer proof. It intentionally stores hashes and scalars only: no raw email,
///         no mailbox addresses, no message bodies.
///
/// Trust model: the registry itself performs no cryptography. It only accepts writes
/// from the `InvoiceVerifier` that has been explicitly wired in by the owner, and that
/// verifier has already validated the vlayer proof through `onlyVerified`. The registry
/// therefore acts as an auditable, replay-protected index in front of the proof check.
contract InvoiceRegistry {
    /// @notice A verified invoice claim plus the provenance needed to audit it.
    struct InvoiceRecord {
        bytes32 claimHash;
        bytes32 invoiceIdHash;
        bytes32 issuerDomainHash;
        uint256 amountMinor;
        bytes3 currency;
        uint64 dueDateDays;
        uint64 verifiedAt;
        address verifier;
        address submitter;
    }

    error NotOwner(address caller);
    error NotVerifier(address caller);
    error VerifierAlreadySet(address verifier);
    error ClaimAlreadyVerified(bytes32 claimHash);
    error InvoiceAlreadyRegistered(bytes32 invoiceIdHash, bytes32 existingClaimHash);
    error IssuerNotAllowed(bytes32 issuerDomainHash);
    error ZeroAddress();

    /// @notice Emitted for every accepted claim. This is the audit trail.
    event InvoiceVerified(
        bytes32 indexed claimHash,
        bytes32 indexed invoiceIdHash,
        bytes32 indexed issuerDomainHash,
        uint256 amountMinor,
        bytes3 currency,
        uint64 dueDateDays,
        uint64 verifiedAt,
        address verifier,
        address submitter
    );

    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);
    event IssuerAllowlistEnabled(bool enabled);
    event IssuerAllowed(bytes32 indexed issuerDomainHash, bool allowed);

    address public owner;
    address public verifier;

    /// @dev claimHash => record. Doubles as the replay-protection set.
    mapping(bytes32 => InvoiceRecord) private _records;
    /// @dev invoiceIdHash => claimHash of the first accepted claim for that invoice.
    mapping(bytes32 => bytes32) public claimHashOfInvoice;
    /// @dev Optional onboarding gate for issuers.
    mapping(bytes32 => bool) public allowedIssuerDomains;
    bool public issuerAllowlistEnabled;

    uint256 public totalVerified;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier(msg.sender);
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    /// @notice Wires the `InvoiceVerifier` allowed to write records. One-shot so the
    ///         registry can never be repointed at an unverified writer.
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        if (verifier != address(0)) revert VerifierAlreadySet(verifier);

        address previous = verifier;
        verifier = newVerifier;
        emit VerifierUpdated(previous, newVerifier);
    }

    /// @notice Enables/disables the issuer allow-list. Disabled by default so that the
    ///         MVP demo needs no onboarding step.
    function setIssuerAllowlistEnabled(bool enabled) external onlyOwner {
        issuerAllowlistEnabled = enabled;
        emit IssuerAllowlistEnabled(enabled);
    }

    /// @notice Adds or removes an issuer domain (hash) from the allow-list.
    function setIssuerAllowed(bytes32 issuerDomainHash, bool allowed) external onlyOwner {
        allowedIssuerDomains[issuerDomainHash] = allowed;
        emit IssuerAllowed(issuerDomainHash, allowed);
    }

    /// @notice Records a claim that has already been proven. Callable only by the
    ///         configured verifier, which runs the vlayer proof check in the same
    ///         transaction.
    /// @param claim The normalised claim taken from the proof's public journal.
    /// @param submitter The account that submitted the proof (recorded for auditability).
    function register(InvoiceClaim calldata claim, address submitter) external onlyVerifier {
        if (issuerAllowlistEnabled && !allowedIssuerDomains[claim.issuerDomainHash]) {
            revert IssuerNotAllowed(claim.issuerDomainHash);
        }

        bytes32 hash = InvoiceClaimLib.claimHash(claim);
        if (_records[hash].verifiedAt != 0) revert ClaimAlreadyVerified(hash);

        bytes32 existingClaimHash = claimHashOfInvoice[claim.invoiceIdHash];
        if (existingClaimHash != bytes32(0) && existingClaimHash != hash) {
            revert InvoiceAlreadyRegistered(claim.invoiceIdHash, existingClaimHash);
        }

        uint64 verifiedAt = uint64(block.timestamp);
        _records[hash] = InvoiceRecord({
            claimHash: hash,
            invoiceIdHash: claim.invoiceIdHash,
            issuerDomainHash: claim.issuerDomainHash,
            amountMinor: claim.amountMinor,
            currency: claim.currency,
            dueDateDays: claim.dueDateDays,
            verifiedAt: verifiedAt,
            verifier: msg.sender,
            submitter: submitter
        });
        claimHashOfInvoice[claim.invoiceIdHash] = hash;
        unchecked {
            ++totalVerified;
        }

        emit InvoiceVerified(
            hash,
            claim.invoiceIdHash,
            claim.issuerDomainHash,
            claim.amountMinor,
            claim.currency,
            claim.dueDateDays,
            verifiedAt,
            msg.sender,
            submitter
        );
    }

    /// @notice Returns the stored record for a claim hash, or a zeroed record if unknown.
    function recordOf(bytes32 claimHash) external view returns (InvoiceRecord memory) {
        return _records[claimHash];
    }

    /// @notice True when this exact claim has already been consumed.
    function isClaimVerified(bytes32 claimHash) external view returns (bool) {
        return _records[claimHash].verifiedAt != 0;
    }
}
