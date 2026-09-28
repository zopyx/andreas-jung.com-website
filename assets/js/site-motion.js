/*!
 * site-motion.js — GSAP motion layer for andreas-jung.com
 *
 * Progressive enhancement only: this file returns before touching the DOM when
 * gsap is missing, when JS is off, or when the visitor asked for reduced motion.
 * Every style it depends on is gated behind `html.motion-ready`, which is added
 * immediately before the first tween — so a JS error can never leave the page
 * half-styled.
 *
 * Vendored (assets/js/vendor/gsap/, pinned 3.13.0, sha256 of the minified build):
 *   gsap.min.js            96c01b81f44a3290e2b4532f55e2c9534b2adc43273a19f3756b2cb41f0fd0b6
 *   ScrollTrigger.min.js   308219390e5e3b84cda0c481e70caa9820883ae10bda44e6e9a149a81aac4b3f
 *   ScrollToPlugin.min.js  48b858c0455a046897107effed2ced0204a69d4315d5bff059986d00e50c56d8
 * Style layer: assets/css/motion.css
 */
(function () {
  'use strict';

  if (!window.gsap) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var gsap = window.gsap;
  var ST = window.ScrollTrigger;
  var STO = window.ScrollToPlugin;
  if (ST) gsap.registerPlugin(ST);
  if (STO) gsap.registerPlugin(STO);

  var FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var MAX_TILT_X = 2.5;
  var MAX_TILT_Y = 3;
  var MAGNET = 5;
  var TOPBAR_HIDE_AFTER = 280;
  var TOPBAR_SHOW_BEFORE = 80;

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  /* ------------------------------------------------------------------ *
   * Helpers                                                             *
   * ------------------------------------------------------------------ */

  /* Wrap every word of an element in an inline-block unit so it can be
     animated on its own. Elements that clip their text to a background must
     never be split (Chromium breaks the clip), so they are skipped. */
  function splitWords(el) {
    if (!el || el.dataset.motionSplit === '1') return [];
    var cs = window.getComputedStyle(el);
    var clip = cs.webkitBackgroundClip || cs.backgroundClip;
    if (clip === 'text') return [];

    var words = [];

    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var text = child.nodeValue;
          if (!text || !/\S/.test(text)) return;
          var frag = document.createDocumentFragment();
          text.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
              return;
            }
            var span = document.createElement('span');
            span.className = 'motion-word';
            /* Keep the break opportunity of a hyphenated word. */
            span.textContent = part.replace(/-/g, '-\u200b');
            frag.appendChild(span);
            words.push(span);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          walk(child);
        }
      });
    })(el);

    if (words.length) el.dataset.motionSplit = '1';
    return words;
  }

  /* Count the first number of an element up from zero and restore the exact
     original markup once it settles. */
  function countUp(el, duration, delay) {
    if (!el) return;
    var original = el.innerHTML;
    var match = /\d+/.exec(el.textContent || '');
    if (!match) return;
    var target = parseInt(match[0], 10);
    if (!target) return;
    var markup = original.replace(match[0], '<span class="motion-count">0</span>');
    if (markup === original) return;

    el.innerHTML = markup;
    var out = el.querySelector('.motion-count');
    var counter = { value: 0 };

    gsap.to(counter, {
      value: target,
      duration: duration || 1.4,
      delay: delay || 0,
      ease: 'power2.out',
      onUpdate: function () {
        out.textContent = String(Math.round(counter.value));
      },
      onComplete: function () {
        el.innerHTML = original;
      },
    });
  }

  /* Spotlight + a small 3D tilt, bound only for fine pointers and only after
     the element's own reveal finished (both would otherwise own transform). */
  function attachInteractive(el) {
    if (!FINE_POINTER || !el || el.dataset.motionInteractive === '1') return;
    el.dataset.motionInteractive = '1';

    gsap.set(el, { transformPerspective: 900 });
    var rotX = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
    var rotY = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
    var lift = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3' });

    el.addEventListener('pointerenter', function () {
      lift(-3);
    });

    el.addEventListener('pointermove', function (event) {
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var px = (event.clientX - rect.left) / rect.width;
      var py = (event.clientY - rect.top) / rect.height;
      el.style.setProperty('--mx', (px * 100).toFixed(2) + '%');
      el.style.setProperty('--my', (py * 100).toFixed(2) + '%');
      el.style.setProperty('--spot', '1');
      rotY((px - 0.5) * 2 * MAX_TILT_Y);
      rotX((0.5 - py) * 2 * MAX_TILT_X);
    });

    el.addEventListener('pointerleave', function () {
      el.style.setProperty('--spot', '0');
      rotX(0);
      rotY(0);
      lift(0);
    });
  }

  function magnetise(el) {
    if (!FINE_POINTER || !el) return;
    var moveX = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3' });
    var moveY = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3' });

    el.addEventListener('pointermove', function (event) {
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var px = (event.clientX - rect.left) / rect.width - 0.5;
      var py = (event.clientY - rect.top) / rect.height - 0.5;
      moveX(px * 2 * MAGNET);
      moveY(py * 2 * MAGNET);
    });

    el.addEventListener('pointerleave', function () {
      moveX(0);
      moveY(0);
    });
  }

  /* ------------------------------------------------------------------ *
   * Effects                                                             *
   * ------------------------------------------------------------------ */

  function heroIntro() {
    var hero = one('.hero-profile');
    if (!hero) return;

    var topbar = one('.topbar');
    var profile = one('.profile', hero);
    var name = one('.name', hero);
    var tagline = one('.tagline', hero);
    var sub = one('.tagline-sub', hero);
    var cta = one('.hero-cta', hero);
    var cards = all('.hero-panel .info-card');
    var nameWords = splitWords(name);
    var taglineWords = splitWords(tagline);

    var tl = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: function () {
        cards.forEach(attachInteractive);
      },
    });

    if (topbar) tl.from(topbar, { y: -34, autoAlpha: 0, duration: 0.7 }, 0);
    if (profile) tl.from(profile, { scale: 0.86, autoAlpha: 0, duration: 0.9 }, 0.1);
    if (nameWords.length) {
      tl.from(nameWords, { y: 26, autoAlpha: 0, duration: 0.8, stagger: 0.07 }, 0.25);
    }
    if (taglineWords.length) {
      tl.from(taglineWords, { y: 14, autoAlpha: 0, duration: 0.5, stagger: 0.02 }, 0.5);
    }
    if (sub) tl.from(sub, { y: 12, autoAlpha: 0, duration: 0.6 }, 0.8);
    if (cta) tl.from(cta, { y: 16, autoAlpha: 0, duration: 0.6 }, 1.0);
    if (cards.length) {
      tl.from(cards, { y: 26, autoAlpha: 0, duration: 0.6, stagger: 0.07 }, 1.05);
    }

    countUp(sub, 1.4, 1.3);

    if (FINE_POINTER) {
      all('.hero-cta-btn, .topbar-slides').forEach(magnetise);
    }
  }

  function sectionReveals() {
    all('.section').forEach(function (section) {
      var title = one('.section-title', section);
      var icon = title ? one('.icon-holder', title) : null;
      var titleWords = splitWords(title);
      var items = all(':scope > .item', section);

      var tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top 78%',
          toggleActions: 'play none none none',
        },
      });

      if (icon) tl.from(icon, { scale: 0.7, autoAlpha: 0, duration: 0.6 }, 0);
      if (icon) {
        tl.fromTo(
          section,
          { '--shine': -300 },
          { '--shine': 340, duration: 0.9, ease: 'power2.inOut' },
          0.2
        );
      }
      if (titleWords.length) {
        tl.from(titleWords, { y: 18, autoAlpha: 0, duration: 0.55, stagger: 0.05 }, 0.08);
      }
      tl.to(section, { '--title-bar': 1, duration: 0.8, ease: 'power2.out' }, 0.15);

      if (items.length) {
        tl.from(
          items,
          {
            y: 26,
            autoAlpha: 0,
            duration: 0.6,
            stagger: 0.07,
            onComplete: function () {
              items.forEach(attachInteractive);
            },
          },
          '-=0.35'
        );
      }
    });
  }

  /* Hide the fixed top bar while scrolling down, bring it back on the way up.
     A numeric open-ended `end` keeps the trigger alive at the very bottom of
     the document, where `end: 'max'` would deactivate it. */
  function headerPeek() {
    var topbar = one('.topbar');
    if (!topbar) return;

    var hidden = false;

    ST.create({
      start: 0,
      end: 9999999,
      onUpdate: function (self) {
        var y = self.scroll();
        if (self.direction === 1) {
          if (y > TOPBAR_HIDE_AFTER && !hidden) {
            hidden = true;
            gsap.to(topbar, {
              yPercent: -180,
              autoAlpha: 0,
              duration: 0.35,
              ease: 'power2.out',
              overwrite: true,
            });
          } else if (y < TOPBAR_SHOW_BEFORE && hidden) {
            hidden = false;
            gsap.to(topbar, {
              yPercent: 0,
              autoAlpha: 1,
              duration: 0.35,
              ease: 'power2.out',
              overwrite: true,
            });
          }
        } else if (hidden) {
          hidden = false;
          gsap.to(topbar, {
            yPercent: 0,
            autoAlpha: 1,
            duration: 0.35,
            ease: 'power2.out',
            overwrite: true,
          });
        }
      },
    });
  }

  function progressRail() {
    var rail = document.createElement('div');
    rail.className = 'scroll-rail';
    rail.setAttribute('aria-hidden', 'true');
    var bar = document.createElement('span');
    bar.className = 'scroll-rail-bar';
    rail.appendChild(bar);
    document.body.appendChild(rail);

    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.3 },
    });
  }

  function backToTop() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'to-top';
    button.setAttribute(
      'aria-label',
      /^de/i.test(document.documentElement.lang || '') ? 'Nach oben' : 'Back to top'
    );
    button.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    document.body.appendChild(button);

    gsap.set(button, { autoAlpha: 0, y: 16, scale: 0.92 });

    ST.create({
      start: 500,
      end: 9999999,
      onToggle: function (self) {
        gsap.to(button, {
          autoAlpha: self.isActive ? 1 : 0,
          y: self.isActive ? 0 : 16,
          scale: self.isActive ? 1 : 0.92,
          duration: 0.3,
          ease: 'power2.out',
          overwrite: true,
        });
      },
    });

    button.addEventListener('click', function () {
      if (STO) {
        gsap.to(window, {
          scrollTo: { y: 0, autoKill: true },
          duration: 0.9,
          ease: 'power2.inOut',
        });
      } else {
        window.scrollTo(0, 0);
      }
    });
  }

  /* Slow horizontal drift of the tinted corner bloom. The pseudo element is
     clipped by .section's overflow, so it can never grow the document. */
  function bloomDrift() {
    all('.section').forEach(function (section) {
      gsap.fromTo(
        section,
        { '--bloom-x': -28 },
        {
          '--bloom-x': 28,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.6,
          },
        }
      );
    });
  }

  /* ------------------------------------------------------------------ *
   * Start                                                               *
   * ------------------------------------------------------------------ */

  document.documentElement.classList.add('motion-ready');
  gsap.defaults({ ease: 'power3.out' });
  gsap.set('.section', { '--title-bar': 0 });

  heroIntro();
  sectionReveals();

  if (ST) {
    headerPeek();
    progressRail();
    backToTop();
    bloomDrift();

    window.addEventListener('load', function () {
      ST.refresh();
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        ST.refresh();
      });
    }
  }
})();
