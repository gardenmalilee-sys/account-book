import { NextRequest, NextResponse } from "next/server";
import { normalizeCategory } from "../../../lib/categories";
import {
  formatAmount,
  formatKoreanDate,
  friendlyApiError,
  generateJsonWithFallback,
  kstDate,
  parseJsonText,
} from "../../../lib/gemini";
import { supabase } from "../../../lib/supabase";

type ReceiptResult = {
  date: string;
  amount: number;
  description: string;
  category: string;
  reply: string;
};

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      imageBase64?: string;
      mimeType?: string;
    };

    const imageBase64 = body.imageBase64?.replace(/^data:[^;]+;base64,/, "");
    const mimeType = body.mimeType || "image/jpeg";

    if (!imageBase64) {
      return NextResponse.json(
        { error: "영수증 이미지가 필요합니다." },
        { status: 400 },
      );
    }

    const today = kstDate(0);
    const prompt = `이 이미지는 영수증입니다. 총 결제 금액, 날짜, 가게 이름을 추출하세요.
오늘 날짜는 ${today}입니다. 날짜를 못 읽으면 오늘을 사용하세요.
카테고리는 다음 중 하나만 고르세요: 식비, 교통, 쇼핑, 문화, 기타
description에는 가게 이름 또는 대표 품목을 짧게 넣으세요.
금액은 정수(원)입니다.

반드시 JSON만 출력:
{"date":"YYYY-MM-DD","amount":숫자,"description":"가게/내용","category":"식비|교통|쇼핑|문화|기타","reply":"친근한 한국어 확인 문장"}`;

    let text: string;
    try {
      text = await generateJsonWithFallback(apiKey, [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ]);
    } catch (error) {
      return NextResponse.json(
        { error: friendlyApiError(error) },
        { status: 502 },
      );
    }

    let parsed: ReceiptResult;
    try {
      parsed = JSON.parse(parseJsonText(text)) as ReceiptResult;
    } catch {
      return NextResponse.json(
        { error: "영수증에서 정보를 읽지 못했어요. 더 선명한 사진으로 다시 시도해 주세요." },
        { status: 422 },
      );
    }

    const amount = Number(parsed.amount);
    const date = String(parsed.date || today).trim();
    const description = String(parsed.description || "영수증").trim();
    const category = normalizeCategory(parsed.category);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "영수증에서 금액을 확인하지 못했어요." },
        { status: 422 },
      );
    }

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        date,
        amount: Math.round(amount),
        description,
        category,
      })
      .select("id, created_at, date, amount, description, category")
      .single();

    if (error) {
      // category 컬럼이 아직 없을 수 있음
      const fallback = await supabase
        .from("expenses")
        .insert({
          date,
          amount: Math.round(amount),
          description,
        })
        .select("id, created_at, date, amount, description")
        .single();

      if (fallback.error) {
        return NextResponse.json(
          { error: `저장 실패: ${fallback.error.message}` },
          { status: 500 },
        );
      }

      return NextResponse.json({
        reply:
          parsed.reply ||
          `${formatKoreanDate(date)} ${description} ${formatAmount(amount)}원을 저장했어요!`,
        expense: { ...fallback.data, category },
        status: "saved",
      });
    }

    return NextResponse.json({
      reply:
        parsed.reply ||
        `${formatKoreanDate(date)} ${description} ${formatAmount(amount)}원(${category})을 저장했어요!`,
      expense: data,
      status: "saved",
    });
  } catch (error) {
    return NextResponse.json(
      { error: friendlyApiError(error) },
      { status: 500 },
    );
  }
}
