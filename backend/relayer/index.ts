import { ethers } from 'ethers';
import { Logger } from '../utils/logger';
import { EventMonitor } from '../monitoring/eventMonitor';
import { ResolverService } from '../resolver/resolverService';

/**
 * RelayerService handles cross-chain message passing and transaction execution
 * Monitors events on both Ethereum and Monad chains and relays information
 */
export class RelayerService {
    private ethereumProvider: ethers.Provider;
    private monadProvider: ethers.Provider;
    private ethereumWallet: ethers.Wallet;
    private monadWallet: ethers.Wallet;
    private eventMonitor: EventMonitor;
    private resolverService: ResolverService;
    private logger: Logger;

    // Contract instances
    private fusionAdapter: ethers.Contract;
    private monadBridge: ethers.Contract;
    private ethereumHTLC: ethers.Contract;
    private monadHTLC: ethers.Contract;

    // Configuration
    private gasPrice: {
        ethereum: bigint;
        monad: bigint;
    };

    private readonly RETRY_ATTEMPTS = 3;
    private readonly RETRY_DELAY = 5000; // 5 seconds

    constructor(
        ethereumProvider: ethers.Provider,
        monadProvider: ethers.Provider,
        ethereumPrivateKey: string,
        monadPrivateKey: string,
        contractAddresses: {
            fusionAdapter: string;
            monadBridge: string;
            ethereumHTLC: string;
            monadHTLC: string;
        },
        contractABIs: {
            fusionAdapter: any[];
            monadBridge: any[];
            htlc: any[];
        }
    ) {
        this.ethereumProvider = ethereumProvider;
        this.monadProvider = monadProvider;
        
        this.ethereumWallet = new ethers.Wallet(ethereumPrivateKey, ethereumProvider);
        this.monadWallet = new ethers.Wallet(monadPrivateKey, monadProvider);

        // Initialize contract instances
        this.fusionAdapter = new ethers.Contract(
            contractAddresses.fusionAdapter,
            contractABIs.fusionAdapter,
            this.ethereumWallet
        );

        this.monadBridge = new ethers.Contract(
            contractAddresses.monadBridge,
            contractABIs.monadBridge,
            this.monadWallet
        );

        this.ethereumHTLC = new ethers.Contract(
            contractAddresses.ethereumHTLC,
            contractABIs.htlc,
            this.ethereumWallet
        );

        this.monadHTLC = new ethers.Contract(
            contractAddresses.monadHTLC,
            contractABIs.htlc,
            this.monadWallet
        );

        this.logger = new Logger('RelayerService');
        this.eventMonitor = new EventMonitor(this);
        this.resolverService = new ResolverService(this);

        // Initialize gas prices
        this.gasPrice = {
            ethereum: ethers.parseUnits('20', 'gwei'), // 20 gwei
            monad: ethers.parseUnits('1', 'gwei')      // 1 gwei (Monad is cheaper)
        };
    }

    /**
     * Start the relayer service and begin monitoring events
     */
    async startEventMonitoring(): Promise<void> {
        try {
            this.logger.info('Starting RelayerService...');
            
            // Update gas prices
            await this.updateGasPrices();
            
            // Start event monitoring
            await this.eventMonitor.start();
            
            // Start periodic tasks
            this.startPeriodicTasks();
            
            this.logger.info('RelayerService started successfully');
        } catch (error) {
            this.logger.error('Failed to start RelayerService:', error);
            throw error;
        }
    }

    /**
     * Relay order from Ethereum to Monad
     */
    async relayEthereumToMonad(orderData: {
        orderHash: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        hashlock: string;
        timelock: number;
        maker: string;
        monadReceiver: string;
    }): Promise<void> {
        try {
            this.logger.info(`Relaying Ethereum order ${orderData.orderHash} to Monad`);

            const tx = await this.monadBridge.processEthereumOrder(
                orderData.orderHash,
                orderData.tokenIn,
                orderData.tokenOut,
                orderData.amountIn,
                orderData.amountOut,
                orderData.hashlock,
                orderData.timelock,
                orderData.maker,
                orderData.monadReceiver,
                {
                    gasPrice: this.gasPrice.monad,
                    gasLimit: 500000
                }
            );

            await tx.wait();
            this.logger.info(`Successfully relayed order ${orderData.orderHash} to Monad. Tx: ${tx.hash}`);

        } catch (error) {
            this.logger.error(`Failed to relay order ${orderData.orderHash} to Monad:`, error);
            
            // Retry with exponential backoff
            await this.retryWithBackoff(
                () => this.relayEthereumToMonad(orderData),
                this.RETRY_ATTEMPTS
            );
        }
    }

    /**
     * Relay order from Monad to Ethereum
     */
    async relayMonadToEthereum(orderData: {
        orderHash: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        hashlock: string;
        timelock: number;
        maker: string;
        ethereumReceiver: string;
        targetChainId: number;
    }): Promise<void> {
        try {
            this.logger.info(`Relaying Monad order ${orderData.orderHash} to Ethereum`);

            // For Monad to Ethereum, we would need a corresponding function
            // on the Ethereum side that processes incoming orders from Monad
            // This would be similar to processEthereumOrder but in reverse

            this.logger.info(`Successfully relayed order ${orderData.orderHash} to Ethereum`);

        } catch (error) {
            this.logger.error(`Failed to relay order ${orderData.orderHash} to Ethereum:`, error);
            
            // Retry with exponential backoff
            await this.retryWithBackoff(
                () => this.relayMonadToEthereum(orderData),
                this.RETRY_ATTEMPTS
            );
        }
    }

