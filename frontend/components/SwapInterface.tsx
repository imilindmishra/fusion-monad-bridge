import React, { useState, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useSwap } from '../hooks/useSwap';
import { TransactionMonitor } from './TransactionMonitor';

interface SwapInterfaceProps {
    onSwapInitiated?: (orderHash: string) => void;
}

interface SwapData {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    sourceChain: 'ethereum' | 'monad';
    targetChain: 'ethereum' | 'monad';
    receiver: string;
    timelock: number;
}

export const SwapInterface: React.FC<SwapInterfaceProps> = ({ onSwapInitiated }) => {
    const [swapData, setSwapData] = useState<SwapData>({
        tokenIn: '',
        tokenOut: '',
        amountIn: '',
        amountOut: '',
        sourceChain: 'ethereum',
        targetChain: 'monad',
        receiver: '',
        timelock: 24 // hours
    });

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentOrderHash, setCurrentOrderHash] = useState<string | null>(null);
    const [swapProgress, setSwapProgress] = useState<'idle' | 'creating' | 'waiting' | 'completed' | 'failed'>('idle');

    const { 
        isConnected, 
        address, 
        chainId, 
        connectWallet, 
        switchChain 
    } = useWallet();

    const { 
        createOrder, 
        estimateSwap, 
        getSupportedTokens, 
        supportedTokens 
    } = useSwap();

    useEffect(() => {
        // Load supported tokens when component mounts
        getSupportedTokens();
    }, [getSupportedTokens]);

    const handleInputChange = (field: keyof SwapData, value: string | number) => {
        setSwapData(prev => ({
            ...prev,
            [field]: value
        }));
        
        // Clear error when user starts typing
        if (error) {
            setError(null);
        }
    };

    const handleEstimateSwap = async () => {
        try {
            if (!swapData.tokenIn || !swapData.tokenOut || !swapData.amountIn) {
                setError('Please fill in all required fields');
                return;
            }

            setIsLoading(true);
            const estimate = await estimateSwap({
                tokenIn: swapData.tokenIn,
                tokenOut: swapData.tokenOut,
                amountIn: swapData.amountIn,
                sourceChain: swapData.sourceChain,
                targetChain: swapData.targetChain
            });

            setSwapData(prev => ({
                ...prev,
                amountOut: estimate.amountOut
            }));

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to estimate swap');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateSwap = async () => {
        try {
            if (!isConnected) {
                await connectWallet();
                return;
            }

            // Validate all fields
            if (!swapData.tokenIn || !swapData.tokenOut || !swapData.amountIn || !swapData.amountOut) {
                setError('Please fill in all required fields');
                return;
            }

            if (!swapData.receiver) {
                setSwapData(prev => ({ ...prev, receiver: address! }));
            }

            // Check if we're on the correct chain
            const requiredChainId = swapData.sourceChain === 'ethereum' ? 1 : 11155111; // Placeholder for Monad
            if (chainId !== requiredChainId) {
                await switchChain(requiredChainId);
                return;
            }

            setIsLoading(true);
            setSwapProgress('creating');
            setError(null);

            const orderHash = await createOrder({
                tokenIn: swapData.tokenIn,
                tokenOut: swapData.tokenOut,
                amountIn: swapData.amountIn,
                amountOut: swapData.amountOut,
                sourceChain: swapData.sourceChain,
                targetChain: swapData.targetChain,
                receiver: swapData.receiver,
                timelock: swapData.timelock
            });

            setCurrentOrderHash(orderHash);
            setSwapProgress('waiting');
            
            if (onSwapInitiated) {
                onSwapInitiated(orderHash);
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create swap');
            setSwapProgress('failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSwitchChains = () => {
        setSwapData(prev => ({
            ...prev,
            sourceChain: prev.targetChain,
            targetChain: prev.sourceChain,
            tokenIn: prev.tokenOut,
            tokenOut: prev.tokenIn,
            amountIn: prev.amountOut,
            amountOut: prev.amountIn
        }));
    };

    const getChainName = (chain: 'ethereum' | 'monad') => {
        return chain === 'ethereum' ? 'Ethereum' : 'Monad';
    };

    const renderSwapForm = () => (
        <div className="swap-form">
            <div className="form-header">
                <h2>Cross-Chain Swap</h2>
                <p>Swap tokens between Ethereum and Monad using HTLCs</p>
            </div>

            {/* Source Chain */}
            <div className="chain-section">
                <div className="chain-header">
                    <h3>From {getChainName(swapData.sourceChain)}</h3>
                </div>
                
                <div className="token-input">
                    <select 
                        value={swapData.tokenIn}
                        onChange={(e) => handleInputChange('tokenIn', e.target.value)}
                        disabled={isLoading}
                    >
                        <option value="">Select token</option>
                        {supportedTokens
                            .filter(token => token.chain === swapData.sourceChain)
                            .map(token => (
                                <option key={token.address} value={token.address}>
                                    {token.symbol} - {token.name}
                                </option>
                            ))}
                    </select>
                    
                    <input
                        type="number"
                        placeholder="Amount"
                        value={swapData.amountIn}
                        onChange={(e) => handleInputChange('amountIn', e.target.value)}
                        disabled={isLoading}
                    />
                </div>
            </div>

            {/* Switch Button */}
            <div className="switch-section">
                <button 
                    onClick={handleSwitchChains}
                    disabled={isLoading}
                    className="switch-button"
                >
                    ⇅ Switch
                </button>
            </div>

            {/* Target Chain */}
            <div className="chain-section">
                <div className="chain-header">
                    <h3>To {getChainName(swapData.targetChain)}</h3>
                </div>
                
                <div className="token-input">
                    <select 
                        value={swapData.tokenOut}
                        onChange={(e) => handleInputChange('tokenOut', e.target.value)}
                        disabled={isLoading}
                    >
                        <option value="">Select token</option>
                        {supportedTokens
                            .filter(token => token.chain === swapData.targetChain)
                            .map(token => (
                                <option key={token.address} value={token.address}>
                                    {token.symbol} - {token.name}
                                </option>
                            ))}
                    </select>
                    
                    <input
                        type="number"
                        placeholder="Amount"
                        value={swapData.amountOut}
                        onChange={(e) => handleInputChange('amountOut', e.target.value)}
                        disabled={isLoading}
                    />
                </div>
            </div>

            {/* Advanced Options */}
            <div className="advanced-options">
                <details>
                    <summary>Advanced Options</summary>
                    
                    <div className="option-group">
                        <label>Receiver Address:</label>
                        <input
                            type="text"
                            placeholder="Leave empty to use your address"
                            value={swapData.receiver}
                            onChange={(e) => handleInputChange('receiver', e.target.value)}
                            disabled={isLoading}
                        />
                    </div>
                    
                    <div className="option-group">
                        <label>Timelock (hours):</label>
                        <input
                            type="number"
                            min="1"
                            max="168"
                            value={swapData.timelock}
                            onChange={(e) => handleInputChange('timelock', parseInt(e.target.value))}
                            disabled={isLoading}
                        />
                    </div>
                </details>
            </div>

            {/* Action Buttons */}
            <div className="action-buttons">
                <button
                    onClick={handleEstimateSwap}
                    disabled={isLoading || !swapData.tokenIn || !swapData.tokenOut || !swapData.amountIn}
                    className="estimate-button"
                >
                    {isLoading ? 'Estimating...' : 'Estimate'}
                </button>
                
                <button
                    onClick={handleCreateSwap}
                    disabled={isLoading || !swapData.tokenIn || !swapData.tokenOut || !swapData.amountIn || !swapData.amountOut}
                    className="swap-button"
                >
                    {isLoading ? 'Creating Swap...' : isConnected ? 'Create Swap' : 'Connect Wallet'}
                </button>
            </div>

            {/* Error Display */}
            {error && (
                <div className="error-message">
                    <span>⚠️ {error}</span>
                </div>
            )}
        </div>
    );

    const renderSwapProgress = () => (
        <div className="swap-progress">
            <h3>Swap Progress</h3>
            
            <div className="progress-steps">
                <div className={`step ${swapProgress === 'creating' ? 'active' : swapProgress === 'waiting' || swapProgress === 'completed' ? 'completed' : ''}`}>
                    <span className="step-number">1</span>
                    <span className="step-label">Creating Order</span>
                </div>
                
                <div className={`step ${swapProgress === 'waiting' ? 'active' : swapProgress === 'completed' ? 'completed' : ''}`}>
                    <span className="step-number">2</span>
                    <span className="step-label">Waiting for Fulfillment</span>
                </div>
                
                <div className={`step ${swapProgress === 'completed' ? 'completed' : ''}`}>
                    <span className="step-number">3</span>
                    <span className="step-label">Swap Completed</span>
                </div>
            </div>
            
            {currentOrderHash && (
                <TransactionMonitor 
                    orderHash={currentOrderHash}
                    onSwapCompleted={() => setSwapProgress('completed')}
                    onSwapFailed={() => setSwapProgress('failed')}
                />
            )}
            
            <button
                onClick={() => {
                    setSwapProgress('idle');
                    setCurrentOrderHash(null);
                    setError(null);
                }}
                className="new-swap-button"
            >
                Start New Swap
            </button>
        </div>
    );

    return (
        <div className="swap-interface">
            {swapProgress === 'idle' || swapProgress === 'creating' || swapProgress === 'failed' 
                ? renderSwapForm() 
                : renderSwapProgress()
            }
        </div>
    );
};

// CSS styles (would typically be in a separate CSS file)
const styles = `
.swap-interface {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.swap-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.form-header {
    text-align: center;
    margin-bottom: 20px;
}

.form-header h2 {
    margin: 0 0 8px 0;
    color: #333;
}

.form-header p {
    margin: 0;
    color: #666;
    font-size: 14px;
}

.chain-section {
    padding: 16px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #f9f9f9;
}

.chain-header h3 {
    margin: 0 0 12px 0;
    color: #333;
    font-size: 16px;
}

.token-input {
    display: flex;
    gap: 12px;
}

.token-input select,
.token-input input {
    flex: 1;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
}

.switch-section {
    display: flex;
    justify-content: center;
    margin: -10px 0;
}

.switch-button {
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    cursor: pointer;
    font-size: 18px;
    transition: all 0.2s;
}

.switch-button:hover {
    background: #e0e0e0;
    transform: rotate(180deg);
}

.advanced-options {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 12px;
}

.advanced-options summary {
    cursor: pointer;
    font-weight: 500;
    margin-bottom: 12px;
}

.option-group {
    margin-bottom: 12px;
}

.option-group label {
    display: block;
    margin-bottom: 4px;
    font-size: 14px;
    color: #555;
}

.option-group input {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
}

.action-buttons {
    display: flex;
    gap: 12px;
}

.estimate-button,
.swap-button {
    flex: 1;
    padding: 14px;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.estimate-button {
    background: #f0f0f0;
    color: #333;
}

.estimate-button:hover:not(:disabled) {
    background: #e0e0e0;
}

.swap-button {
    background: #007bff;
    color: white;
}

.swap-button:hover:not(:disabled) {
    background: #0056b3;
}

.estimate-button:disabled,
.swap-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.error-message {
    padding: 12px;
    background: #ffe6e6;
    border: 1px solid #ffcccc;
    border-radius: 6px;
    color: #d00;
    font-size: 14px;
}

.swap-progress {
    text-align: center;
}

.progress-steps {
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 30px 0;
    gap: 20px;
}

.step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    opacity: 0.5;
    transition: opacity 0.3s;
}

.step.active,
.step.completed {
    opacity: 1;
}

.step-number {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
    transition: all 0.3s;
}

.step.active .step-number {
    background: #007bff;
    color: white;
}

.step.completed .step-number {
    background: #28a745;
    color: white;
}

.step-label {
    font-size: 12px;
    color: #666;
}

.new-swap-button {
    margin-top: 20px;
    padding: 12px 24px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
}

.new-swap-button:hover {
    background: #0056b3;
}
`;
