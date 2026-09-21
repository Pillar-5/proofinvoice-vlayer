const $ = (id) => document.getElementById(id);
const state = { claim: null, proof: null, sessionId: null };

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
  if (fixtures.length > 0) sel.dispatchEvent(new Event("change"));
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
    el.innerHTML = `<p class="err">No extractable claim: ${data.diagnostics?.join("; ") ?? "unknown"}</p>`;
    state.claim = null; $("prove").disabled = true;
    return;
  }
  const c = data.claim;
  el.innerHTML = `<table><tbody>
    <tr><th>Invoice ID</th><td>${c.invoiceId} <code>${c.invoiceIdHash.slice(0, 10)}…</code></td></tr>
    <tr><th>Issuer domain</th><td>${c.issuerDomain} <code>${c.issuerDomainHash.slice(0, 10)}…</code></td></tr>
    <tr><th>Amount</th><td>${Number(c.amountMinor) / 100} ${c.currency} (minor: ${c.amountMinor})</td></tr>
    <tr><th>Due date</th><td>epoch day ${c.dueDateDays}</td></tr>
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

function renderResult(session) {
  const p = session.proof?.proof ?? {};
  const rows = [
    ["Invoice ID hash", p.invoiceIdHash],
    ["Issuer domain hash", p.issuerDomainHash],
    ["Amount (minor units)", p.amountMinor],
    ["Currency", p.currency],
    ["Verification timestamp", new Date(Number(session.settlement?.verifiedAt ?? 0) * 1000).toISOString()],
    ["Transaction", session.settlement?.txHash],
    ["Claim hash", session.settlement?.claimHash],
    ["Block", session.settlement?.blockNumber],
  ];
  $("result").querySelector("tbody").innerHTML =
    rows.map(([k, v]) => `<tr><th>${k}</th><td><code>${v ?? "—"}</code></td></tr>`).join("");
}

async function refreshMetrics() {
  const metrics = await (await fetch("/api/metrics")).json();
  $("metricsOut").textContent = JSON.stringify(metrics, null, 2);
}
$("refreshMetrics").addEventListener("click", refreshMetrics);

loadFixtures();
refreshMetrics();
