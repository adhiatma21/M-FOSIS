import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';

interface CableSegment {
  segment: string;
  count: number;
  length: number;
}

interface CableSegmentChartProps {
  data: CableSegment[];
}

export default function CableSegmentChart({ data }: CableSegmentChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Sort by length descending, keeping 0 length segments at the bottom
  const sortedData = useMemo(() => {
    return [...data]
      .sort((a, b) => {
        if (a.length === 0 && b.length > 0) return 1;
        if (a.length > 0 && b.length === 0) return -1;
        return b.length - a.length;
      });
  }, [data]);

  // Compute total cable length
  const totalLength = useMemo(() => {
    return sortedData.reduce((sum, item) => sum + item.length, 0);
  }, [sortedData]);

  // Compute total file counts
  const totalFiles = useMemo(() => {
    return sortedData.reduce((sum, item) => sum + item.count, 0);
  }, [sortedData]);

  // Map segments to colors and custom hexes
  const getSegmentStyles = (segment: string) => {
    const name = segment.toUpperCase().trim();
    if (name === 'FEEDER') {
      return {
        color: '#4F46E5', // Indigo 600
        bgClass: 'bg-indigo-600',
        textClass: 'text-indigo-600',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      };
    } else if (name === 'DISTRIBUSI') {
      return {
        color: '#DC2626', // Red 600
        bgClass: 'bg-red-600',
        textClass: 'text-red-600',
        badgeClass: 'bg-red-50 text-red-700 border-red-100',
      };
    } else if (name === 'BACKBONE') {
      return {
        color: '#10B981', // Emerald 500
        bgClass: 'bg-emerald-600',
        textClass: 'text-emerald-600',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      };
    } else if (name === 'SURGE') {
      return {
        color: '#F59E0B', // Amber 500
        bgClass: 'bg-amber-500',
        textClass: 'text-amber-500',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-100',
      };
    }
    
    return {
      color: '#94A3B8', // Slate 400
      bgClass: 'bg-slate-500',
      textClass: 'text-slate-600',
      badgeClass: 'bg-slate-50 text-slate-700 border-slate-150',
    };
  };

  // SVG parameters
  const radius = 60;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius; // ~376.991

  // Compute angles, strokes, offsets for SVG rendering
  const chartSegments = useMemo(() => {
    let accumulatedLength = 0;
    return sortedData.map((item, index) => {
      const percentage = totalLength > 0 ? item.length / totalLength : 0;
      const strokeLength = percentage * circumference;
      const strokeOffset = circumference - (accumulatedLength / totalLength) * circumference;
      
      accumulatedLength += item.length;
      
      const styles = getSegmentStyles(item.segment);

      return {
        name: item.segment,
        length: item.length,
        count: item.count,
        percentage: (percentage * 100).toFixed(1),
        strokeLength,
        strokeOffset,
        ...styles,
      };
    });
  }, [sortedData, totalLength, circumference]);

  if (sortedData.length === 0) {
    return (
      <div className="bg-white/90 backdrop-blur-sm p-8 rounded-3xl shadow-sm border border-neutral-100 flex flex-col justify-center items-center h-[340px] text-neutral-400 text-xs font-semibold">
        <span className="text-2xl mb-2">📊</span>
        Belum ada data segmentasi kabel untuk divisualisasikan.
      </div>
    );
  }

  return (
    <div className="bg-white/90 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-neutral-100/80 flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 pb-3 mb-5">
        <div className="space-y-0.5">
          <h3 className="text-base font-black text-neutral-800">
            Diagram Segmentasi Kabel
          </h3>
          <p className="text-[10px] text-neutral-400 font-medium font-sans uppercase">Visualisasi Proporsi Panjang Kabel KML</p>
        </div>
        <span className="text-[9px] font-bold px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full">
          {sortedData.length} Segmen
        </span>
      </div>

      {/* Main Layout: Side-by-Side Chart & Detailed Legend */}
      <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-6 flex-grow">
        
        {/* Left Side: SVG Donut Representation */}
        <div className="sm:col-span-12 md:col-span-5 flex justify-center relative py-3">
          <div className="relative w-[160px] h-[160px] flex items-center justify-center">
            <svg
              width="160"
              height="160"
              viewBox="0 0 160 160"
              className="transform -rotate-90 filter drop-shadow-sm select-none"
            >
              {/* Background circular track */}
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke="#F1F5F9"
                strokeWidth={strokeWidth - 2}
              />

              {/* Color arcs */}
              {chartSegments.map((seg, idx) => {
                const isHovered = hoveredIndex === idx;
                return (
                  <motion.circle
                    key={seg.name}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
                    strokeDasharray={`${seg.strokeLength} ${circumference - seg.strokeLength}`}
                    strokeDashoffset={seg.strokeOffset}
                    strokeLinecap="round"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className="cursor-pointer transition-all duration-300 ease-out"
                    style={{ transformOrigin: '80px 80px' }}
                    animate={{
                      strokeWidth: isHovered ? strokeWidth + 4 : strokeWidth,
                      scale: isHovered ? 1.03 : 1
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                  />
                );
              })}
            </svg>

            {/* Absolute Center Readout */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              {hoveredIndex !== null ? (
                <>
                  <span className="text-[8px] uppercase font-black text-neutral-400 tracking-wider leading-none">
                    {chartSegments[hoveredIndex].name}
                  </span>
                  <span className="text-lg font-black text-slate-800 leading-none my-1">
                    {chartSegments[hoveredIndex].percentage}%
                  </span>
                  <span className="text-[8px] font-bold text-slate-500 leading-none">
                    {chartSegments[hoveredIndex].length.toFixed(1)} km
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[8px] uppercase font-black text-neutral-400 tracking-wider leading-none">
                    TOTAL
                  </span>
                  <span className="text-lg font-black text-slate-800 leading-none my-1">
                    {totalLength.toFixed(1)}
                  </span>
                  <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    Kabel (km)
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Legend Indicators with Percentages & File Counts */}
        <div className="sm:col-span-12 md:col-span-7 space-y-2.5">
          <div className="divide-y divide-neutral-100 max-h-[190px] overflow-y-auto pr-1">
            {chartSegments.map((seg, idx) => {
              const isHovered = hoveredIndex === idx;
              return (
                <div 
                  key={seg.name} 
                  className={`flex items-center justify-between py-2 px-2.5 rounded-xl transition-all duration-200 cursor-pointer ${
                    isHovered ? 'bg-neutral-50 shadow-sm translate-x-1' : 'hover:bg-neutral-50/60'
                  }`}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-center gap-2.5">
                    <div 
                      className="w-3 h-3 rounded-full shrink-0 shadow-sm transition-transform duration-300" 
                      style={{ 
                        backgroundColor: seg.color,
                        transform: isHovered ? 'scale(1.2)' : 'scale(1)'
                      }}
                    />
                    <div className="flex flex-col">
                      <span className="font-extrabold text-neutral-700 uppercase tracking-tight text-[11px]">
                        {seg.name}
                      </span>
                      <span className="text-[9px] text-neutral-400 font-medium">
                        {seg.count} berkas KML
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end">
                    <span className="font-mono text-neutral-800 text-[11px] font-extrabold">
                      {seg.length.toFixed(2)} km
                    </span>
                    <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[9.5px] mt-0.5 ${seg.badgeClass}`}>
                      {seg.percentage}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Professional Footer Caption */}
      <div className="text-center pt-3 mt-4 border-t border-dashed border-neutral-100/80">
        <p className="text-[8px] text-neutral-400 font-bold tracking-widest uppercase flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
          DIAGRAM ANALISIS SEGMENTASI SPASIAL M-FOSIS
        </p>
      </div>
    </div>
  );
}
