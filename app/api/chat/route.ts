import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ExpenseRow = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

type ExpensePayload = {
  date: string;
  amount: number;
  description: string;
};

type GeminiExpenseResult = {
  status: "saved" | "need_clarification" | "chat";
  reply: string;
  expense: ExpensePayload | null;
};

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
].filter((model): model is string => Boolean(model));

const QUESTION_PATTERN =
  /(얼마|뭐|무엇|어떻|언제|어디|왜|어떤|몇\s*번|가장|제일|총|합계|통계|분석|알려|보여|정리|비교|랭킹|\?|까요|가요|니\b|냐\b|야\?|써\?|했어\?|샀|썼어|나갔어)/;

const AMOUNT_PATTERN =
  /(\d{1,3}(,\d{3})+|\d+)\s*원|\d+\s*만\s*원|[일이삼사오육칠팔구십백천만억]+\s*만\s*원/;

function kstDate(offsetDays = 0) {
  const now = new Date();
  const kst = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );
  kst.setDate(kst.getDate() + offsetDays);
  const year = kst.getFullYear();
  const month = String(kst.getMonth() + 1).padStart(2, "0");
  const day = String(kst.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatKoreanDate(isoDate: string) {
  const [, month, day] = isoDate.split("-").map(Number);
  if (!month || !day) return isoDate;
  return `${month}월 ${day}일`;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function classifyIntent(message: string): "expense" | "question" {
  const hasAmount = AMOUNT_PATTERN.test(message);
  const hasQuestion = QUESTION_PATTERN.test(message);

  // 금액이 있으면 기본적으로 지출 입력
  if (hasAmount && !hasQuestion) return "expense";
  // 의문/통계 표현이면 질문
  if (hasQuestion && !hasAmount) return "question";
  // 둘 다 있으면: 질문 톤이 강하면 질문, 아니면 지출
  if (hasQuestion && hasAmount) {
    if (
      /(얼마|가장|제일|총|합계|통계|분석|뭐\s*샀|어떻게|얼마나)/.test(message)
    ) {
      return "question";
    }
    return "expense";
  }
  // 금액도 질문도 아니면 지출 입력 시도(부족하면 되묻기)
  return "expense";
}

function historyText(history: ChatMessage[]) {
  if (history.length === 0) return "(없음)";
  return history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "사용자" : "AI"}: ${item.content}`)
    .join("\n");
}

function buildExpensePrompt(message: string, history: ChatMessage[]) {
  const today = kstDate(0);
  const yesterday = kstDate(-1);

  return `당신은 한국어 AI 가계부 챗봇입니다.
사용자 메시지에서 지출 정보(날짜, 금액, 내용)를 추출하세요.

기준 날짜:
- 오늘 = ${today}
- 어제 = ${yesterday}
- "오늘"이면 ${today}, "어제"이면 ${yesterday}
- 날짜 표현이 없으면 오늘(${today})을 사용

규칙:
1. 날짜와 금액을 모두 파악할 수 있으면 status="saved", expense에 JSON을 채우세요.
2. 날짜 또는 금액을 알 수 없으면 status="need_clarification", expense=null, reply로 다시 물어보세요.
3. 지출과 무관한 일반 대화면 status="chat", expense=null.
4. description은 짧은 명사 중심으로 (예: 택시, 점심, 커피).
5. amount는 정수(원). "2만 원" → 20000.
6. reply는 친근한 한국어. 저장 성공 예: "8월 7일 택시 20,000원을 저장했어요!"

반드시 JSON만 출력:
{"status":"saved"|"need_clarification"|"chat","reply":"문자열","expense":null|{"date":"YYYY-MM-DD","amount":숫자,"description":"내용"}}

이전 대화:
${historyText(history)}

사용자 메시지:
${message}`;
}

function buildQuestionPrompt(
  message: string,
  history: ChatMessage[],
  expenses: ExpenseRow[],
) {
  const today = kstDate(0);
  const yesterday = kstDate(-1);
  const weekAgo = kstDate(-7);
  const monthPrefix = today.slice(0, 7);

  const expenseJson = JSON.stringify(
    expenses.map((item) => ({
      date: item.date,
      amount: item.amount,
      description: item.description,
    })),
  );

  return `당신은 친절한 한국어 가계부 분석 챗봇입니다.
아래 지출 데이터를 바탕으로 사용자 질문에 답하세요.

기준 날짜:
- 오늘 = ${today}
- 어제 = ${yesterday}
- 이번 달 = ${monthPrefix}
- 지난주 대략 = ${weekAgo} ~ ${today}

규칙:
- 제공된 데이터만 사용하세요. 없는 정보는 추측하지 마세요.
- 금액은 천 단위 쉼표로 표기 (예: 20,000원).
- 답변은 자연스럽고 친근한 한국어로, 2~4문장 이내로.
- 데이터가 비어 있거나 해당 기간/항목이 없으면 솔직히 알려주세요.
- 필요하면 간단한 근거(건수, 합계, 대표 항목)를 포함하세요.

반드시 JSON만 출력:
{"reply":"답변 문자열"}

지출 데이터(JSON 배열):
${expenseJson}

이전 대화:
${historyText(history)}

사용자 질문:
${message}`;
}

function parseExpenseResult(text: string): GeminiExpenseResult {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<GeminiExpenseResult>;
  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "";

  if (!reply) {
    throw new Error("Gemini 응답 형식이 올바르지 않습니다.");
  }

  const status =
    parsed.status === "saved" ||
    parsed.status === "need_clarification" ||
    parsed.status === "chat"
      ? parsed.status
      : parsed.expense
        ? "saved"
        : "chat";

  if (!parsed.expense) {
    return {
      status: status === "saved" ? "need_clarification" : status,
      reply,
      expense: null,
    };
  }

  const amount = Number(parsed.expense.amount);
  const date = String(parsed.expense.date || "").trim();
  const description = String(parsed.expense.description || "").trim();

  if (!date || !description || !Number.isFinite(amount) || amount <= 0) {
    return {
      status: "need_clarification",
      reply:
        reply ||
        "날짜나 금액을 정확히 파악하지 못했어요. 예: 오늘 점심 15,000원",
      expense: null,
    };
  }

  return {
    status: "saved",
    reply,
    expense: {
      date,
      amount: Math.round(amount),
      description,
    },
  };
}

function parseReplyOnly(text: string) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as { reply?: string };
  if (!parsed.reply?.trim()) {
    throw new Error("Gemini 응답 형식이 올바르지 않습니다.");
  }
  return parsed.reply.trim();
}

function friendlyApiError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);

  if (
    /429|quota|rate.?limit|Too Many Requests|Resource exhausted|limit:\s*0/i.test(
      raw,
    )
  ) {
    return "Gemini API 사용량 한도에 도달했어요. 잠시 후 다시 시도하거나 Google AI Studio에서 할당량을 확인해 주세요.";
  }
  if (/API[_ ]?key|PERMISSION|401|403|invalid.*key/i.test(raw)) {
    return "Gemini API 키를 확인해 주세요. .env.local의 GEMINI_API_KEY가 유효한지 확인이 필요해요.";
  }
  if (/404|not found|is not found/i.test(raw)) {
    return "사용할 수 있는 Gemini 모델을 찾지 못했어요. API 키 권한과 모델 접근을 확인해 주세요.";
  }
  if (/fetch failed|network|ECONN/i.test(raw)) {
    return "네트워크 오류로 Gemini에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  return "AI 응답 처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.";
}

function errorPriority(message: string) {
  if (/429|quota|Too Many Requests|Resource exhausted/i.test(message)) return 3;
  if (/API[_ ]?key|401|403/i.test(message)) return 2;
  if (/404|not found/i.test(message)) return 1;
  return 0;
}

async function generateWithFallback(apiKey: string, prompt: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const errors: Error[] = [];

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Gemini 호출에 실패했습니다.");
      errors.push(err);
      console.error(`[chat] model ${modelName} failed:`, err.message);
    }
  }

  errors.sort((a, b) => errorPriority(b.message) - errorPriority(a.message));
  throw errors[0] ?? new Error("Gemini 호출에 실패했습니다.");
}

async function fetchAllExpenses() {
  const { data, error } = await supabase
    .from("expenses")
    .select("id, created_at, date, amount, description")
    .order("date", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ExpenseRow[];
}

async function handleQuestion(
  apiKey: string,
  message: string,
  history: ChatMessage[],
) {
  let expenses: ExpenseRow[];
  try {
    expenses = await fetchAllExpenses();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({
      reply: `지출 데이터를 불러오지 못했어요: ${detail}`,
      expense: null,
      status: "question",
    });
  }

  let text: string;
  try {
    text = await generateWithFallback(
      apiKey,
      buildQuestionPrompt(message, history, expenses),
    );
  } catch (error) {
    return NextResponse.json(
      { error: friendlyApiError(error) },
      { status: 502 },
    );
  }

  try {
    const reply = parseReplyOnly(text);
    return NextResponse.json({
      reply,
      expense: null,
      status: "question",
    });
  } catch {
    return NextResponse.json({
      reply:
        expenses.length === 0
          ? "아직 저장된 지출이 없어서 통계를 낼 수 없어요. 먼저 지출을 알려 주세요!"
          : "질문을 이해했지만 답을 정리하지 못했어요. 조금 다르게 다시 물어봐 주시겠어요?",
      expense: null,
      status: "question",
    });
  }
}

async function handleExpense(
  apiKey: string,
  message: string,
  history: ChatMessage[],
) {
  let text: string;
  try {
    text = await generateWithFallback(
      apiKey,
      buildExpensePrompt(message, history),
    );
  } catch (error) {
    return NextResponse.json(
      { error: friendlyApiError(error) },
      { status: 502 },
    );
  }

  let parsed: GeminiExpenseResult;
  try {
    parsed = parseExpenseResult(text);
  } catch {
    return NextResponse.json({
      reply:
        "메시지를 이해하지 못했어요. 날짜와 금액을 포함해서 다시 말씀해 주세요. 예: 어제 택시 20,000원",
      expense: null,
      status: "need_clarification",
    });
  }

  if (parsed.status !== "saved" || !parsed.expense) {
    return NextResponse.json({
      reply: parsed.reply,
      expense: null,
      status: parsed.status,
    });
  }

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      date: parsed.expense.date,
      amount: parsed.expense.amount,
      description: parsed.expense.description,
    })
    .select("id, created_at, date, amount, description")
    .single();

  if (error) {
    return NextResponse.json({
      reply: `지출은 이해했지만 저장에 실패했어요: ${error.message}`,
      expense: null,
      status: "chat",
    });
  }

  const confirmation =
    parsed.reply ||
    `${formatKoreanDate(parsed.expense.date)} ${parsed.expense.description} ${formatAmount(parsed.expense.amount)}원을 저장했어요!`;

  return NextResponse.json({
    reply: confirmation,
    expense: data,
    status: "saved",
  });
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인해 주세요.",
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      message?: string;
      history?: ChatMessage[];
    };

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json(
        { error: "메시지를 입력해 주세요." },
        { status: 400 },
      );
    }

    const history = Array.isArray(body.history) ? body.history : [];
    const intent = classifyIntent(message);

    if (intent === "question") {
      return handleQuestion(apiKey, message, history);
    }

    return handleExpense(apiKey, message, history);
  } catch (error) {
    return NextResponse.json(
      { error: friendlyApiError(error) },
      { status: 500 },
    );
  }
}
