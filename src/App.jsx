import { useState, useReducer, useRef, useEffect } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

const DEFAULT_PASSWORD = "padel2024";
const SUPER_PASSWORD = "Golfi2026+";
const INIT = { clubName: "Club Pádel", currentSeason: 1, seasons: { 1: { players: [], matches: [] } } };

function storeReducer(state, action) {
  if (action.type === "SET_CLUB_NAME") return { ...state, clubName: action.payload };
  if (action.type === "SET_CURRENT_SEASON") return { ...state, currentSeason: action.payload };
  if (action.type === "SET_SEASON_DATA") {
    const s = action.season != null ? action.season : state.currentSeason;
    return { ...state, seasons: { ...state.seasons, [s]: action.payload } };
  }
  if (action.type === "SET_STORE") {
    return typeof action.payload === "function" ? action.payload(state) : action.payload;
  }
  return state;
}

function fmtDate(d) {
  if (!d) return "";
  const s = String(d);
  if (s.includes("-")) { const p = s.split("-"); if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`; }
  return s;
}

function makePairs(playerObjects) {
  const sorted = [...playerObjects].sort((a, b) => (b.level || 1) - (a.level || 1));
  return [[sorted[0], sorted[3]], [sorted[1], sorted[2]]];
}

function validateSet(a, b, i) {
  if (a === "" || b === "") return null;
  const na = Number(a), nb = Number(b);
  if (na === nb) return "Empate no permitido";
  const hi = Math.max(na, nb), lo = Math.min(na, nb);
  if (i < 2) {
    if (hi < 6) return `Set ${i + 1}: ganador debe llegar al menos a 6`;
    if (lo < 5 && hi !== 6) return `Set ${i + 1}: si perdedor<5, ganador debe tener 6`;
    if (lo === 5 && hi !== 7) return `Set ${i + 1}: con 5 juegos, ganador debe tener 7`;
    if (lo >= 6 && hi !== lo + 2) return `Set ${i + 1}: desde 6-6 diferencia de 2`;
    return null;
  }
  if (i === 2) { if (hi >= 10 && hi - lo >= 2) return null; return "3er set: hasta 10 con diferencia de 2"; }
  return null;
}

function getSetErrors(sets) {
  return sets.map((s, i) => s.a !== "" && s.b !== "" ? validateSet(s.a, s.b, i) : null).filter(Boolean);
}

// ── UI COMPONENTS ─────────────────────────────────────────────────────────────
function Badge({ children, color }) {
  color = color || "blue";
  const c = {
    blue: "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30",
    green: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
    red: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
    yellow: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
    gray: "bg-white/10 text-gray-300 ring-1 ring-white/20",
    purple: "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30",
    orange: "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30",
  };
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${c[color] || c.blue}`}>{children}</span>;
}

function Confirm({ msg, onYes, onNo }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-red-400 font-medium">{msg}</span>
      <button onClick={onYes} className="bg-red-500 text-white text-xs px-3 py-1 rounded-lg hover:bg-red-600 transition">Sí</button>
      <button onClick={onNo} className="bg-white/10 text-xs px-3 py-1 rounded-lg hover:bg-white/20 transition text-gray-200">No</button>
    </div>
  );
}

function Card({ children, className }) {
  className = className || "";
  return <div className={`bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 shadow-xl ${className}`}>{children}</div>;
}

function Input(props) {
  const { className, ...rest } = props;
  return <input className={`bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition ${className || ""}`} {...rest} />;
}

function Sel({ className, children, ...rest }) {
  return (
    <select className={`bg-gray-800 border border-white/20 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition ${className || ""}`} {...rest}>
      {children}
    </select>
  );
}

function Btn({ children, variant, className, disabled, ...rest }) {
  variant = variant || "primary";
  const base = "px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed";
  const v = {
    primary: "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20",
    secondary: "bg-white/10 hover:bg-white/20 text-white border border-white/20",
    danger: "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30",
    ghost: "text-gray-400 hover:text-white hover:bg-white/10",
  };
  return <button className={`${base} ${v[variant] || v.primary} ${className || ""}`} disabled={disabled} {...rest}>{children}</button>;
}

