import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

// --- PASTE YOUR NEW FACTORY ADDRESS HERE ---
const FACTORY_ADDRESS = "0x247c11079972B4e9abc0ce1308B399c0b7ba3aaA"; 

const FACTORY_ABI = [
  "function createTreasury() public",
  "function companyToTreasury(address) public view returns (address)"
];

const TREASURY_ABI = [
  "function deposit() public payable",
  "function executePayroll(address[] _recipients, uint256[] _amounts) public",
  "function getBalance() public view returns (uint256)",
  "function totalDisbursed() public view returns (uint256)",
  "function createInvoice(string _clientName, uint256 _amount) public",
  "function payInvoice(uint256 _id) public payable",
  "function getAllInvoices() public view returns (tuple(uint256 id, string clientName, uint256 amount, bool isPaid)[])",
  "event Deposited(address indexed sender, uint256 amount)",
  "event PayrollExecuted(uint256 totalRecipients, uint256 totalAmount)",
  "event InvoiceCreated(uint256 id, string clientName, uint256 amount)",
  "event InvoicePaid(uint256 id, address payer, uint256 amount)"
];

const ARC_RPC = 'https://arc-testnet.drpc.org';
const ARC_TESTNET = {
  chainId: '0x4cef52',
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPC],
  // UPDATED: New ArcScan Explorer URL
  blockExplorerUrls: ['https://testnet.arcscan.app']
};

