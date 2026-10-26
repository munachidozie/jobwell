// JobWell form-filler content script.
//
// Hard rule: this script NEVER submits a form. It only fills visible input
// fields and leaves the final submit action entirely to the user. There is no
// code path that calls form.submit() or clicks a submit button.

function setValue(el, value) {
  if (!el || value == null || value === "") return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  setter?.call(el, value);
  // Fire the events React/Angular forms listen for, so the value "sticks".
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// Find a field by matching label text, name, id or placeholder against a list
// of keywords.
function findField(keywords) {
  const inputs = [
    ...document.querySelectorAll("input[type=text], input[type=email], input:not([type]), textarea"),
  ];
  for (const el of inputs) {
    const hay = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("aria-label"),
      el.labels?.[0]?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (keywords.some((k) => hay.includes(k))) return el;
  }
  return null;
}

const FIELD_MAP = {
  location: ["location", "city", "where are you"],
  // jobFunction is informational; some ATS have a "current title" field.
  currentTitle: ["current title", "job title", "position"],
};

function fillFrom(data) {
  const filled = [];
  if (data.profile) {
    if (setValue(findField(FIELD_MAP.location), data.profile.location)) {
      filled.push("location");
    }
    if (
      setValue(findField(FIELD_MAP.currentTitle), data.profile.jobFunction)
    ) {
      filled.push("current title");
    }
  }
  return filled;
}

// The popup triggers filling by sending a message with the data it fetched
// from the local app. The content script itself makes no network calls.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "jobwell-fill") {
    try {
      const filled = fillFrom(msg.data);
      sendResponse({
        ok: true,
        filled,
        note:
          filled.length > 0
            ? `Filled: ${filled.join(", ")}. Review everything, then submit yourself.`
            : "No matching fields found on this page.",
      });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }
  return true; // keep the message channel open for the async response
});
