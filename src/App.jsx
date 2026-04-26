import { useState, useEffect } from "react";
import { ethers } from "ethers";

// --- PASTE YOUR NEW REMIX ADDRESS HERE ---
const CONTRACT_ADDRESS = "0xeaE7B4cbd64a9427526d6A181de002e5a182bcdd"; 

const ABI = [
  "function deposit() public payable",
  "function executePayroll(address[] _recipients, uint256[] _amounts) public",
  "function getBalance() public view returns (uint256)",
  "function totalDisbursed() public view returns (uint256)"
];

function App() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0");
  const [disbursed, setDisbursed] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  
  // Dynamic state for our payroll list
  const [employees, setEmployees] = useState([
    { name: "", address: "", amount: "" }
  ]);

  const connectWallet = async () => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
    }
  };

  const fetchData = async () => {
    if (!window.ethereum || !account) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
    
    const bal = await contract.getBalance();
    const dis = await contract.totalDisbursed();
    
    setBalance(ethers.formatEther(bal));
    setDisbursed(ethers.formatEther(dis));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [account]);

  // --- CONTRACT INTERACTIONS ---
  const handleDeposit = async () => {
    if (!depositAmount) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    
    const tx = await contract.deposit({ value: ethers.parseEther(depositAmount) });
    await tx.wait();
    setDepositAmount("");
    fetchData();
  };

  const handlePayroll = async () => {
    const addresses = employees.map(emp => emp.address);
    const amounts = employees.map(emp => ethers.parseEther(emp.amount || "0"));
    
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    
    const tx = await contract.executePayroll(addresses, amounts);
    await tx.wait();
    
    // Reset list after successful payroll
    setEmployees([{ name: "", address: "", amount: "" }]);
    fetchData();
  };

  // --- DYNAMIC FORM HANDLERS ---
  const addEmployeeRow = () => {
    setEmployees([...employees, { name: "", address: "", amount: "" }]);
  };

  const updateEmployee = (index, field, value) => {
    const updated = [...employees];
    updated[index][field] = value;
    setEmployees(updated);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-[#ff5500] selection:text-white pb-20">
      {/* HEADER */}
      <header className="flex justify-between items-center p-8 border-b border-zinc-900">
        <div className="text-2xl font-black tracking-tighter">FAIRPAY</div>
        <nav className="hidden md:flex space-x-12 text-xs font-bold tracking-widest text-zinc-500">
          <a href="#" className="text-white">TREASURY</a>
          <a href="#" className="hover:text-white transition">PAYROLL</a>
          <a href="#" className="hover:text-white transition">INVOICES</a>
        </nav>
        <button onClick={connectWallet} className="text-xs font-mono border border-zinc-800 px-4 py-2 rounded-full hover:border-[#ff5500] transition">
          {account ? `${account.slice(0,6)}...${account.slice(-4)}` : "CONNECT WALLET"}
        </button>
      </header>

      {/* HERO SECTION */}
      <main className="max-w-7xl mx-auto px-8 mt-16">
        <h1 className="text-7xl font-black tracking-tighter mb-2">SHIELDED</h1>
        <h1 className="text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>TREASURY</h1>

        {/* STATS ROW */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-b border-zinc-900 py-12 mt-16">
          <div>
            <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Treasury Balance</p>
            <div className="text-5xl font-bold mb-2">{Number(balance).toFixed(2)} <span className="text-xl text-zinc-500">USDC</span></div>
            <p className="text-xs text-zinc-600 font-mono uppercase">Secured on Arc Ledger</p>
          </div>
          <div className="border-l border-zinc-900 pl-8">
            <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Total Disbursed</p>
            <div className="text-5xl font-bold mb-2">{Number(disbursed).toFixed(2)} <span className="text-xl text-zinc-500">USDC</span></div>
            <p className="text-xs text-zinc-600 font-mono uppercase">Historical Payroll</p>
          </div>
          <div className="border-l border-zinc-900 pl-8 flex flex-col justify-center">
             <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">System Status</p>
             <div className="flex items-center space-x-3 text-sm font-bold tracking-widest">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>NETWORK ACTIVE</span>
             </div>
          </div>
        </div>

        {/* ACTION CARDS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 mt-16">
          
          {/* DEPOSIT SECTION */}
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-serif italic text-zinc-300">Deposit / Fund Treasury</h2>
              <div className="text-[#ff5500] text-2xl font-light">↙</div>
            </div>
            <p className="text-xs tracking-widest leading-relaxed text-zinc-500 uppercase max-w-sm">
              Transfer public USDC into the central treasury. These funds will be used for batch payroll execution.
            </p>
            
            <div className="mt-8 border-b border-zinc-700 pb-2 flex items-end">
              <input 
                type="number"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="bg-transparent text-5xl font-bold outline-none w-full placeholder-zinc-800"
              />
            </div>
            
            <button 
              onClick={handleDeposit}
              className="bg-white text-black text-xs font-bold tracking-widest uppercase px-8 py-4 hover:bg-zinc-200 transition"
            >
              Fund Treasury
            </button>
          </div>

          {/* PAYROLL SECTION */}
          <div className="space-y-8 pl-0 lg:pl-16 lg:border-l lg:border-zinc-900">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-serif italic text-zinc-300">Execute / Batch Payroll</h2>
            </div>
            <p className="text-xs tracking-widest leading-relaxed text-zinc-500 uppercase max-w-sm">
              Add employees to the payroll queue. Funds will be dispersed simultaneously in a single transaction.
            </p>

            <div className="space-y-4 mt-8">
              {employees.map((emp, index) => (
                <div key={index} className="grid grid-cols-12 gap-2">
                  <input 
                    placeholder="Name" 
                    value={emp.name}
                    onChange={(e) => updateEmployee(index, 'name', e.target.value)}
                    className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm outline-none focus:border-[#ff5500]"
                  />
                  <input 
                    placeholder="Wallet (0x...)" 
                    value={emp.address}
                    onChange={(e) => updateEmployee(index, 'address', e.target.value)}
                    className="col-span-6 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none focus:border-[#ff5500]"
                  />
                  <input 
                    placeholder="USDC" 
                    type="number"
                    value={emp.amount}
                    onChange={(e) => updateEmployee(index, 'amount', e.target.value)}
                    className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none focus:border-[#ff5500]"
                  />
                </div>
              ))}
            </div>

            <div className="flex space-x-4">
              <button 
                onClick={addEmployeeRow}
                className="text-xs font-bold tracking-widest uppercase text-zinc-500 hover:text-white transition"
              >
                + Add Row
              </button>
            </div>

            <button 
              onClick={handlePayroll}
              className="mt-8 bg-[#ff5500] text-white text-xs font-bold tracking-widest uppercase px-8 py-4 hover:bg-[#ff7733] transition w-full"
            >
              Execute Payroll Batch
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;