/* ============================================================
   Reels Studio — نسخة مجانية 100% بدون أي API Key.
   كل المعالجة (قص، تحويل 9:16، حرق ترجمة اختيارية) تتم محليًا
   داخل متصفحك عبر ffmpeg.wasm فقط.
   ============================================================ */

const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

let ffmpeg = null;
let ffmpegLoaded = false;

let currentFile = null;
let currentVideoURL = null;
let videoDuration = 0;
let srtCues = [];       // ترجمة اختيارية يرفعها المستخدم بنفسه: [{start,end,text}]
let clips = [];          // { id, start, end, blob, url }

// ---------- DOM ----------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const urlInput = document.getElementById("urlInput");
const urlLoadBtn = document.getElementById("urlLoadBtn");
const fileInfo = document.getElementById("fileInfo");
const previewVideo = document.getElementById("previewVideo");
const fileName = document.getElementById("fileName");
const fileDuration = document.getElementById("fileDuration");

const fixedDuration = document.getElementById("fixedDuration");
const randomMin = document.getElementById("randomMin");
const randomMax = document.getElementById("randomMax");
const manualPoints = document.getElementById("manualPoints");
const cropPosition = document.getElementById("cropPosition");
const maxClipsCount = document.getElementById("maxClipsCount");
const enableSubtitleUpload = document.getElementById("enableSubtitleUpload");
const subtitleUploadBox = document.getElementById("subtitleUploadBox");
const srtFileInput = document.getElementById("srtFileInput");

const processBtn = document.getElementById("processBtn");
const progressBox = document.getElementById("progressBox");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const clipsGrid = document.getElementById("clipsGrid");
const emptyState = document.getElementById("emptyState");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

// Editor modal
const editorModal = document.getElementById("editorModal");
const modalClose = document.getElementById("modalClose");
const editorVideo = document.getElementById("editorVideo");
const editStart = document.getElementById("editStart");
const editEnd = document.getElementById("editEnd");
const rerenderBtn = document.getElementById("rerenderBtn");
const downloadClipBtn = document.getElementById("downloadClipBtn");
const editorStatus = document.getElementById("editorStatus");
let activeClipId = null;

