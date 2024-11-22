import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import MultiBetExpJson from '../contracts/MultiBetExp.json';
const CONTRACT_ABI = MultiBetExpJson.abi;

const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS;
const HOLESKY_RPC_URL = process.env.REACT_APP_HOLESKY_RPC_URL;

const MultiBetDApp = () => {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [betCount, setBetCount] = useState(0);
  const [currentBetId, setCurrentBetId] = useState(0);
  const [betDetails, setBetDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // New bet state
  const [newBetTopic, setNewBetTopic] = useState('');
  const [newBetOptions, setNewBetOptions] = useState('');
  
  // Place bet state
  const [selectedOption, setSelectedOption] = useState('');
  const [betAmount, setBetAmount] = useState('');

  // connectWallet 함수 수정
  const connectWallet = async () => {
    try {
      if (window.ethereum) {
        // Holesky testnet의 chain ID는 17000입니다
        const holeskyChainId = "0x4268";
        
        // 현재 네트워크 확인
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        
        // Holesky가 아니면 네트워크 전환 요청
        if (chainId !== holeskyChainId) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: holeskyChainId }],
            });
          } catch (switchError) {
            // 사용자가 Holesky를 추가하지 않은 경우, 추가하도록 요청
            if (switchError.code === 4902) {
              try {
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [
                    {
                      chainId: holeskyChainId,
                      chainName: 'Holesky Testnet',
                      nativeCurrency: {
                        name: 'ETH',
                        symbol: 'ETH',
                        decimals: 18
                      },
                      rpcUrls: [HOLESKY_RPC_URL],
                      blockExplorerUrls: ['https://holesky.etherscan.io']
                    },
                  ],
                });
              } catch (addError) {
                throw new Error('Failed to add Holesky network');
              }
            } else {
              throw switchError;
            }
          }
        }

        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        
        setProvider(provider);
        setSigner(signer);
        setContract(contract);
        setAccount(await signer.getAddress());
        
        // Check if connected account is owner
        const contractOwner = await contract.owner();
        setIsOwner(contractOwner.toLowerCase() === (await signer.getAddress()).toLowerCase());
        
        // Get current bet count
        const count = await contract.betCount();
        setBetCount(Number(count));

        // Listen for network changes
        window.ethereum.on('chainChanged', () => {
          window.location.reload();
        });

        // Listen for account changes
        window.ethereum.on('accountsChanged', (accounts) => {
          if (accounts.length === 0) {
            setAccount('');
            setIsOwner(false);
          } else {
            connectWallet();
          }
        });

      } else {
        setError('Please install MetaMask!');
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError(err.message);
    }
  };

  // loadBetDetails 함수 수정
  const loadBetDetails = async () => {
    try {
      setLoading(true);
      
      // 현재 betId의 베팅이 종료되었다면 다음 베팅을 찾습니다
      let foundActiveBet = false;
      let currentId = currentBetId;
      
      while (currentId < betCount && !foundActiveBet) {
        const bet = await contract.getBet(currentId);
        if (!bet.isResolved) {
          foundActiveBet = true;
          const optionInfos = await contract.getBetOptionInfos(currentId);
          
          setBetDetails({
            topic: bet.topic,
            isResolved: bet.isResolved,
            totalAmount: ethers.utils.formatEther(bet.totalAmount),
            winningOption: bet.winningOption,
            options: optionInfos.options,
            optionBets: optionInfos.optionBets.map(amount => ethers.utils.formatEther(amount))
          });
          
          if (currentId !== currentBetId) {
            setCurrentBetId(currentId);
          }
        } else {
          currentId++;
        }
      }

      if (!foundActiveBet) {
        setBetDetails(null);
        setError('No active bets available');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Create new bet
  const createBet = async () => {
    try {
      if (!isOwner) {
        setError('Only owner can create bets');
        return;
      }
      
      setLoading(true);
      const options = newBetOptions.split(',').map(opt => opt.trim());
      if (options.length < 2) {
        throw new Error('At least two options are required');
      }
      
      const tx = await contract.createBet(newBetTopic, options);
      await tx.wait();
      
      const newCount = await contract.betCount();
      setBetCount(Number(newCount));
      setNewBetTopic('');
      setNewBetOptions('');
      setCurrentBetId(Number(newCount) - 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Place bet
  const placeBet = async () => {
    try {
      if (!selectedOption || !betAmount) {
        setError('Please select option and enter amount');
        return;
      }
      
      setLoading(true);
      const tx = await contract.placeBet(
        currentBetId,
        selectedOption,
        { value: ethers.utils.parseEther(betAmount) }
      );
      await tx.wait();
      
      await loadBetDetails();
      setSelectedOption('');
      setBetAmount('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Resolve bet
  const resolveBet = async (winningOption) => {
    try {
      if (!isOwner) {
        setError('Only owner can resolve bets');
        return;
      }
      
      setLoading(true);
      const tx = await contract.resolveBet(currentBetId, winningOption);
      await tx.wait();
      
      await loadBetDetails();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Load bet details when contract or currentBetId changes
  useEffect(() => {
    if (contract && currentBetId < betCount) {
      loadBetDetails();
    }
  }, [contract, currentBetId, betCount]);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>MultiBet DApp</CardTitle>
        </CardHeader>
        <CardContent>
          {!account ? (
            <Button onClick={connectWallet}>Connect Wallet</Button>
          ) : (
            <div className="text-sm">Connected: {account}</div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {account && (
        <>
          {isOwner && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Create New Bet</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Input
                    placeholder="Bet Topic"
                    value={newBetTopic}
                    onChange={(e) => setNewBetTopic(e.target.value)}
                    disabled={loading}
                  />
                  <Input
                    placeholder="Options (comma-separated)"
                    value={newBetOptions}
                    onChange={(e) => setNewBetOptions(e.target.value)}
                    disabled={loading}
                  />
                  <Button onClick={createBet} disabled={loading}>
                    {loading ? 'Creating...' : 'Create Bet'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Current Bet ({currentBetId + 1} of {betCount})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex space-x-2">
                  <Button
                    onClick={() => setCurrentBetId(prev => Math.max(0, prev - 1))}
                    disabled={currentBetId === 0 || loading}
                  >
                    Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentBetId(prev => Math.min(betCount - 1, prev + 1))}
                    disabled={currentBetId >= betCount - 1 || loading}
                  >
                    Next
                  </Button>
                </div>

                {betDetails && (
                  <div className="space-y-2">
                    <p className="font-semibold">Topic: {betDetails.topic}</p>
                    <p>Total Amount: {betDetails.totalAmount} ETH</p>
                    <p>Status: {betDetails.isResolved ? 'Resolved' : 'Active'}</p>
                    {betDetails.isResolved && (
                      <p className="font-semibold">Winning Option: {betDetails.winningOption}</p>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {betDetails.options.map((option, index) => (
                        <div key={index} className="p-2 border rounded">
                          <p className="font-medium">{option}</p>
                          <p className="text-sm">{betDetails.optionBets[index]} ETH</p>
                        </div>
                      ))}
                    </div>

                    {!betDetails.isResolved && (
                      <div className="space-y-2 mt-4">
                        <select
                          className="w-full p-2 border rounded"
                          value={selectedOption}
                          onChange={(e) => setSelectedOption(e.target.value)}
                          disabled={loading}
                        >
                          <option value="">Select Option</option>
                          {betDetails.options.map((option, index) => (
                            <option key={index} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          placeholder="Bet Amount (ETH)"
                          value={betAmount}
                          onChange={(e) => setBetAmount(e.target.value)}
                          disabled={loading}
                        />
                        <Button 
                          onClick={placeBet} 
                          disabled={loading || !selectedOption || !betAmount}
                          className="w-full"
                        >
                          {loading ? 'Processing...' : 'Place Bet'}
                        </Button>
                      </div>
                    )}

                    {isOwner && !betDetails.isResolved && (
                      <div className="space-y-2 mt-4">
                        <select
                          className="w-full p-2 border rounded"
                          onChange={(e) => e.target.value && resolveBet(e.target.value)}
                          disabled={loading}
                        >
                          <option value="">Select Winning Option</option>
                          {betDetails.options.map((option, index) => (
                            <option key={index} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default MultiBetDApp;