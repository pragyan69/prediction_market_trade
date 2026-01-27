import { ethers } from "ethers";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import type { ApiKeyCreds, TickSize } from "@polymarket/clob-client";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet
const SIGNATURE_TYPE = 0; // 0=EOA, 1=POLY_PROXY, 2=GNOSIS_SAFE

// ✅ Polymarket / CTF addresses (Polygon mainnet)
const ADDRESSES = {
  // USDC.e collateral (Polygon)
  USDCe: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",

  // Conditional Tokens Framework (ERC1155)
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",

  // Exchanges / operators
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",

  // ✅ Missing in your code earlier: Neg Risk Adapter
  // (Required on many multi-outcome / neg-risk markets)
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
} as const;

// Minimal ABIs
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const CTF_ERC1155_ABI = [
  "function isApprovedForAll(address owner,address operator) view returns (bool)",
  "function setApprovalForAll(address operator,bool approved)",
];

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const logEl = $("log") as HTMLPreElement;
const statusEl = $("status") as HTMLDivElement;

const btnConnect = $("btnConnect") as HTMLButtonElement;
const btnDerive = $("btnDerive") as HTMLButtonElement;
const btnVerify = $("btnVerify") as HTMLButtonElement;
const btnPlace = $("btnPlace") as HTMLButtonElement;
const btnClearCreds = $("btnClearCreds") as HTMLButtonElement;

const tokenIdEl = $("tokenId") as HTMLInputElement;
const sideEl = $("side") as HTMLSelectElement;
const priceEl = $("price") as HTMLInputElement;
const sizeEl = $("size") as HTMLInputElement;
const orderTypeEl = $("orderType") as HTMLSelectElement;

let provider: ethers.providers.Web3Provider | null = null;
let signer: ethers.Signer | null = null;
let signerAddress: string | null = null;

let apiCreds: ApiKeyCreds | null = null;
let client: ClobClient | null = null;
let lastVerify: { tickSize: TickSize; negRisk: boolean; minOrderSize?: number } | null = null;

function write(obj: unknown) {
  const msg = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  logEl.textContent = `${new Date().toISOString()}\n${msg}\n\n` + logEl.textContent;
}

function setStatus(text: string, ok: boolean) {
  statusEl.innerHTML = `<span class="${ok ? "ok" : "bad"}">${text}</span>`;
}

function loadCredsFromStorage(): ApiKeyCreds | null {
  try {
    const raw = localStorage.getItem("POLY_USER_API_CREDS");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.key && parsed?.secret && parsed?.passphrase) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveCredsToStorage(creds: ApiKeyCreds) {
  localStorage.setItem("POLY_USER_API_CREDS", JSON.stringify(creds));
}

function clearCreds() {
  localStorage.removeItem("POLY_USER_API_CREDS");
  apiCreds = null;
  client = null;
  lastVerify = null;
  btnPlace.disabled = true;
  btnVerify.disabled = true;
  write("Cleared saved API creds.");
}

function normalizeTokenId(t: string) {
  return t.replace(/^0+(?=\d)/, "");
}

async function ensurePolygon() {
  if (!provider) throw new Error("Not connected.");
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID) {
    throw new Error(
      `Wrong network. Please switch MetaMask to Polygon Mainnet (chainId ${CHAIN_ID}). Current: ${net.chainId}`
    );
  }
}

async function buildTradingClient() {
  if (!signer) throw new Error("Signer missing. Connect MetaMask first.");
  if (!apiCreds) throw new Error("User API creds missing.");
  if (!signerAddress) throw new Error("Signer address missing.");

  // ✅ For EOA (signatureType=0) funder is your EOA address.
  // If you’re trading through Polymarket.com proxy wallet, you must use signatureType=1/2 and set funder to proxy address.
  const funder = signerAddress;
  client = new ClobClient(HOST, CHAIN_ID, signer as any, apiCreds, SIGNATURE_TYPE, funder);
}

