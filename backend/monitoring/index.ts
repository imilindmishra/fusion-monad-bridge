import { ethers } from 'ethers';
import { Logger } from '../utils/logger';
import type { RelayerService } from '../relayer';

/**
 * EventMonitor listens to contract events on both chains
 * Maintains state synchronization and triggers appropriate actions
 */
export class EventMonitor {
    private relayerService: RelayerService;
    private logger: Logger;
    private isRunning: boolean = false;
    
    // Event filters
    private ethereumFilters: Map<string, ethers.EventFilter> = new Map();
    private monadFilters: Map<string, ethers.EventFilter> = new Map();
    
    // Last processed blocks
    private lastProcessedBlock: {
        ethereum: number;
        monad: number;
    } = {
        ethereum: 0,
        monad: 0
    };

    // Configuration
    private readonly BLOCK_CONFIRMATIONS = 3;
    private readonly POLLING_INTERVAL = 5000; // 5 seconds
    private readonly MAX_BLOCKS_PER_QUERY = 100;

    constructor(relayerService: RelayerService) {
        this.relayerService = relayerService;
        this.logger = new Logger('EventMonitor');
    }

    /**
     * Start monitoring events on both chains
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('EventMonitor is already running');
            return;
        }

        try {
            this.logger.info('Starting EventMonitor...');
            
            await this.initializeEventFilters();
            await this.initializeLastProcessedBlocks();
            
            this.isRunning = true;
            
            // Start monitoring both chains
            this.startEthereumMonitoring();
            this.startMonadMonitoring();
            
            this.logger.info('EventMonitor started successfully');
        } catch (error) {
            this.logger.error('Failed to start EventMonitor:', error);
            throw error;
        }
    }

    /**
     * Stop monitoring events
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.logger.info('Stopping EventMonitor...');
        this.isRunning = false;
        this.logger.info('EventMonitor stopped');
    }

    /**
     * Monitor Ethereum events
     */
    async monitorEthereumEvents(): Promise<void> {
        if (!this.isRunning) return;

        try {
            const contracts = this.relayerService.getContracts();
            const provider = contracts.fusionAdapter.provider;
            
            const currentBlock = await provider.getBlockNumber();
            const safeBlock = currentBlock - this.BLOCK_CONFIRMATIONS;
            
            if (safeBlock <= this.lastProcessedBlock.ethereum) {
                return; // No new blocks to process
            }

            const fromBlock = this.lastProcessedBlock.ethereum + 1;
            const toBlock = Math.min(safeBlock, fromBlock + this.MAX_BLOCKS_PER_QUERY - 1);

            this.logger.debug(`Processing Ethereum blocks ${fromBlock} to ${toBlock}`);

            // Process Fusion Adapter events
            await this.processFusionAdapterEvents(fromBlock, toBlock);
            
            // Process HTLC events
            await this.processEthereumHTLCEvents(fromBlock, toBlock);

            this.lastProcessedBlock.ethereum = toBlock;

        } catch (error) {
            this.logger.error('Failed to monitor Ethereum events:', error);
        }
    }

    /**
     * Monitor Monad events
     */
    async monitorMonadEvents(): Promise<void> {
        if (!this.isRunning) return;

        try {
            const contracts = this.relayerService.getContracts();
            const provider = contracts.monadBridge.provider;
            
            const currentBlock = await provider.getBlockNumber();
            const safeBlock = currentBlock - this.BLOCK_CONFIRMATIONS;
            
            if (safeBlock <= this.lastProcessedBlock.monad) {
                return; // No new blocks to process
            }

            const fromBlock = this.lastProcessedBlock.monad + 1;
            const toBlock = Math.min(safeBlock, fromBlock + this.MAX_BLOCKS_PER_QUERY - 1);

            this.logger.debug(`Processing Monad blocks ${fromBlock} to ${toBlock}`);

            // Process Monad Bridge events
            await this.processMonadBridgeEvents(fromBlock, toBlock);
            
            // Process HTLC events
            await this.processMonadHTLCEvents(fromBlock, toBlock);

            this.lastProcessedBlock.monad = toBlock;

        } catch (error) {
            this.logger.error('Failed to monitor Monad events:', error);
        }
    }

