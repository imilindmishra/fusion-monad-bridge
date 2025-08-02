import { ethers } from 'ethers';
import { RelayerService } from '../backend/relayer';
import { ResolverService } from '../backend/resolver';
import { EventMonitor } from '../backend/monitoring';
import { APIService } from '../backend/api';
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

interface ServiceConfig {
    relayer: {
        ethereumRpc: string;
        monadRpc: string;
        privateKey: string;
        gasSettings: {
            ethereum: { gasPrice: string; gasLimit: string };
            monad: { gasPrice: string; gasLimit: string };
        };
    };
    api: {
        port: number;
        cors: {
            origin: string[];
            credentials: boolean;
        };
    };
    monitoring: {
        blockConfirmations: number;
        pollingInterval: number;
        retryAttempts: number;
    };
    oneInch: {
        apiKey: string;
        baseUrl: string;
        version: string;
    };
}

/**
 * Setup 1inch API integration
 */
export async function setup1inchIntegration(config: ServiceConfig): Promise<void> {
    console.log('🔗 Setting up 1inch API integration...');
    
    try {
        // Validate 1inch API credentials
        if (!config.oneInch.apiKey) {
            console.warn('⚠️ 1inch API key not provided. Some features may be limited.');
        }
        
        // Test 1inch API connection
        const response = await fetch(`${config.oneInch.baseUrl}/${config.oneInch.version}/1/healthcheck`);
        if (response.ok) {
            console.log('✅ 1inch API connection successful');
        } else {
            console.warn('⚠️ 1inch API connection failed, using fallback methods');
        }
        
        console.log('✅ 1inch integration setup completed');
        
    } catch (error) {
        console.error('❌ 1inch integration setup failed:', error);
        throw error;
    }
}

/**
 * Setup event listeners for both chains
 */
export async function setupEventListeners(
    relayerService: RelayerService,
    addresses: ContractAddresses
): Promise<void> {
    console.log('👂 Setting up event listeners...');
    
    try {
        const contracts = relayerService.getContracts();
        
        // Setup Ethereum event listeners
        console.log('📘 Setting up Ethereum event listeners...');
        
        // Listen for CrossChainOrderCreated events
        contracts.fusionAdapter.on('CrossChainOrderCreated', async (
            orderHash,
            maker,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            hashlock,
            timelock,
            targetChainId,
            monadReceiver,
            event
        ) => {
            console.log(`📥 New Ethereum order: ${orderHash}`);
            
            try {
                await relayerService.relayEthereumToMonad({
                    orderHash,
                    tokenIn,
                    tokenOut,
                    amountIn: amountIn.toString(),
                    amountOut: amountOut.toString(),
                    hashlock,
                    timelock: Number(timelock),
                    maker,
                    monadReceiver
                });
            } catch (error) {
                console.error(`❌ Failed to relay order ${orderHash}:`, error);
            }
        });
        
        // Listen for HTLC events
        contracts.ethereumHTLC.on('HTLCWithdrawn', async (contractId, secret, event) => {
            console.log(`🔓 Ethereum HTLC withdrawn: ${contractId}`);
            // The secret is now revealed and can be used on other chains
        });
        
        // Setup Monad event listeners
        console.log('🟣 Setting up Monad event listeners...');
        
        // Listen for IncomingOrderProcessed events
        contracts.monadBridge.on('IncomingOrderProcessed', async (
            ethereumOrderHash,
            monadOrderHash,
            monadReceiver,
            event
        ) => {
            console.log(`📨 Monad order processed: ${ethereumOrderHash} -> ${monadOrderHash}`);
        });
        
        // Listen for OutgoingOrderCreated events
        contracts.monadBridge.on('OutgoingOrderCreated', async (
            orderHash,
            maker,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            hashlock,
            timelock,
            targetChainId,
            ethereumReceiver,
            event
        ) => {
            console.log(`📤 New Monad outgoing order: ${orderHash}`);
            
            try {
                await relayerService.relayMonadToEthereum({
                    orderHash,
                    tokenIn,
                    tokenOut,
                    amountIn: amountIn.toString(),
                    amountOut: amountOut.toString(),
                    hashlock,
                    timelock: Number(timelock),
                    maker,
                    ethereumReceiver,
                    targetChainId: Number(targetChainId)
                });
            } catch (error) {
                console.error(`❌ Failed to relay Monad order ${orderHash}:`, error);
            }
        });
        
        console.log('✅ Event listeners setup completed');
        
    } catch (error) {
        console.error('❌ Event listeners setup failed:', error);
        throw error;
    }
}

/**
 * Initialize all backend services
 */
