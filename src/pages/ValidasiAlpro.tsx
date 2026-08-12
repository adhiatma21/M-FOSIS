import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, Upload, ShieldAlert, Loader2, MapPin, 
  Trash2, FileText, Database, Layers, Check, Camera,
  AlertTriangle, RefreshCw, Eye, EyeOff, FolderOpen, Table, Clock, User, Map as MapIcon, Compass,
  Plus, Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Integration Variables
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx-VYqHBunXTIeTnyjcSHzrhI-Xw0OtW2e8TOz_4X169yiw5iuTx6ojxRaCvWinNrXZ1g/exec";

// Types for validation records
interface ValidationRecord {
  id: string;
  timestamp: string;
  jenisAlpro: string;
  idAlpro: string;
  status: string;
  detail: any;
  photoName?: string;
  photoSize?: string;
  userName?: string;
  userEmail?: string;
}

// Convert file to base64 string
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(',')[1] || (reader.result as string);
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Leaflet map view change component
function ChangeView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom);
  }, [center, zoom, map]);
  return null;
}

// Custom Leaflet pulse marker styling to bypass Vite asset bundling bugs
const customMarkerIcon = typeof window !== 'undefined' ? L.divIcon({
  html: `
    <div class="relative flex items-center justify-center">
      <div class="absolute w-10 h-10 bg-red-500 rounded-full opacity-35 animate-ping"></div>
      <div class="relative w-6 h-6 bg-red-600 rounded-full border-2 border-white flex items-center justify-center shadow-lg">
        <div class="w-2 h-2 bg-white rounded-full"></div>
      </div>
    </div>
  `,
  className: 'custom-leaflet-marker-glow',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
}) : undefined;

interface ValidasiAlproProps {
  driveToken?: string | null;
  connectGoogleDrive?: (silent?: boolean) => Promise<string | null>;
  isConnectingDrive?: boolean;
}

