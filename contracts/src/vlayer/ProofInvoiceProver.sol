// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Proof} from "vlayer-0.1.0/Proof.sol";
import {Prover} from "vlayer-0.1.0/Prover.sol";
import {RegexLib} from "vlayer-0.1.0/Regex.sol";
import {EmailProofLib, UnverifiedEmail, VerifiedEmail} from "vlayer-0.1.0/EmailProof.sol";

import {InvoiceClaim, InvoiceClaimLib} from "../libraries/InvoiceClaim.sol";

/// @title ProofInvoiceProver
/// @notice vlayer Prover that turns a DKIM-authenticated invoice email into a compact,
///         privacy-preserving invoice claim.
///
/// Execution model (see https://book.vlayer.xyz/advanced/prover.html):
///   * `main` runs inside the vlayer zkEVM, not on the public chain.
///   * `UnverifiedEmail` arrives as **private** calldata: the raw MIME source, the DNS
///     record of the sender's DKIM key and the DNS notary signature. None of it is
///     published.
///   * Only the returned values become the public journal that the on-chain
///     `InvoiceVerifier` re-derives and checks through `onlyVerified`.
///
/// The contract is still deployed to the same public chain as the verifier, because the
/// stateless zkEVM fetches the prover bytecode from the chain.
contract ProofInvoiceProver is Prover {
    using RegexLib for string;
    using EmailProofLib for UnverifiedEmail;

    /// @dev `VerifiedEmail.from` is a bare mailbox (no display name), per vlayer docs.
    ///      Capture group 1 is the domain; group 2 is the full result sanity anchor.
    string private constant FROM_RE = "^([A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})$";

    /// @dev Canonical `ProofInvoice/1` body header lines. Matching is case-insensitive
    ///      and anchored to the start of a line with `(?im)`, which the vlayer regex
    ///      precompile (Rust `regex` crate) supports.
    string private constant INVOICE_ID_RE = "(?im)^invoice-id:[ \\t]*([A-Za-z0-9._/-]{3,64})";
    string private constant AMOUNT_RE = "(?im)^amount:[ \\t]*([0-9]{1,16}(?:\\.[0-9]{1,2})?)";
    string private constant CURRENCY_RE = "(?im)^currency:[ \\t]*([A-Za-z]{3})";
    string private constant DUE_DATE_RE = "(?im)^due-date:[ \\t]*([0-9]{4}-[0-9]{2}-[0-9]{2})";

    error MissingField(string field);

    /// @notice Proving function. Verifies the email with vlayer and extracts the invoice
    ///         claim from the authenticated content only.
    /// @param unverifiedEmail Private prover input (raw email + DKIM DNS record + notary signature).
    /// @return Proof placeholder, replaced by the vlayer host with the real seal.
    /// @return invoiceIdHash keccak256 of the upper-cased invoice identifier.
    /// @return issuerDomainHash keccak256 of the lower-cased, DKIM-authenticated sender domain.
    /// @return amountMinor Invoice total in ISO-4217 minor units.
    /// @return currency ISO-4217 alpha-3 code as bytes3.
    /// @return dueDateDays Due date as days since the Unix epoch (UTC).
    function main(UnverifiedEmail calldata unverifiedEmail)
        public
        view
        returns (
            Proof memory,
            bytes32 invoiceIdHash,
            bytes32 issuerDomainHash,
            uint256 amountMinor,
            bytes3 currency,
            uint64 dueDateDays
        )
    {
        // 1. DKIM verification happens inside the zkEVM precompile (EmailProofLib).
        //    A tampered body, a wrong notary key or an expired DNS signature reverts here.
        VerifiedEmail memory email = unverifiedEmail.verify();

        // 2. The issuer domain must come from the authenticated `From` header, never from
        //    the (unauthenticated) body. This is what makes "this invoice came from
        //    billing.example.com" a real claim instead of a self-asserted string.
        string[] memory fromParts = email.from.capture(FROM_RE);
        if (fromParts.length != 3 || bytes(fromParts[2]).length == 0) {
            revert MissingField("From domain");
        }
        string memory issuerDomain = InvoiceClaimLib.toLower(fromParts[2]);

        // 3. The claim fields are extracted from the authenticated body.
        string memory invoiceId = _requireCapture(email.body, INVOICE_ID_RE, "Invoice-ID");
        string memory amount = _requireCapture(email.body, AMOUNT_RE, "Amount");
        string memory currencyCode = _requireCapture(email.body, CURRENCY_RE, "Currency");
        string memory dueDate = _requireCapture(email.body, DUE_DATE_RE, "Due-Date");

        // 4. Normalise and validate before anything becomes a public input.
        InvoiceClaim memory claim = InvoiceClaimLib.build(
            invoiceId,
            issuerDomain,
            InvoiceClaimLib.parseAmountMinor(amount),
            _toBytes3(currencyCode),
            InvoiceClaimLib.parseDueDateDays(dueDate)
        );

        return
            (proof(), claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays);
    }

    /// @dev Runs a capturing regex and reverts with the field name when absent. A missing
    ///      field must fail loudly: an invoice without an amount has no claim to make.
    function _requireCapture(string memory source, string memory pattern, string memory field)
        private
        view
        returns (string memory)
    {
        string[] memory captures = source.capture(pattern);
        if (captures.length < 2 || bytes(captures[1]).length == 0) {
            revert MissingField(field);
        }
        return captures[1];
    }

    /// @dev Converts a 3-character ASCII currency code into `bytes3`.
    function _toBytes3(string memory code) private pure returns (bytes3) {
        bytes memory raw = bytes(code);
        require(raw.length == 3, "ProofInvoice: currency must be 3 letters");
        return bytes3(raw[0]) | (bytes3(raw[1]) >> 8) | (bytes3(raw[2]) >> 16);
    }
}
