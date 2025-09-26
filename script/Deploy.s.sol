// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {HTLC} from "../src/HTLC.sol";

contract Deploy is Script {
	function run() external {
		address receiver = vm.envAddress("RECEIVER");
		bytes32 hashlock = vm.envBytes32("HASHLOCK");
		uint256 timelock = vm.envUint("TIMELOCK");
		address token = vm.envAddress("TOKEN"); // set to 0x0000000000000000000000000000000000000000 for ETH

		vm.startBroadcast();
		new HTLC(receiver, hashlock, timelock, token);
		vm.stopBroadcast();
	}
}
