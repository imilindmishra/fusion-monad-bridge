// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HTLC
 * @notice Hash Time-Locked Contract supporting native ETH and optional ERC20 token.
 *         Uses SHA-256 for hashlock to maximize cross-chain compatibility.
 */
contract HTLC is ReentrancyGuard {
	using SafeERC20 for IERC20;

	enum State {
		Empty,
		Locked,
		Claimed,
		Refunded
	}

	address public immutable sender;
	address public immutable receiver;
	bytes32 public immutable hashlock; // sha256(secret)
	uint256 public immutable timelock; // unix timestamp

	IERC20 public immutable token; // zero address indicates native ETH flow

	uint256 public lockedAmount; // amount of ETH or ERC20 currently escrowed
	State public state;

	event Locked(address indexed sender, address indexed receiver, uint256 amount, address token);
	event Claimed(address indexed receiver, bytes32 secret);
	event Refunded(address indexed sender);

	error InvalidReceiver();
	error InvalidHashlock();
	error TimelockInPast();
	error NotLocked();
	error WrongState(State expected, State actual);
	error TimelockNotExpired(uint256 nowTs, uint256 timelockTs);
	error WrongHashlock();
	error ZeroAmount();

	constructor(
		address _receiver,
		bytes32 _hashlock,
		uint256 _timelock,
		address _token
	) {
		if (_receiver == address(0)) revert InvalidReceiver();
		if (_hashlock == bytes32(0)) revert InvalidHashlock();
		if (_timelock <= block.timestamp) revert TimelockInPast();

		sender = msg.sender;
		receiver = _receiver;
		hashlock = _hashlock;
		timelock = _timelock;
		token = IERC20(_token);
		state = State.Empty;
	}

	function getState() external view returns (State) {
		return state;
	}

	// Native ETH lock
	function lock() external payable nonReentrant {
		if (address(token) != address(0)) revert WrongState(State.Empty, state);
		if (state != State.Empty) revert WrongState(State.Empty, state);
		if (msg.value == 0) revert ZeroAmount();

		lockedAmount = msg.value;
		state = State.Locked;

		emit Locked(msg.sender, receiver, msg.value, address(0));
	}

	// ERC20 lock
	function lockERC20(uint256 amount) external nonReentrant {
		if (address(token) == address(0)) revert WrongState(State.Empty, state);
		if (state != State.Empty) revert WrongState(State.Empty, state);
		if (amount == 0) revert ZeroAmount();

		lockedAmount = amount;
		state = State.Locked;

		token.safeTransferFrom(msg.sender, address(this), amount);
		emit Locked(msg.sender, receiver, amount, address(token));
	}

	function claim(bytes32 secret) external nonReentrant {
		if (state != State.Locked) revert NotLocked();
		if (sha256(abi.encodePacked(secret)) != hashlock) revert WrongHashlock();

		state = State.Claimed;
		uint256 amount = lockedAmount;
		lockedAmount = 0;

		if (address(token) == address(0)) {
			(bool ok, ) = receiver.call{value: amount}("");
			require(ok, "ETH transfer failed");
		} else {
			token.safeTransfer(receiver, amount);
		}

		emit Claimed(receiver, secret);
	}

	function refund() external nonReentrant {
		if (state != State.Locked) revert NotLocked();
		if (block.timestamp < timelock) revert TimelockNotExpired(block.timestamp, timelock);

		state = State.Refunded;
		uint256 amount = lockedAmount;
		lockedAmount = 0;

		if (address(token) == address(0)) {
			(bool ok, ) = payable(sender).call{value: amount}("");
			require(ok, "ETH refund failed");
		} else {
			token.safeTransfer(sender, amount);
		}

		emit Refunded(sender);
	}
}
