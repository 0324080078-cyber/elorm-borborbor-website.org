// /workspaces/elorm-borborbor-website.org/client/js/main.js
// Main UI script: navigation, animations, lazy-loading, performance & error reporting
// Author: GitHub Copilot (automated scaffolding — review & adapt for production)

(function () {
    'use strict';

    /* =========================
         Utility helpers & config
         ========================= */
    const cfg = {
        selectors: {
            header: '.site-header',
            navToggle: '.nav-toggle',
            nav: '.site-nav',
            navLinks: '.site-nav a[href^="#"]',
            lazy: 'img[data-src],img[data-srcset],iframe[data-src]',
            animatable: '[data-animate]',
            culture: '[data-culture]',
            loader: '.site-loader',
        },
        classes: {
            sticky: 'is-sticky',
            open: 'is-open',
            visible: 'is-visible',
            loaded: 'is-loaded',
            loading: 'is-loading',
            lazyLoaded: 'lazy-loaded',
        },
        lazyRootMargin: '200px 0px',
        animRootMargin: '0px 0px -10% 0px',
        perfEndpoint: '/__client_performance',
        errEndpoint: '/__client_error',
        maxErrorReportsPerSession: 5,
    };

    let errorCount = 0;

    function safe(fn) {
        return function (...args) {
            try {
                return fn.apply(this, args);
            } catch (err) {
                reportError(err, { context: fn.name || 'anonymous' });
            }
        };
    }

    function reportError(error, meta = {}) {
        try {
            errorCount++;
            if (errorCount > cfg.maxErrorReportsPerSession) return;

            const payload = {
                message: error && error.message ? error.message : String(error),
                stack: error && error.stack ? error.stack : null,
                meta,
                userAgent: navigator.userAgent,
                url: location.href,
                ts: Date.now(),
            };

            // Try navigator.sendBeacon for reliability
            if (navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                navigator.sendBeacon(cfg.errEndpoint, blob);
            } else {
                fetch(cfg.errEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive: true,
                }).catch(() => {});
            }
        } catch (e) {
            // Swallow all reporting errors to avoid recursion
            /* noop */
        }
    }

    window.addEventListener('error', (ev) => {
        reportError(ev.error || ev.message || 'Unknown error', { source: 'window.error', filename: ev.filename, lineno: ev.lineno, colno: ev.colno });
    });

    window.addEventListener('unhandledrejection', (ev) => {
        reportError(ev.reason || 'Unhandled rejection', { source: 'unhandledrejection' });
    });

    /* =========================
         Loading state management
         ========================= */
    function setLoadingState(isLoading) {
        const root = document.documentElement;
        if (isLoading) root.classList.add(cfg.classes.loading);
        else root.classList.remove(cfg.classes.loading);
    }

    // Show a loader if present until page load or timeout
    function initLoader() {
        setLoadingState(true);
        const loader = document.querySelector(cfg.selectors.loader);
        const clear = () => {
            setLoadingState(false);
            if (loader) loader.classList.remove(cfg.classes.visible);
        };

        window.addEventListener('load', () => {
            // allow CSS animation to finish
            setTimeout(clear, 200);
        }, { once: true });

        // Fallback timeout (in case of slow assets)
        setTimeout(clear, 8000);
    }

    /* =========================
         Sticky header behavior
         ========================= */
    function initStickyHeader() {
        const header = document.querySelector(cfg.selectors.header);
        if (!header) return;

        let lastKnownScrollY = 0;
        let ticking = false;
        const headerHeight = () => header.getBoundingClientRect().height;

        function update() {
            const y = window.scrollY || window.pageYOffset;
            if (y > headerHeight()) header.classList.add(cfg.classes.sticky);
            else header.classList.remove(cfg.classes.sticky);
            ticking = false;
        }

        window.addEventListener('scroll', () => {
            lastKnownScrollY = window.scrollY;
            if (!ticking) {
                window.requestAnimationFrame(update);
                ticking = true;
            }
        });
    }

    /* =========================
         Mobile menu toggle
         ========================= */
    function initMobileMenu() {
        const toggle = document.querySelector(cfg.selectors.navToggle);
        const nav = document.querySelector(cfg.selectors.nav);
        if (!toggle || !nav) return;

        toggle.addEventListener('click', safe(() => {
            const isOpen = nav.classList.toggle(cfg.classes.open);
            toggle.setAttribute('aria-expanded', String(isOpen));
            document.body.style.overflow = isOpen ? 'hidden' : '';
        }));

        // Close when a link is clicked (helpful for single-page navigation)
        document.querySelectorAll(cfg.selectors.navLinks).forEach((link) => {
            link.addEventListener('click', () => {
                nav.classList.remove(cfg.classes.open);
                if (toggle) toggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            });
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                nav.classList.remove(cfg.classes.open);
                if (toggle) toggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            }
        });
    }

    /* =========================
         Smooth scrolling navigation
         ========================= */
    function initSmoothScroll() {
        const header = document.querySelector(cfg.selectors.header);
        const headerHeight = () => (header ? header.getBoundingClientRect().height : 0);

        document.querySelectorAll('a[href^="#"]').forEach((a) => {
            // ignore external anchors or empty hashes
            if (a.getAttribute('href') === '#' || a.dataset.noSmooth === 'true') return;
            a.addEventListener('click', safe((ev) => {
                const href = a.getAttribute('href');
                if (!href || href.charAt(0) !== '#') return;
                const target = document.getElementById(href.slice(1));
                if (!target) return;
                ev.preventDefault();

                const targetRect = target.getBoundingClientRect();
                const offset = window.scrollY + targetRect.top - headerHeight() - 8; // small gap

                window.scrollTo({
                    top: offset,
                    behavior: 'smooth',
                });

                // Update history without jump
                if (history.pushState) {
                    history.pushState(null, '', href);
                } else {
                    location.hash = href;
                }
            }));
        });
    }

    /* =========================
         Lazy loading implementation
         ========================= */
    function initLazyLoading() {
        const lazyElements = Array.from(document.querySelectorAll(cfg.selectors.lazy));
        if (!lazyElements.length) return;

        const onIntersection = (entries, io) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                try {
                    if (el.dataset.src) {
                        el.src = el.dataset.src;
                        el.removeAttribute('data-src');
                    }
                    if (el.dataset.srcset) {
                        el.srcset = el.dataset.srcset;
                        el.removeAttribute('data-srcset');
                    }
                    // For <picture> with data-src on source elements
                    const parent = el.closest('picture');
                    if (parent) {
                        parent.querySelectorAll('source[data-srcset]').forEach((s) => {
                            s.srcset = s.dataset.srcset;
                            s.removeAttribute('data-srcset');
                        });
                    }

                    el.classList.add(cfg.classes.lazyLoaded);
                } catch (err) {
                    reportError(err, { context: 'lazy-load' });
                } finally {
                    io.unobserve(el);
                }
            });
        };

        const observer = new IntersectionObserver(onIntersection, {
            root: null,
            rootMargin: cfg.lazyRootMargin,
            threshold: 0.01,
        });

        lazyElements.forEach((el) => observer.observe(el));
    }

    /* =========================
         Scroll-triggered animations & cultural animations
         ========================= */
    function initScrollAnimations() {
        const nodes = Array.from(document.querySelectorAll(cfg.selectors.animatable));
        if (!nodes.length) return;

        const onIntersect = (entries, io) => {
            entries.forEach((entry) => {
                const el = entry.target;
                if (entry.isIntersecting) {
                    const delay = parseFloat(el.dataset.delay) || 0;
                    const duration = parseFloat(el.dataset.duration) || 1;
                    // Apply inline styles to allow stagger/duration from data attributes
                    if (delay) el.style.transitionDelay = `${delay}s`;
                    if (duration) el.style.transitionDuration = `${duration}s`;
                    el.classList.add(cfg.classes.visible);

                    // Cultural elements may need extra staggered children animation
                    if (el.matches(cfg.selectors.culture) || el.querySelector(cfg.selectors.culture)) {
                        animateCulturalElements(el);
                    }

                    io.unobserve(el);
                }
            });
        };

        const observer = new IntersectionObserver(onIntersect, {
            root: null,
            rootMargin: cfg.animRootMargin,
            threshold: 0.12,
        });

        nodes.forEach((n) => observer.observe(n));
    }

    function animateCulturalElements(elRoot) {
        try {
            const culturalItems = elRoot.matches(cfg.selectors.culture)
                ? [elRoot]
                : Array.from(elRoot.querySelectorAll(cfg.selectors.culture));
            culturalItems.forEach((el, idx) => {
                const baseDelay = parseFloat(el.dataset.baseDelay) || 0.06;
                const totalDelay = (parseFloat(el.dataset.delay) || 0) + idx * baseDelay;
                el.style.transitionDelay = `${totalDelay}s`;
                el.classList.add(cfg.classes.visible);
                // small transform tweak for richness
                el.style.willChange = 'transform, opacity';
            });
        } catch (err) {
            reportError(err, { context: 'cultural-animate' });
        }
    }

    /* =========================
         Performance monitoring
         ========================= */
    function initPerformanceMonitoring() {
        // collect paint & longtask metrics
        const metrics = {};

        try {
            if ('PerformanceObserver' in window) {
                const po = new PerformanceObserver((list) => {
                    list.getEntries().forEach((entry) => {
                        if (entry.entryType === 'paint') {
                            metrics[entry.name] = entry.startTime;
                        } else if (entry.entryType === 'longtask') {
                            metrics.longTasks = metrics.longTasks || [];
                            metrics.longTasks.push({
                                start: entry.startTime,
                                duration: entry.duration,
                            });
                        }
                    });
                });

                try {
                    po.observe({ type: 'paint', buffered: true });
                } catch (e) {
                    // some browsers require separate calls
                    try { po.observe({ entryTypes: ['paint'] }); } catch (_) {}
                }
                try {
                    po.observe({ type: 'longtask', buffered: true });
                } catch (e) {
                    /* ignore if not supported */
                }
            }

            // Send metrics after load or after a short delay
            const sendMetrics = () => {
                try {
                    // enrich with navigation timing if available
                    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
                    const payload = {
                        metrics,
                        navigation: nav ? {
                            domContentLoaded: nav.domContentLoadedEventEnd,
                            loadEvent: nav.loadEventEnd,
                            type: nav.type,
                            duration: nav.duration,
                        } : null,
                        ua: navigator.userAgent,
                        url: location.href,
                        ts: Date.now(),
                    };

                    if (navigator.sendBeacon) {
                        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                        navigator.sendBeacon(cfg.perfEndpoint, blob);
                    } else {
                        fetch(cfg.perfEndpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            keepalive: true,
                        }).catch(() => {});
                    }
                } catch (err) {
                    // swallow
                }
            };

            window.addEventListener('load', () => {
                setTimeout(sendMetrics, 2000); // let paints settle
            });

            // Also schedule a periodic send for single page app route changes (if app uses pushState)
            let historyHooked = false;
            function hookHistory() {
                if (historyHooked) return;
                historyHooked = true;
                const origPush = history.pushState;
                history.pushState = function () {
                    origPush.apply(this, arguments);
                    setTimeout(sendMetrics, 1000);
                };
            }
            hookHistory();
        } catch (err) {
            reportError(err, { context: 'perf-init' });
        }
    }

    /* =========================
         Initialization
         ========================= */
    function init() {
        try {
            initLoader();
            initStickyHeader();
            initMobileMenu();
            initSmoothScroll();
            initLazyLoading();
            initScrollAnimations();
            initPerformanceMonitoring();
        } catch (err) {
            reportError(err, { context: 'init' });
        }
    }

    // Kick off when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safe(init));
    } else {
        safe(init)();
    }

    // Expose a minimal API for advanced integrations
    window.SiteClient = {
        reportError,
        refreshLazy: safe(initLazyLoading),
        refreshAnimations: safe(initScrollAnimations),
    };
})();