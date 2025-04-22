// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BaseOFTAdapter with Transfer Reversion
 * @dev Extends the LayerZero OFTAdapter by recording cross-chain transfers.
 * The overridden send() function logs each locked transfer using a unique msgId,
 * so that if the destination chain mint fails the contract owner may later revert the transfer.
 */
contract BaseOFTAdapter is Ownable, OFTAdapter {
    using SafeERC20 for IERC20;

    // Transfer status enum for better state tracking
    enum TransferStatus {
        PENDING,
        COMPLETED,
        FAILED,
        REFUNDED
    }

    // Information about a locked transfer.
    struct LockedTransfer {
        address sender; // Original sender who initiated the transfer.
        uint256 amount; // Amount of tokens locked (in local decimals).
        TransferStatus status; // Current status of the transfer
        uint256 timestamp; // When the transfer was initiated
        bytes32 lzMsgId; // LayerZero message ID for tracking
    }

    // Mapping of transfer identifiers to pending transfer details.
    mapping(bytes32 => LockedTransfer) public pendingTransfers;
    // A nonce used to generate unique transfer IDs.
    uint256 public transferNonce;
    // Mapping from LayerZero message IDs to our internal message IDs for lookups
    mapping(bytes32 => bytes32) public lzMsgIdToMsgId;

    // Events to help with off-chain tracking and UI integration.
    event TransferLocked(
        bytes32 indexed msgId,
        address indexed sender,
        uint256 amount,
        bytes32 indexed lzMsgId
    );
    event TransferReverted(
        bytes32 indexed msgId,
        address indexed sender,
        uint256 amount,
        bytes32 indexed lzMsgId
    );
    event TransferCompleted(
        bytes32 indexed msgId,
        address indexed sender,
        uint256 amount,
        bytes32 indexed lzMsgId
    );
    event TransferFailed(
        bytes32 indexed msgId,
        address indexed sender,
        uint256 amount,
        bytes32 indexed lzMsgId
    );

    /**
     * @notice Constructor for BaseOFTAdapter.
     * @param _token The underlying ERC20 token address (e.g. wBTC).
     * @param _lzEndpoint The LayerZero endpoint address.
     * @param _delegate The delegate used for LayerZero configurations.
     */
    constructor(
        address _token,
        address _lzEndpoint,
        address _delegate
    ) OFTAdapter(_token, _lzEndpoint, _delegate) Ownable(_delegate) {}

    /**
     * @notice Overridden send function that records pending transfers.
     * @dev This function has the exact signature as in the original LayerZero implementation:
     *      - It calls the internal _send() function to execute the transfer.
     *      - Prior to that, it logs the transfer details (msgId, sender, amount) so that in case of a failure,
     *        an authorized operator (contract owner) can later call revertFailedTransfer() to unlock tokens.
     *
     * @param _sendParam The parameters for the send operation.
     * @param _fee The messaging fee details.
     * @param _refundAddress The address to receive any excess funds.
     * @return msgReceipt The LayerZero message receipt.
     * @return oftReceipt The OFT receipt information.
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
        // Generate a unique transfer ID.
        bytes32 msgId = keccak256(
            abi.encodePacked(
                msg.sender,
                _sendParam.amountLD,
                transferNonce,
                block.timestamp
            )
        );
        transferNonce++;

        // Call the internal _send() function to execute the transfer and get receipts
        (msgReceipt, oftReceipt) = _send(_sendParam, _fee, _refundAddress);

        // Store the LayerZero message ID for tracking
        bytes32 lzMsgId = msgReceipt.guid;

        // Record the pending transfer with the LayerZero message ID
        pendingTransfers[msgId] = LockedTransfer({
            sender: msg.sender,
            amount: _sendParam.amountLD,
            status: TransferStatus.PENDING,
            timestamp: block.timestamp,
            lzMsgId: lzMsgId
        });

        // Create a reverse mapping for easier lookups
        lzMsgIdToMsgId[lzMsgId] = msgId;

        emit TransferLocked(msgId, msg.sender, _sendParam.amountLD, lzMsgId);
    }

    /**
     * @notice Reverts (refunds) a failed cross-chain transfer.
     * @dev Only the contract owner can call this function.
     *      It should be invoked when the destination chain transaction fails (as confirmed off-chain)
     *      so that the locked tokens can be returned to the original sender.
     *
     * @param msgId The unique transfer identifier for the failed transfer.
     */
    function revertFailedTransfer(bytes32 msgId) external onlyOwner {
        LockedTransfer storage locked = pendingTransfers[msgId];
        require(locked.amount > 0, "Transfer does not exist");
        require(
            locked.status == TransferStatus.PENDING ||
                locked.status == TransferStatus.FAILED,
            "Transfer not eligible for refund"
        );

        locked.status = TransferStatus.REFUNDED;

        // Refund the locked tokens back to the original sender.
        IERC20(token()).safeTransfer(locked.sender, locked.amount);

        emit TransferReverted(
            msgId,
            locked.sender,
            locked.amount,
            locked.lzMsgId
        );
    }

    /**
     * @notice Updates a transfer status when a LayerZero receipt is confirmed
     * @dev This function allows the contract owner to update the status of a transfer
     *      based on monitoring of the LayerZero message status
     *
     * @param lzMsgId The LayerZero message ID to update
     * @param status The new status (COMPLETED or FAILED)
     */
    function updateTransferStatusByLzMsgId(
        bytes32 lzMsgId,
        TransferStatus status
    ) external onlyOwner {
        require(
            status == TransferStatus.COMPLETED ||
                status == TransferStatus.FAILED,
            "Status must be COMPLETED or FAILED"
        );

        bytes32 msgId = lzMsgIdToMsgId[lzMsgId];
        require(msgId != bytes32(0), "LayerZero message ID not found");

        LockedTransfer storage locked = pendingTransfers[msgId];
        require(
            locked.status == TransferStatus.PENDING,
            "Transfer not in pending state"
        );

        locked.status = status;

        if (status == TransferStatus.COMPLETED) {
            emit TransferCompleted(
                msgId,
                locked.sender,
                locked.amount,
                lzMsgId
            );
        } else {
            emit TransferFailed(msgId, locked.sender, locked.amount, lzMsgId);
        }
    }

    /**
     * @notice Updates a transfer status directly by msgId
     * @dev This function allows the contract owner to update the status of a transfer
     *
     * @param msgId The internal message ID to update
     * @param status The new status (COMPLETED or FAILED)
     */
    function updateTransferStatus(
        bytes32 msgId,
        TransferStatus status
    ) external onlyOwner {
        require(
            status == TransferStatus.COMPLETED ||
                status == TransferStatus.FAILED,
            "Status must be COMPLETED or FAILED"
        );

        LockedTransfer storage locked = pendingTransfers[msgId];
        require(locked.amount > 0, "Transfer does not exist");
        require(
            locked.status == TransferStatus.PENDING,
            "Transfer not in pending state"
        );

        locked.status = status;

        if (status == TransferStatus.COMPLETED) {
            emit TransferCompleted(
                msgId,
                locked.sender,
                locked.amount,
                locked.lzMsgId
            );
        } else {
            emit TransferFailed(
                msgId,
                locked.sender,
                locked.amount,
                locked.lzMsgId
            );
        }
    }

    /**
     * @notice Batch update multiple transfers by LayerZero message IDs
     * @dev Allows efficient updating of multiple transfers in a single transaction
     *
     * @param lzMsgIds Array of LayerZero message IDs
     * @param statuses Array of corresponding statuses to set
     */
    function batchUpdateByLzMsgIds(
        bytes32[] calldata lzMsgIds,
        TransferStatus[] calldata statuses
    ) external onlyOwner {
        require(lzMsgIds.length == statuses.length, "Array lengths must match");

        for (uint i = 0; i < lzMsgIds.length; i++) {
            updateTransferStatusByLzMsgId(lzMsgIds[i], statuses[i]);
        }
    }

    /**
     * @notice Get transfer details by LayerZero message ID
     * @dev External view function to look up transfer details using the LayerZero message ID
     *
     * @param lzMsgId The LayerZero message ID to look up
     * @return sender The address that initiated the transfer
     * @return amount The amount of tokens transferred
     * @return status The current status of the transfer
     * @return timestamp When the transfer was initiated
     * @return msgId Our internal message ID
     */
    function getTransferByLzMsgId(
        bytes32 lzMsgId
    )
        external
        view
        returns (
            address sender,
            uint256 amount,
            TransferStatus status,
            uint256 timestamp,
            bytes32 msgId
        )
    {
        msgId = lzMsgIdToMsgId[lzMsgId];
        require(msgId != bytes32(0), "LayerZero message ID not found");

        LockedTransfer memory locked = pendingTransfers[msgId];
        return (
            locked.sender,
            locked.amount,
            locked.status,
            locked.timestamp,
            msgId
        );
    }
}
