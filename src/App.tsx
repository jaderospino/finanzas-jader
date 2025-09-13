// App.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useRef,
  MouseEvent,
} from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RTooltip,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import {
  checkSupabase,
  loadSettings,
  saveSettings,
  signInWithEmail,
  getUser,
  pullTx,
  pushTxBulk,
  deleteTx as deleteTxCloud,
} from "./lib/supabase";

/* =========================== Utilidades de dinero =========================== */

const fmtCOP = (v: number) =>
  (isFinite(v) ? v : 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function normalizeMoneyInput(s: string) {
  if (!s) return { raw: "", value: 0 };
  let clean = s
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "")
    .replace(/(,)(?=.*,)/g, "")
    .replace(/(\.)(?=\d{3}(\D|$))/g, "");
  const parts = clean.split(",");
  let num = 0;
  if (parts.length === 2) {
    num =
      Number(parts[0].replace(/\./g, "")) +
      Number("0." + parts[1].replace(/\./g, ""));
  } else {
    num = Number(clean.replace(/\./g, "").replace(",", "."));
  }
  if (!isFinite(num)) num = 0;
  const [ent, dec = ""] = Math.abs(num).toFixed(2).split(".");
  const withDots = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = num < 0 ? "-" : "";
  return { raw: `${sign}${withDots},${dec}`, value: num };
}
const toNumberFromRaw = (raw: string) => normalizeMoneyInput(raw).value;

/* =================================== Tipos ================================= */

type TxType = "Ingreso" | "Gasto" | "Transferencia";
type Account =
  | "Banco Davivienda"
  | "Banco de Bogotá"
  | "Nequi"
  | "Rappi"
  | "Efectivo"
  | "TC Rappi";
type AccountFilter = Account | "Todas";

type Tx = {
  id: string;
  type: TxType;
  account: Account;
  toAccount?: Account | "";
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  amount: number; // COP
  category: string;
  subcategory: string;
  note?: string;
};

type Budget = {
  basicos: number;
  deseos: number;
  ahorro: number;
};

const STORAGE = {
  TX: "fj_tx_v2",
  TAGS: "fj_tags_v2",
  BUDGET: "fj_budget_v2",
  MONTH: "fj_month_v2",
  THEME: "fj_theme_v2",
};

const defaultTags: Record<string, string[]> = {
  Ingresos: ["Salario", "Freelance", "Inversión", "Dividendos", "Otros"],
  "Gastos Básicos": ["Vivienda", "Alimentación", "Transporte", "Servicios"],
  Deseos: ["Ropa", "Tecnología", "Viajes", "Restaurantes", "Ocio"],
  Ahorro: ["General", "Emergencias", "Objetivos"],
};

const ACCOUNTS: Account[] = [
  "Banco Davivienda",
  "Banco de Bogotá",
  "Nequi",
  "Rappi",
  "Efectivo",
  "TC Rappi",
];

const PIE_COLORS = [
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#2563EB",
  "#1e40af",
  "#a78bfa",
];

/* ============================== Hooks de UI ============================== */

function useCountUp(value: number, duration = 700) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic

    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const v = from + (to - from) * ease(p);
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

function useRipple() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const onMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty("--x", `${x}px`);
    el.style.setProperty("--y", `${y}px`);
    el.classList.remove("has-ripple");
    void el.offsetHeight; // reflow
    el.classList.add("has-ripple");
  };
  return { ref, onMouseDown };
}

/* ============================== Helpers fechas ============================== */

function firstDayOfMonth(ym: string) {
  return `${ym}-01`;
}
function lastDayOfMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function startDow(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).getDay();
}

/* ==================================== App ================================== */

