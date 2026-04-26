import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

// --- PASTE YOUR REMIX ADDRESS HERE ---
const CONTRACT_ADDRESS = "0xC688B3f74D8176a18a720110a1Eb2c7bB9273323"; 

const ABI = [
  "function deposit() public payable",
  "function executePayroll(address[] _recipients, uint256[] _amounts) public",
  "function getBalance() public view returns (uint256)",
  "function totalDisbursed() public view returns (uint256)",
  "function createInvoice(string _clientName, uint256 _amount) public",
  "function payInvoice(uint256 _id) public payable",
  "function getAllInvoices() public view returns (tuple(uint256 id, string clientName, uint256 amount, bool isPaid)[])",
  // Events needed for the History Ledger
  "event Deposited(address indexed sender, uint256 amount)",
  "event PayrollExecuted(uint256 totalRecipients, uint256 totalAmount)",
  "event InvoiceCreated(uint256 id, string clientName, uint256 amount)",
  "event InvoicePaid(uint256 id, address payer, uint256 amount)"
];

const ARC_RPC = 'https://arc-testnet.drpc.org';
const ARC_TESTNET = {
  chainId: '0x4cef52', // MetaMask prefers strict lowercase hex
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPC],
  blockExplorerUrls: ['https://explorer.arc.circle.com']
};

