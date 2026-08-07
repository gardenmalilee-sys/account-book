"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

export default function AccountBook() {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadExpenses() {
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("id, created_at, date, amount, description")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setExpenses([]);
    } else {
      setExpenses(data ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount.replace(/,/g, ""));
    const trimmedDescription = description.trim();

    if (
      !date ||
      !trimmedDescription ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("expenses").insert({
      date,
      amount: parsedAmount,
      description: trimmedDescription,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setAmount("");
    setDescription("");
    setDate(today());
    setSaving(false);
    await loadExpenses();
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="account-book">
      <header className="account-book__header">
        <h1 className="account-book__title">나의 스마트 가계부</h1>
        <p className="account-book__subtitle">
          날짜, 금액, 내용을 기록해 지출을 정리하세요.
        </p>
      </header>

      <form className="account-book__form" onSubmit={handleSubmit}>
        <div className="account-book__fields">
          <label className="account-book__field">
            <span>날짜</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>

          <label className="account-book__field">
            <span>금액</span>
            <input
              className="account-book__amount-input"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>

          <label className="account-book__field account-book__field--wide">
            <span>내용</span>
            <input
              type="text"
              placeholder="예: 점심 식사"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
        </div>

        <button type="submit" className="account-book__submit" disabled={saving}>
          {saving ? "저장 중..." : "저장하기"}
        </button>
      </form>

      {error ? <p className="account-book__error">{error}</p> : null}

      <section className="account-book__list" aria-live="polite">
        <div className="account-book__list-head">
          <div>
            <p className="account-book__list-label">합계</p>
            <p className="account-book__total">
              <span className="account-book__total-value">{formatAmount(total)}</span>
              <span className="account-book__total-unit">원</span>
            </p>
          </div>
          <h2 className="account-book__list-title">지출 내역</h2>
        </div>

        {loading ? (
          <p className="account-book__empty">불러오는 중...</p>
        ) : expenses.length === 0 ? (
          <p className="account-book__empty">아직 저장된 지출이 없습니다.</p>
        ) : (
          <ul className="account-book__cards">
            {expenses.map((item) => (
              <li key={item.id} className="account-book__card">
                <div className="account-book__card-meta">
                  <p className="account-book__item-content">{item.description}</p>
                  <time dateTime={item.date}>{item.date}</time>
                </div>
                <p className="account-book__item-amount">
                  <span className="account-book__item-amount-value">
                    -{formatAmount(item.amount)}
                  </span>
                  <span className="account-book__item-amount-unit">원</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
