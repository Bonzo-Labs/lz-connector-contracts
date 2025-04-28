// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BaseOFTAdapter is Ownable, OFTAdapter {
    using SafeERC20 for IERC20;

    struct LockedTransfer {
        address sender;
        uint256 amount;
        bool refunded;
    }

    mapping(bytes32 => LockedTransfer) public lockedTransfers;
    mapping(address => bytes32[]) public userTransfers;

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

    constructor(
        address _token,
        address _lzEndpoint,
        address _owner
    ) OFTAdapter(_token, _lzEndpoint, _owner) Ownable(_owner) {}

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    )
        external
        payable
        override
        returns (
            MessagingReceipt memory msgReceipt,
            OFTReceipt memory oftReceipt
        )
    {
        (msgReceipt, oftReceipt) = _send(_sendParam, _fee, _refundAddress);

        bytes32 id = msgReceipt.guid;
        lockedTransfers[id] = LockedTransfer({
            sender: msg.sender,
            amount: _sendParam.amountLD,
            refunded: false
        });
        userTransfers[msg.sender].push(id);

        emit TransferLocked(id, msg.sender, _sendParam.amountLD);
        return (msgReceipt, oftReceipt);
    }

    /// @notice Refund a failed transfer by its LayerZero message ID
    function refundTransfer(bytes32 lzMsgId) external onlyOwner {
        LockedTransfer storage lt = lockedTransfers[lzMsgId];
        require(lt.sender != address(0), "Nonexistent transfer");
        require(!lt.refunded, "Already refunded");

        lt.refunded = true;
        IERC20(token()).safeTransfer(lt.sender, lt.amount);

        emit TransferRefunded(lzMsgId, lt.sender, lt.amount);
    }

    /// @notice List of all transfers (including refunded) for a user
    function getTransfersByUser(
        address user
    ) external view returns (bytes32[] memory) {
        return userTransfers[user];
    }

    /// @notice Only active (non-refunded) transfers for a user
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
