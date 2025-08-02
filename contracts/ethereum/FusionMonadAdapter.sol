// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./EthereumHTLC.sol";
import "./interfaces/IFusionMonadAdapter.sol";

/**
 * @title FusionMonadAdapter
 * @dev Integrates with 1inch Fusion+ protocol for cross-chain swaps to Monad
 * Manages cross-chain order creation and execution using HTLCs
 */
contract FusionMonadAdapter is ReentrancyGuard, Ownable, IFusionMonadAdapter {
    using SafeERC20 for IERC20;

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

    // Order management
    mapping(bytes32 => CrossChainOrder) public orders;
    mapping(address => bytes32[]) public userOrders;
    
    // Cross-chain configuration
    mapping(uint256 => bool) public supportedChains;
    mapping(uint256 => address) public chainRelayers;
    
    // Contract dependencies
    EthereumHTLC public immutable htlcContract;
    
    // Configuration
    uint256 public defaultTimelock = 24 hours;
    uint256 public minTimelock = 1 hours;
    uint256 public maxTimelock = 7 days;
    
    // Events
    event CrossChainOrderCreated(
        bytes32 indexed orderHash,
        address indexed maker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 hashlock,
        uint256 timelock,
        uint256 targetChainId,
        address monadReceiver
    );
    
    event CrossChainOrderFulfilled(
        bytes32 indexed orderHash,
        bytes32 secret,
        address fulfiller
    );
    
    event CrossChainOrderRefunded(
        bytes32 indexed orderHash,
        address maker
    );
    
    event RelayerUpdated(
        uint256 indexed chainId,
        address relayer
    );

    modifier validTimelock(uint256 _timelock) {
        require(_timelock >= minTimelock && _timelock <= maxTimelock, "Invalid timelock duration");
        _;
    }

    modifier onlyRelayer(uint256 _chainId) {
        require(chainRelayers[_chainId] == msg.sender, "Only authorized relayer");
        _;
    }

    modifier orderExists(bytes32 _orderHash) {
        require(orders[_orderHash].maker != address(0), "Order does not exist");
        _;
    }

    modifier orderActive(bytes32 _orderHash) {
        require(orders[_orderHash].isActive, "Order is not active");
        _;
    }

    constructor(address _htlcContract) {
        require(_htlcContract != address(0), "Invalid HTLC contract address");
        htlcContract = EthereumHTLC(_htlcContract);
        
        // Initialize supported chains
        supportedChains[1] = true; // Ethereum mainnet
        supportedChains[11155111] = true; // Sepolia testnet
        // Monad chain ID will be added when available
    }

    /**
     * @dev Create a cross-chain order for swapping tokens from Ethereum to Monad
     * @param tokenIn Address of input token on Ethereum
     * @param tokenOut Address of desired output token on Monad
     * @param amountIn Amount of input tokens
     * @param amountOut Expected amount of output tokens
     * @param monadReceiver Address to receive tokens on Monad
     * @param targetChainId Target chain identifier (Monad)
     * @param customTimelock Custom timelock duration (optional, use 0 for default)
     * @return orderHash Unique identifier for the created order
     */
    function createCrossChainOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address monadReceiver,
        uint256 targetChainId,
        uint256 customTimelock
    ) 
        external 
        override
        nonReentrant
        returns (bytes32 orderHash) 
    {
        require(supportedChains[targetChainId], "Unsupported target chain");
        require(amountIn > 0 && amountOut > 0, "Invalid amounts");
        require(monadReceiver != address(0), "Invalid receiver address");
        require(tokenIn != address(0), "Invalid input token");
        require(tokenOut != address(0), "Invalid output token");

        uint256 timelock = customTimelock == 0 ? defaultTimelock : customTimelock;
        require(timelock >= minTimelock && timelock <= maxTimelock, "Invalid timelock");

        // Generate unique hashlock for this order
        bytes32 secret = keccak256(abi.encodePacked(
            msg.sender,
            block.timestamp,
            block.difficulty,
            amountIn,
            amountOut
        ));
        bytes32 hashlock = keccak256(abi.encodePacked(secret));

        // Create order hash
        orderHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            hashlock,
            block.timestamp + timelock,
            targetChainId,
            monadReceiver
        ));

        require(orders[orderHash].maker == address(0), "Order already exists");

        // Create HTLC contract for locking funds
        bytes32 htlcContractId;
        if (tokenIn == address(0)) {
            // ETH swap
            require(msg.value == amountIn, "Incorrect ETH amount");
            htlcContractId = htlcContract.newContract{value: amountIn}(
                address(this), // This contract as receiver for cross-chain coordination
                hashlock,
                block.timestamp + timelock
            );
        } else {
            // ERC20 swap
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(tokenIn).safeApprove(address(htlcContract), amountIn);
            htlcContractId = htlcContract.newContractERC20(
                address(this), // This contract as receiver for cross-chain coordination
                hashlock,
                block.timestamp + timelock,
                tokenIn,
                amountIn
            );
        }

        // Store order
        orders[orderHash] = CrossChainOrder({
            orderHash: orderHash,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOut: amountOut,
            hashlock: hashlock,
            timelock: block.timestamp + timelock,
            maker: msg.sender,
            monadReceiver: monadReceiver,
            chainId: targetChainId,
            isActive: true,
            isFulfilled: false,
            createdAt: block.timestamp,
            htlcContractId: htlcContractId
        });

        userOrders[msg.sender].push(orderHash);

        emit CrossChainOrderCreated(
            orderHash,
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            hashlock,
            block.timestamp + timelock,
            targetChainId,
            monadReceiver
        );

        // Store secret securely (in production, this would be handled differently)
        // For demo purposes, we'll emit it in a way that can be captured by relayers
        // In production, this would use a more secure method
        _storeSecretForRelayer(orderHash, secret);
    }

    /**
     * @dev Fulfill a cross-chain order by providing the secret
     * @param orderHash The order identifier
     * @param secret The secret that unlocks the HTLC
     */
    function fulfillOrder(bytes32 orderHash, bytes32 secret)
        external
        override
        orderExists(orderHash)
        orderActive(orderHash)
        nonReentrant
    {
        CrossChainOrder storage order = orders[orderHash];
        
        // Verify secret matches hashlock
        require(keccak256(abi.encodePacked(secret)) == order.hashlock, "Invalid secret");
        
        // Mark order as fulfilled
        order.isFulfilled = true;
        order.isActive = false;

        // Withdraw from HTLC
        htlcContract.withdraw(order.htlcContractId, secret);

        emit CrossChainOrderFulfilled(orderHash, secret, msg.sender);
    }

    /**
     * @dev Refund an expired cross-chain order
     * @param orderHash The order identifier
     */
    function refund(bytes32 orderHash)
        external
        override
        orderExists(orderHash)
        nonReentrant
    {
        CrossChainOrder storage order = orders[orderHash];
        require(order.maker == msg.sender, "Only maker can refund");
        require(!order.isFulfilled, "Order already fulfilled");
        require(block.timestamp >= order.timelock, "Timelock not expired");

        order.isActive = false;

        // Refund from HTLC
        htlcContract.refund(order.htlcContractId);

        emit CrossChainOrderRefunded(orderHash, msg.sender);
    }

    /**
     * @dev Get order details
     * @param orderHash The order identifier
     * @return order The order data
     */
    function getOrder(bytes32 orderHash) 
        external 
        view 
        override
        returns (CrossChainOrder memory order) 
    {
        return orders[orderHash];
    }

    /**
     * @dev Get user's order history
     * @param user The user address
     * @return orderHashes Array of order identifiers
     */
    function getUserOrders(address user) 
        external 
        view 
        returns (bytes32[] memory orderHashes) 
    {
        return userOrders[user];
    }

    /**
     * @dev Update relayer for a specific chain
     * @param chainId The chain identifier
     * @param relayer The relayer address
     */
    function updateRelayer(uint256 chainId, address relayer) 
        external 
        onlyOwner 
    {
        chainRelayers[chainId] = relayer;
        emit RelayerUpdated(chainId, relayer);
    }

    /**
     * @dev Add support for a new chain
     * @param chainId The chain identifier to support
     */
    function addSupportedChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = true;
    }

    /**
     * @dev Remove support for a chain
     * @param chainId The chain identifier to remove
     */
    function removeSupportedChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = false;
    }

    /**
     * @dev Update timelock parameters
     * @param _minTimelock Minimum timelock duration
     * @param _maxTimelock Maximum timelock duration
     * @param _defaultTimelock Default timelock duration
     */
    function updateTimelockParams(
        uint256 _minTimelock,
        uint256 _maxTimelock,
        uint256 _defaultTimelock
    ) external onlyOwner {
        require(_minTimelock < _maxTimelock, "Invalid timelock range");
        require(_defaultTimelock >= _minTimelock && _defaultTimelock <= _maxTimelock, "Invalid default timelock");
        
        minTimelock = _minTimelock;
        maxTimelock = _maxTimelock;
        defaultTimelock = _defaultTimelock;
    }

    /**
     * @dev Internal function to store secret for relayer (demo implementation)
     * In production, this would use a more secure method like encryption
     * @param orderHash The order identifier
     * @param secret The secret to store
     */
    function _storeSecretForRelayer(bytes32 orderHash, bytes32 secret) internal {
        // For demo purposes, emit an event that relayers can listen to
        // In production, this would be encrypted or use a secure communication channel
        emit SecretGenerated(orderHash, secret);
    }

    // Demo event for secret sharing (NOT for production)
    event SecretGenerated(bytes32 indexed orderHash, bytes32 secret);

    /**
     * @dev Emergency function to pause the contract
     */
    function pause() external onlyOwner {
        // Implementation would depend on using OpenZeppelin's Pausable
        // For now, this is a placeholder
    }

    /**
     * @dev Get contract statistics
     * @return totalOrders Total number of orders created
     * @return activeOrders Number of active orders
     * @return fulfilledOrders Number of fulfilled orders
     */
    function getStats() external view returns (
        uint256 totalOrders,
        uint256 activeOrders,
        uint256 fulfilledOrders
    ) {
        // This would require additional state tracking in a production implementation
        // Placeholder for demo
        return (0, 0, 0);
    }
}
