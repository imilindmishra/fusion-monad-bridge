import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

interface ContractAddresses {
    ethereum: {
        fusionAdapter: string;
        ethereumHTLC: string;
    };
    monad: {
        monadBridge: string;
        monadHTLC: string;
    };
}

interface DeploymentConfig {
    networks: {
        ethereum: {
            rpcUrl: string;
            chainId: number;
            privateKey: string;
        };
        monad: {
            rpcUrl: string;
            chainId: number;
            privateKey: string;
        };
    };
    contracts: {
        timelock: {
            min: number;
            max: number;
            default: number;
        };
    };
}

/**
 * Deploy all contracts to both Ethereum and Monad networks
 */
export async function deployAllContracts(config: DeploymentConfig): Promise<ContractAddresses> {
    console.log('🚀 Starting deployment process...');
    
    try {
        // Deploy Ethereum contracts
        console.log('\n📘 Deploying Ethereum contracts...');
        const ethereumAddresses = await deployEthereumContracts(config);
        
        // Deploy Monad contracts
        console.log('\n🟣 Deploying Monad contracts...');
        const monadAddresses = await deployMonadContracts(config);
        
        const addresses: ContractAddresses = {
            ethereum: ethereumAddresses,
            monad: monadAddresses
        };
        
        // Verify deployments
        console.log('\n✅ Verifying deployments...');
        const isValid = await verifyDeployments(config, addresses);
        
        if (!isValid) {
            throw new Error('Deployment verification failed');
        }
        
        // Setup cross-chain configuration
        console.log('\n🔗 Setting up cross-chain configuration...');
        await setupCrossChainConfig(config, addresses);
        
        // Save deployment info
        await saveDeploymentInfo(addresses);
        
        console.log('\n🎉 Deployment completed successfully!');
        console.log('Contract addresses saved to deployments.json');
        
        return addresses;
        
    } catch (error) {
        console.error('❌ Deployment failed:', error);
        throw error;
    }
}

/**
 * Deploy contracts to Ethereum network
 */
export async function deployEthereumContracts(config: DeploymentConfig) {
    const provider = new ethers.JsonRpcProvider(config.networks.ethereum.rpcUrl);
    const wallet = new ethers.Wallet(config.networks.ethereum.privateKey, provider);
    
    console.log(`Deploying from wallet: ${wallet.address}`);
    console.log(`Network: ${config.networks.ethereum.chainId}`);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
    
    if (balance < ethers.parseEther('0.1')) {
        throw new Error('Insufficient ETH balance for deployment');
    }
    
    // Deploy EthereumHTLC
    console.log('📄 Deploying EthereumHTLC...');
    const htlcFactory = await ethers.getContractFactory('EthereumHTLC', wallet);
    const htlc = await htlcFactory.deploy();
    await htlc.waitForDeployment();
    const htlcAddress = await htlc.getAddress();
    console.log(`✅ EthereumHTLC deployed at: ${htlcAddress}`);
    
    // Deploy FusionMonadAdapter
    console.log('📄 Deploying FusionMonadAdapter...');
    const adapterFactory = await ethers.getContractFactory('FusionMonadAdapter', wallet);
    const adapter = await adapterFactory.deploy(htlcAddress);
    await adapter.waitForDeployment();
    const adapterAddress = await adapter.getAddress();
    console.log(`✅ FusionMonadAdapter deployed at: ${adapterAddress}`);
    
    // Configure timelock parameters
    console.log('⚙️ Configuring timelock parameters...');
    await adapter.updateTimelockParams(
        config.contracts.timelock.min,
        config.contracts.timelock.max,
        config.contracts.timelock.default
    );
    console.log('✅ Timelock parameters configured');
    
    return {
        fusionAdapter: adapterAddress,
        ethereumHTLC: htlcAddress
    };
}

/**
 * Deploy contracts to Monad network
 */