// ============================================================
// 1. تحميل ffmpeg.wasm (مكتبة مجانية بالكامل تعمل داخل المتصفح)
//
//    ملاحظة مهمة: ffmpeg.wasm يحاول داخليًا إنشاء Web Worker من
//    نفس رابط الـ CDN (unpkg/jsdelivr). المتصفحات تمنع إنشاء
//    Worker من مصدر خارجي (Cross-Origin) لأسباب أمنية، حتى لو
//    كان يدعم CORS — وهذا سبب الخطأ الذي ظهر على Vercel.
//    الحل: تحويل كل الملفات (core.js / core.wasm / ملف الـ Worker
//    نفسه) إلى Blob URL محلي عبر toBlobURL() قبل تمريرها لـ ffmpeg.load()
//    حتى يصير أصلها "نفس المصدر" من منظور المتصفح.
// ============================================================
const FFMPEG_VERSION = "0.12.10";
const CORE_VERSION = "0.12.6";
const FFMPEG_BASE_URL = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd`;
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

async function ensureFFmpegLoaded() {
  if (ffmpegLoaded) return;
  setStatus("busy", "تحميل محرك المعالجة...");
  ffmpeg = new FFmpeg();

  ffmpeg.on("log", ({ message }) => console.log("[ffmpeg]", message));

  try {
    // اسم ملف الـ Worker يظهر في رسالة الخطأ نفسها إذا فشل التحميل
    // (مثال: 814.ffmpeg.js) — وهو ثابت طالما رقم الإصدار أعلاه مثبّت.
    const classWorkerURL = await toBlobURL(
      `${FFMPEG_BASE_URL}/814.ffmpeg.js`,
      "text/javascript"
    );

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      classWorkerURL,
    });
  } catch (err) {
    // خطة بديلة: لو تغيّر اسم ملف الـ Worker بين الإصدارات ولم يُوجد
    // على المسار المتوقع، نحاول التحميل بدونه (يعمل غالبًا في المتصفحات
    // الحديثة التي لا تطبّق القيد بصرامة) قبل إظهار خطأ نهائي للمستخدم.
    console.warn("فشل تحميل classWorkerURL بالمسار المتوقع، محاولة بديلة...", err);
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    });
  }

  ffmpegLoaded = true;
  setStatus("ok", "جاهز — يعمل محليًا 100% بدون API");
}

function setStatus(kind, text) {
  statusDot.className = "status-dot" + (kind === "busy" ? " busy" : kind === "error" ? " error" : "");
  statusText.textContent = text;
}

function setProgress(pct, label) {
  progressBox.classList.remove("hidden");
  progressBar.style.width = `${pct}%`;
  progressLabel.textContent = label;
}

// ============================================================
// 2. رفع الملف / السحب والإفلات / رابط مباشر
// ============================================================
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

urlLoadBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  try {
    setStatus("busy", "جاري تحميل الفيديو من الرابط...");
    const res = await fetch(url);
    if (!res.ok) throw new Error("تعذر الوصول للرابط (تحقق من إعدادات CORS في السيرفر المصدر)");
    const blob = await res.blob();
    const file = new File([blob], "video-from-url.mp4", { type: blob.type || "video/mp4" });
    handleFile(file);
  } catch (err) {
    alert("فشل تحميل الفيديو من الرابط: " + err.message + "\n\nملاحظة: روابط يوتيوب غير مدعومة من المتصفح مباشرة.");
    setStatus("error", "فشل تحميل الرابط");
  }
});

function handleFile(file) {
  currentFile = file;
  currentVideoURL = URL.createObjectURL(file);
  previewVideo.src = currentVideoURL;
  fileName.textContent = file.name;
  fileInfo.classList.remove("hidden");

  previewVideo.onloadedmetadata = () => {
    videoDuration = previewVideo.duration;
    fileDuration.textContent = `المدة: ${formatTime(videoDuration)}`;
    processBtn.disabled = false;
  };
}

// ============================================================
// 3. إظهار/إخفاء خيارات كل وضع تقطيع
// ============================================================
document.querySelectorAll('input[name="splitMode"]').forEach((radio) => {
  radio.addEventListener("change", updateSplitModeUI);
});
function updateSplitModeUI() {
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  document.getElementById("fixedOptions").style.opacity = mode === "fixed" ? 1 : 0.35;
  document.getElementById("randomOptions").style.opacity = mode === "random" ? 1 : 0.35;
  document.getElementById("manualOptions").style.opacity = mode === "manual" ? 1 : 0.35;
}
updateSplitModeUI();

enableSubtitleUpload.addEventListener("change", () => {
  subtitleUploadBox.classList.toggle("hidden", !enableSubtitleUpload.checked);
});

srtFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  srtCues = parseSRT(text);
});

// ============================================================
// 4. حساب نقاط التقطيع حسب الوضع المختار (بدون أي ذكاء اصطناعي)
// ============================================================
function computeSplitPoints() {
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  const maxClips = parseInt(maxClipsCount.value, 10) || 10;
  let points = [];

  if (mode === "fixed") {
    const dur = parseFloat(fixedDuration.value) || 30;
    let t = 0;
    while (t < videoDuration && points.length < maxClips) {
      const end = Math.min(t + dur, videoDuration);
      if (end - t >= 3) points.push({ start: t, end }); // تجاهل بقايا أقل من 3 ثواني
      t += dur;
    }
  } else if (mode === "random") {
    const min = parseFloat(randomMin.value) || 15;
    const max = parseFloat(randomMax.value) || 60;
    let t = 0;
    while (t < videoDuration && points.length < maxClips) {
      const dur = min + Math.random() * (max - min);
      const end = Math.min(t + dur, videoDuration);
      if (end - t >= 3) points.push({ start: t, end });
      t = end;
    }
  } else if (mode === "manual") {
    const lines = manualPoints.value.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(",").map((p) => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[1] > parts[0]) {
        points.push({
          start: Math.max(0, parts[0]),
          end: Math.min(videoDuration, parts[1]),
        });
      }
      if (points.length >= maxClips) break;
    }
  }

  return points;
}

// ============================================================
// 5. زر "قص وتحويل الفيديو" — خط الأنابيب الكامل بدون API
// ============================================================
processBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  const splitPoints = computeSplitPoints();
  if (!splitPoints.length) {
    alert("لم يتم إيجاد نقاط تقطيع صالحة. تحقق من إعدادات القص (خصوصًا في وضع النقاط اليدوية).");
    return;
  }

  processBtn.disabled = true;
  try {
    await ensureFFmpegLoaded();

    clips = [];
    renderClipsGrid();

    const inputName = "input" + getExt(currentFile.name);
    await ffmpeg.writeFile(inputName, await fetchFile(currentFile));

    for (let i = 0; i < splitPoints.length; i++) {
      const pct = Math.round(((i + 1) / splitPoints.length) * 100);
      setProgress(pct, `معالجة المقطع ${i + 1} من ${splitPoints.length}...`);
      const clip = await renderClip(inputName, splitPoints[i], i);
      clips.push(clip);
      renderClipsGrid();
    }

    setProgress(100, "اكتمل!");
    setTimeout(() => progressBox.classList.add("hidden"), 1500);
  } catch (err) {
    console.error(err);
    alert("حدث خطأ: " + err.message);
    setStatus("error", "حدث خطأ");
  } finally {
    processBtn.disabled = false;
  }
});

function getExt(filename) {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0] : ".mp4";
}

// ============================================================
// 6. معالجة كل مقطع: قص -> تحويل 9:16 -> حرق ترجمة (اختياري)
// ============================================================
async function renderClip(inputName, point, index) {
  const clipId = "clip_" + Date.now() + "_" + index;
  const duration = point.end - point.start;
  const cutName = `${clipId}_cut.mp4`;
  const verticalName = `${clipId}_vertical.mp4`;
  const finalName = `${clipId}_final.mp4`;

  // --- قص المقطع (إعادة ترميز لضمان دقة القص عند أي نقطة، وليس فقط الكي-فريم) ---
  await ffmpeg.exec([
    "-ss", String(point.start), "-i", inputName, "-t", String(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
    "-c:a", "aac", cutName,
  ]);

  // --- تحويل 16:9 إلى 9:16 حسب موضع القص المختار ---
  const crop = cropPosition.value; // center | left | right
  let cropFilter;
  if (crop === "left") {
    cropFilter = "scale=-2:1920,crop=1080:1920:0:0";
  } else if (crop === "right") {
    cropFilter = "scale=-2:1920,crop=1080:1920:in_w-1080:0";
  } else {
    cropFilter = "scale=-2:1920,crop=1080:1920";
  }

  await ffmpeg.exec([
    "-i", cutName,
    "-vf", cropFilter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "copy",
    verticalName,
  ]);

  // --- حرق ترجمة اختيارية (فقط إذا رفع المستخدم ملف SRT بنفسه) ---
  let finalFile = verticalName;
  if (enableSubtitleUpload.checked && srtCues.length) {
    const clipCues = srtCues.filter((c) => c.start >= point.start - 0.3 && c.end <= point.end + 0.3);
    if (clipCues.length) {
      const srtName = `${clipId}.srt`;
      const srtContent = buildSRT(clipCues, point.start);
      await ffmpeg.writeFile(srtName, srtContent);
      try {
        await ffmpeg.exec([
          "-i", verticalName,
          "-vf", `subtitles=${srtName}:force_style='FontName=Arial,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=80'`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "copy",
          finalName,
        ]);
        finalFile = finalName;
      } catch (e) {
        console.warn("تعذر حرق الترجمة (فلتر subtitles غير مدعوم في هذا الإصدار) — سيتم تسليم المقطع بدون ترجمة.", e);
      }
    }
  }

  const data = await ffmpeg.readFile(finalFile);
  const blob = new Blob([data.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);

  return { id: clipId, start: point.start, end: point.end, blob, url };
}

// ============================================================
// 7. أدوات ملفات SRT (اختياري — يرفعه المستخدم بنفسه)
// ============================================================
function parseSRT(text) {
  const blocks = text.replace(/\r/g, "").trim().split(/\n\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).join(" ");
    cues.push({ start: srtTimeToSec(startStr), end: srtTimeToSec(endStr), text: textLines });
  }
  return cues;
}

function srtTimeToSec(str) {
  const [h, m, rest] = str.split(":");
  const [s, ms] = rest.split(",");
  return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
}

function srtTime(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, "0");
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(t % 60)).padStart(2, "0");
  const ms = String(Math.round((t % 1) * 1000)).padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

function buildSRT(cues, clipStartOffset) {
  let out = "";
  let idx = 1;
  for (const cue of cues) {
    const start = Math.max(0, cue.start - clipStartOffset);
    const end = Math.max(0, cue.end - clipStartOffset);
    out += `${idx}\n${srtTime(start)} --> ${srtTime(end)}\n${cue.text}\n\n`;
    idx++;
  }
  return out;
}

// ============================================================
// 8. لوحة عرض المقاطع (Dashboard)
// ============================================================
function renderClipsGrid() {
  emptyState.classList.toggle("hidden", clips.length > 0);
  clipsGrid.innerHTML = "";
  if (!clips.length) { clipsGrid.appendChild(emptyState); return; }

  clips.forEach((clip, i) => {
    const card = document.createElement("div");
    card.className = "clip-card";
    card.innerHTML = `
      <div class="clip-thumb-wrap">
        <video src="${clip.url}" muted></video>
        <span class="clip-status-badge ready">جاهز</span>
      </div>
      <div class="clip-meta">
        <p class="clip-title-text">مقطع ${i + 1}</p>
        <p class="clip-time">${formatTime(clip.start)} - ${formatTime(clip.end)} (${Math.round(clip.end - clip.start)} ث)</p>
      </div>
    `;
    card.addEventListener("click", () => openEditor(clip.id));
    clipsGrid.appendChild(card);
  });
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ============================================================
// 9. محرر المقطع: تعديل التوقيت / إعادة المعالجة / التحميل
// ============================================================
function openEditor(clipId) {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return;
  activeClipId = clipId;
  editorVideo.src = clip.url;
  editStart.value = clip.start.toFixed(1);
  editEnd.value = clip.end.toFixed(1);
  editorStatus.textContent = "";
  editorModal.classList.remove("hidden");
}

modalClose.addEventListener("click", () => editorModal.classList.add("hidden"));
editorModal.addEventListener("click", (e) => { if (e.target === editorModal) editorModal.classList.add("hidden"); });

rerenderBtn.addEventListener("click", async () => {
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip) return;
  rerenderBtn.disabled = true;
  editorStatus.textContent = "جاري إعادة المعالجة...";
  try {
    const inputName = "input" + getExt(currentFile.name);
    const newPoint = { start: parseFloat(editStart.value), end: parseFloat(editEnd.value) };
    const idx = clips.findIndex((c) => c.id === activeClipId);
    const rerendered = await renderClip(inputName, newPoint, idx);
    rerendered.id = clip.id;
    clips[idx] = rerendered;
    renderClipsGrid();
    editorVideo.src = rerendered.url;
    editorStatus.textContent = "تم بنجاح ✓";
  } catch (err) {
    editorStatus.textContent = "خطأ: " + err.message;
  } finally {
    rerenderBtn.disabled = false;
  }
});

downloadClipBtn.addEventListener("click", () => {
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip) return;
  const a = document.createElement("a");
  a.href = clip.url;
  a.download = `reel_${Math.round(clip.start)}s.mp4`;
  a.click();
});

setStatus("ok", "جاهز — يعمل محليًا 100% بدون API");
