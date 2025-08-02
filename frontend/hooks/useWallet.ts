import { useState, useEffect, useCallback } from 'react';

interface WalletState {
    isConnected: boolean;
    address: string | null;
    chainId: number | null;
    isConnecting: boolean;
    error: string | null;
}

declare global {
    interface Window {
        ethereum?: any;
    }
}

export const useWallet = () => {
    const [walletState, setWalletState] = useState<WalletState>({
        isConnected: false,
        address: null,
        chainId: null,
        isConnecting: false,
        error: null
    });

    const updateWalletState = useCallback(async () => {
        if (!window.ethereum) return;

        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });

            setWalletState(prev => ({
                ...prev,
                isConnected: accounts.length > 0,
                address: accounts[0] || null,
                chainId: parseInt(chainId, 16),
                error: null
            }));
        } catch (error) {
            setWalletState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to get wallet state'
            }));
        }
    }, []);

    const connectWallet = useCallback(async () => {
        if (!window.ethereum) {
            setWalletState(prev => ({
                ...prev,
                error: 'No Web3 wallet detected. Please install MetaMask or similar wallet.'
            }));
            return;
        }

        setWalletState(prev => ({ ...prev, isConnecting: true, error: null }));

        try {
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            const chainId = await window.ethereum.request({ method: 'eth_chainId' });

            setWalletState(prev => ({
                ...prev,
                isConnected: true,
                address: accounts[0],
                chainId: parseInt(chainId, 16),
                isConnecting: false,
                error: null
            }));
        } catch (error) {
            setWalletState(prev => ({
                ...prev,
                isConnecting: false,
                error: error instanceof Error ? error.message : 'Failed to connect wallet'
            }));
        }
    }, []);

    const disconnectWallet = useCallback(() => {
        setWalletState({
            isConnected: false,
            address: null,
            chainId: null,
            isConnecting: false,
            error: null
        });
    }, []);

    const switchChain = useCallback(async (targetChainId: number) => {
        if (!window.ethereum) return;

        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${targetChainId.toString(16)}` }]
            });
        } catch (error: any) {
            // If chain doesn't exist, add it
            if (error.code === 4902) {
                try {
                    await addChain(targetChainId);
                } catch (addError) {
                    setWalletState(prev => ({
                        ...prev,
                        error: 'Failed to add chain'
                    }));
                }
            } else {
                setWalletState(prev => ({
                    ...prev,
                    error: error.message || 'Failed to switch chain'
                }));
            }
        }
    }, []);

    const addChain = async (chainId: number) => {
        const chainConfigs = {
            1: {
                chainId: '0x1',
                chainName: 'Ethereum Mainnet',
                rpcUrls: ['https://mainnet.infura.io/v3/'],
                nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                blockExplorerUrls: ['https://etherscan.io']
            },
            11155111: {
                chainId: '0xaa36a7',
                chainName: 'Sepolia Testnet',
                rpcUrls: ['https://sepolia.infura.io/v3/'],
                nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                blockExplorerUrls: ['https://sepolia.etherscan.io']
            }
            // Monad chain config would be added here when available
        };

        const config = chainConfigs[chainId as keyof typeof chainConfigs];
        if (!config) {
            throw new Error('Chain configuration not found');
        }

        await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [config]
        });
    };

    useEffect(() => {
        if (window.ethereum) {
            updateWalletState();

            // Listen for account changes
            const handleAccountsChanged = (accounts: string[]) => {
                setWalletState(prev => ({
                    ...prev,
                    isConnected: accounts.length > 0,
                    address: accounts[0] || null
                }));
            };

            // Listen for chain changes
            const handleChainChanged = (chainId: string) => {
                setWalletState(prev => ({
                    ...prev,
                    chainId: parseInt(chainId, 16)
                }));
            };

            window.ethereum.on('accountsChanged', handleAccountsChanged);
            window.ethereum.on('chainChanged', handleChainChanged);

            return () => {
                window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
                window.ethereum.removeListener('chainChanged', handleChainChanged);
            };
        }
    }, [updateWalletState]);

    return {
        ...walletState,
        connectWallet,
        disconnectWallet,
        switchChain
    };
};
