import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@typechain/hardhat";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    ethereum: {
      url: process.env.ETHEREUM_RPC_URL || "https://mainnet.infura.io/v3/YOUR_PROJECT_ID",
      accounts: process.env.ETHEREUM_PRIVATE_KEY ? [process.env.ETHEREUM_PRIVATE_KEY] : [],
      chainId: 1,
      gasPrice: 20000000000, // 20 gwei
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/YOUR_PROJECT_ID",
      accounts: process.env.ETHEREUM_PRIVATE_KEY ? [process.env.ETHEREUM_PRIVATE_KEY] : [],
      chainId: 11155111,
      gasPrice: 20000000000, // 20 gwei
    },
    monad: {
      url: process.env.MONAD_RPC_URL || "https://monad-testnet-rpc.example.com",
      accounts: process.env.MONAD_PRIVATE_KEY ? [process.env.MONAD_PRIVATE_KEY] : [],
      chainId: 12345, // Replace with actual Monad chain ID
      gasPrice: 1000000000, // 1 gwei (Monad has lower gas costs)
    },
    "monad-testnet": {
      url: process.env.MONAD_TESTNET_RPC_URL || "https://monad-testnet-rpc.example.com",
      accounts: process.env.MONAD_PRIVATE_KEY ? [process.env.MONAD_PRIVATE_KEY] : [],
      chainId: 54321, // Replace with actual Monad testnet chain ID
      gasPrice: 1000000000, // 1 gwei
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      // Add Monad explorer API key when available
      monad: process.env.MONAD_EXPLORER_API_KEY || "",
    },
    customChains: [
      {
        network: "monad",
        chainId: 12345, // Replace with actual Monad chain ID
        urls: {
          apiURL: "https://monad-explorer-api.example.com/api",
          browserURL: "https://monad-explorer.example.com"
        }
      }
    ]
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["externalArtifacts/*.json"],
    dontOverrideCompile: false,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
  },
};

export default config;
