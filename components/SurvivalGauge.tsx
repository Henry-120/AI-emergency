
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface SurvivalGaugeProps {
  probability: number;
}

const SurvivalGauge: React.FC<SurvivalGaugeProps> = ({ probability }) => {
  const data = [
    { value: probability },
    { value: 100 - probability },
  ];

  const COLORS = ['#fbbf24', 'rgba(255,255,255,0.05)'];

  return (
    <div className="relative w-12 h-12">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={15}
            outerRadius={22}
            startAngle={90}
            endAngle={-270}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold text-amber-500">{probability}%</span>
      </div>
    </div>
  );
};

export default SurvivalGauge;
