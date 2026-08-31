const HjemmeMoney = (() => {
  let view = "overview";
  let viewedPeriod = currentPeriod();
  let resultPeriod = null;
  let statsBucketId = null;
  let statsMonths = 3;
  let statsChart = "curve";
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
    statsBucketId = null;
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

  function weeksBetween(from, until) {
    const out = [];
    let year = from.year;
    let month = from.month;
    while (year < until.year || (year === until.year && month < until.month)) {
      for (let week = 1; week <= 4; week += 1) out.push({ year, month, week });
      const next = shiftMonth(year, month, 1);
      year = next.year;
      month = next.month;
    }
    const lastWeek = until.week || 4;
    for (let week = 1; week <= lastWeek; week += 1) out.push({ year: until.year, month: until.month, week });
    return out;
  }

  function planAlloc(money, period, key) {
    const live = currentPeriod();
    const plan = planForView(money, period, live);
    return Number(plan?.allocations?.[key] || 0);
  }

  function bucketLabelAt(money, key, period) {
    const live = currentPeriod();
    const plan = planForView(money, period, live);
    const fromPlan = plan?.buckets?.find((bucket) => bucket.id === key);
    if (fromPlan) return fromPlan.label;
    const current = (money.buckets || []).find((bucket) => bucket.id === key);
    return current?.label || "Pulje";
  }

  function bucketById(money, key) {
    return ensureBuckets(money).find((bucket) => bucket.id === key) || null;
  }

  function startOfRange(live, months) {
    const shifted = shiftMonth(live.year, live.month, -(Math.max(1, months) - 1));
    return { year: shifted.year, month: shifted.month, week: 1 };
  }

  function weekHistory(money, key, months = statsMonths) {
    const live = currentPeriod();
    return weeksBetween(startOfRange(live, months), live).map((period) => {
      const fill = fillFor(money, period);
      const budget = weeklyOf(planAlloc(money, period, key));
      const used = fill ? Number(fill[key] || 0) : 0;
      return {
        ...period,
        filled: Boolean(fill),
        used,
        budget,
        note: String(fill?.notes?.[key] || "").trim(),
        title: `${weekLabel(period.year, period.month, period.week)}: ${fill ? kr(used) : "ikke udfyldt"}`
      };
    });
  }

  function monthHistory(money, key, months = statsMonths) {
    const live = currentPeriod();
    const start = startOfRange(live, months);
    const rows = [];
    let year = start.year;
    let month = start.month;
    while (year < live.year || (year === live.year && month <= live.month)) {
      const period = { year, month, week: 1 };
      const isLive = year === live.year && month === live.month;
      const plan = findMonthPlan(money, year, month);
      rows.push({
        year,
        month,
        amount: isLive ? Number(money.allocations?.[key] || 0) : Number(plan?.allocations?.[key] || 0),
        used: monthSpent(money, period, key),
        title: `${monthTitle(year, month)} ${year}`
      });
      const next = shiftMonth(year, month, 1);
      year = next.year;
      month = next.month;
    }
    return rows;
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
    if (view === "stats") return renderStats(money);
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
        const weekNote = thisMonth && fill ? String(fill.notes?.[key] || "").trim() : "";
        return `
        <button type="button" class="pot-card" data-pot-stats="${escape(key)}">
          <p class="eyebrow">${escape(bucket.label)}</p>
          ${
            thisMonth
              ? `<p class="pot-line">uge ${kr(weekUsed)} / ${kr(weekBudget)}</p>
          ${bar(weekUsed, weekBudget)}
          ${weekNote ? `<p class="pot-stat-note">${escape(weekNote)}</p>` : ""}`
              : ""
          }
          <p class="hint">måned ${kr(monthUsed)} / ${kr(monthBudget)}</p>
          ${bar(monthUsed, monthBudget)}
        </button>`;
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
                    `<button type="button" class="pot-aside" data-pot-stats="${escape(bucket.id)}"><span>${escape(bucket.label)}</span><strong>${kr(allocations[bucket.id])}</strong></button>`
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
        <label class="pot-fill-row">
          ${escape(bucket.label)}
          <small class="hint">uge ${kr(weeklyOf(allocations[bucket.id]))}</small>
          <span class="pot-fill-fields">
            <input name="${escape(bucket.id)}" inputmode="numeric" value="${fill[bucket.id] ?? ""}" placeholder="0" aria-label="Beløb">
            <input name="note-${escape(bucket.id)}" value="${escape(fill.notes?.[bucket.id] || "")}" placeholder="Kommentar" maxlength="80" aria-label="Kommentar">
          </span>
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
        const note = String(fill.notes?.[bucket.id] || "").trim();
        return `
        <li class="pot-result ${kind}">
          <strong>${escape(bucket.label)}</strong>
          <span>${diffLine(used, budget)}${extra}</span>
          ${note ? `<p class="pot-stat-note">${escape(note)}</p>` : ""}
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

  function curvePath(points) {
    if (!points.length) return "";
    const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);
    if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    if (points.length === 2) {
      d += ` L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
      return d;
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = Math.max(0, Math.min(100, p1.y + (p2.y - p0.y) / 6));
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = Math.max(0, Math.min(100, p2.y - (p3.y - p1.y) / 6));
      d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
    }
    return d;
  }

  function renderChart(rows, pick, avg = 0) {
    const values = rows.map(pick);
    const max = Math.max(...values, avg || 0, 1);
    const avgPct = avg > 0 ? Math.min(100, (avg / max) * 100) : 0;
    const cols = Math.max(rows.length, 1);
    const groups = [];
    for (const row of rows) {
      const key = `${row.year}-${row.month}`;
      const last = groups[groups.length - 1];
      if (!last || last.key !== key) groups.push({ key, year: row.year, month: row.month, count: 1 });
      else last.count += 1;
    }
    const grid = `repeat(${cols}, minmax(0, 1fr))`;
    const axis = `
      <div class="pot-chart-axis" style="grid-template-columns:${grid}">
        ${groups
          .map(
            (group) =>
              `<span style="grid-column:span ${group.count}">${escape(monthTitle(group.year, group.month).slice(0, 3))}</span>`
          )
          .join("")}
      </div>`;
    if (statsChart === "curve") {
      const points = rows
        .map((row, index) => {
          const used = pick(row);
          if (row.filled === false && used === 0) return null;
          const x = cols === 1 ? 50 : 3 + (index / (cols - 1)) * 94;
          const y = 6 + (1 - Math.min(1, used / max)) * 88;
          return { x, y, row, used };
        })
        .filter(Boolean);
      const line = curvePath(points);
      const area = points.length
        ? `${line} L ${points[points.length - 1].x.toFixed(2)} 100 L ${points[0].x.toFixed(2)} 100 Z`
        : "";
      const avgY = 6 + (1 - avgPct / 100) * 88;
      const dots = points
        .map((point) => {
          const week = point.row.week;
          const jump = week
            ? `data-pot-week="${point.row.year}-${point.row.month}-${week}"`
            : "";
          return `<button type="button" class="pot-curve-dot" ${jump} style="left:${point.x}%; bottom:${100 - point.y}%" title="${escape(point.row.title || kr(point.used))}"></button>`;
        })
        .join("");
      return `
        <div class="pot-chart-frame">
          <div class="pot-chart-plot">
            <svg class="pot-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              ${area ? `<path class="pot-curve-fill" d="${area}"></path>` : ""}
              ${line ? `<path class="pot-curve-stroke" d="${line}"></path>` : ""}
              ${avg > 0 ? `<line class="pot-curve-avg" x1="0" x2="100" y1="${avgY.toFixed(2)}" y2="${avgY.toFixed(2)}"></line>` : ""}
            </svg>
            ${dots}
          </div>
          ${axis}
        </div>`;
    }
    return `
      <div class="pot-chart-frame">
        <div class="pot-chart-plot">
          ${avg > 0 ? `<div class="pot-chart-line" style="bottom:${avgPct}%" title="Gennemsnit ${kr(avg)}"></div>` : ""}
          <div class="pot-chart" role="img" aria-label="Forbrug uge for uge" style="grid-template-columns:${grid}">
            ${rows
              .map((row) => {
                const used = pick(row);
                const budget = row.budget || row.amount || 0;
                const height = Math.max(used > 0 ? 8 : 0, Math.round((used / max) * 100));
                return `<div class="pot-chart-col ${row.filled === false ? "empty" : tone(used, budget)}" title="${escape(row.title || "")}">
                  <span style="height:${height}%"></span>
                </div>`;
              })
              .join("")}
          </div>
        </div>
        ${axis}
      </div>`;
  }

  function renderRangeToggle() {
    return `
      <div class="pot-range">
        <button type="button" class="tool ${statsMonths === 3 ? "on" : ""}" data-stats-months="3">3 måneder</button>
        <button type="button" class="tool ${statsMonths === 6 ? "on" : ""}" data-stats-months="6">6 måneder</button>
      </div>`;
  }

  function renderChartSwitch() {
    const bars = statsChart === "bars";
    return `
      <button type="button" class="pot-switch ${bars ? "on" : ""}" data-stats-chart-toggle aria-pressed="${bars ? "true" : "false"}">
        <span class="${bars ? "" : "is-on"}">Kurve</span>
        <span class="pot-switch-track" aria-hidden="true"><i></i></span>
        <span class="${bars ? "is-on" : ""}">Søjler</span>
      </button>`;
  }

  function renderAvgCard(avg, filledCount, budget, words) {
    if (!filledCount) {
      return `
        <div class="pot-avg">
          <p class="eyebrow">Gennemsnit</p>
          <h2>—</h2>
          <p class="hint">Udfyld ${words.many}, så vises et gennemsnit for perioden.</p>
        </div>`;
    }
    const vs = budget
      ? `${avg <= budget ? kr(budget - avg) + " under" : kr(avg - budget) + " over"} rammen i snit · ramme ${kr(budget)}`
      : "";
    return `
      <div class="pot-avg">
        <p class="eyebrow">Gennemsnit</p>
        <h2>${kr(avg)}</h2>
        <p class="hint">${words.per} · ${filledCount} ${filledCount === 1 ? words.one : words.many}</p>
        ${vs ? `<p class="hint ${avg > budget ? "warn" : ""}">${vs}</p>` : ""}
      </div>`;
  }

  function renderStats(money) {
    const bucket = bucketById(money, statsBucketId);
    if (!bucket) {
      return `
        <section class="stack money-view">
          <p class="hint">Puljen findes ikke længere.</p>
          <button type="button" class="btn" id="money-to-overview">Tilbage til puljerne</button>
        </section>
      `;
    }
    const live = currentPeriod();
    const label = bucketLabelAt(money, bucket.id, live);
    const rangeLabel = `${statsMonths} måneder`;
    if (bucket.weekly) {
      const weeks = weekHistory(money, bucket.id, statsMonths);
      const filled = weeks.filter((row) => row.filled);
      const total = filled.reduce((sum, row) => sum + row.used, 0);
      const avg = filled.length ? Math.round(total / filled.length) : 0;
      const weekBudget = weeklyOf(planAlloc(money, live, bucket.id));
      const groups = [];
      for (const row of [...weeks].reverse()) {
        const key = `${row.year}-${row.month}`;
        let group = groups.find((item) => item.key === key);
        if (!group) {
          group = { key, year: row.year, month: row.month, weeks: [] };
          groups.push(group);
        }
        group.weeks.push(row);
      }
      const list = groups
        .map(
          (group) => `
          <div class="pot-stat-month">
            <p class="eyebrow">${escape(monthTitle(group.year, group.month))} ${group.year}</p>
            <ul class="pot-stat-weeks">
              ${group.weeks
                .map(
                  (row) => `
                <li>
                  <button type="button" class="pot-stat-week" data-pot-week="${row.year}-${row.month}-${row.week}">
                    <span class="pot-stat-week-top">
                      <span>
                        <strong>${escape(weekLabel(row.year, row.month, row.week))}</strong>
                        <small class="hint">${row.filled ? diffLine(row.used, row.budget) : "Ikke udfyldt"}</small>
                      </span>
                      <strong>${row.filled ? kr(row.used) : "—"}</strong>
                    </span>
                    ${row.filled ? bar(row.used, row.budget) : ""}
                    ${row.note ? `<p class="pot-stat-note">${escape(row.note)}</p>` : ""}
                  </button>
                </li>`
                )
                .join("")}
            </ul>
          </div>`
        )
        .join("");
      return `
        <section class="stack money-view">
          <div>
            <p class="eyebrow">Uge for uge</p>
            <h2>${escape(label)}</h2>
          </div>
          ${renderRangeToggle()}
          ${renderAvgCard(avg, filled.length, weekBudget, { per: "pr. uge", one: "uge", many: "uger" })}
          ${weeks.length ? renderChart(weeks, (row) => row.used, avg) : ""}
          ${weeks.length ? renderChartSwitch() : ""}
          <p class="hint">${
            filled.length
              ? `${kr(total)} brugt på ${filled.length} udfyldte uger i de seneste ${rangeLabel}.`
              : `Ingen uger udfyldt i de seneste ${rangeLabel}.`
          }</p>
          ${list}
        </section>
      `;
    }
    const months = monthHistory(money, bucket.id, statsMonths).map((row) => ({
      ...row,
      filled: row.amount > 0 || row.used > 0,
      title: `${monthTitle(row.year, row.month)} ${row.year}: ${kr(row.amount)}`
    }));
    const withAmount = months.filter((row) => row.amount > 0);
    const avg = withAmount.length ? Math.round(withAmount.reduce((sum, row) => sum + row.amount, 0) / withAmount.length) : 0;
    const liveAmount = Number(money.allocations?.[bucket.id] || 0);
    return `
      <section class="stack money-view">
        <div>
          <p class="eyebrow">Måned for måned</p>
          <h2>${escape(label)}</h2>
          <p class="hint">Faste puljer sættes af for måneden og udfyldes ikke uge for uge.</p>
        </div>
        ${renderRangeToggle()}
        ${renderAvgCard(avg, withAmount.length, liveAmount, { per: "pr. måned", one: "måned", many: "måneder" })}
        ${months.length ? renderChart(months, (row) => row.amount, avg) : ""}
        ${months.length ? renderChartSwitch() : ""}
        <ul class="pot-stat-weeks">
          ${months
            .slice()
            .reverse()
            .map(
              (row) => `
            <li>
              <div class="pot-stat-week static">
                <span class="pot-stat-week-top">
                  <span>
                    <strong>${escape(monthTitle(row.year, row.month))} ${row.year}</strong>
                    <small class="hint">sat af</small>
                  </span>
                  <strong>${row.amount ? kr(row.amount) : "—"}</strong>
                </span>
              </div>
            </li>`
            )
            .join("")}
        </ul>
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
      statsBucketId = null;
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
      statsBucketId = null;
      hooks.render();
    });
    document.querySelectorAll("[data-stats-months]").forEach((btn) => {
      btn.addEventListener("click", () => {
        statsMonths = Number(btn.dataset.statsMonths) === 6 ? 6 : 3;
        view = "stats";
        hooks.render();
      });
    });
    document.querySelectorAll("[data-stats-chart-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        statsChart = statsChart === "bars" ? "curve" : "bars";
        view = "stats";
        hooks.render();
      });
    });
    document.querySelectorAll("[data-pot-stats]").forEach((btn) => {
      btn.addEventListener("click", () => {
        statsBucketId = btn.dataset.potStats;
        view = "stats";
        hooks.render();
      });
    });
    document.querySelectorAll("[data-pot-week]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [year, month, week] = btn.dataset.potWeek.split("-").map(Number);
        viewedPeriod = { year, month, week };
        view = "fill";
        hooks.render();
      });
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
      const notes = {};
      spendBuckets(bucketsOf(planForView(money, period, currentPeriod()))).forEach((bucket) => {
        next[bucket.id] = parseKr(data.get(bucket.id));
        const note = String(data.get(`note-${bucket.id}`) || "").trim().slice(0, 80);
        if (note) notes[bucket.id] = note;
      });
      next.notes = notes;
      const existing = fillFor(money, period);
      if (existing) {
        Object.assign(existing, next);
        existing.notes = notes;
      } else money.fills.push(next);
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