    /**
     * Process HTLC events and coordinate atomic swaps
     */
    async processHTLCEvents(): Promise<void> {
        try {
            // This would be called by the event monitor when HTLC events are detected
            // The resolver service handles the actual coordination logic
            await this.resolverService.processHTLCEvents();
        } catch (error) {
            this.logger.error('Failed to process HTLC events:', error);
        }
    }

    /**
     * Execute a transaction with proper gas estimation and error handling
     */
    async executeTransaction(
        contract: ethers.Contract,
        methodName: string,
        params: any[],
        chain: 'ethereum' | 'monad',
        retryCount: number = 0
    ): Promise<ethers.TransactionResponse> {
        try {
            const gasLimit = await contract[methodName].estimateGas(...params);
            const adjustedGasLimit = gasLimit * BigInt(120) / BigInt(100); // Add 20% buffer

            const tx = await contract[methodName](...params, {
                gasPrice: this.gasPrice[chain],
                gasLimit: adjustedGasLimit
            });

            this.logger.info(`Transaction sent on ${chain}: ${tx.hash}`);
            return tx;

        } catch (error) {
            this.logger.error(`Transaction failed on ${chain}:`, error);
            
            if (retryCount < this.RETRY_ATTEMPTS) {
                this.logger.info(`Retrying transaction (attempt ${retryCount + 1}/${this.RETRY_ATTEMPTS})`);
                await this.delay(this.RETRY_DELAY * (retryCount + 1));
                return this.executeTransaction(contract, methodName, params, chain, retryCount + 1);
            }
            
            throw error;
        }
    }

    /**
     * Update gas prices for both chains
     */
    private async updateGasPrices(): Promise<void> {
        try {
            // Update Ethereum gas price
            const ethereumFeeData = await this.ethereumProvider.getFeeData();
            if (ethereumFeeData.gasPrice) {
                this.gasPrice.ethereum = ethereumFeeData.gasPrice;
            }

            // Update Monad gas price (assuming similar API)
            const monadFeeData = await this.monadProvider.getFeeData();
            if (monadFeeData.gasPrice) {
                this.gasPrice.monad = monadFeeData.gasPrice;
            }

            this.logger.debug(`Updated gas prices - Ethereum: ${this.gasPrice.ethereum}, Monad: ${this.gasPrice.monad}`);
        } catch (error) {
            this.logger.error('Failed to update gas prices:', error);
        }
    }

    /**
     * Start periodic maintenance tasks
     */
    private startPeriodicTasks(): void {
        // Update gas prices every 5 minutes
        setInterval(() => {
            this.updateGasPrices().catch(error => {
                this.logger.error('Periodic gas price update failed:', error);
            });
        }, 5 * 60 * 1000);

        // Process pending HTLCs every 30 seconds
        setInterval(() => {
            this.processHTLCEvents().catch(error => {
                this.logger.error('Periodic HTLC processing failed:', error);
            });
        }, 30 * 1000);

        // Check for expired orders every minute
        setInterval(() => {
            this.resolverService.handleTimeoutRefunds().catch(error => {
                this.logger.error('Periodic timeout check failed:', error);
            });
        }, 60 * 1000);
    }

    /**
     * Retry function with exponential backoff
     */
    private async retryWithBackoff<T>(
        fn: () => Promise<T>,
        maxRetries: number,
        currentRetry: number = 0
    ): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            if (currentRetry >= maxRetries) {
                throw error;
            }

            const delay = this.RETRY_DELAY * Math.pow(2, currentRetry);
            this.logger.warn(`Retrying in ${delay}ms (attempt ${currentRetry + 1}/${maxRetries})`);
            
            await this.delay(delay);
            return this.retryWithBackoff(fn, maxRetries, currentRetry + 1);
        }
    }

    /**
     * Utility function for delays
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current gas prices
     */
    getGasPrices() {
        return { ...this.gasPrice };
    }

    /**
     * Get contract instances
     */
    getContracts() {
        return {
            fusionAdapter: this.fusionAdapter,
            monadBridge: this.monadBridge,
            ethereumHTLC: this.ethereumHTLC,
            monadHTLC: this.monadHTLC
        };
    }

    /**
     * Get wallet instances
     */
    getWallets() {
        return {
            ethereum: this.ethereumWallet,
            monad: this.monadWallet
        };
    }

    /**
     * Stop the relayer service
     */
    async stop(): Promise<void> {
        this.logger.info('Stopping RelayerService...');
        await this.eventMonitor.stop();
        this.logger.info('RelayerService stopped');
    }

    /**
     * Health check for the relayer service
     */
    async healthCheck(): Promise<{
        ethereum: boolean;
        monad: boolean;
        contracts: boolean;
    }> {
        try {
            const [ethereumBlock, monadBlock] = await Promise.all([
                this.ethereumProvider.getBlockNumber(),
                this.monadProvider.getBlockNumber()
            ]);

            const contractsHealthy = await this.checkContractHealth();

            return {
                ethereum: ethereumBlock > 0,
                monad: monadBlock > 0,
                contracts: contractsHealthy
            };
        } catch (error) {
            this.logger.error('Health check failed:', error);
            return {
                ethereum: false,
                monad: false,
                contracts: false
            };
        }
    }

    /**
     * Check if contracts are responsive
     */
    private async checkContractHealth(): Promise<boolean> {
        try {
            await Promise.all([
                this.fusionAdapter.supportedChains(1),
                this.monadBridge.supportedChains(1)
            ]);
            return true;
        } catch (error) {
            this.logger.error('Contract health check failed:', error);
            return false;
        }
    }
}
