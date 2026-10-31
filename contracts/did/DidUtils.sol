// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { StrSlice, toSlice } from "@dk1a/solidity-stringutils/src/StrSlice.sol";
import { IncorrectDid } from "./DidErrors.sol";
import { StringUtils } from "../utils/StringUtils.sol";

string constant DID_ETHR_METHOD = "ethr";
string constant DID_INDY_BESU_METHOD = "indy:besu";

struct ParsedDid {
    string method;
    string identifier;
}

using { toSlice } for string;

library DidUtils {
    string private constant _DID_PREFIX = "did";
    string private constant _DID_DELIMETER = ":";
    string private constant _DID_INDY_PREFIX = "indy";
    string private constant _DID_BESU_PREFIX = "besu";
    uint16 private constant _ADDRESS_HEX_STRING_LENGTH = 42;
    uint16 private constant _PUBLIC_KEY_64_HEX_STRING_LENGTH = 130;
    uint16 private constant _PUBLIC_KEY_65_HEX_STRING_LENGTH = 132;

    /**
     * @dev Parses a DID string and returns its components.
     * @param did The DID string to be parsed.
     * @return ParsedDid A struct containing the method and identifier of the DID.
     */
    function parseDid(string memory did) internal view returns (ParsedDid memory) {
        StrSlice didSlice = did.toSlice();
        StrSlice delimeterSlice = _DID_DELIMETER.toSlice();
        StrSlice component;
        bool found;

        // Extract and check 'did' prefix.
        (found, component, didSlice) = didSlice.splitOnce(delimeterSlice);
        if (!found || !component.eq(_DID_PREFIX.toSlice())) revert IncorrectDid(did);

        // Extract the DID method.
        (found, component, didSlice) = didSlice.splitOnce(delimeterSlice);
        if (!found) revert IncorrectDid(did);

        ParsedDid memory parsedDid;
        if (component.eq(DID_ETHR_METHOD.toSlice())) {
            parsedDid.method = DID_ETHR_METHOD;
        } else if (component.eq(_DID_INDY_PREFIX.toSlice())) {
            (found, component, didSlice) = didSlice.splitOnce(delimeterSlice);
            if (!found || !component.eq(_DID_BESU_PREFIX.toSlice())) revert IncorrectDid(did);

            parsedDid.method = DID_INDY_BESU_METHOD;
        } else {
            revert IncorrectDid(did);
        }

        parsedDid.identifier = _parseDidIdentifier(didSlice, delimeterSlice, did);

        return parsedDid;
    }

    function _parseDidIdentifier(
        StrSlice didSlice,
        StrSlice delimeterSlice,
        string memory did
    ) private view returns (string memory identifier) {
        bool found;
        StrSlice component;

        // Format without network: <identifier>
        // Format with network: <network>:<identifier>
        (found, component, didSlice) = didSlice.splitOnce(delimeterSlice);
        if (!found) {
            if (component.isEmpty()) revert IncorrectDid(did);

            return component.toString();
        }

        // Network component must not be empty.
        if (component.isEmpty()) revert IncorrectDid(did);

        // Identifier component must be the last segment and not empty.
        (found, component, ) = didSlice.splitOnce(delimeterSlice);
        if (found || component.isEmpty()) revert IncorrectDid(did);

        return component.toString();
    }

    /**
     * @dev Converts a given Ethereum identifier to an Ethereum address.
     * @param identifier The Ethereum identifier to be converted.
     * @return The Ethereum address derived from the identifier, or the zero address if the identifier is incorrect.
     */
    function convertEthereumIdentifierToAddress(string memory identifier) internal view returns (address) {
        uint256 identifierLength = StringUtils.length(identifier);
        if (
            identifierLength != _ADDRESS_HEX_STRING_LENGTH && identifierLength != _PUBLIC_KEY_64_HEX_STRING_LENGTH
                && identifierLength != _PUBLIC_KEY_65_HEX_STRING_LENGTH
        ) {
            return address(0);
        }

        bytes memory identifierBytes = StringUtils.hexToBytes(identifier);
        if (identifierBytes.length == 20) {
            return address(uint160(bytes20(identifierBytes)));
        }

        if (identifierBytes.length == 64) {
            return address(uint160(uint256(keccak256(identifierBytes))));
        }

        if (identifierBytes.length == 65 && identifierBytes[0] == 0x04) {
            bytes32 pubKeyHash;
            assembly {
                pubKeyHash := keccak256(add(identifierBytes, 0x21), 64)
            }
            return address(uint160(uint256(pubKeyHash)));
        }

        return address(0);
    }

    /**
     * @dev Checks if a given method string corresponds to the Ethereum method identifier.
     * @param method The method string to check.
     * @return Returns `true` if the method string matches the Ethereum method, `false` otherwise.
     */
    function isEthereumMethod(string memory method) internal pure returns (bool) {
        return method.toSlice().eq(DID_ETHR_METHOD.toSlice());
    }

    /**
     * @dev Checks if a given method string corresponds to the Indy-Besu method.
     * @param method The method string to check.
     * @return Returns `true` if the method string matches the Indy-Besu method, `false` otherwise.
     */
    function isIndyMethod(string memory method) internal pure returns (bool) {
        return method.toSlice().eq(DID_INDY_BESU_METHOD.toSlice());
    }
}
