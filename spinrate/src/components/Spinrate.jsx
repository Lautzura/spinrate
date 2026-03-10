'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  bg:       "#0f1117",
  surface:  "#181c27",
  surface2: "#1e2333",
  border:   "#2a2f45",
  text:     "#e8eaf0",
  textSub:  "#7b82a0",
  textMute: "#4a5070",
  accent:   "#7c6fff",
  accent2:  "#a78bfa",
  like:     "#f06292",
};

const ACCENTS = ["#7c6fff","#4fc3f7","#f06292","#4db6ac","#ffb347","#a78bfa","#81d4fa"];
function accentFor(seed) {
  const n = (seed||"").split("").reduce((a,c) => a+c.charCodeAt(0), 0);
  return ACCENTS[Math.abs(n) % ACCENTS.length];
}
function timeAgo(d) {
  const s = (Date.now()-new Date(d))/1000;
  if(s<60) return "ahora";
  if(s<3600) return `hace ${Math.floor(s/60)} min`;
  if(s<86400) return `hace ${Math.floor(s/3600)}h`;
  return `hace ${Math.floor(s/86400)}d`;
}

// ─── AUDIO PLAYER ────────────────────────────────────────────────────────────
// Global audio instance so only one plays at a time
const globalAudio = { current: null };

function PlayButton({ previewUrl, size=32 }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  const toggle = (e) => {
    e.stopPropagation();
    if (!previewUrl) return;

    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }

    // Stop any other playing audio
    if (globalAudio.current && globalAudio.current !== audioRef.current) {
      globalAudio.current.pause();
    }

    if (!audioRef.current) {
      setLoading(true);
      const audio = new Audio(previewUrl);
      audioRef.current = audio;
      globalAudio.current = audio;
      audio.addEventListener("canplay", () => setLoading(false));
      audio.addEventListener("timeupdate", () => {
        setProgress((audio.currentTime / audio.duration) * 100 || 0);
      });
      audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    }

    audioRef.current.play().catch(() => setLoading(false));
    setPlaying(true);
  };

  if (!previewUrl) return null;

  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
      {playing && (
        <svg style={{ position:"absolute", inset:0, transform:"rotate(-90deg)", pointerEvents:"none" }} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={size/2-2} fill="none" stroke={T.accent+"33"} strokeWidth="2"/>
          <circle cx={size/2} cy={size/2} r={size/2-2} fill="none" stroke={T.accent} strokeWidth="2"
            strokeDasharray={`${2*Math.PI*(size/2-2)}`}
            strokeDashoffset={`${2*Math.PI*(size/2-2)*(1-progress/100)}`}
            style={{ transition:"stroke-dashoffset 0.2s" }}/>
        </svg>
      )}
      <button onClick={toggle}
        style={{ width:size, height:size, borderRadius:"50%", background:playing?T.accent:`${T.accent}22`, border:`1.5px solid ${playing?T.accent:T.accent+"55"}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", zIndex:1, transition:"all 0.15s" }}>
        {loading
          ? <div style={{ width:size*0.35, height:size*0.35, border:`2px solid ${T.accent}44`, borderTopColor:"white", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
          : playing
            ? <svg width={size*0.38} height={size*0.38} viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width={size*0.38} height={size*0.38} viewBox="0 0 24 24" fill={T.accent}><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
    </div>
  );
}

// ─── MUSICBRAINZ ─────────────────────────────────────────────────────────────
async function searchMusicBrainz(query) {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&type=album&limit=6&fmt=json`, { headers:{"User-Agent":"Spinrate/1.0"} });
    const data = await res.json();
    const results = (data["release-groups"]||[]).map(rg => ({
      mbid: rg.id, title: rg.title,
      artist: rg["artist-credit"]?.[0]?.name||"Desconocido",
      year: rg["first-release-date"]?.slice(0,4)||"—",
      cover: null,
    }));
    // Resolve covers via proxy (in parallel, best effort)
    await Promise.all(results.map(async r => {
      const cover = await resolveCoverUrl(r.mbid, r.artist, r.title);
      if (cover) r.cover = cover;
    }));
    return results;
  } catch { return []; }
}

async function resolveCoverUrl(mbid, artist="", title="") {
  try {
    const params = new URLSearchParams({ mbid, artist, title, mode:"album" });
    const res = await fetch(`/api/cover?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch { return null; }
}

async function resolveAlbumFull(mbid, artist="", title="") {
  // Returns { coverUrl, previewUrl, trackPreviews }
  try {
    const params = new URLSearchParams({ mbid, artist, title, mode:"album" });
    const res = await fetch(`/api/cover?${params}`);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function fetchTracklist(mbid) {
  try {
    // Get releases for this release-group, pick first
    const res1 = await fetch(`https://musicbrainz.org/ws/2/release?release-group=${mbid}&limit=1&fmt=json`, { headers:{"User-Agent":"Spinrate/1.0"} });
    const d1 = await res1.json();
    const releaseId = d1.releases?.[0]?.id;
    if (!releaseId) return [];
    const res2 = await fetch(`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings&fmt=json`, { headers:{"User-Agent":"Spinrate/1.0"} });
    const d2 = await res2.json();
    const tracks = d2.media?.[0]?.tracks || [];
    return tracks.map((t,i) => ({ number: t.position||i+1, title: t.title, length: t.length }));
  } catch { return []; }
}

// ─── HALF STARS ──────────────────────────────────────────────────────────────
function Stars({ n, onChange, size=16 }) {
  const [hover, setHover] = useState(0);
  const current = hover || n;

  const handleMouseMove = (e, i) => {
    if (!onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const half = e.clientX < rect.left + rect.width / 2;
    setHover(half ? i - 0.5 : i);
  };

  const handleClick = (e, i) => {
    if (!onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const half = e.clientX < rect.left + rect.width / 2;
    onChange(half ? i - 0.5 : i);
  };

  return (
    <div style={{ display:"flex", gap:1 }}>
      {[1,2,3,4,5].map(i => {
        const full  = current >= i;
        const half  = !full && current >= i - 0.5;
        const empty = !full && !half;
        const col   = "#f5a623";
        const dim   = "#3a3f5a";
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24"
            onMouseMove={e => handleMouseMove(e, i)}
            onMouseLeave={() => onChange && setHover(0)}
            onClick={e => handleClick(e, i)}
            style={{ cursor:onChange?"pointer":"default", flexShrink:0 }}>
            <defs>
              <clipPath id={`h${size}-${i}`}>
                <rect x="0" y="0" width="12" height="24"/>
              </clipPath>
            </defs>
            {/* empty base */}
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
              fill="none" stroke={dim} strokeWidth="1.5"/>
            {/* filled portion */}
            {(full || half) && (
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
                fill={col} stroke={col} strokeWidth="1.5"
                clipPath={half ? `url(#h${size}-${i})` : undefined}/>
            )}
          </svg>
        );
      })}
    </div>
  );
}

function RatingDisplay({ n, size=14 }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <Stars n={n} size={size}/>
      <span style={{ fontSize:size-2, color:T.textSub, fontWeight:600 }}>{n}</span>
    </div>
  );
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function Avatar({ src, name, size=36 }) {
  const [err, setErr] = useState(false);
  if (!src||err) return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:`linear-gradient(135deg,${T.accent},${T.accent2})`, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:size*0.38, fontWeight:700, flexShrink:0 }}>
      {name?.[0]?.toUpperCase()||"?"}
    </div>
  );
  return <img src={src} alt={name} onError={()=>setErr(true)} style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", flexShrink:0 }}/>;
}

