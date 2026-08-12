import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { jsPDF } from "jspdf";

dotenv.config();

export const app = express();

app.use(express.json());

// Initialize Gemini client server-side
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API Route for server-side Gemini invocation
  app.post("/api/gemini/generate", async (req: express.Request, res: express.Response) => {
    try {
      const { contents, systemInstruction, model } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ 
          error: "GEMINI_API_KEY is not defined. Please add it to your system settings secrets." 
        });
      }

      // Helper function to call the Gemini API with automatic retries and model fallbacks on transient/high-demand errors
      const generateContentWithRetry = async (retriesLeft = 3, currentDelay = 1000, activeModel = model || "gemini-3.5-flash"): Promise<any> => {
        try {
          console.log(`[Gemini API] Requesting model: ${activeModel}`);
          return await ai.models.generateContent({
            model: activeModel,
            contents: contents,
            config: systemInstruction ? { systemInstruction } : undefined
          });
        } catch (err: any) {
          const errMsgString = JSON.stringify(err) || err.message || "";
          const isTransient = 
            err.status === 503 || 
            err.statusCode === 503 ||
            errMsgString.includes("503") ||
            errMsgString.includes("UNAVAILABLE") ||
            errMsgString.includes("demand") ||
            errMsgString.includes("temporary");

          if (isTransient && retriesLeft > 0) {
            // Determine next fallback model in the chain
            let nextModel = activeModel;
            if (activeModel === "gemini-3.5-flash") {
              nextModel = "gemini-3.1-flash-lite";
            } else {
              nextModel = "gemini-3.5-flash";
            }
            
            console.warn(`[Gemini API] Encountered transient high demand on ${activeModel}. Retrying with fallback model ${nextModel} in ${currentDelay}ms... (${retriesLeft} retries remaining)`);
            await new Promise((resolve) => setTimeout(resolve, currentDelay));
            return generateContentWithRetry(retriesLeft - 1, currentDelay * 1.5, nextModel);
          }
          throw err;
        }
      };

      const response = await generateContentWithRetry();

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API server-side execution error:", error);
      let errMsg = error.message || "Unknown error during Gemini generation.";
      if (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("demand") || errMsg.includes("demand is usually temporary")) {
        errMsg = "Layanan AI (Gemini) sedang mengalami kepadatan lalu lintas yang sangat tinggi (503 Service Unavailable). Mohon tunggu beberapa detik lalu tekan tombol analisa kembali.";
      }
      res.status(500).json({ error: errMsg });
    }
  });

  // API Route for Google Sheets GViz proxy (prevents client-side CORS / Failed to fetch errors)
  app.get("/api/sheets/gviz", async (req: express.Request, res: express.Response) => {
    try {
      const spreadsheetId = (req.query.spreadsheetId as string) || "1-O0AQxDPt5Zb2OHHE5Caj6KTiINZIomSgBIbTjnoLN8";
      const sheetName = (req.query.sheet as string) || "M-fosis";

      const urls = [
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`,
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
      ];

      for (const url of urls) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const text = await response.text();
            if (text && text.trim().length > 0) {
              res.setHeader("Content-Type", "text/plain");
              return res.send(text);
            }
          }
        } catch (fetchErr) {
          console.warn(`[Sheets Proxy] Failed to fetch URL ${url}:`, fetchErr);
        }
      }

      res.status(500).json({ error: "Gagal mengambil data dari Google Spreadsheet." });
    } catch (err: any) {
      console.error("[Sheets Proxy Internal Error]", err);
      res.status(500).json({ error: err.message || "Gagal terhubung ke Google Spreadsheet." });
    }
  });

  // API Route for manual spreadsheet login verification
  app.post("/api/auth/verify-login", async (req: express.Request, res: express.Response) => {
    try {
      const { username, userId, password } = req.body;
      const inputId = (username || userId || "").toString().trim();
      const inputPass = (password || "").toString().trim();

      if (!inputId) {
        return res.status(400).json({
          success: false,
          code: "MISSING_INPUT",
          message: "ID / USER tidak boleh kosong."
        });
      }

      console.log(`[Manual Login] Memverifikasi login untuk ID/USER: "${inputId}"...`);

      // Google Spreadsheet URL for sheet "LOGIN"
      const spreadsheetId = "1-yM2B0tN9A4ajHJmC6AoU-t98jM8njHscAZienhVGDU";
      const sheetUrls = [
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=LOGIN`,
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&sheet=LOGIN`
      ];

      let csvText = "";
      let fetchSuccess = false;

      for (const url of sheetUrls) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            csvText = await response.text();
            if (csvText && csvText.trim().length > 0) {
              fetchSuccess = true;
              break;
            }
          }
        } catch (fetchErr) {
          console.warn(`[Manual Login] Gagal mengambil spreadsheet dari URL ${url}:`, fetchErr);
        }
      }

      if (!fetchSuccess || !csvText) {
        console.error("[Manual Login Error] Gagal mengambil data login dari Google Spreadsheet.");
        return res.status(500).json({
          success: false,
          code: "FETCH_ERROR",
          message: "Gagal terhubung ke basis data spreadsheet login. Silakan coba beberapa saat lagi."
        });
      }

      // Helper CSV Parser
      const parseCSV = (text: string) => {
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length === 0) return [];

        const parseLine = (line: string) => {
          const result: string[] = [];
          let cur = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
              if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (c === ',' && !inQuotes) {
              result.push(cur.trim());
              cur = "";
            } else {
              cur += c;
            }
          }
          result.push(cur.trim());
          return result;
        };

        return lines.map(parseLine);
      };

      const rows = parseCSV(csvText);
      if (rows.length < 2) {
        console.error("[Manual Login Error] Spreadsheet tidak berisi data pengguna.");
        return res.status(500).json({
          success: false,
          code: "EMPTY_DATA",
          message: "Data pengguna tidak ditemukan di spreadsheet."
        });
      }

      // Rows format:
      // Row 0: Header (ID, NAMA, NO HP, EMAIL, NIK ATASAN, PASWORD, PREVILAGE USER, BERI OTORITAS)
      // Row 1+: Data
      const dataRows = rows.slice(1);
      const cleanInputId = inputId.toLowerCase();

      // Find user row by Column A (index 0)
      const userRow = dataRows.find(r => {
        const colA = (r[0] || "").toString().trim().toLowerCase();
        return colA === cleanInputId;
      });

      // Requirement: jika user tidak ada di kolom A maka munculkan pesan untuk "user meminta registrasi ke leader area"
      if (!userRow) {
        console.warn(`[Manual Login] ID/USER "${inputId}" TIDAK DITEMUKAN di Kolom A.`);
        return res.status(404).json({
          success: false,
          code: "USER_NOT_FOUND",
          message: "user belum terdaftar , silahkan register ke leader area"
        });
      }

      // Compare password from Column F (index 5)
      const dbPassword = (userRow[5] || "").toString().trim();
      if (dbPassword !== inputPass) {
        console.warn(`[Manual Login] Password untuk ID "${inputId}" salah.`);
        return res.status(401).json({
          success: false,
          code: "INVALID_PASSWORD",
          message: "Password tidak sesuai. Silakan periksa kembali password Anda."
        });
      }

      // Success!
      const userRole = (userRow[6] || "").toString().trim().toUpperCase() === "ADMIN" ? "admin" : "technician";
      const displayName = (userRow[1] || "").toString().trim() || inputId;
      const email = (userRow[3] || "").toString().trim() || `${inputId}@m-fosis.net`;

      console.log(`[Manual Login] Login BERHASIL untuk user "${displayName}" (${inputId}), Role: ${userRole}`);

      return res.json({
        success: true,
        user: {
          uid: inputId,
          username: inputId,
          displayName: displayName,
          email: email,
          role: userRole,
          phone: (userRow[2] || "").toString().trim(),
          nikAtasan: (userRow[4] || "").toString().trim(),
          autoritas: (userRow[7] || "").toString().trim()
        }
      });

    } catch (err: any) {
      console.error("[Manual Login Error] Kesalahan server internal:", err);
      return res.status(500).json({
        success: false,
        code: "SERVER_ERROR",
        message: "Terjadi kesalahan sistem saat memproses login: " + (err.message || String(err))
      });
    }
  });

  // Helper function to validate if a Google Access Token is active
  const isTokenActive = async (accessToken: string): Promise<boolean> => {
    try {
      console.log(`[Google OAuth Validation] Memeriksa status keaktifan access token...`);
      const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`);
      if (!res.ok) {
        console.warn(`[Google OAuth Validation] Token tidak valid atau habis masa berlaku (Status: ${res.status})`);
        return false;
      }
      console.log(`[Google OAuth Validation] Token masih aktif.`);
      return true;
    } catch (error) {
      console.error(`[Google OAuth Validation Error] Gagal memverifikasi token ke Google:`, error);
      return false;
    }
  };

  // API Route to refresh Google Drive Access Token using Google OAuth2 Refresh Token
  app.post("/api/auth/google/refresh", async (req: express.Request, res: express.Response) => {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        console.error("[Google OAuth Refresh] Autentikasi Gagal: Refresh token tidak disediakan");
        return res.status(400).json({ error: "Refresh token wajib disediakan" });
      }

      console.log("[Google OAuth Refresh] Mengajukan pembaruan access token ke Google OAuth2...");

      const clientId = process.env.GOOGLE_CLIENT_ID || "156336512986-p7s2d627iabm5f77md8b0uud60vvg02b.apps.googleusercontent.com";
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      const bodyParams: any = {
        client_id: clientId,
        refresh_token: refresh_token,
        grant_type: "refresh_token"
      };

      if (clientSecret) {
        bodyParams.client_secret = clientSecret;
      }

      const refreshUrl = "https://oauth2.googleapis.com/token";
      const response = await fetch(refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyParams)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`[Google OAuth Refresh] Proses Autentikasi Gagal saat refresh (Status: ${response.status}): ${errorText}`);
        return res.status(response.status).json({ 
          error: "Gagal memperbarui token akses Google Drive. Silakan hubungkan ulang Google Drive.",
          rawError: errorText 
        });
      }

      const tokenData: any = await response.json();
      console.log("[Google OAuth Refresh] Sukses Autentikasi: Token akses Google Drive berhasil diperbarui!");
      
      return res.json({
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in
      });

    } catch (error: any) {
      console.error("[Google OAuth Refresh Error] Kesalahan sistem internal:", error);
      return res.status(500).json({ error: "Terjadi kesalahan internal saat memperbarui token akses Google." });
    }
  });

  // Helper to determine if a KML files text contains a match for user's ODP query (exact, direct-replace, or alternative formats like FF/D05/40.1)
  function isValueMatchingOdp(kmlText: string, query: string): boolean {
    if (!kmlText || !query) return false;
    const cleanQ = query.trim().toUpperCase();
    const upperText = kmlText.toUpperCase();
    
    // 1. Direct substring checks
    if (upperText.includes(cleanQ)) return true;
    if (upperText.includes(cleanQ.replace(/\//g, "-"))) return true;
    if (upperText.includes(cleanQ.replace(/-/g, "/"))) return true;
    
    // 2. Extractions for alternative pattern e.g., FF/D05/40.1 when query is ODP-MNZ-FF/40
    const parts = cleanQ.split(/[-_/ ]/).filter(Boolean);
    let group = "";
    let numberStr = "";
    
    // Find numeric part
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (/^\d+(\.\d+)?$/.test(p)) {
        numberStr = p.split('.')[0];
        if (i > 0) {
          const prev = parts[i - 1];
          if (prev !== "ODP" && prev.length <= 3 && !/^\d+$/.test(prev)) {
            group = prev;
          }
        }
        break;
      }
    }
    
    if (!group && parts.length > 0) {
      const possible = parts.filter(p => p !== "ODP" && p.length >= 1 && p.length <= 3 && isNaN(Number(p)));
      if (possible.length > 0) {
        group = possible[possible.length - 1];
      }
    }
    
    if (group && numberStr) {
      // Look inside <name>...</name> tags in KML Content
      const nameTagRegex = /<name>([^<]+)<\/name>/gi;
      let match;
      while ((match = nameTagRegex.exec(upperText)) !== null) {
        const nameVal = match[1].trim();
        if (nameVal === cleanQ || nameVal.replace(/\//g, "-") === cleanQ || nameVal === cleanQ.replace(/\//g, "-")) {
          return true;
        }
        
        const kmlParts = nameVal.split(/[-_/ ]/).filter(Boolean);
        const hasGroup = kmlParts.some(p => p === group);
        const hasNumber = kmlParts.some(p => {
          const pureNum = p.split('.')[0];
          return pureNum === numberStr || p === numberStr;
        });
        
        if (hasGroup && hasNumber) {
          console.log(`[Google Drive Search - Match] Cocok alternatif di tag <name>: "${nameVal}" dengan grup "${group}" dan nomor "${numberStr}"`);
          return true;
        }
        
        if (nameVal.includes(group) && nameVal.includes(numberStr)) {
          const numIdx = nameVal.indexOf(numberStr);
          const charAfter = nameVal.charAt(numIdx + numberStr.length);
          const charBefore = numIdx > 0 ? nameVal.charAt(numIdx - 1) : '';
          const isWordMatch = (!charAfter || /[^0-9]/.test(charAfter)) && (!charBefore || /[^0-9]/.test(charBefore));
          if (isWordMatch) {
            console.log(`[Google Drive Search - Match Fallback] Cocok substring di tag <name>: "${nameVal}"`);
            return true;
          }
        }
      }
      
      // Generic regex fallback as a last resort in the whole text if not caught by <name> loops
      const regexSafeGroup = group.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regexSafeNumber = numberStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const pattern = new RegExp(`\\b${regexSafeGroup}\\b[^<]{0,100}\\b${regexSafeNumber}\\b`, 'i');
      if (pattern.test(upperText)) {
        console.log(`[Google Drive Search - Match Fallback RegEx] Cocok full-text regex.`);
        return true;
      }
    }
    
    return false;
  }

  // API Route for hierarchical, safe KML file search on Google Drive
  app.post("/api/drive/search-kml", async (req: express.Request, res: express.Response) => {
    try {
      const { accessToken, segment, searchName, sto, site } = req.body;

      if (!accessToken) {
        console.error("[Google Drive Search] Autentikasi Gagal: Access token tidak disediakan");
        return res.status(400).json({ error: "Access token wajib disediakan" });
      }

      // Validasi token sebelum memulai pencarian folder
      const isTokenValid = await isTokenActive(accessToken);
      if (!isTokenValid) {
        console.error("[Google Drive Search] Autentikasi Gagal: Token tidak aktif atau kedaluwarsa sebelum memulai proses.");
        return res.status(410).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa" });
      }

      console.log(`[Google Drive Search] ========================================`);
      console.log(`[Google Drive Search] Memulai pencarian bertahap untuk segment: "${segment}", searchName: "${searchName}", sto: "${sto}", site: "${site}"`);

      const isDistribusi = segment && (segment.toUpperCase().includes("DISTRIBUSI") || segment.toUpperCase() === "ODP");
      const isSurge = segment && segment.toUpperCase().includes("SURGE");

      if (isSurge) {
        console.log(`[Google Drive Search - SURGE] Menjalankan pipeline khusus segmen SURGE...`);
        // 1. Cari folder "M-Fosis" (atau case-insensitive "M-FOSIS" / "m-fosis")
        let mFosisFolderId = null;
        const rootQuery = `'root' in parents and (name = 'M-Fosis' or name = 'M-FOSIS' or name = 'm-fosis') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const rootRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (rootRes.ok) {
          const rootData = await rootRes.json();
          if (rootData.files && rootData.files[0]) {
            mFosisFolderId = rootData.files[0].id;
          }
        }
        
        if (!mFosisFolderId) {
          const globalQuery = `(name = 'M-Fosis' or name = 'M-FOSIS' or name = 'm-fosis') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const globalRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (globalRes.ok) {
            const globalData = await globalRes.json();
            if (globalData.files && globalData.files[0]) {
              mFosisFolderId = globalData.files[0].id;
            }
          }
        }
        
        if (!mFosisFolderId) {
          return res.status(404).json({ error: "Folderstruktur utama M-Fosis tidak ditemukan di Google Drive Anda." });
        }

        // 2. Cari folder "SURGE" (atau case-insensitive "Surge" / "surge") di dalam folder "M-Fosis"
        let surgeFolderId = null;
        const surgeQuery = `'${mFosisFolderId}' in parents and (name = 'SURGE' or name = 'Surge' or name = 'surge') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const surgeRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(surgeQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (surgeRes.ok) {
          const surgeData = await surgeRes.json();
          if (surgeData.files && surgeData.files[0]) {
            surgeFolderId = surgeData.files[0].id;
          }
        }
        
        // Cari "SURGE" secara global if not found in parent M-Fosis
        if (!surgeFolderId) {
          const globalSurgeQuery = `(name = 'SURGE' or name = 'Surge' or name = 'surge') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const globalSurgeRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalSurgeQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (globalSurgeRes.ok) {
            const globalSurgeData = await globalSurgeRes.json();
            if (globalSurgeData.files && globalSurgeData.files[0]) {
              surgeFolderId = globalSurgeData.files[0].id;
            }
          }
        }

        if (!surgeFolderId) {
          return res.status(404).json({ error: "Folder SURGE tidak ditemukan di Google Drive Anda." });
        }

        // 3. Ambil seluruh file KML di dalam folder SURGE
        const kmlQuery = `'${surgeFolderId}' in parents and name contains '.kml' and trashed = false`;
        const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)&pageSize=100`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        let matchedFiles: any[] = [];
        if (kmlRes.ok) {
          const kmlData = await kmlRes.json();
          matchedFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
        }

        // Fallback: Jika tidak ada file KML langsung di folder SURGE, cari rekursif di subfoldernya
        if (matchedFiles.length === 0) {
          const subfoldersQuery = `'${surgeFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const subfoldersRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subfoldersQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (subfoldersRes.ok) {
            const subfoldersData = await subfoldersRes.json();
            const subfolders = subfoldersData.files || [];
            for (const folder of subfolders) {
              const subKmlQuery = `'${folder.id}' in parents and name contains '.kml' and trashed = false`;
              const subKmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subKmlQuery)}&fields=files(id,name,size)&pageSize=100`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (subKmlRes.ok) {
                const subKmlData = await subKmlRes.json();
                const files = (subKmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
                matchedFiles.push(...files);
              }
            }
          }
        }

        console.log(`[Google Drive Search - SURGE] Berhasil menemukan ${matchedFiles.length} berkas KML.`);
        return res.json({ files: matchedFiles });

      } else if (isDistribusi) {
        console.log(`[Google Drive Search - Distribusi] Menjalankan pipeline khusus segmen DISTRIBUSI...`);
        
        // 1. Cari folder "M-Fosis" (atau case-insensitive "M-FOSIS")
        let mFosisFolderId = null;
        
        // Coba kueri di root terlebih dahulu untuk efisiensi
        const rootQuery = `'root' in parents and (name = 'M-Fosis' or name = 'M-FOSIS' or name = 'm-fosis') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const rootRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (rootRes.ok) {
          const rootData = await rootRes.json();
          if (rootData.files && rootData.files[0]) {
            mFosisFolderId = rootData.files[0].id;
            console.log(`[Google Drive Search - Distribusi] Menemukan folder M-Fosis di root: ID ${mFosisFolderId}`);
          }
        }
        
        // Jika tidak ketemu di root, cari di seluruh drive (kasus jika folder dibagikan/shared folder)
        if (!mFosisFolderId) {
          console.log(`[Google Drive Search - Distribusi] M-Fosis tidak ditemukan di root. Mencari secara global...`);
          const globalQuery = `(name = 'M-Fosis' or name = 'M-FOSIS' or name = 'm-fosis') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const globalRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (globalRes.ok) {
            const globalData = await globalRes.json();
            if (globalData.files && globalData.files[0]) {
              mFosisFolderId = globalData.files[0].id;
              console.log(`[Google Drive Search - Distribusi] Menemukan folder M-Fosis secara global: ID ${mFosisFolderId}`);
            }
          }
        }
        
        if (!mFosisFolderId) {
          console.error(`[Google Drive Search - Distribusi Error] Folder M-Fosis tidak ditemukan.`);
          return res.status(404).json({ error: "Folderstruktur utama M-Fosis tidak ditemukan di Google Drive Anda." });
        }
        
        // 2. Cari folder "DISTRIBUSI" di dalam foldel "M-Fosis"
        console.log(`[Google Drive Search - Distribusi] Mencari folder "DISTRIBUSI" di dalam M-Fosis...`);
        let distribusiFolderId = null;
        
        const distQuery = `'${mFosisFolderId}' in parents and (name = 'DISTRIBUSI' or name = 'Distribusi' or name = 'distribusi' or name = 'Segment Distribusi' or name = 'SEGMENT DISTRIBUSI') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const distRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(distQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (distRes.ok) {
          const distData = await distRes.json();
          if (distData.files && distData.files[0]) {
            distribusiFolderId = distData.files[0].id;
            console.log(`[Google Drive Search - Distribusi] Menemukan folder "DISTRIBUSI": ID ${distribusiFolderId}`);
          }
        }
        
        // Fallback jika diletakkan di dalam folder "BAHAN REKON"
        if (!distribusiFolderId) {
          console.log(`[Google Drive Search - Distribusi] Folder "DISTRIBUSI" tidak ditemukan di level paling atas M-Fosis. Memeriksa di dalam "BAHAN REKON"...`);
          const bRekonQuery = `'${mFosisFolderId}' in parents and (name = 'BAHAN REKON' or name = 'Bahan Rekon') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const bRekonRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(bRekonQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          
          if (bRekonRes.ok) {
            const bRekonData = await bRekonRes.json();
            const bRekonFolder = bRekonData.files && bRekonData.files[0];
            if (bRekonFolder) {
              const subDistQuery = `'${bRekonFolder.id}' in parents and (name = 'DISTRIBUSI' or name = 'Distribusi' or name = 'distribusi' or name = 'Segment Distribusi' or name = 'SEGMENT DISTRIBUSI') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
              const subDistRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subDistQuery)}&fields=files(id,name)`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (subDistRes.ok) {
                const subDistData = await subDistRes.json();
                if (subDistData.files && subDistData.files[0]) {
                  distribusiFolderId = subDistData.files[0].id;
                  console.log(`[Google Drive Search - Distribusi] Menemukan folder "DISTRIBUSI" di dalam Bahan Rekon: ID ${distribusiFolderId}`);
                }
              }
            }
          }
        }
        
        // Cari secara global jika masih belum ketemu
        if (!distribusiFolderId) {
          console.log(`[Google Drive Search - Distribusi] Folder "DISTRIBUSI" belum ketemu. Melakukan pencarian global...`);
          const globalDistQuery = `(name = 'DISTRIBUSI' or name = 'Distribusi' or name = 'distribusi') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const globalDistRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(globalDistQuery)}&fields=files(id,name)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (globalDistRes.ok) {
            const globalDistData = await globalDistRes.json();
            if (globalDistData.files && globalDistData.files[0]) {
              distribusiFolderId = globalDistData.files[0].id;
              console.log(`[Google Drive Search - Distribusi] Menemukan folder "DISTRIBUSI" global: ID ${distribusiFolderId}`);
            }
          }
        }
        
        if (!distribusiFolderId) {
          console.error(`[Google Drive Search - Distribusi Error] Folder DISTRIBUSI tidak ditemukan.`);
          return res.status(404).json({ error: "Folder DISTRIBUSI tidak ditemukan di dalam struktur Google Drive Anda." });
        }
        
        // 3. Dekomposisi Kata Kunci (Unsur-unsur pembentuk nama ODP, contoh: ODP-MNZ-FF/40 -> unsur 'MNZ' dan 'FF')
        const cleanQuery = (searchName || site || "").trim().toUpperCase();
        console.log(`[Google Drive Search - Distribusi] Kata kunci pencarian: "${cleanQuery}"`);
        
        const splitParts = cleanQuery.split(/[-_/ ]/).filter(p => p.length >= 2);
        const excludeKeywords = ["ODP", "ODC", "FDT", "RK", "OLT", "KABEL", "FIBER", "SEGMENT", "DISTRIBUSI", "SIMULATED", "KML"];
        const searchElements = splitParts.filter(part => !excludeKeywords.includes(part) && isNaN(Number(part)));
        
        console.log(`[Google Drive Search - Distribusi] Unsur pencocokan folder yang terekstrak: ${JSON.stringify(searchElements)}`);
        
        // 4. Cari sub-folder yang mengandung unsur-unsur tersebut di dalam folder "DISTRIBUSI"
        console.log(`[Google Drive Search - Distribusi] Membaca semua sub-folder di dalam folder "DISTRIBUSI"...`);
        const subfoldersQuery = `'${distribusiFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const subfoldersRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subfoldersQuery)}&fields=files(id,name)&pageSize=1000`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        let matchingFolders = [];
        if (subfoldersRes.ok) {
          const subfoldersData = await subfoldersRes.json();
          const subFolders = subfoldersData.files || [];
          console.log(`[Google Drive Search - Distribusi] Berhasil mendaftar ${subFolders.length} sub-folder dari DISTRIBUSI.`);
          
          if (searchElements.length > 0) {
            // Pencarian folder yang mengandung SEMUA unsur/elemen
            matchingFolders = subFolders.filter((folder: any) => {
              const fname = folder.name.toUpperCase();
              return searchElements.every(el => fname.includes(el));
            });
            console.log(`[Google Drive Search - Distribusi] Menemukan ${matchingFolders.length} sub-folder yang mengandung semua unsur: ${matchingFolders.map((f: any) => f.name).join(", ")}`);
            
            // Fallback longgar jika pencarian di atas kosong: folder mengandung SALAH SATU unsur
            if (matchingFolders.length === 0 && searchElements.length > 1) {
              matchingFolders = subFolders.filter((folder: any) => {
                const fname = folder.name.toUpperCase();
                return searchElements.some(el => fname.includes(el));
              });
              console.log(`[Google Drive Search - Distribusi Fallback] Menemukan ${matchingFolders.length} sub-folder longgar: ${matchingFolders.map((f: any) => f.name).join(", ")}`);
            }
          }
          
          // Fallback paling dasar: folder mengandung seluruh string mentah pencarian
          if (matchingFolders.length === 0) {
            matchingFolders = subFolders.filter((folder: any) => {
              const fname = folder.name.toUpperCase();
              return fname.includes(cleanQuery) || cleanQuery.includes(fname);
            });
            console.log(`[Google Drive Search - Distribusi Fallback Kasar] Menemukan ${matchingFolders.length} folder cocok mentah.`);
          }
        }
        
        // 5. Cari di semua file KML di dalam folder yang cocok tersebut, jika tidak ketemu di satu file, tutup file lalu cari di file lain
        let finalMatchedFiles = [];
        
        if (matchingFolders.length > 0) {
          console.log(`[Google Drive Search - Distribusi] Memulai pemindaian file KML di tingkat sub-folder yang cocok...`);
          for (const folder of matchingFolders) {
            console.log(`[Google Drive Search - Distribusi] Membaca file KML di folder: "${folder.name}" (ID)`);
            const kmlQuery = `'${folder.id}' in parents and name contains '.kml' and trashed = false`;
            const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (kmlRes.ok) {
              const kmlData = await kmlRes.json();
              const kmlFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
              console.log(`[Google Drive Search - Distribusi] Ditemukan ${kmlFiles.length} file KML untuk dipindai isinya.`);
              
              for (const file of kmlFiles) {
                console.log(`[Google Drive Search - Distribusi] Mengunduh & memeriksa isi file: "${file.name}" (ID: ${file.id})`);
                try {
                  const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                  });
                  
                  if (mediaRes.ok) {
                    const kmlContent = await mediaRes.text();
                    const isFound = isValueMatchingOdp(kmlContent, cleanQuery);
                                    
                    if (isFound) {
                      console.log(`[Google Drive Search - Distribusi] OK! Kata kunci ditemukan di dalam isi file "${file.name}". Berkas ini akan digunakan.`);
                      finalMatchedFiles.push(file);
                    } else {
                      console.log(`[Google Drive Search - Distribusi] Kata kunci tidak ditemukan di "${file.name}". Tutup file, lanjut memeriksa file lain...`);
                    }
                  } else {
                    console.warn(`[Google Drive Search - Distribusi] Gagal mengunduh file media ${file.name}. Status: ${mediaRes.status}`);
                  }
                } catch (readErr) {
                  console.error(`[Google Drive Search - Distribusi Error] Gagal membaca konten KML:`, readErr);
                }
              }
            }
          }
        } else {
          // Jika tidak ada sub-folder khusus, cari file KML langsung di root folder "DISTRIBUSI"
          console.log(`[Google Drive Search - Distribusi] Tidak ada subfolder yang cocok untuk pencarian elemen. Melacak berkas KML langsung di root folder "DISTRIBUSI"...`);
          const kmlQuery = `'${distribusiFolderId}' in parents and name contains '.kml' and trashed = false`;
          const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          
          if (kmlRes.ok) {
            const kmlData = await kmlRes.json();
            const kmlFiles = (kmlData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
            console.log(`[Google Drive Search - Distribusi] Menemukan ${kmlFiles.length} file KML di root DISTRIBUSI.`);
            
            for (const file of kmlFiles) {
              try {
                const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                  headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (mediaRes.ok) {
                  const kmlContent = await mediaRes.text();
                  if (isValueMatchingOdp(kmlContent, cleanQuery)) {
                    console.log(`[Google Drive Search - Distribusi] OK! Kata kunci ditemukan langsung di dalam berkas root KML "${file.name}".`);
                    finalMatchedFiles.push(file);
                  }
                }
              } catch (e) {
                console.error(`[Google Drive Search - Distribusi Error] Gagal memeriksa isi file root KML:`, e);
              }
            }
          }
        }
        
        // 6. Fallback berdasarkan kemiripan nama berkas KML jika pemeriksaan isi tuntas tanpa hasil
        if (finalMatchedFiles.length === 0) {
          console.log(`[Google Drive Search - Distribusi] Pemindaian konten berkas tuntas tanpa hasil. Menjalankan fallback kueri nama berkas di drive...`);
          const fnQuery = `(name contains '${cleanQuery}' or name contains '${cleanQuery.replace(/[\/\\]/g, "_")}') and name contains '.kml' and trashed = false`;
          const fnRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fnQuery)}&fields=files(id,name,size)`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (fnRes.ok) {
            const fnData = await fnRes.json();
            finalMatchedFiles = (fnData.files || []).filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
            if (finalMatchedFiles.length > 0) {
              console.log(`[Google Drive Search - Distribusi] Fallback sukses! Menemukan ${finalMatchedFiles.length} berkas KML dari nama.`);
            }
          }
        }
        
        // 7. Jika benar-benar kosong di Drive, hasilkan data KML simulasi as-built drawing agar aplikasi tetap berjalan map-nya
        if (finalMatchedFiles.length === 0) {
          console.warn("[Google Drive Search - Distribusi Warning] Berkas KML tidak ditemukan sama sekali di Drive. Menghasilkan KML simulasi.");
          finalMatchedFiles = [{
            id: `simulated-kml-${Date.now()}`,
            name: `AS_BUILT_DRAWING_${cleanQuery.replace(/[\s/\\?=]+/g, "_")}_SIMULATED.kml`,
            size: "4520"
          }];
        }
        
        console.log(`[Google Drive Search - Distribusi] Berhasil merampungkan penelusuran. Mengembalikan ${finalMatchedFiles.length} berkas.`);
        return res.json({ files: finalMatchedFiles });
        
      } else {
        // ORIGINAL PIPELINE UNTUK SEGMEN NON-DISTRIBUSI (FEEDER, METRO, DLL)
        // 1. Root Search: Cari folder bernama "M-Fosis" (atau case-insensitive "M-FOSIS") di root Google Drive.
        console.log(`[Google Drive Search] Langkah 1: Mencari folder utama "M-Fosis" di root...`);
        const rootQuery = `'root' in parents and (name = 'M-Fosis' or name = 'M-FOSIS') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const rootRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!rootRes.ok) {
          const errText = await rootRes.text().catch(() => "");
          console.error(`[Google Drive Search Error] Gagal mencari M-Fosis di root: ${rootRes.status}. Response: ${errText}`);
          if (rootRes.status === 401 || rootRes.status === 403) {
            return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
          }
          return res.status(rootRes.status).json({ error: "Folder Struktur tidak ditemukan" });
        }

        const rootData: any = await rootRes.json();
        const mFosisFolder = rootData.files && rootData.files[0];

        if (!mFosisFolder || !mFosisFolder.id) {
          console.error("[Google Drive Search Error] Folder Struktur tidak ditemukan: Folder M-Fosis tidak ditemukan.");
          return res.status(404).json({ error: "Folder Struktur tidak ditemukan" });
        }

        // 2. Level 1: Di dalam folder "M-Fosis", cari sub-folder bernama "BAHAN REKON".
        console.log(`[Google Drive Search] Langkah 2: Mencari sub-folder "BAHAN REKON" di dalam M-Fosis...`);
        const bRekonQuery = `'${mFosisFolder.id}' in parents and (name = 'BAHAN REKON' or name = 'Bahan Rekon') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const bRekonRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(bRekonQuery)}&fields=files(id,name)`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!bRekonRes.ok) {
          const errText = await bRekonRes.text().catch(() => "");
          console.error(`[Google Drive Search Error] Gagal mencari BAHAN REKON di M-Fosis: ${bRekonRes.status}. Response: ${errText}`);
          if (bRekonRes.status === 401 || bRekonRes.status === 403) {
            return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
          }
          return res.status(bRekonRes.status).json({ error: "Folder Struktur tidak ditemukan" });
        }

        const bRekonData: any = await bRekonRes.json();
        const bRekonFolder = bRekonData.files && bRekonData.files[0];

        if (!bRekonFolder || !bRekonFolder.id) {
          console.error("[Google Drive Search Error] Folder Struktur tidak ditemukan: Folder BAHAN REKON tidak ditemukan.");
          return res.status(404).json({ error: "Folder Struktur tidak ditemukan" });
        }

        // 3. Level 2 (Dynamic): Di dalam "BAHAN REKON", cari sub-folder yang namanya cocok dengan ID Alpro/Tiket yang sedang diproses.
        console.log(`[Google Drive Search] Langkah 3: Mencari sub-folder yang cocok dengan ID Alpro/Tiket di dalam BAHAN REKON...`);
        const level3Query = `'${bRekonFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const level3Res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(level3Query)}&fields=files(id,name)&pageSize=1000`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!level3Res.ok) {
          const errText = await level3Res.text().catch(() => "");
          console.error(`[Google Drive Search Error] Gagal mendaftar sub-folder BAHAN REKON: ${level3Res.status}. Response: ${errText}`);
          if (level3Res.status === 401 || level3Res.status === 403) {
            return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa atau tidak valid." });
          }
          return res.status(level3Res.status).json({ error: "Gagal berinteraksi dengan Google Drive" });
        }

        const level3Data: any = await level3Res.json();
        const level3Folders = level3Data.files || [];

        // Cari folder Alpro yang cocok
        const targetKeys = [searchName, site].filter(Boolean) as string[];

        let matchedAlproFolder = null;
        for (const key of targetKeys) {
          const cleanKey = key.toUpperCase().trim();
          // Pencarian eksak
          matchedAlproFolder = level3Folders.find((f: any) => f.name.toUpperCase().trim() === cleanKey);
          if (matchedAlproFolder) break;
          // Pencarian parsial
          matchedAlproFolder = level3Folders.find((f: any) => f.name.toUpperCase().includes(cleanKey) || cleanKey.includes(f.name.toUpperCase()));
          if (matchedAlproFolder) break;
        }

        // Jika masih tidak ditemukan, coba cari yang mengandung gabungan STO-Site atau bagian dari searchName
        if (!matchedAlproFolder && searchName) {
          const parts = searchName.split(/[-_/ ]/).filter(p => p.length > 1);
          matchedAlproFolder = level3Folders.find((f: any) => {
            const folderNameUpper = f.name.toUpperCase();
            return parts.every(part => folderNameUpper.includes(part.toUpperCase()));
          });
        }

        let matchedFiles: any[] = [];

        if (matchedAlproFolder && matchedAlproFolder.id) {
          console.log(`[Google Drive Search] Langkah 3 Sukses: Menemukan folder Alpro: "${matchedAlproFolder.name}" (ID: ${matchedAlproFolder.id})`);

          // 4. Level 3 (Target): Di dalam folder tersebut, cari file apapun yang memiliki ekstensi ".kml".
          console.log(`[Google Drive Search] Langkah 4: Mencari file .kml di dalam folder ${matchedAlproFolder.name}...`);
          const kmlQuery = `'${matchedAlproFolder.id}' in parents and name contains '.kml' and trashed = false`;
          const kmlRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(kmlQuery)}&fields=files(id,name,size)&pageSize=105`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });

          if (kmlRes.ok) {
            const kmlData: any = await kmlRes.json();
            matchedFiles = kmlData.files || [];
            matchedFiles = matchedFiles.filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
          } else {
            const errText = await kmlRes.text().catch(() => "");
            console.error(`[Google Drive Search] Gagal mencari file KML di folder utama: Status ${kmlRes.status}. Response: ${errText}`);
          }
        }

        // Jika folder Alpro tidak ditemukan atau tidak berisi KML, luncurkan pencarian fallback yang sangat kuat
        if (matchedFiles.length === 0) {
          console.log(`[Google Drive Search] INFO: KML tidak ditemukan di folder utama. Menjalankan pencarian fallback di seluruh BAHAN REKON atau secara global...`);
          
          const safeSearchName = (searchName || '').replace(/[\\']/g, '\\$&'); // Escaped for Google Drive safety
          const queriesToTry = [];
          
          if (safeSearchName) {
            // Kueri 1: Cari file KML yang namanya mirip di seluruh Google Drive
            queriesToTry.push(`name contains '${safeSearchName}' and name contains '.kml' and trashed = false`);

            // Kueri 2: Jika nama kueri cukup spesifik, pecah dan cari semua kecocokan komponen nama berkas
            const parts = safeSearchName.split(/[-_/ ]/).filter(p => p.length > 2);
            if (parts.length > 0) {
              const wordCriteria = parts.map(p => `name contains '${p}'`).join(' and ');
              queriesToTry.push(`${wordCriteria} and name contains '.kml' and trashed = false`);
            }
          }
          
          // Kueri 3: Sebagai upaya terakhir, cari KML apa pun langsung di dalam folder BAHAN REKON
          if (bRekonFolder && bRekonFolder.id) {
            queriesToTry.push(`'${bRekonFolder.id}' in parents and name contains '.kml' and trashed = false`);
          }

          for (const qStr of queriesToTry) {
            console.log(`[Google Drive Search Fallback] Mencoba kueri Google Drive: "${qStr}"`);
            try {
              const fbRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qStr)}&fields=files(id,name,size)&pageSize=50`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              
              if (fbRes.ok) {
                const fbData: any = await fbRes.json();
                let fbFiles = fbData.files || [];
                fbFiles = fbFiles.filter((f: any) => (f.name || "").toLowerCase().endsWith(".kml"));
                
                if (fbFiles.length > 0) {
                  // Saring jika kueri direct parent untuk mencocokkan kemiripan nama
                  if (qStr.includes('in parents') && safeSearchName) {
                    const keyword = safeSearchName.toUpperCase();
                    fbFiles = fbFiles.filter((f: any) => {
                      const fName = (f.name || "").toUpperCase();
                      return fName.includes(keyword) || keyword.includes(fName) ||
                        safeSearchName.split(/[-_/ ]/).filter(p => p.length > 2).some(p => fName.includes(p.toUpperCase()));
                    });
                  }
                  
                  if (fbFiles.length > 0) {
                    console.log(`[Google Drive Search Fallback] Sukses! Menemukan ${fbFiles.length} KML di kueri fallback: "${qStr}"`);
                    matchedFiles = fbFiles;
                    break;
                  }
                }
              }
            } catch (fbErr) {
              console.error(`[Google Drive Search Fallback Error] Kesalahan saat mencoba kueri "${qStr}":`, fbErr);
            }
          }
        }

        if (matchedFiles.length === 0) {
          console.warn("[Google Drive Search Warning] Data Folder Alpro tidak tersedia di Drive. Menghasilkan berkas KML simulasi as-built drawing.");
          matchedFiles = [{
            id: `simulated-kml-${Date.now()}`,
            name: `AS_BUILT_DRAWING_${(searchName || site || "ALPRO").toUpperCase().trim().replace(/[\s/\\?=]+/g, "_")}_SIMULATED.kml`,
            size: "4520"
          }];
        }

        console.log(`[Google Drive Search] Berhasil mengembalikan ${matchedFiles.length} file KML.`);
        return res.json({ files: matchedFiles });
      }

    } catch (error: any) {
      console.error("[Google Drive Search API Error] Kesalahan internal:", error);
      return res.status(500).json({ error: error.message || "Kesalahan internal pada server saat mencari berkas KML." });
    }
  });

  // API Route to download synthetic (simulated) KML when actual KML doesn't exist
  app.get("/api/drive/download-simulated-kml", (req: express.Request, res: express.Response) => {
    try {
      const { name, lat, lng } = req.query;
      const parsedLat = parseFloat(lat as string) || -7.80138;
      const parsedLng = parseFloat(lng as string) || 111.4675;

      // Generate realistic zig-zag path representing fiber optic recovery route around the Alpro coordinates
      const pt1 = `${parsedLng},${parsedLat},0`;
      const pt2 = `${parsedLng + 0.0035},${parsedLat - 0.0015},0`;
      const pt3 = `${parsedLng + 0.0062},${parsedLat + 0.0011},0`;
      const pt4 = `${parsedLng + 0.0091},${parsedLat - 0.0025},0`;

      const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name || "Simulated_AsBuilt"}</name>
    <description>Simulated Fiber Optic Recovery route for testing</description>
    <Placemark>
      <name>Jalur Recovery Fiber Optic</name>
      <description>Simulated physical fiber span recovery</description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${pt1}
          ${pt2}
          ${pt3}
          ${pt4}
        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <name>Joint Closure A (Start)</name>
      <description>As-built tracing start point</description>
      <Point>
        <coordinates>${pt1}</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Joint Closure B (End)</name>
      <description>As-built tracing end point</description>
      <Point>
        <coordinates>${pt4}</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename="${name || "simulated.kml"}"`);
      return res.status(200).send(kmlContent);

    } catch (error: any) {
      console.error("[Download Simulated KML Error]:", error);
      return res.status(500).json({ error: "Gagal membuat berkas KML simulasi" });
    }
  });

  // API Route to fetch photos from Google Drive hierarchy for carousel
  app.post("/api/drive/fetch-photos", async (req: express.Request, res: express.Response) => {
    try {
      const { accessToken, alproName, idTiket } = req.body;

      if (!accessToken) {
        console.error("[Google Drive Photos] Autentikasi Gagal: Access token tidak disediakan");
        return res.status(400).json({ error: "Access token wajib disediakan" });
      }

      if (!alproName) {
        console.error("[Google Drive Photos] Validasi Gagal: Nama Alpro tidak disediakan");
        return res.status(400).json({ error: "Nama Alpro wajib disediakan" });
      }

      // Validasi token sebelum memulai pencarian folder
      const isTokenValid = await isTokenActive(accessToken);
      if (!isTokenValid) {
        console.error("[Google Drive Photos] Autentikasi Gagal: Token tidak aktif atau kedaluwarsa sebelum memulai proses.");
        return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Google Drive token telah kedaluwarsa" });
      }

      console.log(`[Google Drive Photos] ========================================`);
      console.log(`[Google Drive Photos] Memulai penelusuran foto untuk Alpro: "${alproName}"`);

      // 1. Root Path: Cari folder utama bernama "M-Fosis" (atau "M-FOSIS") di Google Drive.
      console.log(`[Google Drive Photos] Jalankan Penelusuran Folder (Traversing) - Langkah 1: Mencari folder utama "M-FOSIS" di root Google Drive...`);
      const rootQuery = `'root' in parents and (name = 'M-Fosis' or name = 'M-FOSIS') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const rootRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootQuery)}&fields=files(id,name)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!rootRes.ok) {
        const errText = await rootRes.text().catch(() => "");
        if (rootRes.status === 401 || rootRes.status === 403) {
          console.error(`[Google Drive Photos] Proses Autentikasi Gagal pada Langkah 1: Status ${rootRes.status}. API Google Drive Menolak Akses.`);
          return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Akses Google Drive ditolak. Silakan login kembali." });
        }
        console.error(`[Google Drive Photos] Proses Penelusuran (Traversing) Gagal pada Langkah 1: Status ${rootRes.status}. Response: ${errText}`);
        return res.status(rootRes.status).json({ error: "Gagal mengakses Google Drive untuk mencari folder utama" });
      }

      const rootData: any = await rootRes.json();
      const mFosisFolder = rootData.files && rootData.files[0];

      if (!mFosisFolder || !mFosisFolder.id) {
        console.error("[Google Drive Photos] Proses Penelusuran (Traversing) Gagal pada Langkah 1: Folder utama 'M-Fosis' atau 'M-FOSIS' tidak ditemukan.");
        return res.status(404).json({ error: "Foto untuk Alpro ini belum tersedia di folder MATERIAL (M-Fosis tidak ditemukan)" });
      }

      const mFosisId = mFosisFolder.id;
      console.log(`[Google Drive Photos] Langkah 1 Sukses: Menemukan folder "M-Fosis" dengan ID: "${mFosisId}"`);

      // 2. Level 2: Di dalam folder "M-Fosis", cari sub-folder bernama "BAHAN REKON".
      console.log(`[Google Drive Photos] Jalankan Penelusuran Folder (Traversing) - Langkah 2: Mencari sub-folder "BAHAN REKON" di dalam folder M-Fosis...`);
      const bRekonQuery = `'${mFosisId}' in parents and (name = 'BAHAN REKON' or name = 'Bahan Rekon') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const bRekonRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(bRekonQuery)}&fields=files(id,name)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!bRekonRes.ok) {
        const errText = await bRekonRes.text().catch(() => "");
        if (bRekonRes.status === 401 || bRekonRes.status === 403) {
          console.error(`[Google Drive Photos] Proses Autentikasi Gagal pada Langkah 2: Status ${bRekonRes.status}. API Google Drive Menolak Akses.`);
          return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Akses Google Drive ditolak. Silakan login kembali." });
        }
        console.error(`[Google Drive Photos] Proses Penelusuran (Traversing) Gagal pada Langkah 2: Status ${bRekonRes.status}. Response: ${errText}`);
        return res.status(422).json({ error: "Foto untuk Alpro ini belum tersedia di folder MATERIAL" });
      }

      const bRekonData: any = await bRekonRes.json();
      const bRekonFolder = bRekonData.files && bRekonData.files[0];

      if (!bRekonFolder || !bRekonFolder.id) {
        console.error("[Google Drive Photos] Proses Penelusuran (Traversing) Gagal pada Langkah 2: Sub-folder 'BAHAN REKON' tidak ditemukan.");
        return res.status(404).json({ error: "Foto untuk Alpro ini belum tersedia di folder MATERIAL (Bahan Rekon tidak ditemukan)" });
      }

      const bRekonId = bRekonFolder.id;
      console.log(`[Google Drive Photos] Langkah 2 Sukses: Menemukan sub-folder "BAHAN REKON" dengan ID: "${bRekonId}"`);

      // 3. Level 3 (Dynamic): Di dalam "BAHAN REKON", cari sub-folder yang namanya cocok dengan nama Alpro atau ID Tiket.
      console.log(`[Google Drive Photos] Jalankan Penelusuran Folder (Traversing) - Langkah 3: Mengambil sub-folder Alpro dari "BAHAN REKON"...`);
      const level3Query = `'${bRekonId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const level3Res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(level3Query)}&fields=files(id,name)&pageSize=1000`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!level3Res.ok) {
        const errText = await level3Res.text().catch(() => "");
        if (level3Res.status === 401 || level3Res.status === 403) {
          console.error(`[Google Drive Photos] Proses Autentikasi Gagal pada Langkah 3: Status ${level3Res.status}. API Google Drive Menolak Akses.`);
          return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Akses Google Drive ditolak. Silakan login kembali." });
        }
        console.error(`[Google Drive Photos] Proses Penelusuran (Traversing) Gagal pada Langkah 3: Status ${level3Res.status}. Response: ${errText}`);
        return res.status(422).json({ error: "Foto untuk Alpro ini belum tersedia di folder MATERIAL" });
      }

      const level3Data: any = await level3Res.json();
      const level3Folders = level3Data.files || [];

      // Cari yg namanya cocok
      let targetFolder = level3Folders.find((f: any) => f.name.toUpperCase().trim() === alproName.toUpperCase().trim());
      if (!targetFolder && idTiket) {
        targetFolder = level3Folders.find((f: any) => f.name.toUpperCase().trim() === idTiket.toUpperCase().trim());
      }
      if (!targetFolder) {
        // loose contains match
        targetFolder = level3Folders.find((f: any) => 
          f.name.toUpperCase().includes(alproName.toUpperCase()) || 
          alproName.toUpperCase().includes(f.name.toUpperCase())
        );
      }

      if (!targetFolder || !targetFolder.id) {
        console.error(`[Google Drive Photos] Proses Penelusuran (Traversing) Gagal pada Langkah 3: Folder Alpro "${alproName}" tidak ditemukan di dalam BAHAN REKON.`);
        return res.status(404).json({ error: `Foto untuk Alpro ini belum tersedia di folder MATERIAL (Folder Alpro ${alproName} tidak ditemukan)` });
      }

      const targetId = targetFolder.id;
      console.log(`[Google Drive Photos] Langkah 3 Sukses: Menemukan folder Alpro "${targetFolder.name}" dengan ID: "${targetId}"`);

      // 4. Level 4 (Target): Di dalam folder tersebut, cari sub-folder bernama "MATERIAL".
      console.log(`[Google Drive Photos] Jalankan Penelusuran Folder (Traversing) - Langkah 4: Mencari sub-folder "MATERIAL" di dalam folder Alpro...`);
      let imageFiles: any[] = [];
      let usedFallback = false;

      const materialQuery = `'${targetId}' in parents and (name = 'MATERIAL' or name = 'Material' or name = 'material') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const materialRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(materialQuery)}&fields=files(id,name)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (materialRes.ok) {
        const materialData: any = await materialRes.json();
        const materialFolder = materialData.files && materialData.files[0];

        if (materialFolder && materialFolder.id) {
          const materialId = materialFolder.id;
          console.log(`[Google Drive Photos] Langkah 4 Sukses: Menemukan folder MATERIAL dengan ID: "${materialId}"`);

          // 5. Fetching & Sorting: Ambil semua file gambar di dalam folder "MATERIAL" tersebut.
          console.log(`[Google Drive Photos] Jalankan Penelusuran Folder (Traversing) - Langkah 5: Mengambil semua file gambar di dalam folder "MATERIAL"...`);
          const imagesQuery = `'${materialId}' in parents and trashed = false and (mimeType = 'image/png' or mimeType = 'image/jpeg' or mimeType = 'image/jpg' or mimeType = 'image/webp')`;
          const imagesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(imagesQuery)}&fields=files(id,name,mimeType,webContentLink,webViewLink,thumbnailLink,size)&pageSize=100`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });

          if (imagesRes.ok) {
            const imagesData: any = await imagesRes.json();
            imageFiles = imagesData.files || [];
          } else {
            const errText = await imagesRes.text().catch(() => "");
            console.warn(`[Google Drive Photos] Gagal mengambil gambar dari folder MATERIAL: ${imagesRes.status}. Response: ${errText}`);
          }
        }
      }

      // Fallback 1: Jika folder MATERIAL tidak ditemukan ATAU tidak berisi gambar sama sekali, cari gambar langsung di folder induk Alpro
      if (imageFiles.length === 0) {
        console.log(`[Google Drive Photos Fallback] Folder MATERIAL tidak ditemukan atau kosong. Mencari gambar langsung di folder Alpro: "${targetFolder.name}"...`);
        const fallbackQuery = `'${targetId}' in parents and trashed = false and (mimeType = 'image/png' or mimeType = 'image/jpeg' or mimeType = 'image/jpg' or mimeType = 'image/webp')`;
        try {
          const fbRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fallbackQuery)}&fields=files(id,name,mimeType,webContentLink,webViewLink,thumbnailLink,size)&pageSize=100`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (fbRes.ok) {
            const fbData: any = await fbRes.json();
            imageFiles = fbData.files || [];
            if (imageFiles.length > 0) {
              console.log(`[Google Drive Photos Fallback] Sukses menemukan ${imageFiles.length} gambar langsung di folder Alpro.`);
              usedFallback = true;
            }
          }
        } catch (fbErr) {
          console.error("[Google Drive Photos Fallback Error] Kesalahan saat mencari gambar di folder induk:", fbErr);
        }
      }

      // Fallback 2: Jika masih kosong, coba cari gambar di sub-folder pertama manapun di dalam targetId
      if (imageFiles.length === 0) {
        console.log(`[Google Drive Photos Fallback 2] Mencari sub-folder lain di bawah folder Alpro dan memindai gambarnya...`);
        try {
          const listSubdirsQuery = `'${targetId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const listSubdirsRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(listSubdirsQuery)}&fields=files(id,name)&pageSize=15`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (listSubdirsRes.ok) {
            const listSubdirsData: any = await listSubdirsRes.json();
            const dirs = listSubdirsData.files || [];
            for (const dir of dirs) {
              // Lewati folder material karena sudah dipindai
              if ((dir.name || "").toUpperCase() === "MATERIAL") continue;
              console.log(`[Google Drive Photos Fallback 2] Memindai sub-folder "${dir.name}"...`);
              const subDirImgQuery = `'${dir.id}' in parents and trashed = false and (mimeType = 'image/png' or mimeType = 'image/jpeg' or mimeType = 'image/jpg' or mimeType = 'image/webp')`;
              const subDirImgRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subDirImgQuery)}&fields=files(id,name,mimeType,webContentLink,webViewLink,thumbnailLink,size)&pageSize=50`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (subDirImgRes.ok) {
                const subDirImgData: any = await subDirImgRes.json();
                const foundImgs = subDirImgData.files || [];
                if (foundImgs.length > 0) {
                  imageFiles = foundImgs;
                  console.log(`[Google Drive Photos Fallback 2] Sukses menemukan ${imageFiles.length} gambar di sub-folder "${dir.name}".`);
                  usedFallback = true;
                  break;
                }
              }
            }
          }
        } catch (fb2Err) {
          console.error("[Google Drive Photos Fallback 2 Error] Kesalahan saat mencari di subfolder-subfolder Alpro:", fb2Err);
        }
      }

      // Jika masih tidak ada gambar sama sekali setelah seluruh tingkat fallback,
      // Alih-alih melempar error HTTP 404 keras yang memicu dynamic error, kita kembalikan array kosong ([]) dengan status 200,
      // sehingga antarmuka klien dapat menampilkan kondisi kosong (empty state) secara anggun dan tenang.
      if (imageFiles.length === 0) {
        console.warn("[Google Drive Photos] Penelusuran selesai: Tidak ada berkas gambar yang ditemukan lewat pipeline utama maupun fallback.");
        return res.json({ files: [] });
      }

      // Urutkan secara alfabetis (A-Z)
      const sortedImages = imageFiles.sort((a: any, b: any) => 
        (a.name || "").localeCompare(b.name || "")
      );

      // Konversi URL: Ubah URL berbagi Google Drive menjadi URL langsung (direct embed link)
      // Gunakan 'webContentLink' atau 'thumbnailLink', bukan 'webViewLink'
      const formattedImages = sortedImages.map((file: any) => {
        // Format yang benar: https://lh3.googleusercontent.com/d/FILE_ID
        const directEmbedUrl = `https://lh3.googleusercontent.com/d/${file.id}`;
        
        // Debugging: Tambahkan log untuk mencetak URL gambar sebelum dikirim ke frontend
        console.log(`[Google Drive Photos Link Generation Debug] File: "${file.name}" (ID: ${file.id}) -> Direct Embed Link: "${directEmbedUrl}"`);
        
        return {
          ...file,
          webContentLink: directEmbedUrl, // Overwrite webContentLink agar selalu menggunakan direct embed format
          thumbnailLink: file.thumbnailLink || directEmbedUrl
        };
      });

      console.log(`[Google Drive Photos] Langkah 5 Sukses: Berhasil menemukan & menyortir ${formattedImages.length} foto!`);
      return res.json({ files: formattedImages });

    } catch (error: any) {
      console.error("[Google Drive Fetch Photos Error] Kesalahan internal:", error);
      return res.status(500).json({ error: "Foto untuk Alpro ini belum tersedia di folder MATERIAL" });
    }
  });

  // Helper to download Google Drive photos or external images as Base64 format for jsPDF
  async function fetchImageAsBase64(urlOrId: string, accessToken?: string): Promise<string | null> {
    try {
      let headers: any = {};
      let url = urlOrId;
      
      if (!urlOrId) return null;

      if (urlOrId.startsWith("data:")) {
        return urlOrId;
      }

      if (accessToken && !urlOrId.startsWith("http")) {
        // It's a Google Drive file ID
        url = `https://www.googleapis.com/drive/v3/files/${urlOrId}?alt=media`;
        headers["Authorization"] = `Bearer ${accessToken}`;
      }

      console.log(`[PDF Image Fetch] Fetching image from: ${url}`);
      
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        console.warn(`[PDF Image Fetch] Failed to fetch image. Status: ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      const mimeType = response.headers.get("content-type") || "image/jpeg";
      
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error(`[PDF Image Fetch Error] Error downloading photo ${urlOrId}:`, error);
      return null;
    }
  }

  // API Route to generate and return a highly professional PDF document
  app.post("/api/pdf/generate", async (req: express.Request, res: express.Response) => {
    try {
      const { 
        alproName, 
        noBa, 
        tiketInsera, 
        sto, 
        segment, 
        mitra, 
        catatan, 
        tanggal, 
        materials, 
        photos, 
        mapSnapshot, 
        username,
        accessToken
      } = req.body;

      console.log(`[PDF Generator API] Generating BA Rekon PDF for ${alproName}, BA Ref: ${noBa}`);

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      // ==========================================
      // PAGE 1: DOKUMEN UTAMA BERITA ACARA
      // ==========================================

      // Red Top line banner
      doc.setFillColor(211, 47, 47); // Dark Red (#D32F2F)
      doc.rect(0, 0, 210, 8, "F");

      // Company logo label
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text("PT TELEKOMUNIKASI INDONESIA Tbk - WITEL JATIM TIMUR", 15, 15);

      // Report Header Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(30, 41, 59);
      doc.text("BERITA ACARA REKONSILIASI PENANGANAN GAMAS", 15, 22);

      // Sub-header Info
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      doc.text("Tutup Pekerjaan & Realisasi Volume Akhir M-FOSIS Digital", 15, 27);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(185, 28, 28);
      doc.text(`Nomor BA: ${noBa || "BA-NOT-REGISTERED"}`, 15, 32);

      // Red Divider line
      doc.setDrawColor(211, 47, 47);
      doc.setLineWidth(0.4);
      doc.line(15, 35, 195, 35);

      // Metadata Table Grid
      const startX = 15;
      let startY = 40;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);

      const drawRow = (label1: string, val1: string, label2: string, val2: string) => {
        // Left column metadata box
        doc.setFillColor(248, 250, 252);
        doc.rect(startX, startY, 90, 8, "DF");
        doc.setFont("helvetica", "bold");
        doc.setTextColor(71, 85, 105);
        doc.text(label1, startX + 3, startY + 5.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        doc.text(val1, startX + 32, startY + 5.5);

        // Right column metadata box
        doc.rect(startX + 90, startY, 90, 8, "DF");
        doc.setFont("helvetica", "bold");
        doc.setTextColor(71, 85, 105);
        doc.text(label2, startX + 93, startY + 5.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        doc.text(val2, startX + 128, startY + 5.5);

        startY += 8;
      };

      drawRow("No. Tiket Insera :", tiketInsera || "Bukan Tiket / LOP", "Tanggal Rekon :", tanggal || "-");
      drawRow("Alpro Target     :", alproName || "Alpro Umum", "STO :", sto || "PGR");
      drawRow("Segment Jaringan :", segment || "QE Recovery", "Mitra Pelaksana :", mitra || "KSO Mitra Jasa");
      drawRow("Petugas M-FOSIS  :", username || "adhiatma21@gmail.com", "Status Gamas :", "CLOSE REKON");

      // Spacing for Technical Notes
      startY += 4;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      doc.text("JUSTIFIKASI & CATATAN TEKNIS PENANGANAN LAPANGAN", startX, startY);
      
      startY += 2;
      doc.setFillColor(254, 253, 243); // Amber-gold background for notes
      doc.setDrawColor(254, 243, 199);
      const textLines = doc.splitTextToSize(catatan || "Gangguan massal diselesaikan berdasarkan penyesuaian volume material lapangan, rute tarikan rute spasial, dan validasi fisik di lapangan.", 174);
      const notesHeight = Math.max(14, textLines.length * 4.5 + 6);
      doc.rect(startX, startY, 180, notesHeight, "DF");
      
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.setTextColor(120, 53, 4);
      let noteTextY = startY + 5;
      textLines.forEach((line: string) => {
        doc.text(line, startX + 3, noteTextY);
        noteTextY += 4.5;
      });

      // Spacing for Materials Table
      startY += notesHeight + 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text("RINGKASAN REALISASI VOLUME DAN MATERIAL REKON", startX, startY);
      
      startY += 2;
      doc.setFillColor(30, 41, 59); // Dark blue Header slate
      doc.rect(startX, startY, 180, 8, "F");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text("NO", startX + 3, startY + 5.5);
      doc.text("DESKRIPSI MATERIAL / LAYANAN TEKNIS JASA LAPANGAN", startX + 15, startY + 5.5);
      doc.text("VOLUME REKON/DESAIN", startX + 130, startY + 5.5);
      
      startY += 8;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);

      if (materials && Array.isArray(materials) && materials.length > 0) {
        materials.forEach((mat: any, index: number) => {
          if (index % 2 === 1) {
            doc.setFillColor(248, 250, 252);
          } else {
            doc.setFillColor(255, 255, 255);
          }
          doc.setDrawColor(241, 245, 249);
          doc.rect(startX, startY, 180, 7.5, "DF");

          doc.text(String(mat.no || (index + 1)), startX + 4, startY + 5);
          doc.text(String(mat.name || "-"), startX + 15, startY + 5);
          
          doc.setFont("helvetica", "bold");
          doc.setTextColor(185, 28, 28); // Highlight volume value
          doc.text(String(mat.qty || "-"), startX + 130, startY + 5);
          
          doc.setFont("helvetica", "normal");
          doc.setTextColor(15, 23, 42);
          startY += 7.5;
        });
      } else {
        doc.setFillColor(255, 255, 255);
        doc.rect(startX, startY, 180, 8, "DF");
        doc.setFont("helvetica", "italic");
        doc.text("Tidak ada penggunaan material baru yang didefinisikan.", startX + 4, startY + 5);
        startY += 8;
      }

      // Legal Signatures Floor block
      const sigY = 240;
      doc.setDrawColor(226, 232, 240);
      doc.line(15, sigY - 5, 195, sigY - 5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text("PIHAK I - PT TELKOM INDONESIA Tbk", startX + 5, sigY);
      doc.text("ASMAN GAMAS & OPERASI WITEL", startX + 5, sigY + 4);

      doc.text("PIHAK II - MITRA INTEGRATOR LAPANGAN", startX + 120, sigY);
      doc.text(String(mitra || "MITRA TEKNIS LAPANGAN").toUpperCase(), startX + 120, sigY + 4);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("_____________________________", startX + 5, sigY + 22);
      doc.text("Asman Gamas Telkom Indonesia", startX + 5, sigY + 26);

      doc.text("_____________________________", startX + 120, sigY + 22);
      doc.text(`Team Lead Project ${mitra || 'Mitra'}`, startX + 120, sigY + 26);

      // ==========================================
      // PAGE 2: LAMPIRAN VISUAL DAN JALUR SPASIAL
      // ==========================================
      doc.addPage();

      // Top Red Banner for Attachment page
      doc.setFillColor(211, 47, 47);
      doc.rect(0, 0, 210, 8, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text("LAMPIRAN BUKTI FISIK DAN VISUAL JALUR KML REKON", startX, 18);
      
      doc.setDrawColor(211, 47, 47);
      doc.setLineWidth(0.4);
      doc.line(startX, 21, 195, 21);

      let attachY = 26;

      // Section 1: KML Map Snapshot from frontend canvas
      if (mapSnapshot && mapSnapshot.startsWith("data:image")) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        doc.text("LAMPIRAN I: CAPTURE VISUAL GEOMETRI SPASIAL (PETA JALUR KML DIGITAL)", startX, attachY);
        attachY += 3.5;

        try {
          doc.addImage(mapSnapshot, "JPEG", startX, attachY, 180, 78);
          attachY += 80;

          doc.setFont("helvetica", "italic");
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text(`* Gambar di atas mewakili rute spasial serat optik rekon yang diambil secara langsung melalui viewport Leaflet.`, startX + 2, attachY);
          attachY += 10;
        } catch (imgErr) {
          console.error("[PDF Generator] Failed to draw mapSnapshot image:", imgErr);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.5);
          doc.text("Visual peta KML tidak berhasil digambarkan pada halaman laporan.", startX, attachY);
          attachY += 8;
        }
      }

      // Section 2: Evident Photos fetched server-side from Google Drive via access_token
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text("LAMPIRAN II: EVIDENT DOKUMENTASI FISIK PEKERJAAN (PHOTO CAROUSEL)", startX, attachY);
      attachY += 4;

      if (photos && Array.isArray(photos) && photos.length > 0) {
        const photoWidth = 85;
        const photoHeight = 50;

        // Iterate through first 4 photos to fit neatly in A4 grid
        for (let i = 0; i < Math.min(photos.length, 4); i++) {
          const photoNode = photos[i];
          const colX = i % 2 === 0 ? startX : startX + 95;
          const isSecondRow = i === 2;
          
          if (isSecondRow) {
            attachY += 63;
          }

          // Gray background container card for photos
          doc.setDrawColor(241, 245, 249);
          doc.setFillColor(248, 250, 252);
          doc.rect(colX - 1, attachY - 1, photoWidth + 2, photoHeight + 11, "DF");

          // Download image live from Google Drive with bearer token
          const photoUrlOrId = photoNode.id || photoNode.webContentLink;
          const base64Photo = await fetchImageAsBase64(photoUrlOrId, accessToken);

          if (base64Photo) {
            try {
              doc.addImage(base64Photo, "JPEG", colX, attachY, photoWidth, photoHeight);
            } catch (errAdd) {
              console.error("[PDF Generator] Image rendering in PDF failed:", errAdd);
              doc.setDrawColor(203, 213, 225);
              doc.rect(colX + 5, attachY + 5, photoWidth - 10, photoHeight - 10);
              doc.setFont("helvetica", "italic");
              doc.setFontSize(7.5);
              doc.setTextColor(148, 163, 184);
              doc.text("Pembacaan berkas gambar Google Drive gagal.", colX + 12, attachY + photoHeight / 2);
            }
          } else {
            // Draw visual placeholder box
            doc.setDrawColor(203, 213, 225);
            doc.rect(colX + 5, attachY + 5, photoWidth - 10, photoHeight - 10);
            doc.setFont("helvetica", "italic");
            doc.setFontSize(7.5);
            doc.setTextColor(148, 163, 184);
            doc.text("[Foto Google Drive]", colX + 28, attachY + photoHeight / 2 - 2);
            doc.text(`ID: ${photoNode.id ? photoNode.id.substring(0, 14) : "-"}`, colX + 22, attachY + photoHeight / 2 + 3);
          }

          // Label
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(51, 65, 85);
          const titleTrunc = String(photoNode.title || photoNode.name || `Dokumentasi ${i + 1}`).substring(0, 42);
          doc.text(titleTrunc, colX, attachY + photoHeight + 3.5);

          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          doc.setTextColor(100, 116, 139);
          doc.text(`Source: ${photoNode.size || "1.5 MB"} - M-FOSIS System`, colX, attachY + photoHeight + 7);
        }
      } else {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(148, 163, 184);
        doc.text("Tidak ada file evident foto yang diimpor dari folder Google Drive.", startX, attachY);
      }

      // Output as arraybuffer/buffer and send
      const pdfDataArray = doc.output("arraybuffer");
      const pdfBuffer = Buffer.from(pdfDataArray);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="BA_REKON_${alproName.replace(/\s+/g, "_")}.pdf"`);
      return res.send(pdfBuffer);

    } catch (error: any) {
      console.error("[PDF Generator API Error]:", error);
      return res.status(500).json({ error: error.message || "Gagal membuat dokumen laporan BA Rekon. Silakan hubungi pengelola sistem." });
    }
  });

export default app;

async function startServer() {
  const PORT = 3000;

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

