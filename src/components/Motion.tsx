"use client";

import { useEffect } from "react";

/**
 * Site-wide motion, declared in markup and run by one small observer (no animation library):
 * - [data-reveal]: fades and rises in once when it enters the viewport; elements entering together are
 *   staggered. Elements already on screen when the page loads are never hidden.
 * - [data-decode]: the text scrambles and resolves left to right once when visible (mono labels).
 * - [data-countup]: the numbers count up once when visible; data-countup="scramble" first scrambles the
 *   digits briefly (the result figure).
 * - The header gets data-scrolled on <html> once the page has scrolled past 8px (glass and a hairline).
 *
 * No layout shift: reveals use opacity and transform only; decode and count-up rewrite characters in
 * place with the same number of characters in fixed-width (mono or tabular) text, and always end on the
 * exact original text. prefers-reduced-motion: nothing is hidden, decoded or counted.
 */

const GLYPHS = "#%@*+=-:<>/$0123456789";
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Text nodes inside el that are visible to everyone (skips aria-hidden decorations). */
function textNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[aria-hidden='true']") && n.parentElement.closest("[aria-hidden='true']") !== el ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) out.push(walker.currentNode as Text);
  return out;
}

function animate(duration: number, step: (t: number) => void, done: () => void) {
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    step(t);
    if (t < 1) requestAnimationFrame(tick);
    else done();
  };
  requestAnimationFrame(tick);
}

/** Scramble-decode: characters resolve left to right (with jitter) over ~650 ms. */
function decode(el: Element) {
  const nodes = textNodes(el);
  const finals = nodes.map((n) => n.data);
  const total = finals.reduce((s, f) => s + f.length, 0);
  if (!total) return;
  const at: number[] = [];
  for (let i = 0; i < total; i++) at.push(0.15 + 0.6 * (i / total) + 0.25 * Math.random());
  animate(
    650,
    (t) => {
      let p = 0;
      nodes.forEach((n, k) => {
        const f = finals[k];
        let s = "";
        for (let i = 0; i < f.length; i++, p++) {
          const c = f[i];
          s += c === " " || c === " " || t >= at[p] ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        if (n.data !== s) n.data = s;
      });
    },
    () => nodes.forEach((n, k) => (n.data = finals[k])),
  );
}

/**
 * Count-up in place. Digit groups (digits joined by "," or ".") count from 10^(digits-1) to their value,
 * so the number of characters never changes (fixed-width figures, no layout shift).
 */
function countUp(el: Element, scramble: boolean) {
  const nodes = textNodes(el);
  const finals = nodes.map((n) => n.data);
  const all = finals.join("");
  // Digit slots per group: positions in `all` and the group's integer value.
  const groups: { slots: number[]; value: number; from: number }[] = [];
  let cur: number[] | null = null;
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (c >= "0" && c <= "9") {
      (cur ??= []).push(i);
    } else if ((c === "," || c === ".") && cur) {
      continue;
    } else if (cur) {
      groups.push({ slots: cur, value: 0, from: 0 });
      cur = null;
    }
  }
  if (cur) groups.push({ slots: cur, value: 0, from: 0 });
  for (const g of groups) {
    g.value = Number(g.slots.map((i) => all[i]).join(""));
    g.from = g.slots.length > 1 ? Math.pow(10, g.slots.length - 1) : Math.min(1, g.value);
  }
  if (!groups.some((g) => g.value > g.from)) return;
  const write = (chars: string[]) => {
    let p = 0;
    nodes.forEach((n, k) => {
      const len = finals[k].length;
      const s = chars.slice(p, p + len).join("");
      p += len;
      if (n.data !== s) n.data = s;
    });
  };
  const chars = [...all];
  const scrambleMs = scramble ? 280 : 0;
  const countMs = 900;
  animate(
    scrambleMs + countMs,
    (t) => {
      const ms = t * (scrambleMs + countMs);
      for (const g of groups) {
        if (ms < scrambleMs) {
          for (const i of g.slots) chars[i] = String(Math.floor(Math.random() * 10));
          // Keep the leading digit non-zero so it never looks like a different magnitude.
          if (g.slots.length > 1) chars[g.slots[0]] = String(1 + Math.floor(Math.random() * 9));
        } else {
          const k = ease(Math.min(1, (ms - scrambleMs) / countMs));
          const v = Math.round(g.from + (g.value - g.from) * k);
          const digits = String(v).padStart(g.slots.length, "0").slice(-g.slots.length);
          g.slots.forEach((i, j) => (chars[i] = digits[j]));
        }
      }
      write(chars);
    },
    () => nodes.forEach((n, k) => (n.data = finals[k])),
  );
}

export function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement;
    const onScroll = () => root.toggleAttribute("data-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return () => window.removeEventListener("scroll", onScroll);

    // Set up after hydration, in an idle callback (kept out of the hydration task). Until then nothing is
    // hidden, so content is never held back.
    let revealIO: IntersectionObserver | null = null;
    let onceIO: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let pending = 0;
    const init = () => {
      const seen = new WeakSet<Element>();
      const rio = new IntersectionObserver(
        (entries) => {
          const hits = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
          hits.forEach((e, i) => {
            const el = e.target as HTMLElement;
            el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 70}ms`);
            el.setAttribute("data-shown", "");
            rio.unobserve(el);
            el.addEventListener("transitionend", () => el.style.removeProperty("--reveal-delay"), { once: true });
          });
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
      );
      const oio = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const el = e.target;
            oio.unobserve(el);
            if (el.hasAttribute("data-decode")) decode(el);
            if (el.hasAttribute("data-countup")) countUp(el, el.getAttribute("data-countup") === "scramble");
          }
        },
        { threshold: 0.3 },
      );
      revealIO = rio;
      onceIO = oio;
      const scan = (initial: boolean) => {
        const fresh: Element[] = [];
        document.querySelectorAll("[data-reveal]").forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          if (initial) fresh.push(el);
          else rio.observe(el);
        });
        document.querySelectorAll("[data-decode],[data-countup]").forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          oio.observe(el);
        });
        if (!initial) return;
        // Elements already on screen when motion starts are never hidden (no flash, no delay to the first
        // view). An observer works this out off the main task (no forced layout); hidden states apply only
        // after that, so content is never held back.
        const first = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.height ?? window.innerHeight)) e.target.setAttribute("data-shown", "");
            else rio.observe(e.target);
          }
          first.disconnect();
          root.classList.add("motion");
        });
        fresh.forEach((el) => first.observe(el));
        if (!fresh.length) root.classList.add("motion");
      };
      scan(true);
      // Pages that render after data arrives (Result, Export): pick up new elements.
      mo = new MutationObserver(() => {
        if (pending) return;
        pending = requestAnimationFrame(() => {
          pending = 0;
          scan(false);
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(init, { timeout: 400 }) : window.setTimeout(init, 50);

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      revealIO?.disconnect();
      onceIO?.disconnect();
      mo?.disconnect();
      cancelAnimationFrame(pending);
    };
  }, []);
  return null;
}
