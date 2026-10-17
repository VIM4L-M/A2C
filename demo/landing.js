(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  root.classList.add('js');

  // Scroll reveal and count-up.
  const items = document.querySelectorAll('.reveal, .dash');
  const countUp = (el) => {
    const target = Number(el.dataset.count);
    const unit = el.dataset.unit || '';
    if (reduce) { el.textContent = target + unit; return; }
    const t0 = performance.now();
    const tick = (now) => {
      const t = clamp((now - t0) / 1400);
      el.textContent = Math.round(target * ease(t)) + unit;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        e.target.querySelectorAll('[data-count]').forEach(countUp);
        io.unobserve(e.target);
      }
    }, { threshold: 0.18 });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('in'));
  }

  if (reduce) return;

  // Product tour driven by scroll position.
  const launch = document.querySelector('[data-launch]');
  const rig = document.querySelector('[data-rig]');
  const caption = document.querySelector('[data-caption]');
  const progress = document.querySelector('[data-progress]');
  const submit = document.querySelector('[data-submit]');
  const fields = [...document.querySelectorAll('[data-type]')].map((el) => ({ el, text: el.textContent.trim() }));
  const chips = [...document.querySelectorAll('[data-chip]')];
  if (!launch || !rig) return;
  fields.forEach((f) => { f.el.textContent = ''; });

  const captions = [
    [0, 'A form you have filled a hundred times.'],
    [0.22, 'Press Scan. A2C reads labels, never your values.'],
    [0.4, 'Confirmed facts fill in. Instantly.'],
    [0.62, 'Sensitive fields wait for you. Passwords never fill.'],
    [0.78, 'You press Submit. Always.'],
    [0.88, 'A website. An extension. One profile.'],
  ];
  let lastCaption = '';

  const update = () => {
    const vh = innerHeight;
    root.style.setProperty('--hp', clamp(scrollY / (vh * 0.9)).toFixed(3));

    const r = launch.getBoundingClientRect();
    const span = launch.offsetHeight - vh;
    const p = clamp(-r.top / span);
    const s = launch.style;
    s.setProperty('--zin', ease(seg(p, 0, 0.2)).toFixed(3));
    s.setProperty('--pan', ease(seg(p, 0.18, 0.32)).toFixed(3));
    s.setProperty('--zout', ease(seg(p, 0.84, 1)).toFixed(3));
    s.setProperty('--trio', ease(seg(p, 0.88, 1)).toFixed(3));
    s.setProperty('--prog', p.toFixed(3));
    if (progress) progress.parentElement.style.opacity = r.top <= 0 && r.bottom >= vh ? '1' : '0'; // only while the stage is pinned

    // Typing: each field fills in sequence between 0.36 and 0.6.
    fields.forEach((f, i) => {
      const t = seg(p, 0.36 + i * 0.055, 0.36 + i * 0.055 + 0.07);
      f.el.textContent = f.text.slice(0, Math.round(f.text.length * t));
      f.el.classList.toggle('done', t >= 1);
    });
    chips.forEach((c, i) => c.classList.toggle('show', p > 0.62 + i * 0.05));
    if (submit) submit.classList.toggle('pulse', p > 0.78 && p < 0.9);

    let text = captions[0][1];
    for (const [at, t] of captions) if (p >= at) text = t;
    if (text !== lastCaption && caption) { caption.textContent = text; lastCaption = text; }
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
})();
