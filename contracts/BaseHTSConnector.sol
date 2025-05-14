// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import "./hts/HederaTokenService.sol";
import "./hts/IHederaTokenService.sol";
import "./hts/KeyHelper.sol";
import "./HTSConnector.sol";

/**
 * @title BaseHTSConnector
 * @dev Extension of the HTSConnector contract with ownership and pausability features
 */
contract BaseHTSConnector is Ownable, Pausable, HTSConnector {
    /**
     * @dev Initializes the contract by setting token details and Layer Zero endpoints
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
    )
        payable
        HTSConnector(_name, _symbol, _lzEndpoint, _delegate)
        Ownable(_delegate)
    {}

    /**
     * @notice Pauses all token transfers and operations
     * @dev Can only be called by the contract owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses token transfers and operations
     * @dev Can only be called by the contract owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // TODO - Add onlyOwner back
    /**
     * @notice Mints new tokens and sends them to the specified recipient
     * @dev Can only be called by the contract owner when not paused
     * @param _to Address of the recipient
     * @param _amount Amount of tokens to mint (in smallest denomination)
     * @return success True if minting succeeded
     */
    function mint(
        address _to,
        uint256 _amount
    ) external whenNotPaused nonReentrant returns (bool success) {
        require(
            _amount <= uint64(type(int64).max),
            "BaseHTSConnector: amount exceeds int64 safe range"
        );

        // Mint tokens to contract
        (int256 mintResponse, , ) = HederaTokenService.mintToken(
            htsTokenAddress,
            int64(uint64(_amount)),
            new bytes[](0)
        );
        require(
            mintResponse == HederaTokenService.SUCCESS_CODE,
            "BaseHTSConnector: Mint failed"
        );

        // Transfer tokens to recipient
        int256 transferResponse = HederaTokenService.transferToken(
            htsTokenAddress,
            address(this),
            _to,
            int64(uint64(_amount))
        );
        require(
            transferResponse == HederaTokenService.SUCCESS_CODE,
            "BaseHTSConnector: Transfer failed"
        );

        return true;
    }

    /**
     * @notice Burns tokens from the specified address
     * @dev Can only be called by the contract owner when not paused
     * @param _from Address from which to burn tokens
     * @param _amount Amount of tokens to burn (in smallest denomination)
     * @return success True if burning succeeded
     */
    function burn(
        address _from,
        uint256 _amount
    ) external onlyOwner whenNotPaused nonReentrant returns (bool success) {
        require(
            _amount <= uint64(type(int64).max),
            "BaseHTSConnector: amount exceeds int64 safe range"
        );

        // Transfer tokens from user to contract
        int256 transferResponse = HederaTokenService.transferToken(
            htsTokenAddress,
            _from,
            address(this),
            int64(uint64(_amount))
        );
        require(
            transferResponse == HederaTokenService.SUCCESS_CODE,
            "BaseHTSConnector: Transfer failed"
        );

        // Burn tokens
        (int256 burnResponse, ) = HederaTokenService.burnToken(
            htsTokenAddress,
            int64(uint64(_amount)),
            new int64[](0)
        );
        require(
            burnResponse == HederaTokenService.SUCCESS_CODE,
            "BaseHTSConnector: Burn failed"
        );

        return true;
    }
}
