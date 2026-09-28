#!/usr/bin/env python3
"""Parity check for the GSAP motion layer: animated page vs static baseline.

The reduced-motion context IS the baseline: assets/js/site-motion.js returns
before touching the DOM there, so it renders what the site looked like before
the layer existed. Anything that differs is a regression the layer introduced.

Usage:
    cd <site root> && python3 -m http.server 8791 --bind 127.0.0.1 &
    python3 scripts/motion_parity_check.py http://127.0.0.1:8791 index.html index-en.html

Env overrides:
    MOTION_HIDDEN_SELECTOR  reveal targets that must end up visible
                            (default: .section-title, .info-card, .section .item,
                             .hero-cta-btn, .tagline-sub)
    MOTION_CRAWL_SELECTOR   elements parked in the viewport to fire the reveals
                            (default: section[id]; this site has no section ids,
                             so run with MOTION_CRAWL_SELECTOR=section)
    MOTION_WIDTHS           viewport widths for the parity sweep (default: 390,768,1440)

Requires: pip install playwright && playwright install chromium
Exit code: 0 = all checks pass, 1 = at least one FAIL.
"""
import json
import os
import ssl
import sys
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

HIDDEN_SEL = os.environ.get(
    "MOTION_HIDDEN_SELECTOR",
    ".section-title, .info-card, .section .item, .hero-cta-btn, .tagline-sub",
)
CRAWL_SEL = os.environ.get("MOTION_CRAWL_SELECTOR", "section[id]")
WIDTHS = [int(w) for w in os.environ.get("MOTION_WIDTHS", "390,768,1440").split(",")]

problems = []


def probe_status(url):
    """Preflight HTTP status. macOS python has no CA bundle, so a failed
    verification retries unverified — this only asks whether the host answers
    200, while the real check still runs through Chromium, which verifies TLS."""
    try:
        with urlopen(url, timeout=15) as response:
            return response.status
    except Exception:
        # urllib wraps the TLS error in URLError, so retry on any failure.
        with urlopen(url, timeout=15, context=ssl._create_unverified_context()) as response:
            return response.status


def check(label, ok, detail=""):  # detail: anything json-serialisable
    line = "{} {}{}".format(
        "PASS" if ok else "FAIL",
        label,
        (" — " + json.dumps(detail, ensure_ascii=False)) if detail != "" else "",
    )
    print(line, flush=True)
    if not ok:
        problems.append(line)


PROBE = """(hiddenSel) => {
    const q = (s) => Array.from(document.querySelectorAll(s));
    return {
        motionReady: document.documentElement.classList.contains('motion-ready'),
        hasGsap: typeof window.gsap === 'object',
        triggers: window.ScrollTrigger ? window.ScrollTrigger.getAll().length : 0,
        injected: !!document.querySelector('.scroll-rail, .to-top, .cursor-glow'),
        hiddenContent: q(hiddenSel).filter((el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0
                && (parseFloat(cs.opacity) < 0.95 || cs.visibility === 'hidden');
        }).length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        docHeight: Math.round(document.documentElement.scrollHeight),
        headline: (() => {
            const h = document.querySelector('h1');
            if (!h) return null;
            const r = h.getBoundingClientRect();
            return {
                text: h.textContent.replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim(),
                box: [Math.round(r.width), Math.round(r.height)],
            };
        })(),
    };
}"""


def crawl(page):
    """Park every reveal container in the viewport, then step down to the bottom."""
    handles = page.evaluate(
        """(sel) => Array.from(document.querySelectorAll(sel)).map((el) => {
            const r = el.getBoundingClientRect();
            return Math.round(r.top + window.scrollY - 120);
        })""",
        CRAWL_SEL,
    )
    for offset in handles:
        page.evaluate(
            "(top) => window.scrollTo({ top, behavior: 'instant' })", offset
        )
        page.wait_for_timeout(900)

    # Stepwise descent so scroll-driven triggers fire like a real read-through.
    page.evaluate(
        """async () => {
            const step = Math.round(window.innerHeight * 0.6);
            for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
                window.scrollTo({ top: y, behavior: 'instant' });
                await new Promise((r) => setTimeout(r, 130));
            }
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        }"""
    )
    page.wait_for_timeout(1800)


