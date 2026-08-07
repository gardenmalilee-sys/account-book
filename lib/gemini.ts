import { GoogleGenerativeAI, Part } from "@google/generative-ai";

export const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
].filter((model): model is string => Boolean(model));

function errorPriority(message: string) {
  if (/429|quota|Too Many Requests|Resource exhausted/i.test(message)) return 3;
  if (/API[_ ]?key|401|403/i.test(message)) return 2;
  if (/404|not found/i.test(message)) return 1;
  return 0;
}

export function friendlyApiError(error: unknown) {
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

export function parseJsonText(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export async function generateJsonWithFallback(
  apiKey: string,
  contents: string | Part[],
  temperature = 0.3,
) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const errors: Error[] = [];

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
        },
      });
      const result = await model.generateContent(contents);
      return result.response.text();
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Gemini 호출에 실패했습니다.");
      errors.push(err);
      console.error(`[gemini] model ${modelName} failed:`, err.message);
    }
  }

  errors.sort((a, b) => errorPriority(b.message) - errorPriority(a.message));
  throw errors[0] ?? new Error("Gemini 호출에 실패했습니다.");
}

export function kstDate(offsetDays = 0) {
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

export function formatKoreanDate(isoDate: string) {
  const [, month, day] = isoDate.split("-").map(Number);
  if (!month || !day) return isoDate;
  return `${month}월 ${day}일`;
}

export function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}