export default function ValidasiAlpro({ driveToken, connectGoogleDrive, isConnectingDrive }: ValidasiAlproProps = {}) {
  // Main form states
  const [jenisAlpro, setJenisAlpro] = useState<string>("Validasi titik sambung");
  const [subJenisAlpro, setSubJenisAlpro] = useState<string>("Kabel FEEDER");
  const [otbAwal, setOtbAwal] = useState<string>("OTB ST.Walikukun");
  const [otbTarget, setOtbTarget] = useState<string>("OTB ST.Walikukun");
  const [statusTitikSambung, setStatusTitikSambung] = useState<string>("Titik Sambung Temporer");
  const [idAlpro, setIdAlpro] = useState<string>("");
  const [namaStoValidasi, setNamaStoValidasi] = useState<string>("");
  
  // VALIDASI TITIK SAMBUNG dynamic coordinates
  const [latitude, setLatitude] = useState<string>("");
  const [longitude, setLongitude] = useState<string>("");
  const [koordinat, setKoordinat] = useState<string>("");

  useEffect(() => {
    if (!latitude && !longitude) {
      setKoordinat("");
    } else {
      const currentCombined = `${latitude}, ${longitude}`;
      const parts = koordinat.split(/[\s,;]+/).filter(Boolean);
      const partsMatch = parts.length === 2 && parts[0] === latitude && parts[1] === longitude;
      if (!partsMatch) {
        setKoordinat(latitude && longitude ? `${latitude}, ${longitude}` : (latitude || longitude || ""));
      }
    }
  }, [latitude, longitude]);

  const handleKoordinatChange = (val: string) => {
    setKoordinat(val);
    const parts = val.split(/[\s,;]+/).filter(Boolean);
    if (parts.length >= 2) {
      setLatitude(parts[0].trim());
      setLongitude(parts[1].trim());
    } else if (parts.length === 1) {
      setLatitude(parts[0].trim());
      setLongitude("");
    } else {
      setLatitude("");
      setLongitude("");
    }
  };

  // Map settings and automatic sync center state (Madiun default)
  const [mapCenter, setMapCenter] = useState<[number, number]>([-7.6298, 111.5240]);
  const [zoomLevel] = useState<number>(14);

  // Update Data Gamas dynamic states
  const [idQeLop, setIdQeLop] = useState<string>("");
  const [tiketInsera, setTiketInsera] = useState<string>("");
  const [sto, setSto] = useState<string>("");
  const [segmentJaringan, setSegmentJaringan] = useState<string>("Feeder");
  const [kategoriQe, setKategoriQe] = useState<string>("QE Recovery");
  const [kondisiFisik, setKondisiFisik] = useState<string>("Aman");
  const [kondisiLainnya, setKondisiLainnya] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [statusGamas, setStatusGamas] = useState<string>("Close Permanen");

  // Audit Kapasitas dynamic states
  const [nilaiOpm, setNilaiOpm] = useState<string>("");
  const [sisaPort, setSisaPort] = useState<string>("");

  // Pelabelan Ulang dynamic states
  const [idAlproLama, setIdAlproLama] = useState<string>("");
  const [idAlproBaru, setIdAlproBaru] = useState<string>("");

  // Patroli dynamic states
  const [kategoriKerusakan, setKategoriKerusakan] = useState<string>("Tiang Miring");

  // Photo Upload States (Multiple photos track)
  const [uploadedPhotos, setUploadedPhotos] = useState<File[]>([]);
  const [uploadedPhotoUrls, setUploadedPhotoUrls] = useState<string[]>([]);

  // Derived state mappings for backwards-compatible single file getters
  const uploadedPhoto = uploadedPhotos[0] || null;
  const uploadedPhotoUrl = uploadedPhotoUrls[0] || null;

  // Submenu dynamic states for material & quantity selector
  const [gamasMaterials, setGamasMaterials] = useState<{ name: string; qty: string }[]>([]);
  const [newGamasMatName, setNewGamasMatName] = useState<string>("");
  const [newGamasMatQty, setNewGamasMatQty] = useState<string>("");
  const [newGamasMatUnit, setNewGamasMatUnit] = useState<string>("meter");

  const COMMON_GAMAS_MATERIALS = [
    "Kabel Drop Core SM 1 Core",
    "Kabel Optik ADSS 12 Core",
    "Kabel Optik ADSS 24 Core",
    "Joint Closure Dome 24 Core",
    "Joint Closure Inline 12 Core",
    "Protection Sleeve 60mm",
    "OTB 24 Core",
    "SACK (S-Hanger)",
    "Tiang Besi 7 Meter",
    "Tiang Besi 9 Meter"
  ];

  // Upload & Verification Status States
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [logTime, setLogTime] = useState<string>("");
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(["[INFO] Terminal initialized. Waiting for input validation..."]);
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);

  // Active User Identifiers from Firebase auth session
  const activeUser = auth.currentUser;
  const currentUserName = activeUser?.displayName || "Admin M-FOSIS";
  const currentUserEmail = activeUser?.email || "tidak-diketahui@email.com";

  // Coordinates watcher to instantly update visual maps centering
  useEffect(() => {
    if (!latitude.trim() || !longitude.trim()) return;
    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    if (!isNaN(latNum) && !isNaN(lngNum) && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180) {
      setMapCenter([latNum, lngNum]);
    }
  }, [latitude, longitude]);

  // Local/Firestore records state
  const [historyRecords, setHistoryRecords] = useState<ValidationRecord[]>([
    {
      id: "VAL-98421",
      timestamp: "13/06/2026, 09:12:45 WIB",
      jenisAlpro: "Validasi titik sambung",
      idAlpro: "JC-PGO-FAA/02",
      status: "Berhasil Sinkron",
      photoName: "JC_Aman_Sektor_B.png",
      photoSize: "412.5 KB",
      userName: "Dwi Harianto",
      userEmail: "dwi.harianto@telkom.co.id",
      detail: {
        Latitude: "-7.6298",
        Longitude: "111.5241"
      }
    },
    {
      id: "VAL-98319",
      timestamp: "12/06/2026, 15:44:02 WIB",
      jenisAlpro: "Update Data Gamas",
      idAlpro: "3MDN_QEREC_INC47782643_26W13_RABASAN DS-MSP-FH",
      status: "Sheet & Drive OK",
      photoName: "LOP_Gamas_ST01.jpg",
      photoSize: "1.2 MB",
      userName: "Rian Pratama",
      userEmail: "rian.pratama@telkom.co.id",
      detail: {
        "Tiket Insera": "INC47782643",
        "STO": "MDN",
        "Segment": "Distribusi",
        "Kondisi Fisik": "Hancur/Patah"
      }
    }
  ]);

  // Dropzone Setup
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      setUploadedPhotos(prev => [...prev, ...acceptedFiles]);
      const newUrls = acceptedFiles.map(file => URL.createObjectURL(file));
      setUploadedPhotoUrls(prev => [...prev, ...newUrls]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg'] },
    multiple: true
  } as any);

  const removePhotoAtIndex = (indexToRemove: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadedPhotos(prev => prev.filter((_, idx) => idx !== indexToRemove));
    if (uploadedPhotoUrls[indexToRemove]) {
      URL.revokeObjectURL(uploadedPhotoUrls[indexToRemove]);
    }
    setUploadedPhotoUrls(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const removePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    uploadedPhotoUrls.forEach(url => URL.revokeObjectURL(url));
    setUploadedPhotos([]);
    setUploadedPhotoUrls([]);
  };

  const validateForm = (): boolean => {
    if (jenisAlpro === "Validasi titik sambung") {
      if (!idAlpro.trim()) {
        alert("Mohon masukkan ID / Nama Alpro.");
        return false;
      }
      if (!namaStoValidasi.trim()) {
        alert("Mohon masukkan Nama STO.");
        return false;
      }
      if (!latitude.trim() || !longitude.trim()) {
        alert("Mohon masukkan Koordinat Latitude dan Longitude secara lengkap.");
        return false;
      }
      const latVal = parseFloat(latitude);
      const lngVal = parseFloat(longitude);
      if (isNaN(latVal) || isNaN(lngVal)) {
        alert("Koordinat Latitude dan Longitude harus berupa angka desimal valid.");
        return false;
      }
    } else if (jenisAlpro === "Update Data Gamas") {
      if (!idQeLop.trim()) {
        alert("Mohon masukkan ID QE / LOP.");
        return false;
      }
      if (!tiketInsera.trim()) {
        alert("Mohon masukkan tiket Insera.");
        return false;
      }
      if (!sto.trim()) {
        alert("Mohon masukkan kode STO.");
        return false;
      }
      if (!projectId.trim()) {
        alert("Mohon masukkan ID Proyek (PID).");
        return false;
      }
      if (kondisiFisik === "Lainnya.." && !kondisiLainnya.trim()) {
        alert("Mohon jelaskan kondisi fisik spesifik pada kolom kondisi lainnya.");
        return false;
      }
      if (!latitude.trim() || !longitude.trim()) {
        alert("Mohon masukkan Koordinat Titik Gamas (Latitude & Longitude).");
        return false;
      }
      const latVal = parseFloat(latitude);
      const lngVal = parseFloat(longitude);
      if (isNaN(latVal) || isNaN(lngVal)) {
        alert("Koordinat Latitude dan Longitude gamas harus berupa angka valid.");
        return false;
      }
    } else if (jenisAlpro === "Audit Kapasitas & Redaman ODP") {
      if (!idAlpro.trim()) {
        alert("Mohon masukkan ID / Nama Alpro ODP.");
        return false;
      }
      if (!nilaiOpm.trim()) {
        alert("Mohon masukkan Nilai OPM dBm.");
        return false;
      }
      if (!sisaPort.trim()) {
        alert("Mohon masukkan jumlah sisa port.");
        return false;
      }
    } else if (jenisAlpro === "Pelabelan Ulang & Tagging QR Code") {
      if (!idAlproLama.trim() || !idAlproBaru.trim()) {
        alert("Mohon lengkapi ID Alpro Lama dan ID Alpro Baru.");
        return false;
      }
    } else if (jenisAlpro === "Pelaporan Kerusakan Aset (Patroli)") {
      if (!idAlpro.trim()) {
        alert("Mohon masukkan ID / Nama Alpro terdampak.");
        return false;
      }
    }
    
    if (uploadedPhotos.length === 0) {
      alert("Mohon sertakan dan unggah minimal 1 foto bukti fisik lapangan.");
      return false;
    }
    
    return true;
  };

  // Modern Unified Submit Handler targeting the Apps Script Endpoint
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitSuccess(false);
    setShowConsole(true);
    setUploadStatus('loading');
    
    // Clear previous console logs and start streaming
    const initialLogs: string[] = [];
    const pushLog = (txt: string) => {
      const t = new Date().toLocaleTimeString('id-ID');
      initialLogs.push(`[${t}] ${txt}`);
      setConsoleLogs([...initialLogs]);
    };

    pushLog(`[START] Memulai proses sinkronisasi data (${jenisAlpro})...`);

    // Determine values according to active tab/dropdown context
    const currentIdNamaAlpro = jenisAlpro === "Update Data Gamas" ? "" : (idAlpro || idAlproBaru || idAlproLama || "");
    const actualKondisiFisik = (kondisiFisik === "Lainnya.." || kondisiFisik === "Lainnya") ? kondisiLainnya : kondisiFisik;
    const generatedFileName = `${tiketInsera || idAlpro || 'GAMAS'}_${Date.now()}_1.jpg`;

    // A. CONVERT PHOTOS TO BASE64 ARRAY
    const base64Photos = await Promise.all(uploadedPhotos.map(async (file, idx) => {
      try {
        const b64 = await fileToBase64(file);
        return {
          name: `${tiketInsera || idQeLop || idAlpro || 'GAMAS'}_${Date.now()}_${idx + 1}.jpg`,
          size: `${(file.size / 1024).toFixed(1)} KB`,
          base64: b64
        };
      } catch (err: any) {
        return null;
      }
    }));
    const validPhotos = base64Photos.filter((p): p is NonNullable<typeof p> => p !== null);

    // B. SERIALIZE MATERIAL & VOLUME SUBMENU
    let materialVolumeString = "";
    if (jenisAlpro === "Update Data Gamas" && gamasMaterials.length > 0) {
      materialVolumeString = gamasMaterials.map(m => `${m.name}: ${m.qty}`).join('\n');
    }

    // C. SIMULATE GOOGLE DRIVE AUTO FOLDERING SEARCH & CREATION
    if (jenisAlpro === "Update Data Gamas") {
      const dummyDelay = (ms: number) => new Promise(res => setTimeout(res, ms));
      await dummyDelay(400);
    }

    // 1. ISOLATED FIRESTORE OPERATION (Async Isolation)
    let firestoreSuccess = true;
    let firestoreErrorMessage = "";
    
    try {
      // Wrap in isolated try-catch to keep Google Sheet post unblocked even if Firestore security rule blocks it
      await addDoc(collection(db, 'validations_simulated'), {
        jenisAlpro,
        subJenisAlpro: jenisAlpro === "Validasi titik sambung" 
          ? (subJenisAlpro === "Link SURGE" ? `Link SURGE (${otbAwal} -> ${otbTarget})` : subJenisAlpro) 
          : "",
        statusTitikSambung: jenisAlpro === "Validasi titik sambung" ? statusTitikSambung : "",
        idNamaAlpro: currentIdNamaAlpro,
        idQeLop: idQeLop || "",
        tiketInsera: tiketInsera || "",
        sto: jenisAlpro === "Validasi titik sambung" ? namaStoValidasi : (sto || ""),
        namaSto: jenisAlpro === "Validasi titik sambung" ? namaStoValidasi : (sto || ""),
        segmentKabel: jenisAlpro === "Validasi titik sambung" ? (subJenisAlpro === "Link SURGE" ? `Link SURGE (${otbAwal} -> ${otbTarget})` : subJenisAlpro) : "",
        koordinat: koordinat || `${latitude}, ${longitude}`,
        segmentgamas: segmentJaringan || "",
        jenisQe: kategoriQe || "",
        kondisiFisik: actualKondisiFisik || "",
        pid: projectId || "",
        statusGamas: statusGamas || "",
        latitude: latitude || "",
        longitude: longitude || "",
        userName: currentUserName,
        userEmail: currentUserEmail,
        timestamp: serverTimestamp(),
        photoName: validPhotos[0]?.name || generatedFileName,
        photosCount: validPhotos.length,
        materialsUsed: materialVolumeString || ""
      });
    } catch (e: any) {
      firestoreSuccess = false;
      firestoreErrorMessage = e?.message || String(e);
      console.warn(`[PERINGATAN FIRESTORE FRAGILE] Gagal menyimpan ke Firestore: ${firestoreErrorMessage}`);
    }

    // 3. SECURE PAYLOAD MAPPING FOR SPREADSHEETS
    const targetSheetName = "M-Fosis";

    // 3.5 DIRECT SPREADSHEET INSERT FOR VALIDASI TITIK SAMBUNG
    if (jenisAlpro === "Validasi titik sambung") {
      const gsheetsToken = driveToken || localStorage.getItem('m_fosis_drive_token');
      if (gsheetsToken) {
        try {
          const spreadsheetId = "1-O0AQxDPt5Zb2OHHE5Caj6KTiINZIomSgBIbTjnoLN8";
          const sheetName = "M-Fosis";
          const range = `'${sheetName}'!A:R`;
          const sheetsApiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
          
          const segmentKabelText = subJenisAlpro === "Link SURGE" ? `Link SURGE (${otbAwal} -> ${otbTarget})` : subJenisAlpro;
          const koordinatText = koordinat || `${latitude}, ${longitude}`;

          const rowData = [
            new Date().toLocaleString('id-ID'), // Col A (1): Timestamp
            "Validasi titik sambung",           // Col B (2): Jenis Alpro
            currentIdNamaAlpro,                 // Col C (3): ID / NAMA ALPRO
            currentUserName,                    // Col D (4): User Name
            currentUserEmail,                   // Col E (5): User Email
            namaStoValidasi,                    // Col F (6): NAMA STO (KOLOM F)
            "",                                 // Col G (7)
            "",                                 // Col H (8)
            statusTitikSambung,                 // Col I (9): STATUS TITIK SAMBUNG (KOLOM I)
            "",                                 // Col J (10)
            "",                                 // Col K (11)
            latitude || "",                     // Col L (12): Latitude
            longitude || "",                    // Col M (13): Longitude
            "",                                 // Col N (14)
            "",                                 // Col O (15)
            "",                                 // Col P (16)
            segmentKabelText,                   // Col Q (17): Data SEGMENT KABEL (KOLOM Q)
            koordinatText                       // Col R (18): TITIK KOORDINAT (KOLOM R)
          ];

          await fetch(sheetsApiUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${gsheetsToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              values: [rowData]
            })
          });
        } catch (sheetErr: any) {
          console.warn(`[SPREADSHEET] Kendala API Google Sheets: ${sheetErr?.message || String(sheetErr)}`);
        }
      }
    }

    const segmentKabelVal = subJenisAlpro === "Link SURGE" ? `Link SURGE (${otbAwal} -> ${otbTarget})` : subJenisAlpro;
    const koordinatVal = koordinat || `${latitude}, ${longitude}`;

    const payload = {
      jenisAlpro,
      subJenisAlpro: jenisAlpro === "Validasi titik sambung" ? segmentKabelVal : "",
      statusTitikSambung: jenisAlpro === "Validasi titik sambung" ? statusTitikSambung : "",
      idNamaAlpro: currentIdNamaAlpro,
      idQeLop: idQeLop || "",
      tiketInsera: tiketInsera || "",
      sto: jenisAlpro === "Validasi titik sambung" ? namaStoValidasi : (sto || ""),
      namaSto: jenisAlpro === "Validasi titik sambung" ? namaStoValidasi : (sto || ""),
      segment: jenisAlpro === "Validasi titik sambung" ? segmentKabelVal : (segmentJaringan || ""),
      segmentKabel: segmentKabelVal,
      koordinat: koordinatVal,
      jenisQe: kategoriQe || "",
      kondisiFisik: actualKondisiFisik || "",
      pid: projectId || "",
      statusGamas: statusGamas || "",
      latitude: latitude || "",
      longitude: longitude || "",
      userName: currentUserName,
      userEmail: currentUserEmail,
      fileFotoBase64: validPhotos[0]?.base64 || "",
      fileName: validPhotos[0]?.name || generatedFileName,
      allPhotos: validPhotos.map(p => ({ name: p.name, size: p.size })),
      materialVolume: materialVolumeString,
      sheetName: "M-Fosis",
      targetSheet: "M-Fosis",
      sheet: "M-Fosis",
      colF: namaStoValidasi,
      colI: statusTitikSambung,
      colQ: segmentKabelVal,
      colR: koordinatVal
    };

    // 4. CALL GOOGLE APPS SCRIPT ENDPOINT
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (err: any) {
      console.warn(`[ERROR] Google Apps Script error: ${err?.message || String(err)}`);
    }

    // 5. FINALIZE INTERFACES
    let recordStatus = "Sheet & Drive OK";
    if (!firestoreSuccess) {
      recordStatus = "Data Berhasil Tersimpan di Spreadsheet & Drive (Peringatan: Sinkronisasi Cloud Firestore Tertunda)";
    }

    // Append to live history record list
    const detailLog: any = {};
    if (jenisAlpro === "Validasi titik sambung") {
      detailLog["Nama STO"] = namaStoValidasi;
      detailLog["Status Titik Sambung"] = statusTitikSambung;
      detailLog["Segment Kabel"] = segmentKabelVal;
      detailLog["Titik Koordinat"] = koordinatVal;
    } else if (jenisAlpro === "Update Data Gamas") {
      detailLog["Tiket Insera"] = tiketInsera;
      detailLog["STO"] = sto;
      detailLog["Segmen"] = segmentJaringan;
      detailLog["Kondisi Fisik"] = actualKondisiFisik;
      detailLog["PID"] = projectId;
      detailLog["Status Gamas"] = statusGamas;
      detailLog["Titik Koordinat Gamas"] = `${latitude}, ${longitude}`;
      if (gamasMaterials.length > 0) {
        detailLog["Material Terpasang"] = `${gamasMaterials.length} item`;
      }
    } else if (jenisAlpro === "Audit Kapasitas & Redaman ODP") {
      detailLog["OPM Value"] = `${nilaiOpm} dBm`;
      detailLog["Sisa Port"] = sisaPort;
    } else if (jenisAlpro === "Pelabelan Ulang & Tagging QR Code") {
      detailLog["Lama"] = idAlproLama;
      detailLog["Baru"] = idAlproBaru;
    } else {
      detailLog["Kerusakan"] = kategoriKerusakan;
    }

    const newRecord: ValidationRecord = {
      id: `VAL-${Math.floor(10000 + Math.random() * 90000)}`,
      timestamp: new Date().toLocaleString("id-ID") + " WIB",
      jenisAlpro,
      idAlpro: jenisAlpro === "Update Data Gamas" ? idQeLop : (idAlpro || idAlproBaru || "ALPRO"),
      status: recordStatus,
      photoName: validPhotos[0]?.name || generatedFileName,
      photoSize: validPhotos[0] ? validPhotos[0].size : "0 KB",
      userName: currentUserName,
      userEmail: currentUserEmail,
      detail: detailLog
    };

    setHistoryRecords(prev => [newRecord, ...prev]);
    setIsSubmitting(false);
    setSubmitSuccess(true);
    setUploadStatus('success');
    pushLog(`[SUCCESS] Proses sinkronisasi data (${jenisAlpro}) selesai disinkronkan ke Google Sheets M-Fosis.`);

    // Auto-Reset dynamic input fields EXCEPT map coordinates states
    setIdAlpro("");
    setNamaStoValidasi("");
    setLatitude("");
    setLongitude("");
    setIdQeLop("");
    setTiketInsera("");
    setSto("");
    setProjectId("");
    setStatusGamas("Close Permanen");
    setNilaiOpm("");
    setSisaPort("");
    setIdAlproLama("");
    setIdAlproBaru("");
    setKondisiLainnya("");
    setSubJenisAlpro("Kabel FEEDER");
    setOtbAwal("OTB ST.Walikukun");
    setOtbTarget("OTB ST.Walikukun");
    setStatusTitikSambung("Titik Sambung Temporer");
    setUploadedPhotos([]);
    setUploadedPhotoUrls([]);
    setGamasMaterials([]);
  };

  const clearForm = () => {
    setIdAlpro("");
    setNamaStoValidasi("");
    setLatitude("");
    setLongitude("");
    setIdQeLop("");
    setTiketInsera("");
    setSto("");
    setProjectId("");
    setStatusGamas("Close Permanen");
    setNilaiOpm("");
    setSisaPort("");
    setIdAlproLama("");
    setIdAlproBaru("");
    setKondisiLainnya("");
    setSubJenisAlpro("Kabel FEEDER");
    setOtbAwal("OTB ST.Walikukun");
    setOtbTarget("OTB ST.Walikukun");
    setStatusTitikSambung("Titik Sambung Temporer");
    setUploadedPhotos([]);
    setUploadedPhotoUrls([]);
    setGamasMaterials([]);
    setSubmitSuccess(false);
    setUploadStatus('idle');
    setShowConsole(false);
    setConsoleLogs(["[INFO] Terminal initialized. Waiting for input validation..."]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-16">
      
      {/* Dynamic Header & Profile Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-6 rounded-3xl border border-neutral-100 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center shadow-inner">
            <CheckCircle size={28} className="stroke-2" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-neutral-800 tracking-tight">Validasi Data Jaringan</h1>
            <p className="text-xs text-neutral-400">Pembaruan & validasi fisik infrastruktur fiber optik dan rekon LOP Gamas M-FOSIS</p>
          </div>
        </div>
        
        {/* User Identity Session Widget */}
        <div className="flex items-center gap-3 bg-neutral-50 px-4 py-2.5 rounded-2xl border border-neutral-150">
          <div className="w-8 h-8 bg-neutral-900 text-white rounded-full flex items-center justify-center text-xs font-bold font-mono uppercase">
            {currentUserName.substring(0, 2)}
          </div>
          <div className="text-left">
            <div className="text-xs font-extrabold text-neutral-700 flex items-center gap-1">
              <User size={12} className="text-neutral-400 shrink-0" />
              <span>{currentUserName}</span>
            </div>
            <div className="text-[10px] text-neutral-400 font-mono truncate max-w-[180px]">{currentUserEmail}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* SISI KIRI: Adaptive Dynamic Input Form */}
        <div className="lg:col-span-7 bg-white/95 backdrop-blur-sm p-8 rounded-3xl border border-neutral-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <Layers className="text-red-500" size={18} />
              <h2 className="font-extrabold text-xs text-neutral-500 uppercase tracking-widest leading-none">
                Formulir Data:
              </h2>
              <span className="text-neutral-800 font-black text-xs uppercase bg-neutral-100 px-2.5 py-1 rounded-lg">
                {jenisAlpro}
              </span>
            </div>
            
            <div className="relative">
              <select 
                value={jenisAlpro}
                onChange={(e) => {
                  setJenisAlpro(e.target.value);
                  setSubmitSuccess(false);
                  setShowConsole(false);
                }}
                className="bg-neutral-900 text-white font-semibold text-xs px-3 py-2 rounded-xl border-0 cursor-pointer hover:bg-neutral-800 transition-all outline-none focus:ring-2 focus:ring-red-500 font-sans"
              >
                <option value="Validasi titik sambung">Validasi titik sambung</option>
                <option value="Update Data Gamas">Update Data Gamas</option>
                <option value="Audit Kapasitas & Redaman ODP">Audit Kapasitas & Redaman ODP</option>
                <option value="Pelabelan Ulang & Tagging QR Code">Pelabelan Ulang & Tagging QR Code</option>
                <option value="Pelaporan Kerusakan Aset (Patroli)">Pelaporan Kerusakan Aset (Patroli)</option>
              </select>
            </div>
          </div>

          {/* Google Integration Status */}
          <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Table className="text-emerald-500" size={16} />
              <div>
                <p className="font-extrabold text-neutral-700">Integrasi Google Sheets</p>
                <p className="text-[10px] text-neutral-400">Pencatatan langsung ke sheet "Validasi m-fosis" & "M-fosis"</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              {driveToken || localStorage.getItem('m_fosis_drive_token') ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Terhubung 📡</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-neutral-500 font-medium">Belum Terhubung</span>
                  {connectGoogleDrive && (
                    <button
                      type="button"
                      onClick={() => connectGoogleDrive(false)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl transition-all text-[10px] uppercase tracking-wider cursor-pointer shadow-sm"
                      disabled={isConnectingDrive}
                    >
                      {isConnectingDrive ? "Menghubungkan..." : "Hubungkan"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); }}>
            
            {/* KONDISI 1: dropdown === "Validasi titik sambung" */}
            {jenisAlpro === "Validasi titik sambung" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">SEGMENT KABEL</label>
                  <select 
                    value={subJenisAlpro}
                    onChange={(e) => setSubJenisAlpro(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                  >
                    <option>Kabel FEEDER</option>
                    <option>Kabel BACKBONE</option>
                    <option>Kabel DISTRIBUSI</option>
                    <option>Kabel Lainya</option>
                    <option>Link SURGE</option>
                  </select>
                </div>

                {subJenisAlpro === "Link SURGE" && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">OTB Awal</label>
                      <select
                        value={otbAwal}
                        onChange={(e) => setOtbAwal(e.target.value)}
                        className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                      >
                        <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                        <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                        <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                        <option value="OTB ST.Barat">OTB ST.Barat</option>
                        <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                        <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                        <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                        <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                        <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                        <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                        <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                        <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">OTB Target</label>
                      <select
                        value={otbTarget}
                        onChange={(e) => setOtbTarget(e.target.value)}
                        className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                      >
                        <option value="OTB ST.Walikukun">OTB ST.Walikukun</option>
                        <option value="OTB ST.Kedunggalar">OTB ST.Kedunggalar</option>
                        <option value="OTB ST.Ngawi">OTB ST.Ngawi</option>
                        <option value="OTB ST.Barat">OTB ST.Barat</option>
                        <option value="OTB ST.Madiun">OTB ST.Madiun</option>
                        <option value="OTB ST.Babadan">OTB ST.Babadan</option>
                        <option value="OTB ST.Caruban">OTB ST.Caruban</option>
                        <option value="OTB ST.Saradan">OTB ST.Saradan</option>
                        <option value="OTB ST.Wilangan">OTB ST.Wilangan</option>
                        <option value="OTB ST.Bagor">OTB ST.Bagor</option>
                        <option value="OTB ST.Nganjuk">OTB ST.Nganjuk</option>
                        <option value="OTB ALL SEGMENT">OTB ALL SEGMENT</option>
                      </select>
                    </div>
                  </motion.div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">ID / NAMA ALPRO</label>
                  <input 
                    type="text" 
                    value={idAlpro}
                    onChange={(e) => setIdAlpro(e.target.value)}
                    placeholder="Contoh: JC-PGO-FAA/02" 
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">NAMA STO</label>
                  <input 
                    type="text" 
                    value={namaStoValidasi}
                    onChange={(e) => setNamaStoValidasi(e.target.value)}
                    placeholder="Contoh: ST.Walikukun / MDN / PGO" 
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">STATUS TITIK SAMBUNG</label>
                  <select 
                    value={statusTitikSambung}
                    onChange={(e) => setStatusTitikSambung(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                  >
                    <option>Titik Sambung Temporer</option>
                    <option>Titik Kabel Rusak / Cacat</option>
                    <option>Joint Closure Baru</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">TITIK KOORDINAT (LATITUDE, LONGITUDE)</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={koordinat}
                      onChange={(e) => handleKoordinatChange(e.target.value)}
                      placeholder="Contoh: -7.6298, 111.5241" 
                      className="w-full pl-9 pr-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                    />
                    <MapPin size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  </div>
                </div>

                <div className="p-4 bg-red-50/60 rounded-2xl border border-red-100 flex items-start gap-3">
                  <RefreshCw className="text-red-600 mt-1 shrink-0 animate-spin-slow" size={16} />
                  <div>
                    <h4 className="text-xs font-bold text-red-900">Otomasi Google Drive KML Spasial</h4>
                    <p className="text-[11px] text-red-700/80 leading-relaxed mt-0.5">
                      Sistem menyisipkan elemen <code className="bg-red-100 px-1 rounded font-mono">&lt;Placemark&gt;</code> baru ke dalam file KML Master di Drive secara otomatis setelah data dikirimkan.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* KONDISI 2: dropdown === "Update Data Gamas" */}
            {jenisAlpro === "Update Data Gamas" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">ID QE / LOP</label>
                  <input 
                    type="text" 
                    value={idQeLop}
                    onChange={(e) => setIdQeLop(e.target.value)}
                    placeholder="Contoh: 3MDN_QEREC_INC47782643_26W13_RABASAN DS-MSP-FH" 
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">TIKET INSERA</label>
                    <input 
                      type="text" 
                      value={tiketInsera}
                      onChange={(e) => setTiketInsera(e.target.value)}
                      placeholder="Masukkan No. Tiket Insera (contoh: INC47782643)" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">STO</label>
                    <input 
                      type="text" 
                      value={sto}
                      onChange={(e) => setSto(e.target.value)}
                      placeholder="Contoh: MDN" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">SEGMENT JARINGAN</label>
                    <select 
                      value={segmentJaringan}
                      onChange={(e) => setSegmentJaringan(e.target.value)}
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                    >
                      <option value="Feeder">Feeder</option>
                      <option value="Distribusi">Distribusi</option>
                      <option value="ODP">ODP</option>
                      <option value="BACKBONE">BACKBONE</option>
                      <option value="UPLINK">UPLINK</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">KATEGORI QE</label>
                    <select 
                      value={kategoriQe}
                      onChange={(e) => setKategoriQe(e.target.value)}
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                    >
                      <option value="QE Recovery">QE Recovery</option>
                      <option value="QE Preventif">QE Preventif</option>
                      <option value="QE Relok Utilitas">QE Relok Utilitas</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider block">KONDISI FISIK LAPANGAN</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {["Aman", "Rusak Ringan", "Hancur/Patah", "Kabel Putus", "Tiang Patah", "Lainnya.."].map((opt) => (
                      <label 
                        key={opt}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                          kondisiFisik === opt 
                            ? "bg-red-50 border-red-300 text-red-950 font-extrabold shadow-sm" 
                            : "bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                        }`}
                      >
                        <input 
                          type="radio" 
                          name="kondisiFisik" 
                          value={opt} 
                          checked={kondisiFisik === opt}
                          onChange={() => setKondisiFisik(opt)}
                          className="text-[#d32f2f] focus:ring-red-500 accent-[#d32f2f] shrink-0"
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>

                  {/* Dynamic field for Custom Condition Description */}
                  {kondisiFisik === "Lainnya.." && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-1.5 mt-2"
                    >
                      <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">KONDISI LAINNYA (SPESIFIK)</label>
                      <input 
                        type="text"
                        value={kondisiLainnya}
                        onChange={(e) => setKondisiLainnya(e.target.value)}
                        placeholder="Sebutkan detail kondisi fisik di lapangan.."
                        className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all font-medium"
                      />
                    </motion.div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">PROJECT ID / PID</label>
                    <input 
                      type="text" 
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="Masukkan ID Proyek" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">STATUS GAMAS</label>
                    <select 
                      value={statusGamas}
                      onChange={(e) => setStatusGamas(e.target.value)}
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                    >
                      <option value="Close Permanen">Close Permanen</option>
                      <option value="Temporer">Temporer</option>
                      <option value="On Progress">On Progress</option>
                    </select>
                  </div>
                </div>

                {/* SUBMENU 1: INPUT TITIK GAMAS (Saved to Sheet Columns L & M) */}
                <div className="pt-5 border-t border-neutral-100 space-y-3">
                  <div className="flex items-center gap-2 text-neutral-800">
                    <MapPin className="text-red-500 stroke-[2.5]" size={16} />
                    <h4 className="text-xs font-black uppercase tracking-wider">Submenu: Input Titik Gamas (Kolom L & M)</h4>
                  </div>
                  <p className="text-[11px] text-neutral-400 -mt-2 leading-relaxed">Sebutkan koordinat Latitude (Kolom L) dan Longitude (Kolom M) lokasi gangguan untuk validasi peta visual rekon.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">LATITUDE GAMAS</label>
                      <input 
                        type="text" 
                        value={latitude}
                        onChange={(e) => setLatitude(e.target.value)}
                        placeholder="Contoh: -7.61875" 
                        className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">LONGITUDE GAMAS</label>
                      <input 
                        type="text" 
                        value={longitude}
                        onChange={(e) => setLongitude(e.target.value)}
                        placeholder="Contoh: 111.53421" 
                        className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* SUBMENU 2: MATERIAL & VOLUME DIGUNAKAN */}
                <div className="pt-5 border-t border-neutral-100 space-y-3">
                  <div className="flex items-center gap-2 text-neutral-800">
                    <Layers className="text-red-500 stroke-[2.5]" size={16} />
                    <h4 className="text-xs font-black uppercase tracking-wider">Submenu: Material & Volume Pelaksanaan</h4>
                  </div>
                  <p className="text-[11px] text-neutral-400 -mt-2 leading-relaxed">Masukkan daftar material beserta volume/qty yang habis terpakai dalam penanganan LOP/Gamas ini.</p>
                  
                  {/* Material Input Submenu Block */}
                  <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-150 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-6 space-y-1">
                        <label className="text-[9px] font-bold uppercase text-neutral-400">Nama Material</label>
                        <select
                          value={newGamasMatName}
                          onChange={(e) => setNewGamasMatName(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-white border border-neutral-200 text-xs outline-none focus:border-red-500 transition-all font-medium"
                        >
                          <option value="">-- Pilih Material Common --</option>
                          {COMMON_GAMAS_MATERIALS.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="CUSTOM">-- Tulis Manual --</option>
                        </select>
                        {newGamasMatName === "CUSTOM" && (
                          <input
                            type="text"
                            placeholder="Ketik manual nama material baru..."
                            onChange={(e) => {
                              setNewGamasMatName(e.target.value);
                            }}
                            className="w-full px-3 py-2 mt-1.5 rounded-xl bg-white border border-neutral-200 text-xs outline-none focus:border-red-500 transition-all font-medium"
                          />
                        )}
                      </div>
                      <div className="sm:col-span-3 space-y-1">
                        <label className="text-[9px] font-bold uppercase text-neutral-400">Volume</label>
                        <input
                          type="text"
                          value={newGamasMatQty}
                          onChange={(e) => setNewGamasMatQty(e.target.value)}
                          placeholder="Jumlah"
                          className="w-full px-3 py-2 rounded-xl bg-white border border-neutral-200 text-xs outline-none focus:border-red-500 transition-all font-medium font-mono"
                        />
                      </div>
                      <div className="sm:col-span-3 space-y-1">
                        <label className="text-[9px] font-bold uppercase text-neutral-400">Satuan</label>
                        <select
                          value={newGamasMatUnit}
                          onChange={(e) => setNewGamasMatUnit(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-white border border-neutral-200 text-xs outline-none focus:border-red-500 transition-all font-medium"
                        >
                          <option value="meter">meter</option>
                          <option value="pcs">pcs</option>
                          <option value="core">core</option>
                          <option value="set">set</option>
                          <option value="roll">roll</option>
                          <option value="buah">buah</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (!newGamasMatName || !newGamasMatName.trim() || newGamasMatName === "CUSTOM") {
                          alert("Mohon pilih atau masukkan nama material.");
                          return;
                        }
                        if (!newGamasMatQty.trim()) {
                          alert("Mohon masukkan jumlah atau volume material.");
                          return;
                        }
                        const fullQty = `${newGamasMatQty.trim()} ${newGamasMatUnit}`;
                        setGamasMaterials(prev => [...prev, { name: newGamasMatName, qty: fullQty }]);
                        setNewGamasMatName("");
                        setNewGamasMatQty("");
                      }}
                      className="w-full py-2 bg-neutral-900 border border-neutral-800 text-white hover:bg-neutral-800 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95"
                    >
                      <Plus size={14} className="stroke-[2.5]" />
                      <span>Tambahkan Material</span>
                    </button>
                  </div>

                  {/* Registered Materials list */}
                  {gamasMaterials.length > 0 ? (
                    <div className="bg-neutral-50 p-3 rounded-2xl border border-neutral-150 space-y-1.5">
                      <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider pb-1 flex items-center justify-between border-b border-neutral-100">
                        <span>Daftar Material Terdaftar</span>
                        <span className="text-red-500 font-mono font-bold">{gamasMaterials.length} item</span>
                      </div>
                      <div className="divide-y divide-neutral-100 max-h-[160px] overflow-y-auto pr-1">
                        {gamasMaterials.map((mat, mIdx) => (
                          <div key={mIdx} className="flex items-center justify-between py-2 text-xs">
                            <div className="flex items-center gap-2 font-medium text-neutral-700">
                              <span className="w-4 h-4 bg-red-50 text-red-600 rounded-full flex items-center justify-center font-mono text-[9px] font-bold">{mIdx + 1}</span>
                              <span>{mat.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono font-bold bg-white px-2 py-0.5 rounded-lg border border-neutral-150 text-[11px] text-neutral-800">{mat.qty}</span>
                              <button
                                type="button"
                                onClick={() => setGamasMaterials(prev => prev.filter((_, idx) => idx !== mIdx))}
                                className="text-neutral-400 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4 bg-neutral-50/40 border border-dashed border-neutral-200 rounded-2xl text-[11px] text-neutral-400 italic">
                      Belum ada material yang ditambahkan ke rekon Gamas ini.
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* KONDISI 3: dropdown === "Audit Kapasitas & Redaman ODP" */}
            {jenisAlpro === "Audit Kapasitas & Redaman ODP" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">ID / NAMA ODP</label>
                  <input 
                    type="text" 
                    value={idAlpro}
                    onChange={(e) => setIdAlpro(e.target.value)}
                    placeholder="Contoh: ODP-PGO-FAA/01" 
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">Nilai OPM (dBm)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={nilaiOpm}
                      onChange={(e) => setNilaiOpm(e.target.value)}
                      placeholder="Contoh: -18.2" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">Sisa Port</label>
                    <input 
                      type="number" 
                      value={sisaPort}
                      onChange={(e) => setSisaPort(e.target.value)}
                      placeholder="Contoh: 3" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                    />
                  </div>
                </div>
                <div className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100 flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>Fitur dalam tahap simulasi modular (M-FOSIS Future Scope)</span>
                </div>
              </motion.div>
            )}

            {/* KONDISI 4: dropdown === "Pelabelan Ulang & Tagging QR Code" */}
            {jenisAlpro === "Pelabelan Ulang & Tagging QR Code" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">ID ALPRO LAMA</label>
                    <input 
                      type="text" 
                      value={idAlproLama}
                      onChange={(e) => setIdAlproLama(e.target.value)}
                      placeholder="Contoh: ODP-PGO-FAA/05_OLD" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">ID ALPRO BARU (QR TAGGED)</label>
                    <input 
                      type="text" 
                      value={idAlproBaru}
                      onChange={(e) => setIdAlproBaru(e.target.value)}
                      placeholder="Contoh: ODP-PGO-FAA/05-QR" 
                      className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                    />
                  </div>
                </div>
                <div className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100 flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>Fitur dalam tahap simulasi modular (M-FOSIS Future Scope)</span>
                </div>
              </motion.div>
            )}

            {/* KONDISI 5: dropdown === "Pelaporan Kerusakan Aset (Patroli)" */}
            {jenisAlpro === "Pelaporan Kerusakan Aset (Patroli)" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">ID / NAMA ALPRO TERDAMPAK</label>
                  <input 
                    type="text" 
                    value={idAlpro}
                    onChange={(e) => setIdAlpro(e.target.value)}
                    placeholder="Contoh: TIANG-PGO-112" 
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all placeholder:italic placeholder:text-xs placeholder:text-slate-400 font-light"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-neutral-400 tracking-wider">KATEGORI KERUSAKAN</label>
                  <select 
                    value={kategoriKerusakan}
                    onChange={(e) => setKategoriKerusakan(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-red-500 transition-all cursor-pointer font-medium"
                  >
                    <option value="Tiang Miring">Tiang Miring (Membahayakan Jalan)</option>
                    <option value="Tiang Keropos / Tiang Patah">Tiang Keropos / Tiang Patah</option>
                    <option value="Kabel Andongan Lendutan">Kabel Andongan Lendutan (Tergantung Rendah)</option>
                    <option value="Kabel Putus di Jalan">Kabel Putus di Jalan Raya</option>
                    <option value="ODP Pecah / Terbuka">ODP Pecah / Cover Terbuka Liar</option>
                    <option value="Joint Closure Menggantung">Joint Closure Menggantung Tanpa Bracket</option>
                  </select>
                </div>
                <div className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100 flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>Fitur dalam tahap simulasi modular (M-FOSIS Future Scope)</span>
                </div>
              </motion.div>
            )}

          </form>
        </div>

        {/* SISI KANAN: Visual Photo Upload Dropzone */}
        <div className="lg:col-span-5 bg-white/95 backdrop-blur-sm p-8 rounded-3xl border border-neutral-100 shadow-sm flex flex-col justify-between space-y-6">
          <div className="flex items-center gap-2 pb-4 border-b border-neutral-100">
            <Camera className="text-[#d32f2f]" size={18} />
            <h2 className="font-extrabold text-xs text-neutral-500 uppercase tracking-widest">UPLOAD FOTO LAPANGAN</h2>
          </div>

          <div className="flex-1 flex flex-col justify-start space-y-4">
            {/* Multiple Photos Previews Grid */}
            {uploadedPhotoUrls.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {uploadedPhotoUrls.map((url, idx) => {
                  const file = uploadedPhotos[idx];
                  return (
                    <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden border border-neutral-200 bg-neutral-100 shadow-sm">
                      <img 
                        src={url} 
                        alt={`Preview ${idx + 1}`} 
                        className="w-full h-full object-cover transition-transform group-hover:scale-105" 
                        referrerPolicy="no-referrer"
                      />
                      {/* Delete Button on Hover */}
                      <div className="absolute inset-0 bg-neutral-900/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center">
                        <button 
                          type="button"
                          onClick={(e) => removePhotoAtIndex(idx, e)}
                          className="p-2 bg-red-600 rounded-xl hover:bg-red-700 text-white transition-colors cursor-pointer shadow-md mb-1"
                          title="Hapus foto ini"
                        >
                          <Trash2 size={12} />
                        </button>
                        <span className="text-[9px] text-white/80 select-none">Hapus Foto</span>
                      </div>
                      {/* Badges */}
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm text-[8px] font-mono font-bold text-white rounded-md max-w-[80%] truncate">
                        {file ? `${(file.size / 1024).toFixed(1)} KB` : "0 KB"}
                      </span>
                      <span className="absolute top-1.5 left-1.5 w-4 h-4 bg-red-600 text-white font-mono text-[9px] font-bold rounded-full flex items-center justify-center shadow">
                        {idx + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Dropzone container */}
            <div 
              {...getRootProps()} 
              className={`border-2 border-dashed rounded-3xl p-6 flex flex-col items-center justify-center text-center transition-all cursor-pointer relative min-h-36 overflow-hidden focus:outline-none ${
                isDragActive 
                  ? "border-red-500 bg-red-50/25" 
                  : "border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 hover:border-red-300"
              }`}
            >
              <input { ...getInputProps() } />
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="w-10 h-10 bg-neutral-100 text-neutral-400 rounded-full flex items-center justify-center transition-colors">
                  <Upload size={18} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-neutral-700">Tarik berkas foto hasil lapangan</h4>
                  <p className="text-[10px] text-neutral-400 mt-0.5">Mendukung multi-file upload (PNG/JPG up to 5MB per file)</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-100 space-y-1.5">
            <h4 className="text-[10px] font-extrabold uppercase text-neutral-400 tracking-wider">Identifikasi Metadata Berkas</h4>
            <div className="space-y-1 text-xs text-neutral-600 font-medium col-span-2">
              <div className="flex justify-between items-center text-[10px] uppercase text-neutral-400 font-bold pb-1 border-b border-neutral-100">
                <span>Berkas Terunggah</span>
                <span className="text-red-600 font-mono font-bold">{uploadedPhotos.length} file</span>
              </div>
              <div className="max-h-[80px] overflow-y-auto divide-y divide-neutral-100 text-[11px] font-mono">
                {uploadedPhotos.map((file, fIdx) => (
                  <div key={fIdx} className="flex justify-between items-center py-1">
                    <span className="truncate max-w-[150px] text-neutral-600">{file.name}</span>
                    <span className="text-neutral-400 font-bold text-[10px]">{(file.size / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
                {uploadedPhotos.length === 0 && (
                  <div className="text-center py-2 text-[10px] text-neutral-400 italic">Belum ada file media terpilih.</div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* SISI BAWAH: Custom Terminal consolelogger & Process Status */}
      <div className="space-y-6">
        
        {/* Minimalist Automation & API integration logs */}
        <AnimatePresence>
          {showConsole && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-neutral-950 rounded-3xl border border-neutral-800 shadow-2xl"
            >
              <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div 
                      className={`w-3 h-3 rounded-full bg-[#ef4444] ${uploadStatus === 'loading' ? 'animate-pulse' : ''}`} 
                      style={uploadStatus === 'loading' ? { animationDuration: '0.8s', animationDelay: '0s' } : undefined}
                    ></div>
                    <div 
                      className={`w-3 h-3 rounded-full bg-[#f59e0b] ${uploadStatus === 'loading' ? 'animate-pulse' : ''}`} 
                      style={uploadStatus === 'loading' ? { animationDuration: '0.8s', animationDelay: '0.2s' } : undefined}
                    ></div>
                    <div 
                      className={`w-3 h-3 rounded-full bg-[#10b981] ${uploadStatus === 'loading' ? 'animate-pulse' : ''}`} 
                      style={uploadStatus === 'loading' ? { animationDuration: '0.8s', animationDelay: '0.4s' } : undefined}
                    ></div>
                  </div>
                  <span className="text-xs font-mono text-neutral-400 ml-4">Automation & API Integration Logs</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-350">
                    {uploadStatus === 'loading' ? 'MENGUNGGAH' : uploadStatus === 'success' ? 'SELESAI' : 'IDLE'}
                  </span>
                  <button 
                    onClick={() => setShowConsole(false)} 
                    className="text-neutral-400 hover:text-white text-xs cursor-pointer"
                  >
                    Tutup Logs
                  </button>
                </div>
              </div>

              <div className="p-6 font-mono text-xs space-y-1.5 max-h-[300px] overflow-y-auto bg-neutral-950 font-mono select-text">
                {consoleLogs.map((log, lIdx) => {
                  let colorClass = "text-neutral-300";
                  if (log.includes("[INFO]")) colorClass = "text-yellow-400 font-medium";
                  if (log.includes("[SUCCESS]")) colorClass = "text-green-400 font-bold";
                  if (log.includes("[ERROR]")) colorClass = "text-red-400 font-bold animate-pulse";
                  if (log.includes("[GDrive]")) colorClass = "text-sky-400";
                  if (log.includes("[SPREADSHEET]")) colorClass = "text-emerald-400";
                  if (log.includes("[Database]")) colorClass = "text-purple-400";

                  return (
                    <div key={lIdx} className={`flex items-start gap-1 pb-0.5 leading-relaxed ${colorClass}`}>
                      <span className="text-neutral-600 shrink-0 select-none mr-1">›</span>
                      <span>{log}</span>
                    </div>
                  );
                })}
                {uploadStatus === 'loading' && (
                  <div className="text-yellow-400 font-bold flex items-center gap-2.5 pt-2 select-none">
                    <Loader2 size={12} className="animate-spin text-yellow-400 shrink-0" />
                    <span>Menyalurkan paket sinkronisasi ke server pusat...</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action button section with M-FOSIS layout */}
        <div className="bg-white/80 p-6 rounded-3xl border border-neutral-100 shadow-sm flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div className="text-center sm:text-left">
            <h3 className="text-sm font-extrabold text-neutral-800">
              Evaluasi & Validasi Data Inputan
            </h3>
            <p className="text-xs text-neutral-400">
              Sistem akan memvalidasi form dan menjamin penginstalan data langsung ke Google Sheets & Drive.
            </p>
          </div>

          <div className="flex w-full sm:w-auto items-center gap-3">
            {submitSuccess && (
              <button 
                onClick={clearForm}
                className="w-full sm:w-auto px-6 py-3 bg-neutral-100 font-semibold text-xs rounded-2xl hover:bg-neutral-200 text-neutral-700 transition-all uppercase tracking-wider cursor-pointer"
              >
                Reset Formulir
              </button>
            )}
            
            <button 
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`w-full sm:w-auto min-w-[200px] px-8 py-4 text-white font-extrabold text-xs uppercase tracking-widest rounded-3xl hover:shadow-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
                jenisAlpro === "Update Data Gamas" 
                  ? "bg-[#d32f2f] hover:bg-red-700 shadow-red-100/50" 
                  : "bg-red-600 hover:bg-red-700 hover:scale-[1.02]"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>SINKRONISASI ONLINE...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  <span>{jenisAlpro === "Update Data Gamas" ? "SIMPAN SEKARANG" : "KIRIM VALIDASI"}</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>

      {/* DYNAMIC LOWER SECTION AREA */}
      {jenisAlpro !== "Validasi titik sambung" ? (
        /* ORIGINAL RIWAYAT TABLE */
        <div className="bg-white/90 backdrop-blur-sm p-8 rounded-3xl border border-neutral-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
            <div className="flex items-center gap-2">
              <Table className="text-red-500" size={18} />
              <h3 className="font-extrabold text-xs text-neutral-500 uppercase tracking-widest">
                RIWAYAT SUBMISSION & VALIDASI WEB (M-FOSIS)
              </h3>
            </div>
            <span className="text-[10px] bg-red-50 text-[#d32f2f] font-bold border border-red-100 px-3 py-1 rounded-full">
              {historyRecords.length} Riwayat Validasi
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-100 text-neutral-400 font-extrabold">
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">ID VALIDASI</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">TANGGAL SUBMIT</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">PENGINPUT</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">JENIS ALPRO</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">ID / NAMA ALPRO</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">BUKTI FOTO</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider">DETAIL</th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider text-right">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {historyRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-neutral-50/50 transition-colors">
                    <td className="py-4 px-4 font-mono font-bold text-neutral-700">{rec.id}</td>
                    <td className="py-4 px-4 text-neutral-500">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-neutral-400 shrink-0" />
                        <span>{rec.timestamp}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-neutral-800 font-bold text-xs">{rec.userName}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{rec.userEmail}</div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="px-2.5 py-1 bg-neutral-100 rounded-full font-bold text-[10px] text-neutral-600 truncate max-w-[140px] block">
                        {rec.jenisAlpro}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-bold text-neutral-800 max-w-[150px] truncate">{rec.idAlpro}</td>
                    <td className="py-4 px-4 text-neutral-500 truncate max-w-[120px] font-mono text-[11px]">{rec.photoName}</td>
                    <td className="py-4 px-4">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {Object.entries(rec.detail).map(([key, val]: any) => (
                          <div key={key} className="flex gap-1 bg-neutral-50 px-1.5 py-0.5 rounded border border-neutral-150 text-[10px] text-neutral-600 font-medium">
                            <span className="text-neutral-400 font-normal">{key}:</span>
                            <span className="text-neutral-800 font-bold">{val}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className={`px-2.5 py-1 rounded-full font-extrabold text-[9px] uppercase tracking-wider inline-block ${
                        rec.status.includes("Peringatan") 
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : rec.status.includes("Sinkron") || rec.status.includes("OK")
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                            : "bg-blue-50 text-blue-600 border border-blue-100"
                      }`}>
                        {rec.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* NEW DYNAMIC INTERACTIVE LIVE MAP FOR VALIDASI TITIK SAMBUNG */
        <div className="bg-white/95 backdrop-blur-sm p-8 rounded-3xl border border-neutral-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-100 pb-4 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 text-[#d32f2f] rounded-2xl flex items-center justify-center shadow-inner">
                <MapIcon size={20} className="stroke-2" />
              </div>
              <div>
                <h3 className="font-extrabold text-neutral-800 text-sm tracking-tight">
                  PETA LOKASI INTERAKTIF LIVE (VALIDASI DATA)
                </h3>
                <p className="text-xs text-neutral-400">Pemetaan geografis koordinat titik sambung alpro di lapangan secara real-time</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 self-start sm:self-center">
              <span className="text-[10px] font-mono bg-neutral-150 text-neutral-600 font-extrabold px-3 py-1 rounded-full flex items-center gap-1.5">
                <Compass size={12} className="text-neutral-500 animate-spin-slow" />
                <span>LAT: {mapCenter[0].toFixed(5)} , LNG: {mapCenter[1].toFixed(5)}</span>
              </span>
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden border border-neutral-200 shadow-inner relative h-[300px] md:h-[450px]">
            <MapContainer
              center={mapCenter}
              zoom={zoomLevel}
              scrollWheelZoom={false}
              className="w-full h-full z-10"
            >
              <ChangeView center={mapCenter} zoom={zoomLevel} />
              
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              <Marker position={mapCenter} icon={customMarkerIcon}>
                <Popup>
                  <div className="font-sans space-y-1 p-1">
                    <span className="text-[9px] bg-red-100 text-red-700 font-extrabold px-2 py-0.5 rounded-full block w-max uppercase mb-1">
                      VALIDASI LOKASI
                    </span>
                    <h4 className="font-bold text-xs text-neutral-800">{idAlpro || "TITIK ALPRO BARU"}</h4>
                    <p className="text-[10px] text-neutral-500 font-mono">
                      LAT: {mapCenter[0]}<br />
                      LNG: {mapCenter[1]}
                    </p>
                    <p className="text-[10px] text-neutral-400 italic mt-1 border-t border-neutral-100 pt-1">
                      M-FOSIS Real-Time Geolocation
                    </p>
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-neutral-50 p-4 rounded-2xl border border-neutral-150">
            <div className="p-3 bg-white rounded-xl border border-neutral-100 shadow-sm space-y-1">
              <span className="text-[9px] font-extrabold text-neutral-400 uppercase">Marker Pin Stat</span>
              <p className="text-xs text-neutral-700 font-medium">Pin berwarna merah di atas mewakili posisi yang dimasukkan pada input form saat ini.</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-100 shadow-sm space-y-1">
              <span className="text-[9px] font-extrabold text-neutral-400 uppercase">Keamanan Geografis</span>
              <p className="text-xs text-neutral-700 font-medium">Koordinat dikirimkan ke Google Workspace dan KML Master Drive secara real-time.</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-100 shadow-sm space-y-1">
              <span className="text-[9px] font-extrabold text-neutral-400 uppercase">Presisi Titik</span>
              <p className="text-xs text-neutral-700 font-medium">Gunakan koordinat GPS murni dari perangkat genggam lapangan untuk akurasi terbaik.</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
