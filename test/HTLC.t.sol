// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HTLC} from "../src/HTLC.sol";

contract HTLCTest is Test {
	HTLC htlcEth;
	address sender = address(0xA11CE);
	address receiver = address(0xB0B);
	bytes32 secret = bytes32(uint256(0x1234));
	bytes32 hashlock = sha256(abi.encodePacked(bytes32(uint256(0x1234))));

	function setUp() public {
		vm.warp(1_700_000_000);
		vm.deal(sender, 10 ether);
		vm.prank(sender);
		htlcEth = new HTLC(receiver, hashlock, block.timestamp + 1 days, address(0));
	}

	function test_lock_eth_and_claim() public {
		vm.prank(sender);
		htlcEth.lock{value: 1 ether}();
		assertEq(address(htlcEth).balance, 1 ether);

		uint256 beforeBal = receiver.balance;
		vm.prank(receiver);
		htlcEth.claim(secret);
		assertEq(receiver.balance, beforeBal + 1 ether);
	}

	function test_refund_after_timelock() public {
		vm.prank(sender);
		htlcEth.lock{value: 1 ether}();
		uint256 beforeBal = sender.balance;
		vm.warp(block.timestamp + 2 days);
		vm.prank(sender);
		htlcEth.refund();
		assertEq(sender.balance, beforeBal + 1 ether);
	}

	function test_fail_wrong_secret() public {
		vm.prank(sender);
		htlcEth.lock{value: 1 ether}();
		vm.prank(receiver);
		vm.expectRevert();
		htlcEth.claim(bytes32(uint256(0xDEAD)));
	}
}