function AlbumCover({ src, ac, size=72 }) {
  const [err, setErr] = useState(false);
  const col = ac||T.accent;
  return (
    <div style={{ width:size, height:size, borderRadius:size>60?12:8, flexShrink:0, overflow:"hidden", background:`linear-gradient(135deg,${col}33,${col}11)`, boxShadow:`0 4px 20px ${col}33` }}>
      {src&&!err
        ? <img src={src} alt="" onError={()=>setErr(true)} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
        : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.35, color:col }}>♪</div>
      }
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display:"flex", justifyContent:"center", padding:"48px 0" }}>
      <div style={{ width:28, height:28, border:`3px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
    </div>
  );
}

function msToMin(ms) {
  if (!ms) return "";
  const s = Math.floor(ms/1000);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}

// ─── BOTTOM NAV ──────────────────────────────────────────────────────────────
function BottomNav({ current, onNavigate }) {
  const items = [
    { key:"feed",    label:"Inicio",  icon:(a) => <svg width="20" height="20" viewBox="0 0 24 24" fill={a?T.accent:"none"} stroke={a?T.accent:T.textMute} strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg> },
    { key:"search",  label:"Explorar",icon:(a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?T.accent:T.textMute} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
    { key:"lists",   label:"Listas",  icon:(a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?T.accent:T.textMute} strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
    { key:"notifs",  label:"Notifs",  icon:(a) => <svg width="20" height="20" viewBox="0 0 24 24" fill={a?T.accent:"none"} stroke={a?T.accent:T.textMute} strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> },
    { key:"profile", label:"Perfil",  icon:(a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?T.accent:T.textMute} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
  ];
  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:100, background:`${T.surface}ee`, backdropFilter:"blur(16px)", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"center" }}>
      <div style={{ display:"flex", width:"100%", maxWidth:560 }}>
        {items.map(item => {
          const active = current===item.key;
          return (
            <button key={item.key} onClick={()=>onNavigate(item.key)} style={{ flex:1, padding:"10px 0 14px", background:"none", border:"none", display:"flex", flexDirection:"column", alignItems:"center", gap:4, cursor:"pointer", color:active?T.accent:T.textMute }}>
              {item.icon(active)}
              <span style={{ fontSize:10, fontWeight:active?700:400 }}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthPage({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text:"", ok:false });

  const inp = { width:"100%", padding:"12px 14px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"inherit" };

  const handleSubmit = async () => {
    setMsg({text:"",ok:false}); setLoading(true);
    try {
      if (mode==="login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session, data.user);
      } else {
        const { error } = await supabase.auth.signUp({ email, password, options:{ data:{ username, display_name:username } } });
        if (error) throw error;
        setMode("login"); setMsg({ text:"¡Cuenta creada! Iniciá sesión.", ok:true });
      }
    } catch(e) { setMsg({ text:e.message, ok:false }); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(160deg,#0f1117 0%,#1a1040 100%)`, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:T.surface, borderRadius:24, padding:"36px 32px", width:"100%", maxWidth:400, boxShadow:"0 24px 60px rgba(0,0,0,0.5)", border:`1px solid ${T.border}` }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ width:52, height:52, borderRadius:16, background:`linear-gradient(135deg,${T.accent},${T.accent2})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, margin:"0 auto 14px", boxShadow:`0 8px 24px ${T.accent}44` }}>♪</div>
          <div style={{ fontSize:26, fontWeight:800, color:T.text }}>spinrate</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:4 }}>{mode==="login"?"Iniciá sesión":"Creá tu cuenta gratis"}</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {mode==="signup" && <input placeholder="Nombre de usuario" value={username} onChange={e=>setUsername(e.target.value)} style={inp}/>}
          <input placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} style={inp}/>
          <input placeholder="Contraseña" type="password" value={password} onChange={e=>setPassword(e.target.value)} style={inp} onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
          {msg.text && <div style={{ fontSize:13, color:msg.ok?"#4db6ac":T.like, background:msg.ok?"#4db6ac15":"#f0629215", borderRadius:8, padding:"8px 12px" }}>{msg.text}</div>}
          <button onClick={handleSubmit} disabled={loading} style={{ padding:"13px", background:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:12, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", opacity:loading?0.7:1 }}>
            {loading?"...":(mode==="login"?"Entrar":"Crear cuenta")}
          </button>
          <button onClick={()=>{ setMode(mode==="login"?"signup":"login"); setMsg({text:"",ok:false}); }} style={{ background:"none", border:"none", color:T.accent, fontSize:13, fontWeight:600, cursor:"pointer" }}>
            {mode==="login"?"¿No tenés cuenta? Registrate":"¿Ya tenés cuenta? Iniciá sesión"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SEARCH ALBUM ROW (with preview) ────────────────────────────────────────
function SearchAlbumRow({ album, onSelect }) {
  const [preview, setPreview] = useState(null);
  const [fetchingPreview, setFetchingPreview] = useState(false);

  // Fetch preview URL on mount in background
  useEffect(() => {
    setFetchingPreview(true);
    const params = new URLSearchParams({ mbid:album.mbid, artist:album.artist, title:album.title, mode:"album" });
    fetch(`/api/cover?${params}`)
      .then(r=>r.json())
      .then(d=>{ if(d.previewUrl) setPreview(d.previewUrl); })
      .catch(()=>{})
      .finally(()=>setFetchingPreview(false));
  }, [album.mbid]);

  return (
    <div style={{ display:"flex", gap:12, alignItems:"center", padding:"10px 12px", borderRadius:12, border:`1px solid ${T.border}`, background:T.surface2, transition:"border-color 0.12s" }}
      onMouseEnter={e=>e.currentTarget.style.borderColor=T.accent}
      onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
      <div onClick={onSelect} style={{ width:48, height:48, borderRadius:6, overflow:"hidden", flexShrink:0, background:T.border, cursor:"pointer" }}>
        <img src={album.cover} alt="" onError={e=>e.target.style.display="none"} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
      </div>
      <div onClick={onSelect} style={{ flex:1, minWidth:0, cursor:"pointer" }}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{album.title}</div>
        <div style={{ fontSize:12, color:T.textSub }}>{album.artist} · {album.year}</div>
      </div>
      {fetchingPreview
        ? <div style={{ width:28, height:28, border:`2px solid ${T.border}`, borderTopColor:T.accent+"44", borderRadius:"50%", flexShrink:0 }}/>
        : <PlayButton previewUrl={preview} size={28}/>
      }
      <div onClick={onSelect} style={{ cursor:"pointer", padding:"0 4px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2"><polyline points="9,18 15,12 9,6"/></svg>
      </div>
    </div>
  );
}

// ─── WRITE MODAL (album review) ──────────────────────────────────────────────
function WriteModal({ onClose, onAdd }) {
  const [step, setStep] = useState("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [coverErr, setCoverErr] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    if (query.trim().length<2) { setResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async()=>{
      setSearching(true);
      setResults(await searchMusicBrainz(query));
      setSearching(false);
    }, 500);
  }, [query]);

  const handleSubmit = async () => {
    if (!selected||!rating||text.length<10) return;
    setSubmitting(true);
    try {
      const { data:existing } = await supabase.from("albums").select("id").eq("mbid", selected.mbid).single();
      let albumId = existing?.id;
      if (!albumId) {
        // Resolve real cover URL before saving
        const resolvedCover = coverErr ? null : (await resolveCoverUrl(selected.mbid, selected.artist, selected.title) || selected.cover);
        const { data:created, error } = await supabase.from("albums").insert({ mbid:selected.mbid, title:selected.title, artist:selected.artist, year:selected.year, cover_url:resolvedCover }).select("id").single();
        if (error) throw error;
        albumId = created.id;
      } else {
        // If album exists but has no cover, try to update it
        const { data:albumData } = await supabase.from("albums").select("cover_url").eq("id", albumId).single();
        if (!albumData?.cover_url) {
          const resolvedCover = await resolveCoverUrl(selected.mbid, selected.artist, selected.title);
          if (resolvedCover) await supabase.from("albums").update({ cover_url: resolvedCover }).eq("id", albumId);
        }
      }
      const { error } = await supabase.from("reviews").insert({ album_id:albumId, rating, text });
      if (error) throw error;
      onAdd(); onClose();
    } catch(e) { alert("Error: "+e.message); }
    setSubmitting(false);
  };

  const ready = selected && rating && text.length>=10 && !submitting;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200, backdropFilter:"blur(8px)" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.surface, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:560, border:`1px solid ${T.border}`, borderBottom:"none", maxHeight:"88vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:T.border }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 24px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {step==="review" && <button onClick={()=>setStep("search")} style={{ background:"none", border:"none", cursor:"pointer", color:T.accent, fontSize:13, fontWeight:600, padding:0 }}>← Volver</button>}
            <div style={{ fontSize:17, fontWeight:700, color:T.text }}>{step==="search"?"¿Qué álbum reseñás?":"Tu reseña del álbum"}</div>
          </div>
          <button onClick={onClose} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:15, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>

        {step==="search" && (
          <div style={{ padding:"0 24px", flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
            <div style={{ position:"relative", marginBottom:14 }}>
              <svg style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar álbum o artista..."
                style={{ width:"100%", padding:"12px 14px 12px 38px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"inherit" }}
                onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
            </div>
            <div style={{ flex:1, overflowY:"auto" }}>
              {searching && <Spinner/>}
              {!searching && query.length>=2 && results.length===0 && <div style={{ textAlign:"center", padding:"32px 0", color:T.textSub, fontSize:13 }}>Sin resultados para "{query}"</div>}
              {!searching && results.length>0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {results.map(album => (
                    <SearchAlbumRow key={album.mbid} album={album} onSelect={()=>{ setSelected(album); setCoverErr(false); setStep("review"); }}/>
                  ))}
                </div>
              )}
              {!query && <div style={{ textAlign:"center", padding:"40px 0" }}><div style={{ fontSize:36, marginBottom:10 }}>🎧</div><div style={{ fontSize:14, color:T.textSub }}>Escribí el nombre de un álbum</div></div>}
            </div>
          </div>
        )}

        {step==="review" && selected && (
          <div style={{ padding:"0 24px 24px", flex:1, overflowY:"auto" }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", background:T.surface2, borderRadius:14, padding:"14px", marginBottom:20, border:`1px solid ${T.border}` }}>
              <div style={{ width:60, height:60, borderRadius:8, overflow:"hidden", flexShrink:0, background:T.border }}>
                {!coverErr ? <img src={selected.cover} alt="" onError={()=>setCoverErr(true)} style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:T.accent }}>♪</div>}
              </div>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:T.text }}>{selected.title}</div>
                <div style={{ fontSize:13, color:T.textSub }}>{selected.artist} · {selected.year}</div>
              </div>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.textMute, fontWeight:600, letterSpacing:0.5, marginBottom:10 }}>PUNTUACIÓN DEL ÁLBUM</div>
              <Stars n={rating} onChange={setRating} size={32}/>
              {rating > 0 && <div style={{ fontSize:12, color:T.textSub, marginTop:6 }}>{rating} estrellas</div>}
            </div>
            <textarea placeholder="¿Qué te pareció el álbum? (mínimo 10 caracteres)"
              value={text} onChange={e=>setText(e.target.value)} rows={4}
              style={{ width:"100%", padding:"12px 14px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"Georgia,serif", resize:"none", lineHeight:1.6, marginBottom:16 }}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
            <button onClick={handleSubmit} disabled={!ready} style={{ width:"100%", padding:"13px", background:ready?`linear-gradient(135deg,${T.accent},${T.accent2})`:"#2a2f45", border:"none", borderRadius:12, color:ready?"#fff":T.textMute, fontSize:15, fontWeight:600, cursor:ready?"pointer":"default" }}>
              {submitting?"Publicando...":"Publicar reseña del álbum"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TRACK REVIEW MODAL ───────────────────────────────────────────────────────
function TrackReviewModal({ track, albumId, existing, onClose, onSave }) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [text, setText] = useState(existing?.text || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!rating) return;
    setSaving(true);
    try {
      if (existing) {
        const { error } = await supabase.from("track_reviews").update({ rating, text }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("track_reviews").insert({ album_id:albumId, track_number:track.number, track_title:track.title, rating, text });
        if (error) throw error;
      }
      onSave();
      onClose();
    } catch(e) { alert("Error: "+e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, backdropFilter:"blur(8px)", padding:20 }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.surface, borderRadius:20, width:"100%", maxWidth:420, border:`1px solid ${T.border}`, padding:"24px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div>
            <div style={{ fontSize:13, color:T.textMute, marginBottom:2 }}>Reseña de canción</div>
            <div style={{ fontSize:17, fontWeight:700, color:T.text }}>{track.number}. {track.title}</div>
            {track.length && <div style={{ fontSize:12, color:T.textMute, marginTop:1 }}>{msToMin(track.length)}</div>}
          </div>
          <button onClick={onClose} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:15, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:T.textMute, fontWeight:600, letterSpacing:0.5, marginBottom:10 }}>PUNTUACIÓN</div>
          <Stars n={rating} onChange={setRating} size={28}/>
          {rating > 0 && <div style={{ fontSize:12, color:T.textSub, marginTop:6 }}>{rating} estrellas</div>}
        </div>
        <textarea placeholder="Opcional: ¿qué te pareció esta canción?" value={text} onChange={e=>setText(e.target.value)} rows={3}
          style={{ width:"100%", padding:"12px 14px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"Georgia,serif", resize:"none", lineHeight:1.6, marginBottom:16 }}
          onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:"11px", background:"none", border:`1px solid ${T.border}`, borderRadius:12, color:T.textSub, fontSize:14, cursor:"pointer" }}>Cancelar</button>
          <button onClick={handleSave} disabled={!rating||saving} style={{ flex:2, padding:"11px", background:rating?`linear-gradient(135deg,${T.accent},${T.accent2})`:"#2a2f45", border:"none", borderRadius:12, color:rating?"#fff":T.textMute, fontSize:14, fontWeight:600, cursor:rating?"pointer":"default" }}>
            {saving?"Guardando...":(existing?"Actualizar":"Guardar")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TRACKLIST ────────────────────────────────────────────────────────────────
function Tracklist({ albumId, mbid, userId, trackPreviews={} }) {
  const [tracks, setTracks] = useState([]);
  const [myReviews, setMyReviews] = useState({});
  const [loading, setLoading] = useState(true);
  const [editTrack, setEditTrack] = useState(null);
  const loadTracks = async () => {
    setLoading(true);
    const tracklist = await fetchTracklist(mbid);
    setTracks(tracklist);
    if (userId && tracklist.length > 0) {
      const { data } = await supabase.from("track_reviews").select("*").eq("album_id", albumId).eq("user_id", userId);
      const map = {};
      (data||[]).forEach(r => { map[r.track_number] = r; });
      setMyReviews(map);
    }
    setLoading(false);
  };

  useEffect(() => { if (albumId && mbid) loadTracks(); }, [albumId, mbid]);

  const onSave = async () => {
    const { data } = await supabase.from("track_reviews").select("*").eq("album_id", albumId).eq("user_id", userId);
    const map = {};
    (data||[]).forEach(r => { map[r.track_number] = r; });
    setMyReviews(map);
  };

  const getTrackPreview = (track) => {
    // Try by track number first, then by title
    return trackPreviews[`track_${track.number}`] || trackPreviews[track.title?.toLowerCase()] || null;
  };

  if (loading) return <Spinner/>;
  if (tracks.length===0) return (
    <div style={{ textAlign:"center", padding:"32px 0", color:T.textMute }}>
      <div style={{ fontSize:28, marginBottom:8 }}>🎵</div>
      <div style={{ fontSize:13 }}>No se pudo cargar el tracklist</div>
    </div>
  );

  const rated = Object.keys(myReviews).length;

  return (
    <div>
      {rated > 0 && (
        <div style={{ fontSize:12, color:T.textSub, marginBottom:12, padding:"8px 12px", background:T.surface2, borderRadius:10, border:`1px solid ${T.border}` }}>
          Calificaste {rated} de {tracks.length} canciones
        </div>
      )}
      {tracks.map((track, i) => {
        const review = myReviews[track.number];
        return (
          <div key={track.number}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 0", borderBottom:`1px solid ${T.border}`, animation:`fadeUp 0.3s ease ${i*0.03}s both` }}>
            {/* Play button or track number */}
            {getTrackPreview(track)
              ? <PlayButton previewUrl={getTrackPreview(track)} size={28}/>
              : <div style={{ width:28, textAlign:"right", fontSize:13, color:T.textMute, flexShrink:0 }}>{track.number}</div>
            }
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:review?600:400, color:review?T.text:T.textSub, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{track.title}</div>
              {review && <div style={{ marginTop:3 }}><Stars n={review.rating} size={11}/></div>}
              {review?.text && <div style={{ fontSize:12, color:T.textMute, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>"{review.text}"</div>}
            </div>
            {track.length && <div style={{ fontSize:12, color:T.textMute, flexShrink:0 }}>{msToMin(track.length)}</div>}
            <button onClick={()=>setEditTrack(track)}
              style={{ flexShrink:0, background:review?`${T.accent}22`:"none", border:`1px solid ${review?T.accent:T.border}`, borderRadius:20, padding:"5px 12px", fontSize:12, color:review?T.accent:T.textMute, cursor:"pointer", fontWeight:review?600:400, transition:"all 0.15s", whiteSpace:"nowrap" }}>
              {review ? `★ ${review.rating}` : "+ Calificar"}
            </button>
          </div>
        );
      })}
      {editTrack && (
        <TrackReviewModal track={editTrack} albumId={albumId} existing={myReviews[editTrack.number]} onClose={()=>setEditTrack(null)} onSave={onSave}/>
      )}
    </div>
  );
}

// ─── REVIEW CARD ─────────────────────────────────────────────────────────────
// ─── COMMENTS MODAL ─────────────────────────────────────────────────────────
function CommentsModal({ review, onClose }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    supabase.from("comments").select("*, profiles(username,display_name,avatar_url)")
      .eq("review_id", review.id).order("created_at", {ascending:true})
      .then(({data}) => { setComments(data||[]); setLoading(false); });
  }, [review.id]);

  const postComment = async () => {
    if (!text.trim()) return;
    setPosting(true);
    const { data, error } = await supabase.from("comments")
      .insert({ review_id: review.id, text: text.trim() })
      .select("*, profiles(username,display_name,avatar_url)").single();
    if (!error && data) { setComments(prev => [...prev, data]); setText(""); }
    setPosting(false);
  };

  const ac = accentFor(review.album_id);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200, backdropFilter:"blur(8px)" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.surface, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:560, border:`1px solid ${T.border}`, borderBottom:"none", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:T.border }}/>
        </div>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 20px 12px" }}>
          <div style={{ fontSize:16, fontWeight:700, color:T.text }}>Comentarios</div>
          <button onClick={onClose} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:15, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        {/* Review mini preview */}
        <div style={{ margin:"0 20px 12px", background:`${ac}0d`, borderRadius:12, padding:"10px 12px", border:`1px solid ${ac}22` }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{review.album_title}</div>
          <div style={{ fontSize:12, color:T.textSub }}>{review.artist} · <RatingDisplay n={review.rating} size={11}/></div>
          {review.text && <div style={{ fontSize:12, color:T.textMute, marginTop:4, fontStyle:"italic" }}>"{review.text.slice(0,80)}{review.text.length>80?"...":""}"</div>}
        </div>
        {/* Comments list */}
        <div style={{ flex:1, overflowY:"auto", padding:"0 20px" }}>
          {loading ? <Spinner/> : comments.length===0 ? (
            <div style={{ textAlign:"center", padding:"32px 0", color:T.textMute }}>
              <div style={{ fontSize:24, marginBottom:6 }}>💬</div>
              <div style={{ fontSize:13 }}>Sé el primero en comentar</div>
            </div>
          ) : comments.map((c,i) => (
            <div key={c.id} style={{ display:"flex", gap:10, marginBottom:14, animation:`fadeUp 0.25s ease ${i*0.04}s both` }}>
              <Avatar src={c.profiles?.avatar_url} name={c.profiles?.display_name||c.profiles?.username} size={30}/>
              <div style={{ flex:1 }}>
                <div style={{ background:T.surface2, borderRadius:"4px 12px 12px 12px", padding:"8px 12px", border:`1px solid ${T.border}` }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T.accent }}>{c.profiles?.display_name||c.profiles?.username} </span>
                  <span style={{ fontSize:13, color:T.text }}>{c.text}</span>
                </div>
                <div style={{ fontSize:11, color:T.textMute, marginTop:3, paddingLeft:4 }}>{timeAgo(c.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Input */}
        <div style={{ padding:"12px 20px 20px", borderTop:`1px solid ${T.border}`, display:"flex", gap:10 }}>
          <input value={text} onChange={e=>setText(e.target.value)} placeholder="Escribí un comentario..."
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&postComment()}
            style={{ flex:1, padding:"10px 14px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:20, fontSize:13, color:T.text, outline:"none", fontFamily:"inherit" }}
            onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          <button onClick={postComment} disabled={!text.trim()||posting}
            style={{ background:text.trim()?`linear-gradient(135deg,${T.accent},${T.accent2})`:"#2a2f45", border:"none", borderRadius:20, padding:"10px 16px", color:text.trim()?"#fff":T.textMute, fontSize:13, fontWeight:600, cursor:text.trim()?"pointer":"default", flexShrink:0 }}>
            {posting?"...":"Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SHARE MODAL ─────────────────────────────────────────────────────────────
function ShareModal({ review, onClose }) {
  const url = `${window.location.origin}?album=${review.album_id}`;
  const text = `${review.display_name||review.username} reseñó "${review.album_title}" de ${review.artist} en Spinrate`;
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2000); });
  };

  const shareOptions = [
    { label:"Twitter / X", icon:"𝕏", color:"#1a1a1a", url:`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
    { label:"WhatsApp", icon:"💬", color:"#25d366", url:`https://wa.me/?text=${encodeURIComponent(text+" "+url)}` },
    { label:"Instagram", icon:"📷", color:"#e1306c", action: () => { navigator.clipboard.writeText(url); alert("Link copiado. Pegalo en tu historia de Instagram!"); } },
    { label:"Telegram", icon:"✈️", color:"#0088cc", url:`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
  ];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200, backdropFilter:"blur(8px)" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.surface, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:560, border:`1px solid ${T.border}`, borderBottom:"none", padding:"0 0 24px" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:T.border }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 20px 16px" }}>
          <div style={{ fontSize:16, fontWeight:700, color:T.text }}>Compartir reseña</div>
          <button onClick={onClose} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:15, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        {/* Share options grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, padding:"0 20px 16px" }}>
          {shareOptions.map(opt => (
            <button key={opt.label} onClick={() => { if(opt.action) opt.action(); else window.open(opt.url,"_blank"); onClose(); }}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px", background:T.surface2, border:`1px solid ${T.border}`, borderRadius:14, cursor:"pointer", color:T.text, fontSize:13, fontWeight:600, transition:"border-color 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=opt.color}
              onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
              <span style={{ fontSize:20 }}>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
        {/* Copy link */}
        <div style={{ padding:"0 20px" }}>
          <div style={{ display:"flex", gap:8, background:T.surface2, borderRadius:12, padding:"10px 14px", border:`1px solid ${T.border}`, alignItems:"center" }}>
            <div style={{ flex:1, fontSize:12, color:T.textMute, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{url}</div>
            <button onClick={copyLink} style={{ background:copied?`${T.accent}22`:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:8, padding:"6px 14px", color:copied?T.accent:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", flexShrink:0 }}>
              {copied?"✓ Copiado":"Copiar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── REVIEW CARD ─────────────────────────────────────────────────────────────
function ReviewCard({ r, i, onNavigate }) {
  const ac = accentFor(r.album_id);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(Number(r.like_count)||0);
  const [trackReviews, setTrackReviews] = useState(null);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    supabase.from("track_reviews")
      .select("track_number,track_title,rating")
      .eq("album_id", r.album_id)
      .eq("user_id", r.user_id)
      .order("track_number", {ascending:true})
      .limit(4)
      .then(({data}) => setTrackReviews(data||[]));
  }, [r.album_id, r.user_id]);

  const toggleLike = async () => {
    try {
      if (liked) { await supabase.from("likes").delete().eq("review_id",r.id); setLikes(l=>l-1); }
      else { await supabase.from("likes").insert({ review_id:r.id }); setLikes(l=>l+1); }
      setLiked(!liked);
    } catch {}
  };

  return (
    <>
      <div style={{ background:T.surface, borderRadius:16, padding:"20px", border:`1px solid ${T.border}`, animation:`fadeUp 0.4s ease ${i*0.07}s both`, transition:"border-color 0.2s" }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.textMute}
        onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <Avatar src={r.avatar_url} name={r.display_name||r.username} size={36}/>
          <div style={{ flex:1 }}>
            <span style={{ fontSize:14, fontWeight:600, color:T.text }}>{r.display_name||r.username}</span>
            <span style={{ fontSize:12, color:T.textMute, marginLeft:5 }}>@{r.username}</span>
          </div>
          <span style={{ fontSize:11, color:T.textMute }}>{timeAgo(r.created_at)}</span>
        </div>

        {/* Album block */}
        <div style={{ display:"flex", gap:0, background:`${ac}0d`, borderRadius:12, border:`1px solid ${ac}22`, marginBottom:14, overflow:"hidden", cursor:"pointer", transition:"border-color 0.15s" }}
          onClick={()=>onNavigate("album",r.album_id)}
          onMouseEnter={e=>e.currentTarget.style.borderColor=`${ac}55`}
          onMouseLeave={e=>e.currentTarget.style.borderColor=`${ac}22`}>
          <div style={{ width:110, flexShrink:0 }}>
            <AlbumCover src={r.cover_url} ac={ac} size={110}/>
          </div>
          <div style={{ flex:1, padding:"12px 14px", display:"flex", flexDirection:"column", minWidth:0 }}>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:16, fontWeight:700, color:T.text, lineHeight:1.2, marginBottom:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.album_title}</div>
              <div style={{ fontSize:12, color:T.textSub, marginBottom:6 }}>{r.artist} · {r.year}</div>
              <RatingDisplay n={r.rating} size={13}/>
            </div>
            {trackReviews && trackReviews.length > 0 && (
              <div style={{ borderTop:`1px solid ${ac}22`, paddingTop:8, display:"flex", flexDirection:"column", gap:4 }}>
                {trackReviews.map(tr => (
                  <div key={tr.track_number} style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:11, color:T.textMute, width:14, flexShrink:0 }}>{tr.track_number}.</span>
                    <span style={{ fontSize:12, color:T.textSub, flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{tr.track_title}</span>
                    <Stars n={tr.rating} size={10}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Review text */}
        {r.text && <p style={{ fontSize:14, lineHeight:1.7, color:T.textSub, margin:"0 0 14px", fontFamily:"Georgia,serif" }}>"{r.text}"</p>}

        {/* Actions */}
        <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:12, display:"flex", gap:4, alignItems:"center" }}>
          {/* Like */}
          <button onClick={toggleLike} style={{ display:"flex", alignItems:"center", gap:5, background:liked?`${T.like}18`:"none", border:"none", borderRadius:8, padding:"6px 10px", cursor:"pointer", color:liked?T.like:T.textMute, fontSize:13, transition:"all 0.15s" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={liked?T.like:"none"} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            {likes}
          </button>
          {/* Comment */}
          <button onClick={()=>setShowComments(true)} style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"none", borderRadius:8, padding:"6px 10px", cursor:"pointer", color:T.textMute, fontSize:13, transition:"all 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.color=T.accent} onMouseLeave={e=>e.currentTarget.style.color=T.textMute}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {r.comment_count > 0 ? r.comment_count : ""}
          </button>
          {/* Share */}
          <button onClick={()=>setShowShare(true)} style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"none", borderRadius:8, padding:"6px 10px", cursor:"pointer", color:T.textMute, fontSize:13, marginLeft:"auto", transition:"all 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.color=T.accent} onMouseLeave={e=>e.currentTarget.style.color=T.textMute}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        </div>
      </div>
      {showComments && <CommentsModal review={r} onClose={()=>setShowComments(false)}/>}
      {showShare && <ShareModal review={r} onClose={()=>setShowShare(false)}/>}
    </>
  );
}

// ─── FEED ─────────────────────────────────────────────────────────────────────
function FeedPage({ onNavigate, onWrite, refreshKey }) {
  const [tab, setTab] = useState("recientes");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let query = supabase.from("feed_reviews").select("*");
    if (tab === "recientes") {
      query = query.order("created_at", {ascending:false}).limit(20);
    } else if (tab === "populares") {
      query = query.order("like_count", {ascending:false}).limit(20);
    }
    query.then(({data}) => { setReviews(data||[]); setLoading(false); });
  }, [tab, refreshKey]);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      <header style={{ position:"sticky", top:0, zIndex:50, background:`${T.bg}ee`, backdropFilter:"blur(16px)", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"0 20px" }}>
          <div style={{ height:52, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${T.accent},${T.accent2})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>♪</div>
              <span style={{ fontSize:18, fontWeight:800, color:T.text }}>spinrate</span>
            </div>
            <button onClick={onWrite} style={{ background:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:20, padding:"8px 18px", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ fontSize:16 }}>+</span> Reseñar
            </button>
          </div>
          {/* Tabs */}
          <div style={{ display:"flex", gap:0, borderTop:`1px solid ${T.border}`, marginTop:0 }}>
            {[{key:"recientes",label:"Recientes"},{key:"populares",label:"Populares"}].map(t => (
              <button key={t.key} onClick={()=>setTab(t.key)}
                style={{ flex:1, padding:"10px 0", background:"none", border:"none", borderBottom:`2px solid ${tab===t.key?T.accent:"transparent"}`, color:tab===t.key?T.accent:T.textMute, fontSize:13, fontWeight:tab===t.key?700:400, cursor:"pointer", transition:"all 0.15s" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main style={{ maxWidth:560, margin:"0 auto", padding:"20px 20px 0" }}>
        {loading ? <Spinner/> : reviews.length===0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🎵</div>
            <div style={{ fontSize:14, color:T.textSub, fontWeight:600 }}>Todavía no hay reseñas</div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {reviews.map((r,i)=><ReviewCard key={r.id} r={r} i={i} onNavigate={onNavigate}/>)}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function SearchPage({ onNavigate, userId }) {
  const [tab, setTab] = useState("albums");
  const [query, setQuery] = useState("");
  const [albumResults, setAlbumResults] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(new Set());
  const debounce = useRef(null);

  // Load who current user follows
  useEffect(() => {
    if (!userId) return;
    supabase.from("follows").select("following_id").eq("follower_id", userId)
      .then(({data}) => setFollowing(new Set((data||[]).map(f=>f.following_id))));
  }, [userId]);

  useEffect(() => {
    if (query.trim().length < 2) { setAlbumResults([]); setUserResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      const [{ data:albums }, { data:users }] = await Promise.all([
        supabase.from("albums").select("*").or(`title.ilike.%${query}%,artist.ilike.%${query}%`).limit(10),
        supabase.from("profiles").select("*").or(`username.ilike.%${query}%,display_name.ilike.%${query}%`).limit(10),
      ]);
      setAlbumResults(albums||[]);
      setUserResults(users||[]);
      setLoading(false);
    }, 400);
  }, [query]);

  const toggleFollow = async (targetId) => {
    if (targetId === userId) return;
    if (following.has(targetId)) {
      await supabase.from("follows").delete().eq("follower_id", userId).eq("following_id", targetId);
      setFollowing(prev => { const s=new Set(prev); s.delete(targetId); return s; });
    } else {
      await supabase.from("follows").insert({ follower_id: userId, following_id: targetId });
      setFollowing(prev => new Set([...prev, targetId]));
    }
  };

  const tabs = [
    { key:"albums", label:"Álbumes" },
    { key:"users",  label:"Usuarios" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      <div style={{ background:`${T.bg}ee`, backdropFilter:"blur(16px)", borderBottom:`1px solid ${T.border}`, padding:"16px 20px 0", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <div style={{ fontSize:20, fontWeight:800, color:T.text, marginBottom:12 }}>Explorar</div>
          <div style={{ position:"relative", marginBottom:0 }}>
            <svg style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==="albums"?"Buscar álbumes...":"Buscar usuarios..."}
              style={{ width:"100%", padding:"11px 14px 11px 38px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"inherit" }}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          </div>
          {/* Tabs */}
          <div style={{ display:"flex", marginTop:12 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={()=>setTab(t.key)}
                style={{ flex:1, padding:"10px 0", background:"none", border:"none", borderBottom:`2px solid ${tab===t.key?T.accent:"transparent"}`, color:tab===t.key?T.accent:T.textMute, fontSize:13, fontWeight:tab===t.key?700:400, cursor:"pointer", transition:"all 0.15s" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:560, margin:"0 auto", padding:"20px 20px 0" }}>
        {loading ? <Spinner/> : (
          <>
            {/* Albums tab */}
            {tab==="albums" && (
              albumResults.length>0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {albumResults.map(a => {
                    const ac = accentFor(a.id);
                    return (
                      <div key={a.id} onClick={()=>onNavigate("album",a.id)}
                        style={{ background:T.surface, borderRadius:14, padding:"14px 16px", display:"flex", gap:14, alignItems:"center", cursor:"pointer", border:`1px solid ${T.border}`, transition:"border-color 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor=T.textMute}
                        onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                        <AlbumCover src={a.cover_url} ac={ac} size={52}/>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:15, fontWeight:700, color:T.text }}>{a.title}</div>
                          <div style={{ fontSize:13, color:T.textSub }}>{a.artist} · {a.year}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign:"center", padding:"48px 0" }}>
                  <div style={{ fontSize:36, marginBottom:10 }}>🎵</div>
                  <div style={{ fontSize:14, color:T.textSub }}>{query.length>=2?"Sin resultados":"Buscá álbumes reseñados"}</div>
                </div>
              )
            )}

            {/* Users tab */}
            {tab==="users" && (
              userResults.length>0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {userResults.map(u => {
                    const isMe = u.id === userId;
                    const isFollowing = following.has(u.id);
                    return (
                      <div key={u.id} style={{ background:T.surface, borderRadius:14, padding:"14px 16px", display:"flex", gap:14, alignItems:"center", border:`1px solid ${T.border}`, animation:"fadeUp 0.3s ease both" }}>
                        <Avatar src={u.avatar_url} name={u.display_name||u.username} size={48}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:15, fontWeight:700, color:T.text }}>{u.display_name||u.username}</div>
                          <div style={{ fontSize:12, color:T.textSub }}>@{u.username}</div>
                          {u.bio && <div style={{ fontSize:12, color:T.textMute, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{u.bio}</div>}
                        </div>
                        {!isMe && (
                          <button onClick={()=>toggleFollow(u.id)}
                            style={{ flexShrink:0, padding:"7px 16px", borderRadius:20, border:`1.5px solid ${isFollowing?T.border:T.accent}`, background:isFollowing?"none":`linear-gradient(135deg,${T.accent},${T.accent2})`, color:isFollowing?T.textSub:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}>
                            {isFollowing?"Siguiendo":"Seguir"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign:"center", padding:"48px 0" }}>
                  <div style={{ fontSize:36, marginBottom:10 }}>👤</div>
                  <div style={{ fontSize:14, color:T.textSub }}>{query.length>=2?"Sin usuarios encontrados":"Buscá por nombre o usuario"}</div>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── NOTIFS ───────────────────────────────────────────────────────────────────
function NotifsPage({ userId, onNavigate }) {
  const [notifs, setNotifs] = useState([]);
  const [actors, setActors] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    supabase.from("notifications").select("*").eq("user_id", userId)
      .order("created_at", {ascending:false}).limit(40)
      .then(async ({data}) => {
        const ns = data||[];
        setNotifs(ns);
        // Load actor profiles
        const actorIds = [...new Set(ns.map(n=>n.actor_id).filter(Boolean))];
        if (actorIds.length > 0) {
          const { data:profiles } = await supabase.from("profiles").select("id,username,display_name,avatar_url").in("id", actorIds);
          const map = {};
          (profiles||[]).forEach(p => map[p.id] = p);
          setActors(map);
        }
        setLoading(false);
      });
  }, [userId]);

  const markAllRead = async () => {
    await supabase.from("notifications").update({read:true}).eq("user_id",userId).eq("read",false);
    setNotifs(prev=>prev.map(n=>({...n,read:true})));
  };

  const getNotifContent = (n) => {
    const actor = actors[n.actor_id];
    const name = actor ? (actor.display_name || `@${actor.username}`) : "Alguien";
    switch(n.type) {
      case "follow":  return { icon:"👤", text:`${name} empezó a seguirte`, accent:T.accent };
      case "like":    return { icon:"❤️", text:`${name} le dio like a tu reseña`, accent:T.like };
      case "comment": return { icon:"💬", text:`${name} comentó tu reseña${n.data?.comment ? `: "${n.data.comment}"` : ""}`, accent:"#4fc3f7" };
      default:        return { icon:"🔔", text:n.type, accent:T.accent };
    }
  };

  const unread = notifs.filter(n=>!n.read).length;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      <div style={{ background:`${T.bg}ee`, backdropFilter:"blur(16px)", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, zIndex:50 }}>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:20, fontWeight:800, color:T.text }}>Notificaciones</div>
            {unread>0 && <div style={{ background:T.accent, borderRadius:20, padding:"2px 8px", fontSize:11, fontWeight:700, color:"#fff" }}>{unread}</div>}
          </div>
          {unread>0 && <button onClick={markAllRead} style={{ background:"none", border:"none", color:T.accent, fontSize:13, fontWeight:600, cursor:"pointer" }}>Marcar leído</button>}
        </div>
      </div>
      <div style={{ maxWidth:560, margin:"12px auto 0", padding:"0 12px", display:"flex", flexDirection:"column", gap:8 }}>
        {loading ? <Spinner/> : notifs.length===0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🔔</div>
            <div style={{ fontSize:14, color:T.textSub }}>Todo tranquilo por acá</div>
          </div>
        ) : notifs.map(n => {
          const { icon, text, accent } = getNotifContent(n);
          const actor = actors[n.actor_id];
          return (
            <div key={n.id} style={{ display:"flex", gap:12, alignItems:"center", padding:"14px 16px", background:n.read?T.surface:`${accent}10`, borderRadius:14, border:`1px solid ${n.read?T.border:accent+"33"}`, position:"relative", transition:"all 0.15s" }}>
              {!n.read && <div style={{ position:"absolute", left:6, top:"50%", transform:"translateY(-50%)", width:6, height:6, borderRadius:"50%", background:accent }}/>}
              {/* Avatar or icon */}
              {actor
                ? <Avatar src={actor.avatar_url} name={actor.display_name||actor.username} size={40}/>
                : <div style={{ width:40, height:40, borderRadius:"50%", background:`${accent}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{icon}</div>
              }
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:T.text, lineHeight:1.4 }}>{text}</div>
                <div style={{ fontSize:11, color:T.textMute, marginTop:3 }}>{timeAgo(n.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ALBUM PAGE ──────────────────────────────────────────────────────────────
function AlbumPage({ albumId, onNavigate, userId }) {
  const [album, setAlbum] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [followingIds, setFollowingIds] = useState([]);
  const [tab, setTab] = useState("canciones");
  const [loading, setLoading] = useState(true);
  const [showAddList, setShowAddList] = useState(false);
  const [albumPreview, setAlbumPreview] = useState(null);
  const [trackPreviews, setTrackPreviews] = useState({});
  const ac = accentFor(albumId);

  useEffect(() => {
    if (!albumId) return;
    const load = async () => {
      setLoading(true);
      const [{ data:albumData }, { data:reviewData }, { data:followData }] = await Promise.all([
        supabase.from("albums").select("*").eq("id",albumId).single(),
        supabase.from("feed_reviews").select("*").eq("album_id",albumId).order("like_count",{ascending:false}),
        supabase.from("follows").select("following_id").eq("follower_id",userId),
      ]);
      setAlbum(albumData);
      setReviews(reviewData||[]);
      setFollowingIds((followData||[]).map(f=>f.following_id));
      // Load previews in background
      if (albumData?.mbid) {
        resolveAlbumFull(albumData.mbid, albumData.artist, albumData.title).then(d => {
          if (d.previewUrl) setAlbumPreview(d.previewUrl);
          if (d.trackPreviews) setTrackPreviews(d.trackPreviews);
        });
      }
      setLoading(false);
    };
    load();
  }, [albumId]);

  if (loading) return <div style={{ minHeight:"100vh", background:T.bg }}><Spinner/></div>;
  if (!album) return null;

  const avgRating = reviews.length>0
    ? (reviews.reduce((s,r)=>s+Number(r.rating),0)/reviews.length).toFixed(1)
    : null;

  const friendReviews = reviews.filter(r=>followingIds.includes(r.user_id)||r.user_id===userId);
  const TABS = [
    { key:"canciones", label:"Canciones" },
    { key:"amigos",    label:`Amigos (${friendReviews.length})` },
    { key:"todas",     label:`Todas (${reviews.length})` },
  ];
  const shownReviews = tab==="amigos" ? friendReviews : reviews;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      {/* Hero */}
      <div style={{ background:`linear-gradient(160deg,${ac}33 0%,${T.bg} 100%)`, padding:"20px 20px 0", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:560, margin:"0 auto", paddingTop:16, paddingBottom:80 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
            <button onClick={()=>onNavigate("feed")} style={{ background:`${T.surface}cc`, border:`1px solid ${T.border}`, borderRadius:20, padding:"6px 14px", color:T.textSub, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15,18 9,12 15,6"/></svg>
              Volver
            </button>
            <button onClick={()=>setShowAddList(true)} style={{ background:`${T.surface}cc`, border:`1px solid ${T.border}`, borderRadius:20, padding:"6px 14px", color:T.accent, fontSize:13, cursor:"pointer", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:16 }}>+</span> Agregar a lista
            </button>
          </div>
          <div style={{ display:"flex", gap:20, alignItems:"flex-end" }}>
            <div style={{ width:120, height:120, borderRadius:14, overflow:"hidden", flexShrink:0, boxShadow:`0 8px 32px ${ac}44`, position:"relative" }}>
              {album.cover_url
                ? <img src={album.cover_url} alt={album.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.style.display="none"}/>
                : <div style={{ width:"100%", height:"100%", background:`${ac}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, color:ac }}>♪</div>
              }
            </div>
            <div style={{ paddingBottom:6, flex:1 }}>
              <div style={{ fontSize:26, fontWeight:800, color:T.text, lineHeight:1.1, marginBottom:4 }}>{album.title}</div>
              <div style={{ fontSize:15, color:T.textSub, marginBottom:8 }}>{album.artist}{album.year?` · ${album.year}`:""}</div>
              {avgRating && <div style={{ marginBottom:10 }}><RatingDisplay n={Number(avgRating)} size={15}/></div>}
              {albumPreview && (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <PlayButton previewUrl={albumPreview} size={36}/>
                  <span style={{ fontSize:12, color:T.textSub }}>Preview 30 seg</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:560, margin:"-52px auto 0", padding:"0 20px", position:"relative", zIndex:2 }}>
        {/* Stats card */}
        {avgRating && (
          <div style={{ background:T.surface, borderRadius:20, padding:"18px 22px", border:`1px solid ${T.border}`, marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:20 }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:40, fontWeight:800, color:T.text, lineHeight:1 }}>{avgRating}</div>
                <div style={{ marginTop:4 }}><Stars n={Math.round(Number(avgRating)*2)/2} size={13}/></div>
                <div style={{ fontSize:11, color:T.textMute, marginTop:3 }}>{reviews.length} reseña{reviews.length!==1?"s":""}</div>
              </div>
              <div style={{ flex:1 }}>
                {[5,4,3,2,1].map(star=>{
                  const count = reviews.filter(r=>Math.round(Number(r.rating))===star).length;
                  const pct = reviews.length>0?(count/reviews.length)*100:0;
                  return (
                    <div key={star} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                      <span style={{ fontSize:11, color:T.textMute, width:8 }}>{star}</span>
                      <div style={{ flex:1, height:5, background:T.surface2, borderRadius:3, overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${ac},${ac}88)`, borderRadius:3 }}/>
                      </div>
                      <span style={{ fontSize:11, color:T.textMute, width:12 }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:"flex", background:T.surface, borderRadius:12, padding:4, marginBottom:14, border:`1px solid ${T.border}`, gap:3 }}>
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{ flex:1, padding:"8px 6px", border:"none", borderRadius:9, cursor:"pointer", transition:"all 0.2s", background:tab===t.key?`linear-gradient(135deg,${T.accent},${T.accent2})`:"none", color:tab===t.key?"#fff":T.textSub, fontSize:12, fontWeight:tab===t.key?600:400, whiteSpace:"nowrap" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Canciones tab */}
        {tab==="canciones" && (
          <div style={{ background:T.surface, borderRadius:16, padding:"8px 16px", border:`1px solid ${T.border}`, marginBottom:40 }}>
            <Tracklist albumId={albumId} mbid={album.mbid} userId={userId} trackPreviews={trackPreviews}/>
          </div>
        )}

        {/* Reviews tabs */}
        {(tab==="amigos"||tab==="todas") && (
          <div style={{ display:"flex", flexDirection:"column", gap:10, paddingBottom:40 }}>
            {shownReviews.length===0 ? (
              <div style={{ background:T.surface, borderRadius:14, padding:"32px", textAlign:"center", border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:28, marginBottom:8 }}>👋</div>
                <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:4 }}>
                  {tab==="amigos"?"Nadie que seguís lo reseñó aún":"Sin reseñas todavía"}
                </div>
                {tab==="amigos" && reviews.length>0 && (
                  <button onClick={()=>setTab("todas")} style={{ marginTop:8, background:"none", border:`1px solid ${T.accent}`, borderRadius:20, padding:"7px 18px", color:T.accent, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    Ver todas las reseñas
                  </button>
                )}
              </div>
            ) : shownReviews.map((r,i)=>{
              const isFriend = followingIds.includes(r.user_id);
              return (
                <div key={r.id} style={{ background:T.surface, borderRadius:14, padding:"18px", border:`1px solid ${isFriend?T.accent+"44":T.border}`, position:"relative", overflow:"hidden", animation:`fadeUp 0.35s ease ${i*0.06}s both` }}>
                  {isFriend && <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${T.accent},${T.accent2})` }}/>}
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                    <Avatar src={r.avatar_url} name={r.display_name||r.username} size={34}/>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize:14, fontWeight:600, color:T.text }}>{r.display_name||r.username}</span>
                        {isFriend && <span style={{ fontSize:10, fontWeight:700, color:T.accent, background:`${T.accent}18`, borderRadius:10, padding:"2px 7px" }}>siguiendo</span>}
                      </div>
                      <span style={{ fontSize:11, color:T.textMute }}>{timeAgo(r.created_at)}</span>
                    </div>
                    <RatingDisplay n={r.rating} size={13}/>
                  </div>
                  <p style={{ fontSize:14, lineHeight:1.65, color:T.textSub, margin:"0 0 12px", fontFamily:"Georgia,serif" }}>"{r.text}"</p>
                  <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:10 }}>
                    <span style={{ fontSize:12, color:T.textMute }}>❤️ {r.like_count||0}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showAddList && album && <AddToListModal album={album} userId={userId} onClose={()=>setShowAddList(false)}/>}
    </div>
  );
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────
function ProfilePage({ onNavigate, userId, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [followStats, setFollowStats] = useState({ followers:0, following:0 });
  const [tab, setTab] = useState("reseñas");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from("profiles").select("*").eq("id",userId).single(),
      supabase.from("feed_reviews").select("*").eq("user_id",userId).order("created_at",{ascending:false}),
      supabase.from("follows").select("id",{count:"exact"}).eq("following_id",userId),
      supabase.from("follows").select("id",{count:"exact"}).eq("follower_id",userId),
    ]).then(([{data:p},{data:r},{count:followers},{count:following}])=>{
      setProfile(p);
      setReviews(r||[]);
      setFollowStats({ followers:followers||0, following:following||0 });
      setLoading(false);
    });
  }, [userId]);

  if (loading) return <div style={{ minHeight:"100vh", background:T.bg }}><Spinner/></div>;

  // Derive last 5 albums reviewed
  const lastAlbums = reviews.slice(0,5);

  // Derive top artists as "genres" (since we dont have genres yet, use artists)
  const artistCounts = {};
  reviews.forEach(r => { if(r.artist) artistCounts[r.artist] = (artistCounts[r.artist]||0)+1; });
  const topArtists = Object.entries(artistCounts).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([a])=>a);

  // Favorites = reviews with rating >= 4.5
  const favorites = reviews.filter(r => Number(r.rating) >= 4.5);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      {/* Hero gradient */}
      <div style={{ background:`linear-gradient(160deg,${T.accent}33 0%,${T.accent}11 60%,${T.bg} 100%)`, padding:"0 20px" }}>
        <div style={{ maxWidth:560, margin:"0 auto", paddingTop:48, paddingBottom:80 }}>
          {/* Top row: avatar + logout */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
            <div style={{ width:80, height:80, borderRadius:"50%", border:`3px solid ${T.accent}66`, overflow:"hidden", flexShrink:0, boxShadow:`0 0 24px ${T.accent}44` }}>
              <Avatar src={profile?.avatar_url} name={profile?.display_name||profile?.username} size={80}/>
            </div>
            <button onClick={onLogout} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:16, padding:"7px 14px", color:T.textSub, fontSize:12, fontWeight:600, cursor:"pointer" }}>Salir</button>
          </div>
          {/* Name */}
          <div style={{ fontSize:24, fontWeight:800, color:T.text, lineHeight:1.1 }}>{profile?.display_name||profile?.username}</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:3 }}>@{profile?.username}</div>
          {/* Bio */}
          {profile?.bio && <p style={{ fontSize:13, color:T.textSub, marginTop:10, fontStyle:"italic", lineHeight:1.5 }}>"{profile.bio}"</p>}
        </div>
      </div>

      {/* Stats card */}
      <div style={{ maxWidth:560, margin:"-56px auto 0", padding:"0 20px", position:"relative", zIndex:2 }}>
        <div style={{ background:T.surface, borderRadius:20, padding:"20px 22px", border:`1px solid ${T.border}`, marginBottom:12 }}>
          {/* Stats row */}
          <div style={{ display:"flex", marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${T.border}` }}>
            {[
              { label:"reseñas", val:reviews.length },
              { label:"seguidores", val:followStats.followers },
              { label:"siguiendo", val:followStats.following },
            ].map((s,i) => (
              <div key={i} style={{ flex:1, textAlign:"center", borderRight: i<2?`1px solid ${T.border}`:"none" }}>
                <div style={{ fontSize:20, fontWeight:800, color:T.text }}>{s.val}</div>
                <div style={{ fontSize:11, color:T.textMute, marginTop:1 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Top artists as tags */}
          {topArtists.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {topArtists.map(a => (
                <span key={a} style={{ fontSize:12, fontWeight:600, color:T.accent, background:`${T.accent}18`, borderRadius:20, padding:"4px 12px" }}>{a}</span>
              ))}
            </div>
          )}
        </div>

        {/* Last albums row */}
        {lastAlbums.length > 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:T.textMute, fontWeight:600, letterSpacing:0.5, marginBottom:10 }}>ÚLTIMOS DISCOS</div>
            <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4 }}>
              {lastAlbums.map(r => {
                const ac = accentFor(r.album_id);
                return (
                  <div key={r.id} onClick={()=>onNavigate("album",r.album_id)} style={{ flexShrink:0, cursor:"pointer" }}>
                    <div style={{ width:72, height:72, borderRadius:10, overflow:"hidden", background:`${ac}22`, boxShadow:`0 4px 12px ${ac}33`, marginBottom:5 }}>
                      {r.cover_url
                        ? <img src={r.cover_url} alt={r.album_title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.style.display="none"}/>
                        : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, color:ac }}>♪</div>
                      }
                    </div>
                    <Stars n={Number(r.rating)} size={10}/>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:"flex", background:T.surface, borderRadius:12, padding:4, marginBottom:14, border:`1px solid ${T.border}`, gap:3 }}>
          {[
            { key:"reseñas", label:`Reseñas (${reviews.length})` },
            { key:"favoritos", label:`Favoritos (${favorites.length})` },
          ].map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{ flex:1, padding:"8px", border:"none", borderRadius:9, cursor:"pointer", background:tab===t.key?`linear-gradient(135deg,${T.accent},${T.accent2})`:"none", color:tab===t.key?"#fff":T.textSub, fontSize:13, fontWeight:tab===t.key?600:400 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom:40 }}>
          {tab==="reseñas" && (
            reviews.length===0
              ? <div style={{ textAlign:"center", padding:"40px 0", color:T.textMute }}><div style={{ fontSize:28, marginBottom:8 }}>📝</div><div>Todavía no reseñaste nada</div></div>
              : reviews.map((r,i)=><ReviewCard key={r.id} r={r} i={i} onNavigate={onNavigate}/>)
          )}
          {tab==="favoritos" && (
            favorites.length===0
              ? <div style={{ textAlign:"center", padding:"40px 0", color:T.textMute }}><div style={{ fontSize:28, marginBottom:8 }}>⭐</div><div>Todavía no tenés favoritos</div><div style={{ fontSize:12, color:T.textMute, marginTop:4 }}>Los álbumes con 4.5★ o más aparecen acá</div></div>
              : favorites.map((r,i)=><ReviewCard key={r.id} r={r} i={i} onNavigate={onNavigate}/>)
          )}
        </div>
      </div>
    </div>
  );
}


// ─── LISTS ────────────────────────────────────────────────────────────────────

function CreateListModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from("lists")
      .insert({ name: name.trim(), description: description.trim() })
      .select("id").single();
    if (!error && data) { onCreated(data.id); onClose(); }
    else { alert("Error: " + error?.message); }
    setSaving(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, backdropFilter:"blur(8px)", padding:20 }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.surface, borderRadius:20, width:"100%", maxWidth:420, border:`1px solid ${T.border}`, padding:"24px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontSize:17, fontWeight:700, color:T.text }}>Nueva lista</div>
          <button onClick={onClose} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:15, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <input placeholder="Nombre de la lista *" value={name} onChange={e=>setName(e.target.value)} autoFocus
            style={{ width:"100%", padding:"12px 14px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"inherit" }}
            onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          <textarea placeholder="Descripción (opcional)" value={description} onChange={e=>setDescription(e.target.value)} rows={3}
            style={{ width:"100%", padding:"12px 14px", background:T.surface2, border:`1.5px solid ${T.border}`, borderRadius:12, fontSize:14, color:T.text, outline:"none", fontFamily:"inherit", resize:"none" }}
            onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={onClose} style={{ flex:1, padding:"11px", background:"none", border:`1px solid ${T.border}`, borderRadius:12, color:T.textSub, fontSize:14, cursor:"pointer" }}>Cancelar</button>
            <button onClick={handleCreate} disabled={!name.trim()||saving}
              style={{ flex:2, padding:"11px", background:name.trim()?`linear-gradient(135deg,${T.accent},${T.accent2})`:"#2a2f45", border:"none", borderRadius:12, color:name.trim()?"#fff":T.textMute, fontSize:14, fontWeight:600, cursor:name.trim()?"pointer":"default" }}>
              {saving?"Creando...":"Crear lista"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddToListModal({ album, userId, onClose }) {
  const [lists, setLists] = useState([]);
  const [inLists, setInLists] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadLists = async () => {
    const [{ data:myLists }, { data:listAlbums }] = await Promise.all([
      supabase.from("lists").select("*").eq("user_id", userId).order("created_at", {ascending:false}),
      supabase.from("list_albums").select("list_id").eq("album_id", album.id),
    ]);
    setLists(myLists||[]);
    setInLists(new Set((listAlbums||[]).map(la=>la.list_id)));
    setLoading(false);
  };

  useEffect(() => { loadLists(); }, []);

  const toggle = async (listId) => {
    if (inLists.has(listId)) {
      await supabase.from("list_albums").delete().eq("list_id", listId).eq("album_id", album.id);
      setInLists(prev => { const s=new Set(prev); s.delete(listId); return s; });
    } else {
      const pos = lists.find(l=>l.id===listId)?.album_count || 0;
      await supabase.from("list_albums").insert({ list_id:listId, album_id:album.id, position:pos });
      setInLists(prev => new Set([...prev, listId]));
    }
  };

  return (
    <>
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:250, backdropFilter:"blur(8px)" }}
        onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
        <div style={{ background:T.surface, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:560, border:`1px solid ${T.border}`, borderBottom:"none", maxHeight:"70vh", display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", justifyContent:"center", padding:"12px 0" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:T.border }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 20px 14px" }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:T.text }}>Agregar a lista</div>
              <div style={{ fontSize:12, color:T.textSub, marginTop:2 }}>{album.title}</div>
            </div>
            <button onClick={onClose} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:15, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"0 20px 20px" }}>
            {loading ? <Spinner/> : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button onClick={()=>setShowCreate(true)}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"none", border:`1.5px dashed ${T.accent}55`, borderRadius:12, cursor:"pointer", color:T.accent, fontSize:13, fontWeight:600 }}>
                  <span style={{ fontSize:20, lineHeight:1 }}>+</span> Crear nueva lista
                </button>
                {lists.length===0 && (
                  <div style={{ textAlign:"center", padding:"20px 0", color:T.textMute, fontSize:13 }}>Todavía no tenés listas</div>
                )}
                {lists.map(list => {
                  const added = inLists.has(list.id);
                  return (
                    <button key={list.id} onClick={()=>toggle(list.id)}
                      style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:added?`${T.accent}12`:T.surface2, border:`1.5px solid ${added?T.accent:T.border}`, borderRadius:12, cursor:"pointer", transition:"all 0.15s", textAlign:"left" }}>
                      <div style={{ width:36, height:36, borderRadius:8, background:`linear-gradient(135deg,${T.accent}44,${T.accent2}44)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>📋</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:added?T.accent:T.text }}>{list.name}</div>
                        {list.description && <div style={{ fontSize:11, color:T.textMute, marginTop:1 }}>{list.description}</div>}
                      </div>
                      {added && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {showCreate && <CreateListModal onClose={()=>setShowCreate(false)} onCreated={async(id)=>{ await loadLists(); }}/>}
    </>
  );
}

function ListDetailPage({ listId, onNavigate }) {
  const [list, setList] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!listId) return;
    Promise.all([
      supabase.from("lists").select("*, profiles(username,display_name)").eq("id", listId).single(),
      supabase.from("list_albums").select("*, albums(*)").eq("list_id", listId).order("position"),
    ]).then(([{data:l},{data:la}]) => {
      setList(l);
      setAlbums((la||[]).map(la=>la.albums).filter(Boolean));
      setLoading(false);
    });
  }, [listId]);

  if (loading) return <div style={{ minHeight:"100vh", background:T.bg }}><Spinner/></div>;
  if (!list) return null;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(160deg,${T.accent}22 0%,${T.bg} 100%)`, padding:"20px 20px 0", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:560, margin:"0 auto", paddingTop:16, paddingBottom:60 }}>
          <button onClick={()=>onNavigate("lists")} style={{ background:`${T.surface}cc`, border:`1px solid ${T.border}`, borderRadius:20, padding:"6px 14px", color:T.textSub, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6, marginBottom:20 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15,18 9,12 15,6"/></svg>
            Volver
          </button>
          <div style={{ fontSize:28, fontWeight:800, color:T.text, lineHeight:1.1, marginBottom:6 }}>{list.name}</div>
          {list.description && <div style={{ fontSize:14, color:T.textSub, marginBottom:8 }}>{list.description}</div>}
          <div style={{ fontSize:12, color:T.textMute }}>por @{list.profiles?.username} · {albums.length} álbum{albums.length!==1?"es":""}</div>
        </div>
      </div>
      <div style={{ maxWidth:560, margin:"-44px auto 0", padding:"0 20px", position:"relative", zIndex:2 }}>
        {/* Cover mosaic */}
        {albums.length > 0 && (
          <div style={{ display:"flex", gap:3, marginBottom:16, borderRadius:16, overflow:"hidden", height:80 }}>
            {albums.slice(0,4).map((a,i) => {
              const ac = accentFor(a.id);
              return (
                <div key={a.id} style={{ flex:1, background:`${ac}22`, overflow:"hidden" }}>
                  {a.cover_url
                    ? <img src={a.cover_url} alt={a.title} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                    : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:ac }}>♪</div>
                  }
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:10, paddingBottom:40 }}>
          {albums.length===0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.textMute }}>
              <div style={{ fontSize:28, marginBottom:8 }}>📋</div>
              <div>Esta lista está vacía</div>
            </div>
          ) : albums.map((a, i) => {
            const ac = accentFor(a.id);
            return (
              <div key={a.id} onClick={()=>onNavigate("album",a.id)}
                style={{ background:T.surface, borderRadius:14, padding:"12px 14px", display:"flex", gap:12, alignItems:"center", cursor:"pointer", border:`1px solid ${T.border}`, animation:`fadeUp 0.3s ease ${i*0.05}s both`, transition:"border-color 0.15s" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor=T.textMute}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                <div style={{ fontSize:16, fontWeight:700, color:T.textMute, width:28, flexShrink:0, textAlign:"center" }}>{i+1}</div>
                <AlbumCover src={a.cover_url} ac={ac} size={52}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.title}</div>
                  <div style={{ fontSize:12, color:T.textSub }}>{a.artist}{a.year?` · ${a.year}`:""}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListsPage({ userId, onNavigate }) {
  const [myLists, setMyLists] = useState([]);
  const [autoLists, setAutoLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [{ data:userLists }, { data:topWeek }, { data:topAll }] = await Promise.all([
      supabase.from("lists").select("*, list_albums(count)").eq("user_id", userId).order("created_at",{ascending:false}),
      // Most reviewed this week
      supabase.from("feed_reviews").select("album_id, album_title, artist, year, cover_url")
        .gte("created_at", new Date(Date.now()-7*24*60*60*1000).toISOString())
        .limit(50),
      // Best rated albums (avg rating)
      supabase.from("feed_reviews").select("album_id, album_title, artist, year, cover_url, rating").limit(100),
    ]);

    // Build auto lists
    const auto = [];

    // Most reviewed this week
    if (topWeek && topWeek.length > 0) {
      const counts = {};
      const meta = {};
      topWeek.forEach(r => {
        counts[r.album_id] = (counts[r.album_id]||0) + 1;
        meta[r.album_id] = r;
      });
      const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id])=>meta[id]);
      if (sorted.length > 0) auto.push({ id:"auto_week", name:"🔥 Más reseñados esta semana", description:"Los álbumes con más actividad en los últimos 7 días", albums:sorted, auto:true });
    }

    // Best rated
    if (topAll && topAll.length > 0) {
      const ratings = {};
      const counts2 = {};
      const meta2 = {};
      topAll.forEach(r => {
        ratings[r.album_id] = (ratings[r.album_id]||0) + Number(r.rating);
        counts2[r.album_id] = (counts2[r.album_id]||0) + 1;
        meta2[r.album_id] = r;
      });
      const sorted2 = Object.entries(ratings)
        .filter(([id]) => counts2[id] >= 1)
        .map(([id, sum]) => ({ id, avg: sum/counts2[id], meta: meta2[id] }))
        .sort((a,b)=>b.avg-a.avg)
        .slice(0,10)
        .map(x => x.meta);
      if (sorted2.length > 0) auto.push({ id:"auto_best", name:"⭐ Mejor puntuados", description:"Los álbumes con el promedio más alto", albums:sorted2, auto:true });
    }

    setAutoLists(auto);
    setMyLists(userLists||[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [userId]);

  const AutoListCard = ({ list }) => (
    <div onClick={()=>onNavigate("autolist", list)}
      style={{ background:T.surface, borderRadius:16, padding:"16px", border:`1px solid ${T.border}`, cursor:"pointer", transition:"border-color 0.15s", marginBottom:10 }}
      onMouseEnter={e=>e.currentTarget.style.borderColor=T.textMute}
      onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
      <div style={{ display:"flex", gap:3, borderRadius:10, overflow:"hidden", height:64, marginBottom:12 }}>
        {list.albums.slice(0,4).map((a,i) => {
          const ac = accentFor(a.album_id||a.id);
          return (
            <div key={i} style={{ flex:1, background:`${ac}22`, overflow:"hidden" }}>
              {a.cover_url
                ? <img src={a.cover_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:ac }}>♪</div>
              }
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:15, fontWeight:700, color:T.text, marginBottom:3 }}>{list.name}</div>
      <div style={{ fontSize:12, color:T.textSub }}>{list.description}</div>
      <div style={{ fontSize:11, color:T.textMute, marginTop:6 }}>{list.albums.length} álbumes</div>
    </div>
  );

  const UserListCard = ({ list }) => {
    const count = list.list_albums?.[0]?.count || 0;
    return (
      <div onClick={()=>onNavigate("list", list.id)}
        style={{ background:T.surface, borderRadius:16, padding:"16px", border:`1px solid ${T.border}`, cursor:"pointer", transition:"border-color 0.15s", marginBottom:10, display:"flex", gap:14, alignItems:"center" }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.accent}
        onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
        <div style={{ width:52, height:52, borderRadius:10, background:`linear-gradient(135deg,${T.accent}44,${T.accent2}44)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>📋</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.text }}>{list.name}</div>
          {list.description && <div style={{ fontSize:12, color:T.textSub, marginTop:1 }}>{list.description}</div>}
          <div style={{ fontSize:11, color:T.textMute, marginTop:3 }}>{count} álbum{count!==1?"es":""}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2"><polyline points="9,18 15,12 9,6"/></svg>
      </div>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      <div style={{ background:`${T.bg}ee`, backdropFilter:"blur(16px)", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, zIndex:50 }}>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:20, fontWeight:800, color:T.text }}>Listas</div>
          <button onClick={()=>setShowCreate(true)} style={{ background:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:20, padding:"7px 16px", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ fontSize:16 }}>+</span> Nueva lista
          </button>
        </div>
      </div>

      <div style={{ maxWidth:560, margin:"0 auto", padding:"20px 20px 0" }}>
        {loading ? <Spinner/> : (
          <>
            {/* Auto lists */}
            {autoLists.length > 0 && (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, color:T.textMute, fontWeight:600, letterSpacing:0.5, marginBottom:12 }}>LISTAS AUTOMÁTICAS</div>
                {autoLists.map(l => <AutoListCard key={l.id} list={l}/>)}
              </div>
            )}
            {/* My lists */}
            <div>
              <div style={{ fontSize:11, color:T.textMute, fontWeight:600, letterSpacing:0.5, marginBottom:12 }}>MIS LISTAS</div>
              {myLists.length===0 ? (
                <div style={{ textAlign:"center", padding:"32px 20px", background:T.surface, borderRadius:16, border:`1.5px dashed ${T.border}` }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
                  <div style={{ fontSize:14, color:T.textSub, fontWeight:600, marginBottom:4 }}>Todavía no tenés listas</div>
                  <div style={{ fontSize:13, color:T.textMute, marginBottom:16 }}>Organizá tus álbumes favoritos, armá rankings o colecciones temáticas</div>
                  <button onClick={()=>setShowCreate(true)} style={{ background:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:20, padding:"9px 22px", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    Crear primera lista
                  </button>
                </div>
              ) : myLists.map(l => <UserListCard key={l.id} list={l}/>)}
            </div>
          </>
        )}
      </div>
      {showCreate && <CreateListModal onClose={()=>setShowCreate(false)} onCreated={async()=>{ await loadAll(); }}/>}
    </div>
  );
}

// AutoList page (for generated lists)
function AutoListPage({ list, onNavigate }) {
  const albums = list.albums || [];
  return (
    <div style={{ minHeight:"100vh", background:T.bg, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(160deg,${T.accent}22 0%,${T.bg} 100%)`, padding:"20px 20px 0", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:560, margin:"0 auto", paddingTop:16, paddingBottom:60 }}>
          <button onClick={()=>onNavigate("lists")} style={{ background:`${T.surface}cc`, border:`1px solid ${T.border}`, borderRadius:20, padding:"6px 14px", color:T.textSub, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6, marginBottom:20 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15,18 9,12 15,6"/></svg>
            Volver
          </button>
          <div style={{ fontSize:28, fontWeight:800, color:T.text, lineHeight:1.1, marginBottom:6 }}>{list.name}</div>
          <div style={{ fontSize:14, color:T.textSub }}>{list.description}</div>
          <div style={{ fontSize:12, color:T.textMute, marginTop:6 }}>{albums.length} álbumes</div>
        </div>
      </div>
      <div style={{ maxWidth:560, margin:"-44px auto 0", padding:"0 20px", position:"relative", zIndex:2 }}>
        {albums.length > 0 && (
          <div style={{ display:"flex", gap:3, marginBottom:16, borderRadius:16, overflow:"hidden", height:80 }}>
            {albums.slice(0,4).map((a,i) => {
              const ac = accentFor(a.album_id||a.id);
              return (
                <div key={i} style={{ flex:1, background:`${ac}22`, overflow:"hidden" }}>
                  {a.cover_url ? <img src={a.cover_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:ac }}>♪</div>}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:10, paddingBottom:40 }}>
          {albums.map((a, i) => {
            const ac = accentFor(a.album_id||a.id);
            return (
              <div key={i} onClick={()=>onNavigate("album", a.album_id||a.id)}
                style={{ background:T.surface, borderRadius:14, padding:"12px 14px", display:"flex", gap:12, alignItems:"center", cursor:"pointer", border:`1px solid ${T.border}`, animation:`fadeUp 0.3s ease ${i*0.05}s both`, transition:"border-color 0.15s" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor=T.textMute}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                <div style={{ fontSize:16, fontWeight:700, color:T.textMute, width:28, flexShrink:0, textAlign:"center" }}>{i+1}</div>
                <AlbumCover src={a.cover_url} ac={ac} size={52}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.album_title||a.title}</div>
                  <div style={{ fontSize:12, color:T.textSub }}>{a.artist}{a.year?` · ${a.year}`:""}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function Spinrate() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState({ name:"feed", data:null });
  const [modal, setModal] = useState(false);
  const [feedKey, setFeedKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}})=>{ setSession(session); setUser(session?.user||null); setLoading(false); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_e,session)=>{ setSession(session); setUser(session?.user||null); });
    return ()=>subscription.unsubscribe();
  }, []);

  const handleAuth = (session, user) => { setSession(session); setUser(user); };
  const handleLogout = async () => { await supabase.auth.signOut(); setSession(null); setUser(null); setPage({name:"feed",data:null}); };
  const navigate = (name, data=null) => setPage({name, data});

  if (loading) return <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center" }}><Spinner/></div>;
  if (!session) return <AuthPage onAuth={handleAuth}/>;

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${T.bg};}
        input::placeholder,textarea::placeholder{color:${T.textMute};}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:4px}
      `}</style>

      {page.name==="feed"     && <FeedPage onNavigate={navigate} onWrite={()=>setModal(true)} refreshKey={feedKey}/>}
      {page.name==="search"   && <SearchPage onNavigate={navigate} userId={user?.id}/>}
      {page.name==="lists"    && <ListsPage userId={user?.id} onNavigate={navigate}/>}
      {page.name==="notifs"   && <NotifsPage userId={user?.id} onNavigate={navigate}/>}
      {page.name==="profile"  && <ProfilePage onNavigate={navigate} userId={user?.id} onLogout={handleLogout}/>}
      {page.name==="album"    && <AlbumPage albumId={page.data} onNavigate={navigate} userId={user?.id}/>}
      {page.name==="list"     && <ListDetailPage listId={page.data} onNavigate={navigate}/>}
      {page.name==="autolist" && <AutoListPage list={page.data} onNavigate={navigate}/>}

      {!["album","list","autolist"].includes(page.name) && <BottomNav current={page.name} onNavigate={navigate}/>}
      {modal && <WriteModal onClose={()=>setModal(false)} onAdd={()=>{ setModal(false); navigate("feed"); setFeedKey(k=>k+1); }}/>}
    </>
  );
}