function App() {
  // --- URL ROUTING & MODES ---
  const urlParams = new URLSearchParams(window.location.search);
  const payInvoiceId = urlParams.get('pay');
  const isAuditMode = urlParams.get('audit') === 'true';

  const [activeTab, setActiveTab] = useState(isAuditMode ? "history" : "treasury");
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("0");
  const [disbursed, setDisbursed] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  
  // Loading state to prevent transaction spam
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  
  const fileInputRef = useRef(null);
  const [employees, setEmployees] = useState([{ name: "", address: "", amount: "" }]);
  const [invoices, setInvoices] = useState([]);
  const [history, setHistory] = useState([]);
  const [newClientName, setNewClientName] = useState("");
  const [newInvoiceAmount, setNewInvoiceAmount] = useState("");

  const forceArcNetwork = async () => {
    if (!window.ethereum || isAuditMode) return;
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_TESTNET.chainId }] });
    } catch (error) {
      if (error.code === 4902) {
        try {
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [ARC_TESTNET] });
        } catch (addError) {
          console.error("User rejected adding the network:", addError);
          throw new Error("Please allow Arc Testnet to proceed.");
        }
      } else {
        throw error;
      }
    }
  };

  const connectWallet = async () => {
    if (window.ethereum && !isAuditMode) {
      try {
        setCheckoutError("");
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        setAccount(accounts[0]);
        await forceArcNetwork();
      } catch (err) {
        console.error("Wallet connection failed:", err);
        setCheckoutError("Failed to connect wallet.");
      }
    } else if (!window.ethereum) {
      setCheckoutError("MetaMask is not installed.");
    }
  };

  const fetchData = async () => {
    if (CONTRACT_ADDRESS === "YOUR_NEW_REMIX_ADDRESS") return;
    const readOnlyProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, readOnlyProvider);
    
    try {
      const bal = await contract.getBalance();
      const dis = await contract.totalDisbursed();
      setBalance(ethers.formatEther(bal));
      setDisbursed(ethers.formatEther(dis));

      const invs = await contract.getAllInvoices();
      setInvoices(invs.map(inv => ({
        id: inv.id.toString(), client: inv.clientName, amount: ethers.formatEther(inv.amount), isPaid: inv.isPaid
      })));

      const depositLogs = await contract.queryFilter(contract.filters.Deposited());
      const payrollLogs = await contract.queryFilter(contract.filters.PayrollExecuted());
      const invPaidLogs = await contract.queryFilter(contract.filters.InvoicePaid());

      let allEvents = [];
      depositLogs.forEach(log => allEvents.push({
        type: "DEPOSIT", hash: log.transactionHash, block: log.blockNumber, desc: `Treasury Funded by ${log.args[0].slice(0,6)}...`, amount: `+${ethers.formatEther(log.args[1])}`
      }));
      payrollLogs.forEach(log => allEvents.push({
        type: "PAYROLL", hash: log.transactionHash, block: log.blockNumber, desc: `Batch transfer to ${log.args[0].toString()} employees`, amount: `-${ethers.formatEther(log.args[1])}`
      }));
      invPaidLogs.forEach(log => allEvents.push({
        type: "INVOICE PAID", hash: log.transactionHash, block: log.blockNumber, desc: `Invoice #${log.args[0].toString()} settled by client`, amount: `+${ethers.formatEther(log.args[2])}`
      }));

      allEvents.sort((a, b) => b.block - a.block);
      setHistory(allEvents);
    } catch (error) {
      console.error("Fetch error:", error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); 
    return () => clearInterval(interval);
  }, []);

  // --- SAFE TRANSACTION EXECUTION ---
  const executeTransaction = async (action) => {
    if (isAuditMode) return alert("Audit Mode is Read-Only.");
    setIsLoading(true);
    try {
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      await action(contract);
      fetchData();
    } catch (error) {
      console.error("Transaction failed or rejected:", error);
      alert(error.reason || "Transaction failed. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = () => executeTransaction(async (c) => {
    const tx = await c.deposit({ value: ethers.parseEther(depositAmount) });
    await tx.wait(); 
    setDepositAmount("");
  });

  const handlePayroll = () => executeTransaction(async (c) => {
    const addresses = employees.map(emp => emp.address);
    const amounts = employees.map(emp => ethers.parseEther(emp.amount || "0"));
    const tx = await c.executePayroll(addresses, amounts);
    await tx.wait(); 
    setEmployees([{ name: "", address: "", amount: "" }]);
  });

  const handleCreateInvoice = () => executeTransaction(async (c) => {
    const tx = await c.createInvoice(newClientName, ethers.parseEther(newInvoiceAmount));
    await tx.wait(); 
    setNewClientName(""); 
    setNewInvoiceAmount("");
  });

  const handlePayInvoice = async (id, amount) => {
    setCheckoutError("");
    setIsLoading(true);
    try {
      // CRITICAL FIX: Force network switch BEFORE paying
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      
      const tx = await contract.payInvoice(id, { value: ethers.parseEther(amount) });
      await tx.wait(); 
      fetchData(); // This will trigger the UI to show the "PAID" state
    } catch (error) {
      console.error("Payment failed:", error);
      // Catch specific errors (like insufficient funds or user rejection)
      if (error.code === 'ACTION_REJECTED') {
        setCheckoutError("Transaction was rejected.");
      } else if (error.message.includes("insufficient funds")) {
        setCheckoutError("Insufficient USDC for gas on Arc Testnet.");
      } else {
        setCheckoutError(error.reason || "Transaction failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // --- UTILS ---
  const copyAuditLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/?audit=true`);
    alert("Public Audit Link copied! Anyone can view your treasury securely.");
  };
  
  const copyInvoiceLink = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/?pay=${id}`);
    alert("Payment link copied to clipboard!");
  };

  // ==========================================
  // POLISHED CLIENT CHECKOUT VIEW
  // ==========================================
  if (payInvoiceId !== null && !isAuditMode) {
    const invoiceToPay = invoices.find(inv => inv.id === payInvoiceId);
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 font-sans">
        
        {/* Checkout Card */}
        <div className="bg-[#0a0a0a] border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative">
          
          {/* Card Header */}
          <div className="bg-zinc-900/50 p-8 border-b border-zinc-800 flex justify-between items-center">
            <div>
              <div className="text-[#ff5500] font-black text-2xl tracking-tighter">FAIRPAY</div>
              <div className="text-zinc-500 text-[10px] tracking-widest uppercase mt-1">Secure Checkout</div>
            </div>
            <div className="text-right">
               <div className="text-zinc-500 text-[10px] uppercase tracking-widest">Invoice No.</div>
               <div className="font-mono text-lg text-white">#{invoiceToPay ? invoiceToPay.id : "..."}</div>
            </div>
          </div>

          <div className="p-8">
            {!account ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-6 h-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <p className="text-zinc-400 mb-8 uppercase tracking-widest text-xs">Connect wallet to securely view and pay this invoice</p>
                {checkoutError && <p className="text-red-500 text-xs mb-4">{checkoutError}</p>}
                <button onClick={connectWallet} className="bg-white text-black font-bold uppercase tracking-widest text-xs w-full py-4 rounded-lg hover:bg-zinc-200 transition">Connect Wallet</button>
              </div>
            ) : !invoiceToPay ? (
              <div className="text-center py-12 flex flex-col items-center">
                <div className="w-8 h-8 border-2 border-[#ff5500] border-t-transparent rounded-full animate-spin mb-4"></div>
                <div className="text-zinc-500 tracking-widest uppercase text-xs">Locating Invoice...</div>
              </div>
            ) : (
              <div className="animate-in fade-in">
                
                {/* Billed To Section */}
                <div className="mb-8">
                  <p className="text-zinc-500 uppercase tracking-widest text-[10px] mb-2">Billed To</p>
                  <h2 className="text-2xl font-serif text-white">{invoiceToPay.client}</h2>
                </div>

                {/* Amount Section */}
                <div className="bg-zinc-900/50 rounded-lg p-6 mb-8 border border-zinc-800/50">
                  <div className="flex justify-between items-end mb-4 border-b border-zinc-800 pb-4">
                    <span className="text-zinc-400 text-sm">Invoice Amount</span>
                    <span className="text-2xl font-mono text-white">{invoiceToPay.amount} USDC</span>
                  </div>
                  <div className="flex justify-between items-end mb-4 border-b border-zinc-800 pb-4">
                    <span className="text-zinc-400 text-sm">Network</span>
                    <span className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 bg-[#ff5500] rounded-full"></span> Arc Testnet
                    </span>
                  </div>
                  <div className="flex justify-between items-end mt-4">
                    <span className="text-zinc-300 font-bold">Total Due</span>
                    <span className="text-3xl font-black text-[#ff5500]">{invoiceToPay.amount} <span className="text-lg text-zinc-500">USDC</span></span>
                  </div>
                </div>
                
                {/* Error Display */}
                {checkoutError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs p-4 rounded-lg mb-6 text-center">
                    {checkoutError}
                  </div>
                )}

                {/* Action Button / Success State */}
                {invoiceToPay.isPaid ? (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
                    <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <div className="text-green-500 font-bold uppercase tracking-widest mb-1">Payment Settled</div>
                    <div className="text-green-500/60 text-xs font-mono">Secured on Arc Ledger</div>
                  </div>
                ) : (
                  <button 
                    onClick={() => handlePayInvoice(invoiceToPay.id, invoiceToPay.amount)} 
                    disabled={isLoading}
                    className={`w-full py-4 rounded-lg font-bold uppercase tracking-widest text-sm transition flex justify-center items-center gap-3 ${isLoading ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-[#ff5500] text-white hover:bg-[#ff7733] shadow-[0_0_20px_rgba(255,85,0,0.2)]'}`}
                  >
                    {isLoading && <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin"></div>}
                    {isLoading ? 'Processing Payment...' : 'Pay Invoice Now'}
                  </button>
                )}
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className="bg-zinc-950 p-4 border-t border-zinc-900 text-center flex justify-center items-center gap-2">
            <svg className="w-4 h-4 text-zinc-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Powered by Circle Arc</span>
          </div>

        </div>
      </div>
    );
  }

  // ==========================================
  // MAIN DASHBOARD (Admin & Audit)
  // ==========================================
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-[#ff5500] selection:text-white pb-20 overflow-x-hidden">
      {isAuditMode && (
        <div className="bg-green-500/10 border-b border-green-500/20 text-green-500 text-center py-2 text-xs font-bold tracking-widest uppercase">
          COMMUNITY AUDIT MODE • READ-ONLY VIEW
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-center p-6 md:p-8 border-b border-zinc-900 gap-4">
        <div className="text-3xl font-black tracking-tighter text-[#ff5500]">FAIRPAY</div>
        <nav className="flex space-x-4 md:space-x-8 text-xs font-bold tracking-widest text-zinc-500 overflow-x-auto w-full md:w-auto justify-center">
          <button onClick={() => setActiveTab('treasury')} className={activeTab === 'treasury' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>TREASURY</button>
          {!isAuditMode && <button onClick={() => setActiveTab('payroll')} className={activeTab === 'payroll' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>PAYROLL</button>}
          <button onClick={() => setActiveTab('invoices')} className={activeTab === 'invoices' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>INVOICES</button>
          <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>HISTORY</button>
        </nav>
        
        {!isAuditMode ? (
          <div className="flex gap-4">
            <button onClick={copyAuditLink} className="text-xs font-bold text-zinc-400 hover:text-white transition">COPY AUDIT LINK</button>
            <button onClick={connectWallet} className="text-xs font-mono border border-zinc-800 px-6 py-2 rounded-full hover:border-[#ff5500]">
              {account ? `${account.slice(0,6)}...${account.slice(-4)}` : "CONNECT"}
            </button>
          </div>
        ) : (
          <div className="text-xs font-mono text-zinc-600 border border-zinc-800 px-6 py-2 rounded-full">WALLET DISABLED</div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-8 mt-12 md:mt-16">
        
        {/* --- TAB: TREASURY --- */}
        {activeTab === 'treasury' && (
          <div className="animate-in fade-in">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">SHIELDED</h1>
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>TREASURY</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-b border-zinc-900 py-12 mt-12">
              <div>
                <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Treasury Balance</p>
                <div className="text-5xl font-bold">{Number(balance).toFixed(2)} <span className="text-xl text-zinc-500">USDC</span></div>
              </div>
              <div className="md:border-l md:border-zinc-900 md:pl-8">
                <p className="text-xs tracking-widest text-zinc-500 font-bold mb-4 uppercase">Total Disbursed</p>
                <div className="text-5xl font-bold">{Number(disbursed).toFixed(2)} <span className="text-xl text-zinc-500">USDC</span></div>
              </div>
            </div>

            {!isAuditMode && (
              <div className="mt-16 max-w-xl">
                <h2 className="text-2xl font-serif italic text-zinc-300 mb-4">Fund Treasury</h2>
                <div className="border-b border-zinc-700 pb-2 flex items-end">
                  <input type="number" placeholder="0.00" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} disabled={isLoading} className="bg-transparent text-4xl font-bold outline-none w-full disabled:opacity-50" />
                </div>
                <button 
                  onClick={handleDeposit} 
                  disabled={isLoading}
                  className={`mt-8 text-black text-xs font-bold uppercase px-8 py-4 w-full md:w-auto transition flex justify-center items-center gap-2 ${isLoading ? 'bg-zinc-500 cursor-not-allowed' : 'bg-white hover:bg-zinc-200'}`}
                >
                  {isLoading && <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>}
                  {isLoading ? 'Processing...' : 'Execute Deposit'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- TAB: PAYROLL --- */}
        {activeTab === 'payroll' && !isAuditMode && (
          <div className="animate-in fade-in">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-12 text-transparent" style={{ WebkitTextStroke: '1px #333' }}>BATCH PAYROLL</h1>
            <div className="space-y-4 overflow-x-auto pb-4">
              <div className="min-w-[600px]">
                {employees.map((emp, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 mb-2">
                    <input placeholder="Name" value={emp.name} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].name = e.target.value; setEmployees(n); }} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm outline-none disabled:opacity-50" />
                    <input placeholder="Wallet" value={emp.address} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].address = e.target.value; setEmployees(n); }} className="col-span-6 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none disabled:opacity-50" />
                    <input placeholder="USDC" type="number" value={emp.amount} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].amount = e.target.value; setEmployees(n); }} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none disabled:opacity-50" />
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setEmployees([...employees, { name: "", address: "", amount: "" }])} disabled={isLoading} className="text-xs font-bold uppercase text-zinc-500 mb-12 block hover:text-white disabled:opacity-50">+ Add Row</button>
            <div className="border-t border-zinc-900 pt-8">
              <button 
                onClick={handlePayroll} 
                disabled={isLoading}
                className={`text-white text-xs font-bold uppercase px-8 py-5 w-full md:w-1/3 transition flex justify-center items-center gap-2 ${isLoading ? 'bg-zinc-700 cursor-not-allowed opacity-50' : 'bg-[#ff5500] hover:bg-[#ff7733] shadow-[0_0_20px_rgba(255,85,0,0.3)]'}`}
              >
                {isLoading && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                {isLoading ? 'Processing...' : 'Execute Transfer'}
              </button>
            </div>
          </div>
        )}

        {/* --- TAB: INVOICES --- */}
        {activeTab === 'invoices' && (
          <div className="animate-in fade-in">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>INVOICES</h1>
            
            {!isAuditMode && (
              <div className="flex gap-4 mb-8 bg-zinc-900/50 p-6 border border-zinc-800 flex-wrap rounded-lg">
                <input type="text" placeholder="Client Name" value={newClientName} disabled={isLoading} onChange={e => setNewClientName(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none flex-1 rounded disabled:opacity-50" />
                <input type="number" placeholder="USDC" value={newInvoiceAmount} disabled={isLoading} onChange={e => setNewInvoiceAmount(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none w-48 rounded disabled:opacity-50" />
                <button 
                  onClick={handleCreateInvoice} 
                  disabled={isLoading}
                  className={`text-black text-xs font-bold uppercase px-8 py-3 rounded transition flex items-center justify-center gap-2 ${isLoading ? 'bg-zinc-500 cursor-not-allowed' : 'bg-white hover:bg-zinc-200'}`}
                >
                  {isLoading && <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>}
                  {isLoading ? 'Issuing...' : 'Issue'}
                </button>
              </div>
            )}

            <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-lg overflow-x-auto">
              <table className="w-full text-left min-w-[600px]">
                <thead>
                  <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800"><th className="pb-4">ID</th><th className="pb-4">Client</th><th className="pb-4">Amount</th><th className="pb-4">Status</th>{!isAuditMode && <th className="pb-4 text-right">Action</th>}</tr>
                </thead>
                <tbody>
                  {invoices.map((inv, idx) => (
                    <tr key={idx} className="border-b border-zinc-800/50">
                      <td className="py-6 font-mono text-zinc-500">#{inv.id}</td>
                      <td className="py-6 font-bold">{inv.client}</td>
                      <td className="py-6 font-mono">{inv.amount} USDC</td>
                      <td className="py-6"><span className={`text-xs font-bold px-3 py-1 rounded-full ${inv.isPaid ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>{inv.isPaid ? 'PAID' : 'PENDING'}</span></td>
                      {!isAuditMode && <td className="py-6 text-right">
                        <button onClick={() => copyInvoiceLink(inv.id)} className="text-xs font-bold uppercase tracking-widest text-[#ff5500] hover:text-white transition border border-[#ff5500]/30 hover:border-[#ff5500] px-3 py-1 rounded">Copy Link</button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- TAB: HISTORY (ON-CHAIN LEDGER) --- */}
        {activeTab === 'history' && (
          <div className="animate-in fade-in">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>ON-CHAIN LEDGER</h1>
            <div className="space-y-4">
              {history.length === 0 ? <p className="text-zinc-500 italic">Reading Arc ledger...</p> : history.map((event, i) => (
                <div key={i} className="flex justify-between items-center p-6 bg-zinc-900/40 border border-zinc-800 rounded-lg hover:border-zinc-700 transition">
                  <div className="flex gap-6 items-center">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-md w-28 text-center ${event.type === 'DEPOSIT' || event.type === 'INVOICE PAID' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>{event.type}</span>
                    <div>
                      <p className="text-sm font-bold text-white">{event.desc}</p>
                      <a href={`https://explorer.arc.circle.com/tx/${event.hash}`} target="_blank" className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 hover:text-[#ff5500] mt-1 flex items-center gap-1 transition">
                        View Receipt <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                      </a>
                    </div>
                  </div>
                  <div className={`text-xl font-mono ${event.amount.startsWith('+') ? 'text-green-500' : 'text-white'}`}>{event.amount}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;