import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface SurvivalGaugeProps {
  probability: number;
}

/**
 * 生存率環，位於固定墨色的報頭內。
 *
 * 公報世界只有紙與墨在工作，紅是印章。因此這個環平時是紙色，
 * 只有掉到危險區間才蓋上紅——顏色本身就是一次判讀，不是裝飾。
 */
/* 這個環位於報頭的漸層底之上，因此用固定的淺色，不跟隨主題。 */
const toneFor = (probability: number) => {
  if (probability >= 70) return { fill: '#a9dcbf', label: '偏高' };
  if (probability >= 40) return { fill: '#e0c3a4', label: '中等' };
  return { fill: '#f2b4bd', label: '偏低' };
};

const SurvivalGauge: React.FC<SurvivalGaugeProps> = ({ probability }) => {
  const tone = toneFor(probability);
  const data = [{ value: probability }, { value: 100 - probability }];
  const colors = [tone.fill, 'rgba(255,255,255,0.16)'];

  return (
    <div
      className="relative h-11 w-11"
      role="img"
      aria-label={`生存率 ${probability}%，${tone.label}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={14}
            outerRadius={20}
            startAngle={90}
            endAngle={-270}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colors[index]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <span className="font-data text-[10px] font-bold tabular-nums text-white">
          {probability}
        </span>
      </div>
    </div>
  );
};

export default SurvivalGauge;
