// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title ProofInvoice claim schema
/// @notice Canonical representation of the invoice claims that ProofInvoice extracts
///         from a DKIM-authenticated business email and consumes on-chain.
///
/// The struct below is the *public output* of the vlayer Prover
/// (`ProofInvoiceProver.main`) and therefore also the argument list of the
/// verification function on `InvoiceVerifier`. Every field that reaches the chain is
/// either an irreversible hash or a non-identifying scalar, so no private email
/// content, no mailbox address and no message body is ever published.
struct InvoiceClaim {
    /// @dev keccak256 of the upper-cased, trimmed invoice identifier (e.g. "INV-2026-0001").
    bytes32 invoiceIdHash;
    /// @dev keccak256 of the lower-cased domain of the DKIM-authenticated `From` header.
    bytes32 issuerDomainHash;
    /// @dev Invoice total in ISO-4217 minor units (e.g. 125000 == 1_250.00 EUR).
    uint256 amountMinor;
    /// @dev ISO-4217 alpha-3 currency code, ASCII, e.g. bytes3("EUR").
    bytes3 currency;
    /// @dev Due date as days since the Unix epoch (1970-01-01), UTC.
    uint64 dueDateDays;
}

/// @notice Validation and encoding rules shared by the Prover, the Verifier and the
///         application layer. Keeping them in one library guarantees that the off-chain
///         preview produced by the TypeScript client and the on-chain claim written by
///         the Verifier agree byte-for-byte.
library InvoiceClaimLib {
    error UnsupportedCurrency(bytes3 currency);
    error InvalidAmount(string amount);
    error InvalidDueDate(string isoDate);
    error InvalidInvoiceId(string invoiceId);
    error InvalidDomain(string domain);
    error AmountOutOfRange(uint256 amountMinor);

    /// @dev Currencies ProofInvoice is willing to attest. Deliberately a small,
    ///      explicit allow-list: an unknown code is a hard failure, never a silent pass.
    function isSupportedCurrency(bytes3 currency) internal pure returns (bool) {
        return currency == bytes3("EUR") || currency == bytes3("USD") || currency == bytes3("GBP")
            || currency == bytes3("CHF") || currency == bytes3("SEK") || currency == bytes3("NOK")
            || currency == bytes3("DKK") || currency == bytes3("PLN") || currency == bytes3("CZK");
    }

    /// @dev Upper-case a string. Invoice identifiers are normalised so that
    ///      "inv-2026-0001" and "INV-2026-0001" cannot produce two registry entries.
    function toUpper(string memory value) internal pure returns (string memory) {
        bytes memory input = bytes(value);
        bytes memory output = new bytes(input.length);
        for (uint256 i = 0; i < input.length; ++i) {
            bytes1 c = input[i];
            output[i] = (c >= 0x61 && c <= 0x7A) ? bytes1(uint8(c) - 32) : c;
        }
        return string(output);
    }

    /// @dev Lower-case a string. Domain names are case-insensitive (RFC 4343).
    function toLower(string memory value) internal pure returns (string memory) {
        bytes memory input = bytes(value);
        bytes memory output = new bytes(input.length);
        for (uint256 i = 0; i < input.length; ++i) {
            bytes1 c = input[i];
            output[i] = (c >= 0x41 && c <= 0x5A) ? bytes1(uint8(c) + 32) : c;
        }
        return string(output);
    }

    /// @dev Invoice identifiers are constrained to an unambiguous ASCII subset so that
    ///      the hash is stable across clients and regex flavours.
    function validateInvoiceId(string memory invoiceId) internal pure {
        bytes memory raw = bytes(invoiceId);
        if (raw.length < 3 || raw.length > 64) revert InvalidInvoiceId(invoiceId);
        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 c = raw[i];
            bool allowed = (c >= 0x30 && c <= 0x39) // 0-9
                || (c >= 0x41 && c <= 0x5A) // A-Z
                || (c >= 0x61 && c <= 0x7A) // a-z
                || c == 0x2D // -
                || c == 0x5F // _
                || c == 0x2E // .
                || c == 0x2F; // /
            if (!allowed) revert InvalidInvoiceId(invoiceId);
        }
    }

    /// @dev Structural validation of an already lower-cased domain. This is a sanity
    ///      check, not a DKIM proof: DKIM authenticity comes from vlayer, not from us.
    function validateDomain(string memory domain) internal pure {
        bytes memory raw = bytes(domain);
        if (raw.length < 4 || raw.length > 253) revert InvalidDomain(domain);
        uint256 dots;
        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 c = raw[i];
            bool allowed = (c >= 0x61 && c <= 0x7A) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == 0x2D // -
                || c == 0x2E; // .
            if (!allowed) revert InvalidDomain(domain);
            if (c == 0x2E) {
                // empty labels ("billing..example.com") are invalid; also guard
                // a leading dot via the same rule by seeding the previous char.
                if (i == 0 || raw[i - 1] == 0x2E) revert InvalidDomain(domain);
                ++dots;
            }
        }
        if (dots == 0) revert InvalidDomain(domain);
        if (raw[raw.length - 1] == 0x2E) revert InvalidDomain(domain);
    }

    /// @dev Parses a fixed-point decimal with at most two fraction digits into minor
    ///      units: "1250.00" -> 125000, "7.5" -> 750, "19" -> 1900.
    ///      No floating point is used, so the result is exact.
    function parseAmountMinor(string memory amount) internal pure returns (uint256) {
        bytes memory raw = bytes(amount);
        if (raw.length == 0 || raw.length > 24) revert InvalidAmount(amount);

        bool seenDot = false;
        uint256 whole;
        uint256 fraction;
        uint256 fractionDigits;

        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (c == 0x2E) {
                if (seenDot) revert InvalidAmount(amount);
                seenDot = true;
                continue;
            }
            if (c < 0x30 || c > 0x39) revert InvalidAmount(amount);
            uint256 digit = uint8(c) - 0x30;
            if (seenDot) {
                if (fractionDigits == 2) revert InvalidAmount(amount);
                fraction = fraction * 10 + digit;
                ++fractionDigits;
            } else {
                whole = whole * 10 + digit;
            }
        }

        if (fractionDigits == 1) {
            fraction *= 10;
        } else if (fractionDigits == 0) {
            fraction = 0;
        }

        uint256 minor = whole * 100 + fraction;
        if (minor == 0) revert InvalidAmount(amount);
        if (minor > 1e24) revert AmountOutOfRange(minor);
        return minor;
    }

    /// @dev Parses a strict `YYYY-MM-DD` date into days since the Unix epoch (UTC).
    ///      Uses Howard Hinnant's `days_from_civil` algorithm, a well-known exact
    ///      civil-calendar conversion (no timezone or leap-second handling needed).
    function parseDueDateDays(string memory isoDate) internal pure returns (uint64) {
        bytes memory raw = bytes(isoDate);
        if (raw.length != 10 || raw[4] != 0x2D || raw[7] != 0x2D) revert InvalidDueDate(isoDate);

        uint256 year = _digits(raw, 0, 4);
        uint256 month = _digits(raw, 5, 2);
        uint256 day = _digits(raw, 8, 2);

        if (month < 1 || month > 12) revert InvalidDueDate(isoDate);
        if (day < 1 || day > _daysInMonth(year, month)) revert InvalidDueDate(isoDate);
        if (year < 1970 || year > 2200) revert InvalidDueDate(isoDate);

        int256 daysFromEpoch = _daysFromCivil(int256(year), int256(month), int256(day));
        if (daysFromEpoch < 0) revert InvalidDueDate(isoDate);
        return uint64(uint256(daysFromEpoch));
    }

    function _daysInMonth(uint256 year, uint256 month) private pure returns (uint256) {
        if (month == 2) {
            bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            return leap ? 29 : 28;
        }
        if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
        return 31;
    }

    function _digits(bytes memory raw, uint256 start, uint256 length) private pure returns (uint256 value) {
        for (uint256 i = start; i < start + length; ++i) {
            bytes1 c = raw[i];
            if (c < 0x30 || c > 0x39) revert InvalidDueDate("non-numeric date component");
            value = value * 10 + (uint8(c) - 0x30);
        }
    }

    /// @dev Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms".
    function _daysFromCivil(int256 y, int256 m, int256 d) private pure returns (int256) {
        y -= m <= 2 ? int256(1) : int256(0);
        int256 era = (y >= 0 ? y : y - 399) / 400;
        int256 yoe = y - era * 400;
        int256 doy = (153 * (m + (m > 2 ? int256(-3) : int256(9))) + 2) / 5 + d - 1;
        int256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    /// @notice Canonical claim hash. Computed identically on-chain (Verifier) and
    ///         off-chain (TypeScript preview), and used as the registry replay key.
    function claimHash(InvoiceClaim memory claim) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                claim.invoiceIdHash, claim.issuerDomainHash, claim.amountMinor, claim.currency, claim.dueDateDays
            )
        );
    }

    /// @notice Builds a normalised claim from already-extracted string fields.
    function build(
        string memory invoiceId,
        string memory issuerDomain,
        uint256 amountMinor,
        bytes3 currency,
        uint64 dueDateDays
    ) internal pure returns (InvoiceClaim memory claim) {
        validateInvoiceId(invoiceId);
        validateDomain(issuerDomain);
        if (!isSupportedCurrency(currency)) revert UnsupportedCurrency(currency);

        claim = InvoiceClaim({
            invoiceIdHash: keccak256(bytes(toUpper(invoiceId))),
            issuerDomainHash: keccak256(bytes(issuerDomain)),
            amountMinor: amountMinor,
            currency: currency,
            dueDateDays: dueDateDays
        });
    }
}
