"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../../lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

export default function AccountBookChat() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! 지출을 말하거나 통계를 물어보세요.\n예: 오늘 점심 12,000원 / 이번 달 총 지출이 얼마야?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  async function loadExpenses() {
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

    setLoadingExpenses(false);
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: nextMessages
            .slice(0, -1)
            .filter((item) => item.id !== "welcome")
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = (await response.json()) as {
        reply?: string;
        expense?: Expense | null;
        error?: string;
        status?: string;
      };

      if (!response.ok || data.error) {
        throw new Error(
          data.error ||
            "AI 서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            data.reply ||
            "메시지를 이해하지 못했어요. 날짜와 금액을 다시 알려 주세요.",
        },
      ]);

      if (data.expense) {
        setExpenses((prev) => [data.expense as Expense, ...prev.filter((e) => e.id !== data.expense!.id)]);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "메시지 전송에 실패했습니다.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="chat">
      <header className="chat__header">
        <h1 className="chat__title">AI 가계부 챗봇</h1>
      </header>

      <section className="chat__expenses" aria-label="저장된 지출 내역">
        <div className="chat__expenses-head">
          <h2>저장된 지출</h2>
          {!loadingExpenses && expenses.length > 0 ? (
            <p>
              {expenses.length}건 ·{" "}
              <span className="chat__expenses-total">
                {formatAmount(expenses.reduce((sum, item) => sum + item.amount, 0))}원
              </span>
            </p>
          ) : null}
        </div>

        {loadingExpenses ? (
          <p className="chat__expenses-empty">불러오는 중...</p>
        ) : expenses.length === 0 ? (
          <p className="chat__expenses-empty">아직 저장된 지출이 없습니다.</p>
        ) : (
          <ul className="chat__expense-list">
            {expenses.map((item) => (
              <li key={item.id} className="chat__expense-card">
                <div>
                  <p className="chat__expense-desc">{item.description}</p>
                  <time dateTime={item.date}>{item.date}</time>
                </div>
                <p className="chat__expense-amount">
                  <span>-{formatAmount(item.amount)}</span>원
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="chat__messages" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat__row chat__row--${message.role}`}
          >
            {message.role === "assistant" ? (
              <span className="chat__avatar" aria-hidden>
                AI
              </span>
            ) : null}
            <div className={`chat__bubble chat__bubble--${message.role}`}>
              {message.content}
            </div>
          </div>
        ))}

        {sending ? (
          <div className="chat__row chat__row--assistant">
            <span className="chat__avatar" aria-hidden>
              AI
            </span>
            <div className="chat__bubble chat__bubble--assistant chat__bubble--typing">
              입력 중...
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </section>

      {error ? <p className="chat__error">{error}</p> : null}

      <form className="chat__composer" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="지출 입력 또는 질문 예: 이번 달 얼마 썼어?"
          rows={1}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
