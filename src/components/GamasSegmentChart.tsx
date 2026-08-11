import React, { useMemo } from 'react';

interface GamasSegmentChartProps {
  data: Array<{
    name: string;
    total: number;
    open: number;
    progress: number;
    closed: number;
    temporer: number;
  }>;
  isLoading?: boolean;
}

export default function GamasSegmentChart({ data, isLoading }: GamasSegmentChartProps) {
  // 1. Sort segment entries by total desc
  const chartData = useMemo(() => {
    return data
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [data]);

  // 2. Sum of all gamas
  const totalGamas = useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.total, 0);
  }, [chartData]);

  // Segment Specific beautiful color scheme
  const getSegmentColor = (name: string, index: number) => {
    const norm = name.toUpperCase().trim();
    if (norm.includes('FEEDER')) return '#DC2626'; // Pure Crimson Red
    if (norm.includes('DISTRIBUSI')) return '#F59E0B'; // Amber Orange
    if (norm.includes('DROPCORE')) return '#2563EB'; // Royal Blue
    if (norm.includes('RK') || norm.includes('RUMAH KABEL')) return '#EC4899'; // Pink
    if (norm.includes('ODP')) return '#8B5CF6'; // Purple / Violet
    if (norm.includes('CORE')) return '#10B981'; // Emerald Green
    if (norm.includes('ODC')) return '#06B6D4'; // Cyan
    
    // Fallback colors for other potential segments
    const colors = ['#6366F1', '#14B8A6', '#F97316', '#A855F7', '#10B981', '#E11D48'];
    return colors[index % colors.length];
  };

  // Math config for SVG circle-based outer donut
  const radius = 55;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius; // 2 * 3.14159 * 55 ≈ 345.575

  // 3. Compute segments with matching angles & offsets
  const segments = useMemo(() => {
    let accumulatedTotal = 0;
    return chartData.map((item, index) => {
      const percentage = totalGamas > 0 ? (item.total / totalGamas) : 0;
      const strokeLength = percentage * circumference;
      const strokeOffset = circumference - (accumulatedTotal / totalGamas) * circumference;
      
      accumulatedTotal += item.total;
      
      return {
        name: item.name,
        total: item.total,
        percentage: (percentage * 100).toFixed(1),
        color: getSegmentColor(item.name, index),
        strokeLength,
        strokeOffset,
      };
    });
  }, [chartData, totalGamas, circumference]);

  if (isLoading) {
    return (
      <div className="bg-slate-50 border border-slate-200/50 p-5 rounded-xl flex flex-col items-center justify-center h-[280px] animate-pulse">
        <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-red-650 animate-spin bg-transparent border-t-red-650 mb-3" style={{ borderTopColor: '#DC2626' }}></div>
        <p className="text-xs text-slate-500 font-mono tracking-wider">Memuat visualisasi diagram...</p>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200/50 p-5 rounded-xl text-center flex flex-col justify-center items-center h-[280px] text-slate-400 text-xs font-mono">
        Belum ada data visualisasi untuk Segment Gangguan.
      </div>
    );
  }

  return (
    <div className="space-y-5 flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
            PROPORSI SEGMENT GANGGUAN
          </h3>
          <p className="text-[10px] text-slate-500 font-medium font-sans uppercase">Berdasarkan Kolom I Google Spreadsheet</p>
        </div>
        <span className="text-[9px] font-bold px-2 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full">KOLOM I</span>
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

          {/* Absolute Center Labels (Legible totals, non-rotating) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider leading-none">TOTAL</span>
            <span className="text-2xl font-black text-slate-800 leading-none my-1">{totalGamas}</span>
            <span className="text-[8px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-wider">PROPORSI</span>
          </div>
        </div>

        {/* Right Side: High legibility text mapping to avoid overlaps */}
        <div className="sm:col-span-12 md:col-span-7 space-y-2">
          <div className="divide-y divide-slate-100 max-h-[190px] overflow-y-auto pr-1">
            {segments.map((seg) => (
              <div 
                key={seg.name} 
                className="flex items-center justify-between py-1.5 text-xs first:pt-0 last:pb-0 group hover:bg-white/50 px-1 rounded transition-colors"
               >
                <div className="flex items-center gap-2">
                  <div 
                    className="w-2 h-2 rounded-full shrink-0 shadow-sm" 
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="font-sans font-medium text-slate-600 uppercase tracking-tight text-[10px]">
                    {seg.name}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-slate-405 text-[9px] font-normal">
                    {seg.total} Gamas
                  </span>
                  <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[9.5px]">
                    {seg.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Professional disclaimer / caption */}
      <div className="text-center pt-2.5 border-t border-dashed border-slate-200/50">
        <p className="text-[9px] text-slate-400 font-semibold tracking-wide uppercase">
          Digital Auto-Visualization Channel M-FOSIS Realtime
        </p>
      </div>
    </div>
  );
}
