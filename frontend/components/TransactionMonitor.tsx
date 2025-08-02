import React, { useState, useEffect } from 'react';
import { useContract } from '../hooks/useContract';

interface TransactionMonitorProps {
    orderHash: string;
    onSwapCompleted?: () => void;
    onSwapFailed?: () => void;
}

interface OrderStatus {
    isActive: boolean;
    isFulfilled: boolean;
    isRefunded: boolean;
    timelock: number;
    remainingTime: number;
    sourceChain: 'ethereum' | 'monad';
    targetChain: 'ethereum' | 'monad';
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    maker: string;
    receiver: string;
    htlcStatus: {
        ethereum?: {
            created: boolean;
            withdrawn: boolean;
            refunded: boolean;
            contractId?: string;
        };
        monad?: {
            created: boolean;
            withdrawn: boolean;
            refunded: boolean;
            contractId?: string;
        };
    };
}

interface HTLCEvent {
    type: 'created' | 'withdrawn' | 'refunded';
    chain: 'ethereum' | 'monad';
    contractId: string;
    timestamp: number;
    transactionHash: string;
    secret?: string;
}

export const TransactionMonitor: React.FC<TransactionMonitorProps> = ({
    orderHash,
    onSwapCompleted,
    onSwapFailed
}) => {
    const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
    const [htlcEvents, setHTLCEvents] = useState<HTLCEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const { getOrderStatus, getHTLCEvents } = useContract();

    useEffect(() => {
        loadOrderStatus();
        
        if (autoRefresh) {
            const interval = setInterval(loadOrderStatus, 10000); // Refresh every 10 seconds
            return () => clearInterval(interval);
        }
    }, [orderHash, autoRefresh]);

    useEffect(() => {
        // Check if swap is completed or failed
        if (orderStatus) {
            if (orderStatus.isFulfilled) {
                onSwapCompleted?.();
                setAutoRefresh(false);
            } else if (orderStatus.isRefunded) {
                onSwapFailed?.();
                setAutoRefresh(false);
            } else if (orderStatus.remainingTime <= 0 && !orderStatus.isFulfilled) {
                onSwapFailed?.();
                setAutoRefresh(false);
            }
        }
    }, [orderStatus, onSwapCompleted, onSwapFailed]);

    const loadOrderStatus = async () => {
        try {
            setError(null);
            
            const [status, events] = await Promise.all([
                getOrderStatus(orderHash),
                getHTLCEvents(orderHash)
            ]);

            setOrderStatus(status);
            setHTLCEvents(events);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load order status');
        } finally {
            setIsLoading(false);
        }
    };

    const formatTime = (seconds: number): string => {
        if (seconds <= 0) return 'Expired';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    };

    const getStatusIcon = (status: 'pending' | 'active' | 'completed' | 'failed') => {
        switch (status) {
            case 'pending': return '⏳';
            case 'active': return '🔄';
            case 'completed': return '✅';
            case 'failed': return '❌';
            default: return '⭕';
        }
    };

    const getSwapStatus = (): 'pending' | 'active' | 'completed' | 'failed' => {
        if (!orderStatus) return 'pending';
        if (orderStatus.isFulfilled) return 'completed';
        if (orderStatus.isRefunded || orderStatus.remainingTime <= 0) return 'failed';
        if (orderStatus.isActive) return 'active';
        return 'pending';
    };

    const renderOrderInfo = () => {
        if (!orderStatus) return null;

        return (
            <div className="order-info">
                <h4>Order Details</h4>
                <div className="info-grid">
                    <div className="info-item">
                        <span className="label">Order Hash:</span>
                        <span className="value monospace">{orderHash.slice(0, 10)}...{orderHash.slice(-8)}</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Direction:</span>
                        <span className="value">{orderStatus.sourceChain} → {orderStatus.targetChain}</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Amount:</span>
                        <span className="value">{orderStatus.amountIn} → {orderStatus.amountOut}</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Time Remaining:</span>
                        <span className={`value ${orderStatus.remainingTime <= 3600 ? 'warning' : ''}`}>
                            {formatTime(orderStatus.remainingTime)}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    const renderHTLCStatus = () => {
        if (!orderStatus) return null;

        const ethereumHTLC = orderStatus.htlcStatus.ethereum;
        const monadHTLC = orderStatus.htlcStatus.monad;

        return (
            <div className="htlc-status">
                <h4>HTLC Status</h4>
                
                <div className="htlc-chains">
                    {/* Ethereum HTLC */}
                    <div className="htlc-chain">
                        <h5>Ethereum HTLC</h5>
                        <div className="htlc-steps">
                            <div className={`htlc-step ${ethereumHTLC?.created ? 'completed' : 'pending'}`}>
                                <span className="step-icon">{ethereumHTLC?.created ? '✅' : '⏳'}</span>
                                <span className="step-text">Contract Created</span>
                            </div>
                            <div className={`htlc-step ${ethereumHTLC?.withdrawn ? 'completed' : ethereumHTLC?.refunded ? 'failed' : 'pending'}`}>
                                <span className="step-icon">
                                    {ethereumHTLC?.withdrawn ? '✅' : ethereumHTLC?.refunded ? '❌' : '⏳'}
                                </span>
                                <span className="step-text">
                                    {ethereumHTLC?.withdrawn ? 'Withdrawn' : ethereumHTLC?.refunded ? 'Refunded' : 'Waiting for Secret'}
                                </span>
                            </div>
                        </div>
                        {ethereumHTLC?.contractId && (
                            <div className="contract-id">
                                Contract ID: <span className="monospace">{ethereumHTLC.contractId.slice(0, 10)}...</span>
                            </div>
                        )}
                    </div>

                    {/* Monad HTLC */}
                    <div className="htlc-chain">
                        <h5>Monad HTLC</h5>
                        <div className="htlc-steps">
                            <div className={`htlc-step ${monadHTLC?.created ? 'completed' : 'pending'}`}>
                                <span className="step-icon">{monadHTLC?.created ? '✅' : '⏳'}</span>
                                <span className="step-text">Contract Created</span>
                            </div>
                            <div className={`htlc-step ${monadHTLC?.withdrawn ? 'completed' : monadHTLC?.refunded ? 'failed' : 'pending'}`}>
                                <span className="step-icon">
                                    {monadHTLC?.withdrawn ? '✅' : monadHTLC?.refunded ? '❌' : '⏳'}
                                </span>
                                <span className="step-text">
                                    {monadHTLC?.withdrawn ? 'Withdrawn' : monadHTLC?.refunded ? 'Refunded' : 'Waiting for Fulfillment'}
                                </span>
                            </div>
                        </div>
                        {monadHTLC?.contractId && (
                            <div className="contract-id">
                                Contract ID: <span className="monospace">{monadHTLC.contractId.slice(0, 10)}...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderEventLog = () => {
        if (htlcEvents.length === 0) return null;

        return (
            <div className="event-log">
                <h4>Event Log</h4>
                <div className="events">
                    {htlcEvents.map((event, index) => (
                        <div key={index} className="event-item">
                            <div className="event-header">
                                <span className="event-type">{event.type}</span>
                                <span className="event-chain">{event.chain}</span>
                                <span className="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div className="event-details">
                                <span className="contract-id">Contract: {event.contractId.slice(0, 10)}...</span>
                                <a 
                                    href={`https://${event.chain === 'ethereum' ? 'etherscan.io' : 'monad-explorer.com'}/tx/${event.transactionHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="tx-link"
                                >
                                    View Transaction
                                </a>
                            </div>
                            {event.secret && (
                                <div className="event-secret">
                                    Secret revealed: <span className="monospace">{event.secret.slice(0, 10)}...</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderProgressBar = () => {
        const status = getSwapStatus();
        const progress = status === 'completed' ? 100 : 
                        status === 'active' ? 66 : 
                        status === 'failed' ? 0 : 33;

        return (
            <div className="progress-container">
                <div className="progress-bar">
                    <div 
                        className={`progress-fill ${status}`}
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="progress-text">
                    {getStatusIcon(status)} {status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className="transaction-monitor loading">
                <div className="loading-spinner">Loading order status...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="transaction-monitor error">
                <div className="error-message">
                    <span>⚠️ {error}</span>
                    <button onClick={loadOrderStatus} className="retry-button">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="transaction-monitor">
            <div className="monitor-header">
                <h3>Transaction Monitor</h3>
                <div className="refresh-controls">
                    <label>
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        Auto-refresh
                    </label>
                    <button onClick={loadOrderStatus} className="refresh-button">
                        🔄 Refresh
                    </button>
                </div>
            </div>

            {renderProgressBar()}
            {renderOrderInfo()}
            {renderHTLCStatus()}
            {renderEventLog()}
        </div>
    );
};

// CSS styles (would typically be in a separate CSS file)
const styles = `
.transaction-monitor {
    max-width: 800px;
    margin: 20px auto;
    padding: 20px;
    background: #f9f9f9;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
}

.transaction-monitor.loading,
.transaction-monitor.error {
    text-align: center;
    padding: 40px;
}

.loading-spinner {
    font-size: 16px;
    color: #666;
}

.error-message {
    color: #d00;
    margin-bottom: 10px;
}

.retry-button {
    margin-left: 10px;
    padding: 4px 8px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.monitor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid #ddd;
}

.monitor-header h3 {
    margin: 0;
    color: #333;
}

.refresh-controls {
    display: flex;
    align-items: center;
    gap: 10px;
}

.refresh-controls label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 14px;
    color: #666;
}

.refresh-button {
    padding: 6px 12px;
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}

.refresh-button:hover {
    background: #e0e0e0;
}

.progress-container {
    margin-bottom: 20px;
}

.progress-bar {
    width: 100%;
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
}

.progress-fill {
    height: 100%;
    transition: width 0.3s ease;
}

.progress-fill.pending {
    background: #ffc107;
}

.progress-fill.active {
    background: #007bff;
}

.progress-fill.completed {
    background: #28a745;
}

.progress-fill.failed {
    background: #dc3545;
}

.progress-text {
    text-align: center;
    font-weight: 500;
    font-size: 14px;
    color: #555;
}

.order-info,
.htlc-status,
.event-log {
    margin-bottom: 20px;
    padding: 15px;
    background: white;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
}

.order-info h4,
.htlc-status h4,
.event-log h4 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 16px;
}

.info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
}

.info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.info-item .label {
    font-size: 12px;
    color: #666;
    font-weight: 500;
}

.info-item .value {
    font-size: 14px;
    color: #333;
}

.info-item .value.warning {
    color: #dc3545;
    font-weight: 500;
}

.monospace {
    font-family: 'Courier New', monospace;
    font-size: 13px;
}

.htlc-chains {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
}

.htlc-chain h5 {
    margin: 0 0 10px 0;
    color: #555;
    font-size: 14px;
}

.htlc-steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.htlc-step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 4px;
    font-size: 14px;
}

.htlc-step.completed {
    background: #e8f5e8;
    color: #2e7d2e;
}

.htlc-step.failed {
    background: #ffeaea;
    color: #c73e1d;
}

.htlc-step.pending {
    background: #f0f0f0;
    color: #666;
}

.contract-id {
    margin-top: 8px;
    font-size: 12px;
    color: #666;
}

.events {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.event-item {
    padding: 10px;
    background: #f8f9fa;
    border-radius: 4px;
    border-left: 3px solid #007bff;
}

.event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
}

.event-type {
    font-weight: 500;
    text-transform: capitalize;
}

.event-chain {
    background: #e9ecef;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 12px;
    color: #495057;
}

.event-time {
    font-size: 12px;
    color: #666;
}

.event-details {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: #666;
}

.tx-link {
    color: #007bff;
    text-decoration: none;
}

.tx-link:hover {
    text-decoration: underline;
}

.event-secret {
    margin-top: 5px;
    font-size: 12px;
    color: #28a745;
    font-weight: 500;
}

@media (max-width: 768px) {
    .htlc-chains {
        grid-template-columns: 1fr;
    }
    
    .info-grid {
        grid-template-columns: 1fr;
    }
    
    .event-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 5px;
    }
}
`;
