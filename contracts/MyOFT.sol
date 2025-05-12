// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {Origin} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";

/**
 * @title MyOFT
 * @dev Implementation of the OFT (Omnichain Fungible Token) contract with minting and burning capabilities
 */
contract MyOFT is OFT {
    /**
     * @dev Initializes the OFT token with name, symbol and LayerZero endpoint
     * @param _name Name of the token
     * @param _symbol Symbol of the token
     * @param _lzEndpoint Address of the LayerZero endpoint
     * @param _delegate Address that can perform OApp configuration
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {}

    /**
     * @dev Allows the contract to receive ETH
     */
    receive() external payable {}

    /**
     * @dev Fallback function that allows the contract to receive ETH
     */
    fallback() external payable {}

    /**
     * @notice Creates new tokens and assigns them to the specified address
     * @param _to Address to receive the minted tokens
     * @param _amount Amount of tokens to mint
     */
    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    /**
     * @notice Destroys tokens from the specified address
     * @param _from Address from which to burn tokens
     * @param _amount Amount of tokens to burn
     */
    function burn(address _from, uint256 _amount) public {
        _burn(_from, _amount);
    }
}
