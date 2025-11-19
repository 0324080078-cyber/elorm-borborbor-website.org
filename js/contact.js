/**
 * contact.js
 *
 * Robust multi-step contact form handling:
 * - Real-time validation (with debouncing)
 * - Cultural-specific validations (locale-aware name & phone rules)
 * - Phone formatting per locale
 * - Email syntax + disposable domain checks
 * - Required field management and UX
 * - Multi-step progression with persist + restore via localStorage
 * - Submission with success/error states and auto-response simulation
 * - Analytics tracking (dataLayer + optional beacon)
 *
 * Usage:
 * - HTML should include:
 *   <form id="contactForm" novalidate>
 *     <div data-step="1"> ... step 1 fields ... </div>
 *     <div data-step="2"> ... step 2 fields ... </div>
 *     <div data-step="3"> ... step 3 fields ... </div>
 *   </form>
 * - Fields should have "name" attributes and optionally "data-required"="true"
 * - Phone inputs can carry data-type="phone"
 * - Email inputs should be type="email"
 *
 * Keep selectors and small behaviors configurable below.
 */
(function () {
    // Config
    const CONFIG = {
        formSelector: '#contactForm',
        stepAttr: 'data-step',
        storageKey: 'contactForm:draft:v1',
        validateDebounceMs: 300,
        autoResponseDelayMs: 2500,
        analyticsEndpoint: '/analytics', // optional server-side endpoint
        disposableDomainsSample: [
            'mailinator.com', '10minutemail.com', 'trashmail.com', 'yopmail.com'
        ],
        localePhonePatterns: {
            // basic patterns and formatters for some locales; extend as needed
            'en-US': {
                name: /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/,
                phone: /^(\+1)?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/,
                format: (digits) => {
                    // (xxx) xxx-xxxx
                    digits = digits.replace(/\D/g, '').slice(0, 10);
                    if (digits.length <= 3) return digits;
                    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
                    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
                }
            },
            'en-GB': {
                name: /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/,
                phone: /^(\+44)?\s?7\d{3}\s?\d{6}$|^(\+44)?\s?1\d{3}\s?\d{6}$/,
                format: (digits) => {
                    // +44 7xxxx xxxxxx or local
                    digits = digits.replace(/\D/g, '');
                    if (digits.startsWith('44')) digits = '+' + digits;
                    if (digits.startsWith('+44') && digits.length > 3) {
                        return digits.replace(/^(\+44)(\d{4})(\d{6})$/, '$1 $2 $3');
                    }
                    return digits;
                }
            },
            'fr-FR': {
                name: /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/,
                phone: /^(\+33|0)\s?[1-9]([-. ]?\d{2}){4}$/,
                format: (digits) => {
                    digits = digits.replace(/\D/g, '');
                    if (digits.startsWith('33')) digits = digits.slice(2);
                    if (digits.length >= 10) digits = digits.slice(-10);
                    return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
                }
            }
            // Add more locales as needed
        },
        defaultLocaleKey: 'en-US'
    };

    // Utilities
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const debounce = (fn, ms) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    };

    // Analytics helper
    function trackEvent(name, payload = {}) {
        // Push to dataLayer if present (commonly used by GTM)
        if (window.dataLayer && typeof window.dataLayer.push === 'function') {
            window.dataLayer.push({ event: name, ...payload });
        }
        // Attempt to send a non-blocking beacon to server endpoint
        if (navigator.sendBeacon) {
            try {
                navigator.sendBeacon(CONFIG.analyticsEndpoint, JSON.stringify({
                    event: name,
                    timestamp: Date.now(),
                    payload
                }));
            } catch (e) { /* fail silently */ }
        } else {
            // Fallback: fetch asynchronously
            fetch(CONFIG.analyticsEndpoint, {
                method: 'POST',
                keepalive: true,
                body: JSON.stringify({ event: name, timestamp: Date.now(), payload }),
                headers: { 'Content-Type': 'application/json' }
            }).catch(() => {});
        }
    }

    // Locale detection and rules
    function getLocaleKey() {
        const nav = navigator.language || navigator.userLanguage || CONFIG.defaultLocaleKey;
        // normalize to major form if exact not found
        if (CONFIG.localePhonePatterns[nav]) return nav;
        const short = nav.split('-')[0];
        const candidate = Object.keys(CONFIG.localePhonePatterns).find(k => k.startsWith(short));
        return candidate || CONFIG.defaultLocaleKey;
    }
    const LOCALE = getLocaleKey();
    const RULES = CONFIG.localePhonePatterns[LOCALE] || CONFIG.localePhonePatterns[CONFIG.defaultLocaleKey];

    // Email helpers
    function isDisposableEmail(domain) {
        if (!domain) return false;
        domain = domain.toLowerCase();
        return CONFIG.disposableDomainsSample.includes(domain) || CONFIG.disposableDomainsSample.some(d => domain.endsWith('.' + d));
    }

    function validateEmailSyntax(email) {
        if (!email) return false;
        // RFC 5322 compliant regex is large; use pragmatic one
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
        return re.test(email);
    }

    // Name validation: allow accents, hyphens, apostrophes, require min length
    function validateName(name) {
        if (!name) return false;
        return RULES.name.test(name.trim());
    }

    // Phone validation + formatting
    function sanitizePhone(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }
    function formatPhone(value) {
        const digits = (value || '').replace(/\D/g, '');
        if (!digits) return '';
        if (RULES.format && typeof RULES.format === 'function') {
            return RULES.format(digits);
        }
        return digits;
    }
    function validatePhone(value) {
        if (!value) return false;
        const cleaned = sanitizePhone(value);
        return RULES.phone.test(cleaned);
    }

    // Generic required check
    function isRequiredField(fieldEl) {
        return fieldEl.dataset.required === 'true' || fieldEl.required || fieldEl.getAttribute('aria-required') === 'true';
    }

    // Form and steps
    const form = $(CONFIG.formSelector);
    if (!form) {
        // Nothing to initialize
        console.warn('contact.js: form not found:', CONFIG.formSelector);
        return;
    }

    const steps = (() => {
        const list = [];
        const nodes = $$(`[${CONFIG.stepAttr}]`, form);
        nodes.forEach(n => {
            const step = parseInt(n.getAttribute(CONFIG.stepAttr), 10) || 1;
            list.push({ step, el: n });
        });
        // sort by numeric step
        return list.sort((a, b) => a.step - b.step);
    })();

    let currentStepIndex = 0;
    function showStep(index) {
        currentStepIndex = Math.max(0, Math.min(index, steps.length - 1));
        steps.forEach((s, idx) => {
            s.el.style.display = idx === currentStepIndex ? '' : 'none';
            s.el.setAttribute('aria-hidden', idx === currentStepIndex ? 'false' : 'true');
        });
        // persist progress
        persistDraft();
        trackEvent('form_step_view', { step: currentStepIndex + 1 });
    }
    function nextStep() {
        if (!validateStep(currentStepIndex)) return false;
        showStep(currentStepIndex + 1);
        return true;
    }
    function prevStep() {
        showStep(currentStepIndex - 1);
    }

    // Field handlers and validation state
    const fieldState = new Map(); // name -> {valid, touched, message}

    function setFieldValidity(field, valid, message = '') {
        const name = field.name || field.id;
        fieldState.set(name, { valid, message, touched: true });
        field.classList.toggle('invalid', !valid);
        field.classList.toggle('valid', valid);
        field.setAttribute('aria-invalid', !valid ? 'true' : 'false');
        // show inline message if available
        let msgEl = field.nextElementSibling;
        if (!msgEl || !msgEl.classList.contains('field-message')) {
            // create
            msgEl = document.createElement('div');
            msgEl.className = 'field-message';
            field.after(msgEl);
        }
        msgEl.textContent = message;
    }

    function validateField(field) {
        const val = (field.value || '').trim();
        const name = field.name || field.id || '';
        if (isRequiredField(field) && !val) {
            setFieldValidity(field, false, 'This field is required.');
            return false;
        }
        if (field.type === 'email' || field.dataset.type === 'email') {
            if (!validateEmailSyntax(val)) {
                setFieldValidity(field, false, 'Please enter a valid email address.');
                return false;
            }
            const domain = val.split('@')[1];
            if (isDisposableEmail(domain)) {
                setFieldValidity(field, false, 'Please use a non-disposable email address.');
                return false;
            }
            setFieldValidity(field, true, '');
            return true;
        }
        if (field.dataset.type === 'phone' || field.type === 'tel') {
            const formatted = formatPhone(val);
            field.value = formatted; // update UI with formatted phone
            if (!validatePhone(formatted)) {
                setFieldValidity(field, false, 'Please enter a valid phone number for your region.');
                return false;
            }
            setFieldValidity(field, true, '');
            return true;
        }
        if (field.dataset.type === 'name' || field.name.toLowerCase().includes('name')) {
            if (!validateName(val)) {
                setFieldValidity(field, false, 'Please enter a valid name.');
                return false;
            }
            setFieldValidity(field, true, '');
            return true;
        }
        // For other inputs, basic validity
        if (field.minLength && val.length > 0 && val.length < field.minLength) {
            setFieldValidity(field, false, `Please enter at least ${field.minLength} characters.`);
            return false;
        }
        setFieldValidity(field, true, '');
        return true;
    }

    const debouncedValidate = debounce((field) => validateField(field), CONFIG.validateDebounceMs);

    // Validate all fields in a given step
    function validateStep(stepIndex) {
        const step = steps[stepIndex];
        if (!step) return true;
        const inputs = $$('input,textarea,select', step.el).filter(el => !el.disabled);
        let ok = true;
        inputs.forEach(inp => {
            // Always validate required or ones with data-type
            if (isRequiredField(inp) || inp.dataset.type || inp.type === 'email' || inp.type === 'tel') {
                const valid = validateField(inp);
                if (!valid) ok = false;
            }
        });
        if (!ok) {
            trackEvent('form_step_validation_failed', { step: stepIndex + 1 });
        }
        return ok;
    }

    // Submission
    let isSubmitting = false;
    async function submitForm(ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (isSubmitting) return;
        // validate current and all steps
        let allValid = true;
        for (let i = 0; i < steps.length; i++) {
            if (!validateStep(i)) {
                allValid = false;
                // show first invalid step
                showStep(i);
                break;
            }
        }
        if (!allValid) return;

        isSubmitting = true;
        form.classList.add('submitting');
        trackEvent('form_submit_attempt', { step: currentStepIndex + 1 });

        const payload = collectFormData();
        // Simulate server call: replace with real fetch in production
        try {
            // Simulated network latency & success/failure branching
            const simulate = await simulateServerSend(payload);
            if (simulate.ok) {
                handleSuccess(simulate);
            } else {
                handleError(simulate);
            }
        } catch (err) {
            handleError({ ok: false, error: err.message || 'Network error' });
        } finally {
            isSubmitting = false;
            form.classList.remove('submitting');
        }
    }

    function collectFormData() {
        const data = {};
        const inputs = $$('input[name],textarea[name],select[name]', form);
        inputs.forEach(inp => {
            if (inp.type === 'checkbox') {
                data[inp.name] = inp.checked;
            } else if (inp.type === 'radio') {
                if (inp.checked) data[inp.name] = inp.value;
            } else {
                data[inp.name] = inp.value;
            }
        });
        // include metadata
        data._meta = { locale: LOCALE, timestamp: Date.now() };
        return data;
    }

    function simulateServerSend(payload) {
        // This returns a Promise resolving to an object representing response
        return new Promise((resolve) => {
            setTimeout(() => {
                // Simple heuristics: reject if email includes 'fail'
                const email = payload.email || payload.emailAddress || '';
                if (email.toLowerCase().includes('fail')) {
                    resolve({ ok: false, status: 422, error: 'Simulated server-side validation failed.' });
                } else {
                    resolve({ ok: true, status: 200, data: { id: Date.now(), message: 'Received' } });
                }
            }, 900);
        });
    }

    function handleSuccess(resp) {
        clearDraft(); // clear persistence on success
        trackEvent('form_submit_success', { status: resp.status || 200 });
        // Show success UI
        showStatusMessage('success', 'Thank you! Your message has been sent.');
        // simulate an auto-response email being received after a short delay
        setTimeout(() => {
            simulateAutoResponse();
        }, CONFIG.autoResponseDelayMs);
    }

    function handleError(resp) {
        trackEvent('form_submit_error', { status: resp.status || 0, error: resp.error || 'unknown' });
        showStatusMessage('error', resp.error || 'An error occurred while sending. Please try again.');
    }

    function showStatusMessage(type, message) {
        // create or update status area
        let area = $('#contactStatus');
        if (!area) {
            area = document.createElement('div');
            area.id = 'contactStatus';
            form.prepend(area);
        }
        area.className = `contact-status ${type}`;
        area.setAttribute('role', 'status');
        area.textContent = message;
    }

    function simulateAutoResponse() {
        // Simple simulated auto-response that appears in UI
        const emailsSentTo = (collectFormData().email || collectFormData().emailAddress || 'you');
        const msg = `Auto-response: Hello ${emailsSentTo}, thanks for contacting us. We'll be in touch soon.`;
        showStatusMessage('info', msg);
        trackEvent('form_autoresponse_simulated', { recipient: emailsSentTo });
    }

    // Persistence (save/restore)
    function persistDraft() {
        try {
            const data = collectFormData();
            const store = { data, step: currentStepIndex, updated: Date.now() };
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(store));
            trackEvent('form_draft_saved', { step: currentStepIndex });
        } catch (e) {
            // ignore storage errors
        }
    }
    function restoreDraft() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKey);
            if (!raw) return;
            const store = JSON.parse(raw);
            if (!store || !store.data) return;
            Object.entries(store.data).forEach(([k, v]) => {
                const el = form.querySelector(`[name="${CSS.escape(k)}"]`);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = !!v;
                else if (el.type === 'radio') {
                    const r = form.querySelector(`[name="${CSS.escape(k)}"][value="${CSS.escape(v)}"]`);
                    if (r) r.checked = true;
                } else el.value = v;
            });
            const desiredStep = Math.max(0, Math.min(store.step || 0, steps.length - 1));
            showStep(desiredStep);
            trackEvent('form_draft_restored', { step: desiredStep });
        } catch (e) {
            // ignore parse issues
        }
    }
    function clearDraft() {
        try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {}
    }

    // Attach events
    function attachEvents() {
        // Input-level
        const inputs = $$('input,textarea,select', form).filter(el => !el.disabled);
        inputs.forEach(inp => {
            const name = inp.name || inp.id || '';
            // on input: debounced validation
            inp.addEventListener('input', (e) => {
                // phone formatting real-time but not disruptive (only when user pauses)
                if (inp.dataset.type === 'phone' || inp.type === 'tel') {
                    // immediate formatting lightly
                    const caret = inp.selectionStart;
                    const before = inp.value;
                    // format after debounce to avoid fight while typing
                    debouncedValidate(inp);
                } else {
                    debouncedValidate(inp);
                }
                persistDraft();
            });
            // blur: immediate validation
            inp.addEventListener('blur', () => {
                validateField(inp);
                persistDraft();
            });
            // keydown: manage Enter in multi-step forms
            inp.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && inp.tagName.toLowerCase() !== 'textarea') {
                    ev.preventDefault();
                    // try to advance if current step valid
                    nextStep();
                }
            });
        });

        // Buttons for navigation inside the form should have data attributes
        const nextButtons = $$('[data-action="next"]', form);
        nextButtons.forEach(btn => btn.addEventListener('click', (e) => {
            e.preventDefault();
            nextStep();
        }));
        const prevButtons = $$('[data-action="prev"]', form);
        prevButtons.forEach(btn => btn.addEventListener('click', (e) => {
            e.preventDefault();
            prevStep();
        }));
        // submit
        form.addEventListener('submit', submitForm);

        // optional Save draft or Clear draft controls
        const saveBtn = $('[data-action="save-draft"]', form);
        if (saveBtn) saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            persistDraft();
            showStatusMessage('info', 'Draft saved locally.');
        });
        const clearBtn = $('[data-action="clear-draft"]', form);
        if (clearBtn) clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearDraft();
            showStatusMessage('info', 'Draft cleared.');
        });

        // page unload: persist once more
        window.addEventListener('beforeunload', persistDraft);
    }

    // Initial setup
    function init() {
        // set initial step visibility
        showStep(0);
        restoreDraft();
        attachEvents();
        // minor UX: indicate locale-aware hints
        const localeHints = $$('[data-locale-hint]', form);
        localeHints.forEach(el => {
            el.textContent = `Validation locale: ${LOCALE}`;
        });
        // track load
        trackEvent('form_init', { locale: LOCALE, steps: steps.length });
    }

    // Kick off
    document.addEventListener('DOMContentLoaded', init);

    // Expose a minimal API for page scripts (optional)
    window.__contactForm = {
        nextStep,
        prevStep,
        submitForm,
        persistDraft,
        clearDraft,
        validateField,
        getState: () => ({ step: currentStepIndex, fields: Array.from(fieldState.entries()) }),
        trackEvent
    };
})();