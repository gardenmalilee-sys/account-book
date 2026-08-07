"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CATEGORIES, Category, normalizeCategory } from "../../lib/categories";
import { supabase } from "../../lib/supabase";
import BudgetPanel from "./budget-panel";
import ExpenseCharts from "./expense-charts";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const SpeechRecognitionCtor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;
  return new SpeechRecognitionCtor();
}

export default function AccountBookChat() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! 말하거나 영수증을 올려도 돼요.\n예: 오늘 점심 12,000원 / 이번 달 총 지출이 얼마야?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<Category | "전체">("전체");
  const [error, setError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const filteredExpenses = useMemo(() => {
    if (categoryFilter === "전체") return expenses;
    return expenses.filter(
      (item) => normalizeCategory(item.category) === categoryFilter,
    );
  }, [expenses, categoryFilter]);

  async function loadExpenses() {
    const withCategory = await supabase
      .from("expenses")
      .select("id, created_at, date, amount, description, category")
      .order("created_at", { ascending: false });

    if (!withCategory.error) {
      setExpenses(withCategory.data ?? []);
      setError(null);
      setLoadingExpenses(false);
      return;
    }

    const fallback = await supabase
      .from("expenses")
      .select("id, created_at, date, amount, description")
      .order("created_at", { ascending: false });

    if (fallback.error) {
      setError(fallback.error.message);
      setExpenses([]);
    } else {
      setExpenses(fallback.data ?? []);
    }
    setLoadingExpenses(false);
  }

  useEffect(() => {
    void loadExpenses();
    setSpeechSupported(Boolean(createRecognition()));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  async function requestChat(text: string) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
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
      };

      if (!response.ok || data.error) {
        throw new Error(
          data.error || "AI 서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
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
        setExpenses((prev) => [
          data.expense as Expense,
          ...prev.filter((item) => item.id !== data.expense!.id),
        ]);
      } else {
        await loadExpenses();
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

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    await requestChat(text);
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

  function toggleListening() {
    if (sending) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = createRecognition();
    if (!recognition) {
      setError("이 브라우저는 음성 인식을 지원하지 않아요.");
      return;
    }

    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput(transcript);
        void requestChat(transcript);
      }
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error !== "aborted") {
        setError("음성 인식에 실패했어요. 다시 시도해 주세요.");
      }
    };
    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function handleReceiptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || sending) return;

    setSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: `영수증 사진 업로드: ${file.name}`,
      },
    ]);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type || "image/jpeg",
        }),
      });

      const data = (await response.json()) as {
        reply?: string;
        expense?: Expense | null;
        error?: string;
      };

      if (!response.ok || data.error) {
        throw new Error(data.error || "영수증 인식에 실패했어요.");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply || "영수증을 저장했어요!",
        },
      ]);

      if (data.expense) {
        setExpenses((prev) => [
          data.expense as Expense,
          ...prev.filter((item) => item.id !== data.expense!.id),
        ]);
      } else {
        await loadExpenses();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "영수증 업로드에 실패했습니다.";
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

  return (
    <div className="chat">
      <header className="chat__header">
        <h1 className="chat__title">AI 가계부 챗봇</h1>
      </header>

      <div className="chat__scroll">
        <BudgetPanel expenses={expenses} />
        <ExpenseCharts expenses={expenses} />

        <section className="chat__expenses" aria-label="저장된 지출 내역">
          <div className="chat__expenses-head">
            <h2>저장된 지출</h2>
            {!loadingExpenses && expenses.length > 0 ? (
              <p>
                {filteredExpenses.length}건 ·{" "}
                <span className="chat__expenses-total">
                  {formatAmount(
                    filteredExpenses.reduce((sum, item) => sum + item.amount, 0),
                  )}
                  원
                </span>
              </p>
            ) : null}
          </div>

          <div className="chat__filters" role="tablist" aria-label="카테고리 필터">
            <button
              type="button"
              className={categoryFilter === "전체" ? "is-active" : undefined}
              onClick={() => setCategoryFilter("전체")}
            >
              전체
            </button>
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={categoryFilter === category ? "is-active" : undefined}
                onClick={() => setCategoryFilter(category)}
              >
                {category}
              </button>
            ))}
          </div>

          {loadingExpenses ? (
            <p className="chat__expenses-empty">불러오는 중...</p>
          ) : filteredExpenses.length === 0 ? (
            <p className="chat__expenses-empty">표시할 지출이 없습니다.</p>
          ) : (
            <ul className="chat__expense-list">
              {filteredExpenses.map((item) => (
                <li key={item.id} className="chat__expense-card">
                  <div>
                    <p className="chat__expense-desc">{item.description}</p>
                    <p className="chat__expense-meta">
                      <time dateTime={item.date}>{item.date}</time>
                      <span>{normalizeCategory(item.category)}</span>
                    </p>
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
      </div>

      {error ? <p className="chat__error">{error}</p> : null}

      <form className="chat__composer" onSubmit={handleSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="chat__file-input"
          onChange={handleReceiptUpload}
        />

        <div className="chat__tools">
          <button
            type="button"
            className={`chat__icon-btn${listening ? " is-listening" : ""}`}
            onClick={toggleListening}
            disabled={sending || !speechSupported}
            aria-label={listening ? "음성 인식 중지" : "음성 인식"}
            title={
              speechSupported
                ? listening
                  ? "음성 인식 중지"
                  : "음성으로 입력"
                : "이 브라우저는 음성 인식을 지원하지 않아요"
            }
          >
            {listening ? "중지" : "음성"}
          </button>
          <button
            type="button"
            className="chat__icon-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            aria-label="영수증 사진 업로드"
            title="영수증 사진 업로드"
          >
            사진
          </button>
        </div>

        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={listening ? "듣고 있어요..." : "메시지 또는 질문 입력"}
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