export default function App() {
  // Nube
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);

  // Usuario (email visible si hay sesión)
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Modal de etiquetas
  const [showTags, setShowTags] = useState(false);

  // Ping a Supabase (solo prueba de conexión)
  useEffect(() => {
    checkSupabase().then((err) => {
      console.log("Supabase ping:", err?.message || "OK");
    });
  }, []);

  // Obtener usuario al cargar
  useEffect(() => {
    getUser().then((u) => setUserEmail(u?.email ?? null));
  }, []);

  /* Tema */
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE.THEME);
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    localStorage.setItem(STORAGE.THEME, dark ? "dark" : "light");
  }, [dark]);

  /* Cargar ajustes (tags + budget) desde Supabase al montar */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const u = await getUser();
        if (!u) return; // sin sesión, no intenta nube
        setCloudBusy(true);
        const s = await loadSettings(); // { tags, budget }
        if (!mounted) return;

        if (s?.tags && Object.keys(s.tags).length > 0) setTags(s.tags);
        if (s?.budget) setBudget(s.budget);

        setCloudMsg("Ajustes cargados desde la nube");
        setTimeout(() => setCloudMsg(null), 2000);
      } catch {
        setCloudMsg("No se pudo cargar ajustes (se usará local)");
        setTimeout(() => setCloudMsg(null), 2500);
      } finally {
        setCloudBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /* Cargar movimientos (tx) desde la nube al montar si hay sesión */
  useEffect(() => {
    (async () => {
      try {
        const u = await getUser();
        if (!u) return;
        const cloudTx = await pullTx();
        if (Array.isArray(cloudTx) && cloudTx.length) {
          const mapped: Tx[] = cloudTx.map((r: any) => ({
            id: r.id,
            type: r.type,
            account: r.account as Account,
            toAccount: (r.to_account as Account) || "",
            date: r.date,
            time: r.time,
            amount: Number(r.amount),
            category: r.category,
            subcategory: r.subcategory,
            note: r.note || "",
          }));
          setTx(mapped);
          setCloudMsg("Movimientos cargados desde la nube");
          setTimeout(() => setCloudMsg(null), 1800);
        }
      } catch (e) {
        console.error(e);
        setCloudMsg("No se pudieron cargar movimientos");
        setTimeout(() => setCloudMsg(null), 2000);
      }
    })();
  }, []);

  /* Estado base */
  const [month, setMonth] = useState<string>(() => {
    const s = localStorage.getItem(STORAGE.MONTH);
    return s || new Date().toISOString().slice(0, 7);
  });
  const [tags, setTags] = useState<Record<string, string[]>>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(STORAGE.TAGS) || "null") || defaultTags
      );
    } catch {
      return defaultTags;
    }
  });
  const [tx, setTx] = useState<Tx[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.TX) || "[]");
    } catch {
      return [];
    }
  });
  const [budget, setBudget] = useState<Budget>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE.BUDGET) ||
          '{"basicos":0,"deseos":0,"ahorro":0}'
      );
    } catch {
      return { basicos: 0, deseos: 0, ahorro: 0 };
    }
  });

  // Persistencia local
  useEffect(() => localStorage.setItem(STORAGE.TX, JSON.stringify(tx)), [tx]);
  useEffect(
    () => localStorage.setItem(STORAGE.TAGS, JSON.stringify(tags)),
    [tags]
  );
  useEffect(() => localStorage.setItem(STORAGE.MONTH, month), [month]);
  useEffect(
    () => localStorage.setItem(STORAGE.BUDGET, JSON.stringify(budget)),
    [budget]
  );

  /* -------- Captura (Ingreso/Gasto) -------- */

  const [form, setForm] = useState<{
    type: TxType;
    account: Account;
    toAccount: Account | "";
    date: string;
    amountRaw: string;
    category: string;
    subcategory: string;
    note: string;
  }>({
    type: "Ingreso",
    account: "Banco Davivienda",
    toAccount: "" as Account | "",
    date: new Date().toISOString().slice(0, 10),
    amountRaw: "",
    category: "Ingresos",
    subcategory: "Salario",
    note: "",
  });

  const availableSubcats = useMemo(
    () => tags[form.category] || [],
    [tags, form.category]
  );

  const handleAdd = () => {
    if (form.type === "Transferencia") return;
    const amount = toNumberFromRaw(form.amountRaw);
    if (!amount) return;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const sign = form.type === "Ingreso" ? +1 : -1;

    const record: Tx = {
      id: crypto.randomUUID(),
      type: form.type,
      account: form.account,
      toAccount: "",
      date: form.date,
      time,
      amount: Math.abs(amount) * sign,
      category: form.category,
      subcategory: form.subcategory,
      note: form.note,
    };

    setTx((t) => [record, ...t]);
    setForm((f) => ({ ...f, amountRaw: "", note: "" }));
  };

  /* -------- Transferencias -------- */
  const [trf, setTrf] = useState<{
    from: Account;
    to: Account;
    date: string;
    amountRaw: string;
  }>({
    from: "Nequi",
    to: "Efectivo",
    date: new Date().toISOString().slice(0, 10),
    amountRaw: "",
  });

  const handleTransfer = () => {
    if (!trf.from || !trf.to || trf.from === trf.to) return;
    const amount = Math.abs(toNumberFromRaw(trf.amountRaw));
    if (!amount) return;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const out: Tx = {
      id: crypto.randomUUID(),
      type: "Transferencia",
      account: trf.from,
      toAccount: trf.to,
      date: trf.date,
      time,
      amount: -amount,
      category: "Ingresos",
      subcategory: "Entre cuentas",
      note: "",
    };
    const inc: Tx = {
      id: crypto.randomUUID(),
      type: "Transferencia",
      account: trf.to,
      toAccount: trf.from,
      date: trf.date,
      time,
      amount: +amount,
      category: "Ingresos",
      subcategory: "Entre cuentas",
      note: "",
    };

    setTx((t) => [out, inc, ...t]);
    setTrf((v) => ({ ...v, amountRaw: "" }));
  };

  /* ============================= Cálculos base ============================= */

  const txOfMonth = useMemo(
    () => tx.filter((t) => t.date.slice(0, 7) === month),
    [tx, month]
  );

  const byAccountAllTime = useMemo(() => {
    const map: Record<Account, number> = {
      "Banco Davivienda": 0,
      "Banco de Bogotá": 0,
      Nequi: 0,
      Rappi: 0,
      Efectivo: 0,
      "TC Rappi": 0,
    };
    tx.forEach((t) => {
      map[t.account] += t.amount;
    });
    return map;
  }, [tx]);

  const totals = useMemo(() => {
    let ingresos = 0,
      gastos = 0,
      ahorro = 0;

    txOfMonth.forEach((t) => {
      if (t.type === "Ingreso" && t.account !== "TC Rappi") ingresos += t.amount;
      if (t.type === "Gasto") gastos += Math.abs(t.amount);
      if (t.category === "Ahorro") {
        if (t.type === "Ingreso") ahorro += Math.abs(t.amount);
        else if (t.type === "Gasto") ahorro -= Math.abs(t.amount);
      }
    });

    const saldoActual =
      byAccountAllTime["Banco Davivienda"] +
      byAccountAllTime["Banco de Bogotá"] +
      byAccountAllTime["Nequi"] +
      byAccountAllTime["Rappi"] +
      byAccountAllTime["Efectivo"];

    return { ingresos, gastos, ahorro, saldoActual, byAccountAllTime };
  }, [txOfMonth, byAccountAllTime]);

  const byMonth = useMemo(() => {
    const map: Record<string, { ingresos: number; gastos: number }> = {};
    tx.forEach((t) => {
      const m = t.date.slice(0, 7);
      if (!map[m]) map[m] = { ingresos: 0, gastos: 0 };
      if (t.type === "Ingreso" && t.account !== "TC Rappi")
        map[m].ingresos += t.amount;
      if (t.type === "Gasto") map[m].gastos += Math.abs(t.amount);
    });
    const arr = Object.entries(map)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => ({ month: k, ...v }));
    return arr.slice(-6);
  }, [tx]);

  /* ======================= Analítica (pastel + barras) ====================== */

  const [view, setView] = useState<"categoria" | "subcategoria" | "cuenta">(
    "categoria"
  );
  const [selectedCat, setSelectedCat] = useState<string>("");
  const [accFilter, setAccFilter] = useState<AccountFilter>("Todas");
  const [timeMode, setTimeMode] = useState<"mes" | "rango">("mes");
  const [from, setFrom] = useState<string>(firstDayOfMonth(month));
  const [to, setTo] = useState<string>(lastDayOfMonth(month));

  useEffect(() => {
    if (timeMode === "mes") {
      setFrom(firstDayOfMonth(month));
      setTo(lastDayOfMonth(month));
    }
  }, [month, timeMode]);

  const txForCharts = useMemo(() => {
    const fromD = from;
    const toD = to;
    return tx.filter((t) => {
      const inDate = t.date >= fromD && t.date <= toD;
      const isExpense = t.type === "Gasto";
      const accOk = accFilter === "Todas" || t.account === (accFilter as Account);
      return inDate && isExpense && accOk;
    });
  }, [tx, from, to, accFilter]);

  const analyticsData = useMemo(() => {
    const map = new Map<string, number>();
    const add = (key: string, v: number) =>
      map.set(key, (map.get(key) || 0) + Math.abs(v));

    if (view === "categoria") {
      txForCharts.forEach((t) => add(t.category || "Otros", t.amount));
    } else if (view === "cuenta") {
      txForCharts.forEach((t) => add(t.account, t.amount));
    } else {
      const cat =
        selectedCat ||
        (() => {
          const cm = new Map<string, number>();
          txForCharts.forEach((t) =>
            cm.set(t.category, (cm.get(t.category) || 0) + Math.abs(t.amount))
          );
          let top = "";
          let val = -1;
          cm.forEach((v, k) => {
            if (v > val) {
              val = v;
              top = k;
            }
          });
          return top;
        })();

      txForCharts
        .filter((t) => t.category === cat)
        .forEach((t) => add(t.subcategory || "Otros", t.amount));
    }

    const arr = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return arr.length ? arr : [{ name: "Sin datos", value: 0 }];
  }, [txForCharts, view, selectedCat]);

  /* ============================ Tabla & acciones ============================ */

  const [tab, setTab] = useState<
    "capturar" | "transferir" | "presupuesto" | "calendario" | "tabla"
  >("capturar");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"fecha" | "cuenta">("fecha");
  const [sortDir, setSortDir] = useState<"Asc" | "Desc">("Desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = tx.filter((t) => {
      if (!q) return true;
      return (
        t.category.toLowerCase().includes(q) ||
        t.subcategory.toLowerCase().includes(q) ||
        t.account.toLowerCase().includes(q) ||
        (t.note || "").toLowerCase().includes(q)
      );
    });

    base.sort((a, b) => {
      if (sortKey === "fecha") {
        const da = a.date + " " + a.time;
        const db = b.date + " " + b.time;
        const cmp = da < db ? -1 : da > db ? 1 : 0;
        return sortDir === "Asc" ? cmp : -cmp;
      } else {
        const cmp = a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
        return sortDir === "Asc" ? cmp : -cmp;
      }
    });
    return base;
  }, [tx, search, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageRows = filteredSorted.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const ns = new Set(s);
      ns.has(id) ? ns.delete(id) : ns.add(id);
      return ns;
    });
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setTx((t) => t.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    if (userEmail) {
      try {
        await deleteTxCloud(ids);
      } catch (e) {
        console.error(e);
        setCloudMsg("No se pudo borrar en la nube");
        setTimeout(() => setCloudMsg(null), 1800);
      }
    }
  };
  const deleteAll = async () => {
    if (!confirm("¿Eliminar todos los movimientos?")) return;
    const ids = tx.map((r) => r.id);
    setTx([]);
    setSelectedIds(new Set());
    if (userEmail && ids.length) {
      try {
        await deleteTxCloud(ids);
      } catch (e) {
        console.error(e);
        setCloudMsg("No se pudo borrar en la nube");
        setTimeout(() => setCloudMsg(null), 1800);
      }
    }
  };
  const deleteOne = async (id: string) => {
    setTx((t) => t.filter((r) => r.id !== id));
    setSelectedIds((s) => {
      const ns = new Set(s);
      ns.delete(id);
      return ns;
    });
    if (userEmail) {
      try {
        await deleteTxCloud([id]);
      } catch (e) {
        console.error(e);
        setCloudMsg("No se pudo borrar en la nube");
        setTimeout(() => setCloudMsg(null), 1800);
      }
    }
  };

  /* ======= Meses con datos ======= */

  const monthsWithData = useMemo(() => {
    const set = new Set<string>();
    tx.forEach((t) => set.add(t.date.slice(0, 7)));
    const arr = Array.from(set).sort();
    if (arr.length === 0) {
      const cur = new Date().toISOString().slice(0, 7);
      return [cur];
    }
    return arr;
  }, [tx]);

  useEffect(() => {
    if (!monthsWithData.includes(month)) {
      setMonth(monthsWithData[monthsWithData.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsWithData]);

  /* ========================== Datos para Calendario ========================= */

  const calendarCells = useMemo(() => {
    const totalDays = daysInMonth(month);
    const offset = startDow(month);
    const cells: Array<{
      date?: string;
      ingresos?: number;
      gastos?: number;
      transfer?: number;
      items?: Tx[];
    }> = [];

    for (let i = 0; i < offset; i++) cells.push({});

    for (let d = 1; d <= totalDays; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const dayTx = tx.filter((t) => t.date === date);
      const ingresos =
        dayTx
          .filter((t) => t.type === "Ingreso" && t.account !== "TC Rappi")
          .reduce((s, t) => s + t.amount, 0) || 0;
      const gastos =
        dayTx
          .filter((t) => t.type === "Gasto")
          .reduce((s, t) => s + Math.abs(t.amount), 0) || 0;
      const transfer =
        dayTx
          .filter((t) => t.type === "Transferencia")
          .reduce((s, t) => s + Math.abs(t.amount), 0) || 0;

      cells.push({
        date,
        ingresos,
        gastos,
        transfer,
        items: dayTx,
      });
    }

    while (cells.length % 7 !== 0) cells.push({});
    return cells;
  }, [tx, month]);

  /* ========= Estado del modal de día ========= */

  const [dayModal, setDayModal] = useState<{
    date: string;
    items: Tx[];
  } | null>(null);

  /* ================================= Render ================================= */

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      {/* estilos globales */}
      <DesignStyles />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-slate-950/70 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="w-full px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-900 grid place-items-center font-semibold">
              F
            </div>
            <h1 className="text-base sm:text-lg font-semibold">Finanzas — Jader</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HeaderBtn onClick={() => setShowTags(true)}>🏷️ Etiquetas</HeaderBtn>

            <HeaderBtn
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify({ tx, tags, budget }, null, 2)],
                  { type: "application/json" }
                );
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "finanzas_jader.json";
                a.click();
              }}
            >
              ⬇️ Exportar
            </HeaderBtn>

            {/* Guardar SOLO ajustes en la nube */}
            <HeaderBtn
              onClick={async () => {
                try {
                  setCloudBusy(true);
                  await saveSettings({ tags, budget });
                  setCloudMsg("Ajustes guardados en la nube");
                  setTimeout(() => setCloudMsg(null), 2000);
                } catch (err) {
                  setCloudMsg("Error al guardar ajustes");
                  setTimeout(() => setCloudMsg(null), 2500);
                  console.error(err);
                } finally {
                  setCloudBusy(false);
                }
              }}
              title="Guardar etiquetas y presupuesto en Supabase"
            >
              {cloudBusy ? "⏳ Guardando…" : "☁️ Guardar ajustes"}
            </HeaderBtn>

            {/* Sincronizar todo: settings + tx (push y pull) */}
            <HeaderBtn
              onClick={async () => {
                try {
                  setCloudBusy(true);
                  // 1) Ajustes
                  await saveSettings({ tags, budget });
                  // 2) Movimientos -> push
                  await pushTxBulk(
                    tx.map((t) => ({
                      id: t.id,
                      type: t.type,
                      account: t.account,
                      to_account: t.toAccount || null,
                      date: t.date,
                      time: t.time,
                      amount: t.amount,
                      category: t.category,
                      subcategory: t.subcategory,
                      note: t.note || null,
                    }))
                  );
                  // 3) Pull para confirmar
                  const cloudTx = await pullTx();
                  const mapped: Tx[] = (cloudTx || []).map((r: any) => ({
                    id: r.id,
                    type: r.type,
                    account: r.account as Account,
                    toAccount: (r.to_account as Account) || "",
                    date: r.date,
                    time: r.time,
                    amount: Number(r.amount),
                    category: r.category,
                    subcategory: r.subcategory,
                    note: r.note || "",
                  }));
                  if (mapped.length) setTx(mapped);
                  setCloudMsg("Sincronizado ✅");
                  setTimeout(() => setCloudMsg(null), 1600);
                } catch (e) {
                  console.error(e);
                  setCloudMsg("Error al sincronizar");
                  setTimeout(() => setCloudMsg(null), 2200);
                } finally {
                  setCloudBusy(false);
                }
              }}
              title="Sincroniza ajustes y movimientos con la nube"
            >
              ☁️ Sincronizar todo
            </HeaderBtn>

            {/* Importar desde archivo */}
            <label className="relative overflow-hidden ripple px-2.5 py-1.5 text-xs sm:text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer transition active:scale-[0.98]">
              ⬆️ Importar
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  f.text().then((txt) => {
                    try {
                      const data = JSON.parse(txt);
                      if (Array.isArray(data.tx)) setTx(data.tx);
                      if (data.tags) setTags(data.tags);
                      if (data.budget) setBudget(data.budget);
                    } catch {
                      alert("Archivo inválido");
                    }
                  });
                }}
              />
            </label>

            {/* Modo oscuro */}
            <HeaderBtn
              onClick={() => setDark((d) => !d)}
              title="Modo oscuro / claro"
            >
              {dark ? "☀️ Claro" : "🌙 Oscuro"}
            </HeaderBtn>

            {/* Sesión */}
            {userEmail ? (
              <span className="text-xs sm:text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-700">
                {userEmail}
              </span>
            ) : (
              <HeaderBtn
                onClick={async () => {
                  const email = prompt(
                    "Escribe tu correo para recibir el enlace de inicio de sesión:"
                  );
                  if (!email) return;
                  try {
                    await signInWithEmail(email);
                    alert(
                      "Te envié un enlace a tu correo. Ábrelo y vuelve a esta página."
                    );
                  } catch (e: any) {
                    alert("No se pudo enviar el enlace: " + (e?.message || e));
                  }
                }}
                title="Iniciar sesión por Magic Link"
              >
                ✉️ Iniciar sesión
              </HeaderBtn>
            )}
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto max-w-screen-xl w-full px-3 sm:px-4 py-4 sm:py-5 space-y-4 sm:space-y-6">
        {/* KPIs */}
        <section className="w-full fade-up" style={{ animationDelay: "40ms" }}>
          <div className="flex flex-wrap justify-center gap-3 sm:gap-5 z-0 relative">
            <HeroKpi title="Saldo actual" value={totals.saldoActual} good />
            <HeroKpi title="Ingresos (mes)" value={totals.ingresos} />
            <HeroKpi title="Gastos (mes)" value={-Math.abs(totals.gastos)} danger />
            <HeroKpi title="Ahorro (mes)" value={totals.ahorro} />
          </div>

          <div className="mt-3 sm:mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4 z-0 relative">
            <Kpi title="Banco Davivienda" value={totals.byAccountAllTime["Banco Davivienda"]} />
            <Kpi title="Banco de Bogotá" value={totals.byAccountAllTime["Banco de Bogotá"]} />
            <Kpi title="Nequi" value={totals.byAccountAllTime["Nequi"]} />
            <Kpi title="Rappi" value={totals.byAccountAllTime["Rappi"]} />
            <Kpi title="Efectivo" value={totals.byAccountAllTime["Efectivo"]} />
            <Kpi title="TC Rappi" value={totals.byAccountAllTime["TC Rappi"]} extraClass="text-fuchsia-500" />
          </div>
        </section>

        {/* Tabs */}
        <section className="flex flex-wrap items-center gap-2 fade-up" style={{ animationDelay: "80ms" }}>
          <TabButton active={tab === "capturar"} onClick={() => setTab("capturar")} txt="Capturar" />
          <TabButton active={tab === "transferir"} onClick={() => setTab("transferir")} txt="Transferir" />
          <TabButton active={tab === "presupuesto"} onClick={() => setTab("presupuesto")} txt="Presupuesto" />
          <TabButton active={tab === "calendario"} onClick={() => setTab("calendario")} txt="Calendario" />
          <TabButton active={tab === "tabla"} onClick={() => setTab("tabla")} txt="Tabla" />

          <div className="ms-auto flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <label className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">Mes</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
            >
              {monthsWithData.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* CAPTURAR */}
        {tab === "capturar" && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5">
            <div className="lg:col-span-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up">
              <h3 className="font-medium mb-3">Nueva transacción</h3>
              <div className="grid grid-cols-1 gap-2 sm:gap-3">
                <Row>
                  <Select
                    value={form.type}
                    onChange={(v) => setForm((f) => ({ ...f, type: v as TxType }))}
                    options={["Ingreso", "Gasto"]}
                  />
                  <input
                    type="date"
                    className="px-3 py-2 sm:py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </Row>

                <Row>
                  <Select
                    value={form.account}
                    onChange={(v) => setForm((f) => ({ ...f, account: v as Account }))}
                    options={ACCOUNTS}
                  />
                  <MoneyInput
                    value={form.amountRaw}
                    onChange={(raw) => setForm((f) => ({ ...f, amountRaw: raw }))}
                    placeholder="Monto (COP)"
                  />
                </Row>

                <Row>
                  <Select
                    value={form.category}
                    onChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        category: v,
                        subcategory: (tags[v] || [])[0] || "",
                      }))
                    }
                    options={Object.keys(tags)}
                  />
                  <Select
                    value={form.subcategory}
                    onChange={(v) => setForm((f) => ({ ...f, subcategory: v }))}
                    options={availableSubcats}
                  />
                </Row>

                <input
                  className="px-3 py-2 sm:py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                  placeholder="Nota (opcional)"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                />

                <div className="flex items-center gap-2">
                  <PrimaryBtn onClick={handleAdd}>＋ Agregar</PrimaryBtn>
                  <GhostBtn
                    onClick={() =>
                      setForm({
                        type: "Ingreso",
                        account: "Banco Davivienda",
                        toAccount: "" as Account | "",
                        date: new Date().toISOString().slice(0, 10),
                        amountRaw: "",
                        category: "Ingresos",
                        subcategory: "Salario",
                        note: "",
                      })
                    }
                  >
                    Limpiar
                  </GhostBtn>
                </div>
              </div>
            </div>

            {/* Charts */}
            <div className="lg:col-span-8 grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-medium">
                    {view === "categoria"
                      ? "Gasto por categoría"
                      : view === "cuenta"
                      ? "Gasto por cuenta"
                      : `Subcategorías — ${selectedCat || "selecciona una categoría"}`}
                  </h3>
                  {view === "subcategoria" && (
                    <GhostBtn onClick={() => setView("categoria")}>← Volver</GhostBtn>
                  )}
                </div>
                <div className="h-56 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analyticsData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={100}
                        label={(v: any) => fmtCOP(v.value as number)}
                        onClick={(d: any) => {
                          if (view === "categoria" && d?.name) {
                            setSelectedCat(d.name);
                            setView("subcategoria");
                          }
                        }}
                      >
                        {analyticsData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <RTooltip formatter={(v: any) => fmtCOP(v as number)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up" style={{ animationDelay: "60ms" }}>
                <h3 className="font-medium mb-3">Evolución (6 meses)</h3>
                <div className="h-56 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={byMonth}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(v) => fmtTick(v)} />
                      <Legend />
                      <RTooltip formatter={(v: any) => fmtCOP(v as number)} />
                      <Line dataKey="ingresos" stroke="#2563EB" />
                      <Line dataKey="gastos" stroke="#ef4444" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up" style={{ animationDelay: "100ms" }}>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                  <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
                    <ToggleBtn active={view === "categoria"} onClick={() => setView("categoria")} txt="Categoría" />
                    <ToggleBtn active={view === "subcategoria"} onClick={() => setView("subcategoria")} txt="Subcategoría" />
                    <ToggleBtn active={view === "cuenta"} onClick={() => setView("cuenta")} txt="Cuenta" />
                  </div>

                  <Select
                    value={accFilter}
                    onChange={(v) => setAccFilter(v as AccountFilter)}
                    options={["Todas", ...ACCOUNTS]}
                    label="Cuenta"
                  />

                  <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
                    <ToggleBtn active={timeMode === "mes"} onClick={() => setTimeMode("mes")} txt="Mes actual" />
                    <ToggleBtn active={timeMode === "rango"} onClick={() => setTimeMode("rango")} txt="Rango" />
                  </div>

                  {timeMode === "rango" && (
                    <>
                      <label className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                        Desde
                      </label>
                      <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                      />
                      <label className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                        Hasta
                      </label>
                      <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                      />
                    </>
                  )}

                  <GhostBtn
                    className="ms-auto"
                    onClick={() => {
                      setView("categoria");
                      setSelectedCat("");
                      setAccFilter("Todas");
                      setTimeMode("mes");
                      setFrom(firstDayOfMonth(month));
                      setTo(lastDayOfMonth(month));
                    }}
                  >
                    Limpiar filtros
                  </GhostBtn>
                </div>

                <h3 className="font-medium mb-2">
                  {view === "categoria"
                    ? "Gasto por categoría"
                    : view === "cuenta"
                    ? "Gasto por cuenta"
                    : `Subcategorías — ${selectedCat || "selecciona una categoría"}`}
                </h3>
                <div className="h-56 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analyticsData}
                      onClick={(d: any) => {
                        if (view === "categoria") {
                          const name =
                            d?.activePayload?.[0]?.payload?.name ?? undefined;
                          if (name) {
                            setSelectedCat(name);
                            setView("subcategoria");
                          }
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={(v) => fmtTick(v)} />
                      <RTooltip formatter={(v: any) => fmtCOP(v as number)} />
                      <Bar dataKey="value" fill="#60a5fa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[11px] sm:text-xs text-slate-500 mt-2">
                  Cambia la vista (Categoría / Subcategoría / Cuenta) y el alcance (Mes / Rango).
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TRANSFERIR */}
        {tab === "transferir" && (
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up">
            <h3 className="font-medium mb-4">Transferencia entre cuentas</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              <Select
                value={trf.from}
                onChange={(v) => setTrf((f) => ({ ...f, from: v as Account }))}
                options={ACCOUNTS}
                label="Desde"
              />
              <Select
                value={trf.to}
                onChange={(v) => setTrf((f) => ({ ...f, to: v as Account }))}
                options={ACCOUNTS.filter((a) => a !== trf.from)}
                label="Hacia"
              />
              <MoneyInput
                value={trf.amountRaw}
                onChange={(raw) => setTrf((f) => ({ ...f, amountRaw: raw }))}
                placeholder="Monto (COP)"
              />
              <input
                type="date"
                className="px-3 py-2 sm:py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                value={trf.date}
                onChange={(e) => setTrf((f) => ({ ...f, date: e.target.value }))}
              />
              <div className="sm:col-span-2">
                <PrimaryBtn onClick={handleTransfer}>Transferir</PrimaryBtn>
              </div>
            </div>
          </section>
        )}

        {/* PRESUPUESTO */}
        {tab === "presupuesto" && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up">
              <h3 className="font-medium mb-3">Presupuesto mensual</h3>
              <div className="grid grid-cols-1 gap-3">
                <BudgetRow
                  label="Gastos Básicos"
                  value={budget.basicos}
                  onChange={(v) => setBudget((b) => ({ ...b, basicos: v }))}
                />
                <BudgetRow
                  label="Deseos"
                  value={budget.deseos}
                  onChange={(v) => setBudget((b) => ({ ...b, deseos: v }))}
                />
                <BudgetRow
                  label="Ahorro"
                  value={budget.ahorro}
                  onChange={(v) => setBudget((b) => ({ ...b, ahorro: v }))}
                />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up" style={{ animationDelay: "60ms" }}>
              <h3 className="font-medium mb-3">Real vs plan (mes)</h3>
              <div className="h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      {
                        name: "Gastos Básicos",
                        real:
                          txOfMonth
                            .filter((t) => t.category === "Gastos Básicos" && t.type === "Gasto")
                            .reduce((s, t) => s + Math.abs(t.amount), 0) || 0,
                        plan: budget.basicos,
                      },
                      {
                        name: "Deseos",
                        real:
                          txOfMonth
                            .filter((t) => t.category === "Deseos" && t.type === "Gasto")
                            .reduce((s, t) => s + Math.abs(t.amount), 0) || 0,
                        plan: budget.deseos,
                      },
                      {
                        name: "Ahorro",
                        real:
                          txOfMonth
                            .filter((t) => t.category === "Ahorro")
                            .reduce((s, t) => s + Math.abs(t.amount), 0) || 0,
                        plan: budget.ahorro,
                      },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(v) => fmtTick(v)} />
                    <Legend />
                    <RTooltip formatter={(v: any) => fmtCOP(v as number)} />
                    <Bar dataKey="real" fill="#60a5fa" />
                    <Bar dataKey="plan" fill="#a78bfa" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}

        {/* CALENDARIO */}
        {tab === "calendario" && (
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Calendario — {month}</h3>
              <div className="text-xs text-slate-500">
                Ingresos en verde · Gastos en rojo · Transferencias en <span className="font-semibold text-blue-600">azul</span>
              </div>
            </div>

            <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500 mb-2">
              <div>Dom</div><div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div><div>Sáb</div>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {calendarCells.map((cell, idx) => {
                if (!cell.date) {
                  return (
                    <div
                      key={idx}
                      className="min-h-[110px] rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-white dark:bg-transparent"
                    />
                  );
                }
                const day = Number(cell.date.slice(-2));
                const clickable = (cell.items || []).length > 0;
                return (
                  <button
                    key={cell.date}
                    onClick={() =>
                      clickable && setDayModal({ date: cell.date!, items: cell.items || [] })
                    }
                    className={`min-h-[110px] rounded-lg border p-2 flex flex-col text-left transition
                      fade-up calendar-cell
                      bg-white dark:bg-slate-900
                      ${clickable
                        ? "border-slate-200 dark:border-slate-700 hover:shadow-lg hover:-translate-y-0.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                        : "border-slate-200/60 dark:border-slate-700/60 opacity-80 cursor-default"}`}
                    style={{ animationDelay: `${(idx % 14) * 20}ms` }}
                  >
                    <div className="text-xs text-slate-500 mb-1">{day}</div>
                    <div className="mt-auto space-y-1 text-xs">
                      <div className="text-emerald-600">
                        {cell.ingresos ? `+ ${fmtCOP(cell.ingresos)}` : ""}
                      </div>
                      <div className="text-rose-600">
                        {cell.gastos ? `- ${fmtCOP(cell.gastos)}` : ""}
                      </div>
                      {cell.transfer ? (
                        <div className="text-blue-600">⇄ {fmtCOP(cell.transfer)}</div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* TABLA */}
        {tab === "tabla" && (
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar…"
                className="px-3 py-2 sm:py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
              <Select
                value={sortKey}
                onChange={(v) => setSortKey(v as any)}
                options={["fecha", "cuenta"]}
                label="Ordenar por"
              />
              <Select
                value={sortDir}
                onChange={(v) => setSortDir(v as any)}
                options={["Asc", "Desc"]}
                label=""
              />

              <div className="ms-auto flex items-center gap-2">
                <DangerGhost onClick={deleteSelected}>Eliminar selección</DangerGhost>
                <GhostBtn onClick={deleteAll}>Eliminar todo</GhostBtn>
              </div>
            </div>

            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <table className="min-w-[900px] w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-300">
                    <th className="py-2 px-2">Sel</th>
                    <th className="py-2 px-2">Fecha</th>
                    <th className="py-2 px-2">Tipo</th>
                    <th className="py-2 px-2">Cuenta</th>
                    <th className="py-2 px-2">Hacia</th>
                    <th className="py-2 px-2">Cat.</th>
                    <th className="py-2 px-2">Subcat.</th>
                    <th className="py-2 px-2">Monto</th>
                    <th className="py-2 px-2">Nota</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-2 px-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        {r.date} <span className="text-slate-400">{r.time}</span>
                      </td>
                      <td className="py-2 px-2">{r.type}</td>
                      <td className="py-2 px-2">{r.account}</td>
                      <td className="py-2 px-2">{r.toAccount || "-"}</td>
                      <td className="py-2 px-2">{r.category}</td>
                      <td className="py-2 px-2">{r.subcategory}</td>
                      <td
                        className={`py-2 px-2 whitespace-nowrap ${
                          r.amount < 0 ? "text-rose-500" : "text-emerald-500"
                        }`}
                      >
                        {fmtCOP(r.amount)}
                      </td>
                      <td className="py-2 px-2">{r.note || "-"}</td>
                      <td className="py-2 px-2">
                        <button
                          onClick={() => deleteOne(r.id)}
                          className="text-rose-500 hover:underline"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-500">
                        Sin datos
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-center gap-2 mt-2 sm:mt-3 text-xs sm:text-sm">
              <GhostBtn onClick={() => setPage((p) => Math.max(1, p - 1))}>◀</GhostBtn>
              <span className="text-slate-600 dark:text-slate-300">
                {page} / {pageCount}
              </span>
              <GhostBtn onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>▶</GhostBtn>
            </div>
          </section>
        )}
      </main>

      {/* Modal etiquetas */}
      {showTags && (
        <TagsModal
          tags={tags}
          onClose={() => setShowTags(false)}
          onChange={setTags}
        />
      )}

      {/* Modal detalle de día */}
      {dayModal && (
        <DayModal
          data={dayModal}
          onClose={() => setDayModal(null)}
        />
      )}

      {/* Toast de nube */}
      {cloudMsg && (
        <div className="fixed bottom-4 right-4 px-3 py-2 rounded-md bg-slate-900 text-white text-sm shadow">
          {cloudMsg}
        </div>
      )}

      {/* Navegación móvil */}
      <nav className="fixed z-40 bottom-3 left-1/2 -translate-x-1/2 sm:hidden">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full px-2 py-1 flex gap-1">
          <TabButton active={tab === "capturar"} onClick={() => setTab("capturar")} txt="Capturar" />
          <TabButton active={tab === "transferir"} onClick={() => setTab("transferir")} txt="Transferir" />
          <TabButton active={tab === "presupuesto"} onClick={() => setTab("presupuesto")} txt="Presupuesto" />
          <TabButton active={tab === "calendario"} onClick={() => setTab("calendario")} txt="Calendario" />
          <TabButton active={tab === "tabla"} onClick={() => setTab("tabla")} txt="Tabla" />
        </div>
      </nav>

      <footer className="px-3 sm:px-4 py-4 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
        Hecho para Jader — Datos guardados en tu navegador (localStorage) y sincronizables con Supabase
      </footer>
    </div>
  );
}

/* ============================== Subcomponentes ============================== */

function HeaderBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const { ref, onMouseDown } = useRipple();
  return (
    <button
      ref={ref}
      onMouseDown={onMouseDown}
      onClick={onClick}
      title={title}
      className="relative ripple px-2.5 py-1.5 text-xs sm:text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function Kpi({
  title,
  value,
  danger,
  good,
  extraClass,
}: {
  title: string;
  value: number;
  danger?: boolean;
  good?: boolean;
  extraClass?: string;
}) {
  const shown = useCountUp(value, 450);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 fade-up">
      <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-300 mb-0.5 sm:mb-1">
        {title}
      </div>
      <div
        className={`text-base sm:text-xl font-semibold ${
          danger ? "text-rose-500" : good ? "text-emerald-500" : ""
        } ${extraClass || ""}`}
      >
        {fmtCOP(shown)}
      </div>
    </div>
  );
}

function FitText({
  text,
  max = 44,
  min = 20,
  className = "",
}: {
  text: string;
  max?: number;
  min?: number;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const [size, setSize] = useState<number>(max);

  const measure = () => {
    const box = boxRef.current;
    const span = spanRef.current;
    if (!box || !span) return;
    let s = max;
    span.style.fontSize = `${s}px`;
    span.style.whiteSpace = "nowrap";
    const limit = Math.max(0, box.clientWidth - 8);
    while (s > min && span.scrollWidth > limit) {
      s -= 1;
      span.style.fontSize = `${s}px`;
    }
    setSize(s);
  };

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [text, max, min]);

  return (
    <div ref={boxRef} className="w-full">
      <span
        ref={spanRef}
        className={`block leading-tight font-extrabold ${className}`}
        style={{ fontSize: size, whiteSpace: "nowrap" }}
      >
        {text}
      </span>
    </div>
  );
}

function FitAmount({
  amount,
  className = "",
  max = 44,
  min = 22,
}: {
  amount: number;
  className?: string;
  max?: number;
  min?: number;
}) {
  const animated = useCountUp(amount, 700);
  return <FitText text={fmtCOP(animated)} className={className} max={max} min={min} />;
}

function HeroKpi({
  title,
  value,
  danger,
  good,
  extraClass,
}: {
  title: string;
  value: number;
  danger?: boolean;
  good?: boolean;
  extraClass?: string;
}) {
  const colorClass =
    danger
      ? "text-rose-600 dark:text-rose-400"
      : good
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-900 dark:text-slate-100";

  return (
    <div
      className="
        relative group flex-1 min-w-[240px] sm:min-w-[260px] max-w-[420px]
        rounded-2xl p-4 sm:p-6 border
        border-slate-200/70 dark:border-slate-700/70
        bg-white/90 dark:bg-slate-900/80
        shadow-xl ring-1 ring-black/5
        transition-all duration-200
        hover:shadow-2xl hover:-translate-y-0.5
      "
    >
      <div
        className="
          pointer-events-none absolute -inset-0.5 rounded-2xl grad-animate
          opacity-0 group-hover:opacity-100 transition-opacity
        "
      />
      <div className="relative">
        <div className="text-[12px] sm:text-sm text-slate-500 dark:text-slate-300 mb-1">
          {title}
        </div>
        <FitAmount amount={value} className={`${colorClass} ${extraClass || ""}`} />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  txt,
}: {
  active: boolean;
  onClick: () => void;
  txt: string;
}) {
  const { ref, onMouseDown } = useRipple();
  return (
    <button
      ref={ref}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={`relative ripple px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs sm:text-sm transition
        active:scale-[0.98]
        ${active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"}`}
    >
      {txt}
    </button>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">{children}</div>;
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly string[] | string[];
  label?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label && (
        <span className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300">
          {label}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="px-3 py-2 sm:py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm transition focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-700"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o || "—"}
          </option>
        ))}
      </select>
    </label>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState<string>(value || "");
  useEffect(() => setLocal(value || ""), [value]);

  const sanitizeTyping = (s: string) => s.replace(/[^\d.,-]/g, "");

  return (
    <input
      value={local}
      onChange={(e) => {
        const v = sanitizeTyping(e.target.value);
        setLocal(v);
        onChange(v);
      }}
      onBlur={() => {
        const pretty = normalizeMoneyInput(local).raw;
        setLocal(pretty);
        onChange(pretty);
      }}
      placeholder={placeholder}
      inputMode="decimal"
      className="px-3 py-2 sm:py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm transition focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-700"
    />
  );
}

function BudgetRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(normalizeMoneyInput(String(value)).raw);
  useEffect(() => setRaw(normalizeMoneyInput(String(value)).raw), [value]);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,220px,1fr] items-center gap-2 sm:gap-3">
      <div className="text-sm text-slate-600 dark:text-slate-300">{label}</div>
      <MoneyInput
        value={raw}
        onChange={(r) => {
          setRaw(r);
          onChange(toNumberFromRaw(r));
        }}
      />
      <div className="text-right">{fmtCOP(value)}</div>
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const { ref, onMouseDown } = useRipple();
  return (
    <button
      ref={ref}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="relative ripple px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const { ref, onMouseDown } = useRipple();
  return (
    <button
      ref={ref}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={`relative ripple px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm transition active:scale-[0.98] ${className}`}
    >
      {children}
    </button>
  );
}

function DangerGhost({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const { ref, onMouseDown } = useRipple();
  return (
    <button
      ref={ref}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="relative ripple px-3 py-2 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-sm transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  txt,
}: {
  active: boolean;
  onClick: () => void;
  txt: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm transition ${
        active ? "bg-slate-900 text-white" : "bg-white dark:bg-slate-800"
      }`}
    >
      {txt}
    </button>
  );
}

function TagsModal({
  tags,
  onChange,
  onClose,
}: {
  tags: Record<string, string[]>;
  onChange: (t: Record<string, string[]>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Record<string, string[]>>(
    () => JSON.parse(JSON.stringify(tags))
  );

  const addCategory = () => {
    const name = prompt("Nombre de la nueva categoría:");
    if (!name) return;
    if (local[name]) return alert("Ya existe");
    setLocal((t) => ({ ...t, [name]: [] }));
  };
  const rename = (k: string) => {
    const nv = prompt("Nuevo nombre:", k);
    if (!nv || nv === k) return;
    const entries = Object.entries(local).map(([kk, vv]) =>
      kk === k ? [nv, vv] : [kk, vv]
    );
    setLocal(Object.fromEntries(entries));
  };
  const addSub = (k: string) => {
    const nv = prompt("Nueva subcategoría:");
    if (!nv) return;
    setLocal((t) => ({ ...t, [k]: [...(t[k] || []), nv] }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm grid place-items-center p-4 z-50">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl transition-transform duration-200">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-medium">Gestionar etiquetas</h3>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
          >
            Cerrar
          </button>
        </div>

        <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {Object.entries(local).map(([cat, subs]) => (
            <div
              key={cat}
              className="border rounded-xl border-slate-200 dark:border-slate-700 p-4 hover:shadow-md transition"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="font-medium">{cat}</div>
                <button
                  onClick={() => rename(cat)}
                  className="text-xs px-2 py-1 rounded-md border bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Renombrar
                </button>
                <button
                  onClick={() => addSub(cat)}
                  className="text-xs px-2 py-1 rounded-md border bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  + Subcat
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {subs.map((s, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 text-sm rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={addCategory}
            className="px-3 py-2 rounded-md border bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            + Nueva categoría
          </button>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button
            onClick={() => {
              onChange(local);
              onClose();
            }}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

function DayModal({
  data,
  onClose,
}: {
  data: { date: string; items: Tx[] };
  onClose: () => void;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = useMemo(
    () =>
      [...data.items].sort((a, b) =>
        a.time < b.time ? 1 : a.time > b.time ? -1 : 0
      ),
    [data.items]
  );

  const totIngreso = items
    .filter((t) => t.type === "Ingreso" && t.account !== "TC Rappi")
    .reduce((s, t) => s + t.amount, 0);
  const totGasto = items
    .filter((t) => t.type === "Gasto")
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const totTrf = items
    .filter((t) => t.type === "Transferencia")
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div
      className={`fixed inset-0 z-[60] grid place-items-center
        bg-black/40 backdrop-blur-sm transition-opacity duration-200
        ${show ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
      aria-modal
      role="dialog"
    >
      <div
        className={`w-full max-w-3xl mx-4 bg-white dark:bg-slate-900 rounded-2xl
          border border-slate-200 dark:border-slate-700 shadow-2xl
          transform transition-all duration-200
          ${show ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-500">Detalle del día</div>
            <div className="text-lg font-semibold">{data.date}</div>
          </div>
          <GhostBtn onClick={onClose}>Cerrar ✕</GhostBtn>
        </div>

        <div className="px-5 py-3 flex flex-wrap gap-2">
          <Badge tone="emerald">Ingresos: {fmtCOP(totIngreso)}</Badge>
          <Badge tone="rose">Gastos: {fmtCOP(totGasto)}</Badge>
          <Badge tone="blue">Transferencias: {fmtCOP(totTrf)}</Badge>
          <Badge tone="slate">Movimientos: {items.length}</Badge>
        </div>

        <div className="px-5 pb-5 max-h-[60vh] overflow-y-auto space-y-2">
          {items.length === 0 && (
            <div className="text-sm text-slate-500 py-8 text-center">
              Sin movimientos este día.
            </div>
          )}

          {items.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      t.type === "Ingreso"
                        ? "bg-emerald-500"
                        : t.type === "Gasto"
                        ? "bg-rose-500"
                        : "bg-blue-500"
                    }`}
                  />
                  <div className="font-medium">
                    {t.type} — {t.account}
                  </div>
                </div>
                <div
                  className={`text-sm font-semibold ${
                    t.amount < 0 ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  {fmtCOP(t.amount)}
                </div>
              </div>

              <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-2">
                <span>{t.time}</span>
                <span>·</span>
                <span>
                  {t.category}
                  {t.subcategory ? ` / ${t.subcategory}` : ""}
                </span>
                {t.toAccount ? (
                  <>
                    <span>·</span>
                    <span>→ {t.toAccount}</span>
                  </>
                ) : null}
              </div>

              {t.note && (
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                  {t.note}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "emerald" | "rose" | "blue" | "slate";
}) {
  const map = {
    emerald:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-900",
    rose:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-200 dark:border-rose-900",
    blue:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-900",
    slate:
      "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  } as const;
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs border ${map[tone]} select-none`}
    >
      {children}
    </span>
  );
}

/* ============================== Estilos extra ============================== */
function DesignStyles() {
  return (
    <style>{`
    .fade-up { animation: fadeUp .38s ease both; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }

    .grad-animate {
      background: linear-gradient(135deg, rgba(16,185,129,.16), rgba(59,130,246,.14), rgba(168,85,247,.16));
      background-size: 200% 200%;
      filter: blur(14px);
      animation: gradientShift 8s ease infinite;
    }
    @keyframes gradientShift {
      0% { background-position: 0% 50% }
      50% { background-position: 100% 50% }
      100% { background-position: 0% 50% }
    }

    .ripple { overflow: hidden; }
    .ripple.has-ripple::after,
    .ripple:active::after {
      content: "";
      position: absolute;
      left: var(--x, 50%);
      top: var(--y, 50%);
      width: 1px; height: 1px;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle, rgba(255,255,255,.35) 0%, rgba(255,255,255,0) 60%);
      animation: ripple 500ms ease-out;
      pointer-events: none;
      aspect-ratio: 1;
    }

    .calendar-cell { will-change: transform, opacity; }
  `}</style>
  );
}

/* ================================= Helpers ================================= */

function fmtTick(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} MM`;
  if (abs >= 1000) return `${Math.round(v / 1000)} mil`;
  return fmtCOP(v);
}