def settled_scroll_y(page, timeout_ms=6000, step_ms=200):
    """Poll scrollY until it stops moving (or the timeout expires)."""
    elapsed = 0
    previous = None
    while elapsed < timeout_ms:
        current = page.evaluate("Math.round(window.scrollY)")
        if previous is not None and current == previous:
            return current
        previous = current
        page.wait_for_timeout(step_ms)
        elapsed += step_ms
    return previous


def run_page(browser, base, path):
    result = {}
    for label, opts in (("motion", {}), ("static", {"reduced_motion": "reduce"})):
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, **opts)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on(
            "console",
            lambda m: errors.append("console." + m.type + ": " + m.text) if m.type == "error" else None,
        )
        page.goto(base + path + "?mode=" + label, wait_until="load")
        page.wait_for_timeout(3500)
        top = page.evaluate(PROBE, HIDDEN_SEL)
        crawl(page)
        bottom = page.evaluate(PROBE, HIDDEN_SEL)
        ctx.close()
        result[label] = {"top": top, "bottom": bottom, "errors": errors}

    motion, static = result["motion"], result["static"]
    keys = ("hasGsap", "motionReady", "triggers", "injected")

    check("[%s] no JS errors in either mode" % path,
          not motion["errors"] and not static["errors"],
          {"motion": motion["errors"][:2], "static": static["errors"][:2]})
    check("[%s] layer active in motion mode, inert in reduced mode" % path,
          motion["top"]["hasGsap"] and motion["top"]["motionReady"] and motion["top"]["triggers"] > 0
          and not static["top"]["motionReady"] and static["top"]["triggers"] == 0
          and not static["top"]["injected"],
          {"motion": {k: motion["top"][k] for k in keys},
           "static": {k: static["top"][k] for k in keys}})
    check("[%s] nothing left hidden after a full scroll" % path,
          motion["bottom"]["hiddenContent"] == 0, motion["bottom"]["hiddenContent"])
    check("[%s] page height unchanged by scrolling" % path,
          abs(motion["bottom"]["docHeight"] - motion["top"]["docHeight"]) <= 6,
          {"top": motion["top"]["docHeight"], "bottom": motion["bottom"]["docHeight"]})
    check("[%s] page height matches the static baseline" % path,
          abs(motion["bottom"]["docHeight"] - static["bottom"]["docHeight"]) <= 6,
          {"motion": motion["bottom"]["docHeight"], "static": static["bottom"]["docHeight"]})
    check("[%s] no extra horizontal overflow" % path,
          motion["top"]["overflow"] <= static["top"]["overflow"] + 1,
          {"motion": motion["top"]["overflow"], "static": static["top"]["overflow"]})
    if static["top"]["headline"]:
        check("[%s] headline text and box unchanged" % path,
              motion["top"]["headline"] == static["top"]["headline"],
              {"motion": motion["top"]["headline"], "static": static["top"]["headline"]})
    return result


