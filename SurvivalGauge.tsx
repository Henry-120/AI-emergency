import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface SurvivalGaugeProps {
  probability: number;
}

// Color tracks the value, not decoration: low survival reads critical, not amber-pretty.
const colorFor = (p: number) => {
  if (p < 40) return 'var(--critical)';
  if (p < 70) return 'var(--high)';
  return 'var(--safe)';
};

const SurvivalGauge: React.FC<SurvivalGaugeProps> = ({ probability }) => {
  const clamped = Math.max(0, Math.min(100, probability));
  const data = [{ value: clamped }, { value: 100 - clamped }];
  const fill = colorFor(clamped);

  return (
    <div
      className="relative h-11 w-11"
      role="img"
      aria-label={`生存評估 ${clamped}%`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={15}
            outerRadius={21}
            startAngle={90}
            endAngle={-270}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={fill} />
            <Cell fill="rgba(148,163,184,0.3)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-data text-[10px] font-bold">{clamped}</span>
      </div>
    </div>
  );
};

export default SurvivalGauge;
