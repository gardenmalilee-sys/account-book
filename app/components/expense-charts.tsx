"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CATEGORIES, Category, normalizeCategory } from "../../lib/categories";

type Expense = {
  id: number;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
};

const PIE_COLORS = ["#0071e3", "#34c759", "#ff9500", "#af52de", "#8e8e93"];

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${Number(year)}.${Number(month)}`;
}

export default function ExpenseCharts({ expenses }: { expenses: Expense[] }) {
  const monthlyMap = new Map<string, number>();
  const categoryMap = new Map<Category, number>();

  for (const item of expenses) {
    const month = item.date.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + item.amount);
    const category = normalizeCategory(item.category);
    categoryMap.set(category, (categoryMap.get(category) || 0) + item.amount);
  }

  const monthlyData = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, total]) => ({
      month: monthLabel(month),
      total,
    }));

  const categoryData = CATEGORIES.map((category) => ({
    name: category,
    value: categoryMap.get(category) || 0,
  })).filter((item) => item.value > 0);

  if (expenses.length === 0) {
    return (
      <section className="charts">
        <h2>지출 차트</h2>
        <p className="charts__empty">차트를 그릴 지출 데이터가 아직 없어요.</p>
      </section>
    );
  }

  return (
    <section className="charts" aria-label="지출 차트">
      <h2>지출 차트</h2>
      <div className="charts__grid">
        <div className="charts__panel">
          <h3>월별 총 지출</h3>
          <div className="charts__canvas">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ececef" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(value: number) =>
                    value >= 10000 ? `${Math.round(value / 10000)}만` : `${value}`
                  }
                />
                <Tooltip
                  formatter={(value) => [
                    `${Number(value).toLocaleString("ko-KR")}원`,
                    "합계",
                  ]}
                />
                <Bar dataKey="total" fill="#0071e3" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="charts__panel">
          <h3>카테고리별 지출</h3>
          <div className="charts__canvas">
            {categoryData.length === 0 ? (
              <p className="charts__empty">카테고리 데이터가 없어요.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={68}
                    paddingAngle={2}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      `${Number(value).toLocaleString("ko-KR")}원`
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <ul className="charts__legend">
            {categoryData.map((item, index) => (
              <li key={item.name}>
                <span
                  style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                {item.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
