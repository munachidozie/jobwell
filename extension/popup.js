const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(text, color = "#9aa2b1") {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

// Restore saved pairing.
chrome.storage.local.get(["port", "token"], (saved) => {
  if (saved.port) $("port").value = saved.port;
  if (saved.token) $("token").value = saved.token;
  if (saved.port && saved.token) $("fill").disabled = false;
});

function base() {
  return `http://127.0.0.1:${$("port").value.trim()}`;
}

$("pair").addEventListener("click", async () => {
  const port = $("port").value.trim();
  const token = $("token").value.trim();
  if (!port || !token) {
    setStatus("Enter the port and token from JobWell.", "#ff6b6b");
    return;
  }
  try {
    const res = await fetch(`${base()}/ping`);
    const data = await res.json();
    if (data.app !== "jobwell") throw new Error("Unexpected response");
    chrome.storage.local.set({ port, token });
    $("fill").disabled = false;
    setStatus("Paired with JobWell.", "#39d98a");
  } catch (err) {
    setStatus(`Could not reach JobWell: ${err}`, "#ff6b6b");
  }
});

$("fill").addEventListener("click", async () => {
  const token = $("token").value.trim();
  try {
    const res = await fetch(`${base()}/fill-data`, {
      headers: { "x-jobwell-token": token },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    chrome.tabs.sendMessage(
      tab.id,
      { type: "jobwell-fill", data },
      (response) => {
        if (chrome.runtime.lastError) {
          setStatus(
            "Open a supported application page first (Greenhouse, Lever, Ashby, Workable).",
            "#f5c451",
          );
          return;
        }
        if (response?.ok) {
          setStatus(response.note, "#39d98a");
        } else {
          setStatus(`Fill failed: ${response?.error ?? "unknown"}`, "#ff6b6b");
        }
      },
    );
  } catch (err) {
    setStatus(`Could not fetch data: ${err}`, "#ff6b6b");
  }
});
