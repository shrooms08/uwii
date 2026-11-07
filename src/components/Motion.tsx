"use client";

import { useEffect } from "react";

/**
 * Site-wide motion, declared in markup and run by one small observer (no animation library):
 * - [data-reveal]: fades and rises in once when it enters the viewport; elements entering together are
 *   staggered. Elements already on screen when the page loads are never hidden.
 * - [data-decode]: the text scrambles and resolves left to right once when visible (mono labels).
 * - [data-countup]: the numbers count up once when visible; data-countup="scramble" first scrambles the
 *   digits briefly (the result figure).
 * - The nav gets data-scrolled on <html> after the first scroll (more opaque, stronger blur).
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
    const onScroll = () => root.toggleAttribute("data-scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return () => window.removeEventListener("scroll", onScroll);

    const seen = new WeakSet<Element>();
    const vh = () => window.innerHeight || document.documentElement.clientHeight;

    const revealIO = new IntersectionObserver(
      (entries) => {
        const hits = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
        hits.forEach((e, i) => {
          const el = e.target as HTMLElement;
          el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 70}ms`);
          el.setAttribute("data-shown", "");
          revealIO.unobserve(el);
          el.addEventListener("transitionend", () => el.style.removeProperty("--reveal-delay"), { once: true });
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    const onceIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target;
          onceIO.unobserve(el);
          if (el.hasAttribute("data-decode")) decode(el);
          if (el.hasAttribute("data-countup")) countUp(el, el.getAttribute("data-countup") === "scramble");
        }
      },
      { threshold: 0.3 },
    );

    const scan = (initial: boolean) => {
      document.querySelectorAll("[data-reveal]").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        // Already on screen at load: never hidden (no flash, no delay to the first view).
        if (initial && el.getBoundingClientRect().top < vh()) el.setAttribute("data-shown", "");
        else revealIO.observe(el);
      });
      document.querySelectorAll("[data-decode],[data-countup]").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        onceIO.observe(el);
      });
    };
    scan(true);
    // Hidden states apply only once JS is running (content is never hidden without it).
    root.classList.add("motion");

    // Pages that render after data arrives (Result, Export): pick up new elements.
    let pending = 0;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        scan(false);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      revealIO.disconnect();
      onceIO.disconnect();
      mo.disconnect();
      cancelAnimationFrame(pending);
    };
  }, []);
  return null;
}
