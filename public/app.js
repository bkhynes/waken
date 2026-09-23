(() => {
  const PRESETS = [
    { id: "subtle", label: "Subtle life", prompt: "The subject holds the pose. Natural micro-movement only: gentle breathing, a slow blink, slight fabric and hair shift. Camera is locked. Photoreal, same lighting and framing." },
    { id: "wind", label: "Wind", prompt: "A steady wind moves through hair, coat, and nearby grass. The subject holds the pose and gaze. Camera is locked. Photoreal, same lighting." },
    { id: "look", label: "Look around", prompt: "The subject slowly turns their head and shifts their gaze as if noticing something just off camera. Subtle body follow-through. Camera locked. Photoreal." },
    { id: "dolly-in", label: "Dolly in", prompt: "Slow cinematic dolly-in toward the subject. The subject remains still. Shallow depth of field holds. Smooth 35mm camera move, photoreal." },
    { id: "dolly-out", label: "Dolly out", prompt: "Slow cinematic dolly-out, revealing more of the environment. The subject holds the pose. Smooth 35mm camera move, photoreal." },
    { id: "orbit", label: "Orbit", prompt: "The camera slowly arcs around the subject in a short orbit. Subject holds pose. Smooth cinematic move, photoreal, same lighting." },
    { id: "pan", label: "Pan", prompt: "A slow lateral camera pan across the scene, revealing the environment. Subject stays in place. Smooth cinematic move, photoreal." },
    { id: "handheld", label: "Handheld", prompt: "Subtle handheld camera: small organic sway, documentary feel. Subject mostly still with natural micro-movement. Photoreal, same lighting." },
    { id: "parallax", label: "Parallax", prompt: "A gentle parallax move: foreground and background shift at different speeds while the subject stays centered. Cinematic, photoreal." },
    { id: "sky", label: "Sky shift", prompt: "The subject stays still. Clouds drift and the light on the scene slowly changes. Camera locked. Photoreal time-lapse feel without speeding the subject." },
  ];
  const INTENSITY = {
    subtle: "Keep motion very restrained — almost a living photograph. No large gestures.",
    medium: "Clear, readable motion. Enough movement to feel alive without becoming chaotic.",
    strong: "Confident, obvious motion and camera energy. Still keep identity and wardrobe intact.",
  };
  const ASPECTS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "3:2": 3 / 2, "2:3": 2 / 3 };
  const MODELS = [
    { id: "grok-imagine-video-1.5", resolutions: ["480p", "720p", "1080p"] },
    { id: "grok-imagine-video", resolutions: ["480p", "720p"] },
  ];
  const STORE = "waken-php";

  const $ = (id) => document.getElementById(id);
  const state = {
    source: null,
    presetId: "subtle",
    extraPrompt: "",
    intensity: "medium",
    duration: 6,
    resolution: "720p",
    modelId: "grok-imagine-video-1.5",
    currentJob: null,
    history: [],
    aiAvailable: null,
    writing: "",
  };

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
  }

  function save() {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        presetId: state.presetId,
        extraPrompt: state.extraPrompt,
        intensity: state.intensity,
        duration: state.duration,
        resolution: state.resolution,
        modelId: state.modelId,
        currentJob: state.currentJob,
        history: state.history.slice(0, 12),
      }),
    );
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "{}");
      Object.assign(state, {
        presetId: raw.presetId || "subtle",
        extraPrompt: raw.extraPrompt || "",
        intensity: raw.intensity || "medium",
        duration: raw.duration || 6,
        resolution: raw.resolution || "720p",
        modelId: MODELS.some((m) => m.id === raw.modelId) ? raw.modelId : "grok-imagine-video-1.5",
        currentJob: raw.currentJob || null,
        history: Array.isArray(raw.history) ? raw.history : [],
      });
    } catch {
      /* ignore */
    }
  }

  function closestAspect(w, h) {
    const ratio = w / Math.max(h, 1);
    let best = "16:9";
    let delta = Infinity;
    for (const [k, v] of Object.entries(ASPECTS)) {
      const d = Math.abs(ratio - v);
      if (d < delta) {
        best = k;
        delta = d;
      }
    }
    return best;
  }

  function drawScaled(img, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("read"));
      img.src = url;
    });
  }

  async function prepareStill(blob, name) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      const canvas = drawScaled(img, 1280);
      const thumb = drawScaled(img, 280);
      return {
        dataUrl: canvas.toDataURL("image/jpeg", 0.86),
        thumbUrl: thumb.toDataURL("image/jpeg", 0.78),
        width: canvas.width,
        height: canvas.height,
        aspect: closestAspect(canvas.width, canvas.height),
        name,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function compilePrompt() {
    const preset = PRESETS.find((p) => p.id === state.presetId) || PRESETS[0];
    const extra = state.extraPrompt.trim();
    return [
      "Animate this still as a photoreal cinematic shot.",
      preset.prompt,
      extra ? "Director notes: " + extra : "",
      INTENSITY[state.intensity],
      "Keep identity, wardrobe, lighting, and composition from the source frame. No morphing, no extra people, no text, no watermark, no logo.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function clipHref(videoUrl) {
    const params = new URLSearchParams({ src: videoUrl, name: "waken-clip.mp4" });
    return "/api/clip?" + params.toString();
  }

  function busy() {
    const j = state.currentJob;
    return j && (j.status === "queued" || j.status === "rendering");
  }

  function render() {
    const job = state.currentJob;
    const videoUrl = job && job.status === "done" && job.videoUrl ? job.videoUrl : null;
    $("meta").textContent = state.source ? state.source.width + "×" + state.source.height : "No still";
    $("empty").classList.toggle("hidden", Boolean(state.source || videoUrl));
    $("still").classList.toggle("hidden", Boolean(videoUrl) || !state.source);
    $("player").classList.toggle("hidden", !videoUrl);
    if (state.source) {
      $("still").src = state.source.dataUrl;
      $("still").alt = state.source.name;
    }
    if (videoUrl) {
      if ($("player").src !== videoUrl) {
        $("player").src = videoUrl;
        $("player").poster = state.source ? state.source.dataUrl : job.sourceThumb || "";
      }
    }
    $("busy").classList.toggle("hidden", !busy());
    if (busy() && job) {
      $("busy-tag").textContent =
        (job.status === "queued" ? "Queued" : "Rendering") + (job.progress > 0 ? " · " + job.progress + "%" : "");
      $("bar").style.width = Math.max(6, job.progress) + "%";
    }
    const download = videoUrl ? clipHref(videoUrl) : "";
    $("clip-card").classList.toggle("hidden", !download);
    if (download) {
      $("clip-link").href = download;
      $("clip-btn").href = download;
    }
    $("replace").classList.toggle("hidden", !(state.source || videoUrl) || busy());
    $("queue").disabled = !state.source || busy() || state.aiAvailable === false;
    $("queue").textContent = busy() ? "In queue" : "Queue clip";
    $("write").disabled = !state.source || state.writing || state.aiAvailable === false;
    $("write").textContent = state.writing === "write" ? "Reading still" : "Write from still";
    $("enhance").disabled = !state.source || state.extraPrompt.trim().length < 3 || state.writing || state.aiAvailable === false;
    $("enhance").textContent = state.writing === "enhance" ? "Enhancing" : "Enhance note";
    const model = MODELS.find((m) => m.id === state.modelId) || MODELS[0];
    if ($("model")) $("model").value = model.id;
    document.querySelectorAll("#resolution button").forEach((el) => {
      const allowed = model.resolutions.includes(el.dataset.v);
      el.hidden = !allowed;
      el.disabled = !allowed;
    });
    $("ai-note").classList.toggle("hidden", state.aiAvailable !== false);
    $("notes").value = state.extraPrompt;
    document.querySelectorAll("#presets .chip").forEach((el) => {
      el.setAttribute("aria-pressed", el.dataset.id === state.presetId ? "true" : "false");
    });
    document.querySelectorAll("#intensity button").forEach((el) => {
      el.setAttribute("aria-checked", el.dataset.v === state.intensity ? "true" : "false");
    });
    document.querySelectorAll("#duration button").forEach((el) => {
      el.setAttribute("aria-checked", Number(el.dataset.v) === state.duration ? "true" : "false");
    });
    document.querySelectorAll("#resolution button").forEach((el) => {
      el.setAttribute("aria-checked", el.dataset.v === state.resolution ? "true" : "false");
    });
    const thumbs = $("thumbs");
    $("roll").classList.toggle("hidden", state.history.length === 0);
    thumbs.innerHTML = "";
    state.history.forEach((item) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb" + (job && job.id === item.id ? " on" : "");
      b.innerHTML =
        '<img alt="" src="' +
        (item.sourceThumb || "") +
        '"><span>' +
        (item.status === "done" ? item.duration + "s" : item.status === "failed" ? "Failed" : "Live") +
        "</span>";
      b.addEventListener("click", () => {
        state.currentJob = item;
        save();
        render();
      });
      thumbs.appendChild(b);
    });
  }

  function segs(root, options, key) {
    root.innerHTML = "";
    options.forEach(([value, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.v = value;
      b.textContent = label;
      b.addEventListener("click", () => {
        state[key] = typeof state[key] === "number" ? Number(value) : value;
        save();
        render();
      });
      root.appendChild(b);
    });
  }

  async function onFile(file) {
    if (!file || !(file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(file.name))) {
      toast("Use a still — JPEG, PNG, or WebP.");
      return;
    }
    try {
      state.source = await prepareStill(file, file.name);
      render();
    } catch {
      toast("Could not read that still.");
    }
  }

  async function queueClip() {
    if (!state.source) {
      toast("Load a still first.");
      return;
    }
    if (busy()) {
      toast("A clip is already in the queue.");
      return;
    }
    const job = {
      id: crypto.randomUUID(),
      requestId: null,
      status: "queued",
      progress: 2,
      error: null,
      prompt: compilePrompt(),
      duration: state.duration,
      resolution: state.resolution,
      aspectRatio: state.source.aspect,
      model: state.modelId,
      sourceThumb: state.source.thumbUrl,
      videoUrl: null,
      createdAt: Date.now(),
    };
    state.currentJob = job;
    state.history = [job, ...state.history.filter((h) => h.id !== job.id)].slice(0, 12);
    save();
    render();
    const res = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: state.source.dataUrl,
        prompt: job.prompt,
        duration: job.duration,
        resolution: job.resolution,
        aspectRatio: job.aspectRatio,
        model: job.model,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      job.status = "failed";
      job.error = data.error;
      save();
      render();
      toast(data.error);
      return;
    }
    job.requestId = data.requestId;
    job.status = "rendering";
    job.progress = 8;
    save();
    render();
    poll(job.id, data.requestId);
  }

  async function poll(jobId, requestId) {
    const tick = async () => {
      const job = state.currentJob;
      if (!job || job.id !== jobId) return;
      if (job.status === "done" || job.status === "failed") return;
      const res = await fetch("/api/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const data = await res.json();
      if (!data.ok) {
        job.status = "failed";
        job.error = data.error;
        job.progress = 0;
        save();
        render();
        toast(data.error);
        return;
      }
      if (data.status === "done") {
        job.status = "done";
        job.progress = 100;
        job.videoUrl = data.videoUrl;
        job.error = null;
        save();
        render();
        toast("Clip is ready.");
        return;
      }
      job.status = "rendering";
      job.progress = data.progress;
      save();
      render();
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 1200);
  }

  function paintCoastalSample() {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const sky = ctx.createLinearGradient(0, 0, 0, 420);
    sky.addColorStop(0, "#cfe4f4");
    sky.addColorStop(1, "#f3efe4");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1280, 720);
    const sea = ctx.createLinearGradient(0, 400, 0, 620);
    sea.addColorStop(0, "#6a93a8");
    sea.addColorStop(1, "#cbb99a");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 400, 1280, 320);
    ctx.fillStyle = "#d9c7a6";
    ctx.fillRect(0, 560, 1280, 160);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
  }

  load();
  segs($("intensity"), [["subtle", "Soft"], ["medium", "Medium"], ["strong", "Strong"]], "intensity");
  segs($("duration"), [[6, "6s"], [10, "10s"], [15, "15s"]], "duration");
  segs($("resolution"), [["480p", "Draft"], ["720p", "Standard"], ["1080p", "High"]], "resolution");
  PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.id = p.id;
    b.textContent = p.label;
    b.addEventListener("click", () => {
      state.presetId = p.id;
      save();
      render();
    });
    $("presets").appendChild(b);
  });
  $("notes").addEventListener("input", (e) => {
    state.extraPrompt = e.target.value;
    save();
  });
  $("model").addEventListener("change", (e) => {
    state.modelId = e.target.value;
    const model = MODELS.find((m) => m.id === state.modelId) || MODELS[0];
    if (!model.resolutions.includes(state.resolution)) state.resolution = "720p";
    save();
    render();
  });
  $("choose").addEventListener("click", () => $("file").click());
  $("replace").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) onFile(file);
    e.target.value = "";
  });
  $("sample").addEventListener("click", async () => {
    try {
      const blob = await paintCoastalSample();
      state.source = await prepareStill(blob, "coastal-still.jpg");
      render();
    } catch {
      toast("Could not load the sample still.");
    }
  });
  async function draftNotes(mode) {
    if (!state.source || state.writing) return;
    const notes = state.extraPrompt.trim();
    if (mode === "enhance" && notes.length < 3) {
      toast("Add a note first, then enhance it.");
      return;
    }
    state.writing = mode;
    render();
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: state.source.dataUrl,
          presetId: state.presetId,
          mode,
          notes,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || (mode === "enhance" ? "Could not enhance the note." : "Could not read the still."));
        return;
      }
      state.extraPrompt = data.prompt;
      save();
      toast(mode === "enhance" ? "Notes enhanced." : "Director notes written from the still.");
    } catch {
      toast(mode === "enhance" ? "Could not enhance the note." : "Could not read the still.");
    } finally {
      state.writing = "";
      render();
    }
  }

  $("queue").addEventListener("click", () => void queueClip());
  $("write").addEventListener("click", () => void draftNotes("write"));
  $("enhance").addEventListener("click", () => void draftNotes("enhance"));
  const frame = $("frame");
  frame.addEventListener("dragover", (e) => {
    e.preventDefault();
    $("drop").classList.remove("hidden");
  });
  frame.addEventListener("dragleave", () => $("drop").classList.add("hidden"));
  frame.addEventListener("drop", (e) => {
    e.preventDefault();
    $("drop").classList.add("hidden");
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && file.type.startsWith("image/")) {
          e.preventDefault();
          onFile(file);
          return;
        }
      }
    }
  });

  fetch("/api/status")
    .then((r) => r.json())
    .then((d) => {
      state.aiAvailable = Boolean(d.available);
      render();
    })
    .catch(() => {
      state.aiAvailable = false;
      render();
    });

  if (state.currentJob && state.currentJob.requestId && (state.currentJob.status === "queued" || state.currentJob.status === "rendering")) {
    poll(state.currentJob.id, state.currentJob.requestId);
  }
  render();
})();
