// /workspaces/elorm-borborbor-website.org/client/js/gallery.js
// Lightbox + Filtering gallery system (vanilla JS)
// Assumes gallery items markup like:
// <div class="gallery">
//   <div class="gallery-item" data-id="1" data-type="image" data-src="/media/img1.jpg" data-title="Title" data-category="nature" data-date="2024-01-01">...</div>
//   ...
// </div>
// Controls expected (optional): .filter-btn[data-filter], #searchInput, #sortSelect
// This file creates a lightbox modal, keyboard & touch nav, download protection, share, fullscreen,
// plus category filtering, search, sort and URL state management.

(() => {
    const selector = {
        gallery: '.gallery',
        item: '.gallery-item',
        filterButtons: '.filter-btn',
        searchInput: '#searchInput',
        sortSelect: '#sortSelect',
    };

    // State
    const state = {
        items: [], // DOM elements
        visibleIndices: [], // indices of items currently visible after filtering
        currentIndex: -1,
        touch: { startX: 0, startY: 0, moving: false },
    };

    // Utilities
    const q = (s, root = document) => root.querySelector(s);
    const qa = (s, root = document) => Array.from(root.querySelectorAll(s));
    const attr = (el, name) => el && el.getAttribute(name);
    const parseDate = (s) => (s ? new Date(s) : null);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const sanitizeText = (t) => (t || '').toString();

    // URL state keys
    const urlKeys = { q: 'q', cat: 'cat', sort: 'sort' };

    // Initialize
    function init() {
        const galleryRoot = q(selector.gallery);
        if (!galleryRoot) return;

        state.items = qa(selector.item, galleryRoot);
        state.items.forEach((el, i) => {
            el.dataset._index = i;
            // Prevent default image download via right-click or drag on any nested images/videos
            qa('img, video', el).forEach(media => {
                media.addEventListener('contextmenu', (e) => e.preventDefault());
                media.addEventListener('dragstart', (e) => e.preventDefault());
                media.setAttribute('draggable', 'false');
                // Touch-action none for mobile
                media.style.userSelect = 'none';
                media.style.webkitUserDrag = 'none';
            });

            // Click opens lightbox
            el.addEventListener('click', (ev) => {
                if (ev.target && (ev.target.matches('a') || ev.target.closest('a'))) {
                    // respect actual anchor clicks (like links)
                    return;
                }
                openLightbox(i);
            });
        });

        // Controls
        qa(selector.filterButtons).forEach(btn => btn.addEventListener('click', onFilterClick));
        const si = q(selector.searchInput);
        if (si) {
            si.addEventListener('input', onSearchInput);
            si.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') e.preventDefault();
            });
        }
        const ss = q(selector.sortSelect);
        if (ss) ss.addEventListener('change', onSortChange);

        // Read URL state and apply
        applyStateFromURL();

        // Listen for back/forward navigation
        window.addEventListener('popstate', applyStateFromURL);
    }

    // Filtering / Search / Sort
    function onFilterClick(e) {
        const btn = e.currentTarget;
        const value = btn.dataset.filter || '';
        const current = btn.classList.contains('active');
        // toggle
        qa(selector.filterButtons).forEach(b => b.classList.remove('active'));
        if (!current) btn.classList.add('active');
        updateURLAndFilter();
    }

    function onSearchInput(_e) {
        updateURLAndFilter();
    }

    function onSortChange(_e) {
        updateURLAndFilter();
    }

    function updateURLAndFilter(replace = false) {
        const qEl = q(selector.searchInput);
        const query = qEl ? qEl.value.trim() : '';
        const activeFilter = (qa(selector.filterButtons).find(b => b.classList.contains('active')) || {}).dataset?.filter || '';
        const sortVal = (q(selector.sortSelect) || {}).value || '';

        const params = new URLSearchParams(window.location.search);
        if (query) params.set(urlKeys.q, query); else params.delete(urlKeys.q);
        if (activeFilter) params.set(urlKeys.cat, activeFilter); else params.delete(urlKeys.cat);
        if (sortVal) params.set(urlKeys.sort, sortVal); else params.delete(urlKeys.sort);

        const newUrl = `${location.pathname}${params.toString() ? '?' + params.toString() : ''}${location.hash}`;
        if (replace) history.replaceState({}, '', newUrl);
        else history.pushState({}, '', newUrl);

        applyFilterSearchSort();
    }

    function applyStateFromURL() {
        const params = new URLSearchParams(window.location.search);
        const qVal = params.get(urlKeys.q) || '';
        const catVal = params.get(urlKeys.cat) || '';
        const sortVal = params.get(urlKeys.sort) || '';

        const qEl = q(selector.searchInput);
        if (qEl) qEl.value = qVal;

        qa(selector.filterButtons).forEach(b => {
            if ((b.dataset.filter || '') === catVal) b.classList.add('active'); else b.classList.remove('active');
        });

        const ss = q(selector.sortSelect);
        if (ss) ss.value = sortVal || '';

        applyFilterSearchSort();
    }

    function applyFilterSearchSort() {
        const params = new URLSearchParams(window.location.search);
        const query = (params.get(urlKeys.q) || '').toLowerCase();
        const category = params.get(urlKeys.cat) || '';
        const sortVal = params.get(urlKeys.sort) || '';

        // Filter
        state.visibleIndices = [];
        state.items.forEach((el, i) => {
            const title = (attr(el, 'data-title') || '').toLowerCase();
            const cats = (attr(el, 'data-category') || '').split(',').map(s => s.trim()).filter(Boolean);
            const matchQuery = !query || title.includes(query);
            const matchCat = !category || cats.includes(category);
            if (matchQuery && matchCat) {
                el.style.display = '';
                state.visibleIndices.push(i);
            } else {
                el.style.display = 'none';
            }
        });

        // Sort visible items in DOM if requested (reorder DOM nodes)
        if (sortVal) {
            const [key, dir] = sortVal.split('-'); // expected like 'name-asc' or 'date-desc'
            const compare = (aEl, bEl) => {
                let aVal = '', bVal = '';
                if (key === 'name') {
                    aVal = sanitizeText(attr(aEl, 'data-title')).toLowerCase();
                    bVal = sanitizeText(attr(bEl, 'data-title')).toLowerCase();
                } else if (key === 'date') {
                    aVal = parseDate(attr(aEl, 'data-date')) || new Date(0);
                    bVal = parseDate(attr(bEl, 'data-date')) || new Date(0);
                } else {
                    aVal = sanitizeText(attr(aEl, 'data-title')).toLowerCase();
                    bVal = sanitizeText(attr(bEl, 'data-title')).toLowerCase();
                }
                if (aVal < bVal) return dir === 'asc' ? -1 : 1;
                if (aVal > bVal) return dir === 'asc' ? 1 : -1;
                return 0;
            };

            const parent = state.items[0] && state.items[0].parentElement;
            if (parent) {
                // create ordered list of visible elements
                const visibleEls = state.visibleIndices.map(i => state.items[i]);
                visibleEls.sort(compare);
                // append in new order
                visibleEls.forEach(el => parent.appendChild(el));
                // refresh items list order in the state (recompute indices)
                state.items = qa(selector.item, parent);
                state.items.forEach((el, idx) => el.dataset._index = idx);
                // recompute visibleIndices
                state.visibleIndices = [];
                state.items.forEach((el, i) => {
                    if (el.style.display !== 'none') state.visibleIndices.push(i);
                });
            }
        }
    }

    // Lightbox / Modal
    let modal = null;
    function buildModal() {
        if (modal) return modal;
        modal = document.createElement('div');
        modal.className = 'gb-lightbox';
        modal.innerHTML = `
            <div class="gb-overlay" tabindex="-1"></div>
            <div class="gb-panel" role="dialog" aria-modal="true">
                <button class="gb-close" aria-label="Close">&times;</button>
                <div class="gb-mediaWrap"></div>
                <div class="gb-caption">
                    <div class="gb-title"></div>
                    <div class="gb-meta"></div>
                </div>
                <div class="gb-controls">
                    <button class="gb-prev" aria-label="Previous">&#10094;</button>
                    <button class="gb-next" aria-label="Next">&#10095;</button>
                    <button class="gb-download" aria-label="Download">Download</button>
                    <button class="gb-share" aria-label="Share">Share</button>
                    <button class="gb-fullscreen" aria-label="Fullscreen">⤢</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // listeners
        modal.querySelector('.gb-close').addEventListener('click', closeLightbox);
        modal.querySelector('.gb-overlay').addEventListener('click', closeLightbox);
        modal.querySelector('.gb-prev').addEventListener('click', () => showRelative(-1));
        modal.querySelector('.gb-next').addEventListener('click', () => showRelative(1));
        modal.querySelector('.gb-download').addEventListener('click', onDownload);
        modal.querySelector('.gb-share').addEventListener('click', onShare);
        modal.querySelector('.gb-fullscreen').addEventListener('click', toggleFullscreen);

        // keyboard
        document.addEventListener('keydown', onKeyDown);

        // touch
        const mediaWrap = modal.querySelector('.gb-mediaWrap');
        mediaWrap.addEventListener('touchstart', onTouchStart, { passive: true });
        mediaWrap.addEventListener('touchmove', onTouchMove, { passive: false });
        mediaWrap.addEventListener('touchend', onTouchEnd, { passive: true });

        return modal;
    }

    function openLightbox(index) {
        if (!state.items.length) return;
        state.currentIndex = clamp(index, 0, state.items.length - 1);
        buildModal();
        modal.classList.add('open');
        showSlide(state.currentIndex);
        // focus dialog for accessibility
        modal.querySelector('.gb-panel').focus();
    }

    function closeLightbox() {
        if (!modal) return;
        modal.classList.remove('open');
        // cleanup media
        const mediaWrap = modal.querySelector('.gb-mediaWrap');
        mediaWrap.innerHTML = '';
        state.currentIndex = -1;
        // exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }

    function showSlide(index) {
        state.currentIndex = clamp(index, 0, state.items.length - 1);
        const el = state.items[state.currentIndex];
        if (!el) return;
        const type = (attr(el, 'data-type') || 'image').toLowerCase();
        const src = attr(el, 'data-src') || '';
        const title = sanitizeText(attr(el, 'data-title') || '');
        const date = sanitizeText(attr(el, 'data-date') || '');
        const meta = sanitizeText(attr(el, 'data-category') || '');

        const mediaWrap = modal.querySelector('.gb-mediaWrap');
        mediaWrap.innerHTML = '';

        if (type === 'video') {
            const video = document.createElement('video');
            video.controls = true;
            video.preload = 'metadata';
            video.src = src;
            video.setAttribute('playsinline', '');
            video.style.maxWidth = '100%';
            video.style.maxHeight = '80vh';
            // protect from right-click/drag
            video.addEventListener('contextmenu', e => e.preventDefault());
            video.addEventListener('dragstart', e => e.preventDefault());
            mediaWrap.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.alt = title || '';
            img.src = src;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '80vh';
            img.addEventListener('contextmenu', e => e.preventDefault());
            img.addEventListener('dragstart', e => e.preventDefault());
            mediaWrap.appendChild(img);
        }

        modal.querySelector('.gb-title').textContent = title;
        modal.querySelector('.gb-meta').textContent = `${meta}${date ? ' • ' + date : ''}`;

        // Update prev/next visibility based on visibleIndices (so filtering reflects)
        const vis = state.visibleIndices;
        if (vis.length) {
            const pos = vis.indexOf(state.currentIndex);
            modal.querySelector('.gb-prev').disabled = pos <= 0;
            modal.querySelector('.gb-next').disabled = pos === -1 || pos >= vis.length - 1;
        } else {
            modal.querySelector('.gb-prev').disabled = state.currentIndex <= 0;
            modal.querySelector('.gb-next').disabled = state.currentIndex >= state.items.length - 1;
        }
    }

    function showRelative(delta) {
        // navigate among visible items if filtering applied
        const vis = state.visibleIndices;
        if (vis.length) {
            const pos = vis.indexOf(state.currentIndex);
            if (pos === -1) {
                // current not visible, jump to first/last
                const newIdx = delta > 0 ? vis[0] : vis[vis.length - 1];
                showSlide(newIdx);
            } else {
                const newPos = clamp(pos + delta, 0, vis.length - 1);
                showSlide(vis[newPos]);
            }
        } else {
            showSlide(state.currentIndex + delta);
        }
    }

    // Keyboard handlers
    function onKeyDown(e) {
        if (!modal || !modal.classList.contains('open')) return;
        if (e.key === 'Escape') { closeLightbox(); }
        else if (e.key === 'ArrowRight') { showRelative(1); }
        else if (e.key === 'ArrowLeft') { showRelative(-1); }
        else if (e.key.toLowerCase() === 'f') { toggleFullscreen(); }
        else if (e.key.toLowerCase() === 's') { onShare(); }
        else if (e.key.toLowerCase() === 'd') { onDownload(); }
    }

    // Touch swipe
    function onTouchStart(e) {
        if (!e.touches || e.touches.length === 0) return;
        state.touch.startX = e.touches[0].clientX;
        state.touch.startY = e.touches[0].clientY;
        state.touch.moving = true;
    }
    function onTouchMove(e) {
        if (!state.touch.moving || !e.touches || e.touches.length === 0) return;
        const dx = e.touches[0].clientX - state.touch.startX;
        const dy = e.touches[0].clientY - state.touch.startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
            e.preventDefault();
        }
    }
    function onTouchEnd(e) {
        if (!state.touch.moving) return;
        const endX = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || state.touch.startX;
        const dx = endX - state.touch.startX;
        state.touch.moving = false;
        if (Math.abs(dx) > 50) {
            if (dx < 0) showRelative(1);
            else showRelative(-1);
        }
    }

    // Download protection & controlled download (fetch blob)
    async function onDownload() {
        if (state.currentIndex < 0) return;
        const el = state.items[state.currentIndex];
        const src = attr(el, 'data-src') || '';
        if (!src) return;
        try {
            // fetch as blob then create objectURL to trigger download (makes direct URL less visible)
            const resp = await fetch(src, { credentials: 'same-origin' });
            if (!resp.ok) throw new Error('Network error');
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const filename = (attr(el, 'data-filename') || src.split('/').pop() || 'download');
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
            // fallback to opening in new tab (as last resort)
            window.open(src, '_blank', 'noopener');
        }
    }

    // Social sharing
    function onShare() {
        if (state.currentIndex < 0) return;
        const el = state.items[state.currentIndex];
        const title = sanitizeText(attr(el, 'data-title') || document.title);
        const src = attr(el, 'data-src') || location.href;
        const shareData = {
            title,
            text: title,
            url: src
        };
        if (navigator.share) {
            navigator.share(shareData).catch(() => {});
        } else {
            // fallback: open share links in new window
            const shareUrl = encodeURIComponent(src);
            const shareText = encodeURIComponent(title);
            const urls = {
                twitter: `https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}`,
                facebook: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
                linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`
            };
            const popup = window.open(urls.twitter, 'share', 'width=600,height=400');
            if (!popup) {
                // if blocked, show small UI
                alert('Share URL: ' + src);
            }
        }
    }

    // Fullscreen
    function toggleFullscreen() {
        const panel = modal && modal.querySelector('.gb-panel');
        if (!panel) return;
        if (!document.fullscreenElement) {
            panel.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    }

    // Public init call
    document.addEventListener('DOMContentLoaded', init);

    // Expose for debugging if needed
    window.GalleryLightbox = {
        open: openLightbox,
        close: closeLightbox,
        applyFilterSearchSort,
        updateURLAndFilter,
        getState: () => state
    };
})();