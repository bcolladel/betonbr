// Minimal Framer Motion shim — covers the subset used by the app:
// motion.<tag> with props: initial, animate, whileHover, whileTap, whileInView,
// transition, viewport, variants, style
// Plus useScroll/useSpring approximations for the progress bar.

const { useState, useEffect, useRef, useContext, createContext, forwardRef } = React;

const HoverContext = createContext(null);

// Resolve a value: either a direct object OR a string key into variants
function resolveVariant(value, variants) {
  if (!value) return null;
  if (typeof value === "string") return variants?.[value] || null;
  return value;
}

// Convert "motion values" (x, y, scale, rotate) into a transform string.
// Returns { transform, rest } where rest is the remaining CSS-safe props.
function splitTransform(obj) {
  if (!obj) return { transform: undefined, rest: {} };
  const { x, y, scale, scaleX, rotate, ...rest } = obj;
  const parts = [];
  if (x !== undefined && typeof x !== "object") parts.push(`translateX(${typeof x === "number" ? x + "px" : x})`);
  if (y !== undefined && typeof y !== "object") parts.push(`translateY(${typeof y === "number" ? y + "px" : y})`);
  if (scale !== undefined && typeof scale !== "object") parts.push(`scale(${scale})`);
  if (scaleX !== undefined && typeof scaleX !== "object") parts.push(`scaleX(${scaleX})`);
  if (rotate !== undefined && typeof rotate !== "object") parts.push(`rotate(${typeof rotate === "number" ? rotate + "deg" : rotate})`);
  return { transform: parts.length ? parts.join(" ") : undefined, rest };
}

// Detect if any value in obj is an array (keyframe sequence)
function hasKeyframes(obj) {
  if (!obj) return false;
  return Object.values(obj).some((v) => Array.isArray(v));
}

// Build a CSS @keyframes string + animation shorthand for keyframe-style animate.
// We register dynamic @keyframes into a singleton <style id="__motion_keyframes">.
let kfCounter = 0;
function ensureStyleEl() {
  let el = document.getElementById("__motion_keyframes");
  if (!el) {
    el = document.createElement("style");
    el.id = "__motion_keyframes";
    document.head.appendChild(el);
  }
  return el;
}
const kfCache = new Map();

function buildKeyframes(obj, transition = {}) {
  const key = JSON.stringify({ obj, transition });
  if (kfCache.has(key)) return kfCache.get(key);
  const name = "__mkf_" + (++kfCounter);
  // Find max array length to determine number of stops
  const stops = Math.max(...Object.values(obj).map((v) => (Array.isArray(v) ? v.length : 1)));
  const lines = [];
  for (let i = 0; i < stops; i++) {
    const pct = ((i / (stops - 1)) * 100).toFixed(2) + "%";
    const frame = {};
    for (const [k, v] of Object.entries(obj)) {
      frame[k] = Array.isArray(v) ? v[i] : v;
    }
    const { transform, rest } = splitTransform(frame);
    const decls = [];
    if (transform) decls.push(`transform: ${transform};`);
    for (const [k, v] of Object.entries(rest)) {
      const css = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      decls.push(`${css}: ${v};`);
    }
    lines.push(`${pct} { ${decls.join(" ")} }`);
  }
  const css = `@keyframes ${name} { ${lines.join(" ")} }`;
  ensureStyleEl().appendChild(document.createTextNode(css));
  const dur = transition.duration ?? 1;
  const repeat = transition.repeat === Infinity ? "infinite" : (transition.repeat || 1);
  const ease = transition.ease === "linear" ? "linear" : "ease-in-out";
  const anim = `${name} ${dur}s ${ease} ${repeat}`;
  kfCache.set(key, anim);
  return anim;
}

function buildTransition(transition = {}) {
  // Spring → approximate as ease-out
  if (transition.type === "spring") {
    return `all ${transition.duration || 0.4}s cubic-bezier(0.34, 1.56, 0.64, 1)`;
  }
  if (transition.duration === 0) return "none";
  const dur = transition.duration || 0.4;
  const ease = Array.isArray(transition.ease)
    ? `cubic-bezier(${transition.ease.join(",")})`
    : "cubic-bezier(0.23, 1, 0.32, 1)";
  const delay = transition.delay ? ` ${transition.delay}s` : "";
  return `all ${dur}s ${ease}${delay}`;
}

function createMotion(tag) {
  return forwardRef(function MotionEl(props, ref) {
    const {
      initial,
      animate,
      whileHover,
      whileTap,
      whileInView,
      transition,
      viewport,
      variants,
      style,
      children,
      onMouseEnter,
      onMouseLeave,
      onMouseDown,
      onMouseUp,
      ...rest
    } = props;

    const localRef = useRef(null);
    const setRef = (el) => {
      localRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };

    const [hovered, setHovered] = useState(false);
    const [tapped, setTapped] = useState(false);
    const [inView, setInView] = useState(!whileInView);
    const parentHover = useContext(HoverContext);

    useEffect(() => {
      if (!whileInView || inView) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setInView(true);
            obs.disconnect();
          }
        },
        { rootMargin: viewport?.margin || "0px" }
      );
      if (localRef.current) obs.observe(localRef.current);
      return () => obs.disconnect();
    }, []);

    // Resolve hover from local or inherited parent context
    const isHoverActive = whileHover ? hovered : (parentHover && typeof whileHover === "undefined") ? false : false;

    // Decide the active animation state
    let activeState = initial ? { ...initial } : {};
    if (whileInView) {
      if (inView) activeState = { ...activeState, ...whileInView };
    } else if (animate) {
      // animate can be an object or contain keyframe arrays
      if (typeof animate === "object" && !Array.isArray(animate)) {
        activeState = { ...activeState, ...animate };
      }
    }

    // Apply variant from parent hover context
    if (parentHover && variants && variants[parentHover]) {
      activeState = { ...activeState, ...variants[parentHover] };
    }

    // Apply whileHover (object form only — string is handled via context)
    if (typeof whileHover === "object" && hovered) {
      activeState = { ...activeState, ...whileHover };
    }
    if (typeof whileTap === "object" && tapped) {
      activeState = { ...activeState, ...whileTap };
    }

    // Detect keyframes in animate; if present, switch to CSS animation
    const useKeyframes = animate && hasKeyframes(animate);
    let animationCSS;
    if (useKeyframes) {
      animationCSS = buildKeyframes(animate, transition || {});
      // For keyframe mode, strip from activeState anything that's part of the keyframes
      for (const k of Object.keys(animate)) {
        if (Array.isArray(animate[k])) delete activeState[k];
      }
    }

    const { transform, rest: restStyle } = splitTransform(activeState);
    const computedStyle = {
      ...style,
      ...restStyle,
      transform: transform || (style && style.transform),
      transition: buildTransition(transition),
      animation: animationCSS,
    };

    const handlers = {};
    if (whileHover !== undefined || variants) {
      handlers.onMouseEnter = (e) => { setHovered(true); onMouseEnter && onMouseEnter(e); };
      handlers.onMouseLeave = (e) => { setHovered(false); onMouseLeave && onMouseLeave(e); };
    } else {
      if (onMouseEnter) handlers.onMouseEnter = onMouseEnter;
      if (onMouseLeave) handlers.onMouseLeave = onMouseLeave;
    }
    if (whileTap) {
      handlers.onMouseDown = (e) => { setTapped(true); onMouseDown && onMouseDown(e); };
      handlers.onMouseUp = (e) => { setTapped(false); onMouseUp && onMouseUp(e); };
    } else {
      if (onMouseDown) handlers.onMouseDown = onMouseDown;
      if (onMouseUp) handlers.onMouseUp = onMouseUp;
    }

    // If whileHover is a string, provide context so children can pick up the named variant
    const hoverKey = typeof whileHover === "string" ? (hovered ? whileHover : null) : null;

    const Tag = tag;
    const el = React.createElement(
      Tag,
      { ref: setRef, style: computedStyle, ...rest, ...handlers },
      children
    );

    if (typeof whileHover === "string" || variants) {
      return React.createElement(HoverContext.Provider, { value: hoverKey }, el);
    }
    return el;
  });
}

