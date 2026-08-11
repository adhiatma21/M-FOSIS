import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import DetailGamas from '../components/DetailGamas';
import GamasSegmentChart from '../components/GamasSegmentChart';
import GamasDonutChart from '../components/GamasDonutChart';
import { 
  Activity, AlertTriangle, Clock, Play, CheckCircle2, RefreshCw, 
  MapPin, Filter, Search, Calendar, ChevronRight, Server, Shield,
  Download, Loader2, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';

// Define the Data Row Schema
export interface GamasSheetRow {
  timestamp: string;
  sto: string;
  segment: string;
  alproName: string;
  kondisi: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  rekon_tif_status?: string;
  segmentGangguan?: string;
  rawValues: string[];
  rowIndex?: number;
  [key: number]: string;
}

// Marker Pins Fix
const createCustomMarker = (status: string) => {
  let color = '#ef4444'; // Red for Open
  let ringColor = 'rgba(239, 68, 68, 0.4)';
  
  if (status.toLowerCase().includes('progress')) {
    color = '#f59e0b'; // Amber for On Progress
    ringColor = 'rgba(245, 158, 11, 0.4)';
  } else if (status.toLowerCase().includes('closed') || status.toLowerCase().includes('close')) {
    color = '#10b981'; // Green for Closed
    ringColor = 'rgba(16, 185, 129, 0.4)';
  } else if (status.toLowerCase().includes('temporer')) {
    color = '#3b82f6'; // Blue for Temporer
    ringColor = 'rgba(59, 130, 246, 0.4)';
  }

  return L.divIcon({
    className: 'custom-gamas-marker',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;">
        <div style="position: absolute; width: 24px; height: 24px; background: ${ringColor}; border-radius: 50%; animation: pulse-anim 1.5s infinite; pointer-events: none;"></div>
        <div style="position: absolute; width: 14px; height: 14px; background: ${color}; border: 2px solid #FFFFFF; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 10;"></div>
      </div>
      <style>
        @keyframes pulse-anim {
          0% { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      </style>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -10]
  });
};

// Map View Changer Helper
function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true, duration: 1 });
  }, [center, zoom, map]);
  return null;
}

// Auto fitBounds controller to dynamic data points
function FitBoundsController({ data }: { data: GamasSheetRow[] }) {
  const map = useMap();
  useEffect(() => {
    const validCoords = data
      .filter(item => item.latitude !== null && item.longitude !== null)
      .map(item => [item.latitude!, item.longitude!] as [number, number]);
      
    if (validCoords.length > 0) {
      const bounds = L.latLngBounds(validCoords);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15, animate: true, duration: 1 });
    }
  }, [data, map]);
  return null;
}

const getCircleColor = (status: string) => {
  const norm = (status || '').toLowerCase();
  if (norm.includes('progress')) return '#f59e0b'; // amber-500
  if (norm.includes('close') || norm.includes('tutup') || norm.includes('selesai')) return '#10b981'; // green-500
  if (norm.includes('temp')) return '#3b82f6'; // blue-500
  return '#ef4444'; // red-500/open
};

interface DashboardGamasProps {
  onToggleHeader?: (hide: boolean) => void;
  exportToPDF?: () => Promise<void> | void;
  isPdfExporting?: boolean;
}

