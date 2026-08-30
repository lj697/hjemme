const HjemmeMoney = (() => {
  let view = "overview";
  let viewedPeriod = currentPeriod();
  let resultPeriod = null;
  let keepFocus = null;
  let hooks = { persist() {}, render() {}, leave() {} };

  function attach(next) {
    hooks = { ...hooks, ...next };
  }

  function enter(state) {
    const money = moneyOf(state);
    const now = currentPeriod();
    viewedPeriod = { ...now };
    resultPeriod = null;
    keepFocus = null;
    ensureBuckets(money);
    if (!findMonthPlan(money, now.year, now.month)) {
      snapshotMonthPlan(money, now.year, now.month, false);
      hooks.persist();
    }
    view = isReady(money) ? "overview" : "setup";
  }

  function moneyOf(state) {
    if (!state.money) state.money = emptyMoney();
    return state.money;
  }

  function ensureBuckets(money) {
    money.buckets = cloneBuckets(money.buckets);
    money.allocations = cloneAllocations(money.allocations, money.buckets);
    money.locked = cloneLocked(money.locked, money.buckets);
    for (const bucket of money.buckets) money.locked[bucket.id] = !bucket.weekly;
    return money.buckets;
  }

  function bucketsOf(plan) {
    return cloneBuckets(plan?.buckets);
  }

  function spendBuckets(buckets) {
    return buckets.filter((bucket) => bucket.weekly);
  }

  function asideBuckets(buckets) {
    return buckets.filter((bucket) => !bucket.weekly);
  }

  function isReady(money) {
    const buckets = bucketsOf(money);
    return totalIncome(money) > 0 && buckets.some((bucket) => (money.allocations?.[bucket.id] || 0) > 0);
  }

  function totalIncome(money) {
    return (money.incomes || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }

  function allocSum(allocations, buckets) {
    return buckets.reduce((sum, bucket) => sum + Number(allocations?.[bucket.id] || 0), 0);
  }

  function suggestAllocations(total, current = {}, locked = {}, buckets = defaultBuckets()) {
    const amount = Math.max(0, Math.round(Number(total) || 0));
    const alloc = {};
    const lockedKeys = buckets.filter((bucket) => locked[bucket.id]).map((bucket) => bucket.id);
    const free = buckets.filter((bucket) => !locked[bucket.id]);
    lockedKeys.forEach((key) => {
      alloc[key] = Math.max(0, Math.round(Number(current[key]) || 0));
    });
    const lockedSum = lockedKeys.reduce((sum, key) => sum + alloc[key], 0);
    if (!free.length) return alloc;
    const rest = Math.max(0, amount - lockedSum);
    const weightSum = free.reduce((sum, bucket) => sum + Number(bucket.weight || 10), 0);
    let used = 0;
    free.forEach((bucket, index) => {
      if (index === free.length - 1) alloc[bucket.id] = rest - used;
      else {
        alloc[bucket.id] = weightSum ? Math.round((rest * bucket.weight) / weightSum) : 0;
        used += alloc[bucket.id];
      }
    });
    return alloc;
  }

  function parsePct(value) {
    const text = String(value || "")
      .trim()
      .replace(/\s/g, "")
      .replace(",", ".");
    const n = Number(text);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  function amountFromPct(pct, total) {
    return Math.max(0, Math.round(((Number(total) || 0) * pct) / 100));
  }

  function pctDisplay(amount, total) {
    if (!total) return "";
    const pct = ((Number(amount) || 0) / total) * 100;
    const rounded = Math.round(pct * 10) / 10;
    return String(rounded).replace(".", ",");
  }

  function ensureLocked(money) {
    ensureBuckets(money);
    return money.locked;
  }

  function currentPeriod(date = new Date()) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      week: Math.min(4, Math.ceil(date.getDate() / 7))
    };
  }

  function isSameMonth(a, b) {
    return a.year === b.year && a.month === b.month;
  }

  function shiftMonth(year, month, delta) {
    const d = new Date(year, month - 1 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, week: 1 };
  }

  function weekRange(year, month, week) {
    const last = new Date(year, month, 0).getDate();
    const start = (week - 1) * 7 + 1;
    const end = week === 4 ? last : Math.min(start + 6, last);
    return { start, end };
  }

  function formatWeekSpan(year, month, week) {
    const { start, end } = weekRange(year, month, week);
    const monthShort = new Intl.DateTimeFormat("da-DK", { month: "short" }).format(new Date(year, month - 1, 1));
    return `${start}.–${end}. ${monthShort}`;
  }

  function weekLabel(year, month, week) {
    return `Uge ${week} · ${formatWeekSpan(year, month, week)}`;
  }

  function planForView(money, period, live) {
    if (isSameMonth(period, live)) {
      const buckets = ensureBuckets(money);
      return {
        incomes: money.incomes || [],
        buckets,
        allocations: money.allocations,
        locked: money.locked
      };
    }
    const rec = findMonthPlan(money, period.year, period.month);
    if (!rec) return null;
    return {
      ...rec,
      buckets: bucketsOf(rec)
    };
  }

  function persistCurrentMonth(money) {
    const now = currentPeriod();
    snapshotMonthPlan(money, now.year, now.month, true);
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
    const backLabel = view === "overview" || !isReady(money) ? "Til Hjemme" : "Til puljerne";
    return `
      <header class="top money-top">
        <div>
          <p class="eyebrow">Økonomi</p>
          <h1>${escape(state.householdName || "Puljerne")}</h1>
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
    const buckets = ensureBuckets(money);
    const sum = allocSum(money.allocations, buckets);
    const delta = total - sum;
    const allocRows = buckets
      .map((bucket) => {
        const key = bucket.id;
        const weekly = bucket.weekly
          ? `<small>uge ${kr(weeklyOf(money.allocations[key]))}</small>`
          : `<small>sat af</small>`;
        const isFast = !bucket.weekly;
        return `
        <div class="pot-alloc ${isFast ? "locked" : ""}">
          <span class="pot-alloc-head">
            <input class="pot-alloc-name" data-bucket-label="${escape(key)}" value="${escape(bucket.label)}" placeholder="Navn">
            <button type="button" class="icon-btn" data-remove-bucket="${escape(key)}" aria-label="Slet pulje" ${buckets.length < 2 ? "disabled" : ""}>×</button>
          </span>
          <span class="pot-alloc-tools">
            <label class="tick inline">
              <input type="checkbox" data-lock-alloc="${escape(key)}" ${isFast ? "checked" : ""}>
              Fast
            </label>
            ${weekly}
          </span>
          <span class="pot-alloc-fields">
            <label>Beløb
              <input data-alloc="${escape(key)}" inputmode="numeric" value="${money.allocations[key] || ""}" placeholder="0">
            </label>
            <label>Procent
              <input data-alloc-pct="${escape(key)}" inputmode="decimal" value="${escape(pctDisplay(money.allocations[key], total))}" placeholder="0" ${total ? "" : "readonly"}>
            </label>
          </span>
        </div>`;
      })
      .join("");
    return `
      <section class="stack money-view">
        <div>
          <h2>Hvad kommer ind?</h2>
          <p class="hint">Tast månedens indtægter. Derefter et forslag til puljerne.</p>
        </div>
        <ul class="chip-list pot-incomes">${rows || `<li class="hint">Tilføj mindst én indtægt.</li>`}</ul>
        <div class="add-row">
          <input id="money-income-label" placeholder="Navn">
          <input id="money-income-amount" inputmode="numeric" placeholder="Beløb">
          <button type="button" class="btn" id="money-add-income">Tilføj</button>
        </div>
        <p class="hint">I alt ${kr(total)}</p>
        <button type="button" class="btn" id="money-suggest" ${total ? "" : "disabled"}>Fordel måneden</button>
        <p class="hint">Skriv beløb eller procent. Fast er faste udgifter: de sættes af for måneden og bliver, når I fordeler resten. De andre udfylder I hver uge.</p>
        <div class="pot-allocs">${allocRows}</div>
        <button type="button" class="btn" id="money-add-bucket">Tilføj pulje</button>
        <p class="hint ${delta === 0 ? "" : "warn"}">${
          delta === 0
            ? `Fordelingen rammer ${kr(total)}`
            : delta > 0
              ? `${kr(delta)} mangler at blive fordelt`
              : `${kr(-delta)} over indtægten`
        }</p>
        <button type="button" class="btn btn-primary" id="money-save-setup" ${isReady(money) ? "" : "disabled"}>Vis puljerne</button>
      </section>
    `;
  }

  function renderOverview(money) {
    if (!isReady(money)) {
      return `
        <section class="stack money-view">
          <div class="list-card static">
            <div>
              <p class="eyebrow">Puljerne</p>
              <h2>Sæt indtægter først</h2>
              <p class="hint">Når måneden er fordelt, fylder I fire tal hver uge.</p>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="money-open-setup">Kom i gang</button>
        </section>
      `;
    }
    const live = currentPeriod();
    const period = viewedPeriod;
    const thisMonth = isSameMonth(period, live);
    const plan = planForView(money, period, live);
    const buckets = bucketsOf(plan);
    const spend = spendBuckets(buckets);
    const aside = asideBuckets(buckets);
    const allocations = plan?.allocations || {};
    const income = plan ? totalIncome(plan) : 0;
    const fill = fillFor(money, thisMonth ? { ...period, week: live.week } : period);
    const spendCards = spend
      .map((bucket) => {
        const key = bucket.id;
        const monthBudget = allocations[key] || 0;
        const weekBudget = weeklyOf(monthBudget);
        const weekUsed = thisMonth && fill ? Number(fill[key] || 0) : monthSpent(money, period, key);
        const monthUsed = monthSpent(money, period, key);
        return `
        <article class="pot-card">
          <p class="eyebrow">${escape(bucket.label)}</p>
          ${
            thisMonth
              ? `<p class="pot-line">uge ${kr(weekUsed)} / ${kr(weekBudget)}</p>
          ${bar(weekUsed, weekBudget)}`
              : ""
          }
          <p class="hint">måned ${kr(monthUsed)} / ${kr(monthBudget)}</p>
          ${bar(monthUsed, monthBudget)}
        </article>`;
      })
      .join("");
    const leftover = spend.reduce(
      (sum, bucket) => sum + Math.max(0, (allocations[bucket.id] || 0) - monthSpent(money, period, bucket.id)),
      0
    );
    const currentFill = thisMonth ? fillFor(money, { ...period, week: live.week }) : null;
    const weeks = [1, 2, 3, 4]
      .map((week) => {
        const row = fillFor(money, { ...period, week });
        const today = thisMonth && week === live.week;
        return `
          <button type="button" class="money-week ${today ? "today" : ""} ${row ? "filled" : ""}" data-money-week="${week}" ${spend.length ? "" : "disabled"}>
            <strong>${weekLabel(period.year, period.month, week)}</strong>
            <span>${row ? "Udfyldt" : today ? "I gang" : "Ikke udfyldt"}</span>
          </button>`;
      })
      .join("");
    return `
      <section class="stack money-view">
        <div class="cal-nav">
          <button type="button" class="icon-btn" id="money-prev-month" aria-label="Forrige måned">‹</button>
          <strong>${escape(monthTitle(period.year, period.month))} ${period.year}</strong>
          <button type="button" class="icon-btn" id="money-next-month" aria-label="Næste måned" ${thisMonth ? "disabled" : ""}>›</button>
        </div>
        ${thisMonth ? "" : `<button type="button" class="text-btn" id="money-this-month">Gå til denne måned</button>`}
        <div>
          <p class="eyebrow">${thisMonth ? weekLabel(period.year, period.month, live.week) : "Måneden"}</p>
          <h2>${plan ? kr(income) + " ind" : "Ingen fordeling gemt"}</h2>
          <p class="hint">${
            plan
              ? aside.map((bucket) => `${kr(allocations[bucket.id])} til ${bucket.label.toLowerCase()}`).join(" · ") ||
                "Alle puljer udfyldes hver uge"
              : "Her er kun ugetal, I har skrevet, hvis der er nogen."
          }</p>
        </div>
        ${
          aside.length
            ? `<div class="pot-set-aside">${aside
                .map(
                  (bucket) =>
                    `<div><span>${escape(bucket.label)}</span><strong>${kr(allocations[bucket.id])}</strong></div>`
                )
                .join("")}</div>`
            : ""
        }
        ${spendCards || `<p class="hint">Ingen ugepuljer endnu. Fjern Fast på en pulje, eller tilføj en ny.</p>`}
        <div>
          <p class="eyebrow">Ugerne</p>
          <div class="money-weeks">${weeks}</div>
        </div>
        <p class="hint">${
          thisMonth
            ? currentFill
              ? "Ugen er udfyldt. I kan rette tallene."
              : "De løse puljer har " + kr(leftover) + " tilbage i måneden."
            : leftover
              ? "De løse puljer havde " + kr(leftover) + " til gode."
              : "Bladre i ugerne for at se, hvad der kom i puljerne."
        }</p>
        ${
          thisMonth
            ? `<button type="button" class="btn btn-primary" id="money-open-fill" ${spend.length ? "" : "disabled"}>${currentFill ? "Ret ugens puljer" : "Fyld ugens puljer"}</button>
        <button type="button" class="text-btn" id="money-open-setup">Redigér</button>`
            : ""
        }
      </section>
    `;
  }

  function renderFill(money) {
    const live = currentPeriod();
    const period = viewedPeriod;
    const plan = planForView(money, period, live);
    const buckets = spendBuckets(bucketsOf(plan));
    const allocations = plan?.allocations || money.allocations;
    const fill = fillFor(money, period) || {};
    const fields = buckets
      .map(
        (bucket) => `
        <label>
          ${escape(bucket.label)}
          <small class="hint">uge ${kr(weeklyOf(allocations[bucket.id]))}</small>
          <input name="${escape(bucket.id)}" inputmode="numeric" value="${fill[bucket.id] ?? ""}" placeholder="0">
        </label>`
      )
      .join("");
    return `
      <section class="stack money-view">
        <div>
          <h2>${weekLabel(period.year, period.month, period.week)}</h2>
          <p class="hint">${fields ? "Hvad kom i puljerne? Et samlet tal for ugen er nok." : "Der er ingen ugepuljer i denne måned."}</p>
        </div>
        <form class="form" id="money-fill-form">
          ${fields || `<p class="hint">Fjern Fast på en pulje under Redigér, så I kan udfylde den hver uge.</p>`}
          <button type="submit" class="btn btn-primary" ${fields ? "" : "disabled"}>Se hvordan det gik</button>
        </form>
      </section>
    `;
  }

  function renderResult(money) {
    const live = currentPeriod();
    const period = resultPeriod || viewedPeriod;
    const plan = planForView(money, period, live);
    const spend = spendBuckets(bucketsOf(plan));
    const allocations = plan?.allocations || money.allocations;
    const fill = fillFor(money, period);
    if (!fill) {
      return `
        <section class="stack money-view">
          <p class="hint">Ugen er ikke udfyldt endnu.</p>
          <button type="button" class="btn" id="money-open-fill">Fyld ugens puljer</button>
        </section>
      `;
    }
    const lastWeek = period.week === 4;
    const leftover = spend.reduce(
      (sum, bucket) => sum + Math.max(0, (allocations[bucket.id] || 0) - monthSpent(money, period, bucket.id)),
      0
    );
    const lines = spend
      .map((bucket) => {
        const used = Number(fill[bucket.id] || 0);
        const budget = weeklyOf(allocations[bucket.id]);
        const kind = tone(used, budget);
        const extra = kind === "ok" ? " · luft" : "";
        return `
        <li class="pot-result ${kind}">
          <strong>${escape(bucket.label)}</strong>
          <span>${diffLine(used, budget)}${extra}</span>
        </li>`;
      })
      .join("");
    return `
      <section class="stack money-view">
        <div>
          <p class="eyebrow">${escape(monthTitle(period.year, period.month))} ${period.year}</p>
          <h2>${weekLabel(period.year, period.month, period.week)}</h2>
        </div>
        <ul class="pot-results">${lines}</ul>
        <p class="hint">${
          lastWeek
            ? `Måneden er slut. De løse puljer har ${kr(leftover)} til gode — eller minus, hvis noget løb over.`
            : `De løse puljer har ${kr(leftover)} tilbage på ${4 - period.week} ${4 - period.week === 1 ? "uge" : "uger"}.`
        }</p>
        <button type="button" class="btn btn-primary" id="money-to-overview">Tilbage til puljerne</button>
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
      const live = currentPeriod();
      if (isSameMonth(viewedPeriod, live)) viewedPeriod = { ...live };
      view = "fill";
      hooks.render();
    });
    document.getElementById("money-prev-month")?.addEventListener("click", () => {
      viewedPeriod = shiftMonth(viewedPeriod.year, viewedPeriod.month, -1);
      view = "overview";
      hooks.render();
    });
    document.getElementById("money-next-month")?.addEventListener("click", () => {
      const live = currentPeriod();
      const next = shiftMonth(viewedPeriod.year, viewedPeriod.month, 1);
      if (next.year > live.year || (next.year === live.year && next.month > live.month)) return;
      viewedPeriod = isSameMonth(next, live) ? { ...live } : next;
      view = "overview";
      hooks.render();
    });
    document.getElementById("money-this-month")?.addEventListener("click", () => {
      viewedPeriod = { ...currentPeriod() };
      view = "overview";
      hooks.render();
    });
    document.querySelectorAll("[data-money-week]").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewedPeriod = { ...viewedPeriod, week: Number(btn.dataset.moneyWeek) };
        view = "fill";
        hooks.render();
      });
    });
    document.getElementById("money-to-overview")?.addEventListener("click", () => {
      view = "overview";
      hooks.render();
    });
    document.getElementById("money-save-setup")?.addEventListener("click", () => {
      if (!isReady(money)) return;
      persistCurrentMonth(money);
      viewedPeriod = { ...currentPeriod() };
      view = "overview";
      hooks.persist();
      hooks.render();
    });
    document.getElementById("money-suggest")?.addEventListener("click", () => {
      money.allocations = suggestAllocations(
        totalIncome(money),
        money.allocations,
        ensureLocked(money),
        ensureBuckets(money)
      );
      persistCurrentMonth(money);
      hooks.persist();
      hooks.render();
    });
    document.querySelectorAll("[data-lock-alloc]").forEach((input) => {
      input.addEventListener("change", () => {
        const bucket = ensureBuckets(money).find((item) => item.id === input.dataset.lockAlloc);
        if (!bucket) return;
        bucket.weekly = !input.checked;
        money.locked[bucket.id] = input.checked;
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
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
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-income-label]").forEach((input) => {
      input.addEventListener("change", () => {
        const row = money.incomes.find((item) => item.id === input.dataset.incomeLabel);
        if (row) row.label = input.value.trim() || "Indtægt";
        persistCurrentMonth(money);
        hooks.persist();
      });
    });
    document.querySelectorAll("[data-income-amount]").forEach((input) => {
      input.addEventListener("change", () => {
        const row = money.incomes.find((item) => item.id === input.dataset.incomeAmount);
        if (row) row.amount = parseKr(input.value);
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-alloc]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.alloc;
        money.allocations[key] = parseKr(input.value);
        keepFocus = `alloc:${key}`;
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-alloc-pct]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.allocPct;
        money.allocations[key] = amountFromPct(parsePct(input.value), totalIncome(money));
        keepFocus = `alloc-pct:${key}`;
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-bucket-label]").forEach((input) => {
      input.addEventListener("change", () => {
        const bucket = ensureBuckets(money).find((item) => item.id === input.dataset.bucketLabel);
        if (!bucket) return;
        bucket.label = input.value.trim() || "Pulje";
        keepFocus = `bucket-label:${bucket.id}`;
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
    });
    document.querySelectorAll("[data-remove-bucket]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const buckets = ensureBuckets(money);
        if (buckets.length < 2) return;
        const id = btn.dataset.removeBucket;
        money.buckets = buckets.filter((item) => item.id !== id);
        delete money.allocations[id];
        delete money.locked[id];
        persistCurrentMonth(money);
        hooks.persist();
        hooks.render();
      });
    });
    document.getElementById("money-add-bucket")?.addEventListener("click", () => addBucket(money));
    document.getElementById("money-fill-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const period = viewedPeriod;
      const next = {
        year: period.year,
        month: period.month,
        week: period.week
      };
      spendBuckets(bucketsOf(planForView(money, period, currentPeriod()))).forEach((bucket) => {
        next[bucket.id] = parseKr(data.get(bucket.id));
      });
      const existing = fillFor(money, period);
      if (existing) Object.assign(existing, next);
      else money.fills.push(next);
      persistCurrentMonth(money);
      resultPeriod = { ...period };
      view = "result";
      hooks.persist();
      hooks.render();
    });
    if (keepFocus === "income") {
      keepFocus = null;
      document.getElementById("money-income-label")?.focus();
    } else if (typeof keepFocus === "string" && keepFocus.startsWith("bucket-new:")) {
      const key = keepFocus.slice(11);
      keepFocus = null;
      const input = document.querySelector(`[data-bucket-label="${key}"]`);
      input?.focus();
      input?.select();
    } else if (typeof keepFocus === "string" && keepFocus.startsWith("bucket-label:")) {
      const key = keepFocus.slice(13);
      keepFocus = null;
      document.querySelector(`[data-bucket-label="${key}"]`)?.focus();
    } else if (typeof keepFocus === "string" && keepFocus.startsWith("alloc-pct:")) {
      const key = keepFocus.slice(10);
      keepFocus = null;
      document.querySelector(`[data-alloc-pct="${key}"]`)?.focus();
    } else if (typeof keepFocus === "string" && keepFocus.startsWith("alloc:")) {
      const key = keepFocus.slice(6);
      keepFocus = null;
      document.querySelector(`[data-alloc="${key}"]`)?.focus();
    }
  }

  function addBucket(money) {
    const buckets = ensureBuckets(money);
    const bucket = {
      id: uid(),
      label: "Ny pulje",
      weekly: true,
      weight: 10
    };
    buckets.push(bucket);
    money.allocations[bucket.id] = 0;
    money.locked[bucket.id] = false;
    persistCurrentMonth(money);
    keepFocus = `bucket-new:${bucket.id}`;
    hooks.persist();
    hooks.render();
  }

  function addIncome(money) {
    const label = document.getElementById("money-income-label")?.value.trim() || "Indtægt";
    const amount = parseKr(document.getElementById("money-income-amount")?.value);
    if (!amount && label === "Indtægt") return;
    money.incomes.push({ id: uid(), label, amount });
    persistCurrentMonth(money);
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
