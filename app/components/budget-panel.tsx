"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "ai-account-book-monthly-budget";

type Expense = {
  date: string;
  amount: number;
};

function currentMonthKey() {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const year = kst.getFullYear();
  const month = String(kst.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

export default function BudgetPanel({ expenses }: { expenses: Expense[] }) {
  const monthKey = currentMonthKey();
  const [budget, setBudget] = useState(0);
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { month?: string; amount?: number };
        if (parsed.month === monthKey && typeof parsed.amount === "number") {
          setBudget(parsed.amount);
          setDraft(String(parsed.amount));
        }
      }
    } catch {
      // ignore
    }
    setReady(true);
  }, [monthKey]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ month: monthKey, amount: budget }),
    );
  }, [budget, monthKey, ready]);

  const spent = useMemo(
    () =>
      expenses
        .filter((item) => item.date.startsWith(monthKey))
        .reduce((sum, item) => sum + item.amount, 0),
    [expenses, monthKey],
  );

  const ratio = budget > 0 ? Math.min((spent / budget) * 100, 999) : 0;
  const warning =
    budget > 0 && ratio >= 80
      ? ratio >= 100
        ? "이번 달 예산을 초과했어요!"
        : "이번 달 예산을 80% 이상 사용했어요."
      : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 0) return;
    setBudget(Math.round(value));
  }

  return (
    <section className="budget" aria-label="월 예산">
      <div className="budget__head">
        <h2>이번 달 예산</h2>
        <p>
          {formatAmount(spent)} / {budget > 0 ? `${formatAmount(budget)}원` : "미설정"}
        </p>
      </div>

      <form className="budget__form" onSubmit={handleSubmit}>
        <input
          type="number"
          min="0"
          step="1000"
          placeholder="예산 금액"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">저장</button>
      </form>

      <div className="budget__meter" aria-hidden={budget <= 0}>
        <div
          className={`budget__meter-fill${ratio >= 80 ? " budget__meter-fill--warn" : ""}`}
          style={{ width: `${Math.min(ratio, 100)}%` }}
        />
      </div>

      {budget > 0 ? (
        <p className="budget__ratio">{Math.round(ratio)}% 사용</p>
      ) : (
        <p className="budget__ratio">예산을 설정하면 사용 비율을 보여 드려요.</p>
      )}

      {warning ? <p className="budget__warn">{warning}</p> : null}
    </section>
  );
}
