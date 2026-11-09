"use client";
import Link from "next/link";
import NetworkStatus from "./network-status";
import { useRouter } from "next/navigation";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Contract,
  ZeroAddress,
  formatEther,
  getAddress,
  isAddress,
  parseEther,
  type InterfaceAbi,
  type TransactionResponse,
} from "ethers";
import { hashDocument } from "../lib/hash";
import {
  TRADE_STATUSES,
  canDispute,
  canReleaseAfterDeadline,
  isEscrowLocked,
  remainingTime,
  readChainTimestamp,
} from "../lib/trade-rules";
import {
  DEMO_WALLETS,
  createLocalProvider,
  createLocalSigner,
  type DemoWalletId,
} from "../lib/local-wallet";

type WalletApproval = {
  title: string;
  description: string;
  amount: bigint;
  signer: DemoWalletId;
  contract: string;
};
type Deployment = {
  networkReady: boolean;
  networkStatus: string;
  schemaVersion: number;
  settlementWorkerActive: boolean;
  address: string;
  chainId: number;
  blockNumber: number;
  blockHash: string;
  abi: InterfaceAbi;
};
type Trade = {
  id: number;
  buyer: string;
  supplier: string;
  description: string;
  quantity: bigint;
  amount: bigint;
  documentHash: string;
  status: number;
  createdAt: number;
  shippedAt: number;
  releaseDeadline: number;
  disputeReason: string;
  proposedResolution: number;
  resolutionProposer: string;
  transactions: { name: string; hash: string }[];
};
type Notice = {
  kind: "pending" | "success" | "error" | "rejected";
  text: string;
  hash?: string;
};
const statuses = TRADE_STATUSES;
const activityLabels: Record<string, string> = {
  TradeCreated: "Trade funded",
  TradeShipped: "Marked shipped",
  TradePaid: "Payment released",
  TradeRefunded: "Buyer refunded",
  DisputeOpened: "Dispute opened",
  ResolutionProposed: "Resolution proposed",
  ResolutionCancelled: "Proposal withdrawn",
  ResolutionAccepted: "Resolution accepted",
};
const short = (value: string) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not connected";
function errorText(error: unknown): string {
  const e = error as {
    code?: string | number;
    reason?: string;
    shortMessage?: string;
    message?: string;
    info?: { error?: { code?: number } };
  };
  if (
    e.code === 4001 ||
    e.code === "ACTION_REJECTED" ||
    e.info?.error?.code === 4001
  )
    return "Transaction cancelled. Nothing was signed or submitted.";
  return (
    e.reason ||
    e.shortMessage ||
    e.message ||
    "Request failed. Check the local node and try again."
  );
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    box: (
      <>
        <path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 9h18m-5 5h5M6 5V3h12" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.box}
    </svg>
  );
}