const motion = new Proxy(
  {},
  {
    get(target, prop) {
      if (!target[prop]) target[prop] = createMotion(prop);
      return target[prop];
    },
  }
);

// useScroll: returns a {scrollYProgress} object with .get() returning current 0..1
function useScroll() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const fn = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? window.scrollY / max : 0);
    };
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    window.addEventListener("resize", fn);
    return () => {
      window.removeEventListener("scroll", fn);
      window.removeEventListener("resize", fn);
    };
  }, []);
  return { scrollYProgress: progress };
}

// useSpring: pass-through here (smoothing not critical)
function useSpring(value) {
  return value;
}

window.motion = motion;
window.useScroll = useScroll;
window.useSpring = useSpring;


// Inline SVG icons — substitutes for lucide-react.
// Common props: { size = 24, color = "currentColor", style }

function makeIcon(paths) {
  return function Icon({ size = 24, color = "currentColor", style = {}, ...rest }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block", flexShrink: 0, ...style }}
        {...rest}
        dangerouslySetInnerHTML={{ __html: paths }}
      />
    );
  };
}

const ArrowRight   = makeIcon('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>');
const Terminal     = makeIcon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>');
const Layers       = makeIcon('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>');
const CreditCard   = makeIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>');
const Fingerprint  = makeIcon('<path d="M2 12a10 10 0 0 1 18-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M12 22c-1.5-2.5-2-4-2-6.5a2 2 0 0 1 4 0c0 2.5-.5 4-2 6.5"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/><path d="M16 16.5c0 1.5-.5 3-1 4"/>');
const Gavel        = makeIcon('<path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/><path d="M3 21h7"/>');
const Scale        = makeIcon('<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>');
const Award        = makeIcon('<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>');
const Users        = makeIcon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');
const Eye          = makeIcon('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>');
const MapPin       = makeIcon('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>');
const Check        = makeIcon('<polyline points="20 6 9 17 4 12"/>');
const ChevronDown  = makeIcon('<polyline points="6 9 12 15 18 9"/>');
const Shield       = makeIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>');
const Database     = makeIcon('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>');
const BarChart2    = makeIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6"  y1="20" x2="6"  y2="14"/>');

Object.assign(window, {
  ArrowRight, Terminal, Layers, CreditCard, Fingerprint, Gavel, Scale,
  Award, Users, Eye, MapPin, Check, ChevronDown, Shield, Database, BarChart2
});


// Bet ON Brasil · Tech Edition — landing page
// Ported from BetONBrasil.jsx with motion shim + inline icons.
// Font subs: 'Space Grotesk' (Firs Neue), 'Inter' (Gotham), 'JetBrains Mono'.
// useState/useEffect/useRef already destructured in motion.jsx (shared global scope).

const T = {
  surface: "#0e1620",
  surface2: "#111b28",
  card: "rgba(255,255,255,0.035)",
  border: "rgba(255,255,255,0.07)",
  borderHov: "rgba(73,253,227,0.45)",
  teal: "#49fde3",
  tealDim: "rgba(73,253,227,0.12)",
  blue: "#02b7de",
  purple: "#8b5cf6",
  text: "#dbe3f1",
  muted: "#94a3b8",
  grad: "linear-gradient(135deg,#49fde3 0%,#02b7de 45%,#8b5cf6 100%)"
};

const HEAD_FF = "'Space Grotesk',sans-serif";
const BODY_FF = "'Inter',sans-serif";
const MONO_FF = "'JetBrains Mono',monospace";

const spring = { type: "spring", stiffness: 260, damping: 28, duration: 0.4 };
const springFast = { type: "spring", stiffness: 400, damping: 32, duration: 0.3 };

const LOGO_URL = "assets/logo.svg";

// ── Primitives ────────────────────────────────────────────────────────────

