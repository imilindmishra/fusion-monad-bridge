// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MonadHTLC.sol";
import "./interfaces/IMonadBridge.sol";

/**
 * @title MonadBridge
 * @dev Mirror contract on Monad chain for handling cross-chain swaps from Ethereum
 * Coordinates with MonadHTLC for atomic swaps and manages cross-chain order fulfillment
 */
contract MonadBridge is ReentrancyGuard, Ownable, IMonadBridge {
    using SafeERC20 for IERC20;

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

    struct OutgoingOrder {
        bytes32 orderHash;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        bytes32 hashlock;
        uint256 timelock;
        address maker;
        address ethereumReceiver;
        bool isActive;
        uint256 targetChainId;
        bytes32 htlcContractId;
    }

    // Order management
    mapping(bytes32 => IncomingOrder) public incomingOrders;
    mapping(bytes32 => OutgoingOrder) public outgoingOrders;
    mapping(address => bytes32[]) public userIncomingOrders;
    mapping(address => bytes32[]) public userOutgoingOrders;

    // Cross-chain configuration
    mapping(uint256 => bool) public supportedChains;
    mapping(uint256 => address) public chainRelayers;
    mapping(address => bool) public authorizedRelayers;

    // Contract dependencies
    MonadHTLC public immutable htlcContract;

    // Configuration
    uint256 public defaultTimelock = 24 hours;
    uint256 public minTimelock = 1 hours;
    uint256 public maxTimelock = 7 days;

    // Events
    event IncomingOrderProcessed(
        bytes32 indexed ethereumOrderHash,
        bytes32 indexed monadOrderHash,
        address indexed monadReceiver,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 hashlock,
        uint256 timelock
    );

    event IncomingOrderFulfilled(
        bytes32 indexed ethereumOrderHash,
        bytes32 indexed monadOrderHash,
        bytes32 secret,
        address fulfiller
    );

    event OutgoingOrderCreated(
        bytes32 indexed orderHash,
        address indexed maker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 hashlock,
        uint256 timelock,
        uint256 targetChainId,
        address ethereumReceiver
    );

    event RelayerAuthorized(address indexed relayer, bool authorized);

    modifier onlyAuthorizedRelayer() {
        require(authorizedRelayers[msg.sender], "Not authorized relayer");
        _;
    }

    modifier validTimelock(uint256 _timelock) {
        require(_timelock >= minTimelock && _timelock <= maxTimelock, "Invalid timelock duration");
        _;
    }

    constructor(address _htlcContract) {
        require(_htlcContract != address(0), "Invalid HTLC contract address");
        htlcContract = MonadHTLC(_htlcContract);
        
        // Initialize supported chains
        supportedChains[1] = true; // Ethereum mainnet
        supportedChains[11155111] = true; // Sepolia testnet
    }

    /**
     * @dev Process an incoming order from Ethereum
     * Called by authorized relayers when an order is created on Ethereum
     * @param ethereumOrderHash The order hash from Ethereum
     * @param tokenIn Address of input token on Ethereum
     * @param tokenOut Address of desired output token on Monad
     * @param amountIn Amount of input tokens
     * @param amountOut Expected amount of output tokens
     * @param hashlock Hash of the secret from Ethereum order
     * @param timelock Timelock from Ethereum order
     * @param ethereumMaker Original maker address on Ethereum
     * @param monadReceiver Address to receive tokens on Monad
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
    ) 
        external 
        override
        onlyAuthorizedRelayer
        nonReentrant
    {
        require(ethereumOrderHash != bytes32(0), "Invalid Ethereum order hash");
        require(incomingOrders[ethereumOrderHash].ethereumOrderHash == bytes32(0), "Order already processed");
        require(monadReceiver != address(0), "Invalid receiver address");
        require(tokenOut != address(0), "Invalid output token");
        require(amountOut > 0, "Invalid output amount");
        require(timelock > block.timestamp, "Invalid timelock");

        // Generate unique hash for this Monad order
        bytes32 monadOrderHash = keccak256(abi.encodePacked(
            ethereumOrderHash,
            tokenOut,
            amountOut,
            monadReceiver,
            block.timestamp
        ));

        // Store incoming order
        incomingOrders[ethereumOrderHash] = IncomingOrder({
            ethereumOrderHash: ethereumOrderHash,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOut: amountOut,
            hashlock: hashlock,
            timelock: timelock,
            ethereumMaker: ethereumMaker,
            monadReceiver: monadReceiver,
            fulfilled: false,
            refunded: false,
            createdAt: block.timestamp,
            htlcContractId: bytes32(0), // Will be set when fulfilled
            fulfiller: address(0)
        });

        userIncomingOrders[monadReceiver].push(ethereumOrderHash);

        emit IncomingOrderProcessed(
            ethereumOrderHash,
            monadOrderHash,
            monadReceiver,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            hashlock,
            timelock
        );
    }

    /**
     * @dev Fulfill an incoming order by providing tokens and the secret
     * @param ethereumOrderHash The Ethereum order hash
     * @param secret The secret that unlocks the Ethereum HTLC
     */
    function fulfillIncomingOrder(
        bytes32 ethereumOrderHash,
        bytes32 secret
    )
        external
        override
        nonReentrant
    {
        IncomingOrder storage order = incomingOrders[ethereumOrderHash];
        require(order.ethereumOrderHash != bytes32(0), "Order does not exist");
        require(!order.fulfilled, "Order already fulfilled");
        require(!order.refunded, "Order already refunded");
        require(block.timestamp < order.timelock, "Order expired");

        // Verify secret matches hashlock
        require(keccak256(abi.encodePacked(secret)) == order.hashlock, "Invalid secret");

        // Create HTLC for the fulfiller to provide tokens
        bytes32 htlcContractId;
        if (order.tokenOut == address(0)) {
            // Native token
            require(msg.value == order.amountOut, "Incorrect native token amount");
            htlcContractId = htlcContract.newContract{value: order.amountOut}(
                order.monadReceiver,
                order.hashlock,
                order.timelock
            );
        } else {
            // ERC20 token
            IERC20(order.tokenOut).safeTransferFrom(msg.sender, address(this), order.amountOut);
            IERC20(order.tokenOut).safeApprove(address(htlcContract), order.amountOut);
            htlcContractId = htlcContract.newContractERC20(
                order.monadReceiver,
                order.hashlock,
                order.timelock,
                order.tokenOut,
                order.amountOut
            );
        }

        // Update order state
        order.fulfilled = true;
        order.fulfiller = msg.sender;
        order.htlcContractId = htlcContractId;

        // The HTLC can now be withdrawn by the receiver using the same secret
        
        emit IncomingOrderFulfilled(ethereumOrderHash, ethereumOrderHash, secret, msg.sender);
    }

    /**
     * @dev Create an outgoing order from Monad to Ethereum
     * @param tokenIn Address of input token on Monad
     * @param tokenOut Address of desired output token on Ethereum
     * @param amountIn Amount of input tokens
     * @param amountOut Expected amount of output tokens
     * @param ethereumReceiver Address to receive tokens on Ethereum
     * @param targetChainId Target chain identifier (Ethereum)
     * @param customTimelock Custom timelock duration (optional, use 0 for default)
     * @return orderHash Unique identifier for the created order
     */
    function createOutgoingOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address ethereumReceiver,
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
        require(ethereumReceiver != address(0), "Invalid receiver address");
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
            ethereumReceiver
        ));

        require(outgoingOrders[orderHash].maker == address(0), "Order already exists");

        // Create HTLC contract for locking funds
        bytes32 htlcContractId;
        if (tokenIn == address(0)) {
            // Native token
            require(msg.value == amountIn, "Incorrect native token amount");
            htlcContractId = htlcContract.newContract{value: amountIn}(
                address(this), // This contract as receiver for cross-chain coordination
                hashlock,
                block.timestamp + timelock
            );
        } else {
            // ERC20 token
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
        outgoingOrders[orderHash] = OutgoingOrder({
            orderHash: orderHash,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOut: amountOut,
            hashlock: hashlock,
            timelock: block.timestamp + timelock,
            maker: msg.sender,
            ethereumReceiver: ethereumReceiver,
            isActive: true,
            targetChainId: targetChainId,
            htlcContractId: htlcContractId
        });

        userOutgoingOrders[msg.sender].push(orderHash);

        emit OutgoingOrderCreated(
            orderHash,
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            hashlock,
            block.timestamp + timelock,
            targetChainId,
            ethereumReceiver
        );

        // Store secret for relayer (demo implementation)
        _storeSecretForRelayer(orderHash, secret);
    }

    /**
     * @dev Get incoming order details
     * @param ethereumOrderHash The Ethereum order hash
     * @return order The incoming order data
     */
    function getIncomingOrder(bytes32 ethereumOrderHash)
        external
        view
        override
        returns (IncomingOrder memory order)
    {
        return incomingOrders[ethereumOrderHash];
    }

    /**
     * @dev Get outgoing order details
     * @param orderHash The order hash
     * @return order The outgoing order data
     */
    function getOutgoingOrder(bytes32 orderHash)
        external
        view
        returns (OutgoingOrder memory order)
    {
        return outgoingOrders[orderHash];
    }

    /**
     * @dev Get user's incoming order history
     * @param user The user address
     * @return orderHashes Array of incoming order identifiers
     */
    function getUserIncomingOrders(address user)
        external
        view
        returns (bytes32[] memory orderHashes)
    {
        return userIncomingOrders[user];
    }

    /**
     * @dev Get user's outgoing order history
     * @param user The user address
     * @return orderHashes Array of outgoing order identifiers
     */
    function getUserOutgoingOrders(address user)
        external
        view
        returns (bytes32[] memory orderHashes)
    {
        return userOutgoingOrders[user];
    }

    /**
     * @dev Authorize or deauthorize a relayer
     * @param relayer The relayer address
     * @param authorized Whether to authorize or deauthorize
     */
    function setRelayerAuthorization(address relayer, bool authorized)
        external
        onlyOwner
    {
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorized(relayer, authorized);
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
     * @param orderHash The order identifier
     * @param secret The secret to store
     */
    function _storeSecretForRelayer(bytes32 orderHash, bytes32 secret) internal {
        // For demo purposes, emit an event that relayers can listen to
        emit SecretGenerated(orderHash, secret);
    }

    // Demo event for secret sharing (NOT for production)
    event SecretGenerated(bytes32 indexed orderHash, bytes32 secret);

    /**
     * @dev Emergency function to pause the contract
     */
    function pause() external onlyOwner {
        // Implementation would depend on using OpenZeppelin's Pausable
    }

    /**
     * @dev Batch process multiple incoming orders (Monad optimization)
     */
    function batchProcessEthereumOrders(
        bytes32[] calldata ethereumOrderHashes,
        address[] calldata tokensIn,
        address[] calldata tokensOut,
        uint256[] calldata amountsIn,
        uint256[] calldata amountsOut,
        bytes32[] calldata hashlocks,
        uint256[] calldata timelocks,
        address[] calldata ethereumMakers,
        address[] calldata monadReceivers
    ) external onlyAuthorizedRelayer {
        require(
            ethereumOrderHashes.length == tokensIn.length &&
            tokensIn.length == tokensOut.length &&
            tokensOut.length == amountsIn.length &&
            amountsIn.length == amountsOut.length &&
            amountsOut.length == hashlocks.length &&
            hashlocks.length == timelocks.length &&
            timelocks.length == ethereumMakers.length &&
            ethereumMakers.length == monadReceivers.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < ethereumOrderHashes.length; i++) {
            processEthereumOrder(
                ethereumOrderHashes[i],
                tokensIn[i],
                tokensOut[i],
                amountsIn[i],
                amountsOut[i],
                hashlocks[i],
                timelocks[i],
                ethereumMakers[i],
                monadReceivers[i]
            );
        }
    }
}