function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const payInvoiceId = urlParams.get('pay');
  const targetTreasury = urlParams.get('t');
  const isAuditMode = urlParams.get('audit') === 'true';

  const [appEntered, setAppEntered] = useState(false);
  const [activeTab, setActiveTab] = useState(isAuditMode ? "history" : "treasury");
  const [account, setAccount] = useState("");
  const [userTreasury, setUserTreasury] = useState(null); 
  const [isInitializing, setIsInitializing] = useState(false);
  
  const [balance, setBalance] = useState("0");
  const [disbursed, setDisbursed] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  
  const fileInputRef = useRef(null);
  const [employees, setEmployees] = useState([{ name: "", address: "", amount: "" }]);
  const [invoices, setInvoices] = useState([]);
  const [history, setHistory] = useState([]);
  const [newClientName, setNewClientName] = useState("");
  const [newInvoiceAmount, setNewInvoiceAmount] = useState("");

  const forceArcNetwork = async () => {
    if (!window.ethereum) return;
    try {
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (currentChainId.toLowerCase() !== ARC_TESTNET.chainId.toLowerCase()) {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_TESTNET.chainId }] });
      }
    } catch (error) {
      if (error.code === 4902) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [ARC_TESTNET] });
      } else {
        throw error;
      }
    }
  };

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        setCheckoutError("");
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        setAccount(accounts[0]);
        await forceArcNetwork();
        
        if (!targetTreasury) {
          checkTreasury(accounts[0]);
        }
      } catch (err) {
        console.error("Wallet connection failed:", err);
        setCheckoutError("Connection failed.");
      }
    }
  };

  const disconnectWallet = () => {
    setAccount("");
    setUserTreasury(null);
    setBalance("0");
    setDisbursed("0");
    setInvoices([]);
    setHistory([]);
  };

  const launchApp = async () => {
    setAppEntered(true);
    await connectWallet();
  };

  const checkTreasury = async (userAddress) => {
    if (FACTORY_ADDRESS === "YOUR_NEW_FACTORY_ADDRESS") return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const treasuryAddr = await factory.companyToTreasury(userAddress);
    
    if (treasuryAddr !== "0x0000000000000000000000000000000000000000") {
      setUserTreasury(treasuryAddr);
    }
  };

  const createCompanyTreasury = async () => {
    setIsInitializing(true);
    try {
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      
      const tx = await factory.createTreasury();
      await tx.wait();
      await checkTreasury(account);
    } catch (err) {
      console.error(err);
      alert("Failed to initialize. Ensure your wallet has Arc Testnet USDC for gas!");
    } finally {
      setIsInitializing(false);
    }
  };

  const activeContractAddress = targetTreasury || userTreasury;

  const fetchData = async () => {
    if (!activeContractAddress) return;
    const readOnlyProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const contract = new ethers.Contract(activeContractAddress, TREASURY_ABI, readOnlyProvider);
    
    // Fetch Balances and Invoices
    try {
      const bal = await contract.getBalance();
      const dis = await contract.totalDisbursed();
      setBalance(ethers.formatEther(bal));
      setDisbursed(ethers.formatEther(dis));

      const invs = await contract.getAllInvoices();
      setInvoices(invs.map(inv => ({
        id: inv.id.toString(), client: inv.clientName, amount: ethers.formatEther(inv.amount), isPaid: inv.isPaid
      })));
    } catch (error) {
      console.error("State fetch error:", error);
    }

    // Fetch Logs
    try {
      const depositLogs = await contract.queryFilter("Deposited");
      const payrollLogs = await contract.queryFilter("PayrollExecuted");
      const invPaidLogs = await contract.queryFilter("InvoicePaid");

      let allEvents = [];
      depositLogs.forEach(log => allEvents.push({ type: "DEPOSIT", hash: log.transactionHash, block: log.blockNumber, desc: `Treasury Funded by ${log.args[0].slice(0,6)}...`, amount: `+${ethers.formatEther(log.args[1])}` }));
      payrollLogs.forEach(log => allEvents.push({ type: "PAYROLL", hash: log.transactionHash, block: log.blockNumber, desc: `Batch transfer to ${log.args[0].toString()} recipients`, amount: `-${ethers.formatEther(log.args[1])}` }));
      invPaidLogs.forEach(log => allEvents.push({ type: "INVOICE PAID", hash: log.transactionHash, block: log.blockNumber, desc: `Invoice #${log.args[0].toString()} settled by client`, amount: `+${ethers.formatEther(log.args[2])}` }));

      allEvents.sort((a, b) => b.block - a.block);
      setHistory(allEvents);
    } catch (error) {
      console.error("Ledger fetch error (RPC might be rate limited):", error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); 
    return () => clearInterval(interval);
  }, [activeContractAddress]);

  const executeTransaction = async (action) => {
    setIsLoading(true);
    try {
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(activeContractAddress, TREASURY_ABI, signer);
      await action(contract);
      fetchData();
    } catch (error) {
      console.error("Transaction failed:", error);
      alert(error.reason || "Transaction failed. Ensure you have USDC for gas.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = () => executeTransaction(async (c) => {
    const tx = await c.deposit({ value: ethers.parseEther(depositAmount) });
    await tx.wait(); setDepositAmount("");
  });

  const handlePayroll = () => executeTransaction(async (c) => {
    const validEmployees = employees.filter(emp => emp.name && emp.address && emp.amount);
    const addresses = validEmployees.map(emp => emp.address);
    const amounts = validEmployees.map(emp => ethers.parseEther(emp.amount.toString()));
    
    const tx = await c.executePayroll(addresses, amounts);
    await tx.wait(); setEmployees([{ name: "", address: "", amount: "" }]);
  });

  const handleCreateInvoice = () => executeTransaction(async (c) => {
    const tx = await c.createInvoice(newClientName, ethers.parseEther(newInvoiceAmount.toString()));
    await tx.wait(); setNewClientName(""); setNewInvoiceAmount("");
  });

  const handlePayInvoice = async (id, amount) => {
    setCheckoutError("");
    setIsLoading(true);
    try {
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(activeContractAddress, TREASURY_ABI, signer);
      const tx = await contract.payInvoice(id, { value: ethers.parseEther(amount.toString()) });
      await tx.wait(); 
      fetchData(); 
    } catch (error) {
      if (error.code === 'ACTION_REJECTED') setCheckoutError("Transaction was rejected.");
      else if (error.message && error.message.includes("insufficient funds")) setCheckoutError("Insufficient USDC for gas on Arc Testnet.");
      else setCheckoutError(error.reason || "Transaction failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        if (Array.isArray(json)) setEmployees(json);
      } catch (err) { alert("Invalid JSON file. Ensure it is an array of objects."); }
    };
    reader.readAsText(file);
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const exportCSV = () => {
    const validEmployees = employees.filter(emp => emp.name || emp.address || emp.amount);
    const rows = validEmployees.map(e => `${e.name},${e.address},${e.amount}`).join("\n");
    const blob = new Blob(["Name,Wallet Address,Amount (USDC)\n" + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `FairPay_Payroll.csv`; a.click();
  };

  const copyAuditLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/?audit=true&t=${userTreasury}`);
    alert("Public Audit Link copied! It is locked specifically to your company treasury.");
  };
  
  const copyInvoiceLink = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/?pay=${id}&t=${userTreasury}`);
    alert("Payment link copied! Funds will route specifically to your treasury.");
  };

  const isDepositValid = depositAmount && Number(depositAmount) > 0;
  const isInvoiceValid = newClientName.trim() !== "" && newInvoiceAmount && Number(newInvoiceAmount) > 0;
  const validEmployeeCount = employees.filter(emp => emp.name.trim() !== "" && emp.address.trim() !== "" && emp.amount && Number(emp.amount) > 0).length;
  const isPayrollValid = validEmployeeCount > 0;

  // ==========================================
  // VIEW 0: THE EPIC LANDING PAGE
  // ==========================================
  if (!appEntered && payInvoiceId === null && !isAuditMode) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#ff5500]/5 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="mb-6 flex items-center justify-center gap-3 text-[#ff5500] font-bold tracking-[0.3em] uppercase text-xs">
            <span className="w-2 h-2 bg-[#ff5500] rounded-full animate-pulse"></span>
            Live on Arc Testnet L1
          </div>
          <h1 className="text-7xl md:text-[9rem] font-black tracking-tighter leading-none mb-6 text-transparent" style={{ WebkitTextStroke: '2px #ffffff', color: 'transparent' }}>
            FAIRPAY
          </h1>
          <p className="max-w-xl text-zinc-400 text-sm md:text-base tracking-widest uppercase leading-relaxed mb-12">
            Institutional-grade batch payroll and invoice settlement.<br/>
            Deploy an isolated treasury contract and automate your Web3 operations natively with USDC.
          </p>
          <button onClick={launchApp} className="bg-[#ff5500] text-white font-black tracking-widest uppercase px-12 py-5 rounded-sm hover:bg-white hover:text-black transition-all duration-300 shadow-[0_0_40px_rgba(255,85,0,0.3)] hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]">
            Launch Platform
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 1: CLIENT CHECKOUT
  // ==========================================
  if (payInvoiceId !== null && targetTreasury) {
    const invoiceToPay = invoices.find(inv => inv.id === payInvoiceId);
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="bg-[#0a0a0a] border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative">
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
                <button onClick={connectWallet} className="bg-white text-black font-bold uppercase tracking-widest text-xs w-full py-4 rounded-lg hover:bg-zinc-200 transition">Connect Wallet</button>
              </div>
            ) : !invoiceToPay ? (
              <div className="text-center py-12 flex flex-col items-center">
                <div className="w-8 h-8 border-2 border-[#ff5500] border-t-transparent rounded-full animate-spin mb-4"></div>
                <div className="text-zinc-500 tracking-widest uppercase text-xs">Locating Invoice...</div>
              </div>
            ) : (
              <div className="animate-in fade-in">
                <div className="mb-8">
                  <p className="text-zinc-500 uppercase tracking-widest text-[10px] mb-2">Billed To</p>
                  <h2 className="text-2xl font-serif text-white">{invoiceToPay.client}</h2>
                </div>
                <div className="bg-zinc-900/50 rounded-lg p-6 mb-8 border border-zinc-800/50">
                  <div className="flex justify-between items-end mt-4">
                    <span className="text-zinc-300 font-bold">Total Due</span>
                    <span className="text-3xl font-black text-[#ff5500]">{invoiceToPay.amount} <span className="text-lg text-zinc-500">USDC</span></span>
                  </div>
                </div>
                {checkoutError && <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs p-4 rounded-lg mb-6 text-center">{checkoutError}</div>}
                {invoiceToPay.isPaid ? (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center text-green-500 font-bold uppercase">Payment Settled</div>
                ) : (
                  <button onClick={() => handlePayInvoice(invoiceToPay.id, invoiceToPay.amount)} disabled={isLoading} className={`w-full py-4 rounded-lg font-bold uppercase tracking-widest text-sm transition flex justify-center items-center gap-3 ${isLoading ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-[#ff5500] text-white hover:bg-[#ff7733]'}`}>
                    {isLoading ? 'Processing...' : 'Pay Invoice Now'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: MULTI-TENANT ONBOARDING
  // ==========================================
  if (!isAuditMode && account && !userTreasury && !targetTreasury) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-xl text-center">
          <h1 className="text-5xl font-black tracking-tighter mb-4">INITIALIZE YOUR <span className="text-[#ff5500]">TREASURY</span></h1>
          <p className="text-zinc-400 mb-12">FairPay is a decentralized SaaS. Initialize your dedicated, isolated smart contract on the Arc Testnet to start managing payroll and invoices securely.</p>
          <button 
            onClick={createCompanyTreasury} 
            disabled={isInitializing}
            className={`text-white text-xs font-bold uppercase px-8 py-5 w-full md:w-auto transition flex justify-center items-center mx-auto gap-3 ${isInitializing ? 'bg-zinc-700 cursor-not-allowed' : 'bg-[#ff5500] hover:bg-[#ff7733] shadow-[0_0_30px_rgba(255,85,0,0.4)]'}`}
          >
            {isInitializing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
            {isInitializing ? 'Deploying Smart Contract...' : 'Deploy Company Treasury'}
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 3: MAIN DASHBOARD (Requires Treasury)
  // ==========================================
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-[#ff5500] selection:text-white pb-20 overflow-x-hidden">
      {isAuditMode && <div className="bg-green-500/10 border-b border-green-500/20 text-green-500 text-center py-2 text-xs font-bold uppercase">COMMUNITY AUDIT MODE • READ-ONLY</div>}

      <header className="flex flex-col md:flex-row justify-between items-center p-6 md:p-8 border-b border-zinc-900 gap-4">
        <div className="text-3xl font-black tracking-tighter text-[#ff5500]">FAIRPAY</div>
        {activeContractAddress && (
          <nav className="flex space-x-4 md:space-x-8 text-xs font-bold tracking-widest text-zinc-500 overflow-x-auto justify-center">
            <button onClick={() => setActiveTab('treasury')} className={activeTab === 'treasury' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>TREASURY</button>
            {!isAuditMode && <button onClick={() => setActiveTab('payroll')} className={activeTab === 'payroll' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>PAYROLL</button>}
            <button onClick={() => setActiveTab('invoices')} className={activeTab === 'invoices' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>INVOICES</button>
            <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>HISTORY</button>
          </nav>
        )}
        
        {!isAuditMode ? (
          <div className="flex gap-4 items-center">
            {activeContractAddress && <button onClick={copyAuditLink} className="text-[10px] font-bold text-zinc-400 hover:text-white transition uppercase tracking-widest hidden md:block">Copy Audit Link</button>}
            <button 
              onClick={account ? disconnectWallet : connectWallet} 
              className="text-xs font-bold uppercase tracking-widest border border-zinc-700 bg-zinc-950 px-6 py-3 rounded-sm hover:bg-zinc-800 transition text-zinc-300"
            >
              {account ? `Disconnect (${account.slice(0,4)}...${account.slice(-4)})` : "Connect Wallet"}
            </button>
          </div>
        ) : (
          <div className="text-xs font-bold uppercase tracking-widest text-zinc-600 border border-zinc-800 bg-zinc-950 px-6 py-3 rounded-sm">WALLET DISABLED</div>
        )}
      </header>

      {(!activeContractAddress && !isAuditMode) ? (
        <div className="flex flex-col items-center justify-center mt-32 text-zinc-500">
          <p className="text-sm font-mono uppercase tracking-widest">Connect Wallet to Load Your Treasury Dashboard</p>
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-6 md:px-8 mt-12 md:mt-16">
          
          {/* --- TAB: TREASURY --- */}
          {activeTab === 'treasury' && (
            <div className="animate-in fade-in">
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">SHIELDED</h1>
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>TREASURY</h1>
              <div className="text-xs font-mono text-zinc-500 mt-4 bg-zinc-900/50 inline-block px-4 py-2 border border-zinc-800 rounded-sm">Contract: {activeContractAddress}</div>
              
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
                    disabled={isLoading || !isDepositValid} 
                    className={`mt-8 text-black text-xs font-bold uppercase px-8 py-4 w-full md:w-auto transition flex justify-center items-center gap-2 rounded-sm ${isLoading || !isDepositValid ? 'bg-zinc-500 cursor-not-allowed opacity-50' : 'bg-white hover:bg-zinc-200'}`}
                  >
                    {isLoading ? 'Processing...' : 'Execute Deposit'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- TAB: PAYROLL --- */}
          {activeTab === 'payroll' && !isAuditMode && (
            <div className="animate-in fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
                <div>
                  <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">BATCH</h1>
                  <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>PAYROLL</h1>
                </div>
                <div className="flex space-x-4 w-full md:w-auto">
                  <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                  <button onClick={() => fileInputRef.current.click()} disabled={isLoading} className="border border-zinc-700 text-xs font-bold tracking-widest px-6 py-3 hover:bg-zinc-900 transition flex-1 md:flex-none rounded-sm disabled:opacity-50">
                    IMPORT JSON
                  </button>
                  <button onClick={exportCSV} disabled={isLoading} className="border border-zinc-700 text-xs font-bold tracking-widest px-6 py-3 hover:bg-zinc-900 transition flex-1 md:flex-none rounded-sm disabled:opacity-50">
                    EXPORT CSV
                  </button>
                </div>
              </div>

              <div className="space-y-4 overflow-x-auto pb-4">
                <div className="min-w-[600px]">
                  {employees.map((emp, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 mb-2">
                      <input placeholder="Name" value={emp.name} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].name = e.target.value; setEmployees(n); }} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm outline-none rounded-sm disabled:opacity-50" />
                      <input placeholder="Wallet (0x...)" value={emp.address} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].address = e.target.value; setEmployees(n); }} className="col-span-6 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none rounded-sm disabled:opacity-50" />
                      <input placeholder="USDC" type="number" value={emp.amount} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].amount = e.target.value; setEmployees(n); }} className="col-span-3 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none rounded-sm disabled:opacity-50" />
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => setEmployees([...employees, { name: "", address: "", amount: "" }])} disabled={isLoading} className="text-xs font-bold uppercase text-zinc-500 mb-12 block hover:text-white disabled:opacity-50">+ Add Row</button>
              <div className="border-t border-zinc-900 pt-8">
                <button 
                  onClick={handlePayroll} 
                  disabled={isLoading || !isPayrollValid} 
                  className={`text-white text-xs font-bold uppercase px-8 py-5 rounded-sm w-full md:w-1/3 transition flex justify-center items-center gap-2 ${isLoading || !isPayrollValid ? 'bg-zinc-700 cursor-not-allowed opacity-50' : 'bg-[#ff5500] hover:bg-[#ff7733] shadow-[0_0_20px_rgba(255,85,0,0.3)]'}`}
                >
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
                <div className="flex gap-4 mb-8 bg-zinc-900/50 p-6 border border-zinc-800 flex-wrap rounded-sm">
                  <input type="text" placeholder="Client Name" value={newClientName} disabled={isLoading} onChange={e => setNewClientName(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none flex-1 rounded-sm disabled:opacity-50" />
                  <input type="number" placeholder="USDC" value={newInvoiceAmount} disabled={isLoading} onChange={e => setNewInvoiceAmount(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none w-48 rounded-sm disabled:opacity-50" />
                  <button 
                    onClick={handleCreateInvoice} 
                    disabled={isLoading || !isInvoiceValid} 
                    className={`text-black text-xs font-bold uppercase px-8 py-3 rounded-sm transition flex items-center justify-center gap-2 ${isLoading || !isInvoiceValid ? 'bg-zinc-500 cursor-not-allowed opacity-50' : 'bg-white hover:bg-zinc-200'}`}
                  >
                    Issue
                  </button>
                </div>
              )}
              <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-sm overflow-x-auto">
                <table className="w-full text-left min-w-[600px]">
                  <thead>
                    <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800"><th className="pb-4">ID</th><th className="pb-4">Client</th><th className="pb-4">Amount</th><th className="pb-4">Status</th>{!isAuditMode && <th className="pb-4 text-right">Action</th>}</tr>
                  </thead>
                  <tbody>
                    {invoices.length === 0 ? (
                       <tr><td colSpan="5" className="py-6 text-center text-zinc-600 italic">No invoices issued on-chain yet.</td></tr>
                    ) : invoices.map((inv, idx) => (
                      <tr key={idx} className="border-b border-zinc-800/50">
                        <td className="py-6 font-mono text-zinc-500">#{inv.id}</td>
                        <td className="py-6 font-bold">{inv.client}</td>
                        <td className="py-6 font-mono">{inv.amount} USDC</td>
                        <td className="py-6"><span className={`text-xs font-bold px-3 py-1 rounded-full ${inv.isPaid ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>{inv.isPaid ? 'PAID' : 'PENDING'}</span></td>
                        {!isAuditMode && <td className="py-6 text-right"><button onClick={() => copyInvoiceLink(inv.id)} className="text-[10px] font-bold uppercase tracking-widest text-[#ff5500] hover:text-white transition border border-[#ff5500]/30 hover:border-[#ff5500] px-3 py-1 rounded-sm">Copy Link</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- TAB: HISTORY --- */}
          {activeTab === 'history' && (
            <div className="animate-in fade-in">
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>ON-CHAIN LEDGER</h1>
              <div className="space-y-4">
                {history.length === 0 ? <p className="text-zinc-500 italic">Reading Arc ledger (If no events appear, your treasury has no past transactions yet).</p> : history.map((event, i) => (
                  <div key={i} className="flex justify-between items-center p-6 bg-zinc-900/40 border border-zinc-800 rounded-sm hover:border-zinc-700 transition">
                    <div className="flex gap-6 items-center">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-sm w-28 text-center ${event.type === 'DEPOSIT' || event.type === 'INVOICE PAID' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>{event.type}</span>
                      <div>
                        <p className="text-sm font-bold text-white">{event.desc}</p>
                        {/* UPDATED: Points to ArcScan Explorer! */}
                        <a href={`https://testnet.arcscan.app/tx/${event.hash}`} target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 hover:text-[#ff5500] mt-1 flex items-center gap-1 transition">View Receipt</a>
                      </div>
                    </div>
                    <div className={`text-xl font-mono ${event.amount.startsWith('+') ? 'text-green-500' : 'text-white'}`}>{event.amount}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;