    /**
     * Sync cross-chain state
     */
    async syncCrossChainState(): Promise<void> {
        try {
            this.logger.debug('Syncing cross-chain state...');
            
            // This would implement sophisticated state synchronization
            // For now, we'll trigger a validation check
            const resolverService = this.relayerService['resolverService'];
            if (resolverService) {
                await resolverService.validateCrossChainState();
            }
            
        } catch (error) {
            this.logger.error('Failed to sync cross-chain state:', error);
        }
    }

    /**
     * Handle failed transactions
     */
    async handleFailedTransactions(): Promise<void> {
        try {
            this.logger.debug('Checking for failed transactions...');
            
            // Implementation would check for failed transactions and attempt recovery
            // This is a placeholder for the actual implementation
            
        } catch (error) {
            this.logger.error('Failed to handle failed transactions:', error);
        }
    }

    /**
     * Initialize event filters for both chains
     */
    private async initializeEventFilters(): Promise<void> {
        const contracts = this.relayerService.getContracts();

        // Ethereum event filters
        this.ethereumFilters.set('CrossChainOrderCreated', 
            contracts.fusionAdapter.filters.CrossChainOrderCreated());
        this.ethereumFilters.set('CrossChainOrderFulfilled', 
            contracts.fusionAdapter.filters.CrossChainOrderFulfilled());
        this.ethereumFilters.set('CrossChainOrderRefunded', 
            contracts.fusionAdapter.filters.CrossChainOrderRefunded());
        this.ethereumFilters.set('HTLCCreated', 
            contracts.ethereumHTLC.filters.HTLCCreated());
        this.ethereumFilters.set('HTLCWithdrawn', 
            contracts.ethereumHTLC.filters.HTLCWithdrawn());
        this.ethereumFilters.set('HTLCRefunded', 
            contracts.ethereumHTLC.filters.HTLCRefunded());

        // Monad event filters
        this.monadFilters.set('IncomingOrderProcessed', 
            contracts.monadBridge.filters.IncomingOrderProcessed());
        this.monadFilters.set('IncomingOrderFulfilled', 
            contracts.monadBridge.filters.IncomingOrderFulfilled());
        this.monadFilters.set('OutgoingOrderCreated', 
            contracts.monadBridge.filters.OutgoingOrderCreated());
        this.monadFilters.set('HTLCCreated', 
            contracts.monadHTLC.filters.HTLCCreated());
        this.monadFilters.set('HTLCWithdrawn', 
            contracts.monadHTLC.filters.HTLCWithdrawn());
        this.monadFilters.set('HTLCRefunded', 
            contracts.monadHTLC.filters.HTLCRefunded());

        this.logger.debug('Event filters initialized');
    }

    /**
     * Initialize last processed block numbers
     */
    private async initializeLastProcessedBlocks(): Promise<void> {
        const contracts = this.relayerService.getContracts();

        // Get current block numbers
        const [ethereumBlock, monadBlock] = await Promise.all([
            contracts.fusionAdapter.provider.getBlockNumber(),
            contracts.monadBridge.provider.getBlockNumber()
        ]);

        // Start from current blocks minus some buffer for safety
        this.lastProcessedBlock.ethereum = Math.max(0, ethereumBlock - 100);
        this.lastProcessedBlock.monad = Math.max(0, monadBlock - 100);

        this.logger.info(`Initialized last processed blocks - Ethereum: ${this.lastProcessedBlock.ethereum}, Monad: ${this.lastProcessedBlock.monad}`);
    }

    /**
     * Start Ethereum event monitoring loop
     */
    private startEthereumMonitoring(): void {
        const monitor = async () => {
            if (!this.isRunning) return;
            
            await this.monitorEthereumEvents();
            setTimeout(monitor, this.POLLING_INTERVAL);
        };
        
        setTimeout(monitor, this.POLLING_INTERVAL);
    }

    /**
     * Start Monad event monitoring loop
     */
    private startMonadMonitoring(): void {
        const monitor = async () => {
            if (!this.isRunning) return;
            
            await this.monitorMonadEvents();
            setTimeout(monitor, this.POLLING_INTERVAL);
        };
        
        setTimeout(monitor, this.POLLING_INTERVAL);
    }