export async function deployMonadContracts(config: DeploymentConfig) {
    const provider = new ethers.JsonRpcProvider(config.networks.monad.rpcUrl);
    const wallet = new ethers.Wallet(config.networks.monad.privateKey, provider);
    
    console.log(`Deploying from wallet: ${wallet.address}`);
    console.log(`Network: ${config.networks.monad.chainId}`);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet balance: ${ethers.formatEther(balance)} MON`);
    
    if (balance < ethers.parseEther('1.0')) {
        throw new Error('Insufficient MON balance for deployment');
    }
    
    // Deploy MonadHTLC
    console.log('📄 Deploying MonadHTLC...');
    const htlcFactory = await ethers.getContractFactory('MonadHTLC', wallet);
    const htlc = await htlcFactory.deploy();
    await htlc.waitForDeployment();
    const htlcAddress = await htlc.getAddress();
    console.log(`✅ MonadHTLC deployed at: ${htlcAddress}`);
    
    // Deploy MonadBridge
    console.log('📄 Deploying MonadBridge...');
    const bridgeFactory = await ethers.getContractFactory('MonadBridge', wallet);
    const bridge = await bridgeFactory.deploy(htlcAddress);
    await bridge.waitForDeployment();
    const bridgeAddress = await bridge.getAddress();
    console.log(`✅ MonadBridge deployed at: ${bridgeAddress}`);
    
    // Configure timelock parameters
    console.log('⚙️ Configuring timelock parameters...');
    await bridge.updateTimelockParams(
        config.contracts.timelock.min,
        config.contracts.timelock.max,
        config.contracts.timelock.default
    );
    console.log('✅ Timelock parameters configured');
    
    return {
        monadBridge: bridgeAddress,
        monadHTLC: htlcAddress
    };
}

/**
 * Verify contract deployments
 */
export async function verifyDeployments(config: DeploymentConfig, addresses: ContractAddresses): Promise<boolean> {
    try {
        // Verify Ethereum contracts
        const ethProvider = new ethers.JsonRpcProvider(config.networks.ethereum.rpcUrl);
        const ethWallet = new ethers.Wallet(config.networks.ethereum.privateKey, ethProvider);
        
        console.log('🔍 Verifying Ethereum contracts...');
        
        // Check if contracts are deployed
        const adapterCode = await ethProvider.getCode(addresses.ethereum.fusionAdapter);
        const htlcCode = await ethProvider.getCode(addresses.ethereum.ethereumHTLC);
        
        if (adapterCode === '0x' || htlcCode === '0x') {
            console.error('❌ Ethereum contracts not properly deployed');
            return false;
        }
        
        // Test contract interactions
        const adapter = await ethers.getContractAt('FusionMonadAdapter', addresses.ethereum.fusionAdapter, ethWallet);
        const supportedChain = await adapter.supportedChains(1);
        if (!supportedChain) {
            console.error('❌ FusionMonadAdapter not configured correctly');
            return false;
        }
        
        console.log('✅ Ethereum contracts verified');
        
        // Verify Monad contracts
        const monadProvider = new ethers.JsonRpcProvider(config.networks.monad.rpcUrl);
        const monadWallet = new ethers.Wallet(config.networks.monad.privateKey, monadProvider);
        
        console.log('🔍 Verifying Monad contracts...');
        
        // Check if contracts are deployed
        const bridgeCode = await monadProvider.getCode(addresses.monad.monadBridge);
        const monadHtlcCode = await monadProvider.getCode(addresses.monad.monadHTLC);
        
        if (bridgeCode === '0x' || monadHtlcCode === '0x') {
            console.error('❌ Monad contracts not properly deployed');
            return false;
        }
        
        // Test contract interactions
        const bridge = await ethers.getContractAt('MonadBridge', addresses.monad.monadBridge, monadWallet);
        const monadSupportedChain = await bridge.supportedChains(1);
        if (!monadSupportedChain) {
            console.error('❌ MonadBridge not configured correctly');
            return false;
        }
        
        console.log('✅ Monad contracts verified');
        
        return true;
        
    } catch (error) {
        console.error('❌ Verification failed:', error);
        return false;
    }
}

/**
 * Setup cross-chain configuration
 */
export async function setupCrossChainConfig(config: DeploymentConfig, addresses: ContractAddresses): Promise<void> {
    try {
        // Setup Ethereum side
        const ethProvider = new ethers.JsonRpcProvider(config.networks.ethereum.rpcUrl);
        const ethWallet = new ethers.Wallet(config.networks.ethereum.privateKey, ethProvider);
        const adapter = await ethers.getContractAt('FusionMonadAdapter', addresses.ethereum.fusionAdapter, ethWallet);
        
        console.log('⚙️ Configuring Ethereum side...');
        
        // Add Monad as supported chain
        await adapter.addSupportedChain(config.networks.monad.chainId);
        console.log(`✅ Added Monad chain ${config.networks.monad.chainId} as supported`);
        
        // Setup Monad side
        const monadProvider = new ethers.JsonRpcProvider(config.networks.monad.rpcUrl);
        const monadWallet = new ethers.Wallet(config.networks.monad.privateKey, monadProvider);
        const bridge = await ethers.getContractAt('MonadBridge', addresses.monad.monadBridge, monadWallet);
        
        console.log('⚙️ Configuring Monad side...');
        
        // Add Ethereum as supported chain
        await bridge.addSupportedChain(config.networks.ethereum.chainId);
        console.log(`✅ Added Ethereum chain ${config.networks.ethereum.chainId} as supported`);
        
        // Authorize relayer (for demo, use deployer address)
        await bridge.setRelayerAuthorization(ethWallet.address, true);
        console.log(`✅ Authorized relayer: ${ethWallet.address}`);
        
    } catch (error) {
        console.error('❌ Cross-chain configuration failed:', error);
        throw error;
    }
}

/**
 * Save deployment information to file
 */
async function saveDeploymentInfo(addresses: ContractAddresses): Promise<void> {
    const deploymentInfo = {
        timestamp: new Date().toISOString(),
        addresses,
        networks: {
            ethereum: process.env.ETHEREUM_NETWORK || 'sepolia',
            monad: process.env.MONAD_NETWORK || 'testnet'
        }
    };
    
    const deploymentsDir = path.join(process.cwd(), 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const filePath = path.join(deploymentsDir, 'deployments.json');
    fs.writeFileSync(filePath, JSON.stringify(deploymentInfo, null, 2));
    
    console.log(`✅ Deployment info saved to: ${filePath}`);
}

/**
 * Load deployment configuration
 */
export function loadDeploymentConfig(): DeploymentConfig {
    return {
        networks: {
            ethereum: {
                rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
                chainId: parseInt(process.env.ETHEREUM_CHAIN_ID || '11155111'),
                privateKey: process.env.ETHEREUM_PRIVATE_KEY || ''
            },
            monad: {
                rpcUrl: process.env.MONAD_RPC_URL || 'https://monad-testnet-rpc.example.com',
                chainId: parseInt(process.env.MONAD_CHAIN_ID || '12345'),
                privateKey: process.env.MONAD_PRIVATE_KEY || process.env.ETHEREUM_PRIVATE_KEY || ''
            }
        },
        contracts: {
            timelock: {
                min: parseInt(process.env.MIN_TIMELOCK || '3600'), // 1 hour
                max: parseInt(process.env.MAX_TIMELOCK || '604800'), // 7 days
                default: parseInt(process.env.DEFAULT_TIMELOCK || '86400') // 24 hours
            }
        }
    };
}

/**
 * Main deployment function
 */
async function main() {
    try {
        console.log('🌟 Fusion Monad Bridge - Contract Deployment');
        console.log('==========================================\n');
        
        const config = loadDeploymentConfig();
        
        // Validate configuration
        if (!config.networks.ethereum.privateKey || !config.networks.monad.privateKey) {
            throw new Error('Private keys not configured. Please set ETHEREUM_PRIVATE_KEY and MONAD_PRIVATE_KEY environment variables.');
        }
        
        const addresses = await deployAllContracts(config);
        
        console.log('\n📋 Deployment Summary:');
        console.log('======================');
        console.log('Ethereum Contracts:');
        console.log(`  FusionMonadAdapter: ${addresses.ethereum.fusionAdapter}`);
        console.log(`  EthereumHTLC: ${addresses.ethereum.ethereumHTLC}`);
        console.log('\nMonad Contracts:');
        console.log(`  MonadBridge: ${addresses.monad.monadBridge}`);
        console.log(`  MonadHTLC: ${addresses.monad.monadHTLC}`);
        
        console.log('\n🎉 All contracts deployed successfully!');
        
    } catch (error) {
        console.error('\n❌ Deployment failed:', error);
        process.exit(1);
    }
}

// Run deployment if this script is executed directly
if (require.main === module) {
    main().catch(console.error);
}