export default function TradeDashboard({
  role,
  disputeId,
}: {
  role: DemoWalletId;
  disputeId?: number;
}) {
  const router = useRouter();
  const [activeWallet, setActiveWallet] = useState<DemoWalletId | null>(role);
  const account = activeWallet ? DEMO_WALLETS[activeWallet].address : "";
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [approval, setApproval] = useState<WalletApproval | null>(null);
  const approvalResolver = useRef<((approved: boolean) => void) | null>(null);
  const transactionLock = useRef(false);
  const [chain, setChain] = useState<number | null>(null);
  const [network, setNetwork] = useState("Checking local chain…");
  const [readError, setReadError] = useState("");
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoiceHash, setInvoiceHash] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [hashing, setHashing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("All trades");
  const [releaseId, setReleaseId] = useState<number | null>(null);
  const [disputeDraft, setDisputeDraft] = useState<{
    id: number;
    reason: string;
  } | null>(null);
  const [clock, setClock] = useState({ timestamp: 0, observedAt: 0 });
  const [now, setNow] = useState(0);
  const [automationActive, setAutomationActive] = useState(false);
  const chainNow =
    clock.timestamp + Math.floor(Math.max(0, now - clock.observedAt) / 1000);
  const refreshVersion = useRef(0);
  const invoiceVersion = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const rpc = createLocalProvider();
    try {
      const response = await fetch("/api/deployment", { cache: "no-store" });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error);
      const chainId = Number((await rpc.getNetwork()).chainId);
      if (version !== refreshVersion.current) return;
      setChain(chainId);
      if (chainId !== 31337)
        throw new Error(
          "The local node must use chain 31337. Built-in wallets cannot use other networks.",
        );
      const balance = account ? await rpc.getBalance(account) : null;
      const d = config as Deployment;
      if (d.schemaVersion !== 2)
        throw new Error(
          "Updated escrow rules need a new deployment. Run npm.cmd run deploy.",
        );
      if (d.chainId !== 31337)
        throw new Error("Deployment must use the local chain (31337).");
      const block = await rpc.getBlock(d.blockNumber);
      if (
        !block ||
        block.hash !== d.blockHash ||
        (await rpc.getCode(d.address)) === "0x"
      )
        throw new Error(
          "Blockchain was reset. Run npm.cmd run deploy, then refresh.",
        );
      const c = new Contract(d.address, d.abi, rpc);
      const count = Number(await c.tradeCount());
      const timestamp = await readChainTimestamp(rpc);
      const own: Trade[] = [];
      // Straightforward scan is sufficient for a small local demo; no database or indexer.
      if (account) {
        const logs = await rpc.getLogs({
          address: d.address,
          fromBlock: d.blockNumber,
          toBlock: "latest",
        });
        for (let id = count; id >= 1; id--) {
          const t = await c.getTrade(id);
          if (
            ![t.buyer.toLowerCase(), t.supplier.toLowerCase()].includes(
              account.toLowerCase(),
            )
          )
            continue;
          const transactions = logs.flatMap((log) => {
            const event = c.interface.parseLog(log);
            return event && Number(event.args.tradeId) === id
              ? [{ name: event.name, hash: log.transactionHash }]
              : [];
          });
          own.push({
            id,
            buyer: t.buyer,
            supplier: t.supplier,
            description: t.description,
            quantity: t.quantity,
            amount: t.amount,
            documentHash: t.documentHash,
            status: Number(t.status),
            createdAt: Number(t.createdAt),
            shippedAt: Number(t.shippedAt),
            releaseDeadline: Number(t.releaseDeadline),
            disputeReason: t.disputeReason,
            proposedResolution: Number(t.proposedResolution),
            resolutionProposer: t.resolutionProposer,
            transactions,
          });
        }
      }
      if (version !== refreshVersion.current) return;
      setDeployment(d);
      setAutomationActive(d.settlementWorkerActive);
      setClock({ timestamp, observedAt: Date.now() });
      setNow(Date.now());
      setWalletBalance(balance);
      setTrades(own);
      setReadError("");
      setNetwork(d.networkReady ? "TradeLock QBFT · 31337" : d.networkStatus);
    } catch (error) {
      if (version !== refreshVersion.current) return;
      setDeployment(null);
      setWalletBalance(null);
      setTrades([]);
      setNetwork("Local chain unavailable");
      setReadError(errorText(error));
    } finally {
      rpc.destroy();
    }
  }, [account]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      clearInterval(timer);
      ++refreshVersion.current;
    };
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function selectWallet(id: DemoWalletId | null) {
    if (id !== null && id !== role) return;
    if (transactionLock.current) return;
    if (id === activeWallet) return;
    ++refreshVersion.current;
    setActiveWallet(id);
    setTrades([]);
    setWalletBalance(null);
    setReleaseId(null);
    setNotice(null);
    setFilter("All trades");
  }
  function answerApproval(approved: boolean) {
    const resolve = approvalResolver.current;
    approvalResolver.current = null;
    setApproval(null);
    resolve?.(approved);
  }

  const ready = Boolean(account && chain === 31337 && deployment?.networkReady && !busy);
  async function transact(
    action: (contract: Contract) => Promise<TransactionResponse>,
    success: string,
    review: { title: string; description: string; amount: bigint },
  ): Promise<boolean> {
    if (transactionLock.current) return false;
    transactionLock.current = true;
    setBusy(true);
    setNotice(null);
    let hash: string | undefined;
    const provider = createLocalProvider();
    try {
      if (!activeWallet || !deployment?.networkReady)
        throw new Error(
          "Start both node panels and wait for NETWORK READY before submitting a transaction.",
        );
      const approved = await new Promise<boolean>((resolve) => {
        approvalResolver.current = resolve;
        setApproval({
          ...review,
          signer: activeWallet,
          contract: deployment.address,
        });
      });
      if (!approved) {
        setNotice({
          kind: "rejected",
          text: "Transaction cancelled. Nothing was signed or submitted.",
        });
        return false;
      }
      const signer = await createLocalSigner(activeWallet, provider);
      const block = await provider.getBlock(deployment.blockNumber);
      if (!block || block.hash !== deployment.blockHash)
        throw new Error(
          "Blockchain reset detected. Redeploy the contract and refresh.",
        );
      setNotice({
        kind: "pending",
        text: "Signing transaction…",
      });
      const tx = await action(
        new Contract(deployment.address, deployment.abi, signer),
      );
      hash = tx.hash;
      setNotice({
        kind: "pending",
        text: "Transaction submitted. Waiting for blockchain confirmation…",
        hash,
      });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1)
        throw new Error("Transaction failed on-chain.");
      setNotice({ kind: "success", text: success, hash: receipt.hash });
      await refresh();
      return true;
    } catch (error) {
      const text = errorText(error);
      setNotice({
        kind: text.includes("rejected") ? "rejected" : "error",
        text,
        hash,
      });
      await refresh();
      return false;
    } finally {
      provider.destroy();
      transactionLock.current = false;
      setBusy(false);
      setReleaseId(null);
    }
  }
  async function chooseInvoice(file?: File) {
    const version = ++invoiceVersion.current;
    setInvoiceHash("");
    setInvoiceName(file?.name ?? "");
    if (!file) {
      setHashing(false);
      return;
    }
    setHashing(true);
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Choose an invoice smaller than 20 MB.");
      const hash = await hashDocument(file);
      if (version === invoiceVersion.current) setInvoiceHash(hash);
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      if (version === invoiceVersion.current) setHashing(false);
    }
  }
  async function createTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const fields = new FormData(event.currentTarget);
      const supplier = String(fields.get("supplier")).trim();
      const description = String(fields.get("description")).trim();
      const quantityText = String(fields.get("quantity"));
      if (
        !isAddress(supplier) ||
        getAddress(supplier) === ZeroAddress ||
        supplier.toLowerCase() === account.toLowerCase() ||
        supplier.toLowerCase() === deployment?.address.toLowerCase()
      )
        throw new Error(
          "Enter a valid supplier wallet different from the buyer and escrow addresses.",
        );
      if (!description || new TextEncoder().encode(description).length > 280)
        throw new Error("Item description must contain 1–280 UTF-8 bytes.");
      if (!/^[1-9]\d*$/.test(quantityText))
        throw new Error("Quantity must be a positive whole number.");
      const amount = parseEther(String(fields.get("amount")));
      if (amount <= 0n || !invoiceHash)
        throw new Error("Add a positive ETH amount and select an invoice.");
      const ok = await transact(
        (c) =>
          c.createTrade(
            getAddress(supplier),
            description,
            BigInt(quantityText),
            invoiceHash,
            { value: amount },
          ),
        "Trade funded. Your payment is now held in escrow.",
        {
          title: "Create & fund trade",
          description: `Lock ${formatEther(amount)} ETH for ${description}. Supplier: ${getAddress(supplier)}.`,
          amount,
        },
      );
      if (ok) {
        formRef.current?.reset();
        setInvoiceHash("");
        setInvoiceName("");
        setShowCreate(false);
        setFilter("All trades");
      }
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    }
  }

  async function submitDispute(trade: Trade, suppliedReason?: string) {
    const reason = (suppliedReason ?? disputeDraft?.reason ?? "").trim();
    if (!reason || new TextEncoder().encode(reason).length > 280) {
      setNotice({
        kind: "error",
        text: "Enter a dispute reason between 1 and 280 UTF-8 bytes.",
      });
      return;
    }
    const ok = await transact(
      (c) => c.raiseDispute(trade.id, reason),
      "Dispute opened. The scheduled payment is frozen.",
      {
        title: "Open a dispute",
        description: `${reason} Payment will stay locked until both parties agree on a resolution.`,
        amount: 0n,
      },
    );
    if (ok) {
      setDisputeDraft(null);
      router.push(`/disputes/${trade.id}?role=${role}`);
    }
  }

  function proposeResolution(trade: Trade, resolution: number) {
    void transact(
      (c) => c.proposeResolution(trade.id, resolution),
      "Proposal recorded. The other party must approve before funds move.",
      {
        title:
          resolution === 2
            ? "Propose a buyer refund"
            : "Propose supplier payment",
        description: `Propose ${resolution === 2 ? "refunding the buyer" : "paying the supplier"} ${formatEther(trade.amount)} ETH. This proposal alone does not transfer funds.`,
        amount: 0n,
      },
    );
  }

  const visible = trades.filter(
    (t) =>
      (disputeId === undefined || t.id === disputeId) &&
      (role === "buyer"
        ? t.buyer.toLowerCase() === account.toLowerCase()
        : t.supplier.toLowerCase() === account.toLowerCase()),
  );
  const filtered = visible.filter(
    (t) => filter === "All trades" || statuses[t.status] === filter,
  );
  const locked = visible
    .filter((t) => isEscrowLocked(t.status))
    .reduce((sum, t) => sum + t.amount, 0n);
  const paid = visible
    .filter((t) => t.status === 2)
    .reduce((sum, t) => sum + t.amount, 0n);

  return (
    <div className="workspace-shell">
      <div className="workspace-frame">
        <header className="workspace-header">
          <div className="workspace-brand-group">
            <Link
              className="brand entry-brand"
              href="/"
              aria-label="TradeLock home"
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              <span className="brand-icon">
                <Icon name="lock" size={22} />
              </span>
              TradeLock<span className="brand-dot">.</span>
            </Link>
            <span className="workspace-role">
              {role === "buyer" ? "Buyer" : "Supplier"}
            </span>
          </div>
          <div className="top-actions">
            <span className={`network ${deployment?.networkReady ? "online" : ""}`}>
              <span className="dot" />
              {deployment?.networkReady
                ? "Connected"
                : deployment ? "Waiting for nodes"
                : readError
                  ? "Unavailable"
                  : "Connecting…"}
            </span>
            <button
              className="wallet-button"
              disabled={busy}
              onClick={() => setWalletOpen(!walletOpen)}
              aria-expanded={walletOpen}
              aria-controls="built-in-wallet"
            >
              <Icon name="wallet" size={17} />
              {account ? short(account) : "Open wallet"}
            </button>
          </div>
        </header>
        <main className="workspace-main">
          <div className="workspace-toolbar">
            <Link
              href={`/${role}`}
              className="workspace-back"
              aria-disabled={busy}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              {disputeId === undefined
                ? "← Your dashboard"
                : "← Back to your dashboard"}
            </Link>
          </div>
          <div className="heading workspace-heading">
            <div>
              <span className="eyebrow">
                {role === "buyer" ? "BUYER WORKSPACE" : "SUPPLIER WORKSPACE"}
              </span>
              <h1>
                {disputeId !== undefined
                  ? "Trade resolution."
                  : role === "buyer"
                    ? "Your purchases."
                    : "Your orders."}
              </h1>
              <p>
                {disputeId !== undefined
                  ? "Review the issue and agree on what happens next."
                  : role === "buyer"
                    ? "Create a trade. Check your invoice. Pay when it arrives."
                    : "Keep track of your orders, shipments, and payments."}
              </p>
            </div>
            <span className="workspace-heading-icon">
              <Icon name={role === "buyer" ? "lock" : "box"} size={28} />
            </span>
          </div>
          {walletOpen && (
            <section
              className="native-wallet"
              id="built-in-wallet"
              aria-label="Built-in wallet"
            >
              <div className="section-heading">
                <div>
                  <span className="section-kicker">TRADELOCK WALLET</span>
                  <h2>{role === "buyer" ? "Buyer" : "Supplier"} wallet</h2>
                  <p>{network}</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setWalletOpen(false)}
                >
                  Close wallet
                </button>
              </div>
              <div className="native-wallet-options">
                {[role].map((id) => (
                  <button
                    key={id}
                    className={`native-wallet-option ${activeWallet === id ? "chosen" : ""}`}
                    disabled={busy}
                    onClick={() => selectWallet(id)}
                    aria-pressed={activeWallet === id}
                  >
                    <span>
                      <Icon name="wallet" />
                      <strong>{DEMO_WALLETS[id].label}</strong>
                      {activeWallet === id && <Icon name="check" size={16} />}
                    </span>
                    <code>{DEMO_WALLETS[id].address}</code>
                  </button>
                ))}
              </div>
              <div className="wallet-balance">
                <span>Selected wallet balance</span>
                <strong>
                  {walletBalance === null
                    ? "—"
                    : `${formatEther(walletBalance)} ETH`}
                </strong>
                {activeWallet && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => selectWallet(null)}
                  >
                    Disconnect wallet
                  </button>
                )}
              </div>
              <p className="wallet-disclosure">
                These are public development accounts for this private
                chain. Anyone can use their keys. Never send real funds or use
                them as secure accounts.
              </p>
            </section>
          )}
          <NetworkStatus />
          {readError && (
            <div className="notice error" role="alert">
              <strong>Connection needs attention</strong>
              <span>{readError}</span>
              <button className="text-button" onClick={() => void refresh()}>
                Retry connection
              </button>
            </div>
          )}
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role="status"
              aria-live="polite"
            >
              <strong>
                {notice.kind === "pending"
                  ? "Transaction in progress"
                  : notice.kind === "success"
                    ? "Confirmed on-chain"
                    : notice.kind === "rejected"
                      ? "Request rejected"
                      : "Action failed"}
              </strong>
              <span>{notice.text}</span>
              {notice.hash && <code className="hash">{notice.hash}</code>}
              {notice.kind !== "pending" && (
                <button
                  className="dismiss"
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss notification"
                >
                  ×
                </button>
              )}
            </div>
          )}
          {disputeId === undefined && (
            <section className="metrics" aria-label="Trade overview">
              <div className="metric">
                <div>
                  <span>Held in escrow</span>
                  <span className="metric-icon">
                    <Icon name="lock" />
                  </span>
                </div>
                <strong>
                  {formatEther(locked)} <small>ETH</small>
                </strong>
                <p>Awaiting buyer approval</p>
              </div>
              <div className="metric">
                <div>
                  <span>
                    {role === "supplier"
                      ? "Payments received"
                      : "Payments released"}
                  </span>
                  <span className="metric-icon">
                    <Icon name="check" />
                  </span>
                </div>
                <strong>
                  {formatEther(paid)} <small>ETH</small>
                </strong>
                <p>Settled directly to suppliers</p>
              </div>
              <div className="metric">
                <div>
                  <span>Active trades</span>
                  <span className="metric-icon">
                    <Icon name="box" />
                  </span>
                </div>
                <strong>
                  {visible
                    .filter((t) => isEscrowLocked(t.status))
                    .length.toString()
                    .padStart(2, "0")}
                </strong>
                <p>{visible.length} total in this workspace</p>
              </div>
            </section>
          )}
          <section className="trades-section" id="trades">
            <div className="section-heading">
              <div>
                <h2>
                  {disputeId !== undefined
                    ? `Trade TL-${String(disputeId).padStart(4, "0")}`
                    : role === "supplier"
                      ? "Assigned orders"
                      : "Your purchases"}
                  <span className="count">{visible.length}</span>
                </h2>
                <p>
                  {role === "supplier"
                    ? "Manage shipments and follow your payments."
                    : "Follow each trade from funding to final payment."}
                </p>
              </div>
              <div className="table-actions">
                <button
                  className="icon-button"
                  aria-label="Refresh trades"
                  onClick={() => void refresh()}
                  disabled={busy}
                >
                  <Icon name="refresh" size={17} />
                </button>
                {role === "buyer" && disputeId === undefined && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => setShowCreate(!showCreate)}
                  >
                    <Icon name="plus" size={17} />
                    {showCreate ? "Close form" : "New trade"}
                  </button>
                )}
              </div>
            </div>
            {showCreate && role === "buyer" && (
              <form
                className="create-form"
                onSubmit={createTrade}
                ref={formRef}
              >
                <div className="form-title">
                  <Icon name="lock" />
                  <div>
                    <h3>Create & fund a trade</h3>
                    <p>
                      Your invoice stays on your device. Only its fingerprint is
                      registered.
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="wide">
                    Supplier wallet address
                    <input
                      name="supplier"
                      defaultValue={DEMO_WALLETS.supplier.address}
                      placeholder="0x…"
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className="wide">
                    Item description
                    <input
                      name="description"
                      placeholder="e.g. Cotton shirts"
                      maxLength={280}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="20"
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Payment in ETH
                    <input
                      name="amount"
                      inputMode="decimal"
                      placeholder="1.0"
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className="wide upload">
                    Invoice file
                    <input
                      type="file"
                      required
                      disabled={busy}
                      onChange={(e) => void chooseInvoice(e.target.files?.[0])}
                    />
                    <span>
                      {hashing
                        ? "Calculating SHA-256…"
                        : invoiceHash
                          ? `Fingerprint ready · ${invoiceName}`
                          : "Any file type · up to 20 MB · stays on your device"}
                    </span>
                  </label>
                  {invoiceHash && (
                    <code className="hash wide">{invoiceHash}</code>
                  )}
                </div>
                <div className="form-footer">
                  <p>
                    Payment releases 10 hours after shipment unless you open a
                    dispute. Earlier payment requires your confirmation.
                  </p>
                  <button
                    className="primary"
                    type="submit"
                    disabled={!ready || hashing || !invoiceHash}
                  >
                    {busy ? "Processing…" : "Create & fund trade"}
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              </form>
            )}
            <div className="trade-panel">
              {disputeId === undefined && (
                <div className="tabs" role="group" aria-label="Filter trades">
                  {["All trades", ...statuses].map((item) => (
                    <button
                      key={item}
                      className={filter === item ? "selected" : ""}
                      onClick={() => setFilter(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
              {!filtered.length ? (
                <div className="empty">
                  <span className="empty-icon">
                    <Icon name="box" size={30} />
                  </span>
                  <h3>
                    {disputeId !== undefined
                      ? "No trade available for this wallet"
                      : !account
                        ? "Choose a wallet to see your trades"
                        : filter !== "All trades"
                          ? `No ${filter.toLowerCase()} trades`
                          : "A clean slate for your next trade"}
                  </h3>
                  <p>
                    {disputeId !== undefined
                      ? "Check the trade number and open the dispute from the matching dashboard."
                      : !account
                        ? "Your wallet address identifies your purchases and assigned orders."
                        : role === "buyer"
                          ? "Create a trade, attach an invoice, and secure your payment."
                          : "Orders appear here when a buyer funds a trade for your wallet."}
                  </p>
                  {!account && (
                    <button
                      className="secondary"
                      onClick={() => setWalletOpen(true)}
                      disabled={busy}
                    >
                      Choose wallet <Icon name="arrow" size={16} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="trade-list">
                  {filtered.map((t) => (
                    <article
                      className="trade-card"
                      key={`${deployment?.blockHash}-${t.id}`}
                    >
                      <div className="trade-summary">
                        <span className="order-icon">
                          <Icon name="box" />
                        </span>
                        <div className="order-title">
                          <span>TL-{String(t.id).padStart(4, "0")}</span>
                          <h3>{t.description}</h3>
                          <p>
                            {t.quantity.toString()} units ·{" "}
                            {new Date(t.createdAt * 1000).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="trade-amount">
                          {formatEther(t.amount)} <small>ETH</small>
                        </div>
                        <span className={`badge status-${t.status}`}>
                          <span className="dot" />
                          {statuses[t.status]}
                        </span>
                      </div>
                      <details>
                        <summary>
                          Trade details & invoice verification <span>↗</span>
                        </summary>
                        <div className="trade-details">
                          <dl>
                            <div>
                              <dt>Buyer</dt>
                              <dd>{t.buyer}</dd>
                            </div>
                            <div>
                              <dt>Supplier</dt>
                              <dd>{t.supplier}</dd>
                            </div>
                            <div>
                              <dt>Registered SHA-256</dt>
                              <dd>{t.documentHash}</dd>
                            </div>
                            {t.shippedAt > 0 && (
                              <>
                                <div>
                                  <dt>Marked shipped</dt>
                                  <dd>
                                    {new Date(
                                      t.shippedAt * 1000,
                                    ).toLocaleString()}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Release deadline</dt>
                                  <dd>
                                    {new Date(
                                      t.releaseDeadline * 1000,
                                    ).toLocaleString()}
                                  </dd>
                                </div>
                              </>
                            )}
                            {t.disputeReason && (
                              <div>
                                <dt>Buyer’s dispute</dt>
                                <dd>{t.disputeReason}</dd>
                              </div>
                            )}
                          </dl>
                          <InvoiceVerification
                            registeredHash={t.documentHash}
                          />
                          <div className="transaction-history">
                            <strong>On-chain activity</strong>
                            {t.transactions.map((tx) => (
                              <div key={tx.hash}>
                                <span>
                                  {activityLabels[tx.name] ?? tx.name}
                                </span>
                                <code className="hash">{tx.hash}</code>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                      {t.status === 1 && (
                        <div className="shipment-timer">
                          <div>
                            <span className="section-kicker">
                              {canReleaseAfterDeadline(
                                t.status,
                                t.releaseDeadline,
                                chainNow,
                              )
                                ? "PAYMENT ELIGIBLE"
                                : "RECEIPT WINDOW"}
                            </span>
                            <strong>
                              {remainingTime(t.releaseDeadline, chainNow)}
                            </strong>
                          </div>
                          <p>
                            {canReleaseAfterDeadline(
                              t.status,
                              t.releaseDeadline,
                              chainNow,
                            )
                              ? "The 10-hour window ended without a dispute. Payment is eligible for release."
                              : `Confirm receipt or report an issue before ${new Date(t.releaseDeadline * 1000).toLocaleString()}.`}
                            {automationActive
                              ? " Automatic settlement is running."
                              : " Supplier can claim payment after the deadline."}
                          </p>
                        </div>
                      )}
                      {t.status === 1 && role === "supplier" && (
                        <div className="trade-action">
                          <p>
                            Payment goes only to the supplier recorded in this
                            trade.
                          </p>
                          <button
                            className="primary"
                            disabled={
                              !ready ||
                              !canReleaseAfterDeadline(
                                t.status,
                                t.releaseDeadline,
                                chainNow,
                              )
                            }
                            onClick={() =>
                              void transact(
                                (c) => c.claimPayment(t.id),
                                "Overdue payment released to the supplier.",
                                {
                                  title: "Claim overdue payment",
                                  description: `Release ${formatEther(t.amount)} ETH after the undisputed 10-hour receipt window.`,
                                  amount: 0n,
                                },
                              )
                            }
                          >
                            Claim payment
                          </button>
                        </div>
                      )}
                      {t.status === 0 &&
                        t.proposedResolution === 0 &&
                        disputeId === undefined && (
                          <div className="trade-action">
                            <p>
                              Before shipment, cancellation requires agreement
                              from both parties.
                            </p>
                            <button
                              className="secondary"
                              disabled={!ready}
                              onClick={() => proposeResolution(t, 2)}
                            >
                              Request cancellation
                            </button>
                          </div>
                        )}
                      {(t.status === 3 || t.proposedResolution !== 0) &&
                        disputeId === undefined && (
                          <div className="trade-action">
                            <p>
                              {t.status === 3
                                ? "Payment is frozen while this dispute is unresolved."
                                : "A cancellation proposal is waiting for agreement."}
                            </p>
                            <Link
                              className="secondary"
                              href={`/disputes/${t.id}?role=${role}`}
                            >
                              {t.status === 3
                                ? "View dispute"
                                : "Review cancellation"}
                            </Link>
                          </div>
                        )}
                      {disputeId !== undefined &&
                        (t.status === 3 || t.status === 0) && (
                          <section
                            className="resolution-panel"
                            aria-label="Resolution options"
                          >
                            <h3>
                              {t.status === 3
                                ? "Agree on a resolution"
                                : "Agree on cancellation"}
                            </h3>
                            {t.disputeReason && (
                              <p className="dispute-reason">
                                {t.disputeReason}
                              </p>
                            )}
                            <p>
                              Either party can propose an outcome. The other
                              party must approve it. Without agreement, funds
                              stay locked.
                            </p>
                            {t.proposedResolution !== 0 && (
                              <div className="resolution-proposal">
                                <strong>
                                  {t.resolutionProposer.toLowerCase() ===
                                  t.buyer.toLowerCase()
                                    ? "Buyer"
                                    : "Supplier"}{" "}
                                  proposes:{" "}
                                  {t.proposedResolution === 2
                                    ? "refund buyer"
                                    : "pay supplier"}
                                </strong>
                                <span>{formatEther(t.amount)} ETH</span>
                                {t.resolutionProposer.toLowerCase() ===
                                account.toLowerCase() ? (
                                  <button
                                    className="secondary"
                                    disabled={!ready}
                                    onClick={() =>
                                      void transact(
                                        (c) => c.cancelResolution(t.id),
                                        "Proposal withdrawn. Funds remain locked.",
                                        {
                                          title: "Withdraw proposal",
                                          description:
                                            "Remove your current proposal without transferring funds.",
                                          amount: 0n,
                                        },
                                      )
                                    }
                                  >
                                    Withdraw proposal
                                  </button>
                                ) : (
                                  <button
                                    className="primary"
                                    disabled={!ready}
                                    onClick={() =>
                                      void transact(
                                        (c) =>
                                          c.acceptResolution(
                                            t.id,
                                            t.proposedResolution,
                                            t.resolutionProposer,
                                          ),
                                        t.proposedResolution === 2
                                          ? "Refund agreed. The buyer has been refunded."
                                          : "Resolution agreed. The supplier has been paid.",
                                        {
                                          title:
                                            t.proposedResolution === 2
                                              ? "Accept & refund buyer"
                                              : "Accept & pay supplier",
                                          description: `Accept the displayed proposal and ${t.proposedResolution === 2 ? "return" : "release"} ${formatEther(t.amount)} ETH to the ${t.proposedResolution === 2 ? "buyer" : "supplier"}. This transfer is final.`,
                                          amount: 0n,
                                        },
                                      )
                                    }
                                  >
                                    {t.proposedResolution === 2
                                      ? "Accept & refund buyer"
                                      : "Accept & pay supplier"}
                                  </button>
                                )}
                              </div>
                            )}
                            <div className="button-row">
                              {t.status === 3 && (
                                <button
                                  className="secondary"
                                  disabled={!ready}
                                  onClick={() => proposeResolution(t, 1)}
                                >
                                  Propose supplier payment
                                </button>
                              )}
                              <button
                                className="secondary"
                                disabled={!ready}
                                onClick={() => proposeResolution(t, 2)}
                              >
                                Propose buyer refund
                              </button>
                            </div>
                          </section>
                        )}
                      {t.status === 0 && role === "supplier" && (
                        <div className="trade-action">
                          <p>Marking shipped is your claim of shipment.</p>
                          <button
                            className="primary"
                            disabled={!ready}
                            onClick={() =>
                              void transact(
                                (c) => c.markShipped(t.id),
                                `Trade TL-${String(t.id).padStart(4, "0")} marked shipped.`,
                                {
                                  title: "Mark trade shipped",
                                  description: `Declare shipment of trade TL-${String(t.id).padStart(4, "0")}. This starts the buyer’s 10-hour receipt/dispute window. Shipment is your claim, not proof of delivery.`,
                                  amount: 0n,
                                },
                              )
                            }
                          >
                            Mark shipped <Icon name="arrow" size={16} />
                          </button>
                        </div>
                      )}
                      {t.status === 1 && role === "buyer" && (
                        <div className="trade-action">
                          <p>
                            {releaseId === t.id
                              ? `Release ${formatEther(t.amount)} ETH to the supplier? This payment is final.`
                              : "Confirm only after you have received and checked the goods."}
                          </p>
                          {releaseId === t.id ? (
                            <div className="button-row">
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => setReleaseId(null)}
                              >
                                Cancel
                              </button>
                              <button
                                className="primary"
                                disabled={!ready}
                                onClick={() =>
                                  void transact(
                                    (c) => c.confirmReceipt(t.id),
                                    `Receipt confirmed. ${formatEther(t.amount)} ETH released to the supplier.`,
                                    {
                                      title:
                                        "Confirm receipt & release payment",
                                      description: `Release ${formatEther(t.amount)} ETH held in escrow to ${t.supplier}. This payment is final.`,
                                      amount: 0n,
                                    },
                                  )
                                }
                              >
                                Release {formatEther(t.amount)} ETH
                              </button>
                            </div>
                          ) : (
                            <button
                              className="primary"
                              disabled={!ready}
                              onClick={() => setReleaseId(t.id)}
                            >
                              Confirm receipt <Icon name="check" size={16} />
                            </button>
                          )}
                        </div>
                      )}
                      {t.status === 1 && role === "buyer" && (
                        <div className="buyer-issue-actions">
                          <p>
                            {canDispute(t.status, t.releaseDeadline, chainNow)
                              ? "Something wrong? Submit a complaint before the deadline to freeze payment."
                              : "The dispute window has ended. Payment can now be released."}
                          </p>
                          <div className="button-row">
                            <button
                              className="secondary"
                              disabled={
                                !ready ||
                                !canDispute(
                                  t.status,
                                  t.releaseDeadline,
                                  chainNow,
                                )
                              }
                              onClick={() =>
                                void submitDispute(
                                  t,
                                  "Goods have not been received.",
                                )
                              }
                            >
                              Not received
                            </button>
                            <button
                              className="secondary"
                              disabled={
                                !ready ||
                                !canDispute(
                                  t.status,
                                  t.releaseDeadline,
                                  chainNow,
                                )
                              }
                              onClick={() =>
                                setDisputeDraft({ id: t.id, reason: "" })
                              }
                            >
                              Open dispute
                            </button>
                          </div>
                        </div>
                      )}
                      {disputeDraft?.id === t.id && t.status === 1 && (
                        <form
                          className="dispute-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitDispute(t);
                          }}
                        >
                          <label>
                            Dispute reason
                            <textarea
                              value={disputeDraft.reason}
                              maxLength={280}
                              required
                              disabled={busy}
                              onChange={(event) =>
                                setDisputeDraft({
                                  id: t.id,
                                  reason: event.target.value,
                                })
                              }
                              placeholder="Explain what went wrong. This reason is recorded on-chain."
                            />
                          </label>
                          <p>
                            Payment freezes only after this transaction is
                            confirmed. Submit before the receipt deadline.
                          </p>
                          <div className="button-row">
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() => setDisputeDraft(null)}
                            >
                              Cancel
                            </button>
                            <button
                              className="primary"
                              type="submit"
                              disabled={
                                !ready ||
                                !canDispute(
                                  t.status,
                                  t.releaseDeadline,
                                  chainNow,
                                )
                              }
                            >
                              Submit dispute
                            </button>
                          </div>
                        </form>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
          <details className="demo-help">
            <summary>
              <Icon name="file" size={16} />
              Invoice samples & escrow notes <span aria-hidden="true">+</span>
            </summary>
            <div>
              <p>
                Open a trade’s details to verify its invoice. Files stay on your
                device; a hash match confirms unchanged contents, not whether
                the original invoice was truthful.
              </p>
              <div className="sample-links">
                <a href="/invoices/invoice-original.txt" download>
                  Download original invoice ↗
                </a>
                <a href="/invoices/invoice-altered.txt" download>
                  Download altered invoice ↗
                </a>
              </div>
              <p>
                Shipment is the supplier’s claim. The buyer has 10 hours to
                confirm receipt or report a dispute. Silence allows payment
                release; a timely dispute freezes it. Refunds and disputed
                payments require both parties to agree. There is no independent
                delivery verification or administrator.
              </p>
            </div>
          </details>
          <footer className="workspace-footer">
            <span>© {new Date().getFullYear()} TradeLock</span>
          </footer>
        </main>
      </div>
      {approval && (
        <div className="wallet-backdrop">
          <section
            className="wallet-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                answerApproval(false);
              }
              if (event.key === "Tab") {
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  );
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <span className="section-kicker">
              TRADELOCK WALLET · REVIEW TRANSACTION
            </span>
            <h2 id="approval-title">{approval.title}</h2>
            <p>{approval.description}</p>
            <dl>
              <div>
                <dt>Signing wallet</dt>
                <dd>
                  {DEMO_WALLETS[approval.signer].label}
                  <br />
                  {DEMO_WALLETS[approval.signer].address}
                </dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>{approval.contract}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>TradeLock QBFT · 31337</dd>
              </div>
              <div>
                <dt>Wallet payment</dt>
                <dd>{formatEther(approval.amount)} ETH + network gas</dd>
              </div>
            </dl>
            <p className="wallet-disclosure">
              Network fees are paid separately. This wallet uses public
              development keys and must never hold real funds.
            </p>
            <div className="button-row">
              <button
                className="secondary"
                autoFocus
                onClick={() => answerApproval(false)}
              >
                Cancel transaction
              </button>
              <button className="primary" onClick={() => answerApproval(true)}>
                Sign & submit
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function InvoiceVerification({ registeredHash }: { registeredHash: string }) {
  const [result, setResult] = useState<{
    hash?: string;
    match?: boolean;
    text: string;
  } | null>(null);
  const version = useRef(0);
  async function verify(file?: File) {
    const current = ++version.current;
    if (!file) {
      setResult(null);
      return;
    }
    setResult({ text: "Calculating SHA-256…" });
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Choose a file smaller than 20 MB.");
      const hash = await hashDocument(file);
      const match = hash.toLowerCase() === registeredHash.toLowerCase();
      if (version.current === current)
        setResult({
          hash,
          match,
          text: match ? "Matches registered document" : "Does not match.",
        });
    } catch (error) {
      if (version.current === current) setResult({ text: errorText(error) });
    }
  }
  return (
    <div className="verification">
      <label>
        Verify an invoice
        <input
          type="file"
          onChange={(event) => void verify(event.target.files?.[0])}
        />
      </label>
      {result && (
        <div
          className={`verification-result ${result.match === true ? "match" : result.match === false ? "mismatch" : ""}`}
          role="status"
        >
          <strong>{result.text}</strong>
          {result.hash && <code className="hash">{result.hash}</code>}
        </div>
      )}
    </div>
  );
}