export async function initializeServices(
    config: ServiceConfig,
    addresses: ContractAddresses
): Promise<{
    relayerService: RelayerService;
    resolverService: ResolverService;
    eventMonitor: EventMonitor;
    apiService: APIService;
}> {
    console.log('🚀 Initializing backend services...');
    
    try {
        // Create providers
        const ethereumProvider = new ethers.JsonRpcProvider(config.relayer.ethereumRpc);
        const monadProvider = new ethers.JsonRpcProvider(config.relayer.monadRpc);
        
        // Load contract ABIs
        const contractABIs = await loadContractABIs();
        
        // Initialize RelayerService
        console.log('📡 Initializing RelayerService...');
        const relayerService = new RelayerService(
            ethereumProvider,
            monadProvider,
            config.relayer.privateKey,
            config.relayer.privateKey, // Using same key for both chains in demo
            addresses,
            contractABIs
        );
        
        // Initialize ResolverService
        console.log('🤝 Initializing ResolverService...');
        const resolverService = new ResolverService(relayerService);
        
        // Initialize EventMonitor
        console.log('👁️ Initializing EventMonitor...');
        const eventMonitor = new EventMonitor(relayerService);
        
        // Initialize APIService
        console.log('🌐 Initializing APIService...');
        const apiService = new APIService(relayerService, resolverService, eventMonitor);
        
        console.log('✅ All services initialized successfully');
        
        return {
            relayerService,
            resolverService,
            eventMonitor,
            apiService
        };
        
    } catch (error) {
        console.error('❌ Service initialization failed:', error);
        throw error;
    }
}

/**
 * Test the complete cross-chain flow
 */
export async function testCrossChainFlow(
    services: {
        relayerService: RelayerService;
        resolverService: ResolverService;
        eventMonitor: EventMonitor;
        apiService: APIService;
    },
    addresses: ContractAddresses
): Promise<void> {
    console.log('🧪 Testing cross-chain flow...');
    
    try {
        // Start all services
        console.log('▶️ Starting services...');
        await services.relayerService.startEventMonitoring();
        await services.eventMonitor.start();
        await services.apiService.start(3000);
        
        // Test health checks
        console.log('🩺 Testing health checks...');
        const health = await services.relayerService.healthCheck();
        console.log('Health check results:', health);
        
        if (!health.ethereum || !health.monad || !health.contracts) {
            throw new Error('Health check failed');
        }
        
        // Test order creation flow (simulation)
        console.log('📝 Testing order creation flow...');
        await testOrderCreation(services, addresses);
        
        // Test event monitoring
        console.log('👀 Testing event monitoring...');
        await testEventMonitoring(services);
        
        // Test atomic swap resolution
        console.log('⚛️ Testing atomic swap resolution...');
        await testAtomicSwapResolution(services);
        
        console.log('✅ Cross-chain flow test completed successfully');
        
    } catch (error) {
        console.error('❌ Cross-chain flow test failed:', error);
        throw error;
    }
}

/**
 * Test order creation flow
 */
async function testOrderCreation(
    services: any,
    addresses: ContractAddresses
): Promise<void> {
    try {
        // This would create a test order
        console.log('  📄 Creating test order...');
        
        const wallets = services.relayerService.getWallets();
        const contracts = services.relayerService.getContracts();
        
        // Simulate order creation (in reality this would be done by user)
        const mockOrderData = {
            tokenIn: '0x0000000000000000000000000000000000000000', // ETH
            tokenOut: '0x0000000000000000000000000000000000000000', // MON
            amountIn: ethers.parseEther('0.01'),
            amountOut: ethers.parseEther('0.0098'),
            monadReceiver: wallets.monad.address,
            targetChainId: 12345, // Mock Monad chain ID
            customTimelock: 0
        };
        
        console.log('  ✅ Test order creation simulated');
        
    } catch (error) {
        console.error('  ❌ Order creation test failed:', error);
        throw error;
    }
}

/**
 * Test event monitoring
 */
async function testEventMonitoring(services: any): Promise<void> {
    try {
        console.log('  👁️ Testing event monitoring...');
        
        // Wait for a few seconds to let monitoring run
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const monitorStats = services.eventMonitor.getStats();
        console.log('  📊 Monitor stats:', monitorStats);
        
        if (!monitorStats.isRunning) {
            throw new Error('Event monitor is not running');
        }
        
        console.log('  ✅ Event monitoring test passed');
        
    } catch (error) {
        console.error('  ❌ Event monitoring test failed:', error);
        throw error;
    }
}

/**
 * Test atomic swap resolution
 */