def interactions(browser, base, path):
    """Probes for the claims that only show up in behaviour, not in pixels."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(base + path + "?probe=interactions", wait_until="load")
    page.wait_for_timeout(3500)

    # Card hover: spotlight custom properties, spot opacity and 3D tilt.
    card = page.locator(".section .item").first
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(1500)
    box = card.bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.75, box["y"] + box["height"] * 0.35)
    page.wait_for_timeout(700)
    hover = card.evaluate(
        """(el) => ({
            spot: getComputedStyle(el).getPropertyValue('--spot').trim(),
            mx: getComputedStyle(el).getPropertyValue('--mx').trim(),
            beforeOpacity: parseFloat(getComputedStyle(el, '::before').opacity),
            transform: getComputedStyle(el).transform,
        })"""
    )
    check("[%s] card spotlight + tilt react to the pointer" % path,
          hover["spot"] == "1" and hover["beforeOpacity"] > 0.5
          and hover["transform"] not in ("none", "matrix(1, 0, 0, 1, 0, 0)"),
          hover)
    page.mouse.move(10, 10)
    page.wait_for_timeout(600)

    # Top bar hides on the way down and returns on the way up.
    page.evaluate("window.scrollTo({ top: 1600, behavior: 'instant' })")
    page.wait_for_timeout(900)
    down = page.evaluate(
        "() => ({ y: window.scrollY, "
        "topbar: getComputedStyle(document.querySelector('.topbar')).visibility, "
        "rail: getComputedStyle(document.querySelector('.scroll-rail-bar')).transform })"
    )
    page.evaluate("window.scrollTo({ top: 300, behavior: 'instant' })")
    page.wait_for_timeout(900)
    up = page.evaluate(
        "() => getComputedStyle(document.querySelector('.topbar')).visibility"
    )
    check("[%s] top bar hides on scroll down, returns on scroll up" % path,
          down["topbar"] == "hidden" and up == "visible", {"down": down, "up": up})
    check("[%s] progress rail advances with the scroll" % path,
          down["rail"] not in ("none", "matrix(1, 0, 0, 1, 0, 0)"), down["rail"])

    # Back-to-top returns to the very top through ScrollToPlugin. The tween is
    # time-based but its start is not, so wait for the scroll position to settle
    # instead of sampling after a fixed delay.
    page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })")
    page.wait_for_timeout(1200)
    visible = page.evaluate(
        "() => getComputedStyle(document.querySelector('.to-top')).visibility"
    )
    page.click(".to-top")
    after = settled_scroll_y(page, timeout_ms=6000)
    check("[%s] back-to-top button scrolls home" % path,
          visible == "visible" and after <= 2, {"visible": visible, "scrollY": after})
    check("[%s] no JS errors during interaction" % path, not errors, errors[:2])
    ctx.close()


def width_sweep(browser, base, path):
    for width in WIDTHS:
        row, heights = {}, {}
        for label, opts in (("motion", {}), ("static", {"reduced_motion": "reduce"})):
            ctx = browser.new_context(viewport={"width": width, "height": 900}, **opts)
            page = ctx.new_page()
            page.goto("%s%s?w=%d&mode=%s" % (base, path, width, label), wait_until="load")
            page.wait_for_timeout(3000)
            row[label] = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            crawl(page)
            heights[label] = page.evaluate("Math.round(document.documentElement.scrollHeight)")
            ctx.close()
        check("@%dpx overflow stays within the static baseline" % width,
              row["motion"] <= row["static"] + 1, row)
        check("@%dpx page height matches the static baseline" % width,
              abs(heights["motion"] - heights["static"]) <= 8, heights)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip("/")
    pages = [p if p.startswith("/") else "/" + p for p in sys.argv[2:]]

    # A server that failed to bind answers 404 for every path, and the whole run
    # then looks like missing assets — fail loudly and early instead.
    for path in pages:
        try:
            status = probe_status(base + path)
        except Exception as exc:  # report and stop
            print("FAIL server does not serve %s (%s)" % (base + path, exc), flush=True)
            return 1
        if status != 200:
            print("FAIL %s answered HTTP %s" % (base + path, status), flush=True)
            return 1
    print("server OK, pages: %s" % ", ".join(pages), flush=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for path in pages:
            run_page(browser, base, path)
        interactions(browser, base, pages[0])
        width_sweep(browser, base, pages[0])
        browser.close()

    print("\n" + ("ALL CHECKS PASSED" if not problems else "%d PROBLEM(S)" % len(problems)), flush=True)
    for line in problems:
        print(" -", line, flush=True)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
