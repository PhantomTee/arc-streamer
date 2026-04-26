import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

// --- PASTE YOUR REMIX ADDRESS HERE ---
const CONTRACT_ADDRESS = "YOUR_NEW_REMIX_ADDRESS"; 

const ABI = [
  "function deposit() public payable",
  "function executePayroll(address[] _recipients, uint256[] _amounts) public",
  "function getBalance() public view returns (uint256)",
  "function totalDisbursed() public view returns (uint256)"
];

const ARC_TESTNET = {
  chainId: '0x4CEB92', // 5042002 in hex
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://arc-testnet.drpc.org'],
  blockExplorerUrls: ['https://explorer.arc.circle.com']
};

function App() {
  const [activeTab, setActiveTab] = useState("treasury");
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0");
  const [disbursed, setDisbursed] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  const fileInputRef = useRef(null);
  
  const [employees, setEmployees] = useState([{ name: "", address: "", amount: "" }]);
  const [invoices, setInvoices] = useState([{ client: "Kava Labs", amount: "5000", status: "Pending", due: "2026-05-01" }]);

  // --- NETWORK ENFORCEMENT & CONNECTION ---
  const forceArcNetwork = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ARC_TESTNET.chainId }],
      });
    } catch (error) {
      if (error.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [ARC_TESTNET],
        });
      }
    }
  };

  const connectWallet = async () => {
    if (window.ethereum) {
      await forceArcNetwork();
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

  // --- CONTRACT ACTIONS ---
  const handleDeposit = async () => {
    if (!depositAmount) return;
    await forceArcNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const tx = await contract.deposit({ value: ethers.parseEther(depositAmount) });
    await tx.wait();
    setDepositAmount("");
    fetchData();
  };

  const handlePayroll = async () => {
    await forceArcNetwork();
    const addresses = employees.map(emp => emp.address);
    const amounts = employees.map(emp => ethers.parseEther(emp.amount || "0"));
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const tx = await contract.executePayroll(addresses, amounts);
    await tx.wait();
    setEmployees([{ name: "", address: "", amount: "" }]);
    fetchData();
  };

  // --- UTILITIES (JSON IMPORT & CSV EXPORT) ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        if (Array.isArray(json)) setEmployees(json);
      } catch (err) {
        alert("Invalid JSON file. Format must be an array of objects: [{name, address, amount}]");
      }
    };
    reader.readAsText(file);
  };

  const exportCSV = () => {
    const headers = "Name,Wallet Address,Amount (USDC)\n";
    const rows = employees.map(e => `${e.name},${e.address},${e.amount}`).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FairPay_Payroll_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const updateEmployee = (index, field, value) => {
    const updated = [...employees];
    updated[index][field] = value;
    setEmployees(updated);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-[#ff5500] selection:text-white pb-20 overflow-x-hidden">
      
      {/* HEADER NAVIGATION */}
      <header className="flex flex-col md:flex-row justify-between items-center p-6 md:p-8 border-b border-zinc-900 gap-4">
        <div className="text-3xl font-black tracking-tighter text-[#ff5500]">FAIRPAY</div>
        <nav className="flex space-x-6 md:space-x-12 text-xs font-bold tracking-widest text-zinc-500">
          <button onClick={() => setActiveTab('treasury')} className={`${activeTab === 'treasury' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white transition'}`}>TREASURY</button>
          <button onClick={() => setActiveTab('payroll')} className={`${activeTab === 'payroll' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white transition'}`}>PAYROLL</button>
          <button onClick={() => setActiveTab('invoices')} className={`${activeTab === 'invoices' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white transition'}`}>INVOICES</button>
        </nav>
        <button onClick={connectWallet} className="text-xs font-mono border border-zinc-800 px-6 py-3 rounded-full hover:border-[#ff5500] transition w-full md:w-auto">
          {account ? `${account.slice(0,6)}...${account.slice(-4)}` : "CONNECT WALLET"}
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-8 mt-12 md:mt-16">
        
        {/* --- TAB: TREASURY --- */}
        {activeTab === 'treasury' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">SHIELDED</h1>
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>TREASURY</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-b border-zinc-900 py-12 mt-12 md:mt-16">
              <div>
                <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Treasury Balance</p>
                <div className="text-4xl md:text-5xl font-bold mb-2 break-words">{Number(balance).toFixed(2)} <span className="text-lg text-zinc-500">USDC</span></div>
              </div>
              <div className="md:border-l md:border-zinc-900 md:pl-8">
                <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Total Disbursed</p>
                <div className="text-4xl md:text-5xl font-bold mb-2 break-words">{Number(disbursed).toFixed(2)} <span className="text-lg text-zinc-500">USDC</span></div>
              </div>
              <div className="md:border-l md:border-zinc-900 md:pl-8 flex flex-col justify-center">
                 <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Network Status</p>
                 <div className="flex items-center space-x-3 text-sm font-bold tracking-widest text-[#ff5500]">
                    <div className="w-2 h-2 bg-[#ff5500] rounded-full animate-pulse"></div>
                    <span>ARC TESTNET L1</span>
                 </div>
              </div>
            </div>

            <div className="mt-16 max-w-xl">
              <h2 className="text-2xl md:text-3xl font-serif italic text-zinc-300 mb-4">Deposit / Fund Treasury</h2>
              <div className="border-b border-zinc-700 pb-2 flex items-end">
                <input type="number" placeholder="0.00" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="bg-transparent text-4xl md:text-5xl font-bold outline-none w-full placeholder-zinc-800" />
              </div>
              <button onClick={handleDeposit} className="mt-8 bg-white text-black text-xs font-bold tracking-widest uppercase px-8 py-4 hover:bg-zinc-200 transition w-full md:w-auto">
                Execute Deposit
              </button>
            </div>
          </div>
        )}

        {/* --- TAB: PAYROLL --- */}
        {activeTab === 'payroll' && (
          <div className="animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
              <div>
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">BATCH</h1>
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>PAYROLL</h1>
              </div>
              <div className="flex space-x-4 w-full md:w-auto">
                <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current.click()} className="border border-zinc-700 text-xs font-bold tracking-widest px-6 py-3 hover:bg-zinc-900 transition flex-1 md:flex-none">
                  IMPORT JSON
                </button>
                <button onClick={exportCSV} className="border border-zinc-700 text-xs font-bold tracking-widest px-6 py-3 hover:bg-zinc-900 transition flex-1 md:flex-none">
                  EXPORT CSV
                </button>
              </div>
            </div>

            <div className="space-y-4 mt-8 overflow-x-auto pb-4">
              <div className="min-w-[600px]">
                {employees.map((emp, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 mb-2">
                    <input placeholder="Name" value={emp.name} onChange={(e) => updateEmployee(index, 'name', e.target.value)} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm outline-none focus:border-[#ff5500]" />
                    <input placeholder="Wallet (0x...)" value={emp.address} onChange={(e) => updateEmployee(index, 'address', e.target.value)} className="col-span-6 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none focus:border-[#ff5500]" />
                    <input placeholder="USDC" type="number" value={emp.amount} onChange={(e) => updateEmployee(index, 'amount', e.target.value)} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none focus:border-[#ff5500]" />
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => setEmployees([...employees, { name: "", address: "", amount: "" }])} className="text-xs font-bold tracking-widest uppercase text-zinc-500 hover:text-white transition mt-4 mb-12 block">
              + Add Row
            </button>

            <div className="border-t border-zinc-900 pt-8">
              <button onClick={handlePayroll} className="bg-[#ff5500] text-white text-xs font-bold tracking-widest uppercase px-8 py-5 hover:bg-[#ff7733] transition w-full md:w-1/3 shadow-[0_0_20px_rgba(255,85,0,0.3)]">
                Execute On-Chain Transfer
              </button>
            </div>
          </div>
        )}

        {/* --- TAB: INVOICES --- */}
        {activeTab === 'invoices' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">PENDING</h1>
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>INVOICES</h1>
            
            <div className="bg-zinc-900/30 border border-zinc-800 p-6 md:p-8 rounded-sm overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="text-xs tracking-widest text-zinc-500 uppercase border-b border-zinc-800">
                    <th className="pb-4">Client</th>
                    <th className="pb-4">Due Date</th>
                    <th className="pb-4">Amount</th>
                    <th className="pb-4">Status</th>
                    <th className="pb-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, idx) => (
                    <tr key={idx} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition">
                      <td className="py-6 font-bold">{inv.client}</td>
                      <td className="py-6 font-mono text-sm text-zinc-400">{inv.due}</td>
                      <td className="py-6 font-mono text-sm text-white">{inv.amount} USDC</td>
                      <td className="py-6">
                        <span className="text-xs font-bold tracking-widest bg-yellow-500/10 text-yellow-500 px-3 py-1 rounded-full">{inv.status}</span>
                      </td>
                      <td className="py-6">
                        <button className="text-xs font-bold uppercase text-[#ff5500] hover:underline">Copy Link</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="mt-8 text-xs font-bold tracking-widest uppercase text-zinc-500 hover:text-white transition">
                + Create New Invoice
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;