// ── RESULT FORM ───────────────────────────────────────────────────────────────
function ResultForm({ match, players, onSave, onCancel, existingResult, pairAInit, pairBInit }) {
  const getP = id => players.find(p => p.id === id);
  const initSets = existingResult ? existingResult.sets.map(s => ({ a: s.a, b: s.b })) : [{ a: "", b: "" }, { a: "", b: "" }, { a: "", b: "" }];
  const [sets, setSets] = useState(initSets);
  const [pairA, setPairA] = useState(existingResult ? existingResult.pairA : (pairAInit || match.signedUp.slice(0, 2)));
  const [pairB, setPairB] = useState(existingResult ? existingResult.pairB : (pairBInit || match.signedUp.slice(2, 4)));
  const errors = getSetErrors(sets);

  const submit = () => {
    if (errors.length || sets[0].a === "" || sets[1].a === "") return;
    const wA = sets.filter(s => s.a !== "" && s.b !== "" && Number(s.a) > Number(s.b)).length;
    const wB = sets.filter(s => s.a !== "" && s.b !== "" && Number(s.b) > Number(s.a)).length;
    const winner = wA >= 2 ? "A" : wB >= 2 ? "B" : wA > wB ? "A" : "B";
    const bonus = winner === "A"
      ? (Number(sets[0].a) > Number(sets[0].b) && Number(sets[1].a) > Number(sets[1].b))
      : (Number(sets[0].b) > Number(sets[0].a) && Number(sets[1].b) > Number(sets[1].a));
    onSave({ sets: sets.map(s => ({ a: Number(s.a) || 0, b: Number(s.b) || 0 })), pairA, pairB, winner, bonus });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {["A", "B"].map(side => (
          <div key={side}>
            <label className="text-xs text-gray-400 block mb-1.5 font-medium">Pareja {side}</label>
            <div className="flex gap-2">
              {[0, 1].map(i => {
                const pair = side === "A" ? pairA : pairB;
                const otherPair = side === "A" ? pairB : pairA;
                const setPair = side === "A" ? setPairA : setPairB;
                const taken = [...otherPair, ...pair.filter((_, j) => j !== i)].filter(Boolean);
                return (
                  <Sel key={i} value={pair[i] || ""} onChange={e => { const p = [...pair]; p[i] = e.target.value; setPair(p); }} className="flex-1 text-xs">
                    <option value="">—</option>
                    {match.signedUp.map(id => <option key={id} value={id} disabled={taken.includes(id)}>{getP(id) && getP(id).name}</option>)}
                  </Sel>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {sets.map((s, i) => {
          const err = validateSet(s.a, s.b, i);
          const showErr = err && (s.a !== "" || s.b !== "");
          return (
            <div key={i}>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-16 font-medium">{i === 2 ? "3er set" : `Set ${i + 1}`}</span>
                <Input type="number" min={0} max={99} value={s.a} onChange={e => setSets(p => p.map((x, j) => j === i ? { ...x, a: e.target.value === "" ? "" : +e.target.value } : x))} className={`w-14 text-center ${showErr ? "border-red-500/50" : ""}`} />
                <span className="text-gray-500 font-bold">–</span>
                <Input type="number" min={0} max={99} value={s.b} onChange={e => setSets(p => p.map((x, j) => j === i ? { ...x, b: e.target.value === "" ? "" : +e.target.value } : x))} className={`w-14 text-center ${showErr ? "border-red-500/50" : ""}`} />
              </div>
              {showErr && <p className="text-xs text-red-400 mt-1 ml-20">⚠️ {err}</p>}
            </div>
          );
        })}
      </div>
      {errors.length > 0 && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">{errors.map((e, i) => <p key={i} className="text-xs text-red-400">⚠️ {e}</p>)}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={errors.length > 0}>Guardar resultado</Btn>
        {onCancel && <Btn variant="secondary" onClick={onCancel}>Cancelar</Btn>}
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [store, dispatch] = useReducer(storeReducer, INIT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ref = doc(db, "app", "store");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        dispatch({ type: "SET_STORE", payload: snap.data() });
      }
      setLoaded(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const ref = doc(db, "app", "store");
    setDoc(ref, store);
  }, [store, loaded]);
  const [tab, setTab] = useState(0);
  const [adminAuth, setAdminAuth] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);

  const season = store.currentSeason;
  const data = store.seasons[season] || { players: [], matches: [] };

  const setData = fn => {
    const cur = store.seasons[store.currentSeason] || { players: [], matches: [] };
    const next = typeof fn === "function" ? fn(cur) : fn;
    dispatch({ type: "SET_SEASON_DATA", payload: next });
  };

  const tabs = [
    { label: "Partidos", icon: "🎾" },
    { label: "Jugadores", icon: "👥" },
    { label: "Resultados", icon: "📊" },
    { label: "Premios", icon: "🏅" },
    { label: "Admin", icon: "⚙️" },
  ];

  const login = () => {
    if (pw === DEFAULT_PASSWORD || pw === SUPER_PASSWORD) { setAdminAuth(true); setPwErr(false); }
    else setPwErr(true);
  };

  return (
    <div style={{ minHeight:"100vh", color:"white", background:"linear-gradient(135deg, #0f172a 0%, #1a2744 40%, #0f2a1a 100%)", width:"100%" }}>
      <header style={{ position:"sticky", top:0, zIndex:40, borderBottom:"1px solid rgba(255,255,255,0.1)", backdropFilter:"blur(12px)", background:"rgba(15,23,42,0.8)", width:"100%" }}>
        <div style={{ width:"100%", padding:"16px 16px 0 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:40, height:40, borderRadius:12, background:"rgba(16,185,129,0.2)", border:"1px solid rgba(16,185,129,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🎾</div>
            <div>
              <h1 style={{ fontSize:16, fontWeight:900, color:"white", margin:0 }}>{store.clubName || "Club Pádel"}</h1>
              <p style={{ fontSize:12, color:"#34d399", margin:0 }}>Temporada {season}</p>
            </div>
          </div>
        </div>
        <div style={{ width:"100%", padding:"12px 16px 0 16px", display:"flex", gap:4, overflowX:"auto" }}>
          {tabs.map((t, i) => (
            <button key={i} onClick={() => setTab(i)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all duration-200 whitespace-nowrap ${tab === i ? "bg-white/10 text-white border-t border-x border-white/20" : "text-gray-400 hover:text-gray-200"}`}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </header>
      <main style={{ width:"100%", padding:"24px 16px" }}>
        {tab === 0 && <TabPartidos data={data} setData={setData} />}
        {tab === 1 && <TabJugadores data={data} />}
        {tab === 2 && <TabResultados data={data} />}
        {tab === 3 && <TabPremios data={data} store={store} dispatch={dispatch} adminAuth={adminAuth} />}
        {tab === 4 && (adminAuth
          ? <TabAdmin store={store} dispatch={dispatch} data={data} setData={setData} onLogout={() => setAdminAuth(false)} />
          : <div className="flex justify-center pt-16">
              <Card className="p-8 w-full max-w-sm">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-3xl mx-auto mb-3">🔐</div>
                  <h2 className="text-xl font-bold">Administración</h2>
                  <p className="text-gray-400 text-sm mt-1">Introduce la contraseña para continuar</p>
                </div>
                <Input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Contraseña" className={`w-full mb-3 ${pwErr ? "border-red-500/50" : ""}`} />
                {pwErr && <p className="text-red-400 text-xs mb-3">Contraseña incorrecta</p>}
                <Btn onClick={login} className="w-full justify-center">Entrar</Btn>
              </Card>
            </div>
        )}
      </main>
    </div>
  );
}

// ── WHATSAPP SHARE ────────────────────────────────────────────────────────────
function WhatsAppShare({ match, players }) {
  const [copied, setCopied] = useState(false);
  const getP = id => players.find(p => p.id === id);

  const copyText = () => {
    const signed = match.signedUp.map(id => getP(id)).filter(Boolean);
    const lines = ["1️⃣","2️⃣","3️⃣","4️⃣"].map((e, i) => `${e} ${signed[i] ? signed[i].name : "___________"}`);
    const msg = `🎾 *PARTIDO DE PÁDEL* 🎾\n\n📅 *Fecha:* ${fmtDate(match.date)}\n⏰ *Hora:* ${match.time}\n📍 *Lugar:* ${match.location}\n\n👥 *Jugadores:*\n${lines.join("\n")}\n\nApúntate aquí 👇\nhttps://padel-club-lilac.vercel.app/`;
    const el = document.createElement("textarea");
    el.value = msg; el.style.position = "absolute"; el.style.left = "-9999px";
    document.body.appendChild(el); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="border-t border-white/10 pt-3 mt-1">
      <button onClick={copyText}
        className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-bold text-sm text-white transition-all active:scale-95"
        style={{background: copied ? "#128C7E" : "#25D366", boxShadow:"0 4px 12px rgba(37,211,102,0.25)"}}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.17 1.535 5.943L0 24l6.27-1.507A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.368l-.36-.214-3.724.894.944-3.617-.235-.373A9.818 9.818 0 1112 21.818z"/></svg>
        {copied ? "✅ ¡Copiado! Pégalo en WhatsApp" : "Copiar mensaje de WhatsApp"}
      </button>
    </div>
  );
}


// ── TAB PARTIDOS ──────────────────────────────────────────────────────────────
function TabPartidos({ data, setData }) {
  const open = data.matches.filter(m => m.status !== "completed");
  const getP = id => data.players.find(p => p.id === id);
  const fixedIds = data.players.filter(p => p.fixed).map(p => p.id);
  const clubName = data.clubName;

  const join = (mid, pid) => setData(prev => ({
    ...prev, matches: prev.matches.map(m => {
      if (m.id !== mid || m.signedUp.includes(pid) || m.signedUp.length >= 4) return m;
      const ns = [...m.signedUp, pid];
      const pairs = ns.length === 4 ? makePairs(ns.map(id => prev.players.find(p => p.id === id)).filter(Boolean)) : [];
      return { ...m, signedUp: ns, pairs };
    })
  }));

  const leave = (mid, pid) => setData(prev => ({
    ...prev, matches: prev.matches.map(m => m.id !== mid ? m : { ...m, signedUp: m.signedUp.filter(id => id !== pid), pairs: [] })
  }));

  if (!open.length) return (
    <div className="text-center py-24">
      <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-4xl mx-auto mb-4">🎾</div>
      <p className="text-xl font-bold text-white mb-1">No hay partidos abiertos</p>
      <p className="text-gray-400 text-sm">El administrador convocará los próximos partidos</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-black text-white">Partidos Abiertos</h2>
      {open.map(m => {
        const avail = data.players.filter(p => !m.signedUp.includes(p.id) && !fixedIds.includes(p.id));
        const spots = 4 - m.signedUp.length;
        const full = m.signedUp.length === 4;
        return (
          <Card key={m.id} className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="font-black text-lg text-white">{fmtDate(m.date)}</p>
                <p className="text-emerald-400 font-semibold text-sm">⏰ {m.time} &nbsp;·&nbsp; 📍 {m.location}</p>
              </div>
              {full ? <Badge color="gray">Cerrado</Badge> : <Badge color="yellow">Abierto</Badge>}
            </div>
            <div className="mb-4">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Jugadores ({m.signedUp.length}/4)</p>
              <div className="flex flex-wrap gap-2">
                {m.signedUp.length === 0 && <p className="text-xs text-gray-500 italic">Ninguno aún</p>}
                {m.signedUp.map(id => {
                  const p = getP(id);
                  return p ? (
                    <span key={id} className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-sm">
                      {p.fixed && <span>⭐</span>}{p.name}
                      {!p.fixed && <button onClick={() => leave(m.id, id)} className="text-red-400 hover:text-red-300 font-bold ml-0.5">×</button>}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
            {full && Array.isArray(m.pairs) && m.pairs.length === 2 && (
              <div className="border-t border-white/10 pt-4 mb-4">
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">⚔️ Parejas (niveladas)</p>
                <div className="grid grid-cols-2 gap-3">
                  {m.pairs.map((pair, pi) => (
                    <div key={pi} className={`rounded-xl p-3 text-center border ${pi === 0 ? "bg-blue-500/10 border-blue-500/30" : "bg-orange-500/10 border-orange-500/30"}`}>
                      <p className={`text-xs font-bold mb-2 ${pi === 0 ? "text-blue-400" : "text-orange-400"}`}>Pareja {pi === 0 ? "A" : "B"}</p>
                      {pair.map(p => <p key={p.id} className="text-sm font-semibold text-white">{p.name} <span className="text-xs text-gray-400">Nv.{Number(p.level).toFixed(2)}</span></p>)}
                      <p className="text-xs text-gray-500 mt-1">Σ {pair.reduce((s, p) => s + (p.level || 1), 0).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Botón WhatsApp */}
            <div className="border-t border-white/10 pt-4 mt-2">
              <WhatsAppShare match={m} players={data.players} />
            </div>

            {!full && (
              <div className="border-t border-white/10 pt-4 mt-2">
                <p className="text-xs text-gray-400 mb-2">Quedan <span className="text-emerald-400 font-bold">{spots}</span> plaza{spots !== 1 ? "s" : ""} libres</p>
                {avail.length === 0
                  ? <p className="text-xs text-gray-500 italic">Todos los jugadores ya están apuntados</p>
                  : <Sel defaultValue="" onChange={e => { if (e.target.value) { join(m.id, e.target.value); e.target.value = ""; } }} className="w-full">
                      <option value="">— Selecciona un jugador —</option>
                      {[...avail].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Sel>
                }
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── TAB JUGADORES ─────────────────────────────────────────────────────────────
function TabJugadores({ data }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("points");
  const [sortDir, setSortDir] = useState("desc");
  const nonFixed = data.players.filter(p => !p.fixed);
  const fixedPlayers = data.players.filter(p => p.fixed);
  const ranked = [...nonFixed].sort((a, b) => { const pd = (b.points || 0) - (a.points || 0); return pd !== 0 ? pd : (b.level || 1) - (a.level || 1); });
  const getPos = id => { const idx = ranked.findIndex(p => p.id === id); return idx === -1 ? "—" : idx + 1; };
  const toggle = f => { if (sortBy === f) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortBy(f); setSortDir("desc"); } };
  const filterFn = p => p.name.toLowerCase().includes(search.toLowerCase());
  const list = [
    ...ranked.filter(filterFn).sort((a, b) => {
      if (sortBy === "name") return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const fa = sortBy === "played" ? (a.wins || 0) + (a.losses || 0) : sortBy === "pos" ? getPos(a.id) : (a[sortBy] || 0);
      const fb = sortBy === "played" ? (b.wins || 0) + (b.losses || 0) : sortBy === "pos" ? getPos(b.id) : (b[sortBy] || 0);
      if (fa === fb) return (b.level || 1) - (a.level || 1);
      return sortDir === "asc" ? fa - fb : fb - fa;
    }),
    ...fixedPlayers.filter(filterFn)
  ];
  const Th = ({ f, label, left }) => (
    <th onClick={() => toggle(f)} className={`px-4 py-3 ${left ? "text-left" : "text-center"} cursor-pointer select-none hover:text-emerald-400 transition text-xs uppercase tracking-wider text-gray-400`}>
      {label}{sortBy === f ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
  return (
    <div className="space-y-4">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar jugador..." className="w-full pl-9" />
      </div>
      {list.length === 0
        ? <div className="text-center py-16 text-gray-500">No se encontraron jugadores</div>
        : <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
                <tr><Th f="name" label="Jugador" left /><Th f="played" label="PJ" /><Th f="wins" label="V" /><Th f="losses" label="D" /><Th f="points" label="Pts" /><Th f="pos" label="#" /><Th f="level" label="Nivel" /></tr>
              </thead>
              <tbody>
                {list.map((p, i) => (
                  <tr key={p.id} className={`border-t border-white/5 hover:bg-white/5 transition ${i === 0 && !p.fixed ? "bg-emerald-500/5" : ""}`}>
                    <td className="px-4 py-3 font-semibold text-white">
                      <span className="flex items-center gap-2">
                        {!p.fixed && i < 3 && <span className={`text-xs ${i === 0 ? "text-yellow-400" : i === 1 ? "text-gray-300" : "text-amber-600"}`}>{["🥇", "🥈", "🥉"][i]}</span>}
                        {p.name}{p.fixed && <span className="text-xs ml-1">⭐</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400">{(p.wins || 0) + (p.losses || 0)}</td>
                    <td className="px-4 py-3 text-center text-emerald-400 font-bold">{p.wins || 0}</td>
                    <td className="px-4 py-3 text-center text-red-400">{p.losses || 0}</td>
                    <td className="px-4 py-3 text-center font-black text-emerald-400 text-base">{p.points}</td>
                    <td className="px-4 py-3 text-center text-gray-400 font-mono text-xs">#{getPos(p.id)}</td>
                    <td className="px-4 py-3 text-center"><Badge color="purple">{Number(p.level).toFixed(2)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
      }
    </div>
  );
}

// ── TAB RESULTADOS ────────────────────────────────────────────────────────────
function TabResultados({ data }) {
  const completed = data.matches.filter(m => m.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
  const getP = id => data.players.find(p => p.id === id);
  if (!completed.length) return (
    <div className="text-center py-24">
      <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-4xl mx-auto mb-4">📊</div>
      <p className="text-xl font-bold text-white mb-1">No hay partidos jugados aún</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-black">Resultados <span className="text-gray-500 font-normal text-base">({completed.length} partidos)</span></h2>
      {completed.map(m => {
        const r = m.result; if (!r) return null;
        const pA = (r.pairA || []).map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" / ");
        const pB = (r.pairB || []).map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" / ");
        return (
          <Card key={m.id} className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="font-black text-white">{fmtDate(m.date)}</p>
                <p className="text-emerald-400 text-sm">⏰ {m.time} &nbsp;·&nbsp; 📍 {m.location}</p>
              </div>
              {r.bonus && <Badge color="yellow">⭐ Punto Extra</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[["A", pA], ["B", pB]].map(([side, name]) => (
                <div key={side} className={`rounded-xl p-3 text-center border ${r.winner === side ? "bg-emerald-500/10 border-emerald-500/40" : "bg-red-500/5 border-red-500/20"}`}>
                  <p className="text-xs font-bold mb-1 text-gray-400">Pareja {side} {r.winner === side ? "🏆" : ""}</p>
                  <p className="text-sm font-semibold text-white">{name}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              {r.sets.map((s, i) => (s.a > 0 || s.b > 0) && <span key={i} className="bg-white/10 border border-white/20 rounded-full px-3 py-1 text-sm font-mono font-bold text-white">{s.a}–{s.b}</span>)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── TAB PREMIOS ───────────────────────────────────────────────────────────────
function TabPremios({ data, store, dispatch, adminAuth }) {
  const season = store.currentSeason;
  const cur = store.seasons[season] || { players: [], matches: [] };
  const specialWinners = cur.specialWinners || {};

  const setSpecial = (key, val) => {
    dispatch({ type: "SET_SEASON_DATA", season, payload: { ...cur, specialWinners: { ...specialWinners, [key]: val } } });
  };

  const players = data.players.filter(p => !p.fixed);
  const getMatches = p => (p.wins || 0) + (p.losses || 0);
  const qualified = players.filter(p => getMatches(p) >= 3);
  const top3 = [...players].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 3);
  const bestLevel = qualified.length ? [...qualified].sort((a, b) => (b.level || 0) - (a.level || 0))[0] : null;
  const mostPlayed = players.length ? [...players].sort((a, b) => getMatches(b) - getMatches(a))[0] : null;
  const worstLevel = qualified.length ? [...qualified].sort((a, b) => (a.level || 0) - (b.level || 0))[0] : null;

  const medals = ["🥇", "🥈", "🥉"];
  const podiumColors = [
    "from-yellow-500/20 to-yellow-600/5 border-yellow-500/40",
    "from-gray-400/20 to-gray-500/5 border-gray-400/40",
    "from-amber-700/20 to-amber-800/5 border-amber-700/40",
  ];
  const podiumText = ["text-yellow-400", "text-gray-300", "text-amber-600"];

  const SpecialCard = ({ emoji, title, subtitle, winner, manualKey }) => (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="text-3xl">{emoji}</div>
        <div>
          <p className="font-black text-white text-sm leading-tight">"{title}"</p>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {winner ? (
        <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
          <span className="text-2xl">🏆</span>
          <div>
            <p className="font-black text-white">{winner.name}</p>
            {winner.stat && <p className="text-xs text-gray-400">{winner.stat}</p>}
          </div>
        </div>
      ) : manualKey ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
            {specialWinners[manualKey]
              ? <><span className="text-2xl">🏆</span><p className="font-black text-white">{specialWinners[manualKey]}</p></>
              : <p className="text-xs text-gray-500 italic">Pendiente de asignar por el administrador</p>
            }
          </div>
          {adminAuth && (
            <Sel value={specialWinners[manualKey] || ""} onChange={e => setSpecial(manualKey, e.target.value)} className="w-full">
              <option value="">— Seleccionar ganador —</option>
              {[...players].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </Sel>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
          <p className="text-xs text-gray-500 italic">No hay datos suficientes aún</p>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-black text-white mb-1">🏅 Premios</h2><p className="text-sm text-gray-400">Temporada {season}</p></div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">🏆 Premios Absolutos — Top 3</p>
        {top3.length === 0
          ? <Card className="p-5 text-center text-gray-500 text-sm">No hay jugadores con puntos aún</Card>
          :         <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {top3.map((p, i) => (
                <div key={p.id} className={`rounded-2xl border bg-gradient-to-b p-5 text-center ${podiumColors[i]}`}>
                  <div className="text-4xl mb-2">{medals[i]}</div>
                  <p className={`font-black text-lg ${podiumText[i]}`}>{p.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{p.points} puntos</p>
                  <p className="text-xs text-gray-500">{getMatches(p)} partidos · Nivel {Number(p.level).toFixed(2)}</p>
                </div>
              ))}
            </div>
        }
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">⭐ Premios Especiales</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SpecialCard emoji="💪" title="Como soy de bueno, chaval!" subtitle="Mayor nivel (mín. 3 partidos jugados)" winner={bestLevel ? { name: bestLevel.name, stat: `Nivel ${Number(bestLevel.level).toFixed(2)} · ${getMatches(bestLevel)} partidos jugados` } : null} />
          <SpecialCard emoji="📅" title="A ese partido me apunto" subtitle="Más partidos jugados"           winner={mostPlayed && getMatches(mostPlayed) > 0 ? { name: mostPlayed.name, stat: `${getMatches(mostPlayed)} partidos jugados · Nivel ${Number(mostPlayed.level).toFixed(2)}` } : null} />
          <SpecialCard emoji="⏰" title="Id calentado que llego en 5'" subtitle="El jugador más impuntual (asignado por el admin)" manualKey="impuntual" />
          <SpecialCard emoji="🤝" title="Yo te traigo un colega" subtitle="Quien más nuevos jugadores ha aportado (asignado por el admin)" manualKey="colega" />
          <SpecialCard emoji="🪵" title="Pala de madera" subtitle="Nivel más bajo (mín. 3 partidos jugados)" winner={worstLevel ? { name: worstLevel.name, stat: `Nivel ${Number(worstLevel.level).toFixed(2)} · ${getMatches(worstLevel)} partidos jugados` } : null} />
        </div>
      </div>
      {!adminAuth && <p className="text-xs text-gray-600 text-center">Inicia sesión como administrador para asignar los premios manuales</p>}
    </div>
  );
}

// ── TAB ADMIN ─────────────────────────────────────────────────────────────────
function TabAdmin({ store, dispatch, data, setData, onLogout }) {
  const [sec, setSec] = useState("club");
  const sections = [
    { id: "club", label: "Club", icon: "🏷️" }, { id: "players", label: "Jugadores", icon: "👥" },
    { id: "matches", label: "Partidos", icon: "🎾" }, { id: "results", label: "Resultados", icon: "📊" },
    { id: "history", label: "Historial", icon: "📋" }, { id: "season", label: "Temporada", icon: "🏆" },
    { id: "password", label: "Contraseña", icon: "🔑" }, { id: "import", label: "Importar", icon: "📂" },
    { id: "export", label: "Exportar", icon: "⬇️" },
  ];
  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-xl font-black">Panel de Administración</h2>
        <Btn variant="ghost" onClick={onLogout} className="text-xs">Cerrar sesión →</Btn>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        {sections.map(s => (
          <button key={s.id} onClick={() => setSec(s.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${sec === s.id ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10"}`}>
            <span>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>
      {sec === "club"     && <AdminClub store={store} dispatch={dispatch} />}
      {sec === "players"  && <AdminPlayers data={data} setData={setData} />}
      {sec === "matches"  && <AdminMatches data={data} setData={setData} />}
      {sec === "results"  && <AdminResults data={data} setData={setData} />}
      {sec === "history"  && <AdminHistory data={data} setData={setData} />}
      {sec === "season"   && <AdminSeason store={store} dispatch={dispatch} />}
      {sec === "password" && <AdminPassword />}
      {sec === "import"   && <AdminImport setData={setData} />}
      {sec === "export"   && <AdminExport data={data} season={store.currentSeason} />}
    </div>
  );
}

// ── ADMIN CLUB ────────────────────────────────────────────────────────────────
function AdminClub({ store, dispatch }) {
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const save = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    dispatch({ type: "SET_CLUB_NAME", payload: trimmed });
    setInput("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <div className="max-w-md">
      <Card className="p-5 space-y-4">
        <h3 className="font-bold">🏷️ Nombre del club</h3>
        <p className="text-xs text-gray-400">Este nombre aparecerá en la cabecera de la aplicación.</p>
        <div className="bg-white/5 rounded-xl px-4 py-3 border border-white/10">
          <p className="text-xs text-gray-400 mb-1">Nombre actual</p>
          <p className="font-black text-emerald-400 text-lg">{store.clubName || "Club Pádel"}</p>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Nuevo nombre</label>
          <Input value={input} onChange={e => { setInput(e.target.value); setSaved(false); }} onKeyDown={e => e.key === "Enter" && save()} placeholder="Escribe el nuevo nombre..." className="w-full" />
        </div>
        {saved && <p className="text-sm rounded-xl p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">✅ Nombre actualizado correctamente</p>}
        <Btn onClick={save} disabled={!input.trim()}>Guardar nombre</Btn>
      </Card>
    </div>
  );
}

// ── ADMIN JUGADORES ───────────────────────────────────────────────────────────
const EMPTY_P = { name: "", level: 1, points: 0, wins: 0, losses: 0, fixed: false };
function AdminPlayers({ data, setData }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_P });
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const openNew = () => { setForm({ ...EMPTY_P }); setEditId(null); setShowModal(true); };
  const openEdit = p => { setForm({ name: p.name, level: p.level || 1, points: p.points || 0, wins: p.wins || 0, losses: p.losses || 0, fixed: !!p.fixed }); setEditId(p.id); setShowModal(true); setDeleteId(null); };
  const closeModal = () => { setShowModal(false); setEditId(null); setForm({ ...EMPTY_P }); };
  const save = () => {
    if (!form.name.trim()) return;
    if (editId) setData(prev => ({ ...prev, players: prev.players.map(p => p.id === editId ? { ...p, ...form } : p) }));
    else setData(prev => ({ ...prev, players: [...prev.players, { ...form, id: "p_" + Date.now() }] }));
    closeModal();
  };
  const del = id => { setData(prev => ({ ...prev, players: prev.players.filter(p => p.id !== id) })); setDeleteId(null); };
  const ranked = [...data.players].sort((a, b) => (b.points || 0) - (a.points || 0));
  const getPos = id => ranked.findIndex(p => p.id === id) + 1;
  return (
    <div className="space-y-5">
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="font-black text-lg mb-5">{editId ? "✏️ Editar jugador" : "➕ Nuevo jugador"}</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nombre</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre completo" className="w-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[["Nivel", "level", "0.01", 1, 10], ["Puntos", "points", "1", 0, 9999], ["Victorias", "wins", "1", 0, 999], ["Derrotas", "losses", "1", 0, 999]].map(([label, field, step, min, max]) => (
                  <div key={field}>
                    <label className="text-xs text-gray-400 block mb-1">{label}</label>
                    <Input type="number" step={step} min={min} max={max} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: parseFloat(e.target.value) || 0 }))} className="w-full" />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition">
                <input type="checkbox" checked={form.fixed} onChange={e => setForm(f => ({ ...f, fixed: e.target.checked }))} className="w-4 h-4 accent-emerald-500" />
                <span className="text-sm">⭐ Jugador Fijo</span>
              </label>
            </div>
            <div className="flex gap-2">
              <Btn onClick={save} className="flex-1 justify-center">{editId ? "Guardar cambios" : "Añadir jugador"}</Btn>
              <Btn variant="secondary" onClick={closeModal} className="flex-1 justify-center">Cancelar</Btn>
            </div>
          </Card>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-gray-300">Jugadores <span className="text-gray-500">({data.players.length})</span></h3>
        <Btn onClick={openNew}>+ Nuevo jugador</Btn>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10">
            <tr>{["Jugador", "PJ", "V", "D", "Pts", "#", "Nivel", "Fijo", "Acciones"].map(h => (
              <th key={h} className="px-3 py-3 text-xs uppercase tracking-wider text-gray-400 text-center first:text-left">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {data.players.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-gray-500">No hay jugadores registrados</td></tr>}
            {data.players.map((p, i) => (
              <tr key={p.id} className="border-t border-white/5 hover:bg-white/5 transition">
                <td className="px-3 py-2.5 font-semibold text-white">{p.name}</td>
                <td className="px-3 py-2.5 text-center text-gray-400">{(p.wins || 0) + (p.losses || 0)}</td>
                <td className="px-3 py-2.5 text-center text-emerald-400 font-bold">{p.wins || 0}</td>
                <td className="px-3 py-2.5 text-center text-red-400">{p.losses || 0}</td>
                <td className="px-3 py-2.5 text-center font-black text-emerald-400">{p.points}</td>
                <td className="px-3 py-2.5 text-center text-gray-500 font-mono text-xs">#{getPos(p.id)}</td>
                <td className="px-3 py-2.5 text-center"><Badge color="purple">{Number(p.level).toFixed(2)}</Badge></td>
                <td className="px-3 py-2.5 text-center">{p.fixed ? "⭐" : ""}</td>
                <td className="px-3 py-2.5">
                  {deleteId === p.id
                    ? <Confirm msg="¿Eliminar?" onYes={() => del(p.id)} onNo={() => setDeleteId(null)} />
                    : <div className="flex gap-1 justify-center">
                        <Btn variant="ghost" onClick={() => openEdit(p)} className="text-xs py-1 px-2">Editar</Btn>
                        <Btn variant="danger" onClick={() => setDeleteId(p.id)} className="text-xs py-1 px-2">Baja</Btn>
                      </div>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {data.players.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
          <p className="text-sm font-bold text-red-400 mb-1">⚠️ Zona de peligro</p>
          <p className="text-xs text-gray-500 mb-3">Elimina todos los jugadores y sus estadísticas.</p>
          {deleteId === "all"
            ? <Confirm msg="¿Eliminar TODOS?" onYes={() => { setData(p => ({ ...p, players: [] })); setDeleteId(null); }} onNo={() => setDeleteId(null)} />
            : <Btn variant="danger" onClick={() => setDeleteId("all")}>Eliminar todos los jugadores</Btn>
          }
        </div>
      )}
    </div>
  );
}

// ── ADMIN PARTIDOS ────────────────────────────────────────────────────────────
function AdminMatches({ data, setData }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date: today, time: "10:00", location: "Gaitanes" });
  const [cancelId, setCancelId] = useState(null);
  const fixedIds = data.players.filter(p => p.fixed).map(p => p.id);
  const getP = id => data.players.find(p => p.id === id);
  const create = () => {
    if (form.date < today) return;
    setData(prev => ({ ...prev, matches: [...prev.matches, { id: "m_" + Date.now(), date: form.date, time: form.time, location: form.location, status: "open", signedUp: [...fixedIds], pairs: [], result: null }] }));
  };
  const cancel = id => { setData(prev => ({ ...prev, matches: prev.matches.filter(m => m.id !== id) })); setCancelId(null); };
  const pending = data.matches.filter(m => m.status !== "completed");
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="font-bold mb-4 text-white">Convocar Partido</h3>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[["Fecha", "date", "date"], ["Hora", "time", "time"], ["Lugar", "location", "text"]].map(([label, field, type]) => (
            <div key={field}>
              <label className="text-xs text-gray-400 block mb-1">{label}</label>
              <Input type={type} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} className="w-full" step={type === "time" ? "300" : undefined} />
            </div>
          ))}
        </div>
        <Btn onClick={create} disabled={form.date < today}>Convocar partido</Btn>
        {form.date < today && <p className="text-xs text-red-400 mt-2">No se pueden convocar partidos en el pasado</p>}
        {fixedIds.length > 0 && <p className="text-xs text-gray-500 mt-2">Fijos: {fixedIds.map(id => { const p = getP(id); return p ? p.name : null; }).filter(Boolean).join(", ")}</p>}
      </Card>
      <div className="space-y-3">
        <h3 className="font-bold text-gray-300">Partidos Pendientes</h3>
        {!pending.length && <p className="text-gray-500 text-sm">No hay partidos convocados</p>}
        {pending.map(m => (
          <Card key={m.id} className="p-4 flex justify-between items-center gap-4">
            <div>
              <p className="font-bold text-white">{fmtDate(m.date)} · {m.time} · {m.location}</p>
              <p className="text-xs text-gray-400 mt-1">Apuntados: {m.signedUp.map(id => { const p = getP(id); return p ? p.name : "?"; }).join(", ") || "Ninguno"}</p>
            </div>
            {cancelId === m.id
              ? <Confirm msg="¿Desconvocar?" onYes={() => cancel(m.id)} onNo={() => setCancelId(null)} />
              : <Btn variant="danger" onClick={() => setCancelId(m.id)} className="shrink-0 text-xs py-1">Desconvocar</Btn>}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── ADMIN RESULTADOS ──────────────────────────────────────────────────────────
function AdminResults({ data, setData }) {
  const pending = data.matches.filter(m => m.status === "open" && m.signedUp.length === 4);
  const [selId, setSelId] = useState(null);
  const sel = pending.find(m => m.id === selId);
  const getP = id => data.players.find(p => p.id === id);
  const handleSave = result => {
    const { pairA, pairB, winner, bonus } = result;
    const wp = 3 + (bonus ? 1 : 0), lp = 1;
    const winners = winner === "A" ? pairA : pairB;
    const losers = winner === "A" ? pairB : pairA;
    setData(prev => ({
      ...prev,
      players: prev.players.map(p => {
        if (winners.includes(p.id)) return { ...p, points: (p.points || 0) + wp, wins: (p.wins || 0) + 1 };
        if (losers.includes(p.id)) return { ...p, points: (p.points || 0) + lp, losses: (p.losses || 0) + 1 };
        return p;
      }),
      matches: prev.matches.map(m => m.id !== selId ? m : { ...m, status: "completed", result })
    }));
    setSelId(null);
  };
  return (
    <div className="space-y-4">
      <h3 className="font-bold text-gray-300">Registrar Resultado</h3>
      <p className="text-xs text-gray-500">Solo partidos con 4 jugadores apuntados</p>
      {!pending.length && <p className="text-gray-500 text-sm">No hay partidos listos para registrar resultado</p>}
      {pending.map(m => (
        <div key={m.id} onClick={() => setSelId(selId === m.id ? null : m.id)}
          className={`cursor-pointer rounded-2xl border p-4 transition-all ${selId === m.id ? "bg-emerald-500/10 border-emerald-500/40" : "bg-white/5 border-white/10 hover:border-emerald-500/30"}`}>
          <p className="font-bold text-white">{fmtDate(m.date)} · {m.time} · {m.location}</p>
          <p className="text-xs text-gray-400 mt-1">{m.signedUp.map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" · ")}</p>
          {Array.isArray(m.pairs) && m.pairs.length === 2 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {m.pairs.map((pair, pi) => (
                <span key={pi} className={`text-xs px-2 py-1 rounded-full ${pi === 0 ? "bg-blue-500/15 text-blue-400" : "bg-orange-500/15 text-orange-400"}`}>
                  Pareja {pi === 0 ? "A" : "B"}: {pair.map(p => p.name).join(" / ")}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {sel && (
        <Card className="p-5 border-emerald-500/30">
          <h4 className="font-bold mb-4">Resultado: {fmtDate(sel.date)} {sel.time}</h4>
          <ResultForm match={sel} players={data.players} onSave={handleSave} onCancel={() => setSelId(null)}
            pairAInit={Array.isArray(sel.pairs) && sel.pairs.length === 2 ? sel.pairs[0].map(p => p.id) : sel.signedUp.slice(0, 2)}
            pairBInit={Array.isArray(sel.pairs) && sel.pairs.length === 2 ? sel.pairs[1].map(p => p.id) : sel.signedUp.slice(2, 4)} />
        </Card>
      )}
    </div>
  );
}

// ── ADMIN HISTORIAL ───────────────────────────────────────────────────────────
function AdminHistory({ data, setData }) {
  const completed = data.matches.filter(m => m.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
  const [editId, setEditId] = useState(null);
  const getP = id => data.players.find(p => p.id === id);
  const handleEdit = (matchId, oldResult, newResult) => {
    const oW = oldResult.winner === "A" ? oldResult.pairA : oldResult.pairB;
    const oL = oldResult.winner === "A" ? oldResult.pairB : oldResult.pairA;
    const oWP = 3 + (oldResult.bonus ? 1 : 0);
    const { pairA, pairB, winner, bonus } = newResult;
    const nW = winner === "A" ? pairA : pairB;
    const nL = winner === "A" ? pairB : pairA;
    const nWP = 3 + (bonus ? 1 : 0);
    setData(prev => ({
      ...prev,
      players: prev.players.map(p => {
        let pts = p.points || 0, wins = p.wins || 0, losses = p.losses || 0;
        if (oW.includes(p.id)) { pts -= oWP; wins -= 1; }
        if (oL.includes(p.id)) { pts -= 1; losses -= 1; }
        if (nW.includes(p.id)) { pts += nWP; wins += 1; }
        if (nL.includes(p.id)) { pts += 1; losses += 1; }
        return { ...p, points: pts, wins: Math.max(0, wins), losses: Math.max(0, losses) };
      }),
      matches: prev.matches.map(m => m.id !== matchId ? m : { ...m, result: newResult })
    }));
    setEditId(null);
  };
  if (!completed.length) return <p className="text-gray-500 text-sm">No hay partidos jugados aún</p>;
  return (
    <div className="space-y-4">
      <h3 className="font-bold text-gray-300">Historial <span className="text-gray-500 font-normal">({completed.length} partidos)</span></h3>
      {completed.map(m => {
        const r = m.result; if (!r) return null;
        const pA = (r.pairA || []).map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" / ");
        const pB = (r.pairB || []).map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" / ");
        const isEditing = editId === m.id;
        return (
          <Card key={m.id} className={`p-5 ${isEditing ? "border-emerald-500/40" : ""}`}>
            <div className="flex justify-between items-start mb-3">
              <div><p className="font-black text-white">{fmtDate(m.date)} · {m.time}</p><p className="text-gray-400 text-xs">📍 {m.location}</p></div>
              <div className="flex items-center gap-2">
                {r.bonus && <Badge color="yellow">⭐ Punto Extra</Badge>}
                {!isEditing && <Btn variant="ghost" onClick={() => setEditId(m.id)} className="text-xs py-1 px-2">Editar</Btn>}
              </div>
            </div>
            {!isEditing && (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[["A", pA], ["B", pB]].map(([side, name]) => (
                    <div key={side} className={`rounded-xl p-3 text-center border ${r.winner === side ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/5 border-red-500/20"}`}>
                      <p className="text-xs font-bold mb-1 text-gray-400">Pareja {side} {r.winner === side ? "🏆" : ""}</p>
                      <p className="text-sm font-semibold text-white">{name}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 justify-center flex-wrap">
                  {r.sets.map((s, i) => (s.a > 0 || s.b > 0) && <span key={i} className="bg-white/10 border border-white/20 rounded-full px-3 py-1 text-sm font-mono font-bold">{s.a}–{s.b}</span>)}
                </div>
              </>
            )}
            {isEditing && <ResultForm match={m} players={data.players} existingResult={r} onSave={nr => handleEdit(m.id, r, nr)} onCancel={() => setEditId(null)} />}
          </Card>
        );
      })}
    </div>
  );
}

// ── ADMIN TEMPORADA ───────────────────────────────────────────────────────────
function AdminSeason({ store, dispatch }) {
  const [option, setOption] = useState("keep");
  const [confirm2, setConfirm2] = useState(false);
  const [switchSeason, setSwitchSeason] = useState(null);
  const [deleteSeason, setDeleteSeason] = useState(null);
  const allSeasons = Object.keys(store.seasons).map(Number).sort((a, b) => b - a);
  const latest = Math.max(...allSeasons);

  const newSeason = () => {
    const next = latest + 1;
    const prev = store.seasons[store.currentSeason];
    dispatch({
      type: "SET_STORE", payload: s => ({
        ...s, currentSeason: next,
        seasons: { ...s.seasons, [next]: { players: prev.players.map(p => ({ ...p, points: 0, wins: 0, losses: 0, level: option === "reset" ? 1 : p.level })), matches: [] } }
      })
    });
    setConfirm2(false);
  };

  const doDelete = n => {
    dispatch({
      type: "SET_STORE", payload: s => {
        const ns = { ...s.seasons }; delete ns[n];
        const rem = Object.keys(ns).map(Number).sort((a, b) => b - a);
        return { ...s, currentSeason: s.currentSeason === n ? rem[0] : s.currentSeason, seasons: ns };
      }
    });
    setDeleteSeason(null);
  };

  return (
    <div className="max-w-lg space-y-5">
      <Card className="p-5">
        <h3 className="font-bold mb-1">Temporada activa</h3>
        <p className="text-5xl font-black text-emerald-400 mb-5">{store.currentSeason}</p>
        <div className="space-y-2 mb-5">
          {[["keep", "Mantener niveles", "Cada jugador conserva su nivel"], ["reset", "Resetear a nivel 1", "Todos vuelven al nivel 1"]].map(([val, title, desc]) => (
            <label key={val} className={`flex items-center gap-3 cursor-pointer p-3 rounded-xl border transition ${option === val ? "border-emerald-500/50 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
              <input type="radio" name="opt" value={val} checked={option === val} onChange={() => setOption(val)} className="accent-emerald-500" />
              <div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-gray-400">{desc}</p></div>
            </label>
          ))}
        </div>
        {confirm2
          ? <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400 text-sm font-bold mb-3">⚠️ ¿Confirmar nueva temporada {latest + 1}?</p>
              <div className="flex gap-2"><Btn onClick={newSeason}>Confirmar</Btn><Btn variant="secondary" onClick={() => setConfirm2(false)}>Cancelar</Btn></div>
            </div>
          : <Btn variant="secondary" onClick={() => setConfirm2(true)} className="border-amber-500/30 text-amber-400">Iniciar temporada {latest + 1} →</Btn>
        }
      </Card>
      {allSeasons.length > 1 && (
        <Card className="p-5">
          <h3 className="font-bold mb-3">Gestionar temporadas</h3>
          <div className="space-y-2">
            {allSeasons.map(n => (
              <div key={n} className={`flex items-center justify-between p-3 rounded-xl border ${store.currentSeason === n ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Temporada {n}</span>
                  {n === latest && <Badge color="green">Última</Badge>}
                  {store.currentSeason === n && <Badge color="blue">Activa</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {store.currentSeason !== n && (
                    switchSeason === n
                      ? <Confirm msg="¿Cambiar?" onYes={() => { dispatch({ type: "SET_CURRENT_SEASON", payload: n }); setSwitchSeason(null); }} onNo={() => setSwitchSeason(null)} />
                      : <Btn variant="ghost" onClick={() => { setSwitchSeason(n); setDeleteSeason(null); }} className="text-xs py-1 px-2">Abrir</Btn>
                  )}
                  {deleteSeason === n
                    ? <Confirm msg="¿Eliminar?" onYes={() => doDelete(n)} onNo={() => setDeleteSeason(null)} />
                    : <Btn variant="danger" onClick={() => { setDeleteSeason(n); setSwitchSeason(null); }} className="text-xs py-1 px-2">Eliminar</Btn>
                  }
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── ADMIN CONTRASEÑA ──────────────────────────────────────────────────────────
function AdminPassword() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState(null);
  const save = () => {
    if (form.current !== DEFAULT_PASSWORD && form.current !== SUPER_PASSWORD) { setMsg({ type: "error", text: "Contraseña actual incorrecta" }); return; }
    if (form.current === SUPER_PASSWORD) { setMsg({ type: "error", text: "No puedes cambiar la contraseña de superadministrador" }); return; }
    if (form.next.length < 4) { setMsg({ type: "error", text: "Mínimo 4 caracteres" }); return; }
    if (form.next === SUPER_PASSWORD) { setMsg({ type: "error", text: "Esa contraseña no está permitida" }); return; }
    if (form.next !== form.confirm) { setMsg({ type: "error", text: "Las contraseñas no coinciden" }); return; }
    setForm({ current: "", next: "", confirm: "" });
    setMsg({ type: "ok", text: "Contraseña actualizada" });
  };
  return (
    <div className="max-w-md">
      <Card className="p-5 space-y-4">
        <h3 className="font-bold">🔑 Cambiar contraseña</h3>
        {[["Contraseña actual", "current"], ["Nueva contraseña", "next"], ["Confirmar", "confirm"]].map(([label, field]) => (
          <div key={field}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <Input type="password" value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} onKeyDown={e => e.key === "Enter" && save()} className="w-full" />
          </div>
        ))}
        {msg && <p className={`text-sm rounded-xl p-3 ${msg.type === "ok" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>{msg.text}</p>}
        <Btn onClick={save} className="w-full justify-center">Cambiar contraseña</Btn>
      </Card>
    </div>
  );
}

// ── ADMIN IMPORTAR ────────────────────────────────────────────────────────────
function AdminImport({ setData }) {
  const [status, setStatus] = useState("");
  const fileRef = useRef();
  const handleFile = async e => {
    const file = e.target.files[0]; if (!file) return;
    setStatus("Procesando...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      let bestRows = [];
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
        if (rows.length > bestRows.length) bestRows = rows;
      }
      if (!bestRows.length) { setStatus("❌ No se encontraron datos"); return; }
      const norm = s => String(s).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const keys = Object.keys(bestRows[0] || {});
      const findCol = (...cc) => keys.find(k => cc.some(c => norm(k) === norm(c))) || keys.find(k => cc.some(c => norm(k).includes(norm(c)))) || null;
      const cName = findCol("Jugador", "Nombre", "Name", "Player");
      const cWins = findCol("Victorias", "Ganados", "Wins", "PG", "Victoria");
      const cLosses = findCol("Derrotas", "Perdidos", "Losses", "PP", "Derrota");
      const cPoints = findCol("Puntos", "Points", "Pts", "Score");
      const cLevel = findCol("Nivel", "Level", "Niv");
      const cFixed = findCol("Fijo", "Fixed", "Permanente");
      if (!cName) { setStatus(`❌ No se encontró columna de jugadores. Columnas: ${keys.join(", ")}`); return; }
      const players = bestRows.map((row, i) => {
        const name = String(row[cName] || "").trim(); if (!name) return null;
        const fixed = cFixed ? ["si", "sí", "yes", "true", "1", "x"].includes(String(row[cFixed]).toLowerCase()) : false;
        return { id: "p_imp_" + i + "_" + Date.now(), name, level: parseFloat(row[cLevel]) || 1, points: Number(row[cPoints]) || 0, wins: Number(row[cWins]) || 0, losses: Number(row[cLosses]) || 0, fixed };
      }).filter(Boolean);
      setData(prev => ({ ...prev, players }));
      setStatus(`✅ ${players.length} jugadores importados correctamente`);
    } catch (err) { setStatus("❌ Error: " + err.message); }
    e.target.value = "";
  };
  return (
    <div className="max-w-lg">
      <Card className="p-5">
        <h3 className="font-bold mb-2">Importar desde Excel</h3>
        <p className="text-sm text-gray-400 mb-2">Columnas esperadas:</p>
        <p className="text-xs bg-black/30 rounded-xl p-3 font-mono text-emerald-400 mb-4">Jugador · Victorias · Derrotas · Puntos · Nivel · Fijo</p>
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-emerald-500/30 rounded-2xl p-10 cursor-pointer hover:bg-emerald-500/5 hover:border-emerald-500/50 transition mb-3">
          <span className="text-4xl">📂</span>
          <span className="text-sm text-gray-300 font-medium">Haz clic o arrastra tu archivo Excel aquí</span>
          <span className="text-xs text-gray-500">.xlsx / .xls</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>
        {status && <p className={`text-sm rounded-xl p-3 border ${status.startsWith("✅") ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : status.startsWith("❌") ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-white/5 text-gray-400 border-white/10"}`}>{status}</p>}
      </Card>
    </div>
  );
}

// ── ADMIN EXPORTAR ────────────────────────────────────────────────────────────
function AdminExport({ data, season }) {
  const getP = id => data.players.find(p => p.id === id);
  const ranked = [...data.players].sort((a, b) => (b.points || 0) - (a.points || 0));
  const exportPlayers = () => {
    const rows = ranked.map((p, i) => ({ "Jugador": p.name, "PJ": (p.wins || 0) + (p.losses || 0), "Victorias": p.wins || 0, "Derrotas": p.losses || 0, "Puntos": p.points, "Posicion": i + 1, "Nivel": Number(p.level).toFixed(2), "Fijo": p.fixed ? "Si" : "No" }));
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Ranking"); XLSX.writeFile(wb, `ranking_t${season}.xlsx`);
  };
  const exportMatches = () => {
    const rows = data.matches.filter(m => m.status === "completed").map(m => {
      const r = m.result;
      const pA = r && r.pairA ? r.pairA.map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" / ") : "";
      const pB = r && r.pairB ? r.pairB.map(id => { const p = getP(id); return p ? p.name : "?"; }).join(" / ") : "";
      return { "Fecha": fmtDate(m.date), "Hora": m.time, "Lugar": m.location, "Pareja A": pA, "Pareja B": pB, "Set 1": r && r.sets && r.sets[0] ? `${r.sets[0].a}-${r.sets[0].b}` : "", "Set 2": r && r.sets && r.sets[1] ? `${r.sets[1].a}-${r.sets[1].b}` : "", "Ganador": r ? (r.winner === "A" ? pA : pB) : "", "Bonus": r && r.bonus ? "Si" : "No" };
    });
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Partidos"); XLSX.writeFile(wb, `partidos_t${season}.xlsx`);
  };
  return (
    <div className="max-w-lg space-y-4">
      <Card className="p-5">
        <h3 className="font-bold mb-4">Exportar datos — Temporada {season}</h3>
        <div className="space-y-3">
          {[{ label: "📊 Ranking de jugadores", desc: "Excel con todos los jugadores y estadísticas", fn: exportPlayers }, { label: "🎾 Historial de partidos", desc: "Excel con todos los partidos completados", fn: exportMatches }].map(({ label, desc, fn }) => (
            <div key={label} className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition">
              <div><p className="font-semibold text-white">{label}</p><p className="text-xs text-gray-400">{desc}</p></div>
              <Btn onClick={fn} className="ml-4 shrink-0">Descargar</Btn>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
