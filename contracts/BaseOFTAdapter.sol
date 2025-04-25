// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BaseOFTAdapter
 * @dev Base extension of LayerZero OFTAdapter that tracks cross-chain transfers
 * and allows refunding locked tokens if the destination chain mint fails.
 */
contract BaseOFTAdapter is Ownable, OFTAdapter {
    using SafeERC20 for IERC20;

    // Simple transfer record
    struct LockedTransfer {
        address sender;
        uint256 amount;
        bool refunded;
    }

    // Mapping of LayerZero message IDs to transfer details
    mapping(bytes32 => LockedTransfer) public lockedTransfers;

    // Events
    event TransferLocked(
        bytes32 indexed lzMsgId,
        address indexed sender,
        uint256 amount
    );
    event TransferRefunded(
        bytes32 indexed lzMsgId,
        address indexed sender,
        uint256 amount
    );

    /**
     * @notice Constructor
     * @param _token The underlying ERC20 token address
     * @param _lzEndpoint The LayerZero endpoint address
     * @param _owner The owner address
     */
    constructor(
        address _token,
        address _lzEndpoint,
        address _owner
    ) OFTAdapter(_token, _lzEndpoint, _owner) Ownable(_owner) {}

    /**
     * @notice Overridden send function to track locked transfers
     * @param _sendParam The parameters for the send operation
     * @param _fee The messaging fee details
     * @param _refundAddress The address to receive any excess funds
     * @return msgReceipt The LayerZero message receipt
     * @return oftReceipt The OFT receipt information
     */
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    )
        external
        payable
        virtual
        override
        returns (
            MessagingReceipt memory msgReceipt,
            OFTReceipt memory oftReceipt
        )
    {
        // Execute the standard OFT send operation
        (msgReceipt, oftReceipt) = _send(_sendParam, _fee, _refundAddress);

        // Store transfer details using LayerZero message ID
        bytes32 lzMsgId = msgReceipt.guid;
        lockedTransfers[lzMsgId] = LockedTransfer({
            sender: msg.sender,
            amount: _sendParam.amountLD,
            refunded: false
        });

        emit TransferLocked(lzMsgId, msg.sender, _sendParam.amountLD);

        return (msgReceipt, oftReceipt);
    }

    /**
     * @notice Refunds a failed cross-chain transfer
     * @dev Only the contract owner can call this function
     * @param lzMsgId The LayerZero message ID for the failed transfer
     */
    function refundLockedTransfer(bytes32 lzMsgId) external onlyOwner {
        LockedTransfer storage locked = lockedTransfers[lzMsgId];

        require(locked.sender != address(0), "Transfer does not exist");
        require(!locked.refunded, "Already refunded");

        // Mark as refunded first to prevent reentrancy
        locked.refunded = true;

        // Return tokens to original sender
        IERC20(token()).safeTransfer(locked.sender, locked.amount);

        emit TransferRefunded(lzMsgId, locked.sender, locked.amount);
    }
}