    /**
     * Process Fusion Adapter events
     */
    private async processFusionAdapterEvents(fromBlock: number, toBlock: number): Promise<void> {
        const contracts = this.relayerService.getContracts();

        try {
            // Get CrossChainOrderCreated events
            const orderCreatedEvents = await contracts.fusionAdapter.queryFilter(
                this.ethereumFilters.get('CrossChainOrderCreated')!,
                fromBlock,
                toBlock
            );

            for (const event of orderCreatedEvents) {
                await this.handleCrossChainOrderCreated(event);
            }

            // Get CrossChainOrderFulfilled events
            const orderFulfilledEvents = await contracts.fusionAdapter.queryFilter(
                this.ethereumFilters.get('CrossChainOrderFulfilled')!,
                fromBlock,
                toBlock
            );

            for (const event of orderFulfilledEvents) {
                await this.handleCrossChainOrderFulfilled(event);
            }

            // Get CrossChainOrderRefunded events
            const orderRefundedEvents = await contracts.fusionAdapter.queryFilter(
                this.ethereumFilters.get('CrossChainOrderRefunded')!,
                fromBlock,
                toBlock
            );

            for (const event of orderRefundedEvents) {
                await this.handleCrossChainOrderRefunded(event);
            }

        } catch (error) {
            this.logger.error('Failed to process Fusion Adapter events:', error);
        }
    }

    /**
     * Process Ethereum HTLC events
     */
    private async processEthereumHTLCEvents(fromBlock: number, toBlock: number): Promise<void> {
        const contracts = this.relayerService.getContracts();

        try {
            // Process HTLC events
            const htlcEvents = await Promise.all([
                contracts.ethereumHTLC.queryFilter(this.ethereumFilters.get('HTLCCreated')!, fromBlock, toBlock),
                contracts.ethereumHTLC.queryFilter(this.ethereumFilters.get('HTLCWithdrawn')!, fromBlock, toBlock),
                contracts.ethereumHTLC.queryFilter(this.ethereumFilters.get('HTLCRefunded')!, fromBlock, toBlock)
            ]);

            const [createdEvents, withdrawnEvents, refundedEvents] = htlcEvents;

            for (const event of createdEvents) {
                await this.handleHTLCCreated(event, 'ethereum');
            }

            for (const event of withdrawnEvents) {
                await this.handleHTLCWithdrawn(event, 'ethereum');
            }

            for (const event of refundedEvents) {
                await this.handleHTLCRefunded(event, 'ethereum');
            }

        } catch (error) {
            this.logger.error('Failed to process Ethereum HTLC events:', error);
        }
    }

    /**
     * Process Monad Bridge events
     */
    private async processMonadBridgeEvents(fromBlock: number, toBlock: number): Promise<void> {
        const contracts = this.relayerService.getContracts();

        try {
            // Get IncomingOrderProcessed events
            const incomingOrderEvents = await contracts.monadBridge.queryFilter(
                this.monadFilters.get('IncomingOrderProcessed')!,
                fromBlock,
                toBlock
            );

            for (const event of incomingOrderEvents) {
                await this.handleIncomingOrderProcessed(event);
            }

            // Get OutgoingOrderCreated events
            const outgoingOrderEvents = await contracts.monadBridge.queryFilter(
                this.monadFilters.get('OutgoingOrderCreated')!,
                fromBlock,
                toBlock
            );

            for (const event of outgoingOrderEvents) {
                await this.handleOutgoingOrderCreated(event);
            }

        } catch (error) {
            this.logger.error('Failed to process Monad Bridge events:', error);
        }
    }

    /**
     * Process Monad HTLC events
     */
    private async processMonadHTLCEvents(fromBlock: number, toBlock: number): Promise<void> {
        const contracts = this.relayerService.getContracts();

        try {
            // Process HTLC events
            const htlcEvents = await Promise.all([
                contracts.monadHTLC.queryFilter(this.monadFilters.get('HTLCCreated')!, fromBlock, toBlock),
                contracts.monadHTLC.queryFilter(this.monadFilters.get('HTLCWithdrawn')!, fromBlock, toBlock),
                contracts.monadHTLC.queryFilter(this.monadFilters.get('HTLCRefunded')!, fromBlock, toBlock)
            ]);

            const [createdEvents, withdrawnEvents, refundedEvents] = htlcEvents;

            for (const event of createdEvents) {
                await this.handleHTLCCreated(event, 'monad');
            }

            for (const event of withdrawnEvents) {
                await this.handleHTLCWithdrawn(event, 'monad');
            }

            for (const event of refundedEvents) {
                await this.handleHTLCRefunded(event, 'monad');
            }

        } catch (error) {
            this.logger.error('Failed to process Monad HTLC events:', error);
        }
    }

