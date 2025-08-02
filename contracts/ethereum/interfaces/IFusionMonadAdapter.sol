// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IFusionMonadAdapter
 * @dev Interface for the Fusion Monad Adapter contract
 */
interface IFusionMonadAdapter {
    struct CrossChainOrder {
        bytes32 orderHash;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        bytes32 hashlock;
        uint256 timelock;
        address maker;
        address monadReceiver;
        uint256 chainId;
        bool isActive;
        bool isFulfilled;
        uint256 createdAt;
        bytes32 htlcContractId;
    }

    /**
     * @dev Create a cross-chain order
     */
    function createCrossChainOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address monadReceiver,
        uint256 targetChainId,
        uint256 customTimelock
    ) external returns (bytes32 orderHash);

    /**
     * @dev Fulfill an order by providing the secret
     */
    function fulfillOrder(bytes32 orderHash, bytes32 secret) external;

    /**
     * @dev Refund an expired order
     */
    function refund(bytes32 orderHash) external;

    /**
     * @dev Get order details
     */
    function getOrder(bytes32 orderHash) external view returns (CrossChainOrder memory);
}
