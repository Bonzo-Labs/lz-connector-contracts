// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {OFTCore} from "@layerzerolabs/oft-evm/contracts/OFTCore.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./hts/HederaTokenService.sol";
import "./hts/IHederaTokenService.sol";
import "./hts/KeyHelper.sol";

/**
 * @title HTS Connector
 * @dev A contract that extends OFTCore to create and interact with Hedera Token Service (HTS) tokens
 * that can be bridged across chains via LayerZero
 */
abstract contract HTSConnector is
    OFTCore,
    KeyHelper,
    HederaTokenService,
    Pausable,
    ReentrancyGuard
{
    /// @notice Address of the created HTS token
    address public htsTokenAddress;
    /// @notice Whether the token has a finite total supply
    bool public finiteTotalSupplyType = true;

    /// @notice Maximum number of transfer records that can be cleared at once
    uint256 public constant MAX_RECORDS_TO_CLEAR_AT_ONCE = 100;

    /// @notice Emitted when the HTS token is created
    /// @param tokenAddress Address of the created token
    event TokenCreated(address indexed tokenAddress);

    /**
     * @dev Structure representing a locked cross-chain transfer
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
    mapping(address => bytes32[]) internal userTransfers;
    /// @dev User nonce to prevent message ID collisions
    mapping(address => uint256) public nonces;

    /// @notice Emitted when a cross-chain transfer is locked
    /// @param lzMsgId LayerZero message ID
    /// @param sender Address that initiated the transfer
    /// @param amount Amount of tokens locked
    event TransferLocked(
        bytes32 indexed lzMsgId,
        address indexed sender,
        uint256 amount
    );

    /// @notice Emitted when a locked transfer is refunded
    /// @param lzMsgId LayerZero message ID
    /// @param sender Address that initiated the original transfer
    /// @param amount Amount of tokens refunded
    event TransferRefunded(
        bytes32 indexed lzMsgId,
        address indexed sender,
        uint256 amount
    );

    /// @notice Emitted when old transfer records are cleared
    /// @param user Address of the user whose records are cleared
    /// @param count Number of records cleared
    event TransferHistoryCleared(address indexed user, uint256 count);

    /**
     * @dev Creates a new HTS token and initializes the connector
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
    ) payable OFTCore(8, _lzEndpoint, _delegate) {
        IHederaTokenService.TokenKey[]
            memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = getSingleKey(
            KeyType.SUPPLY,
            KeyValueType.INHERIT_ACCOUNT_KEY,
            bytes("")
        );
        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry(
            0,
            address(this),
            8000000
        );
        IHederaTokenService.HederaToken memory token = IHederaTokenService
            .HederaToken(
                _name,
                _symbol,
                address(this),
                "memo",
                finiteTotalSupplyType,
                5000000000000000,
                false,
                keys,
                expiry
            );
        (int responseCode, address tokenAddress) = HederaTokenService
            .createFungibleToken(
                token,
                10000000000000,
                int32(int256(uint256(8)))
            );
        require(
            responseCode == HederaTokenService.SUCCESS_CODE,
            "Failed to create HTS token"
        );

        htsTokenAddress = tokenAddress;

        emit TokenCreated(tokenAddress);
    }

    /**
     * @notice Returns the address of the underlying token implementation
     * @return The address of the HTS token
     */
    function token() public view returns (address) {
        return htsTokenAddress;
    }

    /**
     * @notice Indicates whether the contract requires token approval to send tokens
     * @return requiresApproval False since HTS tokens don't use ERC20 approvals
     */
    function approvalRequired() external pure virtual returns (bool) {
        return false;
    }

    /**
     * @dev Processes the outgoing token transfer by burning tokens
     * @param _from The address to debit tokens from
     * @param _amountLD The amount of tokens to send in local decimals
     * @param _minAmountLD The minimum amount to send in local decimals
     * @param _dstEid The destination chain ID
     * @return amountSentLD The amount sent in local decimals
     * @return amountReceivedLD The amount to be received in local decimals on the remote chain
     */
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    )
        internal
        virtual
        override
        whenNotPaused
        nonReentrant
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        require(
            _amountLD <= uint64(type(int64).max),
            "HTSConnector: amount exceeds int64 safe range"
        );

        (amountSentLD, amountReceivedLD) = _debitView(
            _amountLD,
            _minAmountLD,
            _dstEid
        );

        int256 transferResponse = HederaTokenService.transferToken(
            htsTokenAddress,
            _from,
            address(this),
            int64(uint64(_amountLD))
        );
        require(
            transferResponse == HederaTokenService.SUCCESS_CODE,
            "HTS: Transfer failed"
        );

        // Store transfer details using LayerZero message ID with nonce
        bytes32 lzMsgId = keccak256(
            abi.encodePacked(_from, _amountLD, _dstEid, nonces[_from])
        );

        // Increment the nonce for future transfers
        nonces[_from]++;

        lockedTransfers[lzMsgId] = LockedTransfer({
            sender: _from,
            amount: _amountLD,
            refunded: false
        });

        // Record this transfer for the user
        userTransfers[_from].push(lzMsgId);

        emit TransferLocked(lzMsgId, _from, _amountLD);

        (int256 response, ) = HederaTokenService.burnToken(
            htsTokenAddress,
            int64(uint64(amountSentLD)),
            new int64[](0)
        );
        require(
            response == HederaTokenService.SUCCESS_CODE,
            "HTS: Burn failed"
        );
    }

    /**
     * @dev Processes the incoming token transfer by minting tokens
     * @param _to The address to credit tokens to
     * @param _amountLD The amount of tokens to credit in local decimals
     * @return The amount of tokens actually received in local decimals
     */
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 /*_srcEid*/
    ) internal virtual override whenNotPaused nonReentrant returns (uint256) {
        require(
            _amountLD <= uint64(type(int64).max),
            "HTSConnector: amount exceeds int64 safe range"
        );

        (int256 response, , ) = HederaTokenService.mintToken(
            htsTokenAddress,
            int64(uint64(_amountLD)),
            new bytes[](0)
        );
        require(
            response == HederaTokenService.SUCCESS_CODE,
            "HTS: Mint failed"
        );

        int256 transferResponse = HederaTokenService.transferToken(
            htsTokenAddress,
            address(this),
            _to,
            int64(uint64(_amountLD))
        );
        require(
            transferResponse == HederaTokenService.SUCCESS_CODE,
            "HTS: Transfer failed"
        );

        return _amountLD;
    }

    /**
     * @notice Refunds a failed cross-chain transfer
     * @dev Only the contract owner can call this function
     * @param lzMsgId The LayerZero message ID for the failed transfer
     */
    function refundLockedTransfer(
        bytes32 lzMsgId
    ) external onlyOwner whenNotPaused nonReentrant {
        LockedTransfer storage locked = lockedTransfers[lzMsgId];

        require(locked.sender != address(0), "Transfer does not exist");
        require(!locked.refunded, "Already refunded");

        // Mark as refunded first to prevent reentrancy
        locked.refunded = true;

        // Return tokens to original sender
        int256 transferResponse = HederaTokenService.transferToken(
            htsTokenAddress,
            address(this),
            locked.sender,
            int64(uint64(locked.amount))
        );
        require(
            transferResponse == HederaTokenService.SUCCESS_CODE,
            "HTS: Refund transfer failed"
        );

        emit TransferRefunded(lzMsgId, locked.sender, locked.amount);
    }

    /**
     * @notice Removes oldest transfer records for a user to manage array growth
     * @dev Can be called by owner for any user
     * @param user Address of the user whose transfer history to clear
     * @param count Number of oldest records to remove
     */
    function clearOldTransferRecords(
        address user,
        uint256 count
    ) external onlyOwner nonReentrant {
        require(
            count <= MAX_RECORDS_TO_CLEAR_AT_ONCE,
            "HTSConnector: Clearing too many records at once"
        );
        bytes32[] storage userHistory = userTransfers[user];
        uint256 totalRecords = userHistory.length;

        // Can't remove more than the total number of records
        if (count > totalRecords) {
            count = totalRecords;
        }

        if (count > 0) {
            // Create a memory array for the remaining records
            uint256 newSize = totalRecords - count;
            bytes32[] memory remainingRecords = new bytes32[](newSize);

            // Copy the records we want to keep to memory
            for (uint256 i = 0; i < newSize; i++) {
                remainingRecords[i] = userHistory[i + count];
            }

            // Clear the storage array
            while (userHistory.length > 0) {
                userHistory.pop();
            }

            // Push the remaining records back to storage
            for (uint256 i = 0; i < newSize; i++) {
                userHistory.push(remainingRecords[i]);
            }

            emit TransferHistoryCleared(user, count);
        }
    }

    /**
     * @notice Retrieves all transfers (including refunded) for a user
     * @param user The address of the user
     * @return An array of LayerZero message IDs for the user's transfers
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
