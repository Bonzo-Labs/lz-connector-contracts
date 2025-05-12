// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BaseOFTAdapter
 * @dev Extends OFTAdapter to provide cross-chain token transfer functionality with
 * additional features like pausability, reentrancy protection and transfer tracking
 */
contract BaseOFTAdapter is Ownable, Pausable, ReentrancyGuard, OFTAdapter {
    using SafeERC20 for IERC20;

    /**
     * @dev Structure for tracking cross-chain token transfers
     * @param sender Address that initiated the transfer
     * @param amount Amount of tokens transferred
     * @param refunded Whether the transfer has been refunded
     */
    struct LockedTransfer {
        address sender;
        uint256 amount;
        bool refunded;
    }

    /// @dev Maps LayerZero message IDs to transfer details
    mapping(bytes32 => LockedTransfer) public lockedTransfers;
    /// @dev Maps user addresses to their transfer message IDs
    mapping(address => bytes32[]) public userTransfers;
    /// @dev User nonce to prevent message ID collisions
    mapping(address => uint256) public nonces;

    /**
     * @notice Emitted when a cross-chain transfer is initiated and tokens are locked
     * @param lzMsgId LayerZero message ID
     * @param sender Address that initiated the transfer
     * @param amount Amount of tokens locked
     */
    event TransferLocked(
        bytes32 indexed lzMsgId,
        address indexed sender,
        uint256 amount
    );

    /**
     * @notice Emitted when a failed transfer is refunded
     * @param lzMsgId LayerZero message ID
     * @param sender Address that receives the refund
     * @param amount Amount of tokens refunded
     */
    event TransferRefunded(
        bytes32 indexed lzMsgId,
        address indexed sender,
        uint256 amount
    );

    /**
     * @notice Emitted when old transfer records are cleared
     * @param user Address of the user whose records are cleared
     * @param count Number of records cleared
     */
    event TransferHistoryCleared(address indexed user, uint256 count);

    /**
     * @dev Initializes the adapter with token and endpoint information
     * @param _token Address of the ERC20 token
     * @param _lzEndpoint Address of the LayerZero endpoint
     * @param _owner Address of the contract owner
     */
    constructor(
        address _token,
        address _lzEndpoint,
        address _owner
    ) OFTAdapter(_token, _lzEndpoint, _owner) Ownable(_owner) {}

    /**
     * @notice Sends tokens to a recipient on another chain
     * @dev Overrides OFTAdapter's send function to add transfer tracking
     * @param _sendParam Parameters for the send operation
     * @param _fee LayerZero messaging fee
     * @param _refundAddress Address to refund excess fees
     * @return msgReceipt Receipt for the LayerZero message
     * @return oftReceipt Receipt for the OFT operation
     */
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    )
        external
        payable
        override
        whenNotPaused
        nonReentrant
        returns (
            MessagingReceipt memory msgReceipt,
            OFTReceipt memory oftReceipt
        )
    {
        require(_sendParam.to != bytes32(0), "Invalid recipient");
        require(_sendParam.amountLD > 0, "Invalid amount");

        (msgReceipt, oftReceipt) = _send(_sendParam, _fee, _refundAddress);

        bytes32 id = msgReceipt.guid;
        lockedTransfers[id] = LockedTransfer({
            sender: msg.sender,
            amount: _sendParam.amountLD,
            refunded: false
        });
        userTransfers[msg.sender].push(id);

        // Increment the nonce for future transfers
        nonces[msg.sender]++;

        emit TransferLocked(id, msg.sender, _sendParam.amountLD);
        return (msgReceipt, oftReceipt);
    }

    /**
     * @notice Pauses the contract, preventing new transfers
     * @dev Can only be called by the contract owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing transfers again
     * @dev Can only be called by the contract owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Refunds a failed cross-chain transfer
     * @dev Can only be called by the contract owner
     * @param lzMsgId The LayerZero message ID of the transfer to refund
     */
    function refundTransfer(bytes32 lzMsgId) external onlyOwner nonReentrant {
        LockedTransfer storage lt = lockedTransfers[lzMsgId];
        require(lt.sender != address(0), "Nonexistent transfer");
        require(!lt.refunded, "Already refunded");

        lt.refunded = true;
        IERC20(token()).safeTransfer(lt.sender, lt.amount);

        emit TransferRefunded(lzMsgId, lt.sender, lt.amount);
    }

    /**
     * @notice Removes oldest transfer records for a user to manage array growth
     * @dev Can be called by users to clear their own history or by admins for any user
     * @param user Address of the user whose transfer history to clear
     * @param count Number of oldest records to remove
     */
    function clearOldTransferRecords(
        address user,
        uint256 count
    ) external onlyOwner nonReentrant {
        bytes32[] storage userHistory = userTransfers[user];
        uint256 totalRecords = userHistory.length;

        // Can't remove more than the total number of records
        if (count > totalRecords) {
            count = totalRecords;
        }

        if (count > 0) {
            // Shift records to the left (remove oldest records first)
            for (uint256 i = 0; i < totalRecords - count; i++) {
                userHistory[i] = userHistory[i + count];
            }

            // Resize the array
            assembly {
                sstore(userHistory.slot, sub(totalRecords, count))
            }

            emit TransferHistoryCleared(user, count);
        }
    }

    /**
     * @notice Retrieves all transfers (including refunded) for a user
     * @param user The address of the user
     * @return Array of LayerZero message IDs for the user's transfers
     */
    function getTransfersByUser(
        address user
    ) external view returns (bytes32[] memory) {
        return userTransfers[user];
    }

    /**
     * @notice Retrieves only active (non-refunded) transfers for a user
     * @param user The address of the user
     * @return activeIds Array of LayerZero message IDs for active transfers
     * @return amounts Array of token amounts corresponding to each active transfer
     */
    function getActiveTransfersByUser(
        address user
    )
        external
        view
        returns (bytes32[] memory activeIds, uint256[] memory amounts)
    {
        bytes32[] memory all = userTransfers[user];
        uint256 total = all.length;
        // temp arrays sized to total
        activeIds = new bytes32[](total);
        amounts = new uint256[](total);
        uint256 cnt;

        for (uint i = 0; i < total; ++i) {
            bytes32 id = all[i];
            if (!lockedTransfers[id].refunded) {
                activeIds[cnt] = id;
                amounts[cnt] = lockedTransfers[id].amount;
                cnt++;
            }
        }

        // shrink arrays to actual count
        assembly {
            mstore(activeIds, cnt)
            mstore(amounts, cnt)
        }
    }
}
