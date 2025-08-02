// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title MonadHTLC
 * @dev Hash Time Locked Contract implementation for Monad
 * Identical functionality to EthereumHTLC but optimized for Monad's high throughput
 */
contract MonadHTLC is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct HTLCData {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        uint256 createdAt;
    }

    mapping(bytes32 => HTLCData) public contracts;
    
    event HTLCCreated(
        bytes32 indexed contractId,
        address indexed sender,
        address indexed receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    );
    
    event HTLCWithdrawn(
        bytes32 indexed contractId,
        bytes32 secret
    );
    
    event HTLCRefunded(
        bytes32 indexed contractId
    );

    modifier fundsSent() {
        require(msg.value > 0, "funds must be sent");
        _;
    }

    modifier futureTimelock(uint256 _time) {
        require(_time > block.timestamp, "timelock time must be in the future");
        _;
    }

    modifier contractExists(bytes32 _contractId) {
        require(_contractExists(_contractId), "contract does not exist");
        _;
    }

    modifier hashlockMatches(bytes32 _contractId, bytes32 _secret) {
        require(
            contracts[_contractId].hashlock == keccak256(abi.encodePacked(_secret)),
            "hashlock hash does not match"
        );
        _;
    }

    modifier withdrawable(bytes32 _contractId) {
        require(contracts[_contractId].receiver == msg.sender, "withdrawable: not receiver");
        require(contracts[_contractId].withdrawn == false, "withdrawable: already withdrawn");
        require(contracts[_contractId].timelock > block.timestamp, "withdrawable: timelock time must be in the future");
        _;
    }

    modifier refundable(bytes32 _contractId) {
        require(contracts[_contractId].sender == msg.sender, "refundable: not sender");
        require(contracts[_contractId].refunded == false, "refundable: already refunded");
        require(contracts[_contractId].withdrawn == false, "refundable: already withdrawn");
        require(contracts[_contractId].timelock <= block.timestamp, "refundable: timelock not yet passed");
        _;
    }

    /**
     * @dev Create a new HTLC for native Monad tokens
     * @param _receiver The address that can withdraw funds
     * @param _hashlock Hash of the secret
     * @param _timelock Timestamp when refund becomes possible
     * @return contractId The unique identifier for this HTLC
     */
    function newContract(
        address _receiver,
        bytes32 _hashlock,
        uint256 _timelock
    )
        external
        payable
        fundsSent
        futureTimelock(_timelock)
        returns (bytes32 contractId)
    {
        contractId = keccak256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                msg.value,
                _hashlock,
                _timelock,
                block.timestamp
            )
        );

        require(!_contractExists(contractId), "contract already exists");

        contracts[contractId] = HTLCData(
            msg.sender,
            _receiver,
            address(0), // Native token
            msg.value,
            _hashlock,
            _timelock,
            false,
            false,
            block.timestamp
        );

        emit HTLCCreated(
            contractId,
            msg.sender,
            _receiver,
            address(0),
            msg.value,
            _hashlock,
            _timelock
        );
    }

    /**
     * @dev Create a new HTLC for ERC20 tokens on Monad
     * @param _receiver The address that can withdraw funds
     * @param _hashlock Hash of the secret
     * @param _timelock Timestamp when refund becomes possible
     * @param _token The ERC20 token contract address
     * @param _amount The amount of tokens to lock
     * @return contractId The unique identifier for this HTLC
     */
    function newContractERC20(
        address _receiver,
        bytes32 _hashlock,
        uint256 _timelock,
        address _token,
        uint256 _amount
    )
        external
        futureTimelock(_timelock)
        returns (bytes32 contractId)
    {
        require(_amount > 0, "token amount must be greater than 0");
        require(_token != address(0), "token address cannot be zero");

        contractId = keccak256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                _token,
                _amount,
                _hashlock,
                _timelock,
                block.timestamp
            )
        );

        require(!_contractExists(contractId), "contract already exists");

        contracts[contractId] = HTLCData(
            msg.sender,
            _receiver,
            _token,
            _amount,
            _hashlock,
            _timelock,
            false,
            false,
            block.timestamp
        );

        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        emit HTLCCreated(
            contractId,
            msg.sender,
            _receiver,
            _token,
            _amount,
            _hashlock,
            _timelock
        );
    }

    /**
     * @dev Withdraw funds by providing the secret
     * @param _contractId The HTLC contract identifier
     * @param _secret The secret that hashes to the hashlock
     */
    function withdraw(bytes32 _contractId, bytes32 _secret)
        external
        contractExists(_contractId)
        hashlockMatches(_contractId, _secret)
        withdrawable(_contractId)
        nonReentrant
    {
        HTLCData storage htlc = contracts[_contractId];
        htlc.withdrawn = true;

        if (htlc.token == address(0)) {
            // Native token transfer
            (bool success, ) = htlc.receiver.call{value: htlc.amount}("");
            require(success, "Native token transfer failed");
        } else {
            // ERC20 transfer
            IERC20(htlc.token).safeTransfer(htlc.receiver, htlc.amount);
        }

        emit HTLCWithdrawn(_contractId, _secret);
    }

    /**
     * @dev Refund funds after timelock expires
     * @param _contractId The HTLC contract identifier
     */
    function refund(bytes32 _contractId)
        external
        contractExists(_contractId)
        refundable(_contractId)
        nonReentrant
    {
        HTLCData storage htlc = contracts[_contractId];
        htlc.refunded = true;

        if (htlc.token == address(0)) {
            // Native token refund
            (bool success, ) = htlc.sender.call{value: htlc.amount}("");
            require(success, "Native token refund failed");
        } else {
            // ERC20 refund
            IERC20(htlc.token).safeTransfer(htlc.sender, htlc.amount);
        }

        emit HTLCRefunded(_contractId);
    }

    /**
     * @dev Get contract details
     * @param _contractId The HTLC contract identifier
     * @return HTLCData The contract data
     */
    function getContract(bytes32 _contractId)
        external
        view
        returns (HTLCData memory)
    {
        return contracts[_contractId];
    }

    /**
     * @dev Check if contract exists
     * @param _contractId The HTLC contract identifier
     * @return bool True if contract exists
     */
    function _contractExists(bytes32 _contractId) internal view returns (bool) {
        return contracts[_contractId].sender != address(0);
    }

    /**
     * @dev Get the remaining time until timelock expires
     * @param _contractId The HTLC contract identifier
     * @return uint256 Remaining time in seconds
     */
    function getRemainingTime(bytes32 _contractId) 
        external 
        view 
        contractExists(_contractId) 
        returns (uint256) 
    {
        HTLCData memory htlc = contracts[_contractId];
        if (block.timestamp >= htlc.timelock) {
            return 0;
        }
        return htlc.timelock - block.timestamp;
    }

    /**
     * @dev Check if funds can be withdrawn
     * @param _contractId The HTLC contract identifier
     * @return bool True if withdrawable
     */
    function isWithdrawable(bytes32 _contractId) 
        external 
        view 
        contractExists(_contractId) 
        returns (bool) 
    {
        HTLCData memory htlc = contracts[_contractId];
        return !htlc.withdrawn && !htlc.refunded && block.timestamp < htlc.timelock;
    }

    /**
     * @dev Check if funds can be refunded
     * @param _contractId The HTLC contract identifier
     * @return bool True if refundable
     */
    function isRefundable(bytes32 _contractId) 
        external 
        view 
        contractExists(_contractId) 
        returns (bool) 
    {
        HTLCData memory htlc = contracts[_contractId];
        return !htlc.withdrawn && !htlc.refunded && block.timestamp >= htlc.timelock;
    }

    /**
     * @dev Batch create multiple HTLCs (Monad optimization)
     * Optimized for Monad's high throughput to handle multiple contracts efficiently
     */
    function batchNewContracts(
        address[] calldata _receivers,
        bytes32[] calldata _hashlocks,
        uint256[] calldata _timelocks,
        address[] calldata _tokens,
        uint256[] calldata _amounts
    ) external returns (bytes32[] memory contractIds) {
        require(
            _receivers.length == _hashlocks.length &&
            _hashlocks.length == _timelocks.length &&
            _timelocks.length == _tokens.length &&
            _tokens.length == _amounts.length,
            "Array length mismatch"
        );

        contractIds = new bytes32[](_receivers.length);

        for (uint256 i = 0; i < _receivers.length; i++) {
            contractIds[i] = newContractERC20(
                _receivers[i],
                _hashlocks[i],
                _timelocks[i],
                _tokens[i],
                _amounts[i]
            );
        }
    }

    /**
     * @dev Batch withdraw from multiple HTLCs (Monad optimization)
     */
    function batchWithdraw(
        bytes32[] calldata _contractIds,
        bytes32[] calldata _secrets
    ) external {
        require(_contractIds.length == _secrets.length, "Array length mismatch");

        for (uint256 i = 0; i < _contractIds.length; i++) {
            withdraw(_contractIds[i], _secrets[i]);
        }
    }
}
