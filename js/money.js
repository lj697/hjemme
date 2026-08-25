const HjemmeMoney = (() => {
  const BUCKETS = ["faste", "opsparing", "mad", "fritid", "born", "diverse"];
  const SPEND = ["mad", "fritid", "born", "diverse"];
  const WEIGHTS = { faste: 45, opsparing: 10, mad: 18, fritid: 8, born: 10, diverse: 9 };
  const LABELS = {
    faste: "Faste",
    opsparing: "Opsparing",
    mad: "Mad",
    fritid: "Fritid",
    born: "Børn",
    diverse: "Diverse"
  };

  let view = "overview";
  let resultPeriod = null;
  let keepFocus = null;
  let hooks = { persist() {}, render() {}, leave() {} };

  function attach(next) {
    hooks = { ...hooks, ...next };
  }

  function enter(state) {
    view = isReady(moneyOf(state)) ? "overview" : "setup";
    resultPeriod = null;
    keepFocus = null;
  }

  function moneyOf(state) {
    if (!state.money) state.money = emptyMoney();
    return state.money;
  }

  function isReady(money) {
    return totalIncome(money) > 0 && BUCKETS.some((key) => (money.allocations?.[key] || 0) > 0);
  }

  function totalIncome(money) {
    return (money.incomes || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }

  function allocSum(allocations) {
    return BUCKETS.reduce((sum, key) => sum + Number(allocations?.[key] || 0), 0);
  }

  function suggestAllocations(total, lockedFaste) {
    const amount = Math.max(0, Math.round(Number(total) || 0));
    const alloc = {};
    if (lockedFaste != null) {
      alloc.faste = Math.min(amount, Math.max(0, Math.round(Number(lockedFaste) || 0)));
      const rest = amount - alloc.faste;
      const keys = ["opsparing", "mad", "fritid", "born", "diverse"];
      const weightSum = keys.reduce((sum, key) => sum + WEIGHTS[key], 0);
      let used = 0;
      keys.forEach((key, index) => {
        if (index === keys.length - 1) alloc[key] = rest - used;
        else {
          alloc[key] = Math.round((rest * WEIGHTS[key]) / weightSum);
          used += alloc[key];
        }
      });
      return alloc;
    }
    let used = 0;
    BUCKETS.forEach((key, index) => {
      if (index === BUCKETS.length - 1) alloc[key] = amount - used;
      else {
        alloc[key] = Math.round((amount * WEIGHTS[key]) / 100);
        used += alloc[key];
      }
    });
    return alloc;
  }

  function currentPeriod(date = new Date()) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      week: Math.min(4, Math.ceil(date.getDate() / 7))
    };
  }

  function monthTitle(year, month) {
    const label = new Intl.DateTimeFormat("da-DK", { month: "long" }).format(new Date(year, month - 1, 1));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function kr(value) {
    return `${new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))} kr`;
  }

  function parseKr(value) {
    const text = String(value || "")
      .trim()
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(text);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }

  function weeklyOf(amount) {
    return Math.round(Number(amount || 0) / 4);
  }

  function fillFor(money, period) {
    return (
      (money.fills || []).find(
        (row) => row.year === period.year && row.month === period.month && row.week === period.week
      ) || null
    );
  }

  function monthSpent(money, period, key) {
    return (money.fills || [])
      .filter((row) => row.year === period.year && row.month === period.month)
      .reduce((sum, row) => sum + Number(row[key] || 0), 0);
  }

  function tone(used, budget) {
    if (budget <= 0) return used > 0 ? "over" : "ok";
    const ratio = used / budget;
    if (ratio > 1) return "over";
    if (ratio >= 0.8) return "warn";
    return "ok";
  }

  function bar(used, budget) {
    const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : used > 0 ? 100 : 0;
    return `<div class="pot-bar ${tone(used, budget)}"><span style="width:${pct}%"></span></div>`;
  }

  function diffLine(used, budget) {
    const delta = budget - used;
    if (delta > 0) return `${kr(delta)} under`;
    if (delta < 0) return `${kr(-delta)} over`;
    return "ramte beløbet";
  }

  function render(state) {
    const money = moneyOf(state);
    return `
      <div class="shell money-shell">
        ${renderHeader(state, money)}
        <main class="main">${renderView(money)}</main>
      </div>
    `;
  }

  function renderHeader(state, money) {
    const backLabel = view === "overview" || !isReady(money) ? "Til Hjemme" : "Til spandene";
    return `
      <header class="top money-top">
        <div>
          <p class="eyebrow">Økonomi</p>
          <h1>${escape(state.householdName || "Spandene")}</h1>
        </div>
        <button type="button" class="text-btn" id="money-back">${backLabel}</button>
      </header>
    `;
  }

  function renderView(money) {
    if (view === "setup") return renderSetup(money);
    if (view === "fill") return renderFill(money);
    if (view === "result") return renderResult(money);
    return renderOverview(money);
  }

  function renderSetup(money) {
    const total = totalIncome(money);
    const rows = (money.incomes || [])
      .map(
        (row) => `
        <li class="pot-income">
          <input data-income-label="${escape(row.id)}" value="${escape(row.label)}" placeholder="fx Løn">
          <input data-income-amount="${escape(row.id)}" inputmode="numeric" value="${row.amount || ""}" placeholder="0">
          <button type="button" class="icon-btn" data-remove-income="${escape(row.id)}" aria-label="Fjern">×</button>
        </li>`
      )
      .join("");
    const sum = allocSum(money.allocations);
    const delta = total - sum;
    const locked = Boolean(money.locked?.faste);
    const allocRows = BUCKETS.map((key) => {
      const weekly = SPEND.includes(key) ? `<small>uge ${kr(weeklyOf(money.allocations[key]))}</small>` : `<small>sat af</small>`;
      return `
        <label class="pot-alloc">
          <span>${LABELS[key]} ${weekly}</span>
          <input data-alloc="${key}" inputmode="numeric" value="${money.allocations[key] || ""}" ${key === "faste" && locked ? "readonly" : ""}>
        </label>`;
    }).join("");
    return `
      <section class="stack money-view">
        <div>
          <h2>Hvad kommer ind?</h2>
          <p class="hint">Tast månedens indtægter. Derefter et forslag til spandene.</p>
        </div>
        <ul class="chip-list pot-incomes">${rows || `<li class="hint">Tilføj mindst én indtægt.</li>`}</ul>
        <div class="add-row">
          <input id="money-income-label" placeholder="Navn">
          <input id="money-income-amount" inputmode="numeric" placeholder="Beløb">
          <button type="button" class="btn" id="money-add-income">Tilføj</button>
        </div>
        <p class="hint">I alt ${kr(total)}</p>
        <button type="button" class="btn" id="money-suggest" ${total ? "" : "disabled"}>Fordel måneden</button>
        <label class="tick inline">
          <input type="checkbox" id="money-lock-faste" ${locked ? "checked" : ""}>
          Lås faste til det beløb, I kender
        </label>
        <div class="pot-allocs">${allocRows}</div>
        <p class="hint ${delta === 0 ? "" : "warn"}">${
          delta === 0
            ? `Fordelingen rammer ${kr(total)}`
            : delta > 0
              ? `${kr(delta)} mangler at blive fordelt`
              : `${kr(-delta)} over indtægten`
        }</p>
        <button type="button" class="btn btn-primary" id="money-save-setup" ${isReady(money) ? "" : "disabled"}>Vis spandene</button>
      </section>
    `;
  }

  function renderOverview(money) {
    if (!isReady(money)) {
      return `
        <section class="stack money-view">
          <div class="list-card static">
            <div>
              <p class="eyebrow">Spandene</p>
              <h2>Sæt indtægter først</h2>
              <p class="hint">Når måneden er fordelt, fylder I fire tal hver uge.</p>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="money-open-setup">Kom i gang</button>
        </section>
      `;
    }
    const period = currentPeriod();
    const fill = fillFor(money, period);
    const spendCards = SPEND.map((key) => {
      const monthBudget = money.allocations[key] || 0;
      const weekBudget = weeklyOf(monthBudget);
      const weekUsed = fill ? Number(fill[key] || 0) : 0;
      const monthUsed = monthSpent(money, period, key);
      return `
        <article class="pot-card">
          <p class="eyebrow">${LABELS[key]}</p>
          <p class="pot-line">uge ${kr(weekUsed)} / ${kr(weekBudget)}</p>
          ${bar(weekUsed, weekBudget)}
          <p class="hint">måned ${kr(monthUsed)} / ${kr(monthBudget)}</p>
          ${bar(monthUsed, monthBudget)}
        </article>`;
    }).join("");
    const leftover = SPEND.reduce((sum, key) => sum + Math.max(0, (money.allocations[key] || 0) - monthSpent(money, period, key)), 0);
    return `
      <section class="stack money-view">
        <div>
          <p class="eyebrow">${monthTitle(period.year, period.month)} · uge ${period.week} af 4</p>
          <h2>${kr(totalIncome(money))} ind</h2>
          <p class="hint">${kr(money.allocations.faste)} til faste · ${kr(money.allocations.opsparing)} til opsparing</p>
        </div>
        <div class="pot-set-aside">
          <div><span>Faste</span><strong>${kr(money.allocations.faste)}</strong></div>
          <div><span>Opsparing</span><strong>${kr(money.allocations.opsparing)}</strong></div>
        </div>
        ${spendCards}
        <p class="hint">${fill ? "Ugen er udfyldt. I kan rette tallene." : "De løse spande har " + kr(leftover) + " tilbage i måneden."}</p>
        <button type="button" class="btn btn-primary" id="money-open-fill">${fill ? "Ret ugens spande" : "Fyld ugens spande"}</button>
        <button type="button" class="text-btn" id="money-open-setup">Ret indtægter og fordeling</button>
      </section>
    `;
  }

  function renderFill(money) {
    const period = currentPeriod();
    const fill = fillFor(money, period) || {};
    const fields = SPEND.map(
      (key) => `
        <label>
          ${LABELS[key]}
          <small class="hint">uge ${kr(weeklyOf(money.allocations[key]))}</small>
          <input name="${key}" inputmode="numeric" value="${fill[key] ?? ""}" placeholder="0">
        </label>`
    ).join("");
    return `
      <section class="stack money-view">
        <div>
          <h2>Uge ${period.week} · hvad kom i spandene?</h2>
          <p class="hint">Et samlet tal for ugen er nok. Ikke hver kvittering.</p>
        </div>
        <form class="form" id="money-fill-form">
          ${fields}
          <button type="submit" class="btn btn-primary">Se hvordan det gik</button>
        </form>
      </section>
    `;
  }

  function renderResult(money) {
    const period = resultPeriod || currentPeriod();
    const fill = fillFor(money, period);
    if (!fill) {
      return `
        <section class="stack money-view">
          <p class="hint">Ugen er ikke udfyldt endnu.</p>
          <button type="button" class="btn" id="money-open-fill">Fyld ugens spande</button>
        </section>
      `;
    }
    const lastWeek = period.week === 4;
    const leftover = SPEND.reduce((sum, key) => sum + Math.max(0, (money.allocations[key] || 0) - monthSpent(money, period, key)), 0);
    const lines = SPEND.map((key) => {
      const used = Number(fill[key] || 0);
      const budget = weeklyOf(money.allocations[key]);
      const kind = tone(used, budget);
      const extra = kind === "over" && key === "fritid" ? " · tog I det fra diverse?" : kind === "ok" ? " · luft" : "";
      return `
        <li class="pot-result ${kind}">
          <strong>${LABELS[key]}</strong>
          <span>${diffLine(used, budget)}${extra}</span>
        </li>`;
    }).join("");
    return `
      <section class="stack money-view">
        <div>
          <p class="eyebrow">${monthTitle(period.year, period.month)}</p>
          <h2>Uge ${period.week}</h2>
        </div>
        <ul class="pot-results">${lines}</ul>
        <p class="hint">${
          lastWeek
            ? `Måneden er slut. De løse spande har ${kr(leftover)} til gode — eller minus, hvis noget løb over.`
            : `De løse spande har ${kr(leftover)} tilbage på ${4 - period.week} ${4 - period.week === 1 ? "uge" : "uger"}.`
        }</p>
        <button type="button" class="btn btn-primary" id="money-to-overview">Tilbage til spandene</button>
      </section>
    `;
  }

  function bind(state) {
    const money = moneyOf(state);
    document.getElementById("money-back")?.addEventListener("click", () => {
      if (view === "overview" || !isReady(money)) {
        hooks.leave();
        return;
      }
      view = "overview";
      hooks.render();
    });
    document.getElementById("money-open-setup")?.addEventListener("click", () => {
      view = "setup";
      hooks.render();
    });
    document.getElementById("money-open-fill")?.addEventListener("click", () => {
      view = "fill";
      hooks.render();
    });
    document.getElementById("money-to-overview")?.addEventListener("click", () => {
      view = "overview";
      hooks.render();
    });
    document.getElementById("money-save-setup")?.addEventListener("click", () => {
      if (!isReady(money)) return;
      view = "overview";
      hooks.persist();
      hooks.render();
    });
    document.getElementById("money-suggest")?.addEventListener("click", () => {
      const locked = money.locked?.faste ? money.allocations.faste : null;
      money.allocations = suggestAllocations(totalIncome(money), locked);
      hooks.persist();
      hooks.render();
    });
    document.getElementById("money-lock-faste")?.addEventListener("change", (event) => {
      money.locked = { faste: event.target.checked };
      if (event.target.checked) {
        money.allocations = suggestAllocations(totalIncome(money), money.allocations.faste);
      }
      hooks.persist();
      hooks.render();
    });
    document.getElementById("money-add-income")?.addEventListener("click", () => addIncome(money));
    document.getElementById("money-income-amount")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addIncome(money);
      }
    });
    document.querySelectorAll("[data-remove-income]").forEach((btn) => {
      btn.addEventListener("click", () => {
        money.incomes = money.incomes.filter((row) => row.id !== btn.dataset.removeIncome);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-income-label]").forEach((input) => {
      input.addEventListener("change", () => {
        const row = money.incomes.find((item) => item.id === input.dataset.incomeLabel);
        if (row) row.label = input.value.trim() || "Indtægt";
        hooks.persist();
      });
    });
    document.querySelectorAll("[data-income-amount]").forEach((input) => {
      input.addEventListener("change", () => {
        const row = money.incomes.find((item) => item.id === input.dataset.incomeAmount);
        if (row) row.amount = parseKr(input.value);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-alloc]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.alloc;
        money.allocations[key] = parseKr(input.value);
        hooks.persist();
        hooks.render();
      });
    });
    document.getElementById("money-fill-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const period = currentPeriod();
      const next = {
        year: period.year,
        month: period.month,
        week: period.week,
        mad: parseKr(data.get("mad")),
        fritid: parseKr(data.get("fritid")),
        born: parseKr(data.get("born")),
        diverse: parseKr(data.get("diverse"))
      };
      const existing = fillFor(money, period);
      if (existing) Object.assign(existing, next);
      else money.fills.push(next);
      resultPeriod = period;
      view = "result";
      hooks.persist();
      hooks.render();
    });
    if (keepFocus === "income") {
      keepFocus = null;
      document.getElementById("money-income-label")?.focus();
    }
  }

  function addIncome(money) {
    const label = document.getElementById("money-income-label")?.value.trim() || "Indtægt";
    const amount = parseKr(document.getElementById("money-income-amount")?.value);
    if (!amount && label === "Indtægt") return;
    money.incomes.push({ id: uid(), label, amount });
    keepFocus = "income";
    hooks.persist();
    hooks.render();
  }

  function escape(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { attach, enter, render, bind, suggestAllocations };
})();