function parsePositiveNumber(name: string, value: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

function isMultipleOfTick(price: number, tickSize: TickSize) {
  const t = Number(tickSize);
  const scale = 1e8;
  const a = Math.round(price * scale);
  const b = Math.round(t * scale);
  return b !== 0 && a % b === 0;
}

async function approveIfNeededERC20(
  token: ethers.Contract,
  owner: string,
  spender: string,
  label: string
) {
  const allowance: ethers.BigNumber = await token.allowance(owner, spender);
  if (allowance.gt(0)) return;

  setStatus(`Approving USDC.e → ${label} (one-time)… Confirm in MetaMask`, true);
  const tx = await token.approve(spender, ethers.constants.MaxUint256);
  write({ approval: `USDCe->${label}`, txHash: tx.hash });
  await tx.wait();
}

async function setApprovalForAllIfNeeded(
  ctf: ethers.Contract,
  owner: string,
  operator: string,
  label: string
) {
  const approved: boolean = await ctf.isApprovedForAll(owner, operator);
  if (approved) return;

  setStatus(`Approving CTF outcome tokens → ${label} (one-time)…`, true);
  const tx = await ctf.setApprovalForAll(operator, true);
  write({ approval: `CTF setApprovalForAll (${label})`, txHash: tx.hash });
  await tx.wait();
}

// ✅ COMPLETE approvals (fixes your "not enough balance / allowance" in most cases)
async function ensureApprovals(owner: string, negRisk: boolean) {
  if (!signer) throw new Error("Connect MetaMask first.");

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const ctf = new ethers.Contract(ADDRESSES.CTF, CTF_ERC1155_ABI, signer);

  // ---- ERC20 USDC.e approvals (MOST IMPORTANT) ----
  // You were only approving USDCe->CTF. You also need exchange spenders.
  await approveIfNeededERC20(usdc, owner, ADDRESSES.CTF, "CTF");
  await approveIfNeededERC20(usdc, owner, ADDRESSES.CTF_EXCHANGE, "CTF_EXCHANGE");

  if (negRisk) {
    await approveIfNeededERC20(usdc, owner, ADDRESSES.NEG_RISK_CTF_EXCHANGE, "NEG_RISK_CTF_EXCHANGE");
    await approveIfNeededERC20(usdc, owner, ADDRESSES.NEG_RISK_ADAPTER, "NEG_RISK_ADAPTER");
  }

  // ---- ERC1155 approvals for outcome tokens (needed for selling / moving positions) ----
  await setApprovalForAllIfNeeded(ctf, owner, ADDRESSES.CTF_EXCHANGE, "CTF_EXCHANGE");

  if (negRisk) {
    await setApprovalForAllIfNeeded(ctf, owner, ADDRESSES.NEG_RISK_CTF_EXCHANGE, "NEG_RISK_CTF_EXCHANGE");
  }
}

async function debugBalances(owner: string, negRisk: boolean) {
  if (!signer) return;

  const usdc = new ethers.Contract(ADDRESSES.USDCe, ERC20_ABI, signer);
  const decimals: number = await usdc.decimals();
  const bal: ethers.BigNumber = await usdc.balanceOf(owner);

  const allowanceCTF = await usdc.allowance(owner, ADDRESSES.CTF);
  const allowanceEx = await usdc.allowance(owner, ADDRESSES.CTF_EXCHANGE);

  let allowanceNegEx = ethers.BigNumber.from(0);
  let allowanceNegAdapter = ethers.BigNumber.from(0);

  if (negRisk) {
    allowanceNegEx = await usdc.allowance(owner, ADDRESSES.NEG_RISK_CTF_EXCHANGE);
    allowanceNegAdapter = await usdc.allowance(owner, ADDRESSES.NEG_RISK_ADAPTER);
  }

  write({
    usdcE: {
      token: ADDRESSES.USDCe,
      balance: ethers.utils.formatUnits(bal, decimals),
      allowances: {
        CTF: ethers.utils.formatUnits(allowanceCTF, decimals),
        CTF_EXCHANGE: ethers.utils.formatUnits(allowanceEx, decimals),
        ...(negRisk
          ? {
              NEG_RISK_CTF_EXCHANGE: ethers.utils.formatUnits(allowanceNegEx, decimals),
              NEG_RISK_ADAPTER: ethers.utils.formatUnits(allowanceNegAdapter, decimals),
            }
          : {}),
      },
    },
  });
}

btnClearCreds.onclick = () => clearCreds();

btnConnect.onclick = async () => {
  try {
    // @ts-ignore
    if (!window.ethereum) throw new Error("MetaMask not found.");

    // ethers v5
    // @ts-ignore
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");

    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    signerAddress = await signer.getAddress();

    await ensurePolygon();

    apiCreds = loadCredsFromStorage();

    setStatus(
      `Connected: ${signerAddress} | ${apiCreds ? "Loaded saved User API creds ✅" : "No User API creds yet"}`,
      true
    );

    btnDerive.disabled = false;
    btnVerify.disabled = false;
    btnPlace.disabled = true;

    write({ connected: true, address: signerAddress, chainId: CHAIN_ID });
    // we don’t know negRisk yet; log basic balance
    await debugBalances(signerAddress, false);
  } catch (e: any) {
    setStatus(e.message || String(e), false);
    write({ error: e.message || String(e) });
  }
};

btnDerive.onclick = async () => {
  try {
    if (!signer) throw new Error("Connect MetaMask first.");
    await ensurePolygon();

    // L1 init (no creds) → derive L2 user creds
    const temp = new ClobClient(HOST, CHAIN_ID, signer as any);
    const derived: any = await temp.createOrDeriveApiKey();

    // ✅ robust: accept both {key,...} and {apiKey,...}
    apiCreds = {
      key: derived.key ?? derived.apiKey,
      secret: derived.secret,
      passphrase: derived.passphrase,
    };

    if (!apiCreds.key || !apiCreds.secret || !apiCreds.passphrase) {
      throw new Error("Failed to derive user API creds (missing fields). Clear creds and try again.");
    }

    saveCredsToStorage(apiCreds);
    await buildTradingClient();

    setStatus("Derived & saved User API creds ✅ (L2 ready)", true);
    write({ derivedUserApiCreds: { key: apiCreds.key, passphrase: apiCreds.passphrase } });
  } catch (e: any) {
    setStatus(e.message || String(e), false);
    write({ error: e.message || String(e) });
  }
};

btnVerify.onclick = async () => {
  try {
    if (!signer) throw new Error("Connect MetaMask first.");
    await ensurePolygon();

    const tokenID = normalizeTokenId(tokenIdEl.value.trim());
    if (!tokenID) throw new Error("Token ID is required.");

    const price = parsePositiveNumber("Price", priceEl.value);
    const size = parsePositiveNumber("Size", sizeEl.value);

    const c = client ?? new ClobClient(HOST, CHAIN_ID, signer as any);
    const book = await c.getOrderBook(tokenID);

    const tickSize = String(book.tick_size) as TickSize;
    const negRisk = Boolean((book as any).neg_risk ?? false);

    if (!tickSize) throw new Error("Could not read tickSize from orderbook.");
    if (!isMultipleOfTick(price, tickSize)) throw new Error(`Price must be a multiple of tickSize (${tickSize}).`);

    let minOrderSize: number | undefined;
    if ((book as any).min_order_size) {
      const minSize = Number((book as any).min_order_size);
      if (Number.isFinite(minSize)) {
        minOrderSize = minSize;
        if (size < minSize) throw new Error(`Size must be >= min_order_size (${minSize}).`);
      }
    }

    lastVerify = { tickSize, negRisk, minOrderSize };

    btnPlace.disabled = !apiCreds;

    setStatus(
      `Verified ✅ tickSize=${tickSize} negRisk=${negRisk} ${apiCreds ? "" : "(derive creds to place)"}`,
      true
    );

    write({ verified: true, tokenID, side: sideEl.value, price, size, tickSize, negRisk, book });
    if (signerAddress) await debugBalances(signerAddress, negRisk);
  } catch (e: any) {
    setStatus(e.message || String(e), false);
    write({ error: e.message || String(e) });
  }
};

btnPlace.onclick = async () => {
  try {
    if (!signer) throw new Error("Connect MetaMask first.");
    await ensurePolygon();
    if (!apiCreds) throw new Error("Derive User API creds first.");
    if (!client) await buildTradingClient();
    if (!lastVerify) throw new Error("Click Verify first.");
    if (!signerAddress) throw new Error("Signer address missing.");

    const tokenID = normalizeTokenId(tokenIdEl.value.trim());
    const price = parsePositiveNumber("Price", priceEl.value);
    const size = parsePositiveNumber("Size", sizeEl.value);

    if (lastVerify.minOrderSize && size < lastVerify.minOrderSize) {
      throw new Error(`Size must be >= min_order_size (${lastVerify.minOrderSize}).`);
    }
    if (!isMultipleOfTick(price, lastVerify.tickSize)) {
      throw new Error(`Price must be a multiple of tickSize (${lastVerify.tickSize}).`);
    }

    // ✅ Ensure ALL approvals (CTF + exchanges + neg-risk adapter)
    await ensureApprovals(signerAddress, lastVerify.negRisk);
    await debugBalances(signerAddress, lastVerify.negRisk);

    const side = sideEl.value === "BUY" ? Side.BUY : Side.SELL;

    const orderType =
      orderTypeEl.value === "FOK"
        ? OrderType.FOK
        : orderTypeEl.value === "FAK"
        ? OrderType.FAK
        : orderTypeEl.value === "GTD"
        ? OrderType.GTD
        : OrderType.GTC;

    setStatus("Submitting order…", true);

    const resp = await client.createAndPostOrder(
      { tokenID, price, size, side },
      { tickSize: lastVerify.tickSize, negRisk: lastVerify.negRisk },
      orderType
    );

    setStatus(`Order submitted ✅ orderID=${resp.orderID} status=${resp.status}`, true);
    write({ orderResponse: resp });
  } catch (e: any) {
    const msg = e?.message || String(e);
    setStatus(msg, false);
    write({ error: msg });

    // Extra hint for the one you keep seeing
    if (msg.toLowerCase().includes("not enough balance") || msg.toLowerCase().includes("allowance")) {
      write(
        [
          "Still seeing balance/allowance?",
          "1) You MUST have USDC.e in the SAME funder address you pass into ClobClient.",
          "2) If you are trading from a Polymarket.com account (proxy wallet), signatureType must be 1 or 2 and funder must be your proxy address.",
          "3) If your MetaMask shows USDC.e but the proxy holds funds, EOA mode will always fail.",
        ].join("\n")
      );
    }
  }
};