    /**
     * Handle CrossChainOrderCreated events
     */
    private async handleCrossChainOrderCreated(event: ethers.EventLog): Promise<void> {
        try {
            const { orderHash, maker, tokenIn, tokenOut, amountIn, amountOut, hashlock, timelock, targetChainId, monadReceiver } = event.args!;

            this.logger.info(`CrossChainOrderCreated: ${orderHash}`);

            // Relay to Monad
            await this.relayerService.relayEthereumToMonad({
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
            this.logger.error('Failed to handle CrossChainOrderCreated event:', error);
        }
    }

    /**
     * Handle CrossChainOrderFulfilled events
     */
    private async handleCrossChainOrderFulfilled(event: ethers.EventLog): Promise<void> {
        try {
            const { orderHash, secret, fulfiller } = event.args!;
            this.logger.info(`CrossChainOrderFulfilled: ${orderHash} by ${fulfiller}`);

            // Additional processing logic here
        } catch (error) {
            this.logger.error('Failed to handle CrossChainOrderFulfilled event:', error);
        }
    }

    /**
     * Handle CrossChainOrderRefunded events
     */
    private async handleCrossChainOrderRefunded(event: ethers.EventLog): Promise<void> {
        try {
            const { orderHash, maker } = event.args!;
            this.logger.info(`CrossChainOrderRefunded: ${orderHash} for ${maker}`);

            // Additional processing logic here
        } catch (error) {
            this.logger.error('Failed to handle CrossChainOrderRefunded event:', error);
        }
    }

    /**
     * Handle HTLC Created events
     */
    private async handleHTLCCreated(event: ethers.EventLog, chain: string): Promise<void> {
        try {
            const { contractId, sender, receiver, token, amount, hashlock, timelock } = event.args!;
            this.logger.debug(`HTLC Created on ${chain}: ${contractId}`);

            // Additional processing logic here
        } catch (error) {
            this.logger.error(`Failed to handle HTLC Created event on ${chain}:`, error);
        }
    }

    /**
     * Handle HTLC Withdrawn events
     */
    private async handleHTLCWithdrawn(event: ethers.EventLog, chain: string): Promise<void> {
        try {
            const { contractId, secret } = event.args!;
            this.logger.info(`HTLC Withdrawn on ${chain}: ${contractId}`);

            // Trigger secret propagation to other chain
            // This would be handled by the resolver service
        } catch (error) {
            this.logger.error(`Failed to handle HTLC Withdrawn event on ${chain}:`, error);
        }
    }

    /**
     * Handle HTLC Refunded events
     */
    private async handleHTLCRefunded(event: ethers.EventLog, chain: string): Promise<void> {
        try {
            const { contractId } = event.args!;
            this.logger.info(`HTLC Refunded on ${chain}: ${contractId}`);

            // Additional processing logic here
        } catch (error) {
            this.logger.error(`Failed to handle HTLC Refunded event on ${chain}:`, error);
        }
    }

    /**
     * Handle IncomingOrderProcessed events
     */
    private async handleIncomingOrderProcessed(event: ethers.EventLog): Promise<void> {
        try {
            const { ethereumOrderHash, monadOrderHash, monadReceiver } = event.args!;
            this.logger.info(`IncomingOrderProcessed: ${ethereumOrderHash} -> ${monadOrderHash}`);

            // Additional processing logic here
        } catch (error) {
            this.logger.error('Failed to handle IncomingOrderProcessed event:', error);
        }
    }

    /**
     * Handle OutgoingOrderCreated events
     */
    private async handleOutgoingOrderCreated(event: ethers.EventLog): Promise<void> {
        try {
            const { orderHash, maker, targetChainId, ethereumReceiver } = event.args!;
            this.logger.info(`OutgoingOrderCreated: ${orderHash} targeting chain ${targetChainId}`);

            // Relay to Ethereum if needed
            // Implementation would depend on the specific requirements
        } catch (error) {
            this.logger.error('Failed to handle OutgoingOrderCreated event:', error);
        }
    }

    /**
     * Get monitoring statistics
     */
    getStats(): MonitoringStats {
        return {
            isRunning: this.isRunning,
            lastProcessedBlocks: { ...this.lastProcessedBlock },
            eventFilters: {
                ethereum: this.ethereumFilters.size,
                monad: this.monadFilters.size
            }
        };
    }
}

// Type definitions
interface MonitoringStats {
    isRunning: boolean;
    lastProcessedBlocks: {
        ethereum: number;
        monad: number;
    };
    eventFilters: {
        ethereum: number;
        monad: number;
    };
}