export default function DashboardGamas({ onToggleHeader, exportToPDF, isPdfExporting }: DashboardGamasProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<GamasSheetRow[]>([]);
  
  const [isDetailView, setIsDetailView] = useState(false);
  const [selectedData, setSelectedData] = useState<GamasSheetRow | null>(null);

  const handleLihatDetail = (item: GamasSheetRow) => {
    setSelectedData(item);
    setIsDetailView(true);
  };

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorInput, setErrorInput] = useState<string | null>(null);
  
  // Design instruction specifies using "Last Updated: 13/06/2026 23:15 WIB"
  const [lastUpdated, setLastUpdated] = useState<string>('13/06/2026 23:15 WIB');
  
  // Filter states
  const [selectedStoFilter, setSelectedStoFilter] = useState<string>('SEMUA STO');
  const [selectedSegmentFilter, setSelectedSegmentFilter] = useState<string>('SEMUA SEGMENT QE');
  const [selectedYearFilter, setSelectedYearFilter] = useState<string>('SEMUA TAHUN');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination states
  const [itemsPerPage, setItemsPerPage] = useState<number | 'All'>(5);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Reset to first page when filtering or searching
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStoFilter, selectedSegmentFilter, selectedYearFilter, searchQuery]);
  
  const [mapCenter, setMapCenter] = useState<[number, number]>([-7.864, 111.463]); // Default around Ponorogo
  const [mapZoom, setMapZoom] = useState<number>(12);
  const [mapStyle, setMapStyle] = useState<'google_road' | 'google_hybrid' | 'voyager'>('google_road');

  // Helper to extract year safely from timestamp string (e.g., formats like "13/06/2026" or similar)
  const getYearFromTimestamp = (ts: string): string => {
    if (!ts) return '';
    const clean = ts.trim();
    
    // Check for 4-digit years (2024, 2025, 2026)
    const match = clean.match(/\b(202[4-6])\b/);
    if (match) return match[1];

    // Fallback checks for segment splits
    const parts = clean.split(/[\/\-\s]/);
    for (const part of parts) {
      if (part === '24' || part === '2024') return '2024';
      if (part === '25' || part === '2025') return '2025';
      if (part === '26' || part === '2026') return '2026';
    }
    return '';
  };

  // Parse Google Sheets CSV/JSON
  const fetchData = async () => {
    setIsLoading(true);
    setErrorInput(null);
    try {
      const spreadsheetId = '1-O0AQxDPt5Zb2OHHE5Caj6KTiINZIomSgBIbTjnoLN8';
      const sheetName = 'M-fosis';
      
      let text = '';
      let fetchSuccess = false;

      // 1. Try server-side proxy
      try {
        const proxyRes = await fetch(`/api/sheets/gviz?spreadsheetId=${spreadsheetId}&sheet=${encodeURIComponent(sheetName)}`);
        if (proxyRes.ok) {
          text = await proxyRes.text();
          if (text && text.length > 0) fetchSuccess = true;
        }
      } catch (proxyErr) {
        console.warn('Proxy fetch failed, trying direct URL:', proxyErr);
      }

      // 2. Direct client fetch fallback
      if (!fetchSuccess) {
        try {
          const directUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
          const directRes = await fetch(directUrl);
          if (directRes.ok) {
            text = await directRes.text();
            if (text && text.length > 0) fetchSuccess = true;
          }
        } catch (directErr) {
          console.warn('Direct fetch failed:', directErr);
        }
      }

      if (!fetchSuccess || !text) {
        console.warn('Unable to reach Google Sheets, initializing default state.');
        setIsLoading(false);
        return;
      }

      // Extract valid JSON
      const jsonStart = text.indexOf('(') + 1;
      const jsonEnd = text.lastIndexOf(')');
      if (jsonStart < 1 || jsonEnd < 1) {
        setIsLoading(false);
        return;
      }
      
      const jsonString = text.substring(jsonStart, jsonEnd);
      const payload = JSON.parse(jsonString);
      
      const cols = payload.table.cols || [];
      const rows = payload.table.rows || [];

      // Detect sheet columns based on headers or positions
      let timestampIdx = -1;
      let stoIdx = -1;
      let segmentIdx = -1;
      let alproIdx = -1;
      let kondisiIdx = -1;
      let statusIdx = -1;
      let latIdx = -1;
      let lngIdx = -1;

      cols.forEach((col: any, idx: number) => {
        const label = (col.label || '').toLowerCase().trim();
        if (label.includes('time') || label.includes('tgl') || label.includes('tanggal') || label.includes('input')) {
          timestampIdx = idx;
        } else if (label.includes('sto')) {
          stoIdx = idx;
        } else if (label.includes('seg') || label.includes('tipe')) {
          segmentIdx = idx;
        } else if (label.includes('alpro') || label.includes('alat') || label.includes('name')) {
          alproIdx = idx;
        } else if (label.includes('kondisi') || label.includes('gangguan') || label.includes('detail')) {
          kondisiIdx = idx;
        } else if (label.includes('stat') || label.includes('gamas')) {
          statusIdx = idx;
        } else if (label.includes('lat') || label.includes('coord') || label.includes('lintang')) {
          latIdx = idx;
        } else if (label.includes('long') || label.includes('lng') || label.includes('bujur')) {
          lngIdx = idx;
        }
      });

      // Fallback strategies for default positions
      if (timestampIdx === -1) timestampIdx = 0;
      if (stoIdx === -1) stoIdx = 1;
      if (segmentIdx === -1) segmentIdx = 7; // Column H (Index 7)
      if (alproIdx === -1) alproIdx = 3;     // Column D (Index 3)
      if (kondisiIdx === -1) kondisiIdx = 4; // Column E (Index 4)
      if (statusIdx === -1) statusIdx = 10;  // Column K (Index 10)
      if (latIdx === -1) latIdx = 11;         // Column L (Index 11)
      if (lngIdx === -1) lngIdx = 12;         // Column M (Index 12)

      const parsed: GamasSheetRow[] = rows.map((row: any, rIndex: number) => {
        const cells = row.c || [];
        
        const getCellValue = (idx: number): string => {
          if (idx === -1 || !cells[idx]) return '';
          const cellValue = cells[idx].v;
          if (cellValue === null || cellValue === undefined) return '';
          
          if (typeof cellValue === 'string' && cellValue.startsWith('Date(')) {
            const dateParts = cellValue.match(/\d+/g);
            if (dateParts) {
              const y = parseInt(dateParts[0], 10);
              const m = parseInt(dateParts[1], 10);
              const d = parseInt(dateParts[2], 10);
              return `${d}/${m + 1}/${y}`;
            }
          }
          return cells[idx].f || String(cellValue);
        };

        const rawLat = getCellValue(11) || getCellValue(latIdx);
        const rawLng = getCellValue(12) || getCellValue(lngIdx);
        
        let latNum: number | null = null;
        let lngNum: number | null = null;
        
        if (rawLat) {
          const cleanedLat = rawLat.trim().replace(',', '.').replace(/[^\d.-]/g, '');
          const parsedLat = parseFloat(cleanedLat);
          if (!isNaN(parsedLat) && parsedLat >= -90 && parsedLat <= 90) {
            latNum = parsedLat;
          }
        }
        
        if (rawLng) {
          const cleanedLng = rawLng.trim().replace(',', '.').replace(/[^\d.-]/g, '');
          const parsedLng = parseFloat(cleanedLng);
          if (!isNaN(parsedLng) && parsedLng >= -180 && parsedLng <= 180) {
            lngNum = parsedLng;
          }
        }

        // Generate full raw cell array for indexing and fallback checks
        const rawValues: string[] = [];
        const maxIdx = Math.max(35, cells.length, cols.length);
        for (let i = 0; i < maxIdx; i++) {
          rawValues.push(getCellValue(i));
        }

        // Determine status based on Column K (index 10) with case-insensitive logic
        const colKVal = getCellValue(10);
        let rowStatusValue = 'Open';
        const colKValLower = colKVal.toLowerCase();
        if (colKValLower.includes('on progress')) {
          rowStatusValue = 'On Progress';
        } else if (colKValLower.includes('close permanen')) {
          rowStatusValue = 'Close Permanen';
        } else if (colKValLower.includes('temporer')) {
          rowStatusValue = 'Temporer';
        } else if (colKValLower.includes('open')) {
          rowStatusValue = 'Open';
        } else {
          // If column K is empty or doesn't match any known keywords, fallback to raw status column
          rowStatusValue = getCellValue(statusIdx) || 'Open';
        }

        const rawRekonVal = getCellValue(26) || 'BELUM ❌';

        const itemObj: GamasSheetRow = {
          timestamp: getCellValue(0) || getCellValue(timestampIdx) || '-',
          sto: (getCellValue(stoIdx) || 'MDN').toUpperCase().trim(),
          segment: getCellValue(7) || getCellValue(segmentIdx) || 'DISTRIBUSI', // explicitly Column H (Index 7)
          alproName: getCellValue(alproIdx) || 'Alpro-' + rIndex,
          kondisi: getCellValue(8) || 'Gangguan Massal',
          status: rowStatusValue,
          latitude: !isNaN(Number(latNum)) ? latNum : null,
          longitude: !isNaN(Number(lngNum)) ? lngNum : null,
          rekon_tif_status: rawRekonVal,
          segmentGangguan: getCellValue(8) || 'Lain-lain',
          rawValues: rawValues,
          rowIndex: rIndex,
        };

        // Inject number indexes dynamically
        rawValues.forEach((val, idx) => {
          itemObj[idx] = val;
        });

        return itemObj;
      }).filter((item: GamasSheetRow) => {
        const tsLow = item.timestamp.toLowerCase();
        const alpLow = item.alproName.toLowerCase();
        if (tsLow.includes('timestamp') || tsLow.includes('tanggal') || tsLow.includes('tgl') || alpLow.includes('alpro name') || alpLow === 'alpro') {
          return false;
        }
        return true;
      });

      setData(parsed);

      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      setLastUpdated(`${dd}/${mm}/${yyyy} ${hh}:${min} WIB`);

      // Autofocus first valid coordinate
      const validCoord = parsed.find(r => r.latitude !== null && r.longitude !== null);
      if (validCoord && validCoord.latitude && validCoord.longitude) {
        setMapCenter([validCoord.latitude, validCoord.longitude]);
      }
    } catch (err: any) {
      console.warn("Spreadsheet data fetch error:", err);
      const msg = err?.message || '';
      if (!msg.includes('Failed to fetch') && !msg.includes('fetch')) {
        setErrorInput(msg || 'Gagal memuat data dari spreadsheet.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Helper to check if a filter value is the 'SEMUA' wildcard
  const isWildcardValue = (value: string): boolean => {
    if (!value) return true;
    const clean = value.toUpperCase().trim();
    return clean === 'SEMUA' || clean.startsWith('SEMUA');
  };

  // Filter and Search dynamically computed list
  const filteredData = useMemo(() => {
    // Debugging index values as requested
    if (data.length > 0) {
      console.log("Debugging filter: Row 0 timestamp/year (Index 0):", data[0][0], " | Segment (Index 7):", data[0][7]);
    }

    return data.filter(item => {
      // 1. STO Filter
      const matchSto = isWildcardValue(selectedStoFilter) || 
        item.sto.toUpperCase() === selectedStoFilter.toUpperCase();

      // 2. SEGMENT QE Filter (Index 7 as requested)
      let matchSegment = true;
      if (!isWildcardValue(selectedSegmentFilter)) {
        const val7 = item[7] ? item[7].toString().trim().toLowerCase() : '';
        const targetSeg = selectedSegmentFilter.trim().toLowerCase();
        
        // Exact case-insensitive match or fallback substring search
        matchSegment = (val7 === targetSeg) || 
                       val7.includes(targetSeg.replace('qe ', '')) || 
                       targetSeg.includes(val7);
      }

      // 3. TAHUN Filter (Index 0 as requested)
      let matchYear = true;
      if (!isWildcardValue(selectedYearFilter)) {
        const val0 = item[0] ? item[0].toString().trim().toLowerCase() : '';
        const targetYear = selectedYearFilter.trim().toLowerCase();
        const extractedYear = getYearFromTimestamp(val0);
        
        matchYear = (val0 === targetYear) || 
                    (extractedYear === targetYear) || 
                    val0.includes(targetYear);
      }

      // 4. Keyword Search
      const matchSearch = searchQuery === '' || 
        item.alproName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.kondisi.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.segment.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sto.toLowerCase().includes(searchQuery.toLowerCase());

      return matchSto && matchSegment && matchYear && matchSearch;
    });
  }, [data, selectedStoFilter, selectedSegmentFilter, selectedYearFilter, searchQuery]);

  // Slicing data based on itemsPerPage and currentPage
  const paginatedData = useMemo(() => {
    if (itemsPerPage === 'All') {
      return filteredData;
    }
    const limit = typeof itemsPerPage === 'string' ? parseInt(itemsPerPage, 10) : itemsPerPage;
    return filteredData.slice((currentPage - 1) * limit, currentPage * limit);
  }, [filteredData, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    if (itemsPerPage === 'All' || filteredData.length === 0) return 1;
    const limit = typeof itemsPerPage === 'string' ? parseInt(itemsPerPage, 10) : itemsPerPage;
    return Math.ceil(filteredData.length / limit);
  }, [filteredData, itemsPerPage]);

  // Compute stats dynamically derived from filtered data (Instantly synchronize KPI cards, no hardcodes)
  const stats = useMemo(() => {
    const total = filteredData.length;
    let openCount = 0;
    let onProgressCount = 0;
    let temporerCount = 0;
    let closedCount = 0;

    filteredData.forEach(item => {
      // Index 10 is Column K, fallback to item.status value
      const statusLower = (item[10] || item.rawValues?.[10] || item.status || '').toLowerCase().trim();
      if (statusLower.includes('on progress')) {
        onProgressCount++;
      } else if (statusLower.includes('close permanen')) {
        closedCount++;
      } else if (statusLower.includes('temporer')) {
        temporerCount++;
      } else if (statusLower.includes('open')) {
        openCount++;
      } else {
        // Broad search fallbacks
        if (statusLower.includes('progress')) {
          onProgressCount++;
        } else if (statusLower.includes('close') || statusLower.includes('tutup') || statusLower.includes('selesai')) {
          closedCount++;
        } else if (statusLower.includes('temp')) {
          temporerCount++;
        } else {
          openCount++; // default/fallback as Open
        }
      }
    });

    return { total, open: openCount, progress: onProgressCount, temporer: temporerCount, closed: closedCount };
  }, [filteredData]);

  // STO list extraction based on the loaded dataset for the filter selection dropdown
  const stoList = useMemo(() => {
    const stos = new Set<string>();
    data.forEach(item => {
      if (item.sto) stos.add(item.sto);
    });
    return ['SEMUA STO', ...Array.from(stos).sort()];
  }, [data]);

  // STO Rekapitulasi (Aggregation) for Table & Horizontal Bar Chart derived from filteredData
  const rekapSto = useMemo(() => {
    const agg: Record<string, { total: number; open: number; progress: number; closed: number; temporer: number }> = {};
    filteredData.forEach(item => {
      const s = item.sto || 'MDN';
      if (!agg[s]) {
        agg[s] = { total: 0, open: 0, progress: 0, closed: 0, temporer: 0 };
      }
      agg[s].total++;
      
      const statusLower = (item[10] || item.rawValues?.[10] || item.status || '').toLowerCase().trim();
      if (statusLower.includes('on progress')) {
        agg[s].progress++;
      } else if (statusLower.includes('close permanen')) {
        agg[s].closed++;
      } else if (statusLower.includes('temporer')) {
        agg[s].temporer++;
      } else if (statusLower.includes('open')) {
        agg[s].open++;
      } else {
        // Fallbacks
        if (statusLower.includes('progress')) {
          agg[s].progress++;
        } else if (statusLower.includes('close') || statusLower.includes('tutup') || statusLower.includes('selesai')) {
          agg[s].closed++;
        } else if (statusLower.includes('temp')) {
          agg[s].temporer++;
        } else {
          agg[s].open++;
        }
      }
    });

    return Object.entries(agg)
      .map(([sto, val]) => ({ sto, ...val }))
      .sort((a, b) => b.total - a.total);
  }, [filteredData]);

  // Absolute max total among STO for scale calculation in Bar Chart
  const maxStoTotal = useMemo(() => {
    if (rekapSto.length === 0) return 1;
    return Math.max(...rekapSto.map(r => r.total));
  }, [rekapSto]);

  // Segment Gangguan Rekapitulasi (Aggregation) from Column I (index 8) derived from filteredData
  const rekapSegment = useMemo(() => {
    const agg: Record<string, { total: number; open: number; progress: number; closed: number; temporer: number }> = {};
    filteredData.forEach(item => {
      const s = item.segmentGangguan || item[8] || item.rawValues?.[8] || 'LAIN-LAIN';
      const sTrimmed = s.toUpperCase().trim();
      if (!agg[sTrimmed]) {
        agg[sTrimmed] = { total: 0, open: 0, progress: 0, closed: 0, temporer: 0 };
      }
      agg[sTrimmed].total++;
      
      const statusLower = (item[10] || item.rawValues?.[10] || item.status || '').toLowerCase().trim();
      if (statusLower.includes('on progress')) {
        agg[sTrimmed].progress++;
      } else if (statusLower.includes('close permanen')) {
        agg[sTrimmed].closed++;
      } else if (statusLower.includes('temporer')) {
        agg[sTrimmed].temporer++;
      } else if (statusLower.includes('open')) {
        agg[sTrimmed].open++;
      } else {
        if (statusLower.includes('progress')) {
          agg[sTrimmed].progress++;
        } else if (statusLower.includes('close') || statusLower.includes('tutup') || statusLower.includes('selesai')) {
          agg[sTrimmed].closed++;
        } else if (statusLower.includes('temp')) {
          agg[sTrimmed].temporer++;
        } else {
          agg[sTrimmed].open++;
        }
      }
    });

    return Object.entries(agg)
      .map(([name, val]) => ({ name, ...val }))
      .sort((a, b) => b.total - a.total);
  }, [filteredData]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 space-y-6 font-sans">
      
      {/* 1. TOP HEADER PANEL */}
      <div className="flex flex-col gap-6 border-b border-slate-200 pb-5">
        {/* Row 1: Title (Standalone Header row) */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-red-650 text-white rounded-xl shadow-md bg-red-600 shrink-0">
            <Activity size={28} className="animate-pulse" />
          </div>
          <div>
            <h1 id="gamas-dashboard-maintitle" className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 uppercase">
              DASHBOARD GAMAS
            </h1>
            <p className="text-xs text-slate-500 font-medium tracking-wide mt-0.5">Real-Time Enterprise Dashboard Pengendalian Gangguan Massal (M-FOSIS)</p>
          </div>
        </div>

        {/* Row 2: Actions and Sync Info (Placed below the title, highly responsive) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-1">
          {/* Status Sync Info on the left of action buttons */}
          <div className="flex items-center gap-3">
            <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-400 uppercase tracking-wilder font-extrabold leading-none mb-1">Status Sinkronisasi</span>
                <span className="text-xs font-mono font-bold text-slate-700 leading-none">
                  Last Updated: {lastUpdated}
                </span>
              </div>
            </div>
            {/* Online/Connected Badge */}
            <div className="hidden xs:flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-full text-[10px] font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>TERKONEKSI SPREADSHEET</span>
            </div>
          </div>

          {/* Action buttons (PDF REPORT to the left of SINKRON LIVE DATA) */}
          <div className="flex flex-row flex-wrap items-center gap-3">
            {exportToPDF && (
              <button 
                onClick={exportToPDF} 
                disabled={isPdfExporting}
                className="flex items-center gap-2 bg-slate-850 hover:bg-slate-900 bg-slate-800 text-white font-black text-xs uppercase px-5 py-3 rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {isPdfExporting ? (
                  <>
                    <Loader2 className="animate-spin" size={14} />
                    <span>MEMBUAT REPORT...</span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>PDF REPORT</span>
                  </>
                )}
              </button>
            )}
            
            <button 
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 border border-red-500/20 text-white font-bold text-xs uppercase px-5 py-3 rounded-xl shadow-md cursor-pointer transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={`shrink-0 ${isLoading ? 'animate-spin' : ''}`} />
              <span>SINKRON LIVE DATA</span>
            </button>
          </div>
        </div>
      </div>

      {/* ERROR BANNER */}
      {errorInput && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-lg flex items-center gap-3 text-red-900 text-sm shadow-sm">
          <AlertTriangle className="text-red-500 shrink-0" size={20} />
          <div>
            <span className="font-bold">Gagal sinkronisasi data:</span> {errorInput}
          </div>
        </div>
      )}

      {/* NO DATA FROM SPREADSHEET */}
      {!isLoading && data.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 p-5 rounded-lg flex gap-3 text-amber-900 text-sm shadow-sm">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
          <div className="space-y-1">
            <p className="font-bold text-slate-800">Database Kosong / Tidak Ditemukan</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Tidak ada data yang berhasil dimuat dari spreadsheet dengan ID <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-200">1-O0AQxDPt5Zb2OHHE5Caj6KTiINZIomSgBIbTjnoLN8</span> pada sheet <span className="font-semibold">M-fosis</span>. Pastikan baris-baris data pada spreadsheet Anda sudah terisi dan link sharing-nya telah diaktifkan ke publik ("Anyone with the link can view").
            </p>
          </div>
        </div>
      )}

      {isDetailView && selectedData ? (
        <DetailGamas
          activeRecord={selectedData}
          onBack={() => {
            setIsDetailView(false);
            setSelectedData(null);
            onToggleHeader?.(false);
          }}
          records={data}
          onRecordChange={(r) => {
            setSelectedData(r);
          }}
          syncWithSpreadsheet={fetchData}
          isLoadingSheet={isLoading}
          onToggleHeader={onToggleHeader}
        />
      ) : (
        <div className="space-y-6">
          {/* 2. DYNAMIC FILTERS CONTROL PANEL */}
          <section className="bg-white p-5 rounded-lg border border-slate-200/60 shadow-sm space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2 mb-1">
              <Filter size={15} className="text-red-500" />
              <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">Panel Filter Pengendalian Gamas</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              
              {/* Dropdown Filter STO */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-505 text-slate-500 tracking-wider">STO</label>
                <div className="relative">
                  <select 
                    value={selectedStoFilter}
                    onChange={(e) => setSelectedStoFilter(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 font-semibold text-xs px-3.5 py-3 rounded-lg outline-none focus:ring-2 focus:ring-red-100 focus:border-red-500 transition-all cursor-pointer appearance-none"
                  >
                    {stoList.map(sto => (
                      <option key={sto} value={sto} className="bg-white text-slate-700">{sto}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <ChevronRight size={14} className="rotate-90" />
                  </div>
                </div>
              </div>

              {/* Dropdown Filter SEGMENT QE */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-505 text-slate-500 tracking-wider">SEGMENT QE</label>
                <div className="relative">
                  <select 
                    value={selectedSegmentFilter}
                    onChange={(e) => setSelectedSegmentFilter(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 font-semibold text-xs px-3.5 py-3 rounded-lg outline-none focus:ring-2 focus:ring-red-100 focus:border-red-500 transition-all cursor-pointer appearance-none"
                  >
                    <option value="SEMUA SEGMENT QE">SEMUA SEGMENT QE</option>
                    <option value="QE Recovery">QE Recovery</option>
                    <option value="QE Relok Utilitas">QE Relok Utilitas</option>
                    <option value="QE Preventif">QE Preventif</option>
                  </select>
                  <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <ChevronRight size={14} className="rotate-90" />
                  </div>
                </div>
              </div>

              {/* Dropdown Filter TAHUN */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-505 text-slate-500 tracking-wider">TAHUN</label>
                <div className="relative">
                  <select 
                    value={selectedYearFilter}
                    onChange={(e) => setSelectedYearFilter(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 font-semibold text-xs px-3.5 py-3 rounded-lg outline-none focus:ring-2 focus:ring-red-100 focus:border-red-500 transition-all cursor-pointer appearance-none"
                  >
                    <option value="SEMUA TAHUN">SEMUA TAHUN</option>
                    <option value="2024">2024</option>
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                  </select>
                  <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <ChevronRight size={14} className="rotate-90" />
                  </div>
                </div>
              </div>

              {/* Keyword Search Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-505 text-slate-500 tracking-wider">PENCARIAN KATA KUNCI</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search size={14} />
                  </span>
                  <input 
                    type="text"
                    placeholder="Cari alpro, segmen, detail..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 text-xs font-semibold pl-10 pr-4 py-3 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-red-100 focus:border-red-500 transition-all font-sans"
                  />
                </div>
              </div>

            </div>
          </section>

          {/* 3. FIVE KPI CARDS STATE (Auto Calculates dynamically on filters) */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            
            {/* Total Gamas Card */}
            <div className="bg-white border border-slate-200/60 p-5 rounded-lg shadow-sm flex items-center justify-between gap-4 transition-all hover:shadow group">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-2">Total Gamas</p>
                {isLoading ? (
                  <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg"></div>
                ) : (
                  <p className="text-3xl font-black text-slate-900 leading-none tracking-tight">{stats.total}</p>
                )}
              </div>
              <div className="p-3 bg-slate-50 text-slate-600 rounded-lg border border-slate-200 group-hover:bg-slate-100/50 transition-all">
                <Server size={22} />
              </div>
            </div>

            {/* Status: Open Card */}
            <div className="bg-white border border-slate-200/60 p-5 rounded-lg shadow-sm flex items-center justify-between gap-4 transition-all hover:shadow group">
              <div>
                <p className="text-[10px] font-bold uppercase text-red-600 tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                  Open
                </p>
                {isLoading ? (
                  <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg"></div>
                ) : (
                  <p className="text-3xl font-black text-red-600 leading-none tracking-tight">{stats.open}</p>
                )}
              </div>
              <div className="p-3 bg-red-50 text-red-600 rounded-lg border border-red-100 group-hover:bg-red-100/50 transition-all">
                <AlertTriangle size={22} />
              </div>
            </div>

            {/* Status: On Progress Card */}
            <div className="bg-white border border-slate-200/60 p-5 rounded-lg shadow-sm flex items-center justify-between gap-4 transition-all hover:shadow group">
              <div>
                <p className="text-[10px] font-bold uppercase text-amber-600 tracking-wider mb-2">On Progress</p>
                {isLoading ? (
                  <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg"></div>
                ) : (
                  <p className="text-3xl font-black text-amber-500 leading-none tracking-tight">{stats.progress}</p>
                )}
              </div>
              <div className="p-3 bg-amber-50 text-amber-600 rounded-lg border border-amber-100 group-hover:bg-amber-100/50 transition-all">
                <Clock size={22} className="animate-spin-slow" />
              </div>
            </div>

            {/* Status: Temporer Card */}
            <div className="bg-white border border-slate-200/60 p-5 rounded-lg shadow-sm flex items-center justify-between gap-4 transition-all hover:shadow group">
              <div>
                <p className="text-[10px] font-bold uppercase text-blue-600 tracking-wider mb-2">Temporer</p>
                {isLoading ? (
                  <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg"></div>
                ) : (
                  <p className="text-3xl font-black text-blue-600 leading-none tracking-tight">{stats.temporer}</p>
                )}
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg border border-blue-100 group-hover:bg-blue-100/50 transition-all">
                <Play size={22} />
              </div>
            </div>

            {/* Status: Closed Card */}
            <div className="bg-white border border-slate-200/60 p-5 rounded-lg shadow-sm flex items-center justify-between gap-4 transition-all hover:shadow group">
              <div>
                <p className="text-[10px] font-bold uppercase text-green-600 tracking-wider mb-2">Closed</p>
                {isLoading ? (
                  <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg"></div>
                ) : (
                  <p className="text-3xl font-black text-green-600 leading-none tracking-tight">{stats.closed}</p>
                )}
              </div>
              <div className="p-3 bg-green-50 text-green-600 rounded-lg border border-green-100 group-hover:bg-green-100/50 transition-all">
                <CheckCircle2 size={22} />
              </div>
            </div>
          </div>

          {/* 4. GRID OF STO REKAP & GEOSPATIAL MAP */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* Visual Analytics Column (With both GamasSegmentChart & GamasDonutChart) */}
            <div className="lg:col-span-12 xl:col-span-5 flex flex-col gap-6">
              {/* Segment Gangguan Section (Kolom I) */}
              <div className="bg-white border border-slate-200/60 p-6 rounded-lg shadow-sm flex flex-col justify-between h-full">
                <GamasSegmentChart data={rekapSegment} isLoading={isLoading} />
              </div>
              
              {/* STO Distribution Section */}
              <div className="bg-white border border-slate-200/60 p-6 rounded-lg shadow-sm flex flex-col justify-between h-full">
                <GamasDonutChart data={rekapSto} isLoading={isLoading} />
              </div>
            </div>

            {/* Leaflet Map Portion (Displays filtered tracking markers) */}
            <div className="lg:col-span-12 xl:col-span-7 bg-white border border-slate-200/60 p-6 rounded-lg shadow-sm flex flex-col justify-between">
              <div className="flex flex-col space-y-4 h-full">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <MapPin size={18} className="text-red-500" />
                    <div>
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">KONSENTRASI & SEBARAN GAMAS</h2>
                      <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Titik lokasi gangguan aktif</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 border border-dashed border-red-300 text-red-600 rounded">Live Sebaran</span>
                </div>

                {/* Map style selection Header Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-150 p-2.5 rounded-xl text-xs">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5 pl-1.5 text-[11px] uppercase tracking-wider">
                    <MapPin size={13} className="text-red-500" />
                    Tampilan Peta:
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMapStyle('google_road')}
                      className={`px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wide font-black transition-all cursor-pointer ${
                        mapStyle === 'google_road'
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-105'
                      }`}
                    >
                      Google Maps (Jalan)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapStyle('google_hybrid')}
                      className={`px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wide font-black transition-all cursor-pointer ${
                        mapStyle === 'google_hybrid'
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-105'
                      }`}
                    >
                      Satelit Hybrid
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapStyle('voyager')}
                      className={`px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wide font-black transition-all cursor-pointer ${
                        mapStyle === 'voyager'
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-105'
                      }`}
                    >
                      Default OSM
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-[450px] lg:min-h-[580px] h-full rounded-lg overflow-hidden border border-slate-200 relative z-10 bg-slate-50">
                {isLoading ? (
                  <div className="h-full w-full flex items-center justify-center text-xs text-slate-400 font-mono animate-pulse bg-slate-100">
                    Memuat petunjuk sebaran koordinat...
                  </div>
                ) : (
                  <MapContainer 
                    center={mapCenter} 
                    zoom={mapZoom} 
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={true}
                  >
                    {/* Choose dynamic TileLayer based on mapStyle selection */}
                    {mapStyle === 'google_road' && (
                      <TileLayer
                        attribution="&copy; Google Maps"
                        url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                        maxZoom={20}
                      />
                    )}
                    {mapStyle === 'google_hybrid' && (
                      <TileLayer
                        attribution="&copy; Google Maps Satellite"
                        url="https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                        subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                        maxZoom={20}
                      />
                    )}
                    {mapStyle === 'voyager' && (
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                      />
                    )}
                    
                    {/* Render elegant dynamic CircleMarker for better overlapping mitigation */}
                    {(() => {
                      const validCoordsLength = filteredData.filter(r => r.latitude !== null && r.longitude !== null).length;
                      const dynamicRadius = validCoordsLength > 50 ? 4 : 6;
                      
                      return filteredData.map((row, idx) => {
                        if (row.latitude && row.longitude) {
                          const markerColor = getCircleColor(row.status);
                          return (
                            <CircleMarker 
                              key={idx} 
                              center={[row.latitude, row.longitude]} 
                              radius={dynamicRadius}
                              pathOptions={{
                                color: '#ffffff',
                                fillColor: markerColor,
                                fillOpacity: 0.85,
                                weight: 1.5,
                              }}
                            >
                              <Popup>
                                <div className="text-slate-800 p-2 font-sans space-y-1 min-w-[200px]">
                                  <div className="flex justify-between items-center border-b border-slate-100 pb-1.5 mb-1.5">
                                    <span className="text-[10px] font-black uppercase text-red-650 bg-red-50 px-2 py-0.5 rounded">{row.sto}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                      row.status.toLowerCase().includes('progress') ? 'bg-amber-100 text-amber-850' :
                                      row.status.toLowerCase().includes('close') ? 'bg-green-100 text-green-850' : 'bg-red-100 text-red-850'
                                    }`}>
                                      {row.status}
                                    </span>
                                  </div>
                                  <p className="text-xs font-bold leading-tight">{row.alproName}</p>
                                  <p className="text-[10px] text-slate-500 font-medium">Segmen: <span className="font-bold text-slate-750">{row.segment}</span></p>
                                  <p className="text-[11px] text-slate-650 leading-snug">{row.kondisi}</p>
                                  <p className="text-[10px] font-mono text-slate-400 pt-1">{row.latitude}, {row.longitude}</p>
                                  
                                  <div className="pt-2 border-t border-slate-100 mt-2">
                                    <a
                                      href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1.5 justify-center w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-[10px] uppercase shadow-sm transition-all cursor-pointer hover:scale-[1.02]"
                                    >
                                      <ExternalLink size={11} />
                                      <span>Buka Google Maps</span>
                                    </a>
                                  </div>
                                </div>
                              </Popup>
                            </CircleMarker>
                          );
                        }
                        return null;
                      });
                    })()}
                    <MapController center={mapCenter} zoom={mapZoom} />
                    <FitBoundsController data={filteredData} />
                  </MapContainer>
                )}
              </div>
            </div>
          </div>

          </div>

          {/* 5. HISTORY TABLE SECTION */}
          <div id="table-monitoring-target"></div>
          <MonitoringTableSection
            isLoading={isLoading}
            filteredData={filteredData}
            paginatedData={paginatedData}
            itemsPerPage={itemsPerPage}
            currentPage={currentPage}
            totalPages={totalPages}
            selectedStoFilter={selectedStoFilter}
            selectedSegmentFilter={selectedSegmentFilter}
            selectedYearFilter={selectedYearFilter}
            searchQuery={searchQuery}
            setItemsPerPage={setItemsPerPage}
            setCurrentPage={setCurrentPage}
            setSelectedStoFilter={setSelectedStoFilter}
            setSelectedSegmentFilter={setSelectedSegmentFilter}
            setSelectedYearFilter={setSelectedYearFilter}
            setSearchQuery={setSearchQuery}
            setMapCenter={setMapCenter}
            setMapZoom={setMapZoom}
            onSelectGamas={handleLihatDetail}
          />
        </div>
      )}

      {/* Original legacy section hidden under display none */}
      <div style={{ display: 'none' }}>
      <section className="bg-white border border-slate-200/60 p-6 rounded-lg shadow-sm space-y-4">
        
        {/* Controls Panel Above Table */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-150 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
              <Calendar size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">TABEL MONITORING HISTORI</h2>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Verifikasi detail penanganan gangguan massal</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500 font-sans">Tampilkan:</span>
              <select
                id="items-per-page-select"
                value={itemsPerPage}
                onChange={(e) => {
                  const val = e.target.value;
                  setItemsPerPage(val === 'All' ? 'All' : Number(val));
                  setCurrentPage(1);
                }}
                className="bg-white text-slate-800 border border-slate-200 hover:border-slate-300 focus:border-red-500 rounded-lg py-1 px-2.5 text-xs font-black shadow-sm cursor-pointer outline-none transition-all"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value="All">All</option>
              </select>
            </div>

            <div className="text-[10px] font-bold px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded">
              Menampilkan {itemsPerPage === 'All' ? filteredData.length : paginatedData.length} Gamas Terfilter
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-505 text-slate-500 tracking-wider font-sans">
                <th className="py-4 px-6">Tgl Input</th>
                <th className="py-4 px-6">STO</th>
                <th className="py-4 px-6">Segment</th>
                <th className="py-4 px-6">Nama Alpro</th>
                <th className="py-4 px-6">Kondisi / Keluhan</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6 text-center">Petunjuk Peta</th>
                <th className="py-4 px-6 text-center">AKSI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 text-xs font-sans text-slate-700">
              {isLoading ? (
                [1, 2, 3, 4].map(idx => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-4 px-6"><div className="h-4 bg-slate-100 rounded w-20"></div></td>
                    <td className="py-4 px-6"><div className="h-4 bg-slate-100 rounded w-10"></div></td>
                    <td className="py-4 px-6"><div className="h-4 bg-slate-100 rounded w-16"></div></td>
                    <td className="py-4 px-6"><div className="h-4 bg-slate-100 rounded w-24"></div></td>
                    <td className="py-4 px-6"><div className="h-4 bg-slate-100 rounded w-36"></div></td>
                    <td className="py-4 px-6"><div className="h-4 bg-slate-100 rounded w-14"></div></td>
                    <td className="py-4 px-6"><div className="h-6 bg-slate-100 rounded w-6 mx-auto"></div></td>
                    <td className="py-4 px-6"><div className="h-6 bg-slate-100 rounded w-16 mx-auto"></div></td>
                  </tr>
                ))
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center p-6 space-y-2 max-w-lg mx-auto">
                      <div className="p-3 bg-amber-50 text-amber-500 rounded-full border border-amber-100">
                        <AlertTriangle size={24} />
                      </div>
                      <p className="font-bold text-slate-800 text-sm">Tidak Ada Data Gangguan Massal Terfilter</p>
                      <p className="text-xs text-slate-500 leading-normal">
                        Maaf, tidak ditemukan data Gamas yang sesuai dengan kombinasi filter STO (<span className="font-bold">{selectedStoFilter}</span>), SEGMENT QE (<span className="font-bold">{selectedSegmentFilter}</span>), TAHUN (<span className="font-bold">{selectedYearFilter}</span>), atau pencarian "<span className="italic">{searchQuery}</span>".
                      </p>
                      <button
                        onClick={() => {
                          setSelectedStoFilter('SEMUA STO');
                          setSelectedSegmentFilter('SEMUA SEGMENT QE');
                          setSelectedYearFilter('SEMUA TAHUN');
                          setSearchQuery('');
                        }}
                        className="mt-3 text-xs font-semibold text-red-650 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200/50 px-4 py-2 rounded-lg cursor-pointer transition-all uppercase tracking-wider block"
                      >
                        Reset Semua Filter
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedData.map((item, index) => {
                  const hasLocation = item.latitude !== null && item.longitude !== null;
                  return (
                    <tr 
                      key={index} 
                      className="hover:bg-slate-50/75 transition-colors duration-150"
                    >
                      <td className="py-4 px-6 font-mono font-medium text-slate-500 whitespace-nowrap">{item.timestamp}</td>
                      <td className="py-4 px-6">
                        <span className="bg-slate-100 border border-slate-200 font-mono text-slate-700 text-[10px] px-2 py-0.5 rounded font-black">
                          {item.sto}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-50 border border-slate-200 font-bold text-slate-600">
                          {item.segment}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-900 tracking-tight">{item.alproName}</td>
                      <td className="py-4 px-6 text-slate-650 font-light leading-relaxed max-w-[280px] break-words">{item.kondisi}</td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                          item.status.toLowerCase().includes('progress') ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                          item.status.toLowerCase().includes('close') ? 'bg-green-50 text-green-600 border border-green-200' :
                          item.status.toLowerCase().includes('temp') ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                          'bg-red-50 text-red-600 border border-red-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            item.status.toLowerCase().includes('progress') ? 'bg-amber-500 animate-pulse' :
                            item.status.toLowerCase().includes('close') ? 'bg-green-500' :
                            item.status.toLowerCase().includes('temp') ? 'bg-blue-500' :
                            'bg-red-500 animate-pulse'
                          }`}></span>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        {hasLocation && item.latitude && item.longitude ? (
                          <button
                            onClick={() => {
                              if (item.latitude && item.longitude) {
                                setMapCenter([item.latitude, item.longitude]);
                                setMapZoom(16);
                                window.scrollTo({ top: 300, behavior: 'smooth' });
                              }
                            }}
                            className="bg-slate-100 hover:bg-red-50 hover:text-red-600 border border-slate-200 p-2 rounded-lg transition-all inline-flex items-center justify-center cursor-pointer"
                            title="Fokuskan Alpro ini di peta sebaran"
                          >
                            <MapPin size={13} />
                          </button>
                        ) : (
                          <span className="text-slate-400 font-mono text-[10px]">-</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <button
                          onClick={() => {
                            handleLihatDetail(item);
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white font-black py-1.5 px-3.5 rounded-lg text-[10px] uppercase tracking-wider transition-all shadow-sm cursor-pointer whitespace-nowrap inline-block"
                        >
                          Lihat Detail
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Navigation */}
        {itemsPerPage !== 'All' && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500 font-semibold font-sans">
              Menampilkan halaman <span className="font-bold text-slate-900">{currentPage}</span> dari <span className="font-bold text-slate-900">{totalPages}</span> (Maksimal <span className="font-semibold text-slate-700">{itemsPerPage}</span> baris dari <span className="font-semibold text-slate-700">{filteredData.length}</span> total)
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                id="btn-pagination-prev"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm disabled:shadow-none"
              >
                Sebelumnya
              </button>

              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map(page => (
                <button
                  key={page}
                  id={`btn-pagination-page-${page}`}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-black transition-all ${
                    currentPage === page
                      ? 'bg-red-650 bg-red-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-350'
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                id="btn-pagination-next"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm disabled:shadow-none"
              >
                Berikutnya
              </button>
            </div>
          </div>
        )}
      </section>
      </div>

    </div>
  );
}

interface MonitoringTableSectionProps {
  isLoading: boolean;
  filteredData: GamasSheetRow[];
  paginatedData: GamasSheetRow[];
  itemsPerPage: number | 'All';
  currentPage: number;
  totalPages: number;
  selectedStoFilter: string;
  selectedSegmentFilter: string;
  selectedYearFilter: string;
  searchQuery: string;
  setItemsPerPage: React.Dispatch<React.SetStateAction<number | 'All'>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setSelectedStoFilter: React.Dispatch<React.SetStateAction<string>>;
  setSelectedSegmentFilter: React.Dispatch<React.SetStateAction<string>>;
  setSelectedYearFilter: React.Dispatch<React.SetStateAction<string>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setMapCenter: React.Dispatch<React.SetStateAction<[number, number]>>;
  setMapZoom: React.Dispatch<React.SetStateAction<number>>;
  onSelectGamas: (item: GamasSheetRow) => void;
}

const MonitoringTableSection = React.memo<MonitoringTableSectionProps>(function MonitoringTableSection({
  isLoading,
  filteredData,
  paginatedData,
  itemsPerPage,
  currentPage,
  totalPages,
  selectedStoFilter,
  selectedSegmentFilter,
  selectedYearFilter,
  searchQuery,
  setItemsPerPage,
  setCurrentPage,
  setSelectedStoFilter,
  setSelectedSegmentFilter,
  setSelectedYearFilter,
  setSearchQuery,
  setMapCenter,
  setMapZoom,
  onSelectGamas
}) {
  const [filterRekon, setFilterRekon] = useState<string>('Semua');

  // Load local overrides dynamically from localStorage
  const localStatuses = useMemo(() => {
    try {
      const saved = localStorage.getItem('gamas_local_statuses');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }, []);

  const getRekonTifStatusOfRow = (item: GamasSheetRow) => {
    // Sepenuhnya ambil data dari SS (kolom AA / index 26) tanpa local override
    const rawVal = item.rekon_tif_status || item[26] || item.rawValues?.[26] || 'BELUM ❌';
    return rawVal.trim();
  };

  const finalFilteredData = useMemo(() => {
    return filteredData.filter(item => {
      const status = getRekonTifStatusOfRow(item);
      if (filterRekon === 'SELESAI') {
        return status.toUpperCase().includes('SELESAI') || status.includes('✅');
      }
      if (filterRekon === 'BELUM') {
        return status.toUpperCase().includes('BELUM') || status.includes('❌') || status === '';
      }
      return true;
    });
  }, [filteredData, filterRekon]);

  const finalPaginatedData = useMemo(() => {
    if (itemsPerPage === 'All') {
      return finalFilteredData;
    }
    const limit = typeof itemsPerPage === 'string' ? parseInt(itemsPerPage, 10) : itemsPerPage;
    return finalFilteredData.slice((currentPage - 1) * limit, currentPage * limit);
  }, [finalFilteredData, currentPage, itemsPerPage]);

  const finalTotalPages = useMemo(() => {
    if (itemsPerPage === 'All' || finalFilteredData.length === 0) return 1;
    const limit = typeof itemsPerPage === 'string' ? parseInt(itemsPerPage, 10) : itemsPerPage;
    return Math.ceil(finalFilteredData.length / limit);
  }, [finalFilteredData, itemsPerPage]);

  return (
    <section className="bg-white border border-slate-200/60 p-6 rounded-lg shadow-sm space-y-4">
      {/* Controls Panel Above Table */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-150 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
            <Calendar size={18} />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">TABEL MONITORING HISTORI</h2>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Verifikasi detail penanganan gangguan massal</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          {/* Dropdown Filter Rekon TIF */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 font-sans whitespace-nowrap">Filter Rekon TIF:</span>
            <select
              id="rekon-tif-filter-select"
              value={filterRekon}
              onChange={(e) => {
                setFilterRekon(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-white text-slate-800 border border-slate-200 hover:border-slate-300 focus:border-red-500 rounded-lg py-1 px-2.5 text-xs font-black shadow-sm cursor-pointer outline-none transition-all"
            >
              <option value="Semua">Semua Status</option>
              <option value="SELESAI">SELESAI ✅</option>
              <option value="BELUM">BELUM ❌</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 font-sans">Tampilkan:</span>
            <select
              id="items-per-page-select-nested"
              value={itemsPerPage}
              onChange={(e) => {
                const val = e.target.value;
                setItemsPerPage(val === 'All' ? 'All' : Number(val));
                setCurrentPage(1);
              }}
              className="bg-white text-slate-800 border border-slate-200 hover:border-slate-300 focus:border-red-500 rounded-lg py-1 px-2.5 text-xs font-black shadow-sm cursor-pointer outline-none transition-all"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value="All">All</option>
            </select>
          </div>

          <div className="text-[10px] font-bold px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded whitespace-nowrap">
            Menampilkan {itemsPerPage === 'All' ? finalFilteredData.length : finalPaginatedData.length} Gamas Terfilter
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left border-collapse table-fixed md:table-auto">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200 text-[10px] font-semibold uppercase text-slate-500 tracking-wider font-sans select-none">
              <th className="py-3 px-4 md:px-5 w-[140px] md:w-auto">Tgl Input</th>
              <th className="py-3 px-4 md:px-5 w-[80px]">STO</th>
              <th className="py-3 px-4 md:px-5 w-[120px]">Segment</th>
              <th className="py-3 px-4 md:px-5 min-w-[220px] w-[240px] md:w-auto">Nama Alpro</th>
              <th className="py-3 px-4 md:px-5 min-w-[240px] w-[280px] md:w-auto">Kondisi / Keluhan</th>
              <th className="py-3 px-4 md:px-5 w-[140px]">Status</th>
              <th className="py-3 px-4 md:px-5 w-[130px]">Rekon TIF (AA)</th>
              <th className="py-3 px-4 md:px-5 text-center w-[100px]">Petunjuk Peta</th>
              <th className="py-3 px-4 md:px-5 text-center w-[120px]">AKSI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[10px] md:text-[11px] font-sans text-slate-600">
            {isLoading ? (
              [1, 2, 3, 4].map(idx => (
                <tr key={idx} className="animate-pulse">
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-20"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-10"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-16"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-24"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-36"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-14"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-2.5 bg-slate-100 rounded w-14"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-4 bg-slate-100 rounded w-5 mx-auto"></div></td>
                  <td className="py-2.5 px-4 md:px-5"><div className="h-4 bg-slate-100 rounded w-14 mx-auto"></div></td>
                </tr>
              ))
            ) : finalFilteredData.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center p-6 space-y-2 max-w-lg mx-auto">
                    <div className="p-3 bg-amber-50 text-amber-500 rounded-full border border-amber-100">
                      <AlertTriangle size={24} />
                    </div>
                    <p className="font-bold text-slate-800 text-sm">Tidak Ada Data Gangguan Massal Terfilter</p>
                    <p className="text-xs text-slate-500 leading-normal">
                      Maaf, tidak ditemukan data Gamas yang sesuai dengan kombinasi filter STO (<span className="font-bold">{selectedStoFilter}</span>), SEGMENT QE (<span className="font-bold">{selectedSegmentFilter}</span>), TAHUN (<span className="font-bold">{selectedYearFilter}</span>), filter Rekon TIF (<span className="font-bold">{filterRekon}</span>), atau pencarian "<span className="italic">{searchQuery}</span>".
                    </p>
                    <button
                      onClick={() => {
                        setSelectedStoFilter('SEMUA STO');
                        setSelectedSegmentFilter('SEMUA SEGMENT QE');
                        setSelectedYearFilter('SEMUA TAHUN');
                        setFilterRekon('Semua');
                        setSearchQuery('');
                      }}
                      className="mt-3 text-xs font-semibold text-red-655 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200/55 px-4 py-2 rounded-lg cursor-pointer transition-all uppercase tracking-wider block"
                    >
                      Reset Semua Filter
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              finalPaginatedData.map((item, index) => {
                const hasLocation = item.latitude !== null && item.longitude !== null;
                return (
                  <tr 
                    key={index} 
                    className="hover:bg-slate-50/50 transition-colors duration-150"
                  >
                    <td className="py-2.5 md:py-3 px-4 md:px-5 font-mono text-slate-400 whitespace-nowrap font-normal">{item.timestamp}</td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5">
                      <span className="bg-slate-100 border border-slate-200/80 font-mono text-slate-600 text-[9px] md:text-[10px] px-1.5 py-0.5 rounded font-normal tracking-tight">
                        {item.sto}
                      </span>
                    </td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5">
                      <span className="text-[9px] md:text-[10px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200/80 font-normal text-slate-600">
                        {item.segment}
                      </span>
                    </td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5 font-normal text-slate-700 tracking-tight min-w-[220px] w-[240px] md:w-auto break-words leading-tight">{item.alproName}</td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5 text-slate-500 font-light leading-relaxed min-w-[240px] w-[280px] md:w-auto break-words">{item.kondisi}</td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 text-[9px] md:text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        item.status.toLowerCase().includes('progress') ? 'bg-amber-50 text-amber-600 border border-amber-200/60' :
                        item.status.toLowerCase().includes('close') ? 'bg-green-50 text-green-600 border border-green-200/60' :
                        item.status.toLowerCase().includes('temp') ? 'bg-blue-50 text-blue-600 border border-blue-200/60' :
                        'bg-red-50 text-red-600 border border-red-200/60'
                      }`}>
                        <span className={`w-1 h-1 rounded-full ${
                          item.status.toLowerCase().includes('progress') ? 'bg-amber-500' :
                          item.status.toLowerCase().includes('close') ? 'bg-green-500' :
                          item.status.toLowerCase().includes('temp') ? 'bg-blue-500' :
                          'bg-red-500'
                        }`}></span>
                        {item.status}
                      </span>
                    </td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5 whitespace-nowrap">
                      {(() => {
                        const ssStatus = getRekonTifStatusOfRow(item);
                        const isSelesai = ssStatus.toUpperCase().includes('SELESAI') || ssStatus.includes('✅');
                        return (
                          <span className={`inline-flex items-center gap-1.5 text-[9px] md:text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            isSelesai ? 'bg-emerald-50 text-emerald-600 border border-emerald-250' : 'bg-red-50 text-red-600 border border-red-250'
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${isSelesai ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            {ssStatus}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5 text-center">
                      {hasLocation && item.latitude && item.longitude ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => {
                              if (item.latitude && item.longitude) {
                                setMapCenter([item.latitude, item.longitude]);
                                setMapZoom(16);
                                window.scrollTo({ top: 300, behavior: 'smooth' });
                              }
                            }}
                            className="bg-slate-100 hover:bg-red-50 hover:text-red-600 border border-slate-200 p-1.5 rounded-md transition-all inline-flex items-center justify-center cursor-pointer active:scale-95"
                            title="Fokuskan Alpro ini di peta sebaran"
                          >
                            <MapPin size={12} />
                          </button>
                          <a
                            href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-blue-50 hover:bg-blue-100 border border-blue-200 p-1.5 rounded-md transition-all inline-flex items-center justify-center cursor-pointer active:scale-95 text-blue-600"
                            title="Buka di Google Maps"
                          >
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      ) : (
                        <span className="text-slate-450 font-mono text-[9px]">-</span>
                      )}
                    </td>
                    <td className="py-2.5 md:py-3 px-4 md:px-5 text-center">
                      <button
                        onClick={() => {
                          onSelectGamas(item);
                        }}
                        className="bg-red-650 hover:bg-red-700 text-white font-normal py-1 px-2.5 rounded-md text-[9px] md:text-[10px] uppercase tracking-wider transition-all shadow-sm cursor-pointer whitespace-nowrap inline-block active:scale-95"
                      >
                        Lihat Detail
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Navigation */}
      {itemsPerPage !== 'All' && finalTotalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-500 font-semibold font-sans">
            Menampilkan halaman <span className="font-bold text-slate-900">{currentPage}</span> dari <span className="font-bold text-slate-900">{finalTotalPages}</span> (Maksimal <span className="font-semibold text-slate-700">{itemsPerPage}</span> baris dari <span className="font-semibold text-slate-700">{finalFilteredData.length}</span> total)
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              id="btn-pagination-prev-nested"
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm disabled:shadow-none"
            >
              Sebelumnya
            </button>

            {Array.from({ length: finalTotalPages }, (_, idx) => idx + 1).map(page => (
              <button
                key={page}
                id={`btn-pagination-page-nested-${page}`}
                onClick={() => setCurrentPage(page)}
                className={`px-3 py-1.5 text-xs rounded-lg font-black transition-all ${
                  currentPage === page
                    ? 'bg-red-650 bg-red-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-350'
                }`}
              >
                {page}
              </button>
            ))}

            <button
              id="btn-pagination-next-nested"
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, finalTotalPages))}
              disabled={currentPage === finalTotalPages}
              className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm disabled:shadow-none"
            >
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </section>
  );
});
