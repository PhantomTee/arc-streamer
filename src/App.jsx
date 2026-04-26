import { useState, useEffect } from "react";
import { ethers } from "ethers";

// Replace with the address you got from your Hardhat deployment!
const CONTRACT_ADDRESS = "0xBE1C80D5767076F0500F9e444dE3bEDe47c84eF2";
const ABI = [
  "function availableToWithdraw() public view returns (uint256)",
  "function withdraw() public",
  "function contractor() public view returns (address)"
];

function App() {
  const [balance, setBalance] = useState("0");
  const [account, setAccount] = useState("");

  const connectWallet = async () => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
    }
  };

  const fetchBalance = async () => {
    if (!window.ethereum || !account) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
    const amount = await contract.availableToWithdraw();
    setBalance(ethers.formatEther(amount));
  };

  const handleWithdraw = async () => {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const tx = await contract.withdraw();
    await tx.wait();
    fetchBalance();
  };

  useEffect(() => {
    const interval = setInterval(fetchBalance, 3000); // Update every 3s
    return () => clearInterval(interval);
  }, [account]);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl font-bold mb-8 text-blue-400">Arc Streamer</h1>
      
      {!account ? (
        <button onClick={connectWallet} className="bg-blue-600 px-6 py-3 rounded-lg font-bold">
          Connect MetaMask (Arc Testnet)
        </button>
      ) : (
        <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
          <p className="text-slate-400 mb-2">Connected: {account.slice(0,6)}...{account.slice(-4)}</p>
          <div className="text-5xl font-mono mb-6 text-green-400">{Number(balance).toFixed(6)} <span className="text-lg">USDC</span></div>
          <button onClick={handleWithdraw} className="w-full bg-green-600 hover:bg-green-700 py-4 rounded-xl font-bold transition-all">
            Withdraw Streamed Funds
          </button>
        </div>
      )}
    </div>
  );
}

export default App;