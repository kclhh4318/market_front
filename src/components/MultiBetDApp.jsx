//MultiBetDapp.jsx

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import MultiBetExpJson from '../contracts/MultiBetExp.json';
import HYBLOCKTokenJson from '../contracts/HYBLOCKToken.json';

const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS;
const HOLESKY_RPC_URL = process.env.REACT_APP_HOLESKY_RPC_URL;
const TOKEN_ADDRESS = process.env.REACT_APP_TOKEN_ADDRESS;

const CONTRACT_ABI = MultiBetExpJson.abi;
const TOKEN_ABI = HYBLOCKTokenJson.abi;

const MultiBetDApp = () => {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [tokenContract, setTokenContract] = useState(null);
  const [account, setAccount] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [betCount, setBetCount] = useState(0);
  const [currentBetId, setCurrentBetId] = useState(0);
  const [betDetails, setBetDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokenBalance, setTokenBalance] = useState('0');
  const [isApproved, setIsApproved] = useState(false);

  // New bet state
  const [newBetTopic, setNewBetTopic] = useState('');
  const [newBetOptions, setNewBetOptions] = useState('');
  
  // Place bet state
  const [selectedOption, setSelectedOption] = useState('');
  const [betAmount, setBetAmount] = useState('');

  const connectWallet = async () => {
    try {
      if (window.ethereum) {
        // Holesky testnet configuration
        const holeskyChainId = "0x4268";
        const holeskyNetwork = {
          chainId: holeskyChainId,
          chainName: 'Holesky Testnet',
          nativeCurrency: {
            name: 'ETH',
            symbol: 'ETH',
            decimals: 18
          },
          rpcUrls: [HOLESKY_RPC_URL || 'https://holesky-rpc.publicnode.com'],
          blockExplorerUrls: ['https://holesky.etherscan.io']
        };

        try {
          // First try to switch to Holesky if it exists
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: holeskyChainId }],
          });
        } catch (switchError) {
          // If Holesky network doesn't exist, add it
          if (switchError.code === 4902 || switchError.code === -32603) {
            try {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [holeskyNetwork],
              });
            } catch (addError) {
              console.error('Error adding Holesky network:', addError);
              setError('Failed to add Holesky network. Please add it manually in MetaMask.');
              return;
            }
          } else {
            console.error('Error switching to Holesky network:', switchError);
            setError('Failed to switch network. Please switch to Holesky network manually.');
            return;
          }
        }

        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
        
        setProvider(provider);
        setSigner(signer);
        setContract(contract);
        setTokenContract(tokenContract);
        
        const userAddress = await signer.getAddress();
        setAccount(userAddress);
        
        // Check if connected account is owner
        const contractOwner = await contract.owner();
        setIsOwner(contractOwner.toLowerCase() === userAddress.toLowerCase());
        
        // Get current bet count
        const count = await contract.betCount();
        setBetCount(Number(count));

        // Get token balance and allowance
        await updateTokenInfo(tokenContract, userAddress, contract.address);

        // Setup event listeners
        window.ethereum.on('chainChanged', () => window.location.reload());
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

  const updateTokenInfo = async (tokenContract, userAddress, spenderAddress) => {
    const balance = await tokenContract.balanceOf(userAddress);
    const allowance = await tokenContract.allowance(userAddress, spenderAddress);
    setTokenBalance(ethers.utils.formatEther(balance));
    setIsApproved(allowance.gt(0));
  };

  const approveToken = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Double check if already approved
      const currentAllowance = await tokenContract.allowance(account, CONTRACT_ADDRESS);
      if (currentAllowance.gt(0)) {
        setIsApproved(true);
        return;
      }

      // Set approval for maximum possible amount
      const maxAmount = ethers.constants.MaxUint256;
      console.log('Requesting token approval...');
      const tx = await tokenContract.approve(CONTRACT_ADDRESS, maxAmount);
      
      console.log('Waiting for approval transaction...');
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log('Token approval successful');
        setIsApproved(true);
        // Update token info after successful approval
        await updateTokenInfo(tokenContract, account, CONTRACT_ADDRESS);
      } else {
        throw new Error('Token approval transaction failed');
      }
    } catch (err) {
      console.error('Token approval error:', err);
      setError(err.message || 'Failed to approve token usage');
      setIsApproved(false);
    } finally {
      setLoading(false);
    }
  };

  const loadBetDetails = async () => {
    try {
      setLoading(true);
      
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

  const placeBet = async () => {
    try {
      if (!selectedOption || !betAmount) {
        setError('Please select option and enter amount');
        return;
      }
      
      if (!isApproved) {
        setError('Please approve token spending first');
        return;
      }
      
      setLoading(true);
      const tx = await contract.placeBet(
        currentBetId,
        selectedOption,
        ethers.utils.parseEther(betAmount)
      );
      await tx.wait();
      
      await loadBetDetails();
      await updateTokenInfo(tokenContract, account, contract.address);
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
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <div className="text-sm">Connected: {account}</div>
                <div className="text-sm font-semibold">Token Balance: {tokenBalance} HYBLOCK</div>
                <div className="text-sm">
                  Token Approval Status: {isApproved ? (
                    <span className="text-green-600 font-semibold">Approved ✓</span>
                  ) : (
                    <span className="text-red-600 font-semibold">Not Approved</span>
                  )}
                </div>
              </div>
              {!isApproved && (
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <p className="text-sm text-yellow-800 mb-3">
                    Before placing bets, you need to approve the smart contract to use your HYBLOCK tokens.
                    This is a one-time approval.
                  </p>
                  <Button 
                    onClick={approveToken} 
                    disabled={loading}
                    className="w-full bg-yellow-500 hover:bg-yellow-600"
                  >
                    {loading ? 'Approving...' : 'Approve HYBLOCK Token Usage'}
                  </Button>
                </div>
              )}
            </div>
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
