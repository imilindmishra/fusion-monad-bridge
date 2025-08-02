import { setup1inchIntegration, initializeServices, setupEventListeners, testCrossChainFlow } from '../scripts/setup-integration';
import { Logger } from './utils/logger';

/**
 * Main entry point for the Fusion+ Monad Bridge backend
 */
async function main() {
    const logger = new Logger('Main');
    
    try {
        logger.info('🌉 Starting Fusion+ Monad Bridge...');
        
        // Load configuration (mock for now)
        const config = {
            relayer: {
                ethereumRpc: process.env.ETHEREUM_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID',
                monadRpc: process.env.MONAD_RPC_URL || 'https://monad-testnet-rpc.example.com',
                privateKey: process.env.RELAYER_PRIVATE_KEY || process.env.ETHEREUM_PRIVATE_KEY || '',
                gasSettings: {
                    ethereum: { gasPrice: '20000000000', gasLimit: '500000' },
                    monad: { gasPrice: '1000000000', gasLimit: '500000' }
                }
            },
            api: {
                port: parseInt(process.env.API_PORT || '3000'),
                cors: {
                    origin: ['http://localhost:3000', 'http://localhost:3001'],
                    credentials: true
                }
            },
            monitoring: {
                blockConfirmations: 3,
                pollingInterval: 5000,
                retryAttempts: 3
            },
            oneInch: {
                apiKey: process.env.ONE_INCH_API_KEY || '',
                baseUrl: process.env.ONE_INCH_BASE_URL || 'https://api.1inch.io',
                version: process.env.ONE_INCH_VERSION || 'v5.0'
            }
        };

        const addresses = {
            ethereum: {
                fusionAdapter: process.env.ETHEREUM_FUSION_ADAPTER || '0x1234567890123456789012345678901234567890',
                ethereumHTLC: process.env.ETHEREUM_HTLC || '0x2345678901234567890123456789012345678901'
            },
            monad: {
                monadBridge: process.env.MONAD_BRIDGE || '0x3456789012345678901234567890123456789012',
                monadHTLC: process.env.MONAD_HTLC || '0x4567890123456789012345678901234567890123'
            }
        };
        
        // Setup 1inch integration
        await setup1inchIntegration(config);
        
        // Initialize services
        const services = await initializeServices(config, addresses);
        
        // Setup event listeners
        await setupEventListeners(services.relayerService, addresses);
        
        // Start API service
        await services.apiService.start(config.api.port);
        
        // Test cross-chain flow
        await testCrossChainFlow(services, addresses);
        
        logger.info('✅ Bridge started successfully!');
        
    } catch (error) {
        logger.error('Failed to start bridge:', error);
        process.exit(1);
    }
}

// Export the setup function for use by scripts
export { main as startBridge };

// Run if this is the main module
if (require.main === module) {
    main().catch(error => {
        console.error('Bridge startup failed:', error);
        process.exit(1);
    });
}
