const $ = (id) => document.getElementById(id);
const state = { claim: null, proof: null, sessionId: null };

/** Escapes email-derived strings before they are placed into innerHTML. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch
  ));
}

async function loadFixtures() {
  const res = await fetch("/api/fixtures");
  const { fixtures } = await res.json();
  const sel = $("fixture");
  sel.innerHTML = "";
  for (const f of fixtures) {
    const opt = document.createElement("option");
    opt.value = f.name; opt.textContent = f.name;
    sel.appendChild(opt);
  }
  return fixtures;
}
$("fixture").addEventListener("change", async () => {
  const res = await fetch(`/api/fixtures/${$("fixture").value}`);
  $("eml").value = await res.text();
});
$("file").addEventListener("change", async () => {
  $("eml").value = await $("file").files[0].text();
});

$("parse").addEventListener("click", async () => {
  const res = await fetch("/api/parse", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mimeEmail: $("eml").value }),
  });
  const data = await res.json();
  const el = $("parsed");
  if (!data.claim) {
    el.innerHTML = `<p class="err">No extractable claim: ${esc(data.diagnostics?.join("; ") ?? "unknown")}</p>`;
    state.claim = null; $("prove").disabled = true;
    return;
  }
  const c = data.claim;
  const minor = BigInt(c.amountMinor);
  const units = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, "0");
  el.innerHTML = `<table><tbody>
    <tr><th>Invoice ID</th><td>${esc(c.invoiceId)} <code>${esc(c.invoiceIdHash.slice(0, 10))}…</code></td></tr>
    <tr><th>Issuer domain</th><td>${esc(c.issuerDomain)} <code>${esc(c.issuerDomainHash.slice(0, 10))}…</code></td></tr>
    <tr><th>Amount</th><td>${units.toString()}.${fraction} ${esc(c.currency)} (minor: ${esc(c.amountMinor)})</td></tr>
    <tr><th>Due date</th><td>epoch day ${esc(c.dueDateDays)}</td></tr>
  </tbody></table>`;
  state.claim = c;
  $("prove").disabled = false;
});

function setProofState(text, cls) { $("proofState").textContent = text; $("proofState").className = "status " + (cls ?? ""); }

$("prove").addEventListener("click", async () => {
  setProofState("proving…");
  $("proofOut").hidden = true;
  const res = await fetch("/api/proof", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mimeEmail: $("eml").value, proverAddress: $("prover").value.trim() }),
  });
  if (res.status === 202) {
    const { sessionId } = await res.json();
    state.sessionId = sessionId;
    const poll = setInterval(async () => {
      const s = await (await fetch(`/api/proof/${sessionId}`)).json();
      setProofState(s.state, s.state === "proved" ? "ok" : s.state === "failed" ? "err" : "");
      if (s.state === "proved" || s.state === "failed") {
        clearInterval(poll);
        $("proofOut").hidden = false;
        $("proofOut").textContent = JSON.stringify(s, null, 2);
        if (s.state === "proved") { state.proof = s; $("verify").disabled = false; }
      }
    }, 1500);
  } else {
    const err = await res.json();
    setProofState("failed", "err");
    $("proofOut").hidden = false;
    $("proofOut").textContent = err.error ?? `HTTP ${res.status}`;
  }
});

function setVerifyState(text, cls) { $("verifyState").textContent = text; $("verifyState").className = "status " + (cls ?? ""); }

$("verify").addEventListener("click", async () => {
  if (!state.sessionId) return;
  setVerifyState("settling…");
  const res = await fetch(`/api/verify/${state.sessionId}`, { method: "POST" });
  if (res.status === 202) {
    const poll = setInterval(async () => {
      const s = await (await fetch(`/api/proof/${state.sessionId}`)).json();
      setVerifyState(s.state, s.state === "settled" ? "ok" : s.state === "failed" ? "err" : "");
      if (s.state === "settled" || s.state === "failed") {
        clearInterval(poll);
        $("verifyOut").hidden = false;
        $("verifyOut").textContent = JSON.stringify(s.settlement ?? s.error, null, 2);
        if (s.state === "settled") renderResult(s);
        refreshMetrics();
      }
    }, 1500);
  } else {
    const err = await res.json();
    setVerifyState("failed", "err");
    $("verifyOut").hidden = false;
    $("verifyOut").textContent = err.error ?? `HTTP ${res.status}`;
  }
});

let chainConfig = null;
async function refreshMetrics() {
  const metrics = await (await fetch("/api/metrics")).json();
  $("metricsOut").textContent = JSON.stringify(metrics, null, 2);
}
$("refreshMetrics").addEventListener("click", refreshMetrics);

async function loadConfig() {
  chainConfig = await (await fetch("/api/config")).json();
  $("chainInfo").textContent =
    `Network: ${chainConfig.network} (chainId ${chainConfig.chainId}) · mode: ${chainConfig.mode}` +
    ` · Verifier: ${chainConfig.verifierAddress ?? "not deployed"} · Registry: ${chainConfig.registryAddress ?? "not deployed"}`;
  const rows = [
    ["Mode", chainConfig.mode === "live" ? "Live (real proving enabled)" : "Local demonstration (parsing + workflow only)"],
    ["vlayer", chainConfig.proverUrl ? `Configured (${chainConfig.proverUrl})` : "Not configured"],
    ["Network", `${chainConfig.network} (chain id ${chainConfig.chainId})`],
    ["Contracts", chainConfig.verifierAddress && chainConfig.registryAddress && chainConfig.proverAddress ? "Configured" : "Not configured"],
  ];
  $("statusPanel").querySelector("tbody").innerHTML =
    rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
}

function renderResult(session) {
  const p = session.proof?.proof ?? {};
  const c = state.claim;
  let amountDisplay = p.amountMinor ?? "—";
  if (c) {
    const minor = BigInt(c.amountMinor);
    amountDisplay = `${(minor / 100n).toString()}.${(minor % 100n).toString().padStart(2, "0")} ${c.currency}`;
  }
  const rows = [
    ["Invoice ID", c?.invoiceId],
    ["Issuer domain", c?.issuerDomain],
    ["Amount", amountDisplay],
    ["Verification timestamp", session.settlement?.verifiedAt ? new Date(Number(session.settlement.verifiedAt) * 1000).toISOString() : null],
    ["Transaction", session.settlement?.txHash],
    ["Claim hash", session.settlement?.claimHash],
    ["Contract (Registry)", chainConfig?.registryAddress],
    ["Contract (Verifier)", chainConfig?.verifierAddress],
    ["Block", session.settlement?.blockNumber],
  ];
  $("result").querySelector("tbody").innerHTML =
    rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td><code>${esc(v ?? "—")}</code></td></tr>`).join("");
  if (session.settlement?.txHash && chainConfig?.explorerUrl) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = "Explorer";
    const td = document.createElement("td");
    const txLink = document.createElement("a");
    txLink.href = `${chainConfig.explorerUrl}/tx/${session.settlement.txHash}`;
    txLink.textContent = `View on ${chainConfig.explorerName ?? "block explorer"}`;
    txLink.target = "_blank";
    txLink.rel = "noopener noreferrer";
    td.appendChild(txLink);
    tr.appendChild(th);
    tr.appendChild(td);
    $("result").querySelector("tbody").appendChild(tr);
  }
}

loadConfig();
(async () => {
  // Auto-load and parse the first fixture so the demo page is immediately
  // meaningful (and screenshots are deterministic).
  try {
    const fixtures = await loadFixtures();
    const names = fixtures.map((f) => f.name);
    const name = names.includes("invoice-sample.eml") ? "invoice-sample.eml" : names[0];
    if (name) {
      $("fixture").value = name;
      $("eml").value = await (await fetch(`/api/fixtures/${name}`)).text();
      $("parse").click();
    }
  } catch (err) {
    console.error("auto-load failed", err instanceof Error ? err.stack : String(err));
  }
})();
refreshMetrics();
