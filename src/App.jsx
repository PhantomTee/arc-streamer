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

// --- OPTIMIZATION: Official RPC & Safe Lookback Limit ---
const ARC_RPC = 'https://rpc.testnet.arc.network';
const LOOKBACK_BLOCKS = 8000;

const ARC_TESTNET = {
  chainId: '0x4cef52',
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPC],
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
  
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  
  const fileInputRef = useRef(null);
  
  // --- OPTIMIZATION: Provider Reuse ---
  const readOnlyProvider = useRef(new ethers.JsonRpcProvider(ARC_RPC)).current;

  const [employees, setEmployees] = useState([{ name: "", address: "", amount: "" }]);
  const [invoices, setInvoices] = useState([]);
  const [history, setHistory] = useState([]);
  const [newClientName, setNewClientName] = useState("");
  const [newInvoiceAmount, setNewInvoiceAmount] = useState("");

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

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
        showToast("Wallet Connected Successfully");
      } catch (err) {
        console.error("Wallet connection failed:", err);
        setCheckoutError("Connection failed.");
        showToast("Failed to connect wallet", "error");
      }
    } else {
      showToast("MetaMask is not installed", "error");
    }
  };

  const disconnectWallet = () => {
    setAccount("");
    setUserTreasury(null);
    setBalance("0");
    setDisbursed("0");
    setInvoices([]);
    setHistory([]);
    showToast("Wallet Disconnected", "error");
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
      showToast("Deploying Contract... Please wait.", "info");
      await tx.wait();
      await checkTreasury(account);
      showToast("Treasury Initialized!");
    } catch (err) {
      console.error(err);
      showToast("Failed to initialize. Need Arc USDC for gas.", "error");
    } finally {
      setIsInitializing(false);
    }
  };

  const activeContractAddress = targetTreasury || userTreasury;

  const fetchData = async () => {
    if (!activeContractAddress) return;
    
    const contract = new ethers.Contract(activeContractAddress, TREASURY_ABI, readOnlyProvider);
    
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

    // --- OPTIMIZATION: Parallel Ledger Fetching & Safe Lookback ---
    try {
      const currentBlock = await readOnlyProvider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - LOOKBACK_BLOCKS);

      const [depositLogs, payrollLogs, invPaidLogs] = await Promise.all([
        contract.queryFilter(contract.filters.Deposited(), fromBlock, "latest"),
        contract.queryFilter(contract.filters.PayrollExecuted(), fromBlock, "latest"),
        contract.queryFilter(contract.filters.InvoicePaid(), fromBlock, "latest")
      ]);

      let allEvents = [];
      depositLogs.forEach(log => {
        allEvents.push({ type: "DEPOSIT", hash: log.transactionHash, block: log.blockNumber, desc: `Treasury Funded by ${log.args[0].slice(0,6)}...`, amount: `+${ethers.formatEther(log.args[1])}` });
      });
      payrollLogs.forEach(log => {
        allEvents.push({ type: "PAYROLL", hash: log.transactionHash, block: log.blockNumber, desc: `Batch transfer to ${log.args[0].toString()} recipients`, amount: `-${ethers.formatEther(log.args[1])}` });
      });
      invPaidLogs.forEach(log => {
        allEvents.push({ type: "INVOICE PAID", hash: log.transactionHash, block: log.blockNumber, desc: `Invoice #${log.args[0].toString()} settled by client`, amount: `+${ethers.formatEther(log.args[2])}` });
      });

      allEvents.sort((a, b) => b.block - a.block);
      setHistory(allEvents);
    } catch (error) {
      console.error("Ledger fetch error:", error);
      showToast("Could not load full history. Showing cached events.", "error");
    }
  };

  useEffect(() => {
    fetchData();
    // --- OPTIMIZATION: 15-second polling ---
    const interval = setInterval(fetchData, 15000); 
    return () => clearInterval(interval);
  }, [activeContractAddress]);

  const executeTransaction = async (action, successMsg) => {
    setIsLoading(true);
    try {
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(activeContractAddress, TREASURY_ABI, signer);
      
      showToast("Transaction Pending...", "info");
      await action(contract);
      
      fetchData();
      showToast(successMsg);
    } catch (error) {
      console.error("Transaction failed:", error);
      showToast(error.reason || "Transaction failed.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = () => executeTransaction(async (c) => {
    const tx = await c.deposit({ value: ethers.parseEther(depositAmount) });
    await tx.wait(); 
    setDepositAmount("");
  }, "Treasury Funded Successfully!");

  const handlePayroll = () => executeTransaction(async (c) => {
    const addresses = employees.map(emp => emp.address);
    const amounts = employees.map(emp => ethers.parseEther(emp.amount.toString()));
    const tx = await c.executePayroll(addresses, amounts);
    await tx.wait(); 
    setEmployees([{ name: "", address: "", amount: "" }]);
  }, "Batch Payroll Executed on Arc L1!");

  const handleCreateInvoice = () => executeTransaction(async (c) => {
    const tx = await c.createInvoice(newClientName, ethers.parseEther(newInvoiceAmount.toString()));
    await tx.wait(); 
    setNewClientName(""); 
    setNewInvoiceAmount("");
  }, "Invoice Created On-Chain!");

  const handlePayInvoice = async (id, amount) => {
    setCheckoutError("");
    setIsLoading(true);
    try {
      await forceArcNetwork();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(activeContractAddress, TREASURY_ABI, signer);
      
      showToast("Processing Payment...", "info");
      const tx = await contract.payInvoice(id, { value: ethers.parseEther(amount.toString()) });
      await tx.wait(); 
      fetchData(); 
      showToast("Payment Settled Successfully!");
    } catch (error) {
      if (error.code === 'ACTION_REJECTED') {
        setCheckoutError("Transaction was rejected.");
        showToast("Transaction Rejected", "error");
      } else if (error.message && error.message.includes("insufficient funds")) {
        setCheckoutError("Insufficient USDC for gas on Arc Testnet.");
        showToast("Insufficient Gas", "error");
      } else {
        setCheckoutError(error.reason || "Transaction failed.");
        showToast("Payment Failed", "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const addRow = () => setEmployees([...employees, { name: "", address: "", amount: "" }]);
  
  const removeRow = (index) => {
    if (employees.length === 1) {
      setEmployees([{ name: "", address: "", amount: "" }]); 
    } else {
      setEmployees(employees.filter((_, i) => i !== index));
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        if (Array.isArray(json)) {
          setEmployees(json);
          showToast("JSON Imported Successfully!");
        }
      } catch (err) { 
        showToast("Invalid JSON Format", "error"); 
      }
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
    showToast("CSV Exported!");
  };

  const copyAuditLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/?audit=true&t=${userTreasury}`);
    showToast("Public Audit Link Copied!");
  };
  
  const copyInvoiceLink = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/?pay=${id}&t=${userTreasury}`);
    showToast("Payment Link Copied!");
  };

  const isDepositValid = depositAmount && Number(depositAmount) > 0;
  const isInvoiceValid = newClientName.trim() !== "" && newInvoiceAmount && Number(newInvoiceAmount) > 0;
  const isPayrollValid = employees.length > 0 && employees.every(emp => 
    emp.name.trim() !== "" && ethers.isAddress(emp.address.trim()) && emp.amount && Number(emp.amount) > 0
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-[#ff5500] selection:text-white pb-20 overflow-x-hidden relative">
      
      {/* --- TOAST NOTIFICATION --- */}
      <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${toast.show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-6 py-3 rounded-md shadow-2xl border text-sm font-bold tracking-widest uppercase ${
          toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-500' : 
          toast.type === 'info' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 
          'bg-green-500/10 border-green-500/30 text-green-500'
        }`}>
          {toast.type === 'error' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>}
          {toast.type === 'info' && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>}
          {toast.type === 'success' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
          {toast.message}
        </div>
      </div>

      {/* --- VIEW 0: LANDING PAGE --- */}
      {(!appEntered && payInvoiceId === null && !isAuditMode) && (
        <div className="absolute inset-0 z-40 bg-[#050505] flex flex-col items-center justify-center p-6 font-sans overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#ff5500]/5 rounded-full blur-[120px] pointer-events-none"></div>
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="mb-6 flex items-center justify-center gap-3 text-[#ff5500] font-bold tracking-[0.3em] uppercase text-xs">
              <span className="w-2 h-2 bg-[#ff5500] rounded-full animate-pulse"></span> Live on Arc Testnet L1
            </div>
            <h1 className="text-7xl md:text-[9rem] font-black tracking-tighter leading-none mb-6 text-transparent" style={{ WebkitTextStroke: '2px #ffffff', color: 'transparent' }}>FAIRPAY</h1>
            <p className="max-w-xl text-zinc-400 text-sm md:text-base tracking-widest uppercase leading-relaxed mb-12">
              Institutional-grade batch payroll and invoice settlement.<br/>Deploy an isolated treasury contract and automate your Web3 operations natively with USDC.
            </p>
            <button onClick={launchApp} className="bg-[#ff5500] text-white font-black tracking-widest uppercase px-12 py-5 rounded-sm hover:bg-white hover:text-black transition-all duration-300 shadow-[0_0_40px_rgba(255,85,0,0.3)] hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]">
              Launch Platform
            </button>
          </div>
        </div>
      )}

      {/* --- VIEW 1: SECURE CHECKOUT --- */}
      {(payInvoiceId !== null && targetTreasury) && (
        <div className="absolute inset-0 z-40 bg-[#050505] flex flex-col items-center justify-center p-6">
          <div className="bg-[#0a0a0a] border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative">
            <div className="bg-zinc-900/50 p-8 border-b border-zinc-800 flex justify-between items-center">
              <div>
                <div className="text-[#ff5500] font-black text-2xl tracking-tighter">FAIRPAY</div>
                <div className="text-zinc-500 text-[10px] tracking-widest uppercase mt-1">Secure Checkout</div>
              </div>
              <div className="text-right">
                 <div className="text-zinc-500 text-[10px] uppercase tracking-widest">Invoice No.</div>
                 <div className="font-mono text-lg text-white">#{invoices.find(i => i.id === payInvoiceId)?.id || "..."}</div>
              </div>
            </div>
            <div className="p-8">
              {!account ? (
                <div className="text-center py-8">
                  <button onClick={connectWallet} className="bg-white text-black font-bold uppercase tracking-widest text-xs w-full py-4 rounded-lg hover:bg-zinc-200 transition">Connect Wallet</button>
                </div>
              ) : !invoices.find(i => i.id === payInvoiceId) ? (
                <div className="text-center py-12 flex flex-col items-center">
                  <div className="w-8 h-8 border-2 border-[#ff5500] border-t-transparent rounded-full animate-spin mb-4"></div>
                  <div className="text-zinc-500 tracking-widest uppercase text-xs">Locating Invoice...</div>
                </div>
              ) : (
                <div className="animate-in fade-in">
                  <div className="mb-8">
                    <p className="text-zinc-500 uppercase tracking-widest text-[10px] mb-2">Billed To</p>
                    <h2 className="text-2xl font-serif text-white">{invoices.find(i => i.id === payInvoiceId).client}</h2>
                  </div>
                  <div className="bg-zinc-900/50 rounded-lg p-6 mb-8 border border-zinc-800/50">
                    <div className="flex justify-between items-end mt-4">
                      <span className="text-zinc-300 font-bold">Total Due</span>
                      <span className="text-3xl font-black text-[#ff5500]">{invoices.find(i => i.id === payInvoiceId).amount} <span className="text-lg text-zinc-500">USDC</span></span>
                    </div>
                  </div>
                  {invoices.find(i => i.id === payInvoiceId).isPaid ? (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center text-green-500 font-bold uppercase tracking-widest">Payment Settled</div>
                  ) : (
                    <button onClick={() => handlePayInvoice(invoices.find(i => i.id === payInvoiceId).id, invoices.find(i => i.id === payInvoiceId).amount)} disabled={isLoading} className={`w-full py-4 rounded-lg font-bold uppercase tracking-widest text-sm transition flex justify-center items-center gap-3 ${isLoading ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-[#ff5500] text-white hover:bg-[#ff7733]'}`}>
                      {isLoading ? 'Processing...' : 'Pay Invoice Now'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- VIEW 2: MULTI-TENANT ONBOARDING --- */}
      {(!isAuditMode && account && !userTreasury && !targetTreasury && appEntered && payInvoiceId === null) && (
        <div className="absolute inset-0 z-30 bg-[#050505] flex flex-col items-center justify-center p-6 text-center">
          <h1 className="text-5xl font-black tracking-tighter mb-4">INITIALIZE YOUR <span className="text-[#ff5500]">TREASURY</span></h1>
          <p className="max-w-xl text-zinc-400 mb-12 leading-relaxed">FairPay is a decentralized SaaS. Initialize your dedicated, isolated smart contract on the Arc Testnet to start managing payroll and invoices securely.</p>
          <button onClick={createCompanyTreasury} disabled={isInitializing} className={`text-white text-xs font-bold uppercase px-8 py-5 rounded-sm transition flex justify-center items-center gap-3 ${isInitializing ? 'bg-zinc-700 cursor-not-allowed' : 'bg-[#ff5500] hover:bg-[#ff7733] shadow-[0_0_30px_rgba(255,85,0,0.4)]'}`}>
            {isInitializing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
            {isInitializing ? 'Deploying Smart Contract...' : 'Deploy Company Treasury'}
          </button>
        </div>
      )}

      {/* --- VIEW 3: MAIN APP DASHBOARD --- */}
      {(activeContractAddress || isAuditMode) && (
        <>
          {isAuditMode && <div className="bg-green-500/10 border-b border-green-500/20 text-green-500 text-center py-2 text-xs font-bold uppercase tracking-widest">COMMUNITY AUDIT MODE • READ-ONLY</div>}

          <header className="flex flex-col md:flex-row justify-between items-center p-6 md:p-8 border-b border-zinc-900 gap-4 relative z-10">
            <div className="text-3xl font-black tracking-tighter text-[#ff5500]">FAIRPAY</div>
            <nav className="flex space-x-4 md:space-x-8 text-xs font-bold tracking-widest text-zinc-500 overflow-x-auto justify-center">
              <button onClick={() => setActiveTab('treasury')} className={activeTab === 'treasury' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>TREASURY</button>
              {!isAuditMode && <button onClick={() => setActiveTab('payroll')} className={activeTab === 'payroll' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>PAYROLL</button>}
              <button onClick={() => setActiveTab('invoices')} className={activeTab === 'invoices' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>INVOICES</button>
              <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-white border-b-2 border-[#ff5500] pb-1' : 'hover:text-white'}>HISTORY</button>
            </nav>
            
            {!isAuditMode ? (
              <div className="flex gap-4 items-center">
                <button onClick={copyAuditLink} className="text-[10px] font-bold text-zinc-400 hover:text-white transition uppercase tracking-widest hidden md:block">Copy Audit Link</button>
                <button onClick={account ? disconnectWallet : connectWallet} className="text-xs font-bold uppercase tracking-widest border border-zinc-700 bg-zinc-950 px-6 py-3 rounded-sm hover:bg-zinc-800 transition text-zinc-300">
                  {account ? `Disconnect (${account.slice(0,4)}...${account.slice(-4)})` : "Connect Wallet"}
                </button>
              </div>
            ) : (
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-600 border border-zinc-800 bg-zinc-950 px-6 py-3 rounded-sm">WALLET DISABLED</div>
            )}
          </header>

          <main className="max-w-7xl mx-auto px-6 md:px-8 mt-12 md:mt-16 relative z-10">
            
            {/* TAB: TREASURY */}
            {activeTab === 'treasury' && (
              <div className="animate-in fade-in">
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">SHIELDED</h1>
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>TREASURY</h1>
                <div className="text-[10px] font-mono text-zinc-500 mt-4 bg-zinc-900/50 inline-block px-4 py-2 border border-zinc-800 rounded-sm">Contract: {activeContractAddress}</div>
                
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
                    <button onClick={handleDeposit} disabled={isLoading || !isDepositValid} className={`mt-8 text-black text-xs font-bold uppercase px-8 py-4 w-full md:w-auto transition flex justify-center items-center gap-2 rounded-sm ${isLoading || !isDepositValid ? 'bg-zinc-500 cursor-not-allowed opacity-50' : 'bg-white hover:bg-zinc-200'}`}>
                      {isLoading ? 'Processing...' : 'Execute Deposit'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: PAYROLL */}
            {activeTab === 'payroll' && !isAuditMode && (
              <div className="animate-in fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
                  <div>
                    <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2">BATCH</h1>
                    <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent" style={{ WebkitTextStroke: '1px #333' }}>PAYROLL</h1>
                  </div>
                  <div className="flex space-x-4 w-full md:w-auto">
                    <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                    <button onClick={() => fileInputRef.current.click()} disabled={isLoading} className="border border-zinc-700 text-xs font-bold tracking-widest px-6 py-3 hover:bg-zinc-900 transition flex-1 md:flex-none rounded-sm disabled:opacity-50">IMPORT JSON</button>
                    <button onClick={exportCSV} disabled={isLoading} className="border border-zinc-700 text-xs font-bold tracking-widest px-6 py-3 hover:bg-zinc-900 transition flex-1 md:flex-none rounded-sm disabled:opacity-50">EXPORT CSV</button>
                  </div>
                </div>

                <div className="space-y-3 overflow-x-auto pb-4">
                  <div className="min-w-[600px]">
                    {employees.map((emp, index) => {
                      const isAddrValid = emp.address.trim() === "" || ethers.isAddress(emp.address.trim());
                      return (
                        <div key={index} className="flex gap-2 items-center group">
                          <input placeholder="Name" value={emp.name} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].name = e.target.value; setEmployees(n); }} className="flex-1 bg-zinc-900/50 border border-zinc-800 p-3 text-sm outline-none rounded-sm focus:border-zinc-500 transition disabled:opacity-50" />
                          <input placeholder="Wallet (0x...)" value={emp.address} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].address = e.target.value; setEmployees(n); }} className={`flex-[2] bg-zinc-900/50 border ${isAddrValid ? 'border-zinc-800 focus:border-zinc-500' : 'border-red-500 focus:border-red-500'} p-3 text-sm font-mono outline-none rounded-sm transition disabled:opacity-50`} />
                          <input placeholder="USDC" type="number" value={emp.amount} disabled={isLoading} onChange={(e) => { const n = [...employees]; n[index].amount = e.target.value; setEmployees(n); }} className="flex-1 bg-zinc-900/50 border border-zinc-800 p-3 text-sm font-mono outline-none rounded-sm focus:border-zinc-500 transition disabled:opacity-50" />
                          <button onClick={() => removeRow(index)} disabled={isLoading} className="p-3 text-zinc-600 hover:text-red-500 transition disabled:opacity-50" title="Remove Row">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <button onClick={addRow} disabled={isLoading} className="text-xs font-bold uppercase text-zinc-500 mt-4 mb-12 block hover:text-white transition disabled:opacity-50">+ Add Employee Row</button>
                
                <div className="border-t border-zinc-900 pt-8 flex items-center gap-6">
                  <button onClick={handlePayroll} disabled={isLoading || !isPayrollValid} className={`text-white text-xs font-bold uppercase px-8 py-5 rounded-sm md:w-1/3 transition flex justify-center items-center gap-2 ${isLoading || !isPayrollValid ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-[#ff5500] hover:bg-[#ff7733] shadow-[0_0_20px_rgba(255,85,0,0.3)]'}`}>
                    {isLoading ? 'Processing...' : 'Execute Transfer'}
                  </button>
                  {!isPayrollValid && employees.length > 0 && <span className="text-xs text-zinc-600 uppercase tracking-widest font-bold">Fill all fields with valid EVM addresses to execute.</span>}
                </div>
              </div>
            )}

            {/* TAB: INVOICES */}
            {activeTab === 'invoices' && (
              <div className="animate-in fade-in">
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>INVOICES</h1>
                {!isAuditMode && (
                  <div className="flex gap-4 mb-8 bg-zinc-900/50 p-6 border border-zinc-800 flex-wrap rounded-sm">
                    <input type="text" placeholder="Client Name" value={newClientName} disabled={isLoading} onChange={e => setNewClientName(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none flex-1 rounded-sm disabled:opacity-50" />
                    <input type="number" placeholder="USDC" value={newInvoiceAmount} disabled={isLoading} onChange={e => setNewInvoiceAmount(e.target.value)} className="bg-zinc-950 border border-zinc-800 p-3 outline-none w-48 rounded-sm disabled:opacity-50" />
                    <button onClick={handleCreateInvoice} disabled={isLoading || !isInvoiceValid} className={`text-black text-xs font-bold uppercase px-8 py-3 rounded-sm transition flex items-center justify-center gap-2 ${isLoading || !isInvoiceValid ? 'bg-zinc-500 cursor-not-allowed opacity-50' : 'bg-white hover:bg-zinc-200'}`}>Issue</button>
                  </div>
                )}
                <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-sm overflow-x-auto">
                  <table className="w-full text-left min-w-[600px]">
                    <thead>
                      <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800"><th className="pb-4">ID</th><th className="pb-4">Client</th><th className="pb-4">Amount</th><th className="pb-4">Status</th>{!isAuditMode && <th className="pb-4 text-right">Action</th>}</tr>
                    </thead>
                    <tbody>
                      {invoices.length === 0 ? (
                         <tr><td colSpan="5" className="py-6 text-center text-zinc-600 italic text-sm">No invoices issued on-chain yet.</td></tr>
                      ) : invoices.map((inv, idx) => (
                        <tr key={idx} className="border-b border-zinc-800/50">
                          <td className="py-6 font-mono text-zinc-500">#{inv.id}</td>
                          <td className="py-6 font-bold">{inv.client}</td>
                          <td className="py-6 font-mono">{inv.amount} USDC</td>
                          <td className="py-6"><span className={`text-[10px] tracking-widest uppercase font-bold px-3 py-1 rounded-sm ${inv.isPaid ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'}`}>{inv.isPaid ? 'PAID' : 'PENDING'}</span></td>
                          {!isAuditMode && <td className="py-6 text-right"><button onClick={() => copyInvoiceLink(inv.id)} className="text-[10px] font-bold uppercase tracking-widest text-[#ff5500] hover:text-white transition border border-[#ff5500]/30 hover:border-[#ff5500] px-3 py-2 rounded-sm">Copy Link</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB: HISTORY */}
            {activeTab === 'history' && (
              <div className="animate-in fade-in">
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent mb-12" style={{ WebkitTextStroke: '1px #333' }}>ON-CHAIN LEDGER</h1>
                <div className="space-y-4">
                  {history.length === 0 ? (
                    <p className="text-zinc-500 italic text-sm">
                      No on-chain events found in the last {LOOKBACK_BLOCKS} blocks.<br/>
                      Make a deposit, execute payroll, or process an invoice to see history.
                    </p>
                  ) : history.map((event, i) => (
                    <div key={i} className="flex justify-between items-center p-6 bg-zinc-900/40 border border-zinc-800 rounded-sm hover:border-zinc-700 transition">
                      <div className="flex gap-6 items-center">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-sm w-32 text-center ${event.type === 'DEPOSIT' || event.type === 'INVOICE PAID' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>{event.type}</span>
                        <div>
                          <p className="text-sm font-bold text-white">{event.desc}</p>
                          <a href={`https://testnet.arcscan.app/tx/${event.hash}`} target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 hover:text-[#ff5500] mt-1 flex items-center gap-1 transition">
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
        </>
      )}
    </div>
  );
}

export default App;