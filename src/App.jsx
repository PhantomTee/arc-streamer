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
  chainId: '0x4ceb92', // MetaMask prefers strict lowercase hex!
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
        }
      }
    }
  };

  const connectWallet = async () => {
    if (window.ethereum && !isAuditMode) {
      try {
        // Step 1: Secure the account connection FIRST
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        setAccount(accounts[0]);

        // Step 2: Enforce the Arc Testnet SECOND
        await forceArcNetwork();
      } catch (err) {
        console.error("Wallet connection failed:", err);
      }
    }
  };

  // Fetch data using a public RPC so Audit Mode works WITHOUT a wallet!
  const fetchData = async () => {
    if (CONTRACT_ADDRESS === "YOUR_NEW_REMIX_ADDRESS") return;
    
    // Use Public Arc RPC for read-only data fetching
    const readOnlyProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, readOnlyProvider);
    
    try {
      // 1. Fetch Balances
      const bal = await contract.getBalance();
      const dis = await contract.totalDisbursed();
      setBalance(ethers.formatEther(bal));
      setDisbursed(ethers.formatEther(dis));

      // 2. Fetch Invoices
      const invs = await contract.getAllInvoices();
      setInvoices(invs.map(inv => ({
        id: inv.id.toString(), client: inv.clientName, amount: ethers.formatEther(inv.amount), isPaid: inv.isPaid
      })));

      // 3. Build Immutable History Ledger
      const depositLogs = await contract.queryFilter(contract.filters.Deposited());
      const payrollLogs = await contract.queryFilter(contract.filters.PayrollExecuted());
      const invPaidLogs = await contract.queryFilter(contract.filters.InvoicePaid());

      let allEvents = [];
      
      depositLogs.forEach(log => allEvents.push({
        type: "DEPOSIT", hash: log.transactionHash, block: log.blockNumber,
        desc: `Treasury Funded by ${log.args[0].slice(0,6)}...`,
        amount: `+${ethers.formatEther(log.args[1])}`
      }));

      payrollLogs.forEach(log => allEvents.push({
        type: "PAYROLL", hash: log.transactionHash, block: log.blockNumber,
        desc: `Batch transfer to ${log.args[0].toString()} employees`,
        amount: `-${ethers.formatEther(log.args[1])}`
      }));

      invPaidLogs.forEach(log => allEvents.push({
        type: "INVOICE PAID", hash: log.transactionHash, block: log.blockNumber,
        desc: `Invoice #${log.args[0].toString()} settled by client`,
        amount: `+${ethers.formatEther(log.args[2])}`
      }));

      // Sort by block number (newest first)
      allEvents.sort((a, b) => b.block - a.block);
      setHistory(allEvents);

    } catch (error) {
      console.error("Fetch error:", error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // 10s refresh
    return () => clearInterval(interval);
  }, []);

  // --- ACTIONS (Disabled in Audit Mode) ---
  const executeTransaction = async (action) => {
    if (isAuditMode) return alert("Audit Mode is Read-Only.");
    await forceArcNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    await action(contract);
    fetchData();
  };

  const handleDeposit = () => executeTransaction(async (c) => {
    const tx = await c.deposit({ value: ethers.parseEther(depositAmount) });
    await tx.wait(); setDepositAmount("");
  });

  const handlePayroll = () => executeTransaction(async (c) => {
    const addresses = employees.map(emp => emp.address);
    const amounts = employees.map(emp => ethers.parseEther(emp.amount || "0"));
    const tx = await c.executePayroll(addresses, amounts);
    await tx.wait(); setEmployees([{ name: "", address: "", amount: "" }]);
  });

  const handleCreateInvoice = () => executeTransaction(async (c) => {
    const tx = await c.createInvoice(newClientName, ethers.parseEther(newInvoiceAmount));
    await tx.wait(); setNewClientName(""); setNewInvoiceAmount("");
  });

  const handlePayInvoice = async (id, amount) => {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const tx = await contract.payInvoice(id, { value: ethers.parseEther(amount) });
    await tx.wait(); fetchData(); alert("Payment Successful!");
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
  // CLIENT CHECKOUT VIEW
  // ==========================================
  if (payInvoiceId !== null && !isAuditMode) {
    const invoiceToPay = invoices.find(inv => inv.id === payInvoiceId);
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6">
        <h1 className="text-4xl font-black text-[#ff5500] mb-8 tracking-widest">FAIRPAY CHECKOUT</h1>
        <div className="bg-zinc-900 border border-zinc-800 p-10 rounded-lg w-full max-w-md shadow-2xl">
          {!account ? (
            <button onClick={connectWallet} className="bg-white text-black font-bold uppercase w-full py-4">Connect Wallet</button>
          ) : !invoiceToPay ? (
            <div className="text-center text-zinc-500 animate-pulse">Locating Invoice...</div>
          ) : (
            <div>
              <div className="flex justify-between text-xs tracking-widest text-zinc-500 uppercase mb-4">
                <span>Invoice #{invoiceToPay.id}</span>
                <span className={invoiceToPay.isPaid ? "text-green-500" : "text-yellow-500"}>{invoiceToPay.isPaid ? "PAID" : "PENDING"}</span>
              </div>
              <h2 className="text-2xl font-serif text-white mb-2">Billed to: {invoiceToPay.client}</h2>
              <div className="text-5xl font-black text-white my-8 border-y border-zinc-800 py-6">{invoiceToPay.amount} <span className="text-xl">USDC</span></div>
              {!invoiceToPay.isPaid && (
                <button onClick={() => handlePayInvoice(invoiceToPay.id, invoiceToPay.amount)} className="bg-[#ff5500] text-white font-bold uppercase w-full py-4 shadow-[0_0_20px_rgba(255,85,0,0.3)]">Pay Now</button>
              )}
            </div>
          )}
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
                  <input type="number" placeholder="0.00" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="bg-transparent text-4xl font-bold outline-none w-full" />
                </div>
                <button onClick={handleDeposit} className="mt-8 bg-white text-black text-xs font-bold uppercase px-8 py-4 w-full md:w-auto">Execute Deposit</button>
              </div>
            )}
          </div>
        )}

        {/* --- TAB: PAYROLL (Hidden in Audit Mode) --- */}
        {activeTab === 'payroll' && !isAuditMode && (
          <div className="animate-in fade-in">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-12 text-transparent" style={{ WebkitTextStroke: '1px #333' }}>BATCH PAYROLL</h1>
            <div className="space-y-4 overflow-x-auto pb-4">
              <div className="min-w-[600px]">
                {employees.map((emp, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 mb-2">
                    <input placeholder="Name" value={emp.name} onChange={(e) => { const n = [...employees]; n[index].name = e.target.value; setEmployees(n); }} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm outline-none" />
                    <input placeholder="Wallet" value={emp.address} onChange={(e) => { const n = [...employees]; n[index].address = e.target.value; setEmployees(n); }} className="col-span-6 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none" />
                    <input placeholder="USDC" type="number" value={emp.amount} onChange={(e) => { const n = [...employees]; n[index].amount = e.target.value; setEmployees(n); }} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none" />
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setEmployees([...employees, { name: "", address: "", amount: "" }])} className="text-xs font-bold uppercase text-zinc-500 mb-12 block">+ Add Row</button>
            <div className="border-t border-zinc-900 pt-8">
              <button onClick={handlePayroll} className="bg-[#ff5500] text-white text-xs font-bold uppercase px-8 py-5 w-full md:w-1/3">Execute Transfer</button>
            </div>
          </div>
        )}

        {/* --- TAB: INVOICES --- */}
        {activeTab === 'invoices' && (
          <div className="animate-in fade-in">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>INVOICES</h1>
            
            {!isAuditMode && (
              <div className="flex gap-4 mb-8 bg-zinc-900/50 p-6 border border-zinc-800 flex-wrap">
                <input type="text" placeholder="Client Name" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none flex-1" />
                <input type="number" placeholder="USDC" value={newInvoiceAmount} onChange={e => setNewInvoiceAmount(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none w-48" />
                <button onClick={handleCreateInvoice} className="bg-white text-black text-xs font-bold uppercase px-8 py-3 hover:bg-zinc-200">Issue</button>
              </div>
            )}

            <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-sm overflow-x-auto">
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
                      {!isAuditMode && <td className="py-6 text-right"><button onClick={() => copyInvoiceLink(inv.id)} className="text-xs font-bold text-[#ff5500]">Copy Link</button></td>}
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
                <div key={i} className="flex justify-between items-center p-6 bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition">
                  <div className="flex gap-6 items-center">
                    <span className={`text-xs font-bold uppercase px-3 py-1 rounded w-28 text-center ${event.type === 'DEPOSIT' || event.type === 'INVOICE PAID' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'}`}>{event.type}</span>
                    <div>
                      <p className="text-sm font-bold text-white">{event.desc}</p>
                      <a href={`https://explorer.arc.circle.com/tx/${event.hash}`} target="_blank" className="text-xs font-mono text-zinc-500 hover:text-[#ff5500] underline mt-1 block">Tx: {event.hash.slice(0,10)}...</a>
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