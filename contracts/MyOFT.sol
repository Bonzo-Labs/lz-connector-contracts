// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";

contract MyOFT is OFT {
    address public donationAddress = 0xbe058ee0884696653E01cfC6F34678f2762d84db;

    // Events for tracking and debugging
    event DonationSent(address to, uint256 amount);
    event MessageReceived(bytes32 guid, bytes message);

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {}

    // Allow the contract to receive HBAR
    receive() external payable {}

    // Allow the contract to receive HBAR via fallback
    fallback() external payable {}

    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address _executor,
        bytes calldata _extraData
    ) internal override {
        // Log the message for debugging purposes
        emit MessageReceived(_guid, _message);

        // Simple functionality - just send a donation if we have balance
        // No message parsing or interpretation
        if (address(this).balance >= 10) {
            // Safer approach - fixed donation without message interpretation
            payable(donationAddress).transfer(10);
            emit DonationSent(donationAddress, 10);
        }

        // Call the parent implementation to handle the token transfer
        super._lzReceive(_origin, _guid, _message, _executor, _extraData);
    }
}
