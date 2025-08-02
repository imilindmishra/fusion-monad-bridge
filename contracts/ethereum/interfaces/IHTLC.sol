// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IHTLC
 * @dev Interface for Hash Time Locked Contracts
 */
interface IHTLC {
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

    /**
     * @dev Create a new HTLC for ETH
     */
    function newContract(
        address receiver,
        bytes32 hashlock,
        uint256 timelock
    ) external payable returns (bytes32 contractId);

    /**
     * @dev Create a new HTLC for ERC20 tokens
     */
    function newContractERC20(
        address receiver,
        bytes32 hashlock,
        uint256 timelock,
        address token,
        uint256 amount
    ) external returns (bytes32 contractId);

    /**
     * @dev Withdraw funds by providing the secret
     */
    function withdraw(bytes32 contractId, bytes32 secret) external;

    /**
     * @dev Refund funds after timelock expires
     */
    function refund(bytes32 contractId) external;

    /**
     * @dev Get contract details
     */
    function getContract(bytes32 contractId) external view returns (HTLCData memory);
}
