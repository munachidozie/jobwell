(async () => {
  for (const [name, url] of [
    ["frankfurter", "https://api.frankfurter.app/latest?base=USD&symbols=NGN,GBP,EUR"],
    ["frankfurter-dev", "https://api.frankfurter.dev/v1/latest?base=USD&symbols=NGN,GBP,EUR"],
    ["er-api", "https://open.er-api.com/v6/latest/USD"],
  ]) {
    try {
      const r = await fetch(url);
      const d = await r.json();
      const rates = d.rates || {};
      console.log(name + " status=" + r.status + " NGN=" + rates.NGN + " count=" + Object.keys(rates).length);
    } catch (e) { console.log(name + " ERR " + e.message); }
  }
})();
