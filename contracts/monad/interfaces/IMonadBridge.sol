// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IMonadBridge
 * @dev Interface for the Monad Bridge contract
 */
interface IMonadBridge {
    struct IncomingOrder {
        bytes32 ethereumOrderHash;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        bytes32 hashlock;
        uint256 timelock;
        address ethereumMaker;
        address monadReceiver;
        bool fulfilled;
        bool refunded;
        uint256 createdAt;
        bytes32 htlcContractId;
        address fulfiller;
    }

    /**
     * @dev Process an incoming order from Ethereum
     */
    function processEthereumOrder(
        bytes32 ethereumOrderHash,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 hashlock,
        uint256 timelock,
        address ethereumMaker,
        address monadReceiver
    ) external;

    /**
     * @dev Fulfill an incoming order
     */
    function fulfillIncomingOrder(
        bytes32 ethereumOrderHash,
        bytes32 secret
    ) external;

    /**
     * @dev Create an outgoing order to Ethereum
     */
    function createOutgoingOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address ethereumReceiver,
        uint256 targetChainId,
        uint256 customTimelock
    ) external returns (bytes32 orderHash);

    /**
     * @dev Get incoming order details
     */
    function getIncomingOrder(bytes32 ethereumOrderHash) external view returns (IncomingOrder memory);
}