const Reveal = ({ children, delay = 0, y = 32, className = "" }) =>
React.createElement(
  motion.div,
  {
    className,
    initial: { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-60px" },
    transition: { duration: 0.85, ease: [0.23, 1, 0.32, 1], delay }
  },
  children
);

const Glass = ({ children, style = {}, hoverGlow = true }) =>
React.createElement(
  motion.div,
  {
    whileHover: hoverGlow ?
    { y: -10, scale: 1.02, borderColor: T.borderHov, boxShadow: "0 24px 48px -12px rgba(73,253,227,0.12)" } :
    undefined,
    transition: spring,
    style: {
      background: T.card,
      backdropFilter: "blur(28px)",
      WebkitBackdropFilter: "blur(28px)",
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      ...style
    }
  },
  children
);

const Pill = ({ children }) =>
<span style={{
  display: "inline-block", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase",
  color: T.teal, padding: "6px 14px", border: "1px solid rgba(73,253,227,0.22)",
  borderRadius: 999, background: "rgba(73,253,227,0.06)", marginBottom: 20,
  fontFamily: HEAD_FF, fontWeight: 500
}}>{children}</span>;


const GradText = ({ children }) =>
<span style={{
  background: T.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  backgroundClip: "text"
}}>{children}</span>;


// ── Custom cursor ─────────────────────────────────────────────────────────

function CustomCursor() {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [follow, setFollow] = useState({ x: -100, y: -100 });
  const [hover, setHover] = useState(false);
  const rafRef = useRef();
  useEffect(() => {
    let tx = -100,ty = -100,fx = -100,fy = -100;
    const onMove = (e) => {
      tx = e.clientX;ty = e.clientY;
      setPos({ x: tx, y: ty });
      setHover(!!e.target.closest("a,button,select,input,textarea,label"));
    };
    window.addEventListener("mousemove", onMove);
    const tick = () => {
      fx += (tx - fx) * 0.12;fy += (ty - fy) * 0.12;
      setFollow({ x: fx, y: fy });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);
  return (
    <>
      <div style={{
        position: "fixed", top: 0, left: 0, width: 6, height: 6, borderRadius: "50%",
        pointerEvents: "none", zIndex: 99999,
        transform: `translate(${pos.x - 3}px, ${pos.y - 3}px) scale(${hover ? 4 : 1})`,
        background: hover ? "rgba(73,253,227,0.25)" : T.teal,
        transition: "transform 0.08s, background 0.15s"
      }} />
      <div style={{
        position: "fixed", top: 0, left: 0, width: 40, height: 40, borderRadius: "50%",
        border: `1px solid ${hover ? T.teal : "rgba(73,253,227,0.3)"}`,
        pointerEvents: "none", zIndex: 99998,
        transform: `translate(${follow.x - 20}px, ${follow.y - 20}px) scale(${hover ? 1.6 : 1})`,
        transition: "border-color 0.15s"
      }} />
    </>);

}

// ── Scroll progress bar ───────────────────────────────────────────────────

function ProgressBar() {
  const { scrollYProgress } = useScroll();
  return (
    <div style={{
      transform: `scaleX(${scrollYProgress})`, transformOrigin: "left",
      position: "fixed", top: 0, left: 0, right: 0, height: 2,
      background: T.grad, zIndex: 10001
    }} />);

}

// ── Decorative noise overlay ──────────────────────────────────────────────

const Noise = () =>
<div style={{
  position: "fixed", inset: 0, zIndex: 9990, pointerEvents: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
  opacity: 0.04
}} />;


// ── Marquee styles ────────────────────────────────────────────────────────

const FADE_L = (bg) => ({ position: "absolute", left: 0, top: 0, bottom: 0, width: 120, background: `linear-gradient(90deg,${bg},transparent)`, zIndex: 2, pointerEvents: "none" });
const FADE_R = (bg) => ({ position: "absolute", right: 0, top: 0, bottom: 0, width: 120, background: `linear-gradient(270deg,${bg},transparent)`, zIndex: 2, pointerEvents: "none" });

// ── App ───────────────────────────────────────────────────────────────────

function App() {
  const [navScrolled, setNavScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 600);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const fn = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Lead form submit handler — show success message
  useEffect(() => {
    const form = document.getElementById("leadForm");
    if (!form) return;
    const handler = async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
      const nome = (form.nome ? form.nome.value : "").trim();
      const empresa = (form.empresa ? form.empresa.value : "").trim();
      const email = (form.email ? form.email.value : "").trim();
      const telefone = (form.telefone ? form.telefone.value : "").trim();
      const interesse = form.interesse ? form.interesse.value : "";
      const evento = form.evento_interesse ? form.evento_interesse.value : "";
      const emailOk = form.email_consent ? form.email_consent.checked : false;
      const lgpd = form.info ? form.info.checked : false;
      if (!nome || !email) {
        if (btn) { btn.disabled = false; btn.textContent = "Quero receber informações →"; }
        alert("Por favor, preencha nome e e-mail.");
        return;
      }
      const parts = nome.split(" ");
      try {
        await fetch("https://api.hsforms.com/submissions/v3/integration/submit/44677090/7b98c46d-77c8-40b2-88fd-6aeb4d1b4869", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: [
              { name: "firstname", value: parts[0] || "" },
              { name: "lastname", value: parts.slice(1).join(" ") },
              { name: "email", value: email },
              { name: "company", value: empresa },
              { name: "phone", value: telefone },
              { name: "message", value: "Interesse: " + interesse + " | Evento: " + evento + " | Email: " + (emailOk?"sim":"nao") + " | LGPD: " + (lgpd?"sim":"nao") }
            ],
            context: { pageUri: "https://betonbr.com", pageName: "Bet ON Brasil: Tech Edition" }
          })
        });
        await fetch("https://formspree.io/f/xvgrzpow", {
          method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ nome, email, empresa, telefone, interesse, evento, emailOk, lgpd })
        });
      } catch(err) { console.error("Form:", err); }
      document.getElementById("formOk").style.display = "block";
      form.reset();
      if (btn) btn.textContent = "✓ Enviado!";
    };
    form.addEventListener("submit", handler);
    return () => form.removeEventListener("submit", handler);
  });

  const logoImg = (h = 28) =>
  <img src={LOGO_URL} alt="Bet ON Brasil"
  style={{ height: h, width: "auto", maxWidth: 200, objectFit: "contain", display: "block", flexShrink: 0, padding: "0px", opacity: "1" }} />;


  return (
    <div style={{
      background: T.surface, color: T.text, minHeight: "100vh",
      fontFamily: BODY_FF, fontWeight: 400, overflowX: "hidden"
    }}>
      <CustomCursor /><Noise /><ProgressBar />

      {/* NAV */}
      <motion.header
        animate={{
          backgroundColor: navScrolled ? "rgba(14,22,32,0.92)" : "rgba(14,22,32,0)",
          borderBottomColor: navScrolled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0)"
        }}
        transition={{ duration: 0.3 }}
        style={{
          position: "fixed", top: 0, width: "100%", zIndex: 1000,
          backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
          borderBottom: "1px solid rgba(255,255,255,0)"
        }}>
        
        <nav style={{ display: "flex", alignItems: "center", justifyContent: isMobile ? "center" : "space-between", padding: isMobile ? "14px 20px" : "18px 48px", maxWidth: 1600, margin: "0 auto", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            {logoImg(28)}
            <span style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.teal, padding: "3px 9px", border: "1px solid rgba(73,253,227,0.22)", borderRadius: 999, fontFamily: MONO_FF, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }}>Tech Edition</span>
          </div>
          <div style={{ display: isMobile ? "none" : "flex", gap: 28, alignItems: "center", flex: 1, justifyContent: "center" }}>
            {["Momento", "Objetivos", "Público", "Debates"].map((l) =>
            <a key={l} href={l === "Momento" ? "#momento" : ("#" + l.toLowerCase())}
            style={{ color: T.muted, fontSize: 11.5, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: HEAD_FF, textDecoration: "none", transition: "color 0.2s", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => e.target.style.color = T.teal}
            onMouseLeave={(e) => e.target.style.color = T.muted}>
              {l}</a>
            )}
          </div>
          <motion.a href="https://lu.ma/p8ejs7fm" target="_blank" rel="noopener noreferrer" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
          style={{ display: isMobile ? "none" : "inline-flex", alignItems: "center", background: T.grad, color: T.surface, padding: "10px 22px", borderRadius: 999, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0, fontFamily: HEAD_FF }}>
            Ingressos</motion.a>
        </nav>
      </motion.header>

      <main>

        {/* HERO */}
        <section id="momento" style={{ minHeight: isMobile ? "100svh" : "100vh", display: "flex", alignItems: "center", padding: isMobile ? "100px 20px 48px" : "120px 64px 80px", position: "relative", overflow: "hidden" }}>
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.06, pointerEvents: "none" }} xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#49fde3" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          <div style={{ position: "absolute", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle,rgba(73,253,227,0.08),transparent 70%)", top: -200, left: -200, pointerEvents: "none" }} />
          <div style={{ position: "absolute", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle,rgba(139,92,246,0.08),transparent 70%)", bottom: -100, right: -100, pointerEvents: "none" }} />
          <div style={{ maxWidth: 1600, width: "100%", margin: "0 auto", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "center" : "flex-end", gap: isMobile ? 32 : 48 }}>
            <div style={{ flex: isMobile ? "unset" : "0 0 74%", width: "100%", textAlign: isMobile ? "center" : "left" }}>
              <Reveal delay={0.1}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 999, background: "rgba(73,253,227,0.07)", border: "1px solid rgba(73,253,227,0.2)", marginBottom: 36, fontSize: 13, color: T.teal, fontFamily: BODY_FF }}>
                  <span style={{ width: 7, height: 7, background: T.teal, borderRadius: "50%", boxShadow: "0 0 12px rgba(73,253,227,0.7)", animation: "pulse 2s infinite", flexShrink: 0 }} />
                  20 de Agosto · Cubo Itaú · São Paulo
                </div>
              </Reveal>
              <Reveal delay={0.18}><h1 style={{ fontFamily: HEAD_FF, fontSize: "clamp(3.2rem,8.5vw,8rem)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.04em", margin: 0, marginBottom: 8 }}>TECH</h1></Reveal>
              <Reveal delay={0.26}><h1 style={{ fontFamily: HEAD_FF, fontSize: "clamp(3.2rem,8.5vw,8rem)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.04em", margin: 0, marginBottom: 36, background: T.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>EDITION</h1></Reveal>
              <div style={{ width: "100%", height: 1, background: "linear-gradient(90deg,rgba(73,253,227,0.3),transparent)", marginBottom: 28 }} />
              <Reveal delay={0.32}><p style={{ fontSize: 16, lineHeight: 1.7, color: T.muted, maxWidth: 680, marginBottom: 36, fontFamily: BODY_FF }}>Onde a tecnologia que sustenta o mercado regulamentado se encontra. Um encontro exclusivo entre empresas, especialistas e autoridades construindo a infraestrutura do iGaming no Brasil.</p></Reveal>
              <Reveal delay={0.38}>
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? 12 : 14, flexWrap: "wrap" }}>
                  <motion.a href="#contato" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 10, background: T.grad, color: T.surface, padding: "14px 28px", borderRadius: 999, fontSize: 14, fontWeight: 700, textDecoration: "none", fontFamily: HEAD_FF }}>
                    Quero Participar <ArrowRight size={16} />
                  </motion.a>
                  <motion.a href="#patrocinio" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "transparent", color: T.text, padding: "14px 28px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", fontSize: 14, fontWeight: 500, textDecoration: "none", fontFamily: BODY_FF }}>
                    Ver Patrocínios
                  </motion.a>
                </div>
              </Reveal>
            </div>
            <div style={{ flex: "unset", width: "100%", display: "grid", gridTemplateColumns: isMobile ? "repeat(3,1fr)" : "1fr", gap: isMobile ? 0 : 32, borderLeft: isMobile ? "none" : "1px solid rgba(73,253,227,0.18)", borderTop: isMobile ? "1px solid rgba(255,255,255,0.07)" : "none", paddingLeft: isMobile ? 0 : 32, paddingTop: isMobile ? 20 : 0, paddingBottom: 12 }}>
              <Reveal delay={0.45}>
                <div style={{ display: "contents" }}>
                  {[
                  { num: "150+", label: "C-Level Decision\nMakers" },
                  { num: "100%", label: "Conteúdo\nTécnico" },
                  { num: "1", label: "Dia de\nBastidores Reais" }].
                  map(({ num, label }) =>
                  <div key={num} style={{ padding: isMobile ? "16px 4px" : 0, textAlign: isMobile ? "center" : "left", borderRight: isMobile ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                      <div style={{ fontFamily: HEAD_FF, fontSize: isMobile ? "clamp(1.3rem,6vw,1.8rem)" : "clamp(2rem,3.5vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, background: T.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{num}</div>
                      <div style={{ fontFamily: MONO_FF, fontSize: isMobile ? 9 : 10, letterSpacing: isMobile ? "0.1em" : "0.2em", textTransform: "uppercase", color: T.muted, marginTop: 8, whiteSpace: "pre-line" }}>{label}</div>
                    </div>
                  )}
                </div>
              </Reveal>
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", animation: "floatY 2s infinite ease-in-out" }}>
            <ChevronDown size={20} color={T.muted} />
          </div>
        </section>

        {/* O MERCADO REGULOU */}
        <section style={{ padding: isMobile ? "64px 20px" : "120px 64px", background: "linear-gradient(180deg, #0e1620 0%, #0e1620 35%, #111b28 100%)", position: "relative" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 40 : 80, alignItems: isMobile ? "flex-start" : "center" }}>
            <div>
              <Reveal><Pill>O novo momento do mercado</Pill></Reveal>
              <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2.8rem,6vw,5.5rem)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 0.95, marginBottom: 8 }}>O mercado</h2></Reveal>
              <Reveal delay={0.17}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2.8rem,6vw,5.5rem)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.15, paddingBottom: "0.12em", marginBottom: 28, fontStyle: "italic", overflow: "visible", background: T.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>regulou.</h2></Reveal>
              <Reveal delay={0.22}><div style={{ borderLeft: "2px solid rgba(73,253,227,0.3)", paddingLeft: 20, marginBottom: 32 }}><p style={{ color: T.muted, fontSize: 17, lineHeight: 1.7, fontFamily: BODY_FF }}>Depois do primeiro ano da regulamentação, o desafio do setor deixou de ser jurídico e passou a ser técnico.</p></div></Reveal>
              <Reveal delay={0.28}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {["KYC Biometrics", "AML Engine", "Open Finance", "Compliance Stack", "Antifraude"].map((tag) =>
                  <span key={tag} style={{ padding: "7px 14px", border: `1px solid ${T.border}`, borderRadius: 999, fontSize: 11, fontFamily: MONO_FF, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, fontWeight: 500 }}>{tag}</span>
                  )}
                </div>
              </Reveal>
              <Reveal delay={0.35}>
                <div style={{ marginTop: 24, borderLeft: "1px solid rgba(73,253,227,0.25)", paddingLeft: 14, paddingTop: 2, paddingBottom: 2 }}>
                  <p style={{ fontFamily: BODY_FF, fontSize: 13.5, fontWeight: 400, color: T.muted, lineHeight: 1.55, letterSpacing: "0.01em" }}>
                    Este não é um evento sobre apostas.{" "}
                    <span style={{ color: "rgba(73,253,227,0.7)", fontWeight: 500 }}>É sobre como o mercado de apostas funciona por trás.</span>
                  </p>
                </div>
              </Reveal>
            </div>
            <Reveal delay={0.2}>
              <div style={{ background: "#0d1117", borderRadius: 16, border: "1px solid rgba(73,253,227,0.15)", overflow: "hidden", boxShadow: "0 32px 64px -16px rgba(0,0,0,0.5)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 20px", background: "#161b22", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", flexShrink: 0 }} />
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e", flexShrink: 0 }} />
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840", flexShrink: 0 }} />
                  <span style={{ marginLeft: 12, fontFamily: MONO_FF, fontSize: 12, color: "#6e7681", letterSpacing: "0.08em" }}>ENGINE_CORE.TS</span>
                </div>
                <div style={{ padding: "28px", fontFamily: MONO_FF, fontSize: 14, lineHeight: 2.0 }}>
                  <div style={{ marginBottom: 8 }}><span style={{ color: "#8b949e" }}>// regulação em produção</span></div>
                  <div><span style={{ color: "#ff7b72" }}>interface </span><span style={{ color: T.teal }}>BrazilianRegulation </span><span style={{ color: T.text }}>{"{"}</span></div>
                  <div style={{ paddingLeft: 24 }}><span style={{ color: T.blue }}>reporting</span><span style={{ color: T.text }}>: </span><span style={{ color: "#a5d6ff" }}>&apos;REAL_TIME&apos;</span><span style={{ color: T.text }}>;</span></div>
                  <div style={{ paddingLeft: 24 }}><span style={{ color: T.blue }}>taxation</span><span style={{ color: T.text }}>: </span><span style={{ color: "#a5d6ff" }}>&apos;GGR_MODEL&apos;</span><span style={{ color: T.text }}>;</span></div>
                  <div style={{ paddingLeft: 24 }}><span style={{ color: T.blue }}>security</span><span style={{ color: T.text }}>: </span><span style={{ color: "#a5d6ff" }}>&apos;LOTO_CERTIFIED&apos;</span><span style={{ color: T.text }}>;</span></div>
                  <div style={{ marginBottom: 16 }}><span style={{ color: T.text }}>{"}"}</span></div>
                  <div><span style={{ color: "#ff7b72" }}>const </span><span style={{ color: T.text }}>deployment </span><span style={{ color: "#ff7b72" }}>= await </span><span style={{ color: T.blue }}>Ministry</span><span style={{ color: T.text }}>.</span><span style={{ color: "#d2a8ff" }}>verify</span><span style={{ color: T.text }}>(operator);</span></div>
                  <div style={{ marginTop: 16 }}><span style={{ color: T.teal, animation: "blink 1.2s step-end infinite" }}>█</span></div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* OBJETIVOS */}
        <section id="objetivos" style={{ padding: isMobile ? "64px 20px" : "120px 64px", background: T.surface2 }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Reveal><Pill>Objetivos do evento</Pill></Reveal>
            <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 64, lineHeight: 1.1 }}>Por que esta edição é um <GradText>marco</GradText></h2></Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: isMobile ? 12 : 16 }}>
              {[
              { n: "01", title: "Infraestrutura tecnológica", desc: "Debater o que torna a operação regulada possível na prática.", icon: <Terminal size={22} />, h: 420, offset: 0 },
              { n: "02", title: "Quem constrói × Quem regula", desc: "Conectar operadores e reguladores em debate direto e aplicável.", icon: <Scale size={22} />, h: 480, offset: -40 },
              { n: "03", title: "Segurança, Compliance e Dados", desc: "Discutir aplicado ao iGaming regulado — sem rodeios institucionais.", icon: <Shield size={22} />, h: 450, offset: 24 },
              { n: "04", title: "Networking qualificado", desc: "Áreas técnicas, jurídicas, operacionais e estratégicas reunidas.", icon: <Users size={22} />, h: 460, offset: -16 }].
              map(({ n, title, desc, icon, h, offset }, i) =>
              <Reveal key={n} delay={i * 0.08}>
                  <Glass style={{ height: isMobile ? "auto" : h, marginTop: isMobile ? 0 : offset, padding: 32, display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", position: "relative" }}>
                    <span style={{ position: "absolute", bottom: -20, right: 16, fontFamily: HEAD_FF, fontSize: 120, fontWeight: 700, letterSpacing: "-0.04em", color: "rgba(73,253,227,0.04)", lineHeight: 1, userSelect: "none", pointerEvents: "none" }}>{n}</span>
                    <div>
                      <div style={{ color: T.teal, marginBottom: 20 }}>{icon}</div>
                      <div style={{ fontFamily: MONO_FF, fontSize: 11, color: T.teal, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 14 }}>{n}</div>
                      <h3 style={{ fontFamily: HEAD_FF, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.2, marginBottom: 12 }}>{title}</h3>
                      <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.65, fontFamily: BODY_FF }}>{desc}</p>
                    </div>
                  </Glass>
                </Reveal>
              )}
            </div>
          </div>
        </section>

        {/* PÚBLICO */}
        <section id="público" style={{ padding: isMobile ? "64px 20px" : "120px 64px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Reveal><Pill>Quem você vai encontrar</Pill></Reveal>
            <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 16, lineHeight: 1.1 }}>Quem <GradText>constrói o mercado</GradText><br />por trás das marcas</h2></Reveal>
            <Reveal delay={0.15}><p style={{ color: T.muted, fontSize: 16, marginBottom: 56, maxWidth: 600, fontFamily: BODY_FF }}>O evento é voltado para profissionais e empresas que sustentam o ecossistema do iGaming regulado.</p></Reveal>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4,1fr)", gap: 12, alignItems: "stretch" }}>
              {[
              { icon: <Fingerprint size={20} />, label: "KYC, Antifraude e Compliance" },
              { icon: <CreditCard size={20} />, label: "Meios de Pagamento" },
              { icon: <Shield size={20} />, label: "Operadores" },
              { icon: <Layers size={20} />, label: "Plataformas" },
              { icon: <Gavel size={20} />, label: "Reguladores e Autoridades" },
              { icon: <Scale size={20} />, label: "Advogados Especializados" },
              { icon: <Database size={20} />, label: "Empresas de Tech e Dados" },
              { icon: <BarChart2 size={20} />, label: "Marketing, CRM e Retenção" }].
              map(({ icon, label }, i) =>
              <Reveal key={label} delay={i * 0.05}>
                  <Glass style={{ padding: "20px 18px", display: "flex", alignItems: "center", gap: 14, height: "100%", boxSizing: "border-box" }}>
                    <span style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 10, background: "rgba(73,253,227,0.1)", color: T.teal, flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, fontFamily: BODY_FF }}>{label}</span>
                  </Glass>
                </Reveal>
              )}
            </div>
            <Reveal delay={0.4}>
              <div style={{ textAlign: "center", marginTop: 48 }}>
                <motion.a href="#contato" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                style={{ display: "inline-flex", alignItems: "center", gap: 10, background: T.grad, color: T.surface, padding: "15px 32px", borderRadius: 999, fontSize: 14, fontWeight: 700, textDecoration: "none", fontFamily: HEAD_FF }}>
                  Quero posicionar minha marca entre os líderes <ArrowRight size={16} />
                </motion.a>
              </div>
            </Reveal>
          </div>
        </section>

        {/* PATROCÍNIO */}
        <section id="patrocinio" style={{ padding: isMobile ? "64px 20px" : "120px 64px", background: T.surface2 }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Reveal><Pill>Por que patrocinar</Pill></Reveal>
            <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 56, lineHeight: 1.1 }}>Associe sua marca à <GradText>infraestrutura</GradText><br />do mercado regulado</h2></Reveal>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 12 : 16, alignItems: "stretch" }}>
              {[
              { icon: <Award size={28} />, title: "Autoridade Técnica", desc: "Sua marca conectada ao debate mais estratégico: tecnologia, dados, segurança e compliance no iGaming." },
              { icon: <Users size={28} />, title: "Networking de Alto Nível", desc: "Relacionamento direto com C-levels, Heads e decisores técnicos e operacionais do mercado regulado." },
              { icon: <Eye size={28} />, title: "Visibilidade Multiplataforma", desc: "Painéis, ativações, imprensa especializada e comunicação ao público mais qualificado do setor." }].
              map(({ icon, title, desc }, i) =>
              <Reveal key={title} delay={i * 0.1}>
                  <Glass style={{ padding: "28px 28px 32px", display: "flex", flexDirection: "column", height: "100%" }}>
                    <div style={{ color: T.teal, marginBottom: 20, padding: 12, background: T.tealDim, display: "grid", placeItems: "center", borderRadius: 12, width: 48, height: 48, flexShrink: 0 }}>{icon}</div>
                    <h3 style={{ fontFamily: HEAD_FF, fontSize: 18, fontWeight: 600, marginBottom: 10, lineHeight: 1.25, minHeight: "2.5em" }}>{title}</h3>
                    <p style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.7, flex: 1, margin: 0, fontFamily: BODY_FF }}>{desc}</p>
                  </Glass>
                </Reveal>
              )}
            </div>
            <Reveal delay={0.35}>
              <Glass hoverGlow={false} style={{ padding: "32px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg,rgba(73,253,227,0.05),rgba(2,183,222,0.05))", border: "1px solid rgba(73,253,227,0.18)" }}>
                <div style={{ flex: 1, paddingRight: 48 }}>
                  <div style={{ fontFamily: MONO_FF, fontSize: 10, color: T.teal, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>Destaque</div>
                  <h3 style={{ fontFamily: HEAD_FF, fontSize: 22, fontWeight: 600, marginBottom: 14, lineHeight: 1.2 }}>Microfórum Patrocinado</h3>
                  <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.75, maxWidth: 560, marginBottom: 0, fontFamily: BODY_FF }}>Espaço de fala exclusivo com branding e ativação prática no evento. Inclui possibilidade de referral agreement com os organizadores.</p>
                </div>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", minWidth: 160 }}>
                  <motion.a href="#contato" whileHover={{ scale: 1.04, x: 4 }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.grad, color: T.surface, padding: "13px 26px", borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", fontFamily: HEAD_FF }}>
                    Ver cotas <ArrowRight size={15} />
                  </motion.a>
                </div>
              </Glass>
            </Reveal>
          </div>
        </section>

        {/* DEBATES */}
        <section id="debates" style={{ padding: isMobile ? "64px 20px" : "120px 64px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Reveal><Pill>Os debates</Pill></Reveal>
            <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 16, lineHeight: 1.1 }}>Os debates que <GradText>sustentam</GradText><br />o mercado regulado</h2></Reveal>
            <Reveal delay={0.15}><p style={{ color: T.muted, fontSize: 16, marginBottom: 56, maxWidth: 600, fontFamily: BODY_FF }}>Conteúdo técnico, prático e estratégico. Cases reais, painéis, workshops e pitch de startups.</p></Reveal>
            <div style={{ borderTop: `1px solid ${T.border}` }}>
              {[
              { n: "/01", title: "KYC, antifraude e PLD na prática", desc: "Automatizar prevenção à lavagem de dinheiro com tecnologia que escala na operação regulada." },
              { n: "/02", title: "Arquitetura de pagamentos regulados", desc: "Stack preparada para volume, conciliação e exigências do mercado regulado brasileiro." },
              { n: "/03", title: "Segurança da informação e dados", desc: "Riscos cibernéticos, LGPD e infraestrutura mínima para operar com segurança." },
              { n: "/04", title: "Integrações plataformas × reguladores", desc: "O fluxo real de dados conectando o ecossistema regulado de ponta a ponta." },
              { n: "/05", title: "Dados, CRM e retenção no iGaming", desc: "Inteligência aplicada à retenção de jogadores e decisão operacional com dados." },
              { n: "/06", title: "Tecnologia na fiscalização e compliance", desc: "Como a tech reformulou o trabalho do regulador e do compliance officer." }].
              map(({ n, title, desc }, i) =>
              <Reveal key={n} delay={i * 0.06}>
                  <motion.div whileHover={{ backgroundColor: "rgba(73,253,227,0.03)", x: 6 }} transition={{ duration: 0.2 }}
                style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "80px 1fr 1fr", gap: isMobile ? 8 : 32, padding: "28px 0", borderBottom: `1px solid ${T.border}`, alignItems: "start" }}>
                    <span style={{ fontFamily: MONO_FF, fontSize: 13, color: T.teal, fontWeight: 500, paddingTop: 2 }}>{n}</span>
                    <h3 style={{ fontFamily: HEAD_FF, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25 }}>{title}</h3>
                    <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.65, fontFamily: BODY_FF }}>{desc}</p>
                  </motion.div>
                </Reveal>
              )}
            </div>
          </div>
        </section>

        {/* BRASÍLIA — BIG NUMBERS + MARQUEES */}
        <section id="passado" style={{ padding: isMobile ? "64px 20px" : "120px 64px", background: T.surface2, overflow: "hidden" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Reveal><div style={{ textAlign: "center" }}><Pill>A última edição</Pill></div></Reveal>
            <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 16, lineHeight: 1.1, textAlign: "center" }}>O que aconteceu na última edição<br />em <GradText>Brasília</GradText></h2></Reveal>
            <Reveal delay={0.15}><p style={{ color: T.muted, fontSize: 16, lineHeight: 1.65, textAlign: "center", maxWidth: 640, margin: "0 auto 64px", fontFamily: BODY_FF }}>O Bet ON Brasil reuniu autoridades, operadores e especialistas do setor para discutir o primeiro ano da regulamentação no país.</p></Reveal>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 16, marginBottom: 80, alignItems: "stretch" }}>
              {[
              { num: "+200", label: "participantes qualificados" },
              { num: "+40", label: "palestrantes e autoridades" },
              { num: "+30", label: "portais de cobertura" },
              { num: "100%", label: "mercado regulado" }].
              map(({ num, label }, i) =>
              <Reveal key={num} delay={i * 0.08} className="stat-card">
                  <motion.div whileHover={{ y: -6, scale: 1.03, borderColor: "rgba(73,253,227,0.35)", boxShadow: "0 20px 40px -12px rgba(73,253,227,0.1)" }} transition={{ type: "spring", stiffness: 300, damping: 24 }}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: "40px 24px", textAlign: "center", backdropFilter: "blur(20px)", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200 }}>
                    <div style={{ fontFamily: HEAD_FF, fontSize: "clamp(2.8rem,5vw,4rem)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, background: T.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", marginBottom: 16 }}>{num}</div>
                    <div style={{ fontFamily: BODY_FF, fontSize: 13, fontWeight: 400, color: T.muted, letterSpacing: "0.02em", lineHeight: 1.4, minHeight: "2.8em", display: "flex", alignItems: "flex-start", justifyContent: "center", maxWidth: "16ch" }}>{label}</div>
                  </motion.div>
                </Reveal>
              )}
            </div>

            <Reveal delay={0.2}>
              <div style={{ marginBottom: 52 }}>
                <p style={{ fontFamily: MONO_FF, fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: T.muted, textAlign: "center", marginBottom: 28 }}>Quem esteve presente</p>
                <div style={{ overflow: "hidden", position: "relative" }}>
                  <div style={FADE_L(T.surface2)} /><div style={FADE_R(T.surface2)} />
                  <div style={{ display: "flex", gap: 56, width: "max-content", animation: "marqueeL 56s linear infinite" }}>
                    {["PAAG", "SENACON", "SPA/MF", "CGU", "ANJL", "IBJR", "ABRADIN", "FEBRABAN", "Cactus", "Betano", "KTO", "Bet Nacional", "Bet365", "GameWiz", "Bis SIGMA", "SBC", "Estrela Bet", "PAAG", "SENACON", "SPA/MF", "CGU", "ANJL", "IBJR", "ABRADIN", "FEBRABAN", "Cactus", "Betano", "KTO", "Bet Nacional", "Bet365", "GameWiz", "Bis SIGMA", "SBC", "Estrela Bet"].map((org, i) =>
                    <span key={i} style={{ fontFamily: HEAD_FF, fontSize: 22, fontWeight: 600, color: "rgba(219,227,241,0.22)", letterSpacing: "0.05em", whiteSpace: "nowrap", textTransform: "uppercase" }}>{org}</span>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.25}>
              <div>
                <p style={{ fontFamily: MONO_FF, fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: T.muted, textAlign: "center", marginBottom: 28 }}>Cobertura de imprensa</p>
                <div style={{ overflow: "hidden", position: "relative" }}>
                  <div style={FADE_L(T.surface2)} /><div style={FADE_R(T.surface2)} />
                  <div style={{ display: "flex", gap: 56, width: "max-content", animation: "marqueeR 28s linear infinite" }}>
                    {["iGaming Brazil", "SBC News", "GMB", "Games Magazine", "Poder360", "Valor Econômico", "Folha de SP", "iGaming Brazil", "SBC News", "GMB", "Games Magazine", "Poder360", "Valor Econômico", "Folha de SP"].map((press, i) =>
                    <span key={i} style={{ fontFamily: HEAD_FF, fontSize: 18, fontWeight: 500, color: "rgba(219,227,241,0.2)", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{press}</span>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* AFTERMOVIE */}
        <section style={{ padding: isMobile ? "64px 20px" : "120px 64px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 64, alignItems: "center" }}>
            <div>
              <Reveal><Pill>Aftermovie · Brasília</Pill></Reveal>
              <Reveal delay={0.1}>
                <h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(1.8rem,3vw,2.6rem)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 20 }}>
                  Última edição | Bet ON Brasil: <span style={{ whiteSpace: "nowrap" }}><GradText>1 Ano de Regulação</GradText></span>
                </h2>
              </Reveal>
              <Reveal delay={0.15}>
                <p style={{ color: T.muted, fontSize: 16, lineHeight: 1.65, fontFamily: BODY_FF, maxWidth: 480 }}>
                  Bastidores do encontro que reuniu autoridades, operadores e especialistas para discutir o primeiro ano da regulamentação no Brasil.
                </p>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <motion.div whileHover="hovered" style={{ position: "relative", borderRadius: 16, overflow: "hidden", border: `1px solid ${T.border}` }}>
                <motion.div variants={{ hovered: { opacity: 0 } }} initial={{ opacity: 1 }} transition={{ duration: 0.5 }}
                style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(14,22,32,0.25)", backdropFilter: "blur(1px)", pointerEvents: "none" }} />
                <motion.div variants={{ hovered: { filter: "grayscale(0%)" } }} initial={{ filter: "grayscale(100%)" }} transition={{ duration: 0.7 }}
                style={{ paddingTop: "56.25%", position: "relative" }}>
                  <iframe src="https://www.youtube.com/embed/E7hWeowXPTI?si=BWXURmTm8-M6asQ2&rel=0" title="Bet ON Brasil Aftermovie"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
                </motion.div>
              </motion.div>
            </Reveal>
          </div>
        </section>

        {/* AGENDA */}
        <section id="agenda" style={{ padding: isMobile ? "64px 20px" : "120px 64px", background: T.surface2 }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Reveal><Pill>Agenda Bet ON Brasil</Pill></Reveal>
            <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,4vw,3.2rem)", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 48, lineHeight: 1.1 }}>O <GradText>Bet ON Brasil</GradText> não para.</h2></Reveal>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
              { tag: "PRÓXIMO · DESTAQUE", live: true, day: "20", mon: "AGO", year: "2026", title: "Bet ON Brasil: Tech Edition", place: "Cubo Itaú · São Paulo", desc: "O encontro técnico que mostra o que acontece por dentro da operação regulada do iGaming.", cta: "Garantir meu ingresso", link: "https://luma.com/p8ejs7fm" },
              { tag: "LISBOA · SBC SUMMIT", live: false, day: "29", mon: "SET", year: "a 01/OUT", title: "Networking Lounge by Bet ON Brasil", place: "Lisboa · Portugal", desc: "Networking estratégico entre empresas brasileiras e players internacionais durante a SBC Summit.", cta: "Tenho interesse" },
              { tag: "BRASÍLIA · 2027", live: false, day: "18", mon: "FEV", year: "2027", title: "Bet ON Brasil — Brasília", place: "Brasília · Distrito Federal", desc: "A próxima edição oficial do evento que conecta o mercado regulado nacional.", cta: "Quero ser avisado" }].
              map(({ tag, live, day, mon, year, title, place, desc, cta, link }, i) =>
              <Reveal key={title} delay={i * 0.1}>
                  <Glass hoverGlow={false} style={{ padding: "28px 32px", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 16 : 40, position: "relative", overflow: "hidden", background: live ? "linear-gradient(135deg,rgba(73,253,227,0.07),rgba(2,183,222,0.04))" : T.card, border: live ? "1px solid rgba(73,253,227,0.28)" : `1px solid ${T.border}` }}>
                    {live && <div style={{ position: "absolute", inset: 0, borderRadius: 16, border: "1px solid rgba(73,253,227,0.5)", pointerEvents: "none", animation: "glow 2s infinite ease-in-out" }} />}
                    <div style={{ flexShrink: 0, textAlign: "center", minWidth: 80 }}>
                      <div style={{ fontFamily: HEAD_FF, fontSize: 48, fontWeight: 700, lineHeight: 1, background: T.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{day}</div>
                      <div style={{ fontFamily: MONO_FF, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, lineHeight: 1.3 }}>{mon}<br />{year}</div>
                    </div>
                    <div style={{ width: 1, height: 80, background: T.border, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                        <span style={{ fontFamily: MONO_FF, fontSize: 10, letterSpacing: "0.2em", color: live ? T.teal : T.muted, border: `1px solid ${live ? "rgba(73,253,227,0.3)" : T.border}`, padding: "4px 10px", borderRadius: 999, background: live ? "rgba(73,253,227,0.07)" : "transparent" }}>{tag}</span>
                        {live && <span style={{ fontFamily: MONO_FF, fontSize: 10, letterSpacing: "0.2em", color: "#ff4d4d", display: "flex", alignItems: "center", gap: 6, animation: "glow 1.5s infinite ease-in-out" }}><span style={{ width: 6, height: 6, background: "#ff4d4d", borderRadius: "50%", flexShrink: 0 }} />LIVE NOW</span>}
                      </div>
                      <h3 style={{ fontFamily: HEAD_FF, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 6 }}>{title}</h3>
                      <p style={{ color: T.teal, fontSize: 12, fontFamily: MONO_FF, letterSpacing: "0.06em", marginBottom: 8 }}><MapPin size={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />{place}</p>
                      <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, fontFamily: BODY_FF }}>{desc}</p>
                    </div>
                    <motion.a href={link || "#contato"} target={link ? "_blank" : undefined} rel={link ? "noopener noreferrer" : undefined} whileHover={{ x: 5 }} transition={springFast}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0, color: live ? T.teal : T.muted, fontSize: 13, fontWeight: 500, textDecoration: "none", borderBottom: `1px solid ${live ? "rgba(73,253,227,0.3)" : T.border}`, paddingBottom: 2, fontFamily: BODY_FF }}>
                      {cta} <ArrowRight size={14} />
                    </motion.a>
                  </Glass>
                </Reveal>
              )}
            </div>
          </div>
        </section>

        {/* FORMULÁRIO */}
        <section id="contato" style={{ padding: isMobile ? "64px 20px" : "120px 64px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 40 : 80, alignItems: "start" }}>
            <div>
              <Reveal><Pill>Patrocínio · Inscrição · Imprensa</Pill></Reveal>
              <Reveal delay={0.1}><h2 style={{ fontFamily: HEAD_FF, fontSize: "clamp(2rem,3.5vw,3rem)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 20 }}>Sua marca presente onde o mercado é <GradText>construído</GradText></h2></Reveal>
              <Reveal delay={0.15}><p style={{ color: T.muted, fontSize: 16, lineHeight: 1.7, marginBottom: 36, fontFamily: BODY_FF }}>O Tech Edition reúne em um único dia quem decide, opera e regula a infraestrutura do iGaming brasileiro.</p></Reveal>
              <Reveal delay={0.2}>
                <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12, marginBottom: 40 }}>
                  {["Cotas de patrocínio com espaço de fala em microfórum", "Branding e ativações no evento", "Modelo de referral agreement disponível", "Inscrição de C-Levels, Diretores e Heads"].map((item) =>
                  <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 12, color: T.muted, fontSize: 15, lineHeight: 1.55, fontFamily: BODY_FF }}>
                      <Check size={16} color={T.teal} style={{ marginTop: 2, flexShrink: 0 }} />{item}
                    </li>
                  )}
                </ul>
              </Reveal>
              <Reveal delay={0.25}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 14, padding: "24px 0", borderTop: `1px solid ${T.border}` }}>
                  {[{ label: "Local", value: "Cubo Itaú · São Paulo" }, { label: "Data", value: "20 de Agosto" }, { label: "Capacidade", value: "150–200 decisores" }].map(({ label, value }) =>
                  <div key={label}>
                      <div style={{ fontFamily: MONO_FF, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500, fontFamily: HEAD_FF }}>{value}</div>
                    </div>
                  )}
                </div>
              </Reveal>
            </div>
            <Reveal delay={0.15}>
              <Glass hoverGlow={false} style={{ padding: "36px 32px" }}>
                <h3 style={{ fontFamily: HEAD_FF, fontSize: 22, fontWeight: 600, marginBottom: 24 }}>Fale com a nossa equipe</h3>
                <form id="leadForm" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[
                  { name: "nome", label: "Nome completo *", type: "text", placeholder: "Seu nome" },
                  { name: "empresa", label: "Empresa / Marca", type: "text", placeholder: "Nome da empresa" },
                  { name: "email", label: "E-mail corporativo *", type: "email", placeholder: "seu@email.com" },
                  { name: "telefone", label: "WhatsApp", type: "tel", placeholder: "+55 11 9 0000-0000" }].
                  map(({ name, label, type, placeholder }) =>
                  <label key={name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 12, color: T.muted, letterSpacing: "0.02em", fontFamily: BODY_FF }}>{label}</span>
                      <input name={name} type={type} placeholder={placeholder}
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 14px", color: T.text, fontSize: 14, outline: "none", fontFamily: BODY_FF, transition: "border-color 0.2s" }}
                    onFocus={(e) => e.target.style.borderColor = "rgba(73,253,227,0.4)"}
                    onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.1)"} />
                    </label>
                  )}
                  {[
                  { name: "interesse", label: "Interesse", opts: [["participar", "Quero participar do evento"], ["patrocinio", "Quero patrocinar"], ["palestrante", "Quero ser palestrante"], ["imprensa", "Imprensa / mídia"]] },
                  { name: "evento_interesse", label: "Sobre qual evento?", opts: [["", "Selecione um evento"], ["tech", "Bet ON Brasil: Tech Edition — 20 Ago · SP"], ["lisboa", "Networking Lounge — 29 Set · Lisboa"], ["brasilia", "Bet ON Brasil — Brasília · Fev 2027"], ["todos", "Todos os eventos"]] }].
                  map(({ name, label, opts }) =>
                  <label key={name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 12, color: T.muted, letterSpacing: "0.02em", fontFamily: BODY_FF }}>{label}</span>
                      <select name={name} style={{ background: "rgba(20,28,40,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 14px", color: T.text, fontSize: 14, outline: "none", fontFamily: BODY_FF }}>
                        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                  )}
                  <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                    { name: "email_consent", text: "Quero receber informações e condições especiais via e-mail" },
                    { name: "info", text: "Concordo em compartilhar meus dados conforme a LGPD (Lei 13.709/2018)" }].
                    map(({ name, text }) =>
                    <label key={name} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "none" }}>
                        <input type="checkbox" name={name} style={{ accentColor: T.teal, marginTop: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, fontFamily: BODY_FF }}>{text}</span>
                      </label>
                    )}
                  </div>
                  <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  style={{ background: T.grad, color: T.surface, padding: "15px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 4, fontFamily: HEAD_FF }}>
                    Quero receber informações <ArrowRight size={16} />
                  </motion.button>
                  <p id="formOk" style={{ display: "none", textAlign: "center", color: T.teal, fontSize: 14, padding: "12px", background: "rgba(73,253,227,0.07)", borderRadius: 10, border: "1px solid rgba(73,253,227,0.2)", fontFamily: BODY_FF }}>
                    ✓ Obrigado! Em breve nossa equipe entrará em contato.
                  </p>
                </form>
              </Glass>
            </Reveal>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer style={{ padding: isMobile ? "48px 20px 24px" : "64px 64px 32px", borderTop: `1px solid ${T.border}`, background: T.surface2 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? 28 : 0, paddingBottom: 48, borderBottom: `1px solid ${T.border}`, marginBottom: 32, gap: 48, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 340 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <img src={LOGO_URL} alt="Bet ON Brasil" style={{ height: 28, width: "auto", maxWidth: 200, objectFit: "contain", display: "block" }} />
                <span style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.teal, padding: "3px 9px", border: "1px solid rgba(73,253,227,0.22)", borderRadius: 999, fontFamily: MONO_FF, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }}>Tech Edition</span>
              </div>
              <p style={{ color: T.muted, fontSize: 13, lineHeight: 1.65, fontFamily: BODY_FF }}>O encontro que conecta operadores, reguladores e a infraestrutura técnica que sustenta o iGaming regulamentado no Brasil.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: isMobile ? 24 : 48 }}>
              {[
              { title: "Evento", links: ["O novo momento", "Objetivos", "Os debates", "Última edição"] },
              { title: "Participação", links: ["Quem encontrar", "Patrocínio", "Inscrição"] },
              { title: "Realização", links: ["Próximos eventos", "Imprensa"] }].
              map(({ title, links }) =>
              <div key={title}>
                  <h5 style={{ fontFamily: MONO_FF, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: T.text, marginBottom: 16, fontWeight: 500 }}>{title}</h5>
                  {links.map((l) =>
                <a key={l} href="#"
                style={{ display: "block", color: T.muted, fontSize: 14, marginBottom: 10, textDecoration: "none", transition: "color 0.2s", fontFamily: BODY_FF }}
                onMouseEnter={(e) => e.target.style.color = T.teal}
                onMouseLeave={(e) => e.target.style.color = T.muted}>{l}</a>
                )}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: isMobile ? "center" : "space-between", alignItems: "center", color: T.muted, fontSize: 13, fontFamily: BODY_FF, flexWrap: "wrap", gap: 16 }}>
            <span>© {new Date().getFullYear()} Bet ON Brasil · Tech Edition</span>
            <div style={{ display: "flex", gap: 12 }}>
              {["LinkedIn", "Instagram"].map((s) =>
              <motion.a key={s} href="#" whileHover={{ borderColor: T.teal, color: T.teal }}
              style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, color: T.muted, textDecoration: "none", fontSize: 11, fontFamily: MONO_FF, letterSpacing: "0.05em" }}>
                  {s.slice(0, 2)}
                </motion.a>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>);

}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);