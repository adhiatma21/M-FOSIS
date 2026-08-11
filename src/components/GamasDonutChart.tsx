import React, { useMemo } from 'react';

interface GamasDonutChartProps {
  data: Array<{
    sto: string;
    total: number;
    open: number;
    progress: number;
    closed: number;
    temporer: number;
  }>;
  isLoading?: boolean;
}

export default function GamasDonutChart({ data, isLoading }: GamasDonutChartProps) {
  // 1. Filter and sort by total descending
  const chartData = useMemo(() => {
    return data
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [data]);

  // 2. Sum of all gamas
  const totalGamas = useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.total, 0);
  }, [chartData]);

  // STO palette colors
  const getStoColor = (name: string, index: number) => {
    const colors = [
      '#EF4444', // Slate Red
      '#F59E0B', // Amber
      '#10B981', // Emerald
      '#3B82F6', // Blue
      '#8B5CF6', // Purple
      '#EC4899', // Pink
      '#06B6D4', // Cyan
      '#14B8A6', // Teal
      '#F97316', // Orange
      '#6366F1', // Indigo
    ];
    return colors[index % colors.length];
  };

  const radius = 55;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius; // 345.575

  // 3. Compute arc lines for rendering
  const segments = useMemo(() => {
    let accumulatedTotal = 0;
    return chartData.map((item, index) => {
      const percentage = totalGamas > 0 ? (item.total / totalGamas) : 0;
      const strokeLength = percentage * circumference;
      const strokeOffset = circumference - (accumulatedTotal / totalGamas) * circumference;
      
      accumulatedTotal += item.total;
      
      return {
        name: item.sto,
        total: item.total,
        percentage: (percentage * 100).toFixed(1),
        color: getStoColor(item.sto, index),
        strokeLength,
        strokeOffset,
      };
    });
  }, [chartData, totalGamas, circumference]);

  if (isLoading) {
    return (
      <div className="bg-slate-50 border border-slate-200/50 p-5 rounded-xl flex flex-col items-center justify-center h-[280px] animate-pulse">
        <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-red-650 animate-spin bg-transparent mb-3" style={{ borderTopColor: '#DC2626' }}></div>
        <p className="text-xs text-slate-500 font-mono tracking-wider">Memuat visualisasi diagram STO...</p>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200/50 p-5 rounded-xl text-center flex flex-col justify-center items-center h-[280px] text-slate-400 text-xs font-mono">
        Belum ada data visualisasi untuk STO.
      </div>
    );
  }

  return (
    <div className="space-y-5 flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
            PROPORSI DISTRIBUSI PER-STO
          </h3>
          <p className="text-[10px] text-slate-500 font-medium font-sans uppercase">Rekapitulasi Gamas per Wilayah Sentral</p>
        </div>
        <span className="text-[9px] font-bold px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full">{chartData.length} STO</span>
      </div>

      {/* Main Grid: Chart on Left, Detailed Legend on Right */}
      <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-6">
        
        {/* Left Side: SVG Donut Frame */}
        <div className="sm:col-span-12 md:col-span-5 flex justify-center relative py-2">
          <svg
            width="150"
            height="150"
            viewBox="0 0 150 150"
            className="transform -rotate-90 filter drop-shadow-sm select-none"
          >
            {/* Background thin circle */}
            <circle
              cx="75"
              cy="75"
              r={radius}
              fill="transparent"
              stroke="#E2E8F0"
              strokeWidth={strokeWidth - 4}
            />

            {/* Colored segment arcs */}
            {segments.map((seg) => (
              <circle
                key={seg.name}
                cx="75"
                cy="75"
                r={radius}
                fill="transparent"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${seg.strokeLength} ${circumference - seg.strokeLength}`}
                strokeDashoffset={seg.strokeOffset}
                strokeLinecap="butt"
                className="transition-all duration-700 ease-out hover:stroke-[16px]"
                style={{ transformOrigin: '75px 75px' }}
              />
            ))}
          </svg>

          {/* Absolute Center Labels */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider leading-none">TOTAL</span>
            <span className="text-2xl font-black text-slate-800 leading-none my-1">{totalGamas}</span>
            <span className="text-[8px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wider">STO</span>
          </div>
        </div>

        {/* Right Side: Legend */}
        <div className="sm:col-span-12 md:col-span-7 space-y-2">
          <div className="divide-y divide-slate-100 max-h-[190px] overflow-y-auto pr-1">
            {segments.map((seg) => (
              <div 
                key={seg.name} 
                className="flex items-center justify-between py-2 text-xs first:pt-0 last:pb-0 group hover:bg-white/50 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div 
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" 
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="font-mono font-extrabold text-slate-700 uppercase tracking-tight text-[11px]">
                    {seg.name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-slate-500 text-[10px] font-semibold">
                    {seg.total} Gamas
                  </span>
                  <span className="font-mono font-black px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10.5px]">
                    {seg.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Percentage Row Indicators */}
      <div className="pt-3 border-t border-slate-200/60 flex flex-wrap gap-x-4 gap-y-2 justify-center">
        {segments.slice(0, 4).map((seg) => (
          <div key={seg.name} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
            <span className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: seg.color }} />
            <span className="font-mono uppercase font-bold text-slate-500">{seg.name}:</span>
            <span className="font-mono font-black text-slate-800">{seg.percentage}%</span>
          </div>
        ))}
        {segments.length > 4 && (
          <div className="text-[10px] font-bold text-slate-400">
            +{segments.length - 4} Lainnya
          </div>
        )}
      </div>

      {/* Professional footer caption */}
      <div className="text-center pt-2.5 border-t border-dashed border-slate-200/50">
        <p className="text-[9px] text-slate-400 font-semibold tracking-wide uppercase">
          STO Central Distribution Channel
        </p>
      </div>
    </div>
  );
}