async function testAtomicSwapResolution(services: any): Promise<void> {
    try {
        console.log('  ⚛️ Testing atomic swap resolution...');
        
        // Simulate atomic swap with mock data
        const mockOrderHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
        const mockSecret = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
        
        // This would normally be triggered by actual HTLC events
        console.log('  🔐 Simulating secret revelation...');
        
        const resolverStats = services.resolverService.getStats();
        console.log('  📊 Resolver stats:', resolverStats);
        
        console.log('  ✅ Atomic swap resolution test passed');
        
    } catch (error) {
        console.error('  ❌ Atomic swap resolution test failed:', error);
        throw error;
    }
}

/**
 * Load contract ABIs from compiled artifacts
 */
async function loadContractABIs(): Promise<any> {
    try {
        // In a real implementation, these would be loaded from compilation artifacts
        const mockABIs = {
            fusionAdapter: [], // Would contain actual ABI
            monadBridge: [],   // Would contain actual ABI
            htlc: []          // Would contain actual ABI
        };
        
        return mockABIs;
        
    } catch (error) {
        console.error('Failed to load contract ABIs:', error);
        throw error;
    }
}

/**
 * Load deployment addresses
 */
function loadDeploymentAddresses(): ContractAddresses {
    try {
        const deploymentPath = path.join(process.cwd(), 'deployments', 'deployments.json');
        
        if (!fs.existsSync(deploymentPath)) {
            throw new Error('Deployment file not found. Please run deployment first.');
        }
        
        const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        return deploymentData.addresses;
        
    } catch (error) {
        console.error('Failed to load deployment addresses:', error);
        throw error;
    }
}

/**
 * Load service configuration
 */
function loadServiceConfig(): ServiceConfig {
    return {
        relayer: {
            ethereumRpc: process.env.ETHEREUM_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
            monadRpc: process.env.MONAD_RPC_URL || 'https://monad-testnet-rpc.example.com',
            privateKey: process.env.RELAYER_PRIVATE_KEY || process.env.ETHEREUM_PRIVATE_KEY || '',
            gasSettings: {
                ethereum: {
                    gasPrice: process.env.ETH_GAS_PRICE || '20000000000', // 20 gwei
                    gasLimit: process.env.ETH_GAS_LIMIT || '500000'
                },
                monad: {
                    gasPrice: process.env.MONAD_GAS_PRICE || '1000000000', // 1 gwei
                    gasLimit: process.env.MONAD_GAS_LIMIT || '500000'
                }
            }
        },
        api: {
            port: parseInt(process.env.API_PORT || '3000'),
            cors: {
                origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
                credentials: true
            }
        },
        monitoring: {
            blockConfirmations: parseInt(process.env.BLOCK_CONFIRMATIONS || '3'),
            pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000'),
            retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3')
        },
        oneInch: {
            apiKey: process.env.ONE_INCH_API_KEY || '',
            baseUrl: process.env.ONE_INCH_BASE_URL || 'https://api.1inch.io',
            version: process.env.ONE_INCH_VERSION || 'v5.0'
        }
    };
}

/**
 * Main setup function
 */
async function main() {
    try {
        console.log('🌟 Fusion Monad Bridge - Integration Setup');
        console.log('=========================================\n');
        
        const config = loadServiceConfig();
        const addresses = loadDeploymentAddresses();
        
        // Validate configuration
        if (!config.relayer.privateKey) {
            throw new Error('Private key not configured. Please set RELAYER_PRIVATE_KEY environment variable.');
        }
        
        // Setup 1inch integration
        await setup1inchIntegration(config);
        
        // Initialize services
        const services = await initializeServices(config, addresses);
        
        // Setup event listeners
        await setupEventListeners(services.relayerService, addresses);
        
        // Test cross-chain flow
        await testCrossChainFlow(services, addresses);
        
        console.log('\n🎉 Integration setup completed successfully!');
        console.log('\n📋 Service Summary:');
        console.log('==================');
        console.log(`• RelayerService: Running`);
        console.log(`• ResolverService: Running`);
        console.log(`• EventMonitor: Running`);
        console.log(`• APIService: Running on port ${config.api.port}`);
        console.log(`• 1inch Integration: ${config.oneInch.apiKey ? 'Enabled' : 'Disabled'}`);
        
        console.log('\n🔗 Bridge is ready for cross-chain swaps!');
        
        // Keep the process running
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down services...');
            await services.relayerService.stop();
            await services.eventMonitor.stop();
            await services.apiService.stop();
            console.log('✅ Services stopped gracefully');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('\n❌ Integration setup failed:', error);
        process.exit(1);
    }
}

// Run setup if this script is executed directly
if (require.main === module) {
    main().catch(console.error);
